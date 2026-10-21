package app.hearth.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.util.Log;

/** Hears back from the installer: shows Fire TV's confirm screen, or reports a failure. */
public class UpdateReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                // NO_USER_ACTION: so the home screen guard doesn't pull Hearth back over the install screen.
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
                context.startActivity(confirm);
            }
        } else if (status != PackageInstaller.STATUS_SUCCESS) {
            String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            Log.w("Hearth", "Update failed: " + msg);
            try {
                Remote.deliverIfVisible(new org.json.JSONObject().put("type", "updateFailed")
                        .put("message", msg == null ? "" : msg));
            } catch (Exception ignored) {
            }
        }
    }
}
