package app.hearth.tv;

import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Hands commands from the phone to the TV screen, bringing it to the front when needed. */
final class Remote {
    private static MainActivity screen;
    private static boolean visible;
    private static final List<JSONObject> pending = new ArrayList<>();

    private Remote() {}

    static synchronized void attach(MainActivity activity) { screen = activity; }

    static synchronized void detach(MainActivity activity) { if (screen == activity) screen = null; }

    static synchronized void setVisible(boolean on) {
        visible = on;
        if (on) flush();
    }

    static synchronized void flush() {
        if (screen == null || !visible || !screen.isReady()) return;
        for (JSONObject cmd : pending) screen.runCommand(cmd);
        pending.clear();
    }

    /**
     * Returns false when the TV is showing another app and the command can't reach it
     * (arrow keys inside Netflix, say). Anything else brings our screen back first.
     */
    static synchronized boolean deliver(Context context, JSONObject cmd) {
        String type = cmd.optString("type");
        String value = cmd.optString("value");
        boolean isKey = "key".equals(type) && !"home".equals(value);
        if (screen != null && visible && screen.isReady()) {
            screen.runCommand(cmd);
            return true;
        }
        if ("paired".equals(type)) {
            pending.add(cmd);
            return true;
        }
        if (isKey) return false;
        pending.add(cmd);
        bringToFront(context);
        return true;
    }

    /** Shows something on the Hearth page only if it's on screen right now; otherwise drops it. */
    static synchronized void deliverIfVisible(JSONObject cmd) {
        if (screen != null && visible && screen.isReady()) screen.runCommand(cmd);
    }

    static void bringToFront(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        context.startActivity(intent);
    }
}
