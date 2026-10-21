package app.hearth.tv;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Small HTTP GET helper for the public services Hearth reads (GitHub, weather, iPlayer). */
final class Net {
    private Net() {}

    static String get(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(8000);
            c.setReadTimeout(15000);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", "Hearth-TV");
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            String body = in == null ? "" : read(in);
            if (status >= 400) throw new Exception("HTTP " + status);
            return body;
        } finally {
            c.disconnect();
        }
    }

    static String read(InputStream in) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        in.close();
        return buf.toString("UTF-8");
    }
}
