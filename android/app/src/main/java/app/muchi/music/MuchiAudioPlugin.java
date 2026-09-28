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
    public void load() {
        super.load();
        MuchiAudioService.setStaticListener(this);
        ensureService(null);
    }

    @Override
    protected void handleOnDestroy() {
        main.removeCallbacks(bindTimeout);
        if (bindTimeout != null) main.removeCallbacks(bindTimeout);
        if (pendingPlay != null) {
            PluginCall pc = pendingPlay;
            pendingPlay = null;
            try { pc.resolve(); } catch (Exception ignored) {}
        }
        MuchiAudioService.setStaticListener(null);
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
        MuchiAudioService.setStaticListener(this);
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

    private static long readLong(PluginCall call, String key, long defaultValue) {
        if (call == null || call.getData() == null) return defaultValue;
        Object raw = call.getData().opt(key);
        if (raw instanceof Number) {
            return ((Number) raw).longValue();
        }
        if (raw instanceof String) {
            try {
                return Math.round(Double.parseDouble((String) raw));
            } catch (Exception ignored) {}
        }
        Long val = call.getLong(key, defaultValue);
        return val != null ? val : defaultValue;
    }

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url", "");
        String videoId = call.getString("videoId", "");
        if (url.isEmpty() && !videoId.isEmpty()) {
            url = "yt:" + videoId;
        }
        if (url.isEmpty()) {
            call.reject("MuchiAudio: missing url");
            return;
        }
        Intent i = new Intent(getContext(), MuchiAudioService.class);
        i.setAction(MuchiAudioService.ACTION_PLAY);
        i.putExtra(MuchiAudioService.EXTRA_URL, url);
        i.putExtra(MuchiAudioService.EXTRA_VIDEO_ID, videoId);
        i.putExtra(MuchiAudioService.EXTRA_CANDIDATES, call.getString("candidates", ""));
        if (url.startsWith("content://")) {
            try {
                i.setData(android.net.Uri.parse(url));
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) {}
        }
        i.putExtra(MuchiAudioService.EXTRA_TITLE, call.getString("title", "Muchi"));
        i.putExtra(MuchiAudioService.EXTRA_ARTIST, call.getString("artist", ""));
        i.putExtra(MuchiAudioService.EXTRA_ARTWORK, call.getString("artwork", ""));
        i.putExtra(MuchiAudioService.EXTRA_DURATION_MS, readLong(call, "duration", 0L));
        if (call.hasOption("volume")) {
            Double v = call.getDouble("volume", 100.0);
            i.putExtra(MuchiAudioService.EXTRA_VOLUME, v != null ? v.floatValue() : 100f);
        }
        if (call.hasOption("normalize")) {
            Boolean norm = call.getBoolean("normalize", false);
            i.putExtra(MuchiAudioService.EXTRA_NORMALIZE, norm != null && norm);
        }
        if (call.hasOption("speed")) {
            Double spd = call.getDouble("speed", 1.0);
            i.putExtra(MuchiAudioService.EXTRA_SPEED, spd != null ? spd.floatValue() : 1.0f);
        }
        if (call.hasOption("spatial")) {
            i.putExtra(MuchiAudioService.EXTRA_SPATIAL, call.getString("spatial", "phone"));
        }

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
    public void preload(PluginCall call) {
        String videoId = call.getString("videoId", "");
        String candidates = call.getString("candidates", "");
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        MuchiAudioService.preloadStream(videoId, candidates, title, artist);
        call.resolve();
    }

    @PluginMethod
    public void syncSession(PluginCall call) {
        Intent i = new Intent(getContext(), MuchiAudioService.class);
        i.setAction(MuchiAudioService.ACTION_SESSION);
        i.putExtra(MuchiAudioService.EXTRA_TITLE, call.getString("title", "Muchi"));
        i.putExtra(MuchiAudioService.EXTRA_ARTIST, call.getString("artist", ""));
        i.putExtra(MuchiAudioService.EXTRA_ARTWORK, call.getString("artwork", ""));
        i.putExtra(MuchiAudioService.EXTRA_DURATION_MS, readLong(call, "duration", 0L));
        i.putExtra(MuchiAudioService.EXTRA_POSITION_MS, readLong(call, "position", 0L));
        Boolean playing = call.getBoolean("playing", true);
        i.putExtra(MuchiAudioService.EXTRA_PLAYING, playing == null || playing);
        startService(i);
        ensureService(() -> {
            if (service != null) service.sessionIntent(i);
        });
        call.resolve();
    }

    @PluginMethod
    public void setAudioPrefs(PluginCall call) {
        Intent i = new Intent(getContext(), MuchiAudioService.class);
        i.setAction(MuchiAudioService.ACTION_PREFS);
        if (call.hasOption("volume")) {
            Double v = call.getDouble("volume", 100.0);
            i.putExtra(MuchiAudioService.EXTRA_VOLUME, v != null ? v.floatValue() : 100f);
        }
        if (call.hasOption("normalize")) {
            Boolean norm = call.getBoolean("normalize", false);
            i.putExtra(MuchiAudioService.EXTRA_NORMALIZE, norm != null && norm);
        }
        if (call.hasOption("speed")) {
            Double spd = call.getDouble("speed", 1.0);
            i.putExtra(MuchiAudioService.EXTRA_SPEED, spd != null ? spd.floatValue() : 1.0f);
        }
        if (call.hasOption("spatial")) {
            i.putExtra(MuchiAudioService.EXTRA_SPATIAL, call.getString("spatial", "phone"));
        }
        ensureService(() -> {
            if (service != null) service.prefsIntent(i);
        });
        call.resolve();
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
        long position = readLong(call, "position", 0L);
        ensureService(() -> { if (service != null) service.seekToPlayback(position); });
        call.resolve();
    }

    @PluginMethod
    public void emit(PluginCall call) {
        String action = call.getString("action", "");
        if ("stop".equals(action)) doStop();
        call.resolve();
    }

    private static final String[] ICON_IDS = new String[] {
        "default",
        "anime_cyber",
        "anime_kawaii",
        "anime_mecha",
        "anime_sakura",
        "anime_shonen",
        "anime_ninja",
        "anime_chibi",
        "blurple_gamer",
        "gem_booster",
        "matrix_terminal",
        "pixel_arcade",
        "solar_flare",
        "vaporwave",
        "synthwave",
        "cosmic_nebula",
        "ruby_crimson",
        "emerald_jade",
        "holographic",
        "y2k_chrome",
        "midnight_stealth",
        "sunset_lofi",
        "ocean_abyss",
        "citrus_burst",
        "royal_amethyst"
    };

    private String normalizeIconId(String raw) {
        if (raw == null || raw.isEmpty()) return "default";
        for (String id : ICON_IDS) {
            if (id.equals(raw)) return id;
        }
        return "default";
    }

    @PluginMethod
    public void setAppIcon(PluginCall call) {
        String requested = normalizeIconId(call.getString("icon", "default"));
        Context ctx = getContext();
        try {
            ctx.getSharedPreferences("muchi_prefs", Context.MODE_PRIVATE)
                    .edit()
                    .putString("app_icon", requested)
                    .apply();
            PackageManager pm = ctx.getPackageManager();
            String pkg = ctx.getPackageName();

            ComponentName targetComp = new ComponentName(pkg, pkg + ".MainActivityAlias_" + requested);
            int targetState = pm.getComponentEnabledSetting(targetComp);
            boolean targetAlreadyEnabled = (targetState == PackageManager.COMPONENT_ENABLED_STATE_ENABLED)
                    || ("default".equals(requested) && targetState == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT);

            boolean anyOtherEnabled = false;
            for (String id : ICON_IDS) {
                if (id.equals(requested)) continue;
                ComponentName comp = new ComponentName(pkg, pkg + ".MainActivityAlias_" + id);
                int curState = pm.getComponentEnabledSetting(comp);
                boolean isDefaultAlias = "default".equals(id);
                if (curState == PackageManager.COMPONENT_ENABLED_STATE_ENABLED ||
                        (isDefaultAlias && curState == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT)) {
                    anyOtherEnabled = true;
                    break;
                }
            }

            if (!targetAlreadyEnabled || anyOtherEnabled) {
                // Enable the newly selected launcher alias first so the app always
                // has an active launcher entry during the transition.
                pm.setComponentEnabledSetting(
                        targetComp,
                        PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                        PackageManager.DONT_KILL_APP
                );

                // Disable all other launcher aliases.
                for (String id : ICON_IDS) {
                    if (id.equals(requested)) continue;
                    ComponentName comp = new ComponentName(pkg, pkg + ".MainActivityAlias_" + id);
                    int curState = pm.getComponentEnabledSetting(comp);
                    boolean isDefaultAlias = "default".equals(id);
                    if (curState == PackageManager.COMPONENT_ENABLED_STATE_ENABLED ||
                            (isDefaultAlias && curState == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT)) {
                        pm.setComponentEnabledSetting(
                                comp,
                                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                                PackageManager.DONT_KILL_APP
                        );
                    }
                }
            }

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("icon", requested);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("icon", requested);
            ret.put("error", e.getMessage() != null ? e.getMessage() : "failed to switch launcher icon");
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void getAppIcon(PluginCall call) {
        Context ctx = getContext();
        String cur = ctx.getSharedPreferences("muchi_prefs", Context.MODE_PRIVATE)
                .getString("app_icon", "default");
        JSObject ret = new JSObject();
        ret.put("icon", normalizeIconId(cur));
        call.resolve(ret);
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
