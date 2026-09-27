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
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
                if (mirrorMode) {
                    mirrorPositionMs = Math.max(0L, positionMs);
                    updatePlaybackState(mirrorPlaying, mirrorPositionMs);
                } else if (player != null) {
                    player.seekTo(positionMs);
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
    private PowerManager.WakeLock cpuWakeLock;
    private WifiManager.WifiLock wifiLock;

    // 1.5.5 Sound Stage hardware DSP effects attached to ExoPlayer's audio session
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
    private String currentVideoId = "";
    private String currentCandidates = "";
    private long currentDurationMs = 0L;
    private boolean triedOnDeviceResolve = false;

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
            if (mirrorMode) {
                if (session != null) {
                    updatePlaybackState(mirrorPlaying, mirrorPositionMs);
                }
                if (mirrorPlaying) {
                    mirrorPositionMs += 1000L;
                    if (mirrorDurationMs > 0 && mirrorPositionMs > mirrorDurationMs) {
                        mirrorPositionMs = mirrorDurationMs;
                    }
                    ticker.postDelayed(tick, 1000);
                }
                return;
            }
            if (player == null || session == null) return;
            long positionMs = player.getCurrentPosition();
            long durationMs = Math.max(0L, player.getDuration());
            if (durationMs <= 0 && currentDurationMs > 0) durationMs = currentDurationMs;
            boolean playing = player.isPlaying();
            if (listener != null) listener.onProgress(positionMs, durationMs, playing);
            updatePlaybackState(playing, positionMs);
            ticker.postDelayed(tick, 1000);
        }
    };

    /* ── lifecycle ─────────────────────────────────────────────────── */

    @Override
    public void onCreate() {
        super.onCreate();
        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        createChannel();
        initLocks();
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
        } else if (intent == null && ((player != null && (player.isPlaying() || player.getPlayWhenReady())) || (mirrorMode && mirrorPlaying))) {
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
        if (url == null || url.isEmpty()) return;

        readPrefsFromIntent(intent);
        String title = intent.getStringExtra(EXTRA_TITLE);
        String artist = intent.getStringExtra(EXTRA_ARTIST);
        String artwork = intent.getStringExtra(EXTRA_ARTWORK);
        String candidates = intent.getStringExtra(EXTRA_CANDIDATES);
        long durationMs = intent.getLongExtra(EXTRA_DURATION_MS, 0L);

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
        updatePlaybackState(true, 0L);
        startInForeground();
        showNotification();
        updateLocks(true);

        loadTrack(url, videoId, candidates != null ? candidates : "", trackTitle, trackArtist, artwork, currentDurationMs);
    }

    /** Mirror mode: keeps the Foreground Media Notification & WakeLock active
     *  even when audio is playing inside the WebView (e.g. YouTube IFrame / <audio>). */
    private void handleSessionIntent(Intent intent) {
        if (intent == null) return;
        // If native ExoPlayer is actively playing or preparing a track, native
        // ExoPlayer owns the notification directly — ignore mirror updates.
        if (!mirrorMode && player != null && (player.isPlaying() || player.getPlayWhenReady())) {
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
        // The app was swiped away from Recents. Keep the foreground media
        // service alive so background playback continues; the notification
        // remains so the user can reopen or stop it.
        boolean active = (player != null && (player.isPlaying() || player.getPlayWhenReady()))
                || (mirrorMode && mirrorPlaying);
        if (active) {
            startInForeground();
            showNotification();
            updateLocks(true);
            ticker.removeCallbacks(tick);
            ticker.post(tick);
        }
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
        ExoPlayer.Builder builder = new ExoPlayer.Builder(this)
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
                        true);
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
                    endedNotified = true;
                    emitControls("ended", 0L);
                }
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                // If the Worker proxy URL failed (e.g., datacenter IP 403/502) and
                // we have a videoId/title, resolve directly on the phone's IP first!
                if (!triedOnDeviceResolve && (!currentVideoId.isEmpty() || !trackTitle.isEmpty())) {
                    triedOnDeviceResolve = true;
                    final int seq = loadSeq;
                    final String vid = currentVideoId;
                    final String cands = currentCandidates;
                    final String tTitle = trackTitle;
                    final String tArtist = trackArtist;
                    resolveExecutor.execute(() -> {
                        ResolvedStream rs = resolveYoutubeStreamOnDevice(vid, cands, tTitle, tArtist);
                        ticker.post(() -> {
                            if (seq != loadSeq) return;
                            if (rs != null && rs.url != null && !rs.url.isEmpty()) {
                                currentUrl = rs.url;
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
                emitControls("error", 0L);
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
                if (mirrorMode) {
                    mirrorPositionMs = Math.max(0L, position);
                    updatePlaybackState(mirrorPlaying, mirrorPositionMs);
                    emitControls("seek", mirrorPositionMs);
                } else if (player != null) {
                    player.seekTo(position);
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
                                        String title, String artist, String artwork, long durationMs) {
        trackTitle = title != null && !title.isEmpty() ? title : "Muchi";
        trackArtist = artist != null ? artist : "";
        if (videoId != null && !videoId.isEmpty()) {
            currentVideoId = videoId;
        } else if (url != null && url.startsWith("yt:")) {
            currentVideoId = url.substring(3).trim();
        } else {
            currentVideoId = extractVideoIdFromUrl(url);
        }
        currentCandidates = candidates != null ? candidates : "";
        currentDurationMs = Math.max(0L, durationMs);
        mirrorMode = false;

        // Deduplicate rapid double-invocation (e.g. startForegroundService + binder.playIntent)
        if (player != null && currentUrl != null && currentUrl.equals(url)
                && (player.isPlaying() || player.getPlayWhenReady() || player.getPlaybackState() == Player.STATE_BUFFERING)) {
            ensureSession();
            session.setMetadata(buildMetadata(currentDurationMs));
            showNotification();
            if (artwork != null && !artwork.isEmpty() && !artwork.equals(trackArtworkUrl)) {
                trackArtworkUrl = artwork;
                fetchArtwork(artwork);
            }
            return;
        }

        currentUrl = url;
        endedNotified = false;
        final int seq = ++loadSeq;

        ensurePlayer();
        ensureSession();

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

        // If URL is a "yt:<videoId>" token (Worker couldn't resolve on its datacenter IP),
        // resolve the direct high-bitrate stream on the user's phone IP!
        if (url.startsWith("yt:")) {
            triedOnDeviceResolve = true;
            if (player != null) player.stop();
            final String vid = currentVideoId;
            final String cands = currentCandidates;
            final String tTitle = trackTitle;
            final String tArtist = trackArtist;
            resolveExecutor.execute(() -> {
                ResolvedStream rs = resolveYoutubeStreamOnDevice(vid, cands, tTitle, tArtist);
                ticker.post(() -> {
                    if (seq != loadSeq) return;
                    if (rs != null && rs.url != null && !rs.url.isEmpty()) {
                        currentUrl = rs.url;
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

        triedOnDeviceResolve = false;
        String ua = userAgentForStreamUrl(url);
        startExoPlayerWithUrl(url, ua, currentDurationMs);
    }

    private void startExoPlayerWithUrl(String streamUrl, String userAgent, long durationMs) {
        ensurePlayer();
        ensureSession();
        if (httpFactory != null) {
            httpFactory.setUserAgent(userAgent != null && !userAgent.isEmpty() ? userAgent : userAgentForStreamUrl(streamUrl));
            Map<String, String> headers = new HashMap<>();
            if (streamUrl.contains("googlevideo.com")) {
                headers.put("Origin", "https://www.youtube.com");
                headers.put("Referer", "https://www.youtube.com/");
            }
            httpFactory.setDefaultRequestProperties(headers);
        }
        endedNotified = false;
        player.setMediaItem(MediaItem.fromUri(streamUrl));
        applyPlayerPrefsAndEffects();
        player.prepare();
        player.play();

        session.setMetadata(buildMetadata(durationMs));
        updatePlaybackState(true, 0L);
        startInForeground();
        showNotification();
        updateLocks(true);

        ticker.removeCallbacks(tick);
        ticker.post(tick);
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
            return "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";
        }
        if (url.contains("c=ANDROID_TESTSUITE")) {
            return "com.google.android.youtube/1.9 (Linux; U; Android 11) gzip";
        }
        if (url.contains("c=ANDROID")) {
            return "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip";
        }
        if (url.contains("c=IOS")) {
            return "com.google.ios.youtube/19.09.3 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X) gzip";
        }
        return DEFAULT_UA;
    }

    /* ── 1.5.5 Sound Stage & Volume/Speed DSP ──────────────────────── */

    private void applyPlayerPrefsAndEffects() {
        if (player == null) return;
        try {
            // 1.5.5 volumeFor(volumePct, normalize) math: normalizeGain = 0.86 when on, 1.0 when off
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

            // 1.5.5 Sound Stage tuning (Phone · feel it / Super Bass / Spatial / Dynamic)
            if (loudnessEnhancer != null) {
                int gainMb = "phone".equals(mode) ? 350 : "bass".equals(mode) ? 280 : "dynamic".equals(mode) ? 240 : 200;
                loudnessEnhancer.setTargetGain(gainMb);
                loudnessEnhancer.setEnabled(true);
            }

            if (bassBoost != null && bassBoost.getStrengthSupported()) {
                short strength = (short) ("phone".equals(mode) ? 650 : "bass".equals(mode) ? 800 : "spatial".equals(mode) ? 320 : 450);
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
                            // 1.5.5 "Phone · feel it": +9.5dB sub/bass, -2.8dB 420Hz scoop, +2.8dB 2.8kHz presence, +2.6dB 8.5kHz air
                            if (freqHz <= 90) targetMb = 750;
                            else if (freqHz <= 200) targetMb = 380;
                            else if (freqHz <= 600) targetMb = -240;
                            else if (freqHz <= 4000) targetMb = 280;
                            else targetMb = 260;
                        } else if ("bass".equals(mode)) {
                            if (freqHz <= 90) targetMb = 850;
                            else if (freqHz <= 200) targetMb = 420;
                            else if (freqHz <= 600) targetMb = -200;
                            else if (freqHz <= 4000) targetMb = 120;
                            else targetMb = -50;
                        } else if ("spatial".equals(mode)) {
                            if (freqHz <= 120) targetMb = 240;
                            else if (freqHz <= 600) targetMb = -140;
                            else if (freqHz <= 4000) targetMb = 240;
                            else targetMb = 320;
                        } else {
                            // dynamic
                            if (freqHz <= 120) targetMb = 500;
                            else if (freqHz <= 600) targetMb = -180;
                            else if (freqHz <= 4000) targetMb = 300;
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

    private static class ResolvedStream {
        final String url;
        final String userAgent;
        final long durationMs;
        ResolvedStream(String url, String userAgent, long durationMs) {
            this.url = url;
            this.userAgent = userAgent;
            this.durationMs = durationMs;
        }
    }

    private ResolvedStream resolveYoutubeStreamOnDevice(String primaryVid, String candidatesCsv, String title, String artist) {
        List<String> vids = new ArrayList<>();
        if (primaryVid != null && !primaryVid.trim().isEmpty()) {
            vids.add(primaryVid.trim());
        }
        if (candidatesCsv != null && !candidatesCsv.isEmpty()) {
            for (String part : candidatesCsv.split(",")) {
                String c = part.trim();
                if (!c.isEmpty() && !vids.contains(c)) vids.add(c);
            }
        }
        for (String vid : vids) {
            ResolvedStream rs = probeInnertubeForVideo(vid);
            if (rs != null) return rs;
        }
        // If primary + passed candidates were gated (e.g. VEVO clip), search InnerTube
        // for "<title> <artist> official audio" directly from the phone's IP.
        if (title != null && !title.isEmpty()) {
            String q = (title + " " + (artist != null ? artist : "") + " official audio").trim();
            List<String> searched = searchInnertubeVideoIds(q);
            for (String svid : searched) {
                if (vids.contains(svid)) continue;
                ResolvedStream rs = probeInnertubeForVideo(svid);
                if (rs != null) return rs;
            }
        }
        // Final fallback: Piped stream instances from the phone's IP
        for (String vid : vids) {
            ResolvedStream rs = probePipedForVideo(vid);
            if (rs != null) return rs;
        }
        return null;
    }

    private ResolvedStream probeInnertubeForVideo(String videoId) {
        if (videoId == null || videoId.isEmpty()) return null;
        String[][] profiles = new String[][] {
            {
                "ANDROID_VR",
                "1.60.19",
                "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
                "{\"context\":{\"client\":{\"clientName\":\"ANDROID_VR\",\"clientVersion\":\"1.60.19\",\"androidSdkVersion\":32,\"osName\":\"Android\",\"osVersion\":\"12L\",\"deviceMake\":\"Oculus\",\"deviceModel\":\"Quest 3\",\"hl\":\"en\",\"gl\":\"US\"}},\"videoId\":\"" + videoId + "\",\"contentCheckOk\":true,\"racyCheckOk\":true}"
            },
            {
                "ANDROID_TESTSUITE",
                "1.9",
                "com.google.android.youtube/1.9 (Linux; U; Android 11) gzip",
                "{\"context\":{\"client\":{\"clientName\":\"ANDROID_TESTSUITE\",\"clientVersion\":\"1.9\",\"androidSdkVersion\":30,\"hl\":\"en\",\"gl\":\"US\"}},\"videoId\":\"" + videoId + "\",\"contentCheckOk\":true,\"racyCheckOk\":true}"
            },
            {
                "ANDROID",
                "19.09.37",
                "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
                "{\"context\":{\"client\":{\"clientName\":\"ANDROID\",\"clientVersion\":\"19.09.37\",\"androidSdkVersion\":30,\"hl\":\"en\",\"gl\":\"US\"}},\"videoId\":\"" + videoId + "\",\"contentCheckOk\":true,\"racyCheckOk\":true}"
            },
            {
                "IOS",
                "19.09.3",
                "com.google.ios.youtube/19.09.3 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X) gzip",
                "{\"context\":{\"client\":{\"clientName\":\"IOS\",\"clientVersion\":\"19.09.3\",\"deviceModel\":\"iPhone16,2\",\"hl\":\"en\",\"gl\":\"US\"}},\"videoId\":\"" + videoId + "\",\"contentCheckOk\":true,\"racyCheckOk\":true}"
            }
        };

        for (String[] prof : profiles) {
            String ua = prof[2];
            String body = prof[3];
            HttpURLConnection con = null;
            try {
                con = (HttpURLConnection) new URL("https://www.youtube.com/youtubei/v1/player?prettyPrint=false").openConnection();
                con.setRequestMethod("POST");
                con.setConnectTimeout(4500);
                con.setReadTimeout(5500);
                con.setDoOutput(true);
                con.setRequestProperty("Content-Type", "application/json");
                con.setRequestProperty("Origin", "https://www.youtube.com");
                con.setRequestProperty("Referer", "https://www.youtube.com/");
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
                    if (!"OK".equals(status)) continue;
                    JSONObject streamingData = root.optJSONObject("streamingData");
                    if (streamingData == null) continue;
                    JSONArray adaptive = streamingData.optJSONArray("adaptiveFormats");
                    if (adaptive == null || adaptive.length() == 0) continue;

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

                    // 1.5.5 stream quality rule: prefer highest-bitrate AAC/m4a, then highest-bitrate Opus
                    String chosen = !bestM4aUrl.isEmpty() ? bestM4aUrl : bestOpusUrl;
                    if (!chosen.isEmpty()) {
                        long durSec = 0L;
                        JSONObject vd = root.optJSONObject("videoDetails");
                        if (vd != null) {
                            durSec = vd.optLong("lengthSeconds", 0L);
                        }
                        return new ResolvedStream(chosen, ua, durSec * 1000L);
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (con != null) con.disconnect();
            }
        }
        return null;
    }

    private List<String> searchInnertubeVideoIds(String query) {
        List<String> out = new ArrayList<>();
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL("https://www.youtube.com/youtubei/v1/search?prettyPrint=false").openConnection();
            con.setRequestMethod("POST");
            con.setConnectTimeout(4500);
            con.setReadTimeout(5000);
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "application/json");
            con.setRequestProperty("Origin", "https://www.youtube.com");
            con.setRequestProperty("Referer", "https://www.youtube.com/");
            con.setRequestProperty("User-Agent", DEFAULT_UA);
            String safeQ = query.replace("\\", "\\\\").replace("\"", "\\\"");
            String payload = "{\"context\":{\"client\":{\"clientName\":\"WEB\",\"clientVersion\":\"2.20240815.00.00\",\"hl\":\"en\",\"gl\":\"US\"}},\"query\":\"" + safeQ + "\"}";
            try (OutputStream os = con.getOutputStream()) {
                os.write(payload.getBytes(StandardCharsets.UTF_8));
            }
            if (con.getResponseCode() == 200) {
                String text = readStreamString(con.getInputStream());
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"videoId\"\\s*:\\s*\"([A-Za-z0-9_-]{11})\"").matcher(text);
                while (m.find() && out.size() < 4) {
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

    private ResolvedStream probePipedForVideo(String videoId) {
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
                    JSONArray streams = root.optJSONArray("audioStreams");
                    if (streams == null || streams.length() == 0) continue;
                    String bestUrl = "";
                    int bestBr = -1;
                    for (int i = 0; i < streams.length(); i++) {
                        JSONObject s = streams.optJSONObject(i);
                        if (s == null) continue;
                        String u = s.optString("url", "");
                        int br = s.optInt("bitrate", 0);
                        if (!u.isEmpty() && br > bestBr) {
                            bestBr = br;
                            bestUrl = u;
                        }
                    }
                    if (!bestUrl.isEmpty()) {
                        long dur = root.optLong("duration", 0L) * 1000L;
                        return new ResolvedStream(bestUrl, DEFAULT_UA, dur);
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
        artworkBitmap = null;
        trackArtworkUrl = "";
        currentUrl = null;
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
        PluginListener l = listener;
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
