package app.hearth.tv;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;

/**
 * The optional Claude assistant. Its address, access key and the household's taste notes are
 * entered on the phone remote and kept on the stick, never in the app itself (which is public).
 */
final class Assistant {
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private final SharedPreferences prefs;

    Assistant(Context context) {
        prefs = context.getSharedPreferences("assistant", Context.MODE_PRIVATE);
    }

    boolean isReady() {
        return !url().isEmpty() && !prefs.getString("key", "").isEmpty();
    }

    String url() { return prefs.getString("url", ""); }

    String taste() { return prefs.getString("taste", ""); }

    /** What Hearth has learned from feedback, written by the assistant and editable on the phone. */
    String profile() { return prefs.getString("profile", ""); }

    /** For the phone's settings screen. Never sends the key back, only whether there is one. */
    JSONObject settings() throws Exception {
        return new JSONObject()
                .put("assistantUrl", url())
                .put("hasKey", !prefs.getString("key", "").isEmpty())
                .put("taste", taste())
                .put("profile", profile());
    }

    /** An empty key leaves the saved one alone, so the phone doesn't need to show it. */
    void save(String url, String key, String taste, String profile) {
        SharedPreferences.Editor e = prefs.edit();
        if (url != null) e.putString("url", tidyUrl(url));
        if (key != null && !key.trim().isEmpty()) e.putString("key", key.trim());
        if (taste != null) e.putString("taste", taste.length() > 2000 ? taste.substring(0, 2000) : taste);
        if (profile != null) e.putString("profile", profile.length() > 2000 ? profile.substring(0, 2000) : profile);
        e.apply();
    }

    /** Sends one request to the assistant. Blocking: call from a background thread. */
    JSONObject ask(JSONObject payload) {
        return call("/api/ask", payload);
    }

    /** Next-episode dates for the household's top series (see server/api/upnext.js). Blocking. */
    JSONObject upnext(JSONObject payload) {
        return call("/api/upnext", payload);
    }

    // ---------- Energy (see server/api/energy) ----------

    /** The latest energy week from the service, kept on the stick for the morning card. Blocking. */
    JSONObject energy() {
        JSONObject week = request("GET", "/api/energy/week", null);
        if (!week.has("error") && week.has("week")) prefs.edit().putString("energy", week.toString()).putLong("energyAt", System.currentTimeMillis()).apply();
        return week;
    }

    /** The last energy week fetched, or "" if none yet. */
    String energyCached() { return prefs.getString("energy", ""); }

    /** "Already doing this" or "Not for us" on a suggestion. Blocking. */
    JSONObject energyFeedback(String id, String verdict) {
        try { return request("POST", "/api/energy/feedback", new JSONObject().put("id", id).put("verdict", verdict)); }
        catch (Exception e) { return error("Couldn't save that."); }
    }

    // ---------- Shows the household follows, and what the TV shows as "Watching" ----------

    /** JSON array of {title, app}; edited on the phone or with Follow on a suggestion. */
    String follows() { return prefs.getString("follows", "[]"); }

    void setFollows(String json) {
        try { new org.json.JSONArray(json); prefs.edit().putString("follows", json).apply(); } catch (Exception ignored) { }
    }

    /** The TV's current Watching row, saved so the phone and the morning card can use it. */
    String watching() { return prefs.getString("watching", "{}"); }

    void setWatching(String json) {
        try { new JSONObject(json); prefs.edit().putString("watching", json).apply(); } catch (Exception ignored) { }
    }

    /** Asks the assistant to update the learned profile, and keeps the new one. Blocking. */
    JSONObject learn(JSONObject payload) {
        JSONObject answer = call("/api/learn", payload);
        String profile = answer.optString("profile", "");
        if (!answer.has("error") && !profile.isEmpty()) save(null, null, null, profile);
        return answer;
    }

    private JSONObject call(String path, JSONObject payload) {
        try {
            payload.put("taste", taste());
            payload.put("profile", profile());
        } catch (Exception ignored) { }
        return request("POST", path, payload);
    }

    private JSONObject request(String method, String path, JSONObject payload) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url() + path).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(25000);
            conn.setRequestMethod(method);
            conn.setRequestProperty("x-hearth-key", prefs.getString("key", ""));
            if (payload != null) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(payload.toString().getBytes(UTF8));
                }
            }
            int status = conn.getResponseCode();
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String body = in == null ? "" : read(in);
            JSONObject json = body.isEmpty() ? new JSONObject() : new JSONObject(body);
            if (status >= 400 && !json.has("error")) json.put("error", "The assistant didn't answer (" + status + ").");
            return json;
        } catch (Exception e) {
            return error("Can’t reach the assistant. Check the TV is online.");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static JSONObject error(String message) {
        try { return new JSONObject().put("error", message); } catch (Exception e) { return new JSONObject(); }
    }

    private static String tidyUrl(String url) {
        String u = url.trim();
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        if (!u.isEmpty() && !u.startsWith("http")) u = "https://" + u;
        return u;
    }

    private static String read(InputStream in) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        in.close();
        return buf.toString("UTF-8");
    }
}
