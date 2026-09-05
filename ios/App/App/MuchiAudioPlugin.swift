import Capacitor
import AVFoundation
import MediaPlayer
import UIKit

/**
 * MUCHI native background audio (iOS).
 *
 * AVPlayer renders the stream so the music keeps playing when the app is in
 * the background (Info.plist already declares UIBackgroundModes: audio).
 * MPRemoteCommandCenter + MPNowPlayingInfoCenter provide the lock-screen
 * controls and now-playing artwork.
 *
 * Mirrors the Android MuchiAudioService contract: the web layer
 * (public/app.js) owns the playlist — next/previous/ended/error are echoed
 * back as `muchiControls` events and the web layer answers by calling
 * `play` with the next track. No auto-advance here.
 *
 * JS API: play({url,title,artist,artwork,duration}), pause(), resume(),
 *         stop(), seekTo({position}), emit({action,...})
 * Events: muchiControls {message, position}, muchiProgress {positionMs, durationMs, playing}
 */
@objc(MUCHI_MuchiAudioPlugin)
public class MuchiAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MUCHI_MuchiAudioPlugin"
    public let jsName = "MuchiAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekTo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "emit", returnType: CAPPluginReturnPromise)
    ]

    private var player: AVPlayer?
    private var currentItem: AVPlayerItem?
    private var ticker: Timer?
    private var errorSent = false

    /* ── lifecycle ─────────────────────────────────────────────────── */

    override public func load() {
        setupRemoteCommands()
        setupSessionObservers()
    }

    /* ── system audio events ─────────────────────────────────────────
     * Official Apple pattern (AVAudioSession docs): listen for
     * interruptions (phone calls, Siri, other apps grabbing audio) and
     * route changes (headphones unplugged/plugged in) so the app's UI
     * state stays in sync with what the OS does to the player.
     */
    private func setupSessionObservers() {
        let session = AVAudioSession.sharedInstance()
        let center = NotificationCenter.default

        center.addObserver(forName: AVAudioSession.interruptionNotification,
                           object: session, queue: .main) { [weak self] note in
            guard let self = self else { return }
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            switch type {
            case .began:
                // The system took the audio (call/Siri). Pause and tell the
                // web layer so its UI no longer claims "playing".
                if self.player?.rate ?? 0 > 0 {
                    self.player?.pause()
                    self.updateRate()
                    self.notifyListeners("muchiControls", data: ["message": "pause", "position": 0])
                }
            case .ended:
                let optsRaw = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                let options = AVAudioSession.InterruptionOptions(rawValue: optsRaw)
                if options.contains(.shouldResume) && self.currentItem != nil {
                    self.player?.play()
                    self.updateRate()
                    self.notifyListeners("muchiControls", data: ["message": "play", "position": 0])
                }
            @unknown default:
                break
            }
        }

        center.addObserver(forName: AVAudioSession.routeChangeNotification,
                           object: session, queue: .main) { [weak self] note in
            guard let self = self else { return }
            guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
            if reason == .oldDeviceUnavailable, self.player?.rate ?? 0 > 0 {
                // Headphones unplugged (or Bluetooth device lost) — the iOS
                // convention is to stop audio, not blast it into the speaker.
                self.player?.pause()
                self.updateRate()
                self.notifyListeners("muchiControls", data: ["message": "pause", "position": 0])
            }
        }
    }

    /* ── JS → native ───────────────────────────────────────────────── */

    @objc public func play(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        guard !url.isEmpty, let streamUrl = URL(string: url) else {
            call.reject("MuchiAudio: missing url")
            return
        }
        configureAudioSession()

        let p: AVPlayer
        if let existing = player { p = existing } else { p = AVPlayer() }
        player = p

        let item = AVPlayerItem(url: streamUrl)
        currentItem = item
        errorSent = false

        NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("muchiControls", data: ["message": "ended", "position": 0])
        }

        p.replaceCurrentItem(with: item)
        p.play()

        // NOTE: the web layer sends `duration` ALREADY IN MILLISECONDS
        // (app.js: Math.round(durationSec * 1000)) and updateNowPlaying()
        // divides by 1000 for MPMediaItemPropertyPlaybackDuration — the old
        // `* 1000.0` here multiplied twice, inflating lock-screen remaining
        // time ~1000× (e.g. "3 days left" on a 3-minute song).
        updateNowPlaying(
            title: call.getString("title") ?? "Muchi",
            artist: call.getString("artist") ?? "",
            artwork: call.getString("artwork") ?? "",
            durationMs: call.getDouble("duration") ?? 0
        )
        startTicker()
        call.resolve()
    }

    @objc public func pause(_ call: CAPPluginCall) {
        player?.pause()
        updateRate()
        call.resolve()
    }

    @objc public func resume(_ call: CAPPluginCall) {
        player?.play()
        updateRate()
        call.resolve()
    }

    @objc public func stop(_ call: CAPPluginCall) {
        doStop()
        call.resolve()
    }

    @objc public func seekTo(_ call: CAPPluginCall) {
        let ms = call.getDouble("position") ?? 0
        player?.seek(to: CMTime(seconds: ms / 1000.0, preferredTimescale: 600))
        call.resolve()
    }

    @objc public func emit(_ call: CAPPluginCall) {
        let action = call.getString("action") ?? ""
        if action == "stop" { doStop() }
        call.resolve()
    }

    /* ── internals ─────────────────────────────────────────────────── */

    private func doStop() {
        stopTicker()
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        currentItem = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        notifyListeners("muchiControls", data: ["message": "stop", "position": 0])
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default,
                                    options: [.allowBluetooth, .allowBluetoothA2DP])
            try session.setActive(true)
        } catch {
            // Foreground playback still works if session config fails.
        }
    }

    private func startTicker() {
        stopTicker()
        let t = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self = self, let p = self.player, let item = self.currentItem else { return }
            if item.status == .failed && !self.errorSent {
                self.errorSent = true
                self.notifyListeners("muchiControls", data: ["message": "error", "position": 0])
                return
            }
            let pos = p.currentTime()
            let dur = item.duration.isNumeric ? item.duration.seconds : 0
            self.notifyListeners("muchiProgress", data: [
                "positionMs": Int(pos.seconds * 1000.0),
                "durationMs": Int(dur * 1000.0),
                "playing": p.rate > 0
            ])
            var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = pos.seconds
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        }
        RunLoop.main.add(t, forMode: .common)
        ticker = t
    }

    private func stopTicker() {
        ticker?.invalidate()
        ticker = nil
    }

    private func updateRate() {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyPlaybackRate] = (player?.rate ?? 0) > 0 ? 1 : 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func updateNowPlaying(title: String, artist: String, artwork: String, durationMs: Double) {
        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = title
        if !artist.isEmpty { info[MPMediaItemPropertyArtist] = artist }
        if durationMs > 0 { info[MPMediaItemPropertyPlaybackDuration] = durationMs / 1000.0 }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = 0.0
        info[MPNowPlayingInfoPropertyPlaybackRate] = 1
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        if !artwork.isEmpty, let artUrl = URL(string: artwork) {
            URLSession.shared.dataTask(with: artUrl) { [weak self] data, _, _ in
                guard let data = data, let img = UIImage(data: data) else { return }
                DispatchQueue.main.async {
                    self?.updateArtwork(img)
                }
            }.resume()
        }
    }

    private func updateArtwork(_ img: UIImage) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func setupRemoteCommands() {
        let cc = MPRemoteCommandCenter.shared()
        cc.playCommand.isEnabled = true
        cc.pauseCommand.isEnabled = true
        cc.togglePlayPauseCommand.isEnabled = true
        cc.nextTrackCommand.isEnabled = true
        cc.previousTrackCommand.isEnabled = true
        cc.changePlaybackPositionCommand.isEnabled = true

        cc.playCommand.addTarget { [weak self] _ in
            self?.notifyListeners("muchiControls", data: ["message": "play", "position": 0])
            self?.player?.play()
            self?.updateRate()
            return .success
        }
        cc.pauseCommand.addTarget { [weak self] _ in
            self?.notifyListeners("muchiControls", data: ["message": "pause", "position": 0])
            self?.player?.pause()
            self?.updateRate()
            return .success
        }
        cc.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            if self.player?.rate ?? 0 > 0 {
                self.notifyListeners("muchiControls", data: ["message": "pause", "position": 0])
                self.player?.pause()
            } else {
                self.notifyListeners("muchiControls", data: ["message": "play", "position": 0])
                self.player?.play()
            }
            self.updateRate()
            return .success
        }
        // Web layer owns the queue — only echo the intent, don't advance locally.
        cc.nextTrackCommand.addTarget { [weak self] _ in
            self?.notifyListeners("muchiControls", data: ["message": "next", "position": 0])
            return .success
        }
        cc.previousTrackCommand.addTarget { [weak self] _ in
            self?.notifyListeners("muchiControls", data: ["message": "previous", "position": 0])
            return .success
        }
        cc.changePlaybackPositionCommand.addTarget { [weak self] event in
            if let posEvent = event as? MPChangePlaybackPositionCommandEvent {
                self?.player?.seek(to: CMTime(seconds: posEvent.positionTime, preferredTimescale: 600))
                return .success
            }
            return .commandFailed
        }
    }

    deinit {
        stopTicker()
    }
}
