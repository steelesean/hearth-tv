package app.hearth.tv;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Finds the other apps on the stick (iPlayer, Netflix…) and opens them. */
final class AppLauncher {
    private static final String TAG = "Hearth";

    private final Context context;
    private final JSONObject config;

    AppLauncher(Context context) {
        this.context = context.getApplicationContext();
        this.config = loadConfig(this.context);
    }

    /** "ok" if the app opened, "missing" if it isn't installed. */
    String openApp(String key) {
        String pkg = resolve(key);
        if (pkg == null) return "missing";
        Intent intent = launchIntent(pkg);
        if (intent == null) return "missing";
        return start(intent) ? "ok" : "missing";
    }

    /**
     * Tries a direct link inside the app (a live channel or a programme). If the app won't
     * take the link, opens the app on its home page instead.
     */
    String openLink(String key, String url) {
        String pkg = resolve(key);
        if (pkg == null) return "missing";
        if (url != null && url.startsWith("intent:")) {
            // A full Android intent, e.g. iPlayer's own links, which name the exact screen to open.
            try {
                Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                // Open the app fresh: iPlayer ignores the link if it's resumed mid-browse.
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                if (start(intent)) return "ok";
            } catch (URISyntaxException e) {
                Log.w(TAG, "Bad link for " + key + ": " + url, e);
            }
            return openApp(key);
        }
        if (url != null && !url.isEmpty()) {
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            view.setPackage(pkg);
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (!context.getPackageManager().queryIntentActivities(view, 0).isEmpty() && start(view)) {
                return "ok";
            }
        }
        return openApp(key);
    }

    /** Every app on the stick that can be opened, as "Label|package" lines. Useful when tuning config.js. */
    List<String> installedApps() {
        List<String> out = new ArrayList<>();
        PackageManager pm = context.getPackageManager();
        for (ResolveInfo info : launchables()) {
            out.add(info.loadLabel(pm) + "|" + info.activityInfo.packageName);
        }
        return out;
    }

    private String resolve(String key) {
        JSONObject app = findApp(key);
        if (app == null) return null;
        PackageManager pm = context.getPackageManager();
        JSONArray packages = app.optJSONArray("packages");
        if (packages != null) {
            for (int i = 0; i < packages.length(); i++) {
                String pkg = packages.optString(i);
                if (launchIntent(pkg) != null) return pkg;
            }
        }
        JSONArray match = app.optJSONArray("match");
        if (match != null) {
            for (ResolveInfo info : launchables()) {
                String label = String.valueOf(info.loadLabel(pm)).toLowerCase(Locale.UK);
                for (int i = 0; i < match.length(); i++) {
                    if (label.contains(match.optString(i).toLowerCase(Locale.UK))) {
                        return info.activityInfo.packageName;
                    }
                }
            }
        }
        Log.w(TAG, "No app found for " + key);
        return null;
    }

    private Intent launchIntent(String pkg) {
        PackageManager pm = context.getPackageManager();
        Intent intent = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (intent == null) intent = pm.getLaunchIntentForPackage(pkg);
        if (intent != null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    private List<ResolveInfo> launchables() {
        PackageManager pm = context.getPackageManager();
        List<ResolveInfo> all = new ArrayList<>();
        Intent tv = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
        Intent phone = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        all.addAll(pm.queryIntentActivities(tv, 0));
        all.addAll(pm.queryIntentActivities(phone, 0));
        return all;
    }

    private boolean start(Intent intent) {
        try {
            context.startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            Log.w(TAG, "Couldn't open " + intent, e);
            return false;
        }
    }

    private JSONObject findApp(String key) {
        String[] lists = {"apps", "extraApps"};
        for (String list : lists) {
            JSONArray arr = config.optJSONArray(list);
            if (arr == null) continue;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject app = arr.optJSONObject(i);
                if (app != null && key.equals(app.optString("key"))) return app;
            }
        }
        return null;
    }

    /** config.js is "window.HEARTH_CONFIG = { …json… };" – take the JSON part. */
    static JSONObject loadConfig(Context context) {
        try (InputStream in = context.getAssets().open("config.js")) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            String js = buf.toString("UTF-8");
            int start = js.indexOf('{', js.indexOf("HEARTH_CONFIG"));
            int end = js.lastIndexOf('}');
            return new JSONObject(js.substring(start, end + 1));
        } catch (Exception e) {
            Log.e(TAG, "Couldn't read config.js", e);
            return new JSONObject();
        }
    }
}
