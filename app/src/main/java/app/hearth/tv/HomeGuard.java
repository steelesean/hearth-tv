package app.hearth.tv;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.util.Log;

/**
 * Makes Hearth the home screen. Fire TV keeps Home and the wake-up screen for Amazon's own
 * launcher, and clears accessibility helpers it hasn't approved, so instead:
 *
 * 1. When the screen turns on, Hearth comes to the front.
 * 2. Once a second, Hearth checks which app is in front (usage access, granted once with
 *    adb) and switches back if it's Amazon's home.
 *
 * Press Home twice within a few seconds to stay on Amazon's home for two minutes.
 *
 *   adb shell appops set app.hearth.tv GET_USAGE_STATS allow
 */
final class HomeGuard {
    private static final String AMAZON_HOME = "com.amazon.tv.launcher";
    private static final long DOUBLE_PRESS_MS = 4000;
    private static final long STAY_MS = 2 * 60 * 1000;

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private long lastSwitch;
    private long stayUntil;
    private long lastChecked;
    private String front = "";
    private boolean warned;

    private final BroadcastReceiver screenOn = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent intent) {
            stayUntil = 0;
            main.postDelayed(new Runnable() { @Override public void run() { openHearth(); } }, 1500);
        }
    };

    private final Runnable poll = new Runnable() {
        @Override public void run() {
            check();
            main.postDelayed(this, 1000);
        }
    };

    HomeGuard(Context context) {
        this.context = context.getApplicationContext();
    }

    void start() {
        Log.i("HearthHome", "Watching for Amazon's home (usage access: " + canWatch() + ")");
        context.registerReceiver(screenOn, new IntentFilter(Intent.ACTION_SCREEN_ON));
        lastChecked = System.currentTimeMillis() - 5000;
        main.post(poll);
    }

    void stop() {
        try { context.unregisterReceiver(screenOn); } catch (Exception ignored) { }
        main.removeCallbacks(poll);
    }

    /** Whether usage access has been granted, so Home can be caught. */
    boolean canWatch() {
        AppOpsManager ops = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        return ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.getPackageName())
                == AppOpsManager.MODE_ALLOWED;
    }

    private void check() {
        if (!canWatch()) {
            if (!warned) Log.w("HearthHome", "No usage access, so Home can't be caught");
            warned = true;
            return;
        }
        UsageStatsManager usm = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
        long now = System.currentTimeMillis();
        UsageEvents events = usm.queryEvents(lastChecked, now);
        lastChecked = now;
        UsageEvents.Event e = new UsageEvents.Event();
        String newFront = null;
        while (events.hasNextEvent()) {
            events.getNextEvent(e);
            if (e.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND) newFront = e.getPackageName();
        }
        if (newFront == null || newFront.equals(front)) return;
        front = newFront;
        Log.i("HearthHome", "In front: " + newFront);
        if (!AMAZON_HOME.equals(newFront) || now < stayUntil) return;
        if (now - lastSwitch < DOUBLE_PRESS_MS) {
            // Amazon's home came back straight after we left it: they pressed Home again.
            stayUntil = now + STAY_MS;
            Log.i("HearthHome", "Home pressed twice: staying on Amazon's home");
            return;
        }
        openHearth();
    }

    private void openHearth() {
        if (System.currentTimeMillis() < stayUntil) return;
        lastSwitch = System.currentTimeMillis();
        front = context.getPackageName();
        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try {
            context.startActivity(open);
            Log.i("HearthHome", "Switched to Hearth");
        } catch (Exception e) {
            Log.w("HearthHome", "Couldn't switch to Hearth", e);
        }
    }
}
