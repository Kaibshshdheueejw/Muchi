package app.muchi.music;

import android.os.Bundle;

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
        }
    }
}
