package app.hearth.tv;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Once a week, asks iPlayer whether each children's programme is still available, so a tile
 * for a film that has left iPlayer can say so instead of ending on an error.
 */
final class KidCheck {
    private static final Pattern PID = Pattern.compile("playback/([a-z0-9]{8})");
    private final Context context;
    private final SharedPreferences prefs;

    KidCheck(Context context) {
        this.context = context.getApplicationContext();
        prefs = context.getSharedPreferences("kids", Context.MODE_PRIVATE);
    }

    /** {"gruffalo": true, ...}; programmes we couldn't check are left out. */
    JSONObject status() {
        try { return new JSONObject(prefs.getString("status", "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    /** Checks if the last check was over a week ago. Blocking. */
    void checkIfDue() {
        if (System.currentTimeMillis() - prefs.getLong("checkedAt", 0) < 7 * 24 * 3600 * 1000L) return;
        JSONObject out = status();
        JSONArray kids = AppLauncher.loadConfig(context).optJSONArray("kids");
        for (int i = 0; kids != null && i < kids.length(); i++) {
            JSONObject k = kids.optJSONObject(i);
            if (k == null || !"iplayer".equals(k.optString("app"))) continue;
            Matcher m = PID.matcher(k.optString("url"));
            if (!m.find()) continue;
            try {
                JSONObject r = new JSONObject(Net.get("https://ibl.api.bbc.co.uk/ibl/v1/episodes/" + m.group(1) + "?availability=available"));
                JSONArray eps = r.optJSONArray("episodes");
                out.put(k.optString("key"), eps != null && eps.length() > 0);
            } catch (Exception e) {
                // Couldn't tell: leave the last answer, so a network blip never hides a tile.
            }
        }
        prefs.edit().putString("status", out.toString()).putLong("checkedAt", System.currentTimeMillis()).apply();
    }
}
