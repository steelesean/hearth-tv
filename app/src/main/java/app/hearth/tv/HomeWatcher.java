package app.hearth.tv;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.view.accessibility.AccessibilityEvent;

/**
 * Makes Hearth the home screen. Fire TV won't let another app take over the Home button, so
 * this watches for Amazon's home screen appearing (after Home, waking the TV, or a restart)
 * and switches straight to Hearth.
 *
 * Escape hatch: press Home twice within a few seconds to stay on Amazon's home for two
 * minutes, for its settings, app store or search.
 *
 * Switched on once from a computer:
 *   adb shell settings put secure enabled_accessibility_services app.hearth.tv/app.hearth.tv.HomeWatcher
 *   adb shell settings put secure accessibility_enabled 1
 */
public class HomeWatcher extends AccessibilityService {
    private static final String AMAZON_HOME = "com.amazon.tv.launcher";
    private static final long DOUBLE_PRESS_MS = 4000;
    private static final long STAY_MS = 2 * 60 * 1000;

    private long lastSwitch;
    private long stayUntil;

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        if (event.getPackageName() == null || !AMAZON_HOME.contentEquals(event.getPackageName())) return;
        long now = System.currentTimeMillis();
        if (now < stayUntil) return;
        if (now - lastSwitch < DOUBLE_PRESS_MS) {
            // Amazon's home came back straight after we left it: they pressed Home again.
            stayUntil = now + STAY_MS;
            return;
        }
        lastSwitch = now;
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        startActivity(open);
    }

    @Override public void onInterrupt() {}
}
