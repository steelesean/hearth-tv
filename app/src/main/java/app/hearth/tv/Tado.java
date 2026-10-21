package app.hearth.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Reads which rooms are heating from Tado. Uses Tado's unofficial web API with its
 * "device code" sign-in: the phone shows a link, you approve it in your Tado account, and
 * the stick keeps the sign-in. Tado limits calls per day, so this only checks when asked.
 */
final class Tado {
    private static final String TAG = "Hearth";
    private static final Charset UTF8 = Charset.forName("UTF-8");
    // Tado's public client id for device sign-in (the same for everyone).
    private static final String CLIENT_ID = "1bb50063-6b0c-4d11-bd99-387f4a91cc46";
    private static final String AUTH = "https://login.tado.com/oauth2/";
    private static final String API = "https://my.tado.com/api/v2/";
    // Tado X (the newer generation) keeps its rooms in a separate service.
    private static final String HOPS = "https://hops.tado.com/";

    /** One heating room and what Tado says about it. */
    static final class Room {
        final String name;
        final boolean on;      // switched on (power ON)
        final double inside;   // NaN if unknown
        final double target;   // NaN if unknown, or when off
        final double power;    // 0-100, how hard it's heating right now
        Room(String name, boolean on, double inside, double target, double power) {
            this.name = name; this.on = on; this.inside = inside; this.target = target; this.power = power;
        }
        /** "Left on": heating right now, or switched on and set to a warm temperature. */
        boolean leftOn(double minTarget) {
            return on && (power > 0 || (!Double.isNaN(target) && target >= minTarget));
        }
    }

    /** Rooms counted as left on are set to at least this. Overnight setbacks sit lower. */
    double minTarget() { return prefs.getFloat("minTarget", 17f); }

    void setMinTarget(double c) {
        if (c >= 5 && c <= 25) prefs.edit().putFloat("minTarget", (float) c).apply();
    }

    private final SharedPreferences prefs;
    private String accessToken;
    private long accessExpires;

    Tado(Context context) {
        prefs = context.getSharedPreferences("tado", Context.MODE_PRIVATE);
    }

    boolean isConnected() { return !prefs.getString("refresh", "").isEmpty(); }

    String homeName() { return prefs.getString("homeName", ""); }

    String reminderTime() { return prefs.getString("time", "21:45"); }

    void setReminderTime(String hhmm) {
        if (hhmm != null && hhmm.matches("([01]\\d|2[0-3]):[0-5]\\d")) prefs.edit().putString("time", hhmm).apply();
    }

    void disconnect() {
        prefs.edit().remove("refresh").remove("homeId").remove("homeName").remove("generation").remove("device").apply();
        accessToken = null;
    }

    // ---------- Sign-in ----------

    /** Starts sign-in. Returns {code, link, expiresIn} for the phone to show. */
    synchronized JSONObject startSignIn() throws Exception {
        JSONObject r = post(AUTH + "device_authorize", "client_id=" + CLIENT_ID + "&scope=offline_access");
        prefs.edit()
                .putString("device", r.optString("device_code"))
                .putLong("deviceExpires", System.currentTimeMillis() + r.optLong("expires_in", 300) * 1000)
                .putLong("interval", Math.max(5, r.optLong("interval", 5)))
                .apply();
        return new JSONObject()
                .put("code", r.optString("user_code"))
                .put("link", r.optString("verification_uri_complete", r.optString("verification_uri")))
                .put("expiresIn", r.optLong("expires_in", 300));
    }

    /** Waits for the household to approve the sign-in. Blocking: run on a background thread. */
    void finishSignIn() {
        long interval = prefs.getLong("interval", 5) * 1000;
        while (System.currentTimeMillis() < prefs.getLong("deviceExpires", 0)) {
            String device = prefs.getString("device", "");
            if (device.isEmpty()) return;
            try { Thread.sleep(interval); } catch (InterruptedException e) { return; }
            try {
                JSONObject t = post(AUTH + "token", "client_id=" + CLIENT_ID + "&device_code=" + enc(device)
                        + "&grant_type=" + enc("urn:ietf:params:oauth:grant-type:device_code"));
                keepTokens(t);
                prefs.edit().remove("device").apply();
                loadHome();
                Log.i(TAG, "Tado connected: " + homeName());
                return;
            } catch (HttpError e) {
                if (e.body.contains("slow_down")) interval += 5000;
                else if (!e.body.contains("authorization_pending")) { Log.w(TAG, "Tado sign-in failed: " + e.body); return; }
            } catch (Exception e) {
                Log.w(TAG, "Tado sign-in error", e);
            }
        }
    }

    // ---------- Reading the rooms ----------

    /** Rooms left on, by the minTarget rule. Blocking. */
    synchronized List<Room> heatingRooms() throws Exception {
        List<Room> out = new ArrayList<>();
        for (Room r : allRooms()) if (r.leftOn(minTarget())) out.add(r);
        return out;
    }

    /** What the last check found, for the test card when no rooms come back. */
    String lastReport = "";

    /** Every heating room with its state. Blocking. */
    synchronized List<Room> allRooms() throws Exception {
        String home = prefs.getString("homeId", "");
        if (home.isEmpty() || !prefs.contains("generation")) home = loadHome();
        String generation = prefs.getString("generation", "");
        List<Room> rooms = "LINE_X".equals(generation) ? tadoXRooms(home) : classicRooms(home);
        // If the generation wasn't clear and the classic list is empty, try the Tado X one too.
        if (rooms.isEmpty() && !"LINE_X".equals(generation)) {
            try { rooms = tadoXRooms(home); } catch (Exception e) { lastReport += " Tado X check: " + e.getMessage() + "."; }
        }
        return rooms;
    }

    /** Tado X: one list of rooms with their settings and readings. */
    private List<Room> tadoXRooms(String home) throws Exception {
        JSONArray list = getArray(HOPS + "homes/" + home + "/rooms");
        List<Room> rooms = new ArrayList<>();
        for (int i = 0; i < list.length(); i++) {
            JSONObject room = list.optJSONObject(i);
            if (room == null) continue;
            JSONObject setting = room.optJSONObject("setting");
            boolean on = setting != null && "ON".equals(setting.optString("power"));
            double target = on ? value(setting.optJSONObject("temperature")) : Double.NaN;
            JSONObject sensors = room.optJSONObject("sensorDataPoints");
            double inside = value(sensors == null ? null : sensors.optJSONObject("insideTemperature"));
            JSONObject power = room.optJSONObject("heatingPower");
            double percent = power == null ? 0 : power.optDouble("percentage", 0);
            rooms.add(new Room(room.optString("name", room.optString("roomName")), on, inside, target, percent));
        }
        lastReport = "Tado X home " + homeName() + ", " + rooms.size() + " rooms.";
        return rooms;
    }

    /** Tado before X: heating zones and their states. */
    private List<Room> classicRooms(String home) throws Exception {
        JSONArray zones = getArray(API + "homes/" + home + "/zones");
        StringBuilder types = new StringBuilder();
        for (int i = 0; i < zones.length(); i++) {
            JSONObject z = zones.optJSONObject(i);
            if (z != null) types.append(types.length() == 0 ? "" : ", ").append(z.optString("type"));
        }
        lastReport = "Home " + homeName() + " (" + prefs.getString("generation", "unknown generation") + "), "
                + zones.length() + " zones" + (types.length() > 0 ? ": " + types : "") + ".";
        JSONObject states = get(API + "homes/" + home + "/zoneStates").optJSONObject("zoneStates");
        List<Room> rooms = new ArrayList<>();
        for (int i = 0; i < zones.length(); i++) {
            JSONObject zone = zones.optJSONObject(i);
            if (zone == null || !"HEATING".equals(zone.optString("type"))) continue;
            JSONObject state = states == null ? null : states.optJSONObject(String.valueOf(zone.optInt("id")));
            if (state == null) continue;
            JSONObject setting = state.optJSONObject("setting");
            boolean on = setting != null && "ON".equals(setting.optString("power"));
            JSONObject activity = state.optJSONObject("activityDataPoints");
            JSONObject power = activity == null ? null : activity.optJSONObject("heatingPower");
            double percent = power == null ? 0 : power.optDouble("percentage", 0);
            double target = on ? celsius(setting.optJSONObject("temperature")) : Double.NaN;
            JSONObject sensors = state.optJSONObject("sensorDataPoints");
            double inside = celsius(sensors == null ? null : sensors.optJSONObject("insideTemperature"));
            rooms.add(new Room(zone.optString("name"), on, inside, target, percent));
        }
        return rooms;
    }

    private String loadHome() throws Exception {
        JSONObject me = get(API + "me");
        JSONArray homes = me.optJSONArray("homes");
        if (homes == null || homes.length() == 0) throw new Exception("No Tado home on this account");
        JSONObject h = homes.getJSONObject(0);
        String id = String.valueOf(h.optLong("id"));
        String generation = "";
        try { generation = get(API + "homes/" + id).optString("generation", ""); } catch (Exception ignored) { }
        prefs.edit().putString("homeId", id).putString("homeName", h.optString("name"))
                .putString("generation", generation).apply();
        return id;
    }

    /** Tado X gives temperatures as {"value": 21.0}; older Tado as {"celsius": 21.0}. */
    private static double value(JSONObject t) {
        if (t == null) return Double.NaN;
        double v = t.optDouble("value", Double.NaN);
        return Double.isNaN(v) ? t.optDouble("celsius", Double.NaN) : v;
    }

    private static double celsius(JSONObject t) {
        return t == null ? Double.NaN : t.optDouble("celsius", Double.NaN);
    }

    // ---------- Tokens and HTTP ----------

    private String token() throws Exception {
        if (accessToken != null && System.currentTimeMillis() < accessExpires - 30000) return accessToken;
        String refresh = prefs.getString("refresh", "");
        if (refresh.isEmpty()) throw new Exception("Tado isn't connected");
        JSONObject t = post(AUTH + "token", "client_id=" + CLIENT_ID + "&grant_type=refresh_token&refresh_token=" + enc(refresh));
        keepTokens(t);
        return accessToken;
    }

    /** Tado issues a new refresh token each time, so always keep the latest one. */
    private void keepTokens(JSONObject t) {
        accessToken = t.optString("access_token");
        accessExpires = System.currentTimeMillis() + t.optLong("expires_in", 600) * 1000;
        String refresh = t.optString("refresh_token", "");
        if (!refresh.isEmpty()) prefs.edit().putString("refresh", refresh).apply();
    }

    private JSONObject get(String url) throws Exception {
        return new JSONObject(request("GET", url, null, token()));
    }

    private JSONArray getArray(String url) throws Exception {
        return new JSONArray(request("GET", url, null, token()));
    }

    private static JSONObject post(String url, String form) throws Exception {
        return new JSONObject(request("POST", url, form, null));
    }

    static final class HttpError extends Exception {
        final String body;
        HttpError(int status, String body) { super("HTTP " + status); this.body = body == null ? "" : body; }
    }

    private static String request(String method, String url, String form, String bearer) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(8000);
            c.setReadTimeout(15000);
            c.setRequestMethod(method);
            c.setRequestProperty("Accept", "application/json");
            if (bearer != null) c.setRequestProperty("Authorization", "Bearer " + bearer);
            if (form != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                try (OutputStream out = c.getOutputStream()) { out.write(form.getBytes(UTF8)); }
            }
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            String body = in == null ? "" : read(in);
            if (status >= 400) throw new HttpError(status, body);
            return body;
        } finally {
            c.disconnect();
        }
    }

    private static String enc(String s) throws Exception { return URLEncoder.encode(s, "UTF-8"); }

    private static String read(InputStream in) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        in.close();
        return buf.toString("UTF-8");
    }

    /** "Living room  set to 21°, heating" for the card. */
    static String describe(Room r) {
        StringBuilder sb = new StringBuilder(r.name);
        if (!r.on) return sb.append("  off").toString();
        if (!Double.isNaN(r.target)) sb.append(String.format(Locale.UK, "  set to %.0f°", r.target));
        if (r.power > 0) sb.append(", heating");
        else if (!Double.isNaN(r.inside)) sb.append(String.format(Locale.UK, ", %.0f° now", r.inside));
        return sb.toString();
    }

}
