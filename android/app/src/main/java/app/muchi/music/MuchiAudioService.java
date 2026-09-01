package app.muchi.music;

import android.app.Service;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.SessionToken;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * MUCHI native background audio — Media3 (ExoPlayer) + MediaSession.
 *
 * Plays one track/URL at a time in a foreground service so the music keeps
 * going when the screen is locked or the app is in the background, with the
 * OS media notification and lock-screen controls for free.
 *
 * The PLAYLIST is owned by the web app (public/app.js). This service never
 * auto-advances: lock-screen next/previous/ended/error are echoed back to
 * the web layer as `muchiControls` events, and the web layer answers by
 * calling `MuchiAudio.play(url)` with the next track.
 *
 * Talk to it through {@link MuchiAudioPlugin} (bind + {@link LocalBinder}).
 */
@UnstableApi
public class MuchiAudioService extends MediaSessionService {

    public static final String ACTION_PLAY = "app.muchi.music.action.PLAY";
    public static final String ACTION_STOP = "app.muchi.music.action.STOP";

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

    public class LocalBinder extends Binder {
        public void setListener(PluginListener l) { MuchiAudioService.this.listener = l; }
        public void pausePlayback() { if (player != null) player.pause(); }
        public void resumePlayback() { if (player != null) player.play(); }
        public void seekToPlayback(long positionMs) { if (player != null) player.seekTo(positionMs); }
        public void stopAll() { stopPlaybackInternal(); }
    }

    private final LocalBinder binder = new LocalBinder();
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler ticker = new Handler(Looper.getMainLooper());

    private ExoPlayer player;
    private MediaSession session;
    private PluginListener listener;
    private volatile boolean endedNotified = false;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            ticker.removeCallbacks(tick);
            if (player == null) return;
            if (session != null && session.isActive()) {
                if (listener != null) {
                    listener.onProgress(
                            player.getCurrentPosition(),
                            Math.max(0L, player.getDuration()),
                            player.getPlaybackState() == Player.STATE_PLAYING);
                }
                ticker.postDelayed(tick, 1000);
            }
        }
    };

    @Override
    protected int getForegroundServiceType() {
        return ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopPlaybackInternal();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_PLAY.equals(intent.getAction())) {
            String url = intent.getStringExtra(EXTRA_URL);
            if (url != null && !url.isEmpty()) {
                loadTrack(
                        url,
                        intent.getStringExtra(EXTRA_TITLE),
                        intent.getStringExtra(EXTRA_ARTIST),
                        intent.getStringExtra(EXTRA_ARTWORK),
                        intent.getLongExtra(EXTRA_DURATION_MS, 0L));
            }
        }
        return START_STICKY;
    }

    /** Start/reload a track. Only called from the main thread. */
    private synchronized void loadTrack(String url, String title, String artist,
                                        String artwork, long durationMs) {
        ensureSession();
        MediaMetadata.Builder md = new MediaMetadata.Builder()
                .setTitle(title != null && !title.isEmpty() ? title : "Muchi")
                .setArtist(artist != null && !artist.isEmpty() ? artist : "Muchi");
        if (durationMs > 0) md.setPlaybackDuration(durationMs);
        MediaItem item = MediaItem.fromUri(url).setMediaMetadata(md.build()).build();
        endedNotified = false;
        player.setMediaItem(item);
        player.prepare();
        player.play();
        if (artwork != null && !artwork.isEmpty()) fetchArtwork(artwork);
    }

    private synchronized void ensureSession() {
        if (player == null) {
            player = new ExoPlayer.Builder(this).build();
            player.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int playbackState) {
                    if (playbackState == Player.STATE_ENDED && !endedNotified) {
                        endedNotified = true;
                        emitControls("ended", 0L);
                    }
                }

                @Override
                public void onPlayerError(@NonNull Player.Error error) {
                    emitControls("error", 0L);
                }
            });
        }
        if (session == null) {
            session = new MediaSession.Builder(this, new MediaMetadata.Builder().build(),
                    new MediaSession.Callback() {
                        @Override
                        public void onPlay() {
                            if (player != null) player.play();
                            emitControls("play", 0L);
                        }

                        @Override
                        public void onPause() {
                            if (player != null) player.pause();
                            emitControls("pause", 0L);
                        }

                        @Override
                        public void onNext() {
                            // Web layer owns the queue.
                            emitControls("next", 0L);
                        }

                        @Override
                        public void onPrevious() {
                            // Web layer owns the queue.
                            emitControls("previous", 0L);
                        }

                        @Override
                        public void onSeekTo(long position) {
                            if (player != null) player.seekTo(position);
                        }
                    })
                    .build();
            session.setSessionActivity(new ComponentName(this, MainActivity.class));
            session.setActive(true);
            ticker.removeCallbacks(tick);
            ticker.post(tick);
        }
    }

    @Override
    public void onGetSession(SessionToken sessionToken) {
        // A MediaController (e.g. system UI) connected before we built a session.
        ensureSession();
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
        // Swiped away from recents → stop the music.
        stopPlaybackInternal();
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
        emitControls("stop", 0L);
        if (Build.VERSION.SDK_INT >= 33) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        ticker.removeCallbacks(tick);
        io.shutdown();
        synchronized (this) {
            if (player != null) {
                player.release();
                player = null;
            }
            if (session != null) {
                session.release();
                session = null;
            }
        }
        super.onDestroy();
    }

    private void emitControls(String message, long positionMs) {
        PluginListener l = listener;
        if (l != null) l.onControls(message, positionMs);
    }

    /** Download notification artwork off the main thread, then attach it. */
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
                ExoPlayer p = player;
                if (p == null || finalBmp == null) return;
                try {
                    MediaMetadata current = p.getCurrentMediaItem().getMediaMetadata();
                    p.setMediaMetadata(new MediaMetadata.Builder(current).setArtwork(finalBmp).build());
                } catch (Exception ignored) {
                }
            });
        });
    }
}
