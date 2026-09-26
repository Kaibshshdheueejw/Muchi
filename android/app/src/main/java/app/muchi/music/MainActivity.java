package app.muchi.music;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom Capacitor plugins BEFORE super.onCreate so the
        // Bridge initializes and exposes them to window.Capacitor.Plugins
        // immediately on startup.
        registerPlugin(MuchiAudioPlugin.class);
        registerPlugin(MuchiDownloadPlugin.class);
        super.onCreate(savedInstanceState);
        if (getBridge() != null) {
            getBridge().registerPlugin(MuchiAudioPlugin.class);
            getBridge().registerPlugin(MuchiDownloadPlugin.class);
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
        // Keep WebView media & JS timers active so YouTube IFrame fallback
        // and queue progression continue uninterrupted when screen is off or backgrounded.
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView wv = getBridge().getWebView();
                wv.onResume();
                wv.resumeTimers();
            }
        } catch (Exception ignored) {}
    }
}
