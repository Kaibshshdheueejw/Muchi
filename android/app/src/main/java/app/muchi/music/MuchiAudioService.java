package app.muchi.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * MUCHI native background audio — ExoPlayer inside a foreground Service,
 * with a MediaSessionCompat for the OS media notification and lock-screen
 * controls (the same notification/session pattern proven in this repo by
 * capacitor-music-controls-plugin).
 *
 * Plays one track/URL at a time; the music keeps going when the screen is
 * locked or the app is in the background. The PLAYLIST is owned by the web
 * app (public/app.js): next/previous/ended/error are echoed back to the web
 * layer as `muchiControls` events and the web layer answers by calling
 * `MuchiAudio.play(url)` with the next track. No auto-advance here.
 *
 * Talk to it through {@link MuchiAudioPlugin} (bind + {@link LocalBinder}).
 */
@UnstableApi
public class MuchiAudioService extends Service {

    private static final String CHANNEL_ID = "muchi_media";
    private static final int NOTIFICATION_ID = 1;
    private static final String SESSION_TAG = "Muchi Audio";

    public static final String ACTION_PLAY = "app.muchi.music.action.PLAY";
    public static final String ACTION_STOP = "app.muchi.music.action.STOP";
    /** Notification transport buttons (v1.5.4): these arrive as getService
     *  PendingIntents from the media notification itself. */
    public static final String ACTION_TOGGLE = "app.muchi.music.action.TOGGLE";
    public static final String ACTION_NEXT = "app.muchi.music.action.NEXT";
    public static final String ACTION_PREV = "app.muchi.music.action.PREV";

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_ARTWORK = "artwork";
    public static final String EXTRA_DURATION_MS = "durationMs";

    /** Service → plugin channel (main thread). */
    public interface PluginListener {
        void onControls(String message, long positionMs);
        void onProgress(long positionMs, long durationMs, boolean playing);
    }

    /**
     * Plugin → service control surface. IMPORTANT: Capacitor dispatches plugin
     * calls on its own "CapacitorPlugins" HandlerThread, but ExoPlayer +
     * MediaSessionCompat are main-thread-affine (cross-thread calls throw
     * IllegalStateException). Every call therefore hops to the service's
     * main-looper handler — which also FIFO-orders controls against each
     * other and against onStartCommand work, exactly like the old
     * startService path did. (onServiceConnected runs on main, so the
     * posted setListener lands before any posted control.)
     */
    public class LocalBinder extends Binder {
        public void setListener(PluginListener l) { ticker.post(() -> listener = l); }
        public void playIntent(Intent i) { ticker.post(() -> handlePlayIntent(i)); }
        public void pausePlayback() { ticker.post(() -> { if (player != null) player.pause(); }); }
        public void resumePlayback() { ticker.post(() -> { if (player != null) player.play(); }); }
        public void seekToPlayback(long positionMs) { ticker.post(() -> { if (player != null) player.seekTo(positionMs); }); }
        public void stopAll() { ticker.post(MuchiAudioService.this::stopPlaybackInternal); }
    }

    private final LocalBinder binder = new LocalBinder();
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler ticker = new Handler(Looper.getMainLooper());

    private ExoPlayer player;
    private MediaSessionCompat session;
    private NotificationManager notificationManager;
    private PluginListener listener;
    private volatile boolean endedNotified = false;
    private String trackTitle = "Muchi";
    private String trackArtist = "";
    private Bitmap artworkBitmap;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            ticker.removeCallbacks(tick);
            if (player == null || session == null) return;
            long positionMs = player.getCurrentPosition();
            long durationMs = Math.max(0L, player.getDuration());
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
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? "" : (intent.getAction() == null ? "" : intent.getAction());
        if (ACTION_STOP.equals(action)) {
            stopPlaybackInternal();
            return START_NOT_STICKY;
        }
        if (ACTION_PLAY.equals(action)) {
            handlePlayIntent(intent);
        } else if (ACTION_TOGGLE.equals(action)) {
            if (player != null) {
                if (player.isPlaying()) player.pause(); else player.play();
            }
        } else if (ACTION_NEXT.equals(action)) {
            // The queue lives in the web layer; echo, don't decide.
            emitControls("next", 0L);
        } else if (ACTION_PREV.equals(action)) {
            emitControls("previous", 0L);
        } else if (intent == null && player != null) {
            // START_STICKY restart: the OS recreated us. Re-attach the
            // foreground notification so background playback survives a
            // system-initiated process restart (common with aggressive OEM
            // battery managers).
            startInForeground();
            ticker.removeCallbacks(tick);
            ticker.post(tick);
        } else if (intent == null) {
            // Nothing playing to resume after a system restart — stop cleanly
            // instead of lingering as a bare background service (O+ would
            // eventually kill it mid-nothing; START_NOT_STICKY ends the churn).
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    /** Shared by onStartCommand and the plugin binder (bound = cheap, no
     *  startForegroundService re-entry needed when the app is already up). */
    private void handlePlayIntent(Intent intent) {
        String url = intent.getStringExtra(EXTRA_URL);
        if (url == null || url.isEmpty()) return;
        // Promote to a foreground service IMMEDIATELY (before any
        // network/prepare work) so Android reliably keeps it alive in
        // the background and shows the media notification. Without
        // this, on some devices the OS can kill the service (music
        // stops when you leave the app) or the notification never
        // appears.
        startInForeground();
        loadTrack(
                url,
                intent.getStringExtra(EXTRA_TITLE),
                intent.getStringExtra(EXTRA_ARTIST),
                intent.getStringExtra(EXTRA_ARTWORK),
                intent.getLongExtra(EXTRA_DURATION_MS, 0L));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        // Keep playing when the WebView side unbinds (app in background).
        return false;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // The app was swiped away from Recents. Keep the foreground media
        // service alive so background playback continues (the whole point of a
        // music app); the notification remains so the user can reopen or stop
        // it. Do NOT stop playback here — that's what made "music stops when I
        // close the app". If the user explicitly stops (notification action or
        // the in-app stop), ACTION_STOP clears the service; if the system
        // needs the process, it re-creates it (START_STICKY) and re-attaches
        // the notification.
        startInForeground();
        ticker.removeCallbacks(tick);
        ticker.post(tick);
    }

    @Override
    public void onDestroy() {
        ticker.removeCallbacks(tick);
        io.shutdown();
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

    private synchronized void loadTrack(String url, String title, String artist,
                                        String artwork, long durationMs) {
        trackTitle = title != null && !title.isEmpty() ? title : "Muchi";
        trackArtist = artist != null ? artist : "";

        if (player == null) {
            player = new ExoPlayer.Builder(this)
                    // WAKE_LOCK is declared in the manifest — make it effective:
                    // WAKE_MODE_LOCAL holds a CPU wake lock while the player is
                    // active so background/lock-screen streaming survives doze.
                    .setWakeMode(C.WAKE_MODE_LOCAL)
                    // Explicit music audio attributes + explicit audio-focus
                    // handling (ExoPlayer requests focus on play, abandons on
                    // pause; other audio ducking/loss is handled by the system).
                    .setAudioAttributes(
                            new androidx.media3.common.AudioAttributes.Builder()
                                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                                    .setUsage(C.USAGE_MEDIA)
                                    .build(),
                            true)
                    .build();
            player.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int playbackState) {
                    if (playbackState == Player.STATE_ENDED && !endedNotified) {
                        endedNotified = true;
                        emitControls("ended", 0L);
                    }
                }

                @Override
                public void onPlayerError(@NonNull PlaybackException error) {
                    emitControls("error", 0L);
                }

                @Override
                public void onIsPlayingChanged(boolean isPlaying) {
                    // Refresh the notification's play/pause action so the
                    // button matches reality when playback state changes from
                    // ANY source (notification tap, headset, lock screen, JS).
                    ticker.post(() -> showNotification());
                }
            });
        }
        if (session == null) {
            session = new MediaSessionCompat(this, SESSION_TAG, null, null);
            session.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                    | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);
            session.setCallback(new MediaSessionCompat.Callback() {
                @Override
                public void onPlay() {
                    super.onPlay();
                    if (player != null) player.play();
                    emitControls("play", 0L);
                }

                @Override
                public void onPause() {
                    super.onPause();
                    if (player != null) player.pause();
                    emitControls("pause", 0L);
                }

                @Override
                public void onSkipToNext() {
                    // Web layer owns the queue.
                    emitControls("next", 0L);
                }

                @Override
                public void onSkipToPrevious() {
                    // Web layer owns the queue.
                    emitControls("previous", 0L);
                }

                @Override
                public void onSeekTo(long position) {
                    if (player != null) player.seekTo(position);
                }

                @Override
                public void onStop() {
                    stopPlaybackInternal();
                }
            });
            session.setActive(true);
            // Tapping the notification / lock-screen brings the app back.
            try {
                Intent open = new Intent(this, MainActivity.class);
                open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                session.setSessionActivity(PendingIntent.getActivity(this, 0, open,
                        Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_IMMUTABLE : 0));
            } catch (Exception ignored) {
            }
        }

        endedNotified = false;
        player.setMediaItem(MediaItem.fromUri(url));
        player.prepare();
        player.play();

        session.setMetadata(buildMetadata(durationMs));
        updatePlaybackState(true, 0L);
        showNotification();

        if (artwork != null && !artwork.isEmpty()) fetchArtwork(artwork);
        ticker.removeCallbacks(tick);
        ticker.post(tick);
    }

    private synchronized void stopPlaybackInternal() {
        ticker.removeCallbacks(tick);
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
        emitControls("stop", 0L);
        stopInForeground();
        stopSelf();
    }

    /* ── notification / session metadata ───────────────────────────── */

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            // IMPORTANCE_LOW: an ongoing media notification must not beep/bob
            // on every track change (DEFAULT made it a heads-up interruption
            // per song). It still shows in the shade + lock screen.
            NotificationChannel existing = notificationManager.getNotificationChannel(CHANNEL_ID);
            if (existing != null && existing.getImportance() != NotificationManager.IMPORTANCE_LOW) {
                // Importance is immutable after creation (1.5.3 shipped this
                // channel as DEFAULT) — delete + recreate once so upgraders
                // get the silent behavior too.
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
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, trackTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST,
                        trackArtist.isEmpty() ? "Muchi" : trackArtist);
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
                        Math.max(0, positionMs), 1f)
                .build());
    }

    private void startInForeground() {
        // Immediately promote the service to foreground so Android keeps it
        // alive and shows a notification even before the media session is
        // ready or a network stream begins loading.
        if (notificationManager == null) return;
        Notification.Builder builder = new Notification.Builder(this);
        if (Build.VERSION.SDK_INT >= 26) builder.setChannelId(CHANNEL_ID);
        builder.setSmallIcon(R.drawable.ic_stat_muchi);
        builder.setContentTitle(trackTitle == null || trackTitle.isEmpty() ? "Muchi" : trackTitle);
        builder.setContentText(trackArtist == null || trackArtist.isEmpty() ? "Muchi" : trackArtist);
        builder.setOngoing(true);
        builder.setVisibility(Notification.VISIBILITY_PUBLIC);
        Notification notification = builder.build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else if (Build.VERSION.SDK_INT >= 26) {
            startForeground(NOTIFICATION_ID, notification);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    /** PendingIntent → service action (notification transport buttons). */
    private PendingIntent serviceAction(String action, int requestCode) {
        Intent i = new Intent(this, MuchiAudioService.class);
        i.setAction(action);
        int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_IMMUTABLE : 0;
        return PendingIntent.getService(this, requestCode, i, flags);
    }

    private void showNotification() {
        // Guard against a post-stop race: onIsPlayingChanged fires during
        // player.release() and re-notifying the cancelled id would leave an
        // orphaned "player" notification behind after ACTION_STOP.
        if (notificationManager == null || session == null || player == null) return;
        Intent contentIntent = new Intent(this, MainActivity.class);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int piFlags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent pi = PendingIntent.getActivity(this, 0, contentIntent, piFlags);

        // v1.5.4: real transport buttons (prev / play-pause / next) on the
        // notification itself + compact view, a delete intent so a swipe that
        // somehow goes through stops playback instead of orphaning the
        // service, and CATEGORY_MEDIA so OEM/Android auto-group it with media.
        // The framework ic_media_* drawables are used deliberately: zero new
        // assets, monochrome-correct on every OEM skin, and what every
        // MediaStyle notification template expects at API 24+.
        boolean playing = player != null && player.isPlaying();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_muchi)
                .setContentTitle(trackTitle)
                .setContentText(trackArtist.isEmpty() ? "Muchi" : trackArtist)
                .setLargeIcon(artworkBitmap)
                .setContentIntent(pi)
                .setOngoing(true)
                // Silent by construction: the channel is IMPORTANCE_LOW (kept
                // here as .setPriority(LOW) rather than androidx setSilent so
                // we don't depend on a specific androidx.core version).
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_MEDIA)
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
        Notification notification = builder.build();
        notificationManager.notify(NOTIFICATION_ID, notification);

        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void stopInForeground() {
        if (Build.VERSION.SDK_INT >= 33) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
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
                if (con.getResponseCode() == 200) {
                    InputStream in = con.getInputStream();
                    byte[] buf = new byte[256 * 1024];
                    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
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
                if (session != null) session.setMetadata(buildMetadata(player != null ? Math.max(0, player.getDuration()) : 0L));
                showNotification();
            });
        });
    }
}
