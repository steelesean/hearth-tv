package app.hearth.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.wifi.WifiManager;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Controls the Sonos speaker's volume over the home Wi-Fi, using Sonos's local control
 * interface (UPnP on port 1400). Finds the speaker by itself, preferring a Beam or other
 * soundbar, and remembers its address.
 */
final class Sonos {
    private static final String TAG = "Hearth";
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final String RC = "urn:schemas-upnp-org:service:RenderingControl:1";

    private final Context context;
    private final SharedPreferences prefs;

    Sonos(Context context) {
        this.context = context.getApplicationContext();
        prefs = context.getSharedPreferences("sonos", Context.MODE_PRIVATE);
    }

    String room() { return prefs.getString("room", ""); }

    /** {found, room, volume, muted}. Finds the speaker first if needed. Blocking. */
    synchronized JSONObject status() throws Exception {
        if (!ensureSpeaker()) return new JSONObject().put("found", false);
        try {
            return read();
        } catch (Exception e) {
            // The speaker may have a new address; look again once.
            prefs.edit().remove("ip").apply();
            if (!ensureSpeaker()) return new JSONObject().put("found", false);
            return read();
        }
    }

    synchronized JSONObject setVolume(int level) throws Exception {
        if (!ensureSpeaker()) return new JSONObject().put("found", false);
        int v = Math.max(0, Math.min(100, level));
        soap("SetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>" + v + "</DesiredVolume>");
        return read();
    }

    synchronized JSONObject nudge(int delta) throws Exception {
        if (!ensureSpeaker()) return new JSONObject().put("found", false);
        soap("SetRelativeVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel><Adjustment>" + delta + "</Adjustment>");
        return read();
    }

    synchronized JSONObject setMute(boolean mute) throws Exception {
        if (!ensureSpeaker()) return new JSONObject().put("found", false);
        soap("SetMute", "<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>" + (mute ? 1 : 0) + "</DesiredMute>");
        return read();
    }

    private JSONObject read() throws Exception {
        String v = soap("GetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel>");
        String m = soap("GetMute", "<InstanceID>0</InstanceID><Channel>Master</Channel>");
        return new JSONObject()
                .put("found", true)
                .put("room", room())
                .put("volume", Integer.parseInt(tag(v, "CurrentVolume", "0")))
                .put("muted", "1".equals(tag(m, "CurrentMute", "0")));
    }

    // ---------- Finding the speaker ----------

    private boolean ensureSpeaker() {
        if (!prefs.getString("ip", "").isEmpty()) return true;
        try {
            discover();
        } catch (Exception e) {
            Log.w(TAG, "Sonos discovery failed", e);
        }
        return !prefs.getString("ip", "").isEmpty();
    }

    /** Asks the network who's a Sonos speaker, then picks the soundbar if there is one. */
    private void discover() throws Exception {
        WifiManager wifi = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
        WifiManager.MulticastLock lock = wifi.createMulticastLock("hearth-sonos");
        lock.acquire();
        DatagramSocket socket = new DatagramSocket();
        try {
            socket.setSoTimeout(1500);
            String search = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\n"
                    + "ST: urn:schemas-upnp-org:device:ZonePlayer:1\r\n\r\n";
            byte[] msg = search.getBytes(UTF8);
            InetAddress group = InetAddress.getByName("239.255.255.250");
            for (int i = 0; i < 2; i++) socket.send(new DatagramPacket(msg, msg.length, group, 1900));

            String bestIp = null, bestRoom = null;
            int bestScore = -1;
            long until = System.currentTimeMillis() + 3000;
            byte[] buf = new byte[2048];
            while (System.currentTimeMillis() < until) {
                DatagramPacket reply = new DatagramPacket(buf, buf.length);
                try { socket.receive(reply); } catch (SocketTimeoutException e) { break; }
                String text = new String(reply.getData(), 0, reply.getLength(), UTF8);
                Matcher loc = Pattern.compile("(?i)LOCATION:\\s*(http://([0-9.]+):1400/\\S+)").matcher(text);
                if (!loc.find()) continue;
                String ip = loc.group(2);
                String desc;
                try { desc = Net.get(loc.group(1)); } catch (Exception e) { continue; }
                String model = tag(desc, "modelName", "");
                String room = tag(desc, "roomName", "Sonos");
                // A soundbar is almost certainly the TV's speaker.
                int score = model.matches("(?i).*(beam|arc|ray|playbar|playbase|amp).*") ? 2 : 1;
                if (score > bestScore) { bestScore = score; bestIp = ip; bestRoom = room; }
            }
            if (bestIp != null) prefs.edit().putString("ip", bestIp).putString("room", bestRoom).apply();
        } finally {
            socket.close();
            lock.release();
        }
    }

    // ---------- Talking to it ----------

    private String soap(String action, String args) throws Exception {
        String body = "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
                + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
                + "<s:Body><u:" + action + " xmlns:u=\"" + RC + "\">" + args + "</u:" + action + "></s:Body></s:Envelope>";
        HttpURLConnection c = (HttpURLConnection) new URL("http://" + prefs.getString("ip", "")
                + ":1400/MediaRenderer/RenderingControl/Control").openConnection();
        try {
            c.setConnectTimeout(3000);
            c.setReadTimeout(5000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"");
            c.setRequestProperty("SOAPACTION", "\"" + RC + "#" + action + "\"");
            try (OutputStream out = c.getOutputStream()) { out.write(body.getBytes(UTF8)); }
            int status = c.getResponseCode();
            if (status >= 400) throw new Exception("Sonos said " + status);
            return Net.read(c.getInputStream());
        } finally {
            c.disconnect();
        }
    }

    private static String tag(String xml, String name, String fallback) {
        Matcher m = Pattern.compile("<" + name + ">([^<]*)</" + name + ">").matcher(xml);
        return m.find() ? m.group(1) : fallback;
    }
}
