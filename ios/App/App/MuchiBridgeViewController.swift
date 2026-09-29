import Capacitor
import WebKit

/**
 * CAPBridgeViewController subclass that registers MUCHI's native plugins
 * once the bridge exists (the bridge is created in loadView(), so it is
 * available here). The web layer (public/app.js) picks the MuchiAudio
 * plugin up automatically via window.Capacitor.Plugins.
 */
class MuchiBridgeViewController: CAPBridgeViewController {
    override open func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        return config
    }

    override public func viewDidLoad() {
        super.viewDidLoad()
        bridge?.registerPluginInstance(MuchiAudioPlugin())
        bridge?.registerPluginInstance(MuchiDownloadPlugin())
    }
}

