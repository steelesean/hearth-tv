package app.hearth.tv;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.util.Iterator;
import java.util.Map;

/**
 * Everything you'd otherwise set up again after a reinstall, as one JSON file the phone can
 * save and restore: the assistant, your taste and what Hearth has learned, follows, weather
 * and bedtime settings, and the TV page's own history. The Tado sign-in and the phone
 * pairing are left out on purpose: they're quick to redo and safer not to copy around.
 */
final class Backup {
    // Preference files, and the keys in each that are safe and useful to carry over.
    private static final String[][] KEEP = {
            {"assistant", "url", "key", "taste", "profile", "follows"},
            {"home", "town", "lat", "lon", "morning", "morningTime", "evening"},
            {"tado", "time", "minTarget"},
            {"page", "local"},
    };

    private Backup() {}

    static JSONObject export(Context context) throws Exception {
        JSONObject out = new JSONObject().put("hearthBackup", 1).put("savedAt", System.currentTimeMillis());
        for (String[] spec : KEEP) {
            SharedPreferences prefs = context.getSharedPreferences(spec[0], Context.MODE_PRIVATE);
            Map<String, ?> all = prefs.getAll();
            JSONObject part = new JSONObject();
            for (int i = 1; i < spec.length; i++) {
                Object v = all.get(spec[i]);
                if (v != null) part.put(spec[i], v instanceof Float ? ((Float) v).doubleValue() : v);
            }
            out.put(spec[0], part);
        }
        return out;
    }

    /** Returns the TV page's saved data (JSON text) so it can be put back into the page. */
    static String restore(Context context, JSONObject backup) throws Exception {
        if (backup.optInt("hearthBackup") != 1) throw new Exception("That isn't a Hearth backup file.");
        for (String[] spec : KEEP) {
            JSONObject part = backup.optJSONObject(spec[0]);
            if (part == null) continue;
            SharedPreferences.Editor e = context.getSharedPreferences(spec[0], Context.MODE_PRIVATE).edit();
            for (Iterator<String> it = part.keys(); it.hasNext(); ) {
                String k = it.next();
                boolean allowed = false;
                for (int i = 1; i < spec.length; i++) if (spec[i].equals(k)) allowed = true;
                if (!allowed) continue;
                Object v = part.get(k);
                if (v instanceof Boolean) e.putBoolean(k, (Boolean) v);
                else if (v instanceof Number && ("lat".equals(k) || "lon".equals(k) || "minTarget".equals(k))) e.putFloat(k, ((Number) v).floatValue());
                else e.putString(k, String.valueOf(v));
            }
            e.apply();
        }
        JSONObject page = backup.optJSONObject("page");
        return page == null ? "{}" : page.optString("local", "{}");
    }

    /** The TV page mirrors its own data here so a backup can include it. */
    static void savePage(Context context, String json) {
        context.getSharedPreferences("page", Context.MODE_PRIVATE).edit().putString("local", json).apply();
    }
}
