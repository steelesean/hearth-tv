package app.hearth.tv;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.util.Locale;

/** Local weather from Open-Meteo (free, no key). The town is set on the phone. */
final class Weather {
    private final SharedPreferences prefs;
    private JSONObject cached;
    private long cachedAt;

    Weather(Context context) {
        prefs = context.getSharedPreferences("home", Context.MODE_PRIVATE);
    }

    String town() { return prefs.getString("town", ""); }

    /** "auto" (8pm to 7am), "dark" or "light". */
    String evening() { return prefs.getString("evening", "auto"); }

    void setEvening(String mode) {
        if ("auto".equals(mode) || "dark".equals(mode) || "light".equals(mode)) prefs.edit().putString("evening", mode).apply();
    }

    /** Whether the evening palette should be showing right now. */
    static boolean eveningNow(Context context) {
        String mode = context.getSharedPreferences("home", Context.MODE_PRIVATE).getString("evening", "auto");
        if ("dark".equals(mode)) return true;
        if ("light".equals(mode)) return false;
        int hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY);
        return hour >= 20 || hour < 7;
    }

    boolean morningOn() { return prefs.getBoolean("morning", true); }

    String morningTime() { return prefs.getString("morningTime", "07:30"); }

    void setMorning(boolean on, String time) {
        SharedPreferences.Editor e = prefs.edit().putBoolean("morning", on);
        if (time != null && time.matches("([01]\\d|2[0-3]):[0-5]\\d")) e.putString("morningTime", time);
        e.apply();
    }

    /** Looks the town up and saves where it is. Returns the place name found. Blocking. */
    synchronized String setTown(String name) throws Exception {
        JSONObject r = new JSONObject(Net.get("https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&countryCode=GB&name="
                + URLEncoder.encode(name.trim(), "UTF-8")));
        JSONArray results = r.optJSONArray("results");
        if (results == null || results.length() == 0) throw new Exception("Couldn’t find " + name);
        JSONObject place = results.getJSONObject(0);
        String found = place.optString("name");
        prefs.edit().putString("town", found)
                .putFloat("lat", (float) place.optDouble("latitude"))
                .putFloat("lon", (float) place.optDouble("longitude")).apply();
        cached = null;
        return found;
    }

    /**
     * {now, desc, high, low, tonightLow, frost, rain} or null if no town is set. Refreshes at
     * most every 30 minutes. Blocking.
     */
    synchronized JSONObject today() {
        if (town().isEmpty()) return null;
        if (cached != null && System.currentTimeMillis() - cachedAt < 30 * 60 * 1000L) return cached;
        try {
            String url = String.format(Locale.UK,
                    "https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f&current=temperature_2m,weather_code"
                            + "&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max"
                            + "&timezone=Europe%%2FLondon&forecast_days=2",
                    prefs.getFloat("lat", 0), prefs.getFloat("lon", 0));
            JSONObject r = new JSONObject(Net.get(url));
            JSONObject cur = r.getJSONObject("current");
            JSONObject daily = r.getJSONObject("daily");
            double tonightLow = daily.getJSONArray("temperature_2m_min").optDouble(1, Double.NaN);
            cached = new JSONObject()
                    .put("town", town())
                    .put("now", Math.round(cur.optDouble("temperature_2m")))
                    .put("desc", describe(cur.optInt("weather_code")))
                    .put("high", Math.round(daily.getJSONArray("temperature_2m_max").optDouble(0)))
                    .put("low", Math.round(daily.getJSONArray("temperature_2m_min").optDouble(0)))
                    .put("tonightLow", Math.round(tonightLow))
                    .put("frost", tonightLow <= 0)
                    .put("rain", daily.getJSONArray("precipitation_probability_max").optInt(0, 0));
            cachedAt = System.currentTimeMillis();
        } catch (Exception e) {
            // Keep showing the last reading rather than nothing.
        }
        return cached;
    }

    /** WMO weather codes, in plain words. */
    static String describe(int code) {
        if (code == 0) return "Clear";
        if (code <= 2) return "Partly cloudy";
        if (code == 3) return "Cloudy";
        if (code == 45 || code == 48) return "Foggy";
        if (code >= 51 && code <= 57) return "Drizzle";
        if (code >= 61 && code <= 67) return "Rain";
        if (code >= 71 && code <= 77) return "Snow";
        if (code >= 80 && code <= 82) return "Showers";
        if (code >= 85 && code <= 86) return "Snow showers";
        if (code >= 95) return "Thunderstorms";
        return "Mixed";
    }
}
