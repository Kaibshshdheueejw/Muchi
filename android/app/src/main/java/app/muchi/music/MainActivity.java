package app.muchi.music;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Native background audio (Media3 foreground service) — picked up
        // automatically by public/app.js (nativePlayer()).
        getBridge().registerPlugin(MuchiAudioPlugin.class);
        // Real offline downloads (files on disk) — picked up by the download
        // bridge in public/app.js (downloadTrack / renderDlManager).
        getBridge().registerPlugin(MuchiDownloadPlugin.class);
    }
}
