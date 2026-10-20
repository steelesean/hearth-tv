package app.hearth.tv;

import android.content.Context;
import android.content.SharedPreferences;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/** The four-digit code shown on the TV, and the phones that have entered it. */
final class Pairing {
    private static final String PREFS = "pairing";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final SharedPreferences prefs;

    Pairing(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!prefs.contains("code")) {
            prefs.edit().putString("code", String.format("%04d", RANDOM.nextInt(10000))).apply();
        }
    }

    String code() {
        return prefs.getString("code", "0000");
    }

    boolean hasPhones() {
        return !tokens().isEmpty();
    }

    /** Returns a new token if the code matches, otherwise null. */
    synchronized String pair(String code) {
        if (code == null || !code.trim().equals(code())) return null;
        byte[] bytes = new byte[18];
        RANDOM.nextBytes(bytes);
        StringBuilder token = new StringBuilder();
        for (byte b : bytes) token.append(String.format("%02x", b));
        Set<String> next = new HashSet<>(tokens());
        next.add(token.toString());
        prefs.edit().putStringSet("tokens", next).apply();
        return token.toString();
    }

    boolean isPaired(String token) {
        return token != null && tokens().contains(token);
    }

    private Set<String> tokens() {
        return prefs.getStringSet("tokens", Collections.<String>emptySet());
    }

    /** The TV's address on the home network, e.g. 192.168.1.42, or null if not on Wi-Fi. */
    static String localAddress() {
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback()) continue;
                for (InetAddress addr : Collections.list(nif.getInetAddresses())) {
                    if (addr instanceof Inet4Address && addr.isSiteLocalAddress()) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }
}
