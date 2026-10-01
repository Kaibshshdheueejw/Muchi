package app.muchi.music;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private void keepWebViewAwake() {
        try {
            if (isFinishing() || isDestroyed()) return;
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView wv = getBridge().getWebView();
                wv.onResume();
                wv.resumeTimers();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom Capacitor plugins BEFORE super.onCreate so the
        // Bridge initializes and exposes them to window.Capacitor.Plugins
        // immediately on startup.
        registerPlugin(MuchiAudioPlugin.class);
        registerPlugin(MuchiDownloadPlugin.class);
        super.onCreate(savedInstanceState);
        if (getBridge() != null) {
            WebView wv = getBridge().getWebView();
            if (wv != null) {
                WebSettings ws = wv.getSettings();
                ws.setMediaPlaybackRequiresUserGesture(false);
            }
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        if (isFinishing()) return;
        // Keep WebView media & JS timers active so YouTube IFrame fallback
        // and queue progression continue uninterrupted when screen is off or backgrounded.
        keepWebViewAwake();
        mainHandler.postDelayed(this::keepWebViewAwake, 60);
        mainHandler.postDelayed(this::keepWebViewAwake, 250);
    }

    @Override
    public void onStop() {
        super.onStop();
        if (isFinishing()) return;
        keepWebViewAwake();
        mainHandler.postDelayed(this::keepWebViewAwake, 80);
        mainHandler.postDelayed(this::keepWebViewAwake, 300);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus && !isFinishing()) {
            keepWebViewAwake();
            mainHandler.postDelayed(this::keepWebViewAwake, 100);
        }
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        boolean finishing = isFinishing();
        if (finishing) {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    WebView wv = getBridge().getWebView();
                    wv.evaluateJavascript("try{if(window.audio)window.audio.pause();if(window.state&&window.state.yt&&window.state.yt.stopVideo)window.state.yt.stopVideo();}catch(e){}", null);
                    wv.onPause();
                    wv.pauseTimers();
                }
            } catch (Exception ignored) {}
        }
        super.onDestroy();
        if (finishing) {
            try {
                Intent stopIntent = new Intent(this, MuchiAudioService.class);
                stopIntent.setAction(MuchiAudioService.ACTION_STOP);
                startService(stopIntent);
            } catch (Exception ignored) {}
            try {
                stopService(new Intent(this, MuchiAudioService.class));
            } catch (Exception ignored) {}
        }
    }
}
