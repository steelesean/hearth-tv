package app.hearth.tv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/** Keeps the phone remote listening while other apps (Netflix, iPlayer…) are on screen. */
public class RemoteService extends Service {
    private static final String CHANNEL = "remote";
    private static RemoteService running;

    private Pairing pairing;
    private RemoteServer server;
    private HeatingReminder heating;
    private Thread background;

    static void start(Context context) {
        Intent intent = new Intent(context, RemoteService.class);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
        else context.startService(intent);
    }

    /** Address the phone should open, e.g. 192.168.1.42:8080, or null if not on Wi-Fi yet. */
    static String address() {
        RemoteService s = running;
        String ip = Pairing.localAddress();
        if (s == null || s.server == null || s.server.port() < 0 || ip == null) return null;
        return ip + ":" + s.server.port();
    }

    @Override public void onCreate() {
        super.onCreate();
        running = this;
        pairing = new Pairing(this);
        Tado tado = new Tado(this);
        final Weather weather = new Weather(this);
        final KidCheck kids = new KidCheck(this);
        heating = new HeatingReminder(this, tado, weather);
        heating.start();
        server = new RemoteServer(this, pairing, new AppLauncher(this), tado, heating, weather);
        // Hourly housekeeping: look for updates, check the children's tiles, refresh the weather.
        background = new Thread(new Runnable() {
            @Override public void run() {
                while (!Thread.currentThread().isInterrupted()) {
                    try {
                        if (Updater.check(RemoteService.this) != null) {
                            Remote.deliverIfVisible(new org.json.JSONObject().put("type", "updateReady"));
                        }
                        kids.checkIfDue();
                        weather.today();
                        Thread.sleep(3600 * 1000L);
                    } catch (InterruptedException e) {
                        return;
                    } catch (Exception ignored) {
                    }
                }
            }
        }, "hearth-housekeeping");
        background.setDaemon(true);
        background.start();
        server.start();
        startForeground(1, buildNotification());
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(1, buildNotification());
        return START_STICKY;
    }

    @Override public void onDestroy() {
        if (server != null) server.stop();
        if (heating != null) heating.stop();
        if (background != null) background.interrupt();
        running = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private Notification buildNotification() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Phone remote", NotificationManager.IMPORTANCE_MIN));
            b = new Notification.Builder(this, CHANNEL);
        } else {
            b = new Notification.Builder(this).setPriority(Notification.PRIORITY_MIN);
        }
        return b.setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("Hearth")
                .setContentText("Phone remote is ready")
                .build();
    }
}
