package app.muchi.music;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * MUCHI native background audio bridge (JS ↔ {@link MuchiAudioService}).
 *
 * JS API:
 *   play({url,title,artist,artwork,duration})  duration in ms
 *   pause()  resume()  stop()
 *   seekTo({position})                          ms
 *   emit({action,...})                          simple action passthrough
 *   checkNotificationPermission()
 *   requestNotificationPermission()
 *
 * Events emitted to JS:
 *   muchiControls  {message: play|pause|next|previous|seek|ended|error|stop, position}
 *   muchiProgress  {positionMs, durationMs, playing}
 */
@CapacitorPlugin(
        name = "MuchiAudio",
        permissions = {
                @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications"),
                @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "muchi_audio")
        }
)
public class MuchiAudioPlugin extends Plugin implements MuchiAudioService.PluginListener {

    public static final String NOTIFICATIONS_ALIAS = "notifications";
    private static final long BIND_TIMEOUT_MS = 8000;

    @Override
    public void load() {
        super.load();
        ensureService(null);
    }

    private MuchiAudioService.LocalBinder service;
    private boolean bound = false;

    // Controls that arrive before the service is bound are replayed in order
    // on onServiceConnected so none is dropped when the user taps quickly.
    private final ConcurrentLinkedQueue<Runnable> pending = new ConcurrentLinkedQueue<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private PluginCall pendingPlay;
    private long pendingPlayAt = 0L;
    private Runnable bindTimeout;
    private volatile boolean playTimedOut = false;

    private final ServiceConnection conn = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder ibinder) {
            service = (MuchiAudioService.LocalBinder) ibinder;
            service.setListener(MuchiAudioPlugin.this);
            bound = true;
            // Flush any queued controls in arrival order.
            Runnable r;
            while ((r = pending.poll()) != null) {
                try { r.run(); } catch (Exception ignored) {}
            }
            // Resolve a play() that was waiting on the bind.
            if (pendingPlay != null) {
                PluginCall pc = pendingPlay;
                pendingPlay = null;
                main.removeCallbacks(bindTimeout);
                pc.resolve();
            } else if (playTimedOut) {
                playTimedOut = false;
                try { service.stopAll(); } catch (Exception ignored) {}
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            service = null;
            bound = false;
        }
    };

    @Override
    protected void handleOnDestroy() {
        main.removeCallbacks(bindTimeout);
        if (bindTimeout != null) main.removeCallbacks(bindTimeout);
        if (pendingPlay != null) {
            PluginCall pc = pendingPlay;
            pendingPlay = null;
            try { pc.resolve(); } catch (Exception ignored) {}
        }
        if (service != null) {
            try {
                service.setListener(null);
            } catch (Exception ignored) {}
        }
        if (bound) {
            try {
                getContext().unbindService(conn);
            } catch (Exception ignored) {}
            bound = false;
        }
        service = null;
        pending.clear();
    }

    private void ensureService(Runnable onBound) {
        if (service != null) {
            if (onBound != null) onBound.run();
            return;
        }
        if (onBound != null) pending.offer(onBound);
        if (bound) return;
        try {
            getContext().bindService(new Intent(getContext(), MuchiAudioService.class), conn, Context.BIND_AUTO_CREATE);
        } catch (Exception ignored) {
            pending.clear();
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

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url", "");
        if (url.isEmpty()) {
            call.reject("MuchiAudio: missing url");
            return;
        }
        Intent i = new Intent(getContext(), MuchiAudioService.class);
        i.setAction(MuchiAudioService.ACTION_PLAY);
        i.putExtra(MuchiAudioService.EXTRA_URL, url);
        i.putExtra(MuchiAudioService.EXTRA_TITLE, call.getString("title", "Muchi"));
        i.putExtra(MuchiAudioService.EXTRA_ARTIST, call.getString("artist", ""));
        i.putExtra(MuchiAudioService.EXTRA_ARTWORK, call.getString("artwork", ""));
        i.putExtra(MuchiAudioService.EXTRA_DURATION_MS, call.getLong("duration", 0L));

        // Always ensure the Foreground Service is started so its lifecycle is not
        // tied solely to activity binding. Background playback continues when swiped away.
        startService(i);

        if (service != null) {
            try {
                service.playIntent(i);
                call.resolve();
                return;
            } catch (Exception ignored) {
                service = null; // binder dead — fall through to the cold path
            }
        }

        // Resolve once the service connects; reject on timeout so web falls back.
        pendingPlay = call;
        pendingPlayAt = System.currentTimeMillis();
        playTimedOut = false;
        ensureService(null);
        if (bindTimeout != null) main.removeCallbacks(bindTimeout);
        bindTimeout = new Runnable() {
            @Override
            public void run() {
                bindTimeout = null;
                if (pendingPlay != null) {
                    PluginCall pc = pendingPlay;
                    pendingPlay = null;
                    playTimedOut = true;
                    try { pc.reject("muchi audio service did not connect"); } catch (Exception ignored) {}
                }
            }
        };
        main.postDelayed(bindTimeout, BIND_TIMEOUT_MS);
    }

    @PluginMethod
    public void pause(PluginCall call) {
        ensureService(() -> { if (service != null) service.pausePlayback(); });
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        Intent i = new Intent(getContext(), MuchiAudioService.class);
        i.setAction(MuchiAudioService.ACTION_PLAY);
        startService(i);
        ensureService(() -> { if (service != null) service.resumePlayback(); });
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        doStop();
        call.resolve();
    }

    private void doStop() {
        if (service != null) {
            service.stopAll();
        } else {
            Intent i = new Intent(getContext(), MuchiAudioService.class);
            i.setAction(MuchiAudioService.ACTION_STOP);
            startService(i);
        }
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        long position = call.getLong("position", 0L);
        ensureService(() -> { if (service != null) service.seekToPlayback(position); });
        call.resolve();
    }

    @PluginMethod
    public void emit(PluginCall call) {
        String action = call.getString("action", "");
        if ("stop".equals(action)) doStop();
        call.resolve();
    }

    @PluginMethod
    public void checkNotificationPermission(PluginCall call) {
        boolean granted = true;
        if (Build.VERSION.SDK_INT >= 33) {
            granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias(NOTIFICATIONS_ALIAS, call, "notificationPermCallback");
    }

    @PermissionCallback
    private void notificationPermCallback(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT < 33 ||
                ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
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
