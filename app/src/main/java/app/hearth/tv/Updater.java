package app.hearth.tv;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Checks GitHub for a newer Hearth and installs it on request. Fire TV then shows its own
 * "Install" screen, so nothing changes without someone pressing OK.
 */
final class Updater {
    private static final String TAG = "Hearth";
    private static final String LATEST = "https://api.github.com/repos/steelesean/hearth-tv/releases/latest";

    private static volatile JSONObject available;   // {version, code, url} or null
    private static volatile long checkedAt;

    private Updater() {}

    static int installedCode(Context context) {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    /** The last check's answer, without checking again. */
    static JSONObject waiting() { return available; }

    /** The waiting update, or null. Checks GitHub at most about once an hour. Blocking. */
    static JSONObject check(Context context) {
        if (System.currentTimeMillis() - checkedAt < 55 * 60 * 1000L) return available;
        checkedAt = System.currentTimeMillis();
        try {
            JSONObject release = new JSONObject(Net.get(LATEST));
            String tag = release.optString("tag_name");            // e.g. v0.1.24
            int code = Integer.parseInt(tag.substring(tag.lastIndexOf('.') + 1));
            String url = null;
            JSONArray assets = release.optJSONArray("assets");
            for (int i = 0; assets != null && i < assets.length(); i++) {
                JSONObject a = assets.getJSONObject(i);
                if ("hearth-tv.apk".equals(a.optString("name"))) url = a.optString("browser_download_url");
            }
            available = (url != null && code > installedCode(context))
                    ? new JSONObject().put("version", tag.substring(1)).put("code", code).put("url", url)
                    : null;
        } catch (Exception e) {
            Log.w(TAG, "Update check failed", e);
        }
        return available;
    }

    /** Downloads the update and hands it to Fire TV's installer. Blocking. */
    static void install(Context context) throws Exception {
        JSONObject update = available;
        if (update == null) { checkedAt = 0; update = check(context); }   // e.g. from the recovery screen
        if (update == null) throw new Exception("Hearth is already on the latest version");
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        int id = installer.createSession(params);
        PackageInstaller.Session session = installer.openSession(id);
        HttpURLConnection c = (HttpURLConnection) new URL(update.getString("url")).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(60000);
        c.setRequestProperty("User-Agent", "Hearth-TV");
        try (InputStream in = c.getInputStream(); OutputStream out = session.openWrite("hearth", 0, -1)) {
            byte[] chunk = new byte[65536];
            int n;
            while ((n = in.read(chunk)) > 0) out.write(chunk, 0, n);
            session.fsync(out);
        } finally {
            c.disconnect();
        }
        Intent done = new Intent(context, UpdateReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent pi = PendingIntent.getBroadcast(context, id, done, flags);
        session.commit(pi.getIntentSender());
        session.close();
    }
}
