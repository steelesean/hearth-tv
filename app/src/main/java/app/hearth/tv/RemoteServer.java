package app.hearth.tv;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.Charset;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A very small web server for the phone remote. It serves the remote page and accepts
 * commands. It only answers on the home network, and commands need a paired phone.
 */
final class RemoteServer {
    private static final String TAG = "Hearth";
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final int MAX_BODY = 16 * 1024;

    /** Files the phone is allowed to fetch, mapped to their place in the app's assets. */
    private static final Map<String, String> FILES = new HashMap<>();
    static {
        FILES.put("/", "phone.html");
        FILES.put("/index.html", "phone.html");
        FILES.put("/shared.css", "shared.css");
        FILES.put("/config.js", "config.js");
        FILES.put("/fonts/figtree.woff2", "fonts/figtree.woff2");
        FILES.put("/fonts/newsreader.woff2", "fonts/newsreader.woff2");
    }

    private final Context context;
    private final Pairing pairing;
    private final AppLauncher launcher;
    private final Assistant assistant;
    private final Tado tado;
    private final HeatingReminder heating;
    private final Weather weather;
    private final Sonos sonos;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private ServerSocket socket;
    private int port = -1;

    RemoteServer(Context context, Pairing pairing, AppLauncher launcher, Tado tado, HeatingReminder heating, Weather weather) {
        this.context = context.getApplicationContext();
        this.pairing = pairing;
        this.launcher = launcher;
        this.assistant = new Assistant(context);
        this.tado = tado;
        this.heating = heating;
        this.weather = weather;
        this.sonos = new Sonos(context);
    }

    int port() { return port; }

    void start() {
        for (int p = 8080; p < 8090 && socket == null; p++) {
            try {
                socket = new ServerSocket(p);
                port = p;
            } catch (IOException ignored) {
            }
        }
        if (socket == null) {
            Log.e(TAG, "No free port for the phone remote");
            return;
        }
        Thread accept = new Thread(new Runnable() {
            @Override public void run() {
                while (!socket.isClosed()) {
                    try {
                        final Socket client = socket.accept();
                        pool.execute(new Runnable() { @Override public void run() { handle(client); } });
                    } catch (IOException e) {
                        if (!socket.isClosed()) Log.w(TAG, "accept failed", e);
                    }
                }
            }
        }, "hearth-remote");
        accept.setDaemon(true);
        accept.start();
        Log.i(TAG, "Phone remote listening on port " + port);
    }

    void stop() {
        try { if (socket != null) socket.close(); } catch (IOException ignored) {}
        pool.shutdownNow();
    }

    private void handle(Socket client) {
        try {
            client.setSoTimeout(10000);
            InputStream in = new BufferedInputStream(client.getInputStream());
            OutputStream out = client.getOutputStream();

            String requestLine = readLine(in);
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) { send(out, 400, "text/plain", bytes("Bad request")); return; }
            String method = parts[0];
            String target = parts[1];

            int length = 0;
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase("content-length")) {
                    length = Integer.parseInt(line.substring(colon + 1).trim());
                }
            }
            if (length > MAX_BODY) { send(out, 413, "text/plain", bytes("Too large")); return; }
            byte[] body = new byte[length];
            int read = 0;
            while (read < length) {
                int n = in.read(body, read, length - read);
                if (n < 0) break;
                read += n;
            }

            String path = target;
            String query = "";
            int q = target.indexOf('?');
            if (q >= 0) { path = target.substring(0, q); query = target.substring(q + 1); }

            if ("GET".equals(method) && FILES.containsKey(path)) {
                serveAsset(out, FILES.get(path));
            } else if ("GET".equals(method) && "/api/status".equals(path)) {
                JSONObject res = new JSONObject();
                res.put("paired", pairing.isPaired(param(query, "token")));
                sendJson(out, 200, res);
            } else if ("POST".equals(method) && "/api/pair".equals(path)) {
                JSONObject req = new JSONObject(new String(body, UTF8));
                String token = pairing.pair(req.optString("code"));
                JSONObject res = new JSONObject();
                res.put("ok", token != null);
                if (token != null) {
                    res.put("token", token);
                    Remote.deliver(context, new JSONObject().put("type", "paired"));
                }
                sendJson(out, token != null ? 200 : 403, res);
            } else if ("POST".equals(method) && "/api/cmd".equals(path)) {
                JSONObject req = new JSONObject(new String(body, UTF8));
                if (!pairing.isPaired(req.optString("token"))) {
                    sendJson(out, 401, new JSONObject().put("ok", false));
                    return;
                }
                JSONObject cmd = new JSONObject()
                        .put("type", req.optString("type"))
                        .put("value", req.optString("value"));
                boolean delivered = Remote.deliver(context, cmd);
                sendJson(out, 200, new JSONObject().put("ok", true).put("delivered", delivered));
            } else if ("GET".equals(method) && "/api/settings".equals(path)) {
                if (!pairing.isPaired(param(query, "token"))) {
                    sendJson(out, 401, new JSONObject().put("ok", false));
                    return;
                }
                sendJson(out, 200, assistant.settings());
            } else if ("POST".equals(method) && "/api/settings".equals(path)) {
                JSONObject req = new JSONObject(new String(body, UTF8));
                if (!pairing.isPaired(req.optString("token"))) {
                    sendJson(out, 401, new JSONObject().put("ok", false));
                    return;
                }
                assistant.save(req.has("assistantUrl") ? req.optString("assistantUrl") : null,
                        req.optString("assistantKey", ""),
                        req.has("taste") ? req.optString("taste") : null,
                        req.has("profile") ? req.optString("profile") : null);
                if (req.optBoolean("forget")) Remote.deliver(context, new JSONObject().put("type", "forget"));
                sendJson(out, 200, new JSONObject().put("ok", true).put("ready", assistant.isReady()));
                Remote.deliver(context, new JSONObject().put("type", "reload"));
            } else if ("GET".equals(method) && "/api/tado".equals(path)) {
                if (!pairing.isPaired(param(query, "token"))) {
                    sendJson(out, 401, new JSONObject().put("ok", false));
                    return;
                }
                sendJson(out, 200, tadoStatus());
            } else if ("POST".equals(method) && "/api/tado".equals(path)) {
                JSONObject req = new JSONObject(new String(body, UTF8));
                if (!pairing.isPaired(req.optString("token"))) {
                    sendJson(out, 401, new JSONObject().put("ok", false));
                    return;
                }
                String action = req.optString("action");
                JSONObject res = new JSONObject().put("ok", true);
                if ("connect".equals(action)) {
                    res.put("signIn", tado.startSignIn());
                    new Thread(new Runnable() { @Override public void run() { tado.finishSignIn(); } }, "hearth-tado-signin").start();
                } else if ("disconnect".equals(action)) {
                    tado.disconnect();
                } else if ("test".equals(action)) {
                    heating.check(true);
                } else if ("time".equals(action)) {
                    tado.setReminderTime(req.optString("time"));
                } else if ("minTarget".equals(action)) {
                    tado.setMinTarget(req.optDouble("minTarget", 17));
                }
                sendJson(out, 200, res.put("status", tadoStatus()));
            } else if ("GET".equals(method) && "/api/volume".equals(path)) {
                if (!pairing.isPaired(param(query, "token"))) {
                    sendJson(out, 401, new JSONObject().put("ok", false));
                    return;
                }
                sendJson(out, 200, volume(new JSONObject()));
            } else if ("POST".equals(method) && "/api/volume".equals(path)) {
                JSONObject req = new JSONObject(new String(body, UTF8));
                if (!pairing.isPaired(req.optString("token"))) {
                    sendJson(out, 401, new JSONObject().put("ok", false));
                    return;
                }
                sendJson(out, 200, volume(req));
            } else if ("GET".equals(method) && "/api/home".equals(path)) {
                if (!pairing.isPaired(param(query, "token"))) {
                    sendJson(out, 401, new JSONObject().put("ok", false));
                    return;
                }
                sendJson(out, 200, homeStatus());
            } else if ("POST".equals(method) && "/api/home".equals(path)) {
                JSONObject req = new JSONObject(new String(body, UTF8));
                if (!pairing.isPaired(req.optString("token"))) {
                    sendJson(out, 401, new JSONObject().put("ok", false));
                    return;
                }
                JSONObject res = new JSONObject().put("ok", true);
                String town = req.optString("town", "").trim();
                if (!town.isEmpty() && !town.equalsIgnoreCase(weather.town())) {
                    try { res.put("found", weather.setTown(town)); } catch (Exception e) { res.put("ok", false).put("error", e.getMessage()); }
                }
                if (req.has("morning")) weather.setMorning(req.optBoolean("morning"), req.optString("morningTime", null));
                if ("test".equals(req.optString("action"))) heating.morning();
                sendJson(out, 200, res.put("status", homeStatus()));
            } else if ("GET".equals(method) && "/api/apps".equals(path)) {
                // Lists what's installed so we can tune config.js. Paired phones only.
                if (!pairing.isPaired(param(query, "token"))) {
                    sendJson(out, 401, new JSONObject().put("ok", false));
                    return;
                }
                StringBuilder list = new StringBuilder();
                for (String app : launcher.installedApps()) list.append(app).append('\n');
                send(out, 200, "text/plain; charset=utf-8", bytes(list.toString()));
            } else {
                send(out, 404, "text/plain", bytes("Not found"));
            }
        } catch (Exception e) {
            Log.w(TAG, "Request failed", e);
        } finally {
            try { client.close(); } catch (IOException ignored) {}
        }
    }

    /** Reads or changes the Sonos volume: {set: 0-100} or {delta: -5} or {mute: true}. */
    private JSONObject volume(JSONObject req) throws Exception {
        try {
            if (req.has("set")) return sonos.setVolume(req.optInt("set"));
            if (req.has("delta")) return sonos.nudge(req.optInt("delta"));
            if (req.has("mute")) return sonos.setMute(req.optBoolean("mute"));
            return sonos.status();
        } catch (Exception e) {
            return new JSONObject().put("found", false).put("error", "Couldn’t reach the Sonos speaker.");
        }
    }

    private JSONObject homeStatus() throws Exception {
        return new JSONObject()
                .put("town", weather.town())
                .put("morning", weather.morningOn())
                .put("morningTime", weather.morningTime());
    }

    private JSONObject tadoStatus() throws Exception {
        return new JSONObject()
                .put("connected", tado.isConnected())
                .put("home", tado.homeName())
                .put("time", tado.reminderTime())
                .put("minTarget", tado.minTarget())
                .put("overApps", heating.canShowOverApps());
    }

    private void serveAsset(OutputStream out, String asset) throws IOException {
        try (InputStream in = context.getAssets().open(asset)) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            send(out, 200, contentType(asset), buf.toByteArray());
        }
    }

    private static String contentType(String name) {
        String n = name.toLowerCase(Locale.UK);
        if (n.endsWith(".html")) return "text/html; charset=utf-8";
        if (n.endsWith(".css")) return "text/css; charset=utf-8";
        if (n.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (n.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private static void sendJson(OutputStream out, int status, JSONObject json) throws IOException {
        send(out, status, "application/json; charset=utf-8", bytes(json.toString()));
    }

    private static void send(OutputStream out, int status, String type, byte[] body) throws IOException {
        String reason = status == 200 ? "OK" : status == 401 ? "Unauthorized" : status == 403 ? "Forbidden"
                : status == 404 ? "Not Found" : status == 413 ? "Payload Too Large" : "Bad Request";
        String head = "HTTP/1.1 " + status + " " + reason + "\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n\r\n";
        out.write(head.getBytes(UTF8));
        out.write(body);
        out.flush();
    }

    private static byte[] bytes(String s) { return s.getBytes(UTF8); }

    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') break;
            if (c != '\r') sb.append((char) c);
            if (sb.length() > 8192) throw new IOException("Line too long");
        }
        return c < 0 && sb.length() == 0 ? null : sb.toString();
    }

    private static String param(String query, String name) {
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && pair.substring(0, eq).equals(name)) {
                try { return URLDecoder.decode(pair.substring(eq + 1), "UTF-8"); } catch (Exception e) { return null; }
            }
        }
        return null;
    }
}
