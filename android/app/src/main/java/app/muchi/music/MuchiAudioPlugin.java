package app.muchi.music;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.util.concurrent.ConcurrentLinkedQueue;

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
 *
 * The service binds asynchronously (ServiceConnection). Before it is bound,
 * controls (pause/resume/seek/stop) used to silently no-op — the UI called
 * them while the WebView was still connecting, and the taps did nothing, so
 * playback "stopped" from the user's point of view. Now every control is
 * buffered and replayed as soon as the service connects, so no tap is ever
 * dropped. play() also blocks resolution until the service bound AND started
 * playing, so the web layer can fall back to the WebView <audio> element if
 * the native path could not come up at all.
 *
 * POST_NOTIFICATIONS (Android 13+): declared on @CapacitorPlugin below. The
 * web layer asks once via MuchiAudio.checkPermissions()/requestPermissions()
 * before first play — playback is never blocked on the dialog.
 */
@CapacitorPlugin(
        name = "MuchiAudio",
        permissions = @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "muchi_audio")
)
public class MuchiAudioPlugin extends Plugin implements MuchiAudioService.PluginListener {

    /** Permission alias — JS asks via MuchiAudio.checkPermissions()/requestPermissions(). */
    public static final String MUCHI_AUDIO_NOTIFICATION = "muchi_audio";

    private static final long BIND_TIMEOUT_MS = 4000;

    private MuchiAudioService.LocalBinder service;
    private boolean bound = false;

    // Controls that arrive before the service is bound are replayed in order
    // on onServiceConnected so none is dropped when the user taps quickly.
    private final ConcurrentLinkedQueue<Runnable> pending = new ConcurrentLinkedQueue<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    // When set, the next onServiceConnected resolves this pending play call.
    private PluginCall pendingPlay;
    private long pendingPlayAt = 0L;
    private Runnable bindTimeout;
    // Set when a pendingPlay was rejected by the bind timeout: the web layer
    // has already fallen back to the <audio> sink. If the service connection
    // then arrives late, stop native playback so we don't double-play.
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
                // Late bind after play() already rejected: the WebView is the
                // active sink now — make sure the service doesn't also play.
                // (The "stop" echo this emits is ignored by the web layer.)
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
        // Do NOT stop the service here — background playback surviving the
        // WebView is the whole point. The web layer calls stop() explicitly.
        main.removeCallbacks(bindTimeout);
        if (bindTimeout != null) main.removeCallbacks(bindTimeout);
        if (pendingPlay != null) {
            PluginCall pc = pendingPlay;
            pendingPlay = null;
            try { pc.resolve(); } catch (Exception ignored) {}
        }
        if (bound) {
            try {
                getContext().unbindService(conn);
            } catch (Exception ignored) {
            }
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
            // Bind failed — drop any queued control so it doesn't hang.
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

        if (service != null) {
            // Bound (the normal case while the app is up): hand the track to
            // the LIVE service through the binder. This deliberately avoids a
            // startForegroundService round-trip — on Android 12+ a fresh FGS
            // start is restricted while the app is backgrounded (e.g. auto-next
            // from the notification with the screen off), but the already
            // foreground service can always take new work.
            try {
                service.playIntent(i);
                call.resolve();
                return;
            } catch (Exception ignored) {
                service = null; // binder dead — fall through to the cold path
            }
        }
        startService(i);

        // Resolve once the service actually connects; REJECT on timeout so the
        // web layer falls back to the WebView <audio> element instead of
        // silently "playing" nothing (v1.5.4: resolve-on-timeout was why a
        // broken service looked like "track is dead" to users).
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
            // Service was never started (or died) — start it in stop-mode.
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
