package app.hearth.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Opens the home screen when the stick starts up. */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        RemoteService.start(context);
        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(open);
    }
}
