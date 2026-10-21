package app.hearth.tv;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * At the chosen time each evening, checks Tado and, if any room is still heating, slides a
 * small card in at the top right of the screen, over whatever is playing, for 20 seconds.
 */
final class HeatingReminder {
    private static final String TAG = "Hearth";
    private static final long SHOW_FOR_MS = 20000;

    private final Context context;
    private final Tado tado;
    private final Weather weather;
    private final Handler main = new Handler(Looper.getMainLooper());
    private String firedOn = "";
    private String morningOn = "";
    private View card;

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            String now = new SimpleDateFormat("HH:mm", Locale.UK).format(new Date());
            String today = new SimpleDateFormat("yyyy-MM-dd", Locale.UK).format(new Date());
            boolean evening = tado.isConnected() || !weather.town().isEmpty();
            if (evening && now.equals(tado.reminderTime()) && !today.equals(firedOn)) {
                firedOn = today;
                check(false);
            }
            if (weather.morningOn() && !weather.town().isEmpty() && now.equals(weather.morningTime()) && !today.equals(morningOn)) {
                morningOn = today;
                morning();
            }
            main.postDelayed(this, 30000);
        }
    };

    /** Lines like "Slow Horses  new on Wednesday" for episodes worth mentioning this morning. */
    private String episodeLines() {
        try {
            JSONObject w = new JSONObject(context.getSharedPreferences("assistant", Context.MODE_PRIVATE).getString("watching", "{}"));
            org.json.JSONArray shows = w.optJSONArray("shows");
            if (shows == null) return "";
            java.util.Calendar today = java.util.Calendar.getInstance();
            boolean monday = today.get(java.util.Calendar.DAY_OF_WEEK) == java.util.Calendar.MONDAY;
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd", Locale.UK);
            SimpleDateFormat day = new SimpleDateFormat("EEEE", Locale.UK);
            long start = iso.parse(iso.format(today.getTime())).getTime();
            StringBuilder out = new StringBuilder();
            for (int i = 0; i < shows.length(); i++) {
                JSONObject sh = shows.getJSONObject(i);
                String date = sh.optString("date");
                if (date.isEmpty()) continue;
                Date d = iso.parse(date);
                long days = Math.round((d.getTime() - start) / 86400000.0);
                // Monday: the week ahead. Other days: only today and tomorrow.
                if (days < 0 || days > (monday ? 6 : 1)) continue;
                String when = days == 0 ? "new today" : days == 1 ? "new tomorrow" : "new on " + day.format(d);
                if (sh.optBoolean("usDate")) when = when.replace("new", "in the US");
                out.append("\n").append(sh.optString("title")).append(": ").append(when);
            }
            return out.toString();
        } catch (Exception e) {
            return "";
        }
    }

    HeatingReminder(Context context, Tado tado, Weather weather) {
        this.context = context.getApplicationContext();
        this.tado = tado;
        this.weather = weather;
    }

    /** The morning card: today's weather, and any rooms already heating. */
    void morning() {
        new Thread(new Runnable() {
            @Override public void run() {
                JSONObject w = weather.today();
                if (w == null) return;
                StringBuilder body = new StringBuilder(String.format(Locale.UK, "%d° and %s now. High of %d°, low of %d°.",
                        w.optInt("now"), w.optString("desc").toLowerCase(Locale.UK), w.optInt("high"), w.optInt("low")));
                if (w.optInt("rain") >= 50) body.append(String.format(Locale.UK, "\n%d%% chance of rain today.", w.optInt("rain")));
                if (w.optInt("low") <= 0) body.append("\nFrosty this morning.");
                body.append(episodeLines());
                final String b = body.toString();
                main.post(new Runnable() { @Override public void run() { show("GOOD MORNING", "Today", b); } });
            }
        }, "hearth-morning").start();
    }

    void start() { main.post(tick); }

    void stop() { main.removeCallbacks(tick); hide(); }

    /** Whether Fire TV lets Hearth draw over other apps (switched on once from a computer). */
    boolean canShowOverApps() {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context);
    }

    /** Checks the rooms now. A test always shows the card, even when nothing is heating. */
    void check(final boolean test) {
        new Thread(new Runnable() {
            @Override public void run() {
                String title;
                String body;
                JSONObject w = weather.today();
                String frost = (w != null && w.optBoolean("frost"))
                        ? String.format(Locale.UK, "Frost tonight, down to %d°.", w.optInt("tonightLow")) : null;
                if (!tado.isConnected()) {
                    if (frost == null) return;
                    final String f = frost;
                    main.post(new Runnable() { @Override public void run() { show("TONIGHT", "Frost tonight", f); } });
                    return;
                }
                try {
                    List<Tado.Room> rooms = tado.heatingRooms();
                    if (rooms.isEmpty() && !test) {
                        if (frost == null) return;
                        final String f = frost + "\nNo rooms are left on.";
                        main.post(new Runnable() { @Override public void run() { show("TONIGHT", "Frost tonight", f); } });
                        return;
                    }
                    if (rooms.isEmpty()) {
                        // A test shows every room, so we can see what Tado reports.
                        List<Tado.Room> all = tado.allRooms();
                        title = String.format(Locale.UK, "No rooms left on (set to %.0f° or more)", tado.minTarget());
                        StringBuilder sb = new StringBuilder();
                        for (Tado.Room r : all) sb.append(sb.length() == 0 ? "" : "\n").append(Tado.describe(r));
                        body = all.isEmpty() ? "Tado didn’t list any rooms. " + tado.lastReport : sb.toString();
                    } else {
                        title = rooms.size() == 1 ? "1 room still on" : rooms.size() + " rooms still on";
                        StringBuilder sb = new StringBuilder();
                        for (Tado.Room r : rooms) sb.append(sb.length() == 0 ? "" : "\n").append(Tado.describe(r));
                        body = sb.toString();
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Tado check failed", e);
                    if (!test) return;
                    title = "Couldn’t reach Tado";
                    body = "Check the stick is online, or reconnect Tado from your phone. (" + e.getMessage() + ")";
                }
                if (frost != null) body = body + "\n" + frost;
                final String t = title, b = body;
                main.post(new Runnable() { @Override public void run() { show("BEDTIME CHECK", t, b); } });
            }
        }, "hearth-tado").start();
    }

    private void show(String eyebrowText, String title, String body) {
        if (!canShowOverApps()) {
            // Without permission, the card can only appear when Hearth itself is on screen.
            try {
                Remote.deliverIfVisible(new JSONObject().put("type", "heating").put("title", title).put("body", body.replace("\n", " · ")));
            } catch (Exception ignored) {
            }
            return;
        }
        hide();
        final WindowManager wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.END;
        lp.x = dp(32);
        lp.y = dp(28);

        final View view = buildCard(eyebrowText, title, body);
        view.setAlpha(0f);
        try {
            wm.addView(view, lp);
        } catch (Exception e) {
            Log.w(TAG, "Couldn't show the heating card", e);
            return;
        }
        card = view;
        view.post(new Runnable() {
            @Override public void run() {
                view.setTranslationX(view.getWidth() + dp(40));
                view.setAlpha(1f);
                view.animate().translationX(0).setDuration(450).start();
            }
        });
        main.postDelayed(new Runnable() {
            @Override public void run() {
                if (card != view) return;
                view.animate().translationX(view.getWidth() + dp(40)).alpha(0f).setDuration(400)
                        .withEndAction(new Runnable() { @Override public void run() { hide(); } }).start();
            }
        }, SHOW_FOR_MS);
    }

    private void hide() {
        if (card == null) return;
        try {
            ((WindowManager) context.getSystemService(Context.WINDOW_SERVICE)).removeView(card);
        } catch (Exception ignored) {
        }
        card = null;
    }

    /** The card: Hearth's stone surface, ink text, one moss accent. */
    private View buildCard(String eyebrowText, String title, String body) {
        LinearLayout box = new LinearLayout(context);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(20), dp(16), dp(22), dp(18));
        box.setMinimumWidth(dp(240));
        // From 8pm to 7am, the evening palette, so the card doesn't flash white over a dark scene.
        boolean evening = Weather.eveningNow(context);
        String surface = evening ? "#2E312C" : "#F7F6F3";
        String ink = evening ? "#E7E5DF" : "#1F2321";
        String soft = evening ? "#A2A69E" : "#6B706C";
        String accent = evening ? "#A9C7B6" : "#2F4A3F";
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor(surface));
        bg.setCornerRadius(dp(16));
        bg.setStroke(dp(2), Color.parseColor(accent));
        box.setBackground(bg);

        TextView eyebrow = text(eyebrowText, 11, soft, true);
        eyebrow.setLetterSpacing(0.12f);
        TextView head = text(title, 18, ink, true);
        head.setPadding(0, dp(4), 0, dp(6));
        TextView rooms = text(body, 15, ink, false);
        rooms.setLineSpacing(dp(3), 1f);
        box.addView(eyebrow);
        box.addView(head);
        box.addView(rooms);
        return box;
    }

    private TextView text(String s, int sp, String color, boolean bold) {
        TextView t = new TextView(context);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(Color.parseColor(color));
        if (bold) t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        return t;
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, context.getResources().getDisplayMetrics()));
    }
}
