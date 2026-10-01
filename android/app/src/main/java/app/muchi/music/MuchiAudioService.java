package app.muchi.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.audiofx.BassBoost;
import android.media.audiofx.Equalizer;
import android.media.audiofx.LoudnessEnhancer;
import android.net.wifi.WifiManager;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * MUCHI native background audio — ExoPlayer inside a foreground Service,
 * with a MediaSessionCompat for the OS media notification and lock-screen
 * controls, plus on-device YouTube InnerTube/Piped stream resolution (so
 * background playback & notifications work even when datacenter Worker IPs
 * are gated by YouTube), a Mirror Session mode for WebView fallback playback,
 * and the 1.5.5 Sound Stage DSP profile (LoudnessEnhancer + Equalizer + BassBoost).
 */
@UnstableApi
public class MuchiAudioService extends Service {

    private static final String CHANNEL_ID = "muchi_media";
    private static final int NOTIFICATION_ID = 1;
    private static final String SESSION_TAG = "Muchi Audio";
    private static final String DEFAULT_UA =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

    public static final String ACTION_PLAY = "app.muchi.music.action.PLAY";
    public static final String ACTION_RESUME = "app.muchi.music.action.RESUME";
    public static final String ACTION_SESSION = "app.muchi.music.action.SESSION";
    public static final String ACTION_PREFS = "app.muchi.music.action.PREFS";
    public static final String ACTION_STOP = "app.muchi.music.action.STOP";
    /** Notification transport buttons (v1.5.4): these arrive as getService
     *  PendingIntents from the media notification itself. */
    public static final String ACTION_TOGGLE = "app.muchi.music.action.TOGGLE";
    public static final String ACTION_NEXT = "app.muchi.music.action.NEXT";
    public static final String ACTION_PREV = "app.muchi.music.action.PREV";

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_VIDEO_ID = "videoId";
    public static final String EXTRA_CANDIDATES = "candidates";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_ARTWORK = "artwork";
    public static final String EXTRA_DURATION_MS = "durationMs";
    public static final String EXTRA_POSITION_MS = "positionMs";
    public static final String EXTRA_PLAYING = "playing";
    public static final String EXTRA_VOLUME = "volume";
    public static final String EXTRA_NORMALIZE = "normalize";
    public static final String EXTRA_SPEED = "speed";
    public static final String EXTRA_SPATIAL = "spatial";

    /** Service → plugin channel (main thread). */
    public interface PluginListener {
        void onControls(String message, long positionMs);
        void onProgress(long positionMs, long durationMs, boolean playing);
    }

    /**
     * Plugin → service control surface. Every call hops to the service's
     * main-looper handler so ExoPlayer + MediaSessionCompat are strictly
     * main-thread-affine and FIFO-ordered.
     */
    public class LocalBinder extends Binder {
        public boolean isForegroundStarted() { return isForegroundStarted; }
        public long getCurrentPositionMs() { return lastReportedPositionMs; }
        public long getCurrentDurationMs() { return lastReportedDurationMs > 0 ? lastReportedDurationMs : currentDurationMs; }
        public boolean getIsPlaying() { return lastReportedPlaying; }
        public void setListener(PluginListener l) { ticker.post(() -> listener = l); }
        public void playIntent(Intent i) { ticker.post(() -> handlePlayIntent(i)); }
        public void sessionIntent(Intent i) { ticker.post(() -> handleSessionIntent(i)); }
        public void prefsIntent(Intent i) { ticker.post(() -> handlePrefsIntent(i)); }
        public void pausePlayback() {
            ticker.post(() -> {
                if (mirrorMode) {
                    mirrorPlaying = false;
                    updatePlaybackState(false, mirrorPositionMs);
                    showNotification();
                    updateLocks(false);
                } else if (player != null) {
                    player.pause();
                }
            });
        }
        public void resumePlayback() {
            ticker.post(() -> {
                if (mirrorMode) {
                    mirrorPlaying = true;
                    startInForeground();
                    updatePlaybackState(true, mirrorPositionMs);
                    showNotification();
                    updateLocks(true);
                } else if (player != null) {
                    startInForeground();
                    player.play();
                    showNotification();
                    updateLocks(true);
                }
            });
        }
        public void seekToPlayback(long positionMs) {
            ticker.post(() -> {
                long targetMs = Math.max(0L, positionMs);
                lastKnownPositionMs = targetMs;
                endedNotified = false;
                if (mirrorMode) {
                    mirrorPositionMs = targetMs;
                    updatePlaybackState(mirrorPlaying, mirrorPositionMs);
                } else if (resolvingOnDevice || player == null || player.getPlaybackState() == Player.STATE_IDLE) {
                    pendingSeekMs = targetMs;
                    pendingSeekSetAtMs = android.os.SystemClock.elapsedRealtime();
                    updatePlaybackState(true, targetMs);
                } else {
                    pendingSeekMs = targetMs;
                    pendingSeekSetAtMs = android.os.SystemClock.elapsedRealtime();
                    player.seekTo(targetMs);
                    if ((player.getPlayWhenReady() && !player.isPlaying()) || player.getPlaybackState() == Player.STATE_ENDED) {
                        player.play();
                    }
                    updatePlaybackState(isCurrentlyPlaying(), targetMs);
                }
            });
        }
        public void stopAll() {
            // JS-initiated stop: pass notifyJs=false so a delayed async "stop"
            // event never clobbers the next track that JS is already starting.
            ticker.post(() -> stopPlaybackInternal(false));
        }
    }

    private final LocalBinder binder = new LocalBinder();
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService resolveExecutor = Executors.newCachedThreadPool();
    private final Handler ticker = new Handler(Looper.getMainLooper());

    private ExoPlayer player;
    private DefaultHttpDataSource.Factory httpFactory;
    private MediaSessionCompat session;
    private NotificationManager notificationManager;
    private PluginListener listener;
    private static volatile PluginListener staticListener;
    private PowerManager.WakeLock cpuWakeLock;
    private WifiManager.WifiLock wifiLock;

    public static void setStaticListener(PluginListener l) {
        staticListener = l;
    }

    private PluginListener activeListener() {
        PluginListener l = listener;
        return l != null ? l : staticListener;
    }

    // 1.5.5 / 1.8.5 Sound Stage hardware DSP effects attached to ExoPlayer's audio session
    private int currentAudioSessionId = C.AUDIO_SESSION_ID_UNSET;
    private LoudnessEnhancer loudnessEnhancer;
    private Equalizer equalizer;
    private BassBoost bassBoost;
    private float prefVolume = 100f;
    private boolean prefNormalize = false;
    private float prefSpeed = 1.0f;
    private String prefSpatial = "phone";

    private volatile boolean endedNotified = false;
    private volatile int loadSeq = 0;
    private String trackTitle = "Muchi";
    private String trackArtist = "";
    private String trackArtworkUrl = "";
    private Bitmap artworkBitmap;
    private String currentUrl;
    private String currentRequestedUrl;
    private String currentVideoId = "";
    private String currentCandidates = "";
    private long currentDurationMs = 0L;
    private boolean triedOnDeviceResolve = false;
    private int midSongRecoveryCount = 0;
    private final Set<String> failedVideoIds = ConcurrentHashMap.newKeySet();
    private volatile boolean resolvingOnDevice = false;
    private volatile boolean isForegroundStarted = false;
    private volatile long pendingSeekMs = 0L;
    private volatile long pendingSeekSetAtMs = 0L;
    private volatile long lastKnownPositionMs = 0L;
    private volatile long lastLoadTrackAtMs = 0L;
    private volatile long lastReportedPositionMs = 0L;
    private volatile long lastReportedDurationMs = 0L;
    private volatile boolean lastReportedPlaying = false;

    // Mirror mode: active when WebView (YouTube IFrame or WebAudio <audio>) is
    // playing so the Foreground Service notification + WakeLock still run.
    private boolean mirrorMode = false;
    private boolean mirrorPlaying = false;
    private long mirrorPositionMs = 0L;
    private long mirrorDurationMs = 0L;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            ticker.removeCallbacks(tick);
            PluginListener l = activeListener();
            if (mirrorMode) {
                lastReportedPositionMs = mirrorPositionMs;
                lastReportedDurationMs = mirrorDurationMs;
                lastReportedPlaying = mirrorPlaying;
                if (session != null) {
                    updatePlaybackState(mirrorPlaying, mirrorPositionMs);
                }
                if (l != null) {
                    l.onProgress(mirrorPositionMs, mirrorDurationMs, mirrorPlaying);
                }
                if (mirrorPlaying) {
                    mirrorPositionMs += 250L;
                    if (mirrorDurationMs > 0 && mirrorPositionMs > mirrorDurationMs) {
                        mirrorPositionMs = mirrorDurationMs;
                    }
                    ticker.postDelayed(tick, 250L);
                }
                return;
            }
            if (session == null) return;
            if (player == null) {
                long fallbackPos = pendingSeekMs > 0 ? pendingSeekMs : lastKnownPositionMs;
                lastReportedPositionMs = fallbackPos;
                lastReportedDurationMs = currentDurationMs;
                lastReportedPlaying = true;
                if (l != null) l.onProgress(fallbackPos, currentDurationMs, true);
                ticker.postDelayed(tick, 250L);
                return;
            }
            long positionMs;
            if (resolvingOnDevice) {
                positionMs = Math.max(0L, pendingSeekMs);
            } else {
                int st = player.getPlaybackState();
                long rawPos = (st == Player.STATE_IDLE) ? 0L : Math.max(0L, player.getCurrentPosition());
                long seekElapsed = android.os.SystemClock.elapsedRealtime() - pendingSeekSetAtMs;
                if (pendingSeekMs > 0 && (st != Player.STATE_READY || (Math.abs(rawPos - pendingSeekMs) >= 4000L && seekElapsed < 2200L))) {
                    positionMs = pendingSeekMs;
                } else {
                    positionMs = rawPos;
                    if (positionMs > 0 && (player.isPlaying() || st == Player.STATE_READY)) {
                        lastKnownPositionMs = positionMs;
                        if (pendingSeekMs > 0 && (Math.abs(positionMs - pendingSeekMs) < 4000L || seekElapsed >= 2200L)) {
                            pendingSeekMs = 0L;
                        }
                    }
                }
            }
            long rawDur = resolvingOnDevice ? C.TIME_UNSET : player.getDuration();
            long durationMs = (rawDur != C.TIME_UNSET && rawDur > 0) ? rawDur : 0L;
            if (durationMs <= 0 && currentDurationMs > 0) durationMs = currentDurationMs;
            if (durationMs <= 0 && currentUrl != null) {
                long urlDur = extractDurationMsFromUrl(currentUrl);
                if (urlDur > 0) {
                    currentDurationMs = urlDur;
                    durationMs = urlDur;
                }
            }
            boolean playing = resolvingOnDevice || player.isPlaying()
                    || (player.getPlayWhenReady() && player.getPlaybackState() != Player.STATE_IDLE && player.getPlaybackState() != Player.STATE_ENDED);
            lastReportedPositionMs = positionMs;
            lastReportedDurationMs = durationMs;
            lastReportedPlaying = playing;
            if (l != null) l.onProgress(positionMs, durationMs, playing);
            updatePlaybackState(playing, positionMs);
            ticker.postDelayed(tick, 250L);
        }
    };

    /* ── lifecycle ─────────────────────────────────────────────────── */

    @Override
    public void onCreate() {
        super.onCreate();
        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        createChannel();
        initLocks();
        // Purge any < 1.15 MB or 983,040-byte (1-minute) c=IOS/c=ANDROID files in muchi_audio_cache,
        // and perform a one-time purge (.v193_clean) of any stale remix/wrong-artist files from older builds.
        sharedResolvePool.execute(() -> {
            try {
                File oldDir = new File(getCacheDir(), "muchi_audio_cache");
                if (oldDir.exists() && oldDir.isDirectory()) {
                    File cleanMarker = new File(oldDir, ".v193_clean");
                    boolean wipeAll = !cleanMarker.exists();
                    File[] oldFiles = oldDir.listFiles();
                    if (oldFiles != null) {
                        for (File f : oldFiles) {
                            if (f != null && f.isFile() && !".v193_clean".equals(f.getName())
                                    && (wipeAll || f.length() == 983040L || f.length() < 1150000L)) {
                                //noinspection ResultOfMethodCallIgnored
                                f.delete();
                            }
                        }
                    }
                    if (wipeAll) {
                        try {
                            //noinspection ResultOfMethodCallIgnored
                            cleanMarker.createNewFile();
                        } catch (Exception ignored) {}
                    }
                }
            } catch (Exception ignored) {}
        });
    }

    private void initLocks() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                cpuWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Muchi:AudioWakeLock");
                cpuWakeLock.setReferenceCounted(false);
            }
        } catch (Exception ignored) {}
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                int lockType = Build.VERSION.SDK_INT >= 29
                        ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                        : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                wifiLock = wm.createWifiLock(lockType, "Muchi:AudioWifiLock");
                wifiLock.setReferenceCounted(false);
            }
        } catch (Exception ignored) {}
    }

    private void updateLocks(boolean active) {
        try {
            if (cpuWakeLock != null) {
                if (active && !cpuWakeLock.isHeld()) cpuWakeLock.acquire();
                else if (!active && cpuWakeLock.isHeld()) cpuWakeLock.release();
            }
        } catch (Exception ignored) {}
        try {
            if (wifiLock != null) {
                if (active && !wifiLock.isHeld()) wifiLock.acquire();
                else if (!active && wifiLock.isHeld()) wifiLock.release();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? "" : (intent.getAction() == null ? "" : intent.getAction());
        if (ACTION_STOP.equals(action)) {
            stopPlaybackInternal(true);
            return START_NOT_STICKY;
        }
        if (ACTION_PLAY.equals(action)) {
            handlePlayIntent(intent);
        } else if (ACTION_RESUME.equals(action)) {
            if (mirrorMode) {
                mirrorPlaying = true;
                startInForeground();
                updatePlaybackState(true, mirrorPositionMs);
                showNotification();
                updateLocks(true);
            } else if (player != null) {
                startInForeground();
                player.play();
                showNotification();
                updateLocks(true);
            } else {
                startInForeground();
                showNotification();
                updateLocks(true);
            }
        } else if (ACTION_SESSION.equals(action)) {
            handleSessionIntent(intent);
        } else if (ACTION_PREFS.equals(action)) {
            handlePrefsIntent(intent);
        } else if (ACTION_TOGGLE.equals(action)) {
            if (mirrorMode) {
                mirrorPlaying = !mirrorPlaying;
                updatePlaybackState(mirrorPlaying, mirrorPositionMs);
                showNotification();
                updateLocks(mirrorPlaying);
                emitControls(mirrorPlaying ? "play" : "pause", mirrorPositionMs);
            } else if (player != null) {
                if (player.isPlaying()) {
                    player.pause();
                    emitControls("pause", player.getCurrentPosition());
                } else {
                    player.play();
                    emitControls("play", player.getCurrentPosition());
                }
            }
        } else if (ACTION_NEXT.equals(action)) {
            // The queue lives in the web layer; echo, don't decide.
            emitControls("next", 0L);
        } else if (ACTION_PREV.equals(action)) {
            emitControls("previous", 0L);
        } else if (intent == null && ((player != null && (player.isPlaying() || player.getPlayWhenReady())) || (mirrorMode && mirrorPlaying) || resolvingOnDevice)) {
            // START_STICKY restart: the OS recreated us. Re-attach the
            // foreground notification so background playback survives a
            // system-initiated process restart.
            startInForeground();
            showNotification();
            ticker.removeCallbacks(tick);
            ticker.post(tick);
        } else if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        } else {
            // Ensure any startForegroundService() invocation satisfies Android's
            // mandatory startForeground() contract inside onStartCommand.
            startInForeground();
            showNotification();
        }
        return START_STICKY;
    }

    /** Shared by onStartCommand and the plugin binder. */
    private void handlePlayIntent(Intent intent) {
        if (intent == null) return;
        String url = intent.getStringExtra(EXTRA_URL);
        String videoId = intent.getStringExtra(EXTRA_VIDEO_ID);
        if (videoId == null) videoId = "";
        if ((url == null || url.isEmpty()) && !videoId.isEmpty()) {
            url = "yt:" + videoId;
        }
        if (url == null || url.isEmpty()) {
            startInForeground();
            if (mirrorMode) {
                mirrorPlaying = true;
                updatePlaybackState(true, mirrorPositionMs);
                showNotification();
                updateLocks(true);
            } else if (player != null) {
                player.play();
                showNotification();
                updateLocks(true);
            }
            return;
        }

        readPrefsFromIntent(intent);
        String title = intent.getStringExtra(EXTRA_TITLE);
        String artist = intent.getStringExtra(EXTRA_ARTIST);
        String artwork = intent.getStringExtra(EXTRA_ARTWORK);
        String candidates = intent.getStringExtra(EXTRA_CANDIDATES);
        long durationMs = intent.getLongExtra(EXTRA_DURATION_MS, 0L);
        long startPosMs = Math.max(0L, intent.getLongExtra(EXTRA_POSITION_MS, 0L));

        trackTitle = title != null && !title.isEmpty() ? title : "Muchi";
        trackArtist = artist != null ? artist : "";
        currentDurationMs = Math.max(0L, durationMs);
        mirrorMode = false;

        // Promote to a foreground service IMMEDIATELY (with full MediaStyle
        // notification and session) before any network/prepare work so Android
        // reliably keeps the service alive in the background and displays the
        // notification right away.
        ensureSession();
        session.setMetadata(buildMetadata(currentDurationMs));
        updatePlaybackState(true, startPosMs);
        startInForeground();
        showNotification();
        updateLocks(true);

        loadTrack(url, videoId, candidates != null ? candidates : "", trackTitle, trackArtist, artwork, currentDurationMs, startPosMs);
    }

    /** Mirror mode: keeps the Foreground Media Notification & WakeLock active
     *  even when audio is playing inside the WebView (e.g. YouTube IFrame / <audio>). */
    private void handleSessionIntent(Intent intent) {
        if (intent == null) return;
        // If native ExoPlayer is actively playing or preparing a track, native
        // ExoPlayer owns the notification directly — ignore mirror updates.
        if (!mirrorMode && (resolvingOnDevice || (player != null && (player.isPlaying() || (player.getPlayWhenReady() && player.getPlaybackState() == Player.STATE_BUFFERING))))) {
            return;
        }
        String title = intent.getStringExtra(EXTRA_TITLE);
        String artist = intent.getStringExtra(EXTRA_ARTIST);
        String artwork = intent.getStringExtra(EXTRA_ARTWORK);
        long durationMs = intent.getLongExtra(EXTRA_DURATION_MS, 0L);
        long positionMs = intent.getLongExtra(EXTRA_POSITION_MS, 0L);
        boolean playing = intent.getBooleanExtra(EXTRA_PLAYING, true);

        mirrorMode = true;
        mirrorPlaying = playing;
        mirrorDurationMs = Math.max(0L, durationMs);
        mirrorPositionMs = Math.max(0L, positionMs);
        if (title != null && !title.isEmpty()) trackTitle = title;
        if (artist != null) trackArtist = artist;

        ensureSession();
        session.setMetadata(buildMetadata(mirrorDurationMs));
        updatePlaybackState(mirrorPlaying, mirrorPositionMs);
        startInForeground();
        showNotification();
        updateLocks(mirrorPlaying);

        if (artwork != null && !artwork.isEmpty() && !artwork.equals(trackArtworkUrl)) {
            trackArtworkUrl = artwork;
            fetchArtwork(artwork);
        }
        ticker.removeCallbacks(tick);
        if (mirrorPlaying) ticker.postDelayed(tick, 1000);
    }

    private void handlePrefsIntent(Intent intent) {
        if (intent == null) return;
        readPrefsFromIntent(intent);
        applyPlayerPrefsAndEffects();
    }

    private void readPrefsFromIntent(Intent intent) {
        if (intent.hasExtra(EXTRA_VOLUME)) {
            prefVolume = intent.getFloatExtra(EXTRA_VOLUME, prefVolume);
        }
        if (intent.hasExtra(EXTRA_NORMALIZE)) {
            prefNormalize = intent.getBooleanExtra(EXTRA_NORMALIZE, prefNormalize);
        }
        if (intent.hasExtra(EXTRA_SPEED)) {
            float spd = intent.getFloatExtra(EXTRA_SPEED, prefSpeed);
            if (spd >= 0.25f && spd <= 3.0f) prefSpeed = spd;
        }
        if (intent.hasExtra(EXTRA_SPATIAL)) {
            String sp = intent.getStringExtra(EXTRA_SPATIAL);
            if (sp != null && !sp.isEmpty()) prefSpatial = sp;
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        listener = null;
        return true;
    }

    @Override
    public void onRebind(Intent intent) {
        super.onRebind(intent);
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        // When the user swipes the app away from Recents, stop playback immediately,
        // remove the notification, and release locks so music never keeps playing after closing.
        stopPlaybackInternal(true);
    }

    @Override
    public void onDestroy() {
        ticker.removeCallbacks(tick);
        updateLocks(false);
        releaseAudioEffects();
        io.shutdown();
        resolveExecutor.shutdown();
        if (player != null) {
            player.release();
            player = null;
        }
        if (session != null) {
            session.release();
            session = null;
        }
        super.onDestroy();
    }

    /* ── playback ──────────────────────────────────────────────────── */

    private void ensurePlayer() {
        if (player != null) return;
        httpFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent(DEFAULT_UA)
                .setConnectTimeoutMs(12000)
                .setReadTimeoutMs(18000)
                .setAllowCrossProtocolRedirects(true);
        DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(this, httpFactory);
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(
                        30000,
                        240000,
                        200,
                        600
                )
                .build();
        ExoPlayer.Builder builder = new ExoPlayer.Builder(this)
                .setLoadControl(loadControl)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(this).setDataSourceFactory(dataSourceFactory))
                // Hold both CPU wake lock and Wi-Fi lock so background streaming
                // survives screen-off doze over Wi-Fi and mobile data.
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .setHandleAudioBecomingNoisy(true)
                .setAudioAttributes(
                        new androidx.media3.common.AudioAttributes.Builder()
                                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                                .setUsage(C.USAGE_MEDIA)
                                .build(),
                        false);
        player = builder.build();
        player.addListener(new Player.Listener() {
            @Override
            public void onAudioSessionIdChanged(int audioSessionId) {
                currentAudioSessionId = audioSessionId;
                applyPlayerPrefsAndEffects();
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_READY) {
                    applyPlayerPrefsAndEffects();
                    showNotification();
                } else if (playbackState == Player.STATE_ENDED && !endedNotified) {
                    long posNow = Math.max(lastKnownPositionMs, player != null ? Math.max(0L, player.getCurrentPosition()) : 0L);
                    // Guard against premature ~1-minute stream cutoff masquerading as STATE_ENDED:
                    // If the track has a known duration >= 90s and playback ended more than 25s early,
                    // OR if playback ended right around ~45s-72s (the 960KB 1-minute cap),
                    // recover mid-song at posNow instead of stopping or skipping early!
                    boolean prematureKnownDur = currentDurationMs >= 90000L && posNow > 15000L && posNow < (currentDurationMs - 25000L);
                    boolean prematureOneMinCutoff = posNow >= 45000L && posNow <= 72000L && (currentDurationMs <= 0L || currentDurationMs >= 85000L);
                    if ((prematureKnownDur || prematureOneMinCutoff)
                            && midSongRecoveryCount < 2 && (!currentVideoId.isEmpty() || !trackTitle.isEmpty())) {
                        recoverMidSongStream(posNow);
                        return;
                    }
                    endedNotified = true;
                    emitControls("ended", 0L);
                }
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                long errPos = Math.max(pendingSeekMs, lastKnownPositionMs);
                if (player != null && !resolvingOnDevice && player.getPlaybackState() != Player.STATE_IDLE) {
                    errPos = Math.max(errPos, Math.max(0L, player.getCurrentPosition()));
                }
                invalidateResolvedCacheForTrack(currentVideoId, trackTitle, trackArtist, currentUrl);
                if (currentUrl != null && currentUrl.startsWith("file:")) {
                    evictCachedAudioFile(MuchiAudioService.this, currentVideoId, trackTitle, trackArtist);
                    triedOnDeviceResolve = false;
                }
                // If the Worker proxy URL, initial stream, or mid-song connection failed (e.g. around ~1 min)
                // and we have a videoId/title, resolve a fresh verified stream directly on the phone's IP!
                if ((!triedOnDeviceResolve || (errPos > 1500L && midSongRecoveryCount < 2))
                        && (!currentVideoId.isEmpty() || !trackTitle.isEmpty())) {
                    recoverMidSongStream(errPos);
                    return;
                }
                emitControls("error", errPos);
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                updateLocks(isPlaying || (player != null && player.getPlayWhenReady()));
                ticker.post(() -> showNotification());
            }
        });
    }

    private void ensureSession() {
        if (session != null) return;
        session = new MediaSessionCompat(this, SESSION_TAG, null, null);
        session.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                super.onPlay();
                if (mirrorMode) {
                    mirrorPlaying = true;
                    updatePlaybackState(true, mirrorPositionMs);
                    showNotification();
                    updateLocks(true);
                } else if (player != null) {
                    player.play();
                }
                emitControls("play", 0L);
            }

            @Override
            public void onPause() {
                super.onPause();
                if (mirrorMode) {
                    mirrorPlaying = false;
                    updatePlaybackState(false, mirrorPositionMs);
                    showNotification();
                    updateLocks(false);
                } else if (player != null) {
                    player.pause();
                }
                emitControls("pause", 0L);
            }

            @Override
            public void onSkipToNext() {
                emitControls("next", 0L);
            }

            @Override
            public void onSkipToPrevious() {
                emitControls("previous", 0L);
            }

            @Override
            public void onSeekTo(long position) {
                long targetMs = Math.max(0L, position);
                lastKnownPositionMs = targetMs;
                endedNotified = false;
                if (mirrorMode) {
                    mirrorPositionMs = targetMs;
                    updatePlaybackState(mirrorPlaying, mirrorPositionMs);
                    emitControls("seek", mirrorPositionMs);
                } else if (resolvingOnDevice || player == null || player.getPlaybackState() == Player.STATE_IDLE) {
                    pendingSeekMs = targetMs;
                    pendingSeekSetAtMs = android.os.SystemClock.elapsedRealtime();
                    updatePlaybackState(true, targetMs);
                } else {
                    pendingSeekMs = targetMs;
                    pendingSeekSetAtMs = android.os.SystemClock.elapsedRealtime();
                    player.seekTo(targetMs);
                }
            }

            @Override
            public void onStop() {
                stopPlaybackInternal(true);
            }
        });
        session.setActive(true);
        try {
            PendingIntent pi = buildContentPendingIntent();
            if (pi != null) session.setSessionActivity(pi);
        } catch (Exception ignored) {}
    }

    private PendingIntent buildContentPendingIntent() {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open == null) {
            open = new Intent(this, MainActivity.class);
        }
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = Build.VERSION.SDK_INT >= 31
                ? (PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)
                : PendingIntent.FLAG_UPDATE_CURRENT;
        return PendingIntent.getActivity(this, 0, open, piFlags);
    }

    private synchronized void loadTrack(String url, String videoId, String candidates,
                                        String title, String artist, String artwork, long durationMs, long startPosMs) {
        String newTitle = title != null && !title.isEmpty() ? title : "Muchi";
        String newArtist = artist != null ? artist : "";
        String newVideoId;
        if (videoId != null && !videoId.isEmpty()) {
            newVideoId = videoId;
        } else if (url != null && url.startsWith("yt:")) {
            newVideoId = url.substring(3).trim();
        } else {
            newVideoId = extractVideoIdFromUrl(url);
        }
        mirrorMode = false;

        long nowMs = System.currentTimeMillis();
        boolean sameIdentity = url != null && !url.equals("yt:")
                && newTitle.equals(trackTitle)
                && newArtist.equals(trackArtist)
                && newVideoId.equals(currentVideoId)
                && (url.equals(currentUrl) || url.equals(currentRequestedUrl));

        // Deduplicate rapid double-invocation of the exact same track within 450ms
        if (sameIdentity && (nowMs - lastLoadTrackAtMs < 450L) && player != null
                && (resolvingOnDevice || player.isPlaying() || player.getPlayWhenReady() || player.getPlaybackState() == Player.STATE_BUFFERING)) {
            if (startPosMs > 0) {
                pendingSeekMs = startPosMs;
                lastKnownPositionMs = startPosMs;
                if (!resolvingOnDevice && Math.abs(player.getCurrentPosition() - startPosMs) > 1500) {
                    player.seekTo(startPosMs);
                }
            }
            ensureSession();
            session.setMetadata(buildMetadata(currentDurationMs));
            showNotification();
            ticker.removeCallbacks(tick);
            ticker.post(tick);
            if (artwork != null && !artwork.isEmpty() && !artwork.equals(trackArtworkUrl)) {
                trackArtworkUrl = artwork;
                fetchArtwork(artwork);
            }
            return;
        }

        lastLoadTrackAtMs = nowMs;
        trackTitle = newTitle;
        trackArtist = newArtist;
        currentVideoId = newVideoId;
        currentCandidates = candidates != null ? candidates : "";
        currentDurationMs = Math.max(0L, durationMs);
        if (currentDurationMs <= 0 && url != null) {
            long urlDur = extractDurationMsFromUrl(url);
            if (urlDur > 0) currentDurationMs = urlDur;
        }

        currentRequestedUrl = url;
        currentUrl = url;
        endedNotified = false;
        midSongRecoveryCount = 0;
        failedVideoIds.clear();
        pendingSeekMs = Math.max(0L, startPosMs);
        pendingSeekSetAtMs = pendingSeekMs > 0 ? android.os.SystemClock.elapsedRealtime() : 0L;
        lastKnownPositionMs = pendingSeekMs;
        lastReportedPositionMs = pendingSeekMs;
        lastReportedDurationMs = currentDurationMs;
        lastReportedPlaying = true;
        final int seq = ++loadSeq;

        // Reject any 1-minute-capped c=IOS / c=ANDROID googlevideo URL (plain or proxied via /api/stream)
        // so the service immediately resolves a 100% full-length uncapped stream on-device.
        if (url != null && !url.startsWith("yt:") && isOneMinuteCappedGoogleVideoUrl(url)) {
            url = "yt:" + currentVideoId;
            currentUrl = url;
        }

        ensurePlayer();
        if (player != null) {
            try {
                player.stop();
                player.clearMediaItems();
            } catch (Exception ignored) {}
        }
        ensureSession();
        session.setMetadata(buildMetadata(currentDurationMs));
        updatePlaybackState(true, pendingSeekMs);
        startInForeground();
        showNotification();
        updateLocks(true);

        if (artwork != null && !artwork.isEmpty()) {
            if (!artwork.equals(trackArtworkUrl)) {
                trackArtworkUrl = artwork;
                artworkBitmap = null;
                fetchArtwork(artwork);
            }
        } else {
            trackArtworkUrl = "";
            artworkBitmap = null;
        }

        // Instant App Audio Cache Hit: If this song has already been played and cached in
        // muchi_audio_cache on disk, play the local cached audio file immediately in 0ms
        // with zero backend or network load!
        if (url != null && !url.startsWith("file:") && !url.startsWith("content:")) {
            File cachedFile = getCachedAudioFile(this, currentVideoId, trackTitle, trackArtist);
            if (cachedFile != null) {
                long minFullSongBytes = currentDurationMs >= 90000L ? (currentDurationMs / 1000L) * 9500L : 262144L;
                if (cachedFile.length() >= minFullSongBytes) {
                    String localFileUri = android.net.Uri.fromFile(cachedFile).toString();
                    resolvingOnDevice = false;
                    triedOnDeviceResolve = false;
                    currentUrl = localFileUri;
                    startExoPlayerWithUrl(localFileUri, DEFAULT_UA, currentDurationMs);
                    return;
                } else {
                    evictCachedAudioFile(this, currentVideoId, trackTitle, trackArtist);
                }
            }
        }

        // If URL is a "yt:<videoId>" token (Worker couldn't resolve on its datacenter IP),
        // resolve the direct high-bitrate stream on the user's phone IP!
        if (url != null && url.startsWith("yt:")) {
            triedOnDeviceResolve = true;
            resolvingOnDevice = true;
            ticker.removeCallbacks(tick);
            ticker.post(tick);
            final String vid = currentVideoId;
            final String cands = currentCandidates;
            final String tTitle = trackTitle;
            final String tArtist = trackArtist;
            resolveExecutor.execute(() -> {
                ResolvedStream rs = resolveYoutubeStreamOnDevice(vid, cands, tTitle, tArtist);
                ticker.post(() -> {
                    if (seq != loadSeq) return;
                    resolvingOnDevice = false;
                    if (rs != null && rs.url != null && !rs.url.isEmpty()) {
                        currentUrl = rs.url;
                        if (rs.videoId != null && !rs.videoId.isEmpty() && currentVideoId.isEmpty()) {
                            currentVideoId = rs.videoId;
                        }
                        if (rs.durationMs > 0 && currentDurationMs <= 0) {
                            currentDurationMs = rs.durationMs;
                        }
                        startExoPlayerWithUrl(rs.url, rs.userAgent, currentDurationMs);
                    } else {
                        emitControls("error", 0L);
                    }
                });
            });
            return;
        }

        resolvingOnDevice = false;
        triedOnDeviceResolve = false;
        String ua = userAgentForStreamUrl(url);
        startExoPlayerWithUrl(url, ua, currentDurationMs);
    }

    private void startExoPlayerWithUrl(String streamUrl, String userAgent, long durationMs) {
        ensurePlayer();
        ensureSession();
        if (durationMs <= 0 && streamUrl != null) {
            long parsedDur = extractDurationMsFromUrl(streamUrl);
            if (parsedDur > 0) {
                durationMs = parsedDur;
                currentDurationMs = parsedDur;
            }
        }
        if (httpFactory != null) {
            String effectiveUa = userAgent != null && !userAgent.isEmpty() ? userAgent : userAgentForStreamUrl(streamUrl);
            httpFactory.setUserAgent(effectiveUa);
            Map<String, String> headers = new HashMap<>();
            if (streamUrl.contains("googlevideo.com")
                    && !streamUrl.contains("c=ANDROID")
                    && !streamUrl.contains("c=IOS")) {
                headers.put("Origin", "https://www.youtube.com");
                headers.put("Referer", "https://www.youtube.com/");
            }
            httpFactory.setDefaultRequestProperties(headers);
        }
        endedNotified = false;
        long startAtMs = Math.max(0L, pendingSeekMs);
        pendingSeekMs = 0L;
        if (startAtMs > 0) {
            lastKnownPositionMs = startAtMs;
            player.setMediaItem(MediaItem.fromUri(streamUrl), startAtMs);
        } else {
            player.setMediaItem(MediaItem.fromUri(streamUrl));
        }
        applyPlayerPrefsAndEffects();
        player.prepare();
        player.play();

        if (streamUrl != null && (streamUrl.startsWith("http://") || streamUrl.startsWith("https://"))) {
            final int expectedSeq = loadSeq;
            final String cacheUrl = streamUrl;
            final String effectiveUaForCache = userAgent != null && !userAgent.isEmpty() ? userAgent : userAgentForStreamUrl(streamUrl);
            final String cacheVid = currentVideoId;
            final String cacheTitle = trackTitle;
            final String cacheArtist = trackArtist;
            final Context appCtx = getApplicationContext();
            // Delay background disk caching by 6 seconds so 100% of network bandwidth and the
            // googlevideo.com stream connection belong exclusively to ExoPlayer during startup.
            ticker.postDelayed(() -> {
                if (expectedSeq != loadSeq || player == null || !player.isPlaying()) return;
                cacheStreamToDiskAsync(appCtx, cacheUrl, effectiveUaForCache, cacheVid, cacheTitle, cacheArtist);
            }, 6000L);
        }

        session.setMetadata(buildMetadata(durationMs));
        updatePlaybackState(true, startAtMs);
        startInForeground();
        showNotification();
        updateLocks(true);

        ticker.removeCallbacks(tick);
        ticker.post(tick);
    }

    private void recoverMidSongStream(final long resumePosMs) {
        triedOnDeviceResolve = true;
        midSongRecoveryCount++;
        resolvingOnDevice = true;
        endedNotified = false;
        if (!currentVideoId.isEmpty() && midSongRecoveryCount > 1) {
            failedVideoIds.add(currentVideoId);
        }
        invalidateResolvedCacheForTrack(currentVideoId, trackTitle, trackArtist, currentUrl);
        evictCachedAudioFile(MuchiAudioService.this, currentVideoId, trackTitle, trackArtist);
        pendingSeekMs = Math.max(0L, resumePosMs);
        pendingSeekSetAtMs = android.os.SystemClock.elapsedRealtime();
        lastKnownPositionMs = pendingSeekMs;
        final int seq = loadSeq;
        final String vid = failedVideoIds.contains(currentVideoId) ? "" : currentVideoId;
        final String cands = currentCandidates;
        final String tTitle = trackTitle;
        final String tArtist = trackArtist;
        resolveExecutor.execute(() -> {
            ResolvedStream rs = resolveYoutubeStreamOnDevice(vid, cands, tTitle, tArtist);
            ticker.post(() -> {
                if (seq != loadSeq) return;
                resolvingOnDevice = false;
                if (rs != null && rs.url != null && !rs.url.isEmpty()) {
                    currentUrl = rs.url;
                    if (rs.videoId != null && !rs.videoId.isEmpty()) {
                        currentVideoId = rs.videoId;
                    }
                    if (rs.durationMs > 0 && currentDurationMs <= 0) {
                        currentDurationMs = rs.durationMs;
                    }
                    if (pendingSeekMs <= 0 && resumePosMs > 0) {
                        pendingSeekMs = resumePosMs;
                        pendingSeekSetAtMs = android.os.SystemClock.elapsedRealtime();
                    }
                    startExoPlayerWithUrl(rs.url, rs.userAgent, currentDurationMs);
                } else {
                    emitControls("error", resumePosMs);
                }
            });
        });
    }

    private static long extractDurationMsFromUrl(String url) {
        if (url == null || url.isEmpty()) return 0L;
        try {
            String target = url;
            int uIdx = target.indexOf("url=");
            int offset = 4;
            if (uIdx < 0) {
                int qU = target.indexOf("?u=");
                if (qU >= 0) {
                    uIdx = qU + 1;
                    offset = 2;
                } else {
                    int aU = target.indexOf("&u=");
                    if (aU >= 0) {
                        uIdx = aU + 1;
                        offset = 2;
                    }
                }
            }
            if (uIdx >= 0) {
                String sub = target.substring(uIdx + offset);
                int amp = sub.indexOf('&');
                target = java.net.URLDecoder.decode(amp >= 0 ? sub.substring(0, amp) : sub, "UTF-8");
            }
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?:[?&]|%26)dur(?:=|%3D)([0-9]+(?:\\.[0-9]+)?)").matcher(target);
            if (m.find()) {
                double sec = Double.parseDouble(m.group(1));
                if (sec > 0 && sec < 86400) {
                    return Math.round(sec * 1000.0);
                }
            }
        } catch (Exception ignored) {}
        return 0L;
    }

    private static String extractVideoIdFromUrl(String url) {
        if (url == null) return "";
        try {
            int idx = url.indexOf("v=");
            if (idx >= 0) {
                String rest = url.substring(idx + 2);
                int amp = rest.indexOf('&');
                return java.net.URLDecoder.decode(amp >= 0 ? rest.substring(0, amp) : rest, "UTF-8");
            }
        } catch (Exception ignored) {}
        return "";
    }

    private static String userAgentForStreamUrl(String url) {
        if (url == null) return DEFAULT_UA;
        if (url.contains("c=ANDROID_VR")) {
            return url.contains("cver=1.61")
                    ? "com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"
                    : "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";
        }
        if (url.contains("c=ANDROID_TESTSUITE")) {
            return "com.google.android.youtube/1.9 (Linux; U; Android 11) gzip";
        }
        if (url.contains("c=ANDROID")) {
            return "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip";
        }
        if (url.contains("c=IOS")) {
            return "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; en_US)";
        }
        return DEFAULT_UA;
    }

    /* ── 1.5.5 / 1.6.6 Sound Stage & Volume/Speed DSP ──────────────── */

    private void applyPlayerPrefsAndEffects() {
        if (player == null) return;
        try {
            // 1.5.5 / 1.6.6 volumeFor(volumePct, normalize) math: normalizeGain = 0.86 when on, 1.0 when off
            float normGain = prefNormalize ? 0.86f : 1.0f;
            float clampedVol = Math.max(0f, Math.min(100f, prefVolume)) / 100f;
            float targetVol = Math.min(1.0f, clampedVol * normGain);
            player.setVolume(targetVol);
        } catch (Exception ignored) {}

        try {
            float spd = Math.max(0.25f, Math.min(3.0f, prefSpeed));
            player.setPlaybackParameters(new PlaybackParameters(spd));
        } catch (Exception ignored) {}

        int sessionId = player.getAudioSessionId();
        if (sessionId == C.AUDIO_SESSION_ID_UNSET || sessionId <= 0) return;

        String mode = prefSpatial != null ? prefSpatial : "phone";
        if ("wide".equals(mode) || "motion".equals(mode)) mode = "spatial";

        try {
            if ("off".equals(mode)) {
                if (loudnessEnhancer != null) loudnessEnhancer.setEnabled(false);
                if (equalizer != null) equalizer.setEnabled(false);
                if (bassBoost != null) bassBoost.setEnabled(false);
                return;
            }

            if (loudnessEnhancer == null || currentAudioSessionId != sessionId) {
                releaseAudioEffects();
                currentAudioSessionId = sessionId;
                try {
                    loudnessEnhancer = new LoudnessEnhancer(sessionId);
                } catch (Exception ignored) {}
                try {
                    equalizer = new Equalizer(0, sessionId);
                } catch (Exception ignored) {}
                try {
                    bassBoost = new BassBoost(0, sessionId);
                } catch (Exception ignored) {}
            }

            // 1.8.5 Upgraded Native Phone Speaker Sound Stage DSP
            // (Controlled LoudnessEnhancer + Tight Upper-Bass Exciter + 6-Zone Acoustic Equalizer)
            if (loudnessEnhancer != null) {
                int gainMb = "phone".equals(mode) ? 310 : "bass".equals(mode) ? 280 : "dynamic".equals(mode) ? 240 : 200;
                loudnessEnhancer.setTargetGain(gainMb);
                loudnessEnhancer.setEnabled(true);
            }

            if (bassBoost != null && bassBoost.getStrengthSupported()) {
                short strength = (short) ("phone".equals(mode) ? 580 : "bass".equals(mode) ? 850 : "spatial".equals(mode) ? 320 : 480);
                bassBoost.setStrength(strength);
                bassBoost.setEnabled(true);
            }

            if (equalizer != null) {
                short bands = equalizer.getNumberOfBands();
                short[] range = equalizer.getBandLevelRange();
                if (bands > 0 && range != null && range.length >= 2) {
                    short minL = range[0];
                    short maxL = range[1];
                    for (short b = 0; b < bands; b++) {
                        int freqHz = equalizer.getCenterFreq(b) / 1000;
                        int targetMb = 0;
                        if ("phone".equals(mode)) {
                            // 6-Zone Micro-Speaker Acoustic Curve:
                            // Avoids sub-75Hz diaphragm excursion overload, concentrates punch in 75-160Hz,
                            // adds warmth in 160-280Hz, scoops 280-650Hz boxiness, tames 650-1600Hz nasal horn resonance,
                            // and elevates 1600-4500Hz vocal clarity + >4500Hz silk air.
                            if (freqHz <= 75) targetMb = 320;
                            else if (freqHz <= 160) targetMb = 780;
                            else if (freqHz <= 280) targetMb = 340;
                            else if (freqHz <= 650) targetMb = -320;
                            else if (freqHz <= 1600) targetMb = -80;
                            else if (freqHz <= 4500) targetMb = 340;
                            else targetMb = 310;
                        } else if ("bass".equals(mode)) {
                            if (freqHz <= 90) targetMb = 850;
                            else if (freqHz <= 200) targetMb = 420;
                            else if (freqHz <= 600) targetMb = -220;
                            else if (freqHz <= 4000) targetMb = 120;
                            else targetMb = -80;
                        } else if ("spatial".equals(mode)) {
                            if (freqHz <= 120) targetMb = 240;
                            else if (freqHz <= 600) targetMb = -140;
                            else if (freqHz <= 4000) targetMb = 240;
                            else targetMb = 320;
                        } else {
                            if (freqHz <= 120) targetMb = 550;
                            else if (freqHz <= 600) targetMb = -180;
                            else if (freqHz <= 4000) targetMb = 310;
                            else targetMb = 240;
                        }
                        short clamped = (short) Math.max(minL, Math.min(maxL, targetMb));
                        equalizer.setBandLevel(b, clamped);
                    }
                    equalizer.setEnabled(true);
                }
            }
        } catch (Exception ignored) {
            // Hardware DSP is optional per-OEM; never disrupt playback.
        }
    }

    private void releaseAudioEffects() {
        if (loudnessEnhancer != null) {
            try { loudnessEnhancer.release(); } catch (Exception ignored) {}
            loudnessEnhancer = null;
        }
        if (equalizer != null) {
            try { equalizer.release(); } catch (Exception ignored) {}
            equalizer = null;
        }
        if (bassBoost != null) {
            try { bassBoost.release(); } catch (Exception ignored) {}
            bassBoost = null;
        }
    }

    /* ── On-device YouTube InnerTube + Piped resolver ──────────────── */

    private static final ExecutorService sharedResolvePool = Executors.newCachedThreadPool();
    private static final Map<String, CachedStream> resolvedCache = new ConcurrentHashMap<>();
    private static final long RESOLVED_CACHE_TTL_MS = 20 * 60 * 1000L;
    private static final String AUDIO_CACHE_DIR_NAME = "muchi_audio_cache";
    private static final long MAX_AUDIO_CACHE_BYTES = 250L * 1024L * 1024L;
    private static final Set<String> activeAudioCacheDownloads = ConcurrentHashMap.newKeySet();

    private static boolean isOneMinuteCappedGoogleVideoUrl(String url) {
        if (url == null || url.isEmpty()) return false;
        String decoded = url;
        try {
            if (url.contains("%3A") || url.contains("%2F") || url.contains("%26") || url.contains("%3D")) {
                decoded = java.net.URLDecoder.decode(url, "UTF-8");
            }
        } catch (Exception ignored) {}
        String low = decoded.toLowerCase();
        if (!low.contains("googlevideo.com")) return false;
        return low.contains("&c=ios&") || low.contains("?c=ios&") || low.endsWith("&c=ios")
                || low.contains("&c=android&") || low.contains("?c=android&") || low.endsWith("&c=android");
    }

    private static File getAudioCacheDir(Context ctx) {
        if (ctx == null) return null;
        File dir = new File(ctx.getCacheDir(), AUDIO_CACHE_DIR_NAME);
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return dir;
    }

    private static String sanitizeAudioCacheKey(String raw) {
        if (raw == null || raw.trim().isEmpty()) return "";
        String cleaned = raw.trim().replaceAll("[^A-Za-z0-9._-]", "_");
        if (cleaned.length() > 96) {
            cleaned = cleaned.substring(0, 64) + "_" + Integer.toHexString(raw.hashCode());
        }
        return cleaned;
    }

    public static File getCachedAudioFile(Context ctx, String videoId, String title, String artist) {
        File dir = getAudioCacheDir(ctx);
        if (dir == null || !dir.exists()) return null;
        final long minValidBytes = 262144L;
        final long minUncappedBytes = 1150000L; // >1.15 MB minimum to reject 960KB (983,040-byte) 1-minute capped streams
        if (videoId != null && !videoId.trim().isEmpty()) {
            File vf = new File(dir, sanitizeAudioCacheKey("vid_" + videoId.trim()) + ".m4a");
            if (vf.exists()) {
                if (vf.length() >= minValidBytes && vf.length() >= minUncappedBytes && vf.length() != 983040L) {
                    //noinspection ResultOfMethodCallIgnored
                    vf.setLastModified(System.currentTimeMillis());
                    return vf;
                } else {
                    //noinspection ResultOfMethodCallIgnored
                    vf.delete();
                }
            }
        }
        String qKey = queryCacheKey(title, artist);
        if (!qKey.isEmpty()) {
            File qf = new File(dir, sanitizeAudioCacheKey(qKey) + ".m4a");
            if (qf.exists()) {
                if (qf.length() >= minValidBytes && qf.length() >= minUncappedBytes && qf.length() != 983040L) {
                    //noinspection ResultOfMethodCallIgnored
                    qf.setLastModified(System.currentTimeMillis());
                    return qf;
                } else {
                    //noinspection ResultOfMethodCallIgnored
                    qf.delete();
                }
            }
        }
        return null;
    }

    public static void evictCachedAudioFile(Context ctx, String videoId, String title, String artist) {
        File dir = getAudioCacheDir(ctx);
        if (dir == null || !dir.exists()) return;
        if (videoId != null && !videoId.trim().isEmpty()) {
            File vf = new File(dir, sanitizeAudioCacheKey("vid_" + videoId.trim()) + ".m4a");
            if (vf.exists()) {
                //noinspection ResultOfMethodCallIgnored
                vf.delete();
            }
        }
        String qKey = queryCacheKey(title, artist);
        if (!qKey.isEmpty()) {
            File qf = new File(dir, sanitizeAudioCacheKey(qKey) + ".m4a");
            if (qf.exists()) {
                //noinspection ResultOfMethodCallIgnored
                qf.delete();
            }
        }
    }

    private static void pruneAudioCacheDir(File dir) {
        if (dir == null || !dir.exists()) return;
        File[] files = dir.listFiles();
        if (files == null || files.length == 0) return;
        long total = 0L;
        for (File f : files) {
            if (f != null && f.isFile()) total += f.length();
        }
        if (total <= MAX_AUDIO_CACHE_BYTES) return;
        Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (File f : files) {
            if (f == null || !f.isFile()) continue;
            long len = f.length();
            if (f.delete()) {
                total -= len;
                if (total <= (MAX_AUDIO_CACHE_BYTES * 80L) / 100L) break;
            }
        }
    }

    private static void cacheStreamToDiskAsync(final Context ctx, final String streamUrl, final String userAgent,
                                               final String videoId, final String title, final String artist) {
        if (ctx == null || streamUrl == null || streamUrl.isEmpty()) return;
        if (getCachedAudioFile(ctx, videoId, title, artist) != null) return;
        final String primaryKey = (videoId != null && !videoId.trim().isEmpty())
                ? sanitizeAudioCacheKey("vid_" + videoId.trim())
                : sanitizeAudioCacheKey(queryCacheKey(title, artist));
        if (primaryKey.isEmpty()) return;
        final String secondaryKey = (videoId != null && !videoId.trim().isEmpty() && title != null && !title.trim().isEmpty())
                ? sanitizeAudioCacheKey(queryCacheKey(title, artist))
                : "";
        if (!activeAudioCacheDownloads.add(primaryKey)) return;

        sharedResolvePool.execute(() -> {
            File tmpFile = null;
            HttpURLConnection con = null;
            try {
                File dir = getAudioCacheDir(ctx);
                if (dir == null) return;
                File targetFile = new File(dir, primaryKey + ".m4a");
                if (targetFile.exists() && targetFile.length() >= 262144L) return;
                // Never open a second competing HTTP download connection to googlevideo.com while
                // ExoPlayer is actively streaming that single-session token (prevents ~1-minute stream cutoffs).
                if (streamUrl.contains("googlevideo.com") || streamUrl.toLowerCase().contains("googlevideo.com") || isOneMinuteCappedGoogleVideoUrl(streamUrl)) {
                    return;
                }
                long urlClen = 0L;
                try {
                    java.util.regex.Matcher mClen = java.util.regex.Pattern.compile("(?:[?&]|%26)clen(?:=|%3D)([0-9]+)").matcher(streamUrl);
                    if (mClen.find()) {
                        urlClen = Long.parseLong(mClen.group(1));
                    }
                } catch (Exception ignored) {}
                tmpFile = new File(dir, primaryKey + "." + System.currentTimeMillis() + ".tmp");
                con = (HttpURLConnection) new URL(streamUrl).openConnection();
                con.setConnectTimeout(10000);
                con.setReadTimeout(20000);
                con.setInstanceFollowRedirects(true);
                con.setRequestProperty("User-Agent", userAgent != null && !userAgent.isEmpty() ? userAgent : DEFAULT_UA);
                if (streamUrl.contains("googlevideo.com")
                        && !streamUrl.contains("c=ANDROID")
                        && !streamUrl.contains("c=IOS")) {
                    con.setRequestProperty("Origin", "https://www.youtube.com");
                    con.setRequestProperty("Referer", "https://www.youtube.com/");
                }
                int code = con.getResponseCode();
                if (code >= 200 && code < 300) {
                    long headerLen = con.getContentLengthLong();
                    long expectedBytes = headerLen > 0 ? headerLen : urlClen;
                    long written = 0L;
                    try (InputStream in = con.getInputStream();
                         FileOutputStream fos = new FileOutputStream(tmpFile)) {
                        byte[] buf = new byte[32768];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            fos.write(buf, 0, n);
                            written += n;
                            if (written > 45L * 1024L * 1024L) break;
                        }
                        fos.flush();
                    }
                    boolean completeEnough = written >= 1150000L && written != 983040L
                            && (expectedBytes <= 0L || written >= (expectedBytes * 98L) / 100L);
                    if (completeEnough) {
                        if (targetFile.exists()) {
                            //noinspection ResultOfMethodCallIgnored
                            targetFile.delete();
                        }
                        if (tmpFile.renameTo(targetFile)) {
                            tmpFile = null;
                            if (!secondaryKey.isEmpty() && !secondaryKey.equals(primaryKey)) {
                                File secFile = new File(dir, secondaryKey + ".m4a");
                                if (!secFile.exists()) {
                                    try (InputStream fis = new java.io.FileInputStream(targetFile);
                                         FileOutputStream sfos = new FileOutputStream(secFile)) {
                                        byte[] buf = new byte[32768];
                                        int n;
                                        while ((n = fis.read(buf)) > 0) sfos.write(buf, 0, n);
                                    } catch (Exception ignored) {}
                                }
                            }
                            pruneAudioCacheDir(dir);
                        }
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (con != null) con.disconnect();
                if (tmpFile != null && tmpFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tmpFile.delete();
                }
                activeAudioCacheDownloads.remove(primaryKey);
            }
        });
    }

    private static class CachedStream {
        final ResolvedStream stream;
        final long expiresAt;
        CachedStream(ResolvedStream stream, long expiresAt) {
            this.stream = stream;
            this.expiresAt = expiresAt;
        }
    }

    public static void invalidateResolvedCache(String videoId) {
        if (videoId != null && !videoId.trim().isEmpty()) {
            resolvedCache.remove(videoId.trim());
        }
    }

    public static void invalidateResolvedCacheForTrack(String videoId, String title, String artist, String failedUrl) {
        if (videoId != null && !videoId.trim().isEmpty()) {
            resolvedCache.remove(videoId.trim());
        }
        String qKey = queryCacheKey(title, artist);
        if (!qKey.isEmpty()) {
            resolvedCache.remove(qKey);
        }
        if (failedUrl != null && !failedUrl.isEmpty()) {
            for (Map.Entry<String, CachedStream> entry : resolvedCache.entrySet()) {
                CachedStream cs = entry.getValue();
                if (cs != null && cs.stream != null && failedUrl.equals(cs.stream.url)) {
                    resolvedCache.remove(entry.getKey());
                }
            }
        }
    }

    private static ResolvedStream getCachedStream(String videoId) {
        if (videoId == null || videoId.trim().isEmpty()) return null;
        String key = videoId.trim();
        CachedStream cs = resolvedCache.get(key);
        if (cs == null) return null;
        if (cs.expiresAt <= System.currentTimeMillis()) {
            resolvedCache.remove(key);
            return null;
        }
        return cs.stream;
    }

    private static void putCachedStream(String videoId, ResolvedStream rs) {
        if (videoId == null || videoId.trim().isEmpty() || rs == null || rs.url == null || rs.url.isEmpty()) return;
        if (resolvedCache.size() > 200) {
            resolvedCache.clear();
        }
        resolvedCache.put(videoId.trim(), new CachedStream(rs, System.currentTimeMillis() + RESOLVED_CACHE_TTL_MS));
    }

    private static String queryCacheKey(String title, String artist) {
        if (title == null || title.trim().isEmpty()) return "";
        String t = title.trim().toLowerCase();
        String a = artist != null ? artist.trim().toLowerCase() : "";
        return "q:" + t + "|" + a;
    }

    public static void preloadStream(String primaryVid, String candidatesCsv, String title, String artist) {
        if ((primaryVid == null || primaryVid.trim().isEmpty()) && (title == null || title.trim().isEmpty())) return;
        if (primaryVid != null && !primaryVid.trim().isEmpty() && getCachedStream(primaryVid) != null) return;
        String qKey = queryCacheKey(title, artist);
        if (!qKey.isEmpty() && getCachedStream(qKey) != null) return;
        sharedResolvePool.execute(() -> {
            try {
                resolveYoutubeStreamStatic(primaryVid, candidatesCsv, title, artist, sharedResolvePool);
            } catch (Exception ignored) {}
        });
    }

    public static class ResolvedStream {
        public final String url;
        public final String userAgent;
        public final long durationMs;
        public final String mimeType;
        public final String videoId;
        public ResolvedStream(String url, String userAgent, long durationMs) {
            this(url, userAgent, durationMs, "audio/mp4", "");
        }
        public ResolvedStream(String url, String userAgent, long durationMs, String mimeType) {
            this(url, userAgent, durationMs, mimeType, "");
        }
        public ResolvedStream(String url, String userAgent, long durationMs, String mimeType, String videoId) {
            this.url = url;
            this.userAgent = userAgent;
            this.durationMs = durationMs;
            this.mimeType = mimeType != null && !mimeType.isEmpty() ? mimeType : "audio/mp4";
            this.videoId = videoId != null ? videoId : "";
        }
    }

    private static boolean isDurationAcceptableStatic(long gotDurationMs, long expectedDurationMs) {
        if (gotDurationMs > 0L && gotDurationMs < 45000L) {
            return false; // Always reject <45s YouTube Shorts, teasers, and 30s previews
        }
        if (expectedDurationMs >= 65000L && gotDurationMs > 0L) {
            long minAllowed = (expectedDurationMs * 60L) / 100L;
            long maxAllowed = (expectedDurationMs * 165L) / 100L + 45000L;
            if (gotDurationMs < minAllowed || gotDurationMs > maxAllowed) {
                return false;
            }
        }
        return true;
    }

    private static boolean isVideoTitleAcceptableStatic(String gotTitle, String expectedTitle) {
        return isVideoMetadataAcceptableStatic(gotTitle, "", "", expectedTitle, "");
    }

    private static boolean isVideoMetadataAcceptableStatic(String gotTitle, String gotAuthor, String gotShortDesc,
                                                           String expectedTitle, String expectedArtist) {
        if (gotTitle == null || gotTitle.trim().isEmpty()) {
            return true;
        }
        String wantTitleRaw = expectedTitle != null ? expectedTitle.trim().toLowerCase() : "";
        String wantArtistRaw = expectedArtist != null ? expectedArtist.trim().toLowerCase() : "";
        String gotT = gotTitle.trim().toLowerCase();
        String gotA = gotAuthor != null ? gotAuthor.trim().toLowerCase() : "";
        String gotD = gotShortDesc != null ? gotShortDesc.trim().toLowerCase() : "";
        String combinedMeta = (gotT + " " + gotA + " " + gotD).replaceAll("[^a-z0-9]+", " ").trim();

        boolean wantIsRemix = (wantTitleRaw + " " + wantArtistRaw).matches(".*\\b(remix|re-mix|bootleg|flip|mashup|cover|sped\\s*up|slowed|reverb|nightcore|8d|edit|remake|karaoke|instrumental|live|acoustic|lullaby|8-bit|orchestra|symphony|piano)\\b.*");
        if (!wantIsRemix) {
            if ((gotT + " " + gotA).matches(".*\\b(remix|re-mix|bootleg|flip|mashup|cover|sped\\s*up|slowed|reverb|nightcore|8d|bass\\s*boosted|karaoke|instrumental|tribute|parody|reaction|ringtone|lullaby|8-bit|bardcore|medieval|symphony|orchestra)\\b.*")) {
                return false;
            }
        }

        if (!wantTitleRaw.isEmpty()) {
            String coreWantTitle = wantTitleRaw
                    .replaceAll("\\s*[\\[(][^)\\]]*[)\\]]", " ")
                    .replaceAll("(?i)\\b(feat\\.?|ft\\.?|featuring|with|official|audio|video|lyrics?|remastered|version)\\b.*$", " ")
                    .replaceAll("[^a-z0-9]+", " ")
                    .trim();
            String gotTitleClean = gotT.replaceAll("[^a-z0-9]+", " ").trim();
            if (coreWantTitle.length() >= 3 && !gotTitleClean.isEmpty()) {
                String[] titleWords = coreWantTitle.split("\\s+");
                int matchedWords = 0;
                int significantWords = 0;
                for (String w : titleWords) {
                    if (w.length() >= 2 && !w.matches("^(the|and|for|with|from)$")) {
                        significantWords++;
                        if (gotTitleClean.contains(w)) matchedWords++;
                    }
                }
                if (significantWords > 0 && matchedWords == 0) {
                    return false;
                }
            }
        }

        if (!wantArtistRaw.isEmpty() && !wantArtistRaw.matches("^(youtube|unknown|various artists|artist|muchi)$")) {
            String[] artistCandidates = wantArtistRaw
                    .replaceAll("\\s*[\\[(][^)\\]]*[)\\]]", " ")
                    .split("(?i)\\s*(?:,|&|/|\\bfeat\\.?|\\bft\\.?|\\bfeaturing\\b|\\bwith\\b|\\bx\\b)\\s*");
            boolean anyArtistChecked = false;
            boolean anyArtistMatched = false;
            String combinedNoSpace = combinedMeta.replace(" ", "");
            for (String rawCand : artistCandidates) {
                String candArtist = rawCand != null ? rawCand.replaceAll("[^a-z0-9]+", " ").trim() : "";
                if (candArtist.length() < 2) continue;
                anyArtistChecked = true;
                String candNoSpace = candArtist.replace(" ", "");
                if (combinedMeta.contains(candArtist) || (!candNoSpace.isEmpty() && combinedNoSpace.contains(candNoSpace))) {
                    anyArtistMatched = true;
                    break;
                }
                String[] artTokens = candArtist.split("\\s+");
                int sigArtTokens = 0;
                int matchedArtTokens = 0;
                for (String tok : artTokens) {
                    if (tok.length() >= 3 && !tok.matches("^(the|and|band|dj|mc|lil|young)$")) {
                        sigArtTokens++;
                        if (combinedMeta.contains(tok)) matchedArtTokens++;
                    }
                }
                if (sigArtTokens > 0 && matchedArtTokens == sigArtTokens) {
                    anyArtistMatched = true;
                    break;
                }
            }
            if (anyArtistChecked && !anyArtistMatched) {
                return false;
            }
        }
        return true;
    }

    public static ResolvedStream resolveStreamForDownload(String primaryVid, String candidatesCsv, String title, String artist) {
        return resolveYoutubeStreamStatic(primaryVid, candidatesCsv, title, artist, sharedResolvePool);
    }

    private ResolvedStream resolveYoutubeStreamOnDevice(String primaryVid, String candidatesCsv, String title, String artist) {
        return resolveYoutubeStreamStatic(primaryVid, candidatesCsv, title, artist, currentDurationMs, failedVideoIds, sharedResolvePool);
    }

    private static ResolvedStream resolveYoutubeStreamStatic(String primaryVid, String candidatesCsv, String title, String artist, ExecutorService pool) {
        return resolveYoutubeStreamStatic(primaryVid, candidatesCsv, title, artist, 0L, null, pool);
    }

    private static ResolvedStream resolveYoutubeStreamStatic(String primaryVid, String candidatesCsv, String title, String artist,
                                                             long expectedDurationMs, Set<String> excludedVids, ExecutorService pool) {
        String qKey = queryCacheKey(title, artist);
        boolean hasExclusions = excludedVids != null && !excludedVids.isEmpty();
        if (primaryVid != null && !primaryVid.trim().isEmpty() && (!hasExclusions || !excludedVids.contains(primaryVid.trim()))) {
            ResolvedStream cachedHit = getCachedStream(primaryVid);
            if (cachedHit != null && isDurationAcceptableStatic(cachedHit.durationMs, expectedDurationMs)) return cachedHit;
        }
        if (!qKey.isEmpty() && !hasExclusions) {
            ResolvedStream cachedQ = getCachedStream(qKey);
            if (cachedQ != null && isDurationAcceptableStatic(cachedQ.durationMs, expectedDurationMs)) return cachedQ;
        }
        List<String> vids = new ArrayList<>();
        if (primaryVid != null && !primaryVid.trim().isEmpty()) {
            String pv = primaryVid.trim();
            if (!hasExclusions || !excludedVids.contains(pv)) {
                vids.add(pv);
            }
        }
        if (candidatesCsv != null && !candidatesCsv.isEmpty()) {
            for (String part : candidatesCsv.split(",")) {
                String c = part.trim();
                if (!c.isEmpty() && !vids.contains(c) && (!hasExclusions || !excludedVids.contains(c))) {
                    vids.add(c);
                }
            }
        }
        for (String vid : vids) {
            ResolvedStream cachedCand = getCachedStream(vid);
            if (cachedCand != null && isDurationAcceptableStatic(cachedCand.durationMs, expectedDurationMs)) {
                if (primaryVid != null && !primaryVid.trim().isEmpty()) putCachedStream(primaryVid, cachedCand);
                if (!qKey.isEmpty()) putCachedStream(qKey, cachedCand);
                return cachedCand;
            }
        }

        // Always use the unbounded sharedResolvePool for concurrent child tasks so calling
        // from a single-threaded executor (like resolveExecutor) never deadlocks!
        final ExecutorService exec = sharedResolvePool;
        final String cleanTitle = title != null ? title.trim() : "";
        final String cleanArtist = artist != null ? artist.trim() : "";

        // Always kick off a fast standard YouTube WEB search concurrently when we have a song title
        // so if primaryVid is empty (iTunes/Deezer) or a gated VEVO/Topic video, playable official
        // audio/lyric videoIds are ready in ~350ms with zero sequential delay!
        java.util.concurrent.Future<List<String>> searchFuture = null;
        if (!cleanTitle.isEmpty()) {
            final String searchQ = (cleanTitle + " " + cleanArtist).trim();
            searchFuture = exec.submit(() -> searchInnertubeVideoIdsStatic(searchQ));
        }

        // Probe available candidate videoIds in parallel (up to 5 concurrently)
        if (!vids.isEmpty()) {
            ResolvedStream directHit = probeMultipleVideoIdsParallel(vids, Math.min(5, vids.size()), expectedDurationMs, cleanTitle, cleanArtist, exec);
            if (directHit != null) {
                if (searchFuture != null) searchFuture.cancel(true);
                if (primaryVid != null && !primaryVid.trim().isEmpty()) putCachedStream(primaryVid, directHit);
                if (!qKey.isEmpty()) putCachedStream(qKey, directHit);
                return directHit;
            }
        }

        // Check results from concurrent YouTube search and probe top candidates in parallel
        if (!cleanTitle.isEmpty()) {
            List<String> searched = null;
            if (searchFuture != null) {
                try {
                    searched = searchFuture.get(2500, java.util.concurrent.TimeUnit.MILLISECONDS);
                } catch (Exception ignored) {
                    searchFuture.cancel(true);
                }
            }
            if (searched == null || searched.isEmpty()) {
                String q = (cleanTitle + " " + cleanArtist).trim();
                searched = searchInnertubeVideoIdsStatic(q);
            }
            List<String> freshSearchVids = new ArrayList<>();
            if (searched != null) {
                for (String svid : searched) {
                    if (svid != null && !svid.isEmpty() && !vids.contains(svid) && !freshSearchVids.contains(svid)
                            && (!hasExclusions || !excludedVids.contains(svid))) {
                        freshSearchVids.add(svid);
                        vids.add(svid);
                    }
                }
            }
            if (!freshSearchVids.isEmpty()) {
                ResolvedStream searchHit = probeMultipleVideoIdsParallel(freshSearchVids, Math.min(5, freshSearchVids.size()), expectedDurationMs, cleanTitle, cleanArtist, exec);
                if (searchHit != null) {
                    if (primaryVid != null && !primaryVid.trim().isEmpty()) putCachedStream(primaryVid, searchHit);
                    if (!qKey.isEmpty()) putCachedStream(qKey, searchHit);
                    return searchHit;
                }
            }
        }

        // Fast parallel fallback: race Cloudflare backend (/api/yt/stream) and Piped instances concurrently
        // (Never call SoundCloud or Audius fallbacks here so YouTube/iTunes/Deezer tracks never play remixes)
        java.util.concurrent.CompletionService<ResolvedStream> fallbackRace =
                new java.util.concurrent.ExecutorCompletionService<>(exec);
        List<java.util.concurrent.Future<ResolvedStream>> fbFutures = new ArrayList<>();
        final String cfVid = !vids.isEmpty() ? vids.get(0) : (primaryVid != null ? primaryVid.trim() : "");
        fbFutures.add(fallbackRace.submit(() -> probeCloudflareBackendStatic(cfVid, candidatesCsv, cleanTitle, cleanArtist, expectedDurationMs)));
        for (int i = 0; i < Math.min(3, vids.size()); i++) {
            final String pVid = vids.get(i);
            fbFutures.add(fallbackRace.submit(() -> probePipedForVideoStatic(pVid, expectedDurationMs, cleanTitle, cleanArtist)));
        }
        try {
            for (int i = 0; i < fbFutures.size(); i++) {
                java.util.concurrent.Future<ResolvedStream> done =
                        fallbackRace.poll(4200, java.util.concurrent.TimeUnit.MILLISECONDS);
                if (done == null) break;
                try {
                    ResolvedStream rs = done.get();
                    if (rs != null && rs.url != null && !rs.url.isEmpty()) {
                        if (primaryVid != null && !primaryVid.trim().isEmpty()) putCachedStream(primaryVid, rs);
                        if (!qKey.isEmpty()) putCachedStream(qKey, rs);
                        return rs;
                    }
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {
        } finally {
            for (java.util.concurrent.Future<ResolvedStream> f : fbFutures) {
                f.cancel(true);
            }
        }
        return null;
    }

    private static ResolvedStream probeMultipleVideoIdsParallel(List<String> videoIds, int maxConcurrent, long expectedDurationMs, String expectedTitle, String expectedArtist, ExecutorService pool) {
        if (videoIds == null || videoIds.isEmpty()) return null;
        int count = Math.min(maxConcurrent, videoIds.size());
        final ExecutorService exec = pool != null ? pool : sharedResolvePool;
        java.util.concurrent.CompletionService<ResolvedStream> race =
                new java.util.concurrent.ExecutorCompletionService<>(exec);
        List<java.util.concurrent.Future<ResolvedStream>> futures = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            final String vid = videoIds.get(i);
            futures.add(race.submit(() -> {
                ResolvedStream cached = getCachedStream(vid);
                if (cached != null && isDurationAcceptableStatic(cached.durationMs, expectedDurationMs)) return cached;
                ResolvedStream r = probeInnertubeForVideoStatic(vid, expectedDurationMs, expectedTitle, expectedArtist, exec);
                if (r != null) putCachedStream(vid, r);
                return r;
            }));
        }
        long deadlineMs = System.currentTimeMillis() + 2600L;
        try {
            // All candidates run concurrently in parallel; check in priority order (0, 1, 2...)
            // so the primary official videoId always wins over secondary fallback candidates.
            for (int i = 0; i < futures.size(); i++) {
                long waitMs = Math.max(150L, deadlineMs - System.currentTimeMillis());
                try {
                    ResolvedStream rs = futures.get(i).get(waitMs, java.util.concurrent.TimeUnit.MILLISECONDS);
                    if (rs != null && rs.url != null && !rs.url.isEmpty()) {
                        return rs;
                    }
                } catch (Exception ignored) {}
            }
            for (int i = 0; i < count; i++) {
                java.util.concurrent.Future<ResolvedStream> done =
                        race.poll(50, java.util.concurrent.TimeUnit.MILLISECONDS);
                if (done == null) break;
                try {
                    ResolvedStream rs = done.get();
                    if (rs != null && rs.url != null && !rs.url.isEmpty()) {
                        return rs;
                    }
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {
        } finally {
            for (java.util.concurrent.Future<ResolvedStream> f : futures) {
                f.cancel(true);
            }
        }
        return null;
    }

    private static ResolvedStream probeInnertubeForVideoStatic(String videoId, long expectedDurationMs, String expectedTitle, String expectedArtist, ExecutorService pool) {
        if (videoId == null || videoId.isEmpty()) return null;
        // Tier 1: Race ANDROID_VR (1.61.48 & 1.60.19) and ANDROID_TESTSUITE (1.9) first!
        // Unlike IOS/ANDROID profiles (which enforce a 1MB open-ended Range ceiling on googlevideo),
        // ANDROID_VR and ANDROID_TESTSUITE return full-length streams that play from 0:00 to end
        // without mid-song range cutoffs.
        String[][] primaryProfiles = new String[][] {
            {
                "28",
                "1.61.48",
                "com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
                "{\"context\":{\"client\":{\"clientName\":\"ANDROID_VR\",\"clientVersion\":\"1.61.48\",\"androidSdkVersion\":32,\"osName\":\"Android\",\"osVersion\":\"12L\",\"deviceMake\":\"Oculus\",\"deviceModel\":\"Quest 3\",\"hl\":\"en\",\"gl\":\"US\"}},\"videoId\":\"" + videoId + "\",\"contentCheckOk\":true,\"racyCheckOk\":true}"
            },
            {
                "28",
                "1.60.19",
                "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
                "{\"context\":{\"client\":{\"clientName\":\"ANDROID_VR\",\"clientVersion\":\"1.60.19\",\"androidSdkVersion\":32,\"osName\":\"Android\",\"osVersion\":\"12L\",\"deviceMake\":\"Oculus\",\"deviceModel\":\"Quest 3\",\"hl\":\"en\",\"gl\":\"US\"}},\"videoId\":\"" + videoId + "\",\"contentCheckOk\":true,\"racyCheckOk\":true}"
            },
            {
                "30",
                "1.9",
                "com.google.android.youtube/1.9 (Linux; U; Android 11) gzip",
                "{\"context\":{\"client\":{\"clientName\":\"ANDROID_TESTSUITE\",\"clientVersion\":\"1.9\",\"androidSdkVersion\":30,\"osName\":\"Android\",\"osVersion\":\"11\",\"hl\":\"en\",\"gl\":\"US\"}},\"videoId\":\"" + videoId + "\",\"contentCheckOk\":true,\"racyCheckOk\":true}"
            }
        };
        ResolvedStream hit = probeInnertubeBatchStatic(videoId, primaryProfiles, expectedDurationMs, expectedTitle, expectedArtist, sharedResolvePool);
        return hit;
    }

    private static ResolvedStream probeInnertubeBatchStatic(final String videoId, String[][] profiles, final long expectedDurationMs, final String expectedTitle, final String expectedArtist, ExecutorService pool) {
        java.util.concurrent.CompletionService<ResolvedStream> ecs =
                new java.util.concurrent.ExecutorCompletionService<>(pool != null ? pool : sharedResolvePool);
        List<java.util.concurrent.Future<ResolvedStream>> futures = new ArrayList<>();
        for (String[] prof : profiles) {
            final String clientId = prof[0];
            final String clientVer = prof[1];
            final String ua = prof[2];
            final String body = prof[3];
            futures.add(ecs.submit(() -> {
                HttpURLConnection con = null;
                try {
                    con = (HttpURLConnection) new URL("https://www.youtube.com/youtubei/v1/player?prettyPrint=false").openConnection();
                    con.setRequestMethod("POST");
                    con.setConnectTimeout(2500);
                    con.setReadTimeout(3000);
                    con.setDoOutput(true);
                    con.setRequestProperty("Content-Type", "application/json");
                    con.setRequestProperty("X-YouTube-Client-Name", clientId);
                    con.setRequestProperty("X-YouTube-Client-Version", clientVer);
                    con.setRequestProperty("User-Agent", ua);
                    byte[] outBytes = body.getBytes(StandardCharsets.UTF_8);
                    try (OutputStream os = con.getOutputStream()) {
                        os.write(outBytes);
                    }
                    if (con.getResponseCode() == 200) {
                        String jsonStr = readStreamString(con.getInputStream());
                        JSONObject root = new JSONObject(jsonStr);
                        JSONObject playability = root.optJSONObject("playabilityStatus");
                        String status = playability != null ? playability.optString("status", "OK") : "OK";
                        if (!"OK".equals(status)) return null;
                        JSONObject streamingData = root.optJSONObject("streamingData");
                        if (streamingData == null) return null;
                        JSONArray adaptive = streamingData.optJSONArray("adaptiveFormats");
                        if (adaptive == null || adaptive.length() == 0) return null;

                        String bestM4aUrl = "";
                        int bestM4aBitrate = -1;
                        String bestOpusUrl = "";
                        int bestOpusBitrate = -1;

                        for (int i = 0; i < adaptive.length(); i++) {
                            JSONObject fmt = adaptive.optJSONObject(i);
                            if (fmt == null) continue;
                            String u = fmt.optString("url", "");
                            String mime = fmt.optString("mimeType", "").toLowerCase();
                            int br = fmt.optInt("bitrate", 0);
                            if (u.isEmpty() || !mime.startsWith("audio/")) continue;
                            if (mime.contains("mp4") || mime.contains("m4a")) {
                                if (br > bestM4aBitrate) {
                                    bestM4aBitrate = br;
                                    bestM4aUrl = u;
                                }
                            } else if (mime.contains("webm") || mime.contains("opus")) {
                                if (br > bestOpusBitrate) {
                                    bestOpusBitrate = br;
                                    bestOpusUrl = u;
                                }
                            }
                        }

                        // Prefer AAC/M4A (itag 140, ~128kbps) when available (>=96kbps) so ExoPlayer gets an MP4
                        // sidx index for instant range-request seeking and never hits WebM Cues seek stalls.
                        boolean useM4a = !bestM4aUrl.isEmpty() && (bestOpusUrl.isEmpty() || bestM4aBitrate >= 96000);
                        String chosen = useM4a ? bestM4aUrl : (!bestOpusUrl.isEmpty() ? bestOpusUrl : bestM4aUrl);
                        String chosenMime = useM4a || bestOpusUrl.isEmpty() ? "audio/mp4" : "audio/webm";
                        if (!chosen.isEmpty()) {
                            long durMs = 0L;
                            String vdTitle = "";
                            String vdAuthor = "";
                            String vdShortDesc = "";
                            JSONObject vd = root.optJSONObject("videoDetails");
                            if (vd != null) {
                                durMs = vd.optLong("lengthSeconds", 0L) * 1000L;
                                vdTitle = vd.optString("title", "");
                                vdAuthor = vd.optString("author", "");
                                vdShortDesc = vd.optString("shortDescription", "");
                            }
                            if (!isVideoMetadataAcceptableStatic(vdTitle, vdAuthor, vdShortDesc, expectedTitle, expectedArtist)) {
                                return null;
                            }
                            if (durMs <= 0) {
                                durMs = extractDurationMsFromUrl(chosen);
                            }
                            if (!isDurationAcceptableStatic(durMs, expectedDurationMs)) {
                                return null;
                            }
                            return new ResolvedStream(chosen, ua, durMs, chosenMime, videoId);
                        }
                    }
                } catch (Exception ignored) {
                } finally {
                    if (con != null) con.disconnect();
                }
                return null;
            }));
        }

        try {
            for (int i = 0; i < profiles.length; i++) {
                java.util.concurrent.Future<ResolvedStream> done =
                        ecs.poll(3500, java.util.concurrent.TimeUnit.MILLISECONDS);
                if (done == null) break;
                try {
                    ResolvedStream rs = done.get();
                    if (rs != null && rs.url != null && !rs.url.isEmpty()) {
                        return rs;
                    }
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {
        } finally {
            for (java.util.concurrent.Future<ResolvedStream> f : futures) {
                f.cancel(true);
            }
        }
        return null;
    }

    private static List<String> searchInnertubeVideoIdsStatic(String query) {
        List<String> out = new ArrayList<>();
        String cleanQ = query.replaceAll("(?i)\\bofficial\\s+audio\\b", "").replaceAll("\\s+", " ").trim();
        if (cleanQ.isEmpty()) cleanQ = query.trim();
        String safeCleanQ = cleanQ.replace("\\", "\\\\").replace("\"", "\\\"");
        String safeRawQ = (cleanQ + " official audio").replace("\\", "\\\\").replace("\"", "\\\"");

        // 1. Primary: Standard YouTube WEB search ("<cleanQ> official audio")
        //    Returns standard YouTube official audio/lyric/video IDs that ANDROID_VR can stream directly on-device
        //    (whereas WEB_REMIX - Topic IDs are often gated on ANDROID_VR).
        HttpURLConnection con2 = null;
        try {
            con2 = (HttpURLConnection) new URL("https://www.youtube.com/youtubei/v1/search?prettyPrint=false").openConnection();
            con2.setRequestMethod("POST");
            con2.setConnectTimeout(2200);
            con2.setReadTimeout(2600);
            con2.setDoOutput(true);
            con2.setRequestProperty("Content-Type", "application/json");
            con2.setRequestProperty("Origin", "https://www.youtube.com");
            con2.setRequestProperty("Referer", "https://www.youtube.com/");
            con2.setRequestProperty("User-Agent", DEFAULT_UA);
            String payload = "{\"context\":{\"client\":{\"clientName\":\"WEB\",\"clientVersion\":\"2.20240815.00.00\",\"hl\":\"en\",\"gl\":\"US\"}},\"query\":\"" + safeRawQ + "\"}";
            try (OutputStream os = con2.getOutputStream()) {
                os.write(payload.getBytes(StandardCharsets.UTF_8));
            }
            if (con2.getResponseCode() == 200) {
                String text = readStreamString(con2.getInputStream());
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"videoRenderer\"\\s*:\\s*\\{\\s*\"videoId\"\\s*:\\s*\"([A-Za-z0-9_-]{11})\"").matcher(text);
                while (m.find() && out.size() < 6) {
                    String vid = m.group(1);
                    if (vid != null && !out.contains(vid)) out.add(vid);
                }
                if (out.isEmpty()) {
                    java.util.regex.Matcher mAny = java.util.regex.Pattern.compile("\"videoId\"\\s*:\\s*\"([A-Za-z0-9_-]{11})\"").matcher(text);
                    while (mAny.find() && out.size() < 5) {
                        String vid = mAny.group(1);
                        if (vid != null && !out.contains(vid)) out.add(vid);
                    }
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (con2 != null) con2.disconnect();
        }
        if (out.size() >= 3) return out;

        // 2a. Secondary: YouTube Music WEB_REMIX Songs-shelf search (params: EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D)
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL("https://music.youtube.com/youtubei/v1/search?prettyPrint=false").openConnection();
            con.setRequestMethod("POST");
            con.setConnectTimeout(2200);
            con.setReadTimeout(2600);
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "application/json");
            con.setRequestProperty("Origin", "https://music.youtube.com");
            con.setRequestProperty("Referer", "https://music.youtube.com/");
            con.setRequestProperty("User-Agent", DEFAULT_UA);
            String payload = "{\"context\":{\"client\":{\"clientName\":\"WEB_REMIX\",\"clientVersion\":\"1.20240814.01.00\",\"hl\":\"en\",\"gl\":\"US\"}},\"query\":\"" + safeCleanQ + "\",\"params\":\"EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D\"}";
            try (OutputStream os = con.getOutputStream()) {
                os.write(payload.getBytes(StandardCharsets.UTF_8));
            }
            if (con.getResponseCode() == 200) {
                String text = readStreamString(con.getInputStream());
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"videoId\"\\s*:\\s*\"([A-Za-z0-9_-]{11})\"").matcher(text);
                while (m.find() && out.size() < 6) {
                    String vid = m.group(1);
                    if (vid != null && !out.contains(vid)) out.add(vid);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (con != null) con.disconnect();
        }
        return out;
    }

    private static final String CLOUDFLARE_BACKEND_BASE = "https://muchi.twiarimascord.workers.dev";

    private static ResolvedStream probeCloudflareBackendStatic(String primaryVid, String candidatesCsv, String title, String artist, long expectedDurationMs) {
        String vid = primaryVid != null ? primaryVid.trim() : "";
        String cleanTitle = title != null ? title.trim() : "";
        String cleanArtist = artist != null ? artist.trim() : "";
        if (vid.isEmpty() && cleanTitle.isEmpty()) return null;
        HttpURLConnection con = null;
        try {
            StringBuilder sb = new StringBuilder(CLOUDFLARE_BACKEND_BASE + "/api/yt/stream?allowPreview=0");
            if (!vid.isEmpty()) {
                sb.append("&v=").append(java.net.URLEncoder.encode(vid, "UTF-8"));
            }
            if (!cleanTitle.isEmpty()) {
                sb.append("&title=").append(java.net.URLEncoder.encode(cleanTitle, "UTF-8"));
            }
            if (!cleanArtist.isEmpty()) {
                sb.append("&artist=").append(java.net.URLEncoder.encode(cleanArtist, "UTF-8"));
            }
            if (candidatesCsv != null && !candidatesCsv.trim().isEmpty()) {
                sb.append("&candidates=").append(java.net.URLEncoder.encode(candidatesCsv.trim(), "UTF-8"));
            }
            con = (HttpURLConnection) new URL(sb.toString()).openConnection();
            con.setConnectTimeout(4000);
            con.setReadTimeout(5500);
            con.setRequestProperty("User-Agent", DEFAULT_UA);
            if (con.getResponseCode() == 200) {
                JSONObject root = new JSONObject(readStreamString(con.getInputStream()));
                if (root.optBoolean("isPreview", false)) return null;
                String srcProvider = root.optString("source", "").toLowerCase();
                if ("audius".equals(srcProvider) || "soundcloud".equals(srcProvider)) return null;
                String rawUrl = root.optString("url", "").trim();
                if (rawUrl.isEmpty()) return null;
                String fullUrl = rawUrl.startsWith("/") ? (CLOUDFLARE_BACKEND_BASE + rawUrl) : rawUrl;
                String directUrl = root.optString("directUrl", "").trim();
                String lowCheck = (fullUrl + " " + directUrl).toLowerCase();
                if (lowCheck.contains("sndcdn.com") || lowCheck.contains("audius.co") || lowCheck.contains("open-audio-validator")) {
                    return null;
                }
                if (isOneMinuteCappedGoogleVideoUrl(fullUrl) || isOneMinuteCappedGoogleVideoUrl(directUrl)) {
                    return null;
                }
                long durMs = root.optLong("duration", 0L) * 1000L;
                if (durMs <= 0L) {
                    durMs = extractDurationMsFromUrl(fullUrl);
                }
                if (!isDurationAcceptableStatic(durMs, expectedDurationMs)) return null;
                String mime = root.optString("mimeType", "audio/mp4");
                String resolvedVid = root.optString("videoId", vid);
                return new ResolvedStream(fullUrl, userAgentForStreamUrl(fullUrl), durMs, mime, resolvedVid);
            }
        } catch (Exception ignored) {
        } finally {
            if (con != null) con.disconnect();
        }
        return null;
    }

    private static volatile String cachedScClientId = "";
    private static volatile long cachedScClientIdAt = 0L;

    private static String getSoundCloudClientIdStatic() {
        long now = System.currentTimeMillis();
        if (!cachedScClientId.isEmpty() && now - cachedScClientIdAt < 3600000L) {
            return cachedScClientId;
        }
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL("https://soundcloud.com").openConnection();
            con.setConnectTimeout(2500);
            con.setReadTimeout(3000);
            con.setRequestProperty("User-Agent", DEFAULT_UA);
            if (con.getResponseCode() == 200) {
                String html = readStreamString(con.getInputStream());
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("https://a-v2\\.sndcdn\\.com/assets/[^\"']+\\.js").matcher(html);
                List<String> scripts = new ArrayList<>();
                while (m.find()) {
                    scripts.add(m.group(0));
                }
                for (int i = scripts.size() - 1; i >= Math.max(0, scripts.size() - 3); i--) {
                    HttpURLConnection sCon = null;
                    try {
                        sCon = (HttpURLConnection) new URL(scripts.get(i)).openConnection();
                        sCon.setConnectTimeout(2500);
                        sCon.setReadTimeout(3000);
                        sCon.setRequestProperty("User-Agent", DEFAULT_UA);
                        if (sCon.getResponseCode() == 200) {
                            String js = readStreamString(sCon.getInputStream());
                            java.util.regex.Matcher cm = java.util.regex.Pattern.compile("client_id\\s*[:=]\\s*\"([a-zA-Z0-9]{32})\"").matcher(js);
                            if (cm.find()) {
                                cachedScClientId = cm.group(1);
                                cachedScClientIdAt = now;
                                return cachedScClientId;
                            }
                        }
                    } catch (Exception ignored) {
                    } finally {
                        if (sCon != null) sCon.disconnect();
                    }
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (con != null) con.disconnect();
        }
        return "";
    }

    private static ResolvedStream probeSoundCloudForTitleStatic(String title, String artist, long expectedDurationMs) {
        if (title == null || title.trim().isEmpty()) return null;
        String cid = getSoundCloudClientIdStatic();
        if (cid.isEmpty()) return null;
        String cleanTitle = title.trim();
        String coreTitle = cleanTitle
                .replaceAll("(?i)\\s*[\\[(][^)\\]]*(?:feat\\.?|ft\\.?|featuring|with|from\\b|official|video|audio|lyric|remaster|version)[^)\\]]*[)\\]]", "")
                .replaceAll("(?i)\\s+(?:feat\\.?|ft\\.?|featuring)\\s+.*$", "")
                .trim();
        if (coreTitle.isEmpty()) coreTitle = cleanTitle;
        String cleanArtist = artist != null ? artist.trim() : "";
        String coreArtist = cleanArtist.split("(?i)\\s*(?:,|&|/|\\bfeat\\.?|\\bft\\.?|\\bwith\\b)\\s*")[0].trim();
        String q = (coreTitle + " " + coreArtist).trim();
        String wantCore = coreTitle.toLowerCase().replaceAll("[^a-z0-9]+", " ").trim();
        String wantArt = coreArtist.toLowerCase().replaceAll("[^a-z0-9]+", " ").trim();
        boolean wantIsRemix = cleanTitle.toLowerCase().matches(".*\\b(remix|bootleg|flip|mashup|cover|sped\\s*up|slowed|reverb|nightcore|8d|edit|remake|live|acoustic|instrumental|karaoke)\\b.*");
        HttpURLConnection con = null;
        try {
            String searchUrl = "https://api-v2.soundcloud.com/search/tracks?q="
                    + java.net.URLEncoder.encode(q, "UTF-8") + "&client_id=" + cid + "&limit=12";
            con = (HttpURLConnection) new URL(searchUrl).openConnection();
            con.setConnectTimeout(3000);
            con.setReadTimeout(3500);
            con.setRequestProperty("User-Agent", DEFAULT_UA);
            if (con.getResponseCode() == 200) {
                JSONObject root = new JSONObject(readStreamString(con.getInputStream()));
                JSONArray col = root.optJSONArray("collection");
                if (col == null) return null;
                for (int i = 0; i < col.length(); i++) {
                    JSONObject item = col.optJSONObject(i);
                    if (item == null) continue;
                    String policy = item.optString("policy", "ALLOW");
                    if ("SNIP".equalsIgnoreCase(policy) || "BLOCK".equalsIgnoreCase(policy)) continue;
                    long durMs = item.optLong("duration", 0L);
                    long fullDurMs = item.optLong("full_duration", durMs);
                    if (durMs < 60000L || (fullDurMs > 0 && durMs < fullDurMs - 5000L)) continue;
                    if (!isDurationAcceptableStatic(durMs, expectedDurationMs)) continue;
                    String gotTitle = item.optString("title", "").toLowerCase().replaceAll("[^a-z0-9]+", " ").trim();
                    JSONObject user = item.optJSONObject("user");
                    String gotUser = (user != null ? user.optString("username", "") : "").toLowerCase().replaceAll("[^a-z0-9]+", " ").trim();
                    if (!wantCore.isEmpty() && !gotTitle.contains(wantCore)) continue;
                    if (!wantArt.isEmpty() && !(gotTitle + " " + gotUser).contains(wantArt)) continue;
                    if (!wantIsRemix && (gotTitle + " " + gotUser).matches(".*\\b(remix|bootleg|flip|mashup|cover|sped\\s*up|slowed|reverb|nightcore|8d|bass\\s*boosted|karaoke|instrumental|live|acoustic|tribute|type\\s*beat|refix)\\b.*")) {
                        continue;
                    }
                    JSONObject media = item.optJSONObject("media");
                    JSONArray transcodings = media != null ? media.optJSONArray("transcodings") : null;
                    if (transcodings == null) continue;
                    String progUrl = "";
                    for (int j = 0; j < transcodings.length(); j++) {
                        JSONObject tr = transcodings.optJSONObject(j);
                        if (tr == null || tr.optBoolean("snipped", false)) continue;
                        JSONObject fmt = tr.optJSONObject("format");
                        String proto = fmt != null ? fmt.optString("protocol", "") : "";
                        if ("progressive".equalsIgnoreCase(proto)) {
                            progUrl = tr.optString("url", "");
                            break;
                        }
                    }
                    if (!progUrl.isEmpty()) {
                        String sep = progUrl.contains("?") ? "&" : "?";
                        HttpURLConnection rCon = null;
                        try {
                            rCon = (HttpURLConnection) new URL(progUrl + sep + "client_id=" + cid).openConnection();
                            rCon.setConnectTimeout(2500);
                            rCon.setReadTimeout(3000);
                            rCon.setRequestProperty("User-Agent", DEFAULT_UA);
                            if (rCon.getResponseCode() == 200) {
                                JSONObject rObj = new JSONObject(readStreamString(rCon.getInputStream()));
                                String mp3Url = rObj.optString("url", "");
                                if (!mp3Url.isEmpty()) {
                                    return new ResolvedStream(mp3Url, DEFAULT_UA, durMs, "audio/mpeg");
                                }
                            }
                        } catch (Exception ignored) {
                        } finally {
                            if (rCon != null) rCon.disconnect();
                        }
                    }
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (con != null) con.disconnect();
        }
        return null;
    }

    private static ResolvedStream probePipedForVideoStatic(String videoId, long expectedDurationMs, String expectedTitle, String expectedArtist) {
        String[] hosts = new String[] {
            "https://api.piped.private.coffee",
            "https://pipedapi.kavin.rocks",
            "https://pipedapi.adminforge.de"
        };
        for (String h : hosts) {
            HttpURLConnection con = null;
            try {
                con = (HttpURLConnection) new URL(h + "/streams/" + videoId).openConnection();
                con.setConnectTimeout(3500);
                con.setReadTimeout(4500);
                con.setRequestProperty("User-Agent", DEFAULT_UA);
                if (con.getResponseCode() == 200) {
                    JSONObject root = new JSONObject(readStreamString(con.getInputStream()));
                    if (!isVideoMetadataAcceptableStatic(root.optString("title", ""), root.optString("uploader", ""), "", expectedTitle, expectedArtist)) continue;
                    JSONArray streams = root.optJSONArray("audioStreams");
                    if (streams == null || streams.length() == 0) continue;
                    String bestUrl = "";
                    String bestMime = "audio/mp4";
                    int bestBr = -1;
                    String bestM4aUrl = "";
                    int bestM4aBr = -1;
                    for (int i = 0; i < streams.length(); i++) {
                        JSONObject s = streams.optJSONObject(i);
                        if (s == null) continue;
                        String u = s.optString("url", "");
                        String m = s.optString("mimeType", "audio/mp4");
                        int br = s.optInt("bitrate", 0);
                        if (u.isEmpty()) continue;
                        String lowM = m.toLowerCase();
                        if (lowM.contains("mp4") || lowM.contains("m4a") || lowM.contains("aac")) {
                            if (br > bestM4aBr) {
                                bestM4aBr = br;
                                bestM4aUrl = u;
                            }
                        }
                        if (br > bestBr) {
                            bestBr = br;
                            bestUrl = u;
                            bestMime = m;
                        }
                    }
                    if (!bestM4aUrl.isEmpty() && bestM4aBr >= 96000) {
                        bestUrl = bestM4aUrl;
                        bestMime = "audio/mp4";
                    }
                    if (!bestUrl.isEmpty()) {
                        long dur = root.optLong("duration", 0L) * 1000L;
                        if (!isDurationAcceptableStatic(dur, expectedDurationMs)) continue;
                        return new ResolvedStream(bestUrl, DEFAULT_UA, dur, bestMime, videoId);
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (con != null) con.disconnect();
            }
        }
        return null;
    }

    private static ResolvedStream probeAudiusForTitleStatic(String title, String artist) {
        if (title == null || title.trim().isEmpty()) return null;
        String cleanTitle = title.trim();
        String coreTitle = cleanTitle
                .replaceAll("(?i)\\s*[\\[(][^)\\]]*(?:feat\\.?|ft\\.?|featuring|with|from\\b|official|video|audio|lyric|remaster|version)[^)\\]]*[)\\]]", "")
                .replaceAll("(?i)\\s+(?:feat\\.?|ft\\.?|featuring)\\s+.*$", "")
                .trim();
        if (coreTitle.isEmpty()) coreTitle = cleanTitle;
        String cleanArtist = artist != null ? artist.trim() : "";
        String[] rawArtistParts = cleanArtist
                .replaceAll("(?i)\\s*[\\[(]?\\s*(?:feat\\.?|ft\\.?|featuring)\\s+.*$", "")
                .split("(?i)\\s*(?:,|&|/|\\bfeat\\.?|\\bft\\.?|\\bwith\\b)\\s*");
        String coreArtist = rawArtistParts.length > 0 ? rawArtistParts[0].trim() : cleanArtist;
        if (coreArtist.isEmpty()) coreArtist = cleanArtist;
        List<String> artistTokens = new ArrayList<>();
        for (String part : rawArtistParts) {
            String tok = part.toLowerCase().replaceAll("[^a-z0-9]+", " ").trim();
            if (tok.length() >= 2 && !artistTokens.contains(tok)) artistTokens.add(tok);
        }
        List<String> queryList = new ArrayList<>();
        if (!coreArtist.isEmpty()) queryList.add((coreTitle + " " + coreArtist).trim());
        if (rawArtistParts.length > 1 && !rawArtistParts[1].trim().isEmpty()) {
            String qSecond = (coreTitle + " " + rawArtistParts[1].trim()).trim();
            if (!queryList.contains(qSecond)) queryList.add(qSecond);
        }
        if (!queryList.contains(coreTitle)) queryList.add(coreTitle);
        if (!cleanArtist.isEmpty()) {
            String qFull = (cleanTitle + " " + cleanArtist).trim();
            if (!queryList.contains(qFull)) queryList.add(qFull);
        }
        String wantTitle = cleanTitle.toLowerCase().replaceAll("[^a-z0-9]+", " ").trim();
        String wantCore = coreTitle.toLowerCase().replaceAll("[^a-z0-9]+", " ").trim();
        for (String q : queryList) {
            HttpURLConnection con = null;
            try {
                String url = "https://discoveryprovider.audius.co/v1/tracks/search?query="
                        + java.net.URLEncoder.encode(q, "UTF-8") + "&app_name=MUCHI";
                con = (HttpURLConnection) new URL(url).openConnection();
                con.setConnectTimeout(3000);
                con.setReadTimeout(3500);
                con.setRequestProperty("User-Agent", DEFAULT_UA);
                if (con.getResponseCode() == 200) {
                    JSONObject root = new JSONObject(readStreamString(con.getInputStream()));
                    JSONArray data = root.optJSONArray("data");
                    if (data == null || data.length() == 0) continue;
                    for (int i = 0; i < data.length(); i++) {
                        JSONObject item = data.optJSONObject(i);
                        if (item == null) continue;
                        if (item.optBoolean("is_delete", false) || !item.optBoolean("is_streamable", true)) continue;
                        JSONObject access = item.optJSONObject("access");
                        if (access != null && !access.optBoolean("stream", true)) continue;
                        String id = item.optString("id", "").trim();
                        long durSec = item.optLong("duration", 0L);
                        if (id.isEmpty() || durSec < 45L) continue;
                        String rawItemTitle = item.optString("title", "");
                        String gotTitle = rawItemTitle.toLowerCase().replaceAll("[^a-z0-9]+", " ").trim();
                        String strippedTitle = rawItemTitle
                                .replaceAll("(?i)\\s*[\\[(][^)\\]]*(?:feat\\.?|ft\\.?|featuring|with|from\\b|official|video|audio|lyric|remaster|version|hd|hq|4k|\\d+kbps|[A-Za-z0-9_-]{11})[^)\\]]*[)\\]]", "")
                                .replaceAll("(?i)\\s+(?:feat\\.?|ft\\.?|featuring)\\s+.*$", "")
                                .trim();
                        String gotCore = strippedTitle.toLowerCase().replaceAll("[^a-z0-9]+", " ").trim();
                        String[] dashSegments = strippedTitle.split("\\s+[-–—|]\\s+");
                        JSONObject user = item.optJSONObject("user");
                        String gotArtist = (user != null ? user.optString("name", "") + " " + user.optString("handle", "") : "")
                                .toLowerCase().replaceAll("[^a-z0-9]+", " ").trim();
                        String combinedArtistText = (gotArtist + " " + gotTitle).trim();
                        boolean titleMatch = (!wantTitle.isEmpty() && !gotTitle.isEmpty()
                                && (gotTitle.equals(wantTitle) || gotTitle.startsWith(wantTitle + " ")))
                                || (!wantCore.isEmpty() && !gotCore.isEmpty()
                                && (gotCore.equals(wantCore) || gotCore.startsWith(wantCore + " ")));
                        if (!titleMatch) {
                            for (String seg : dashSegments) {
                                String cleanSeg = seg.replaceAll("(?i)\\s+(?:feat\\.?|ft\\.?|featuring)\\s+.*$", "")
                                        .toLowerCase().replaceAll("[^a-z0-9]+", " ").trim();
                                if (!cleanSeg.isEmpty() && ((!wantTitle.isEmpty() && (cleanSeg.equals(wantTitle) || cleanSeg.startsWith(wantTitle + " ")))
                                        || (!wantCore.isEmpty() && (cleanSeg.equals(wantCore) || cleanSeg.startsWith(wantCore + " "))))) {
                                    titleMatch = true;
                                    break;
                                }
                            }
                        }
                        boolean wantIsRemix = wantTitle.matches(".*\\b(remix|bootleg|flip|mashup|cover|sped up|slowed|edit)\\b.*");
                        boolean gotIsRemix = gotTitle.matches(".*\\b(remix|bootleg|flip|mashup|cover|sped up|slowed|edit|karaoke|instrumental)\\b.*");
                        if (!wantIsRemix && gotIsRemix) continue;
                        boolean artistMatch = artistTokens.isEmpty();
                        for (String tok : artistTokens) {
                            if (combinedArtistText.contains(tok) || (!gotArtist.isEmpty() && tok.contains(gotArtist))) {
                                artistMatch = true;
                                break;
                            }
                        }
                        if (titleMatch && artistMatch && durSec >= 60L) {
                            String streamUrl = "https://discoveryprovider.audius.co/v1/tracks/"
                                    + java.net.URLEncoder.encode(id, "UTF-8") + "/stream?app_name=MUCHI";
                            return new ResolvedStream(streamUrl, DEFAULT_UA, durSec * 1000L, "audio/mpeg");
                        }
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (con != null) con.disconnect();
            }
        }
        return null;
    }

    private static String readStreamString(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
        }
        in.close();
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private synchronized void stopPlaybackInternal(boolean notifyJs) {
        loadSeq++;
        ticker.removeCallbacks(tick);
        mirrorMode = false;
        mirrorPlaying = false;
        updateLocks(false);
        releaseAudioEffects();
        if (player != null) {
            player.stop();
            player.release();
            player = null;
        }
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        resolvingOnDevice = false;
        artworkBitmap = null;
        trackArtworkUrl = "";
        currentUrl = null;
        currentRequestedUrl = null;
        currentVideoId = "";
        if (notifyJs) {
            emitControls("stop", 0L);
        }
        stopInForeground();
        stopSelf();
    }

    /* ── notification / session metadata ───────────────────────────── */

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel existing = notificationManager.getNotificationChannel(CHANNEL_ID);
            if (existing != null && existing.getImportance() != NotificationManager.IMPORTANCE_LOW) {
                notificationManager.deleteNotificationChannel(CHANNEL_ID);
            }
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Music playback", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("MUCHI background playback controls");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            notificationManager.createNotificationChannel(channel);
        }
    }

    private MediaMetadataCompat buildMetadata(long durationMs) {
        MediaMetadataCompat.Builder md = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, trackTitle != null && !trackTitle.isEmpty() ? trackTitle : "Muchi")
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST,
                        trackArtist == null || trackArtist.isEmpty() ? "Muchi" : trackArtist);
        if (durationMs > 0) md.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs);
        if (artworkBitmap != null) md.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artworkBitmap);
        return md.build();
    }

    private void updatePlaybackState(boolean playing, long positionMs) {
        if (session == null) return;
        long actions = PlaybackStateCompat.ACTION_PLAY
                | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                | PlaybackStateCompat.ACTION_SEEK_TO;
        session.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                        Math.max(0L, positionMs), prefSpeed > 0 ? prefSpeed : 1f)
                .build());
    }

    private boolean isCurrentlyPlaying() {
        if (mirrorMode) return mirrorPlaying;
        if (resolvingOnDevice) return true;
        if (player != null) {
            return player.isPlaying() || (player.getPlayWhenReady() && player.getPlaybackState() == Player.STATE_BUFFERING);
        }
        return true;
    }

    private Notification buildMediaNotification() {
        ensureSession();
        PendingIntent pi = buildContentPendingIntent();
        boolean playing = isCurrentlyPlaying();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_muchi)
                .setContentTitle(trackTitle == null || trackTitle.isEmpty() ? "Muchi" : trackTitle)
                .setContentText(trackArtist == null || trackArtist.isEmpty() ? "Muchi" : trackArtist)
                .setLargeIcon(artworkBitmap)
                .setContentIntent(pi)
                .setOngoing(playing)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .addAction(android.R.drawable.ic_media_previous, "Previous", serviceAction(ACTION_PREV, 11))
                .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing ? "Pause" : "Play", serviceAction(ACTION_TOGGLE, 12))
                .addAction(android.R.drawable.ic_media_next, "Next", serviceAction(ACTION_NEXT, 13))
                .setDeleteIntent(serviceAction(ACTION_STOP, 14));
        if (session != null) {
            builder.setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(session.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2));
        }
        return builder.build();
    }

    private void startInForeground() {
        if (notificationManager == null) return;
        Notification notification = buildMediaNotification();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            isForegroundStarted = true;
        } catch (Exception ignored) {
            try {
                notificationManager.notify(NOTIFICATION_ID, notification);
            } catch (Exception ignored2) {}
        }
    }

    /** PendingIntent → service action (notification transport buttons). */
    private PendingIntent serviceAction(String action, int requestCode) {
        Intent i = new Intent(this, MuchiAudioService.class);
        i.setAction(action);
        int flags = Build.VERSION.SDK_INT >= 31
                ? (PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)
                : PendingIntent.FLAG_UPDATE_CURRENT;
        return PendingIntent.getService(this, requestCode, i, flags);
    }

    private void showNotification() {
        if (notificationManager == null || session == null) return;
        if (!mirrorMode && player == null) return;
        Notification notification = buildMediaNotification();
        try {
            notificationManager.notify(NOTIFICATION_ID, notification);
        } catch (Exception ignored) {}
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception ignored) {}
    }

    private void stopInForeground() {
        isForegroundStarted = false;
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                stopForeground(Service.STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {}
        if (notificationManager != null) {
            notificationManager.cancel(NOTIFICATION_ID);
        }
    }

    private void emitControls(String message, long positionMs) {
        PluginListener l = activeListener();
        if (l != null) l.onControls(message, positionMs);
    }

    /** Download notification/session artwork off the main thread. */
    private void fetchArtwork(String artworkUrl) {
        io.execute(() -> {
            Bitmap bmp = null;
            HttpURLConnection con = null;
            try {
                con = (HttpURLConnection) new URL(artworkUrl).openConnection();
                con.setConnectTimeout(8000);
                con.setReadTimeout(8000);
                con.setInstanceFollowRedirects(true);
                con.setRequestProperty("User-Agent", DEFAULT_UA);
                if (con.getResponseCode() == 200) {
                    InputStream in = con.getInputStream();
                    byte[] buf = new byte[256 * 1024];
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    int n, total = 0;
                    while ((n = in.read(buf)) > 0 && total < 2 * 1024 * 1024) {
                        out.write(buf, 0, n);
                        total += n;
                    }
                    in.close();
                    bmp = BitmapFactory.decodeByteArray(out.toByteArray(), 0, out.size());
                }
            } catch (Exception ignored) {
                // Artwork is cosmetic — never fail playback over it.
            } finally {
                if (con != null) con.disconnect();
            }
            final Bitmap finalBmp = bmp;
            ticker.post(() -> {
                if (finalBmp == null) return;
                artworkBitmap = finalBmp;
                long dur = mirrorMode ? mirrorDurationMs : (player != null ? Math.max(0L, player.getDuration()) : currentDurationMs);
                if (session != null) session.setMetadata(buildMetadata(dur));
                showNotification();
            });
        });
    }
}
