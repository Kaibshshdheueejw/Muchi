package app.muchi.music;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.IBinder;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * MUCHI native background audio bridge (JS ↔ {@link MuchiAudioService}).
 *
 * JS API (public/app.js already drives it — see the nativePlayer() block):
 *   play({url,title,artist,artwork,duration})  duration in ms
 *   pause()  resume()  stop()
 *   seekTo({position})                          ms
 *   emit({action,...})                          simple action passthrough
 *
 * Events emitted to JS:
 *   muchiControls  {message: play|pause|next|previous|seek|ended|error|stop, position}
 *   muchiProgress  {positionMs, durationMs, playing}
 */
@CapacitorPlugin(name = "MuchiAudio")
public class MuchiAudioPlugin extends Plugin implements MuchiAudioService.PluginListener {

    private MuchiAudioService.LocalBinder service;
    private boolean bound = false;

    private final ServiceConnection conn = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder ibinder) {
            service = (MuchiAudioService.LocalBinder) ibinder;
            service.setListener(MuchiAudioPlugin.this);
            bound = true;
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            service = null;
            bound = false;
        }
    };

    @Override
    protected void handleOnDestroy() {
        // Do NOT stop the service here — background playback surviving the
        // WebView is the whole point. The web layer calls stop() explicitly.
        if (bound) {
            try {
                unbindService(conn);
            } catch (Exception ignored) {
            }
            bound = false;
        }
        service = null;
    }

    private void ensureService() {
        if (service == null && !bound) {
            try {
                bindService(new Intent(getContext(), MuchiAudioService.class), conn, 0);
            } catch (Exception ignored) {
            }
        }
    }

    private void startService(Intent i) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                ctx.startForegroundService(i);
                return;
            } catch (Exception ignored) {
            }
        }
        try {
            ctx.startService(i);
        } catch (Exception ignored) {
        }
    }

    private void ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            requestPermissionsForResource(
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    "MUCHI uses a media notification for background playback and lock-screen controls.");
        }
    }

    @PluginMethod(returnsByValue = false)
    public void play(PluginCall call) {
        String url = call.getString("url", "");
        if (url.isEmpty()) {
            call.reject("MuchiAudio: missing url");
            return;
        }
        ensureNotificationPermission();
        Intent i = new Intent(getContext(), MuchiAudioService.class);
        i.setAction(MuchiAudioService.ACTION_PLAY);
        i.putExtra(MuchiAudioService.EXTRA_URL, url);
        i.putExtra(MuchiAudioService.EXTRA_TITLE, call.getString("title", "Muchi"));
        i.putExtra(MuchiAudioService.EXTRA_ARTIST, call.getString("artist", ""));
        i.putExtra(MuchiAudioService.EXTRA_ARTWORK, call.getString("artwork", ""));
        i.putExtra(MuchiAudioService.EXTRA_DURATION_MS, call.getLong("duration", 0L));
        startService(i);
        ensureService();
        call.resolve();
    }

    @PluginMethod(returnsByValue = false)
    public void pause(PluginCall call) {
        ensureService();
        if (service != null) service.pausePlayback();
        call.resolve();
    }

    @PluginMethod(returnsByValue = false)
    public void resume(PluginCall call) {
        ensureService();
        if (service != null) service.resumePlayback();
        call.resolve();
    }

    @PluginMethod(returnsByValue = false)
    public void stop(PluginCall call) {
        doStop();
        call.resolve();
    }

    private void doStop() {
        if (service != null) {
            service.stopAll();
        } else {
            // Service was never started (or died) — start it in stop-mode.
            Intent i = new Intent(getContext(), MuchiAudioService.class);
            i.setAction(MuchiAudioService.ACTION_STOP);
            startService(i);
        }
    }

    @PluginMethod(returnsByValue = false)
    public void seekTo(PluginCall call) {
        long position = call.getLong("position", 0L);
        ensureService();
        if (service != null) service.seekToPlayback(position);
        call.resolve();
    }

    @PluginMethod(returnsByValue = false)
    public void emit(PluginCall call) {
        // Simple action passthrough from the web layer.
        String action = call.getString("action", "");
        if ("stop".equals(action)) doStop();
        call.resolve();
    }

    /* ── service → web ─────────────────────────────────────────────── */

    @Override
    public void onControls(String message, long positionMs) {
        JSObject data = new JSObject();
        data.put("message", message);
        data.put("position", positionMs);
        notifyListeners("muchiControls", data);
    }

    @Override
    public void onProgress(long positionMs, long durationMs, boolean playing) {
        JSObject data = new JSObject();
        data.put("positionMs", positionMs);
        data.put("durationMs", durationMs);
        data.put("playing", playing);
        notifyListeners("muchiProgress", data);
    }
}
