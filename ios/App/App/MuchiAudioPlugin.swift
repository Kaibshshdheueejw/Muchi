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
        CAPPluginMethod(name: "preload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekTo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "emit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAudioPrefs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAppIcon", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAppIcon", returnType: CAPPluginReturnPromise)
    ]

    private var player: AVPlayer?
    private var currentItem: AVPlayerItem?
    private var ticker: Timer?
    private var errorSent = false
    private var fallbackDurationMs: Double = 0
    private var prefSpeed: Float = 1.0
    private var prefVolume: Float = 1.0
    private var loadSeq: Int = 0
    private var currentVideoId: String = ""
    private var currentCandidates: String = ""
    private var currentTitle: String = ""
    private var currentArtist: String = ""
    private var triedOnDeviceResolve = false
    private var bgTask: UIBackgroundTaskIdentifier = .invalid

    private func beginAudioBackgroundTask() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.bgTask != .invalid {
                UIApplication.shared.endBackgroundTask(self.bgTask)
                self.bgTask = .invalid
            }
            self.bgTask = UIApplication.shared.beginBackgroundTask(withName: "MuchiAudioTransition") { [weak self] in
                guard let self = self else { return }
                if self.bgTask != .invalid {
                    UIApplication.shared.endBackgroundTask(self.bgTask)
                    self.bgTask = .invalid
                }
            }
        }
    }

    private func endAudioBackgroundTask() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.bgTask != .invalid {
                UIApplication.shared.endBackgroundTask(self.bgTask)
                self.bgTask = .invalid
            }
        }
    }

    private static let defaultUA =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1"

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

        center.addObserver(forName: UIApplication.didEnterBackgroundNotification,
                           object: nil, queue: .main) { [weak self] _ in
            guard let self = self else { return }
            if self.currentItem != nil || (self.player?.rate ?? 0) > 0 {
                self.configureAudioSession()
                if (self.player?.rate ?? 0) == 0 {
                    self.beginAudioBackgroundTask()
                }
            }
        }
    }

    /* ── JS → native ───────────────────────────────────────────────── */

    @objc public func preload(_ call: CAPPluginCall) {
        let videoId = call.getString("videoId") ?? ""
        let candidates = call.getString("candidates") ?? ""
        let title = call.getString("title") ?? ""
        let artist = call.getString("artist") ?? ""
        Self.preloadStream(videoId: videoId, candidates: candidates, title: title, artist: artist)
        call.resolve()
    }

    @objc public func play(_ call: CAPPluginCall) {
        var url = call.getString("url") ?? ""
        var videoId = call.getString("videoId") ?? ""
        if url.isEmpty && !videoId.isEmpty {
            url = "yt:" + videoId
        }
        if videoId.isEmpty && url.lowercased().hasPrefix("yt:") {
            videoId = String(url.dropFirst(3)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if videoId.isEmpty {
            videoId = Self.extractVideoIdFromUrl(url)
        }
        guard !url.isEmpty else {
            call.reject("MuchiAudio: missing url")
            return
        }
        configureAudioSession()
        beginAudioBackgroundTask()

        let title = call.getString("title") ?? "Muchi"
        let artist = call.getString("artist") ?? ""
        let artwork = call.getString("artwork") ?? ""
        let candidates = call.getString("candidates") ?? ""

        currentVideoId = videoId
        currentCandidates = candidates
        currentTitle = title
        currentArtist = artist

        var durMs = call.getDouble("duration") ?? 0
        if durMs <= 0 {
            durMs = Self.extractDurationMsFromUrl(url)
        }
        fallbackDurationMs = max(0, durMs)

        let volPct = call.getDouble("volume") ?? 100.0
        let normalize = call.getBool("normalize") ?? false
        let normGain = normalize ? 0.86 : 1.0
        prefVolume = Float(min(1.0, max(0.0, (volPct / 100.0) * normGain)))

        if let spd = call.getDouble("speed"), spd >= 0.25 && spd <= 3.0 {
            prefSpeed = Float(spd)
        }

        loadSeq += 1
        let seq = loadSeq
        errorSent = false

        // Update Lock Screen / Dynamic Island metadata immediately on tap
        updateNowPlaying(
            title: title,
            artist: artist,
            artwork: artwork,
            durationMs: fallbackDurationMs
        )

        if url.lowercased().hasPrefix("yt:") {
            triedOnDeviceResolve = true
            stopTicker()
            player?.pause()
            let vid = currentVideoId
            let cands = currentCandidates
            let tTitle = currentTitle
            let tArtist = currentArtist
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let rs = Self.resolveStreamForDownload(videoId: vid, candidates: cands, title: tTitle, artist: tArtist)
                DispatchQueue.main.async {
                    guard let self = self, seq == self.loadSeq else { return }
                    if let rs = rs, !rs.url.isEmpty, let streamUrl = URL(string: rs.url) {
                        if rs.durationMs > 0 && self.fallbackDurationMs <= 0 {
                            self.fallbackDurationMs = rs.durationMs
                        }
                        self.startPlayer(with: streamUrl, rawUrl: rs.url, userAgent: rs.userAgent)
                    } else {
                        self.errorSent = true
                        self.notifyListeners("muchiControls", data: ["message": "error", "position": 0])
                    }
                }
            }
            call.resolve()
            return
        }

        guard let streamUrl = URL(string: url) else {
            call.reject("MuchiAudio: invalid url")
            return
        }
        triedOnDeviceResolve = false
        startPlayer(with: streamUrl, rawUrl: url, userAgent: Self.userAgentForStreamUrl(url))
        call.resolve()
    }

    private func startPlayer(with streamUrl: URL, rawUrl: String, userAgent: String) {
        let p: AVPlayer
        if let existing = player { p = existing } else { p = AVPlayer() }
        p.automaticallyWaitsToMinimizeStalling = true
        p.volume = prefVolume
        player = p

        var headers: [String: String] = [:]
        let ua = userAgent.isEmpty ? Self.userAgentForStreamUrl(rawUrl) : userAgent
        if !ua.isEmpty {
            headers["User-Agent"] = ua
        }
        if rawUrl.contains("googlevideo.com") && !rawUrl.contains("c=ANDROID") && !rawUrl.contains("c=IOS") {
            headers["Origin"] = "https://www.youtube.com"
            headers["Referer"] = "https://www.youtube.com/"
        }
        let asset = AVURLAsset(url: streamUrl, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
        let item = AVPlayerItem(asset: asset)
        item.audioTimePitchAlgorithm = .spectral
        currentItem = item
        errorSent = false

        NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            self?.beginAudioBackgroundTask()
            self?.notifyListeners("muchiControls", data: ["message": "ended", "position": 0])
        }

        p.replaceCurrentItem(with: item)
        p.play()
        if prefSpeed != 1.0 {
            p.rate = prefSpeed
        }
        startTicker()
    }

    private static func userAgentForStreamUrl(_ url: String) -> String {
        if url.contains("c=ANDROID_VR") {
            return url.contains("cver=1.61")
                ? "com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"
                : "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"
        }
        if url.contains("c=ANDROID_TESTSUITE") {
            return "com.google.android.youtube/1.9 (Linux; U; Android 11) gzip"
        }
        if url.contains("c=ANDROID") {
            return "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip"
        }
        if url.contains("c=IOS") {
            return "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; en_US)"
        }
        return defaultUA
    }

    private static func extractVideoIdFromUrl(_ rawUrl: String) -> String {
        if let range = rawUrl.range(of: "v=") {
            let sub = String(rawUrl[range.upperBound...])
            let part = sub.components(separatedBy: "&").first ?? sub
            return part.removingPercentEncoding ?? part
        }
        return ""
    }

    private static func extractDurationMsFromUrl(_ rawUrl: String) -> Double {
        var target = rawUrl
        if let uRange = target.range(of: "url=") {
            let sub = String(target[uRange.upperBound...])
            let part = sub.components(separatedBy: "&").first ?? sub
            if let decoded = part.removingPercentEncoding {
                target = decoded
            }
        }
        if let regex = try? NSRegularExpression(pattern: "(?:[?&]|%26)dur(?:=|%3D)([0-9]+(?:\\.[0-9]+)?)"),
           let match = regex.firstMatch(in: target, range: NSRange(target.startIndex..., in: target)),
           let r = Range(match.range(at: 1), in: target),
           let sec = Double(target[r]), sec > 0 && sec < 86400 {
            return sec * 1000.0
        }
        return 0
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
        doStop(notifyJs: false)
        call.resolve()
    }

    @objc public func seekTo(_ call: CAPPluginCall) {
        let ms = call.getDouble("position") ?? 0
        player?.seek(to: CMTime(seconds: ms / 1000.0, preferredTimescale: 600))
        call.resolve()
    }

    @objc public func emit(_ call: CAPPluginCall) {
        let action = call.getString("action") ?? ""
        if action == "stop" { doStop(notifyJs: false) }
        call.resolve()
    }

    @objc public func syncSession(_ call: CAPPluginCall) {
        configureAudioSession()
        let title = call.getString("title") ?? "Muchi"
        let artist = call.getString("artist") ?? ""
        let artwork = call.getString("artwork") ?? ""
        let durationMs = call.getDouble("duration") ?? 0
        let positionMs = call.getDouble("position") ?? 0
        let playing = call.getBool("playing") ?? true
        updateNowPlaying(title: title, artist: artist, artwork: artwork, durationMs: durationMs)
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = positionMs / 1000.0
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1 : 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        call.resolve()
    }

    @objc public func setAudioPrefs(_ call: CAPPluginCall) {
        let volPct = call.getDouble("volume") ?? 100.0
        let normalize = call.getBool("normalize") ?? false
        let normGain = normalize ? 0.86 : 1.0
        let targetVol = Float(min(1.0, max(0.0, (volPct / 100.0) * normGain)))
        player?.volume = targetVol
        if let spd = call.getDouble("speed"), spd >= 0.25 && spd <= 3.0 {
            prefSpeed = Float(spd)
            if (player?.rate ?? 0) > 0 {
                player?.rate = prefSpeed
            }
        }
        call.resolve()
    }

    @objc public func setAppIcon(_ call: CAPPluginCall) {
        let requested = call.getString("icon") ?? "default"
        UserDefaults.standard.set(requested, forKey: "muchi.app_icon")
        DispatchQueue.main.async {
            guard UIApplication.shared.supportsAlternateIcons else {
                call.resolve(["ok": false, "icon": requested, "error": "Alternate icons not supported"])
                return
            }
            let targetName: String? = (requested == "default" || requested.isEmpty) ? nil : requested
            if UIApplication.shared.alternateIconName == targetName {
                call.resolve(["ok": true, "icon": requested])
                return
            }
            UIApplication.shared.setAlternateIconName(targetName) { error in
                if let error = error {
                    call.resolve(["ok": false, "icon": requested, "error": error.localizedDescription])
                } else {
                    call.resolve(["ok": true, "icon": requested])
                }
            }
        }
    }

    @objc public func getAppIcon(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let current = UIApplication.shared.alternateIconName ?? UserDefaults.standard.string(forKey: "muchi.app_icon") ?? "default"
            call.resolve(["icon": current])
        }
    }

    /* ── internals ─────────────────────────────────────────────────── */

    private func doStop(notifyJs: Bool = false) {
        stopTicker()
        endAudioBackgroundTask()
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        currentItem = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if notifyJs {
            notifyListeners("muchiControls", data: ["message": "stop", "position": 0])
        }
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default,
                                    options: [.allowBluetooth, .allowBluetoothA2DP, .allowAirPlay])
            try? session.setPreferredSampleRate(48000.0)
            try session.setActive(true)
        } catch {
            // Foreground playback still works if session config fails.
        }
    }

    private func startTicker() {
        stopTicker()
        let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
            guard let self = self, let p = self.player, let item = self.currentItem else { return }
            if item.status == .failed && !self.errorSent {
                if !self.currentVideoId.isEmpty {
                    Self.invalidateResolvedCache(self.currentVideoId)
                }
                if !self.triedOnDeviceResolve && (!self.currentVideoId.isEmpty || !self.currentTitle.isEmpty) {
                    self.triedOnDeviceResolve = true
                    self.stopTicker()
                    self.beginAudioBackgroundTask()
                    let seq = self.loadSeq
                    let vid = self.currentVideoId
                    let cands = self.currentCandidates
                    let tTitle = self.currentTitle
                    let tArtist = self.currentArtist
                    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                        let rs = Self.resolveStreamForDownload(videoId: vid, candidates: cands, title: tTitle, artist: tArtist)
                        DispatchQueue.main.async {
                            guard let self = self, seq == self.loadSeq else { return }
                            if let rs = rs, !rs.url.isEmpty, let streamUrl = URL(string: rs.url) {
                                if rs.durationMs > 0 && self.fallbackDurationMs <= 0 {
                                    self.fallbackDurationMs = rs.durationMs
                                }
                                self.startPlayer(with: streamUrl, rawUrl: rs.url, userAgent: rs.userAgent)
                            } else {
                                self.errorSent = true
                                self.notifyListeners("muchiControls", data: ["message": "error", "position": 0])
                            }
                        }
                    }
                    return
                }
                self.errorSent = true
                self.notifyListeners("muchiControls", data: ["message": "error", "position": 0])
                return
            }
            if p.rate > 0 && item.status == .readyToPlay {
                self.endAudioBackgroundTask()
            }
            let pos = p.currentTime()
            let posSec = pos.isNumeric && pos.seconds.isFinite && pos.seconds >= 0 ? pos.seconds : 0
            let rawDurMs = (item.duration.isNumeric && item.duration.seconds.isFinite && item.duration.seconds > 0)
                ? (item.duration.seconds * 1000.0)
                : self.fallbackDurationMs
            self.notifyListeners("muchiProgress", data: [
                "positionMs": Int(posSec * 1000.0),
                "durationMs": Int(max(0, rawDurMs)),
                "playing": p.rate > 0
            ])
            var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = posSec
            if rawDurMs > 0 {
                info[MPMediaItemPropertyPlaybackDuration] = rawDurMs / 1000.0
            }
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
            self?.beginAudioBackgroundTask()
            self?.configureAudioSession()
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
                self.beginAudioBackgroundTask()
                self.configureAudioSession()
                self.notifyListeners("muchiControls", data: ["message": "play", "position": 0])
                self.player?.play()
            }
            self.updateRate()
            return .success
        }
        // Web layer owns the queue — only echo the intent, don't advance locally.
        cc.nextTrackCommand.addTarget { [weak self] _ in
            self?.beginAudioBackgroundTask()
            self?.configureAudioSession()
            self?.notifyListeners("muchiControls", data: ["message": "next", "position": 0])
            return .success
        }
        cc.previousTrackCommand.addTarget { [weak self] _ in
            self?.beginAudioBackgroundTask()
            self?.configureAudioSession()
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

    /* ── On-device YouTube InnerTube + Piped m4a resolver (iOS) ────── */

    public struct ResolvedStream {
        public let url: String
        public let userAgent: String
        public let durationMs: Double
        public let mimeType: String
    }

    private struct CachedStream {
        let stream: ResolvedStream
        let expiresAt: Date
    }

    private static let cacheLock = NSLock()
    private static var resolvedCache: [String: CachedStream] = [:]
    private static let cacheTTL: TimeInterval = 20 * 60

    public static func invalidateResolvedCache(_ videoId: String) {
        let key = videoId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return }
        cacheLock.lock()
        resolvedCache.removeValue(forKey: key)
        cacheLock.unlock()
    }

    private static func getCachedStream(_ videoId: String) -> ResolvedStream? {
        let key = videoId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return nil }
        cacheLock.lock()
        defer { cacheLock.unlock() }
        guard let hit = resolvedCache[key] else { return nil }
        if hit.expiresAt <= Date() {
            resolvedCache.removeValue(forKey: key)
            return nil
        }
        return hit.stream
    }

    private static func putCachedStream(_ videoId: String, _ stream: ResolvedStream) {
        let key = videoId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty, !stream.url.isEmpty else { return }
        cacheLock.lock()
        if resolvedCache.count > 200 {
            resolvedCache.removeAll()
        }
        resolvedCache[key] = CachedStream(stream: stream, expiresAt: Date().addingTimeInterval(cacheTTL))
        cacheLock.unlock()
    }

    public static func preloadStream(videoId: String, candidates: String, title: String, artist: String) {
        let vid = videoId.trimmingCharacters(in: .whitespacesAndNewlines)
        if vid.isEmpty && title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return }
        if !vid.isEmpty && getCachedStream(vid) != nil { return }
        DispatchQueue.global(qos: .utility).async {
            _ = resolveStreamForDownload(videoId: vid, candidates: candidates, title: title, artist: artist)
        }
    }

    public static func resolveStreamFast(videoId: String, candidates: String) -> ResolvedStream? {
        return resolveStreamForDownload(videoId: videoId, candidates: candidates, title: "", artist: "")
    }

    public static func resolveStreamForDownload(videoId: String, candidates: String, title: String, artist: String) -> ResolvedStream? {
        let primary = videoId.trimmingCharacters(in: .whitespacesAndNewlines)
        if !primary.isEmpty, let hit = getCachedStream(primary) {
            return hit
        }
        var vids: [String] = []
        if !primary.isEmpty { vids.append(primary) }
        for part in candidates.components(separatedBy: ",") {
            let c = part.trimmingCharacters(in: .whitespacesAndNewlines)
            if !c.isEmpty && !vids.contains(c) { vids.append(c) }
        }
        for vid in vids {
            if let hit = getCachedStream(vid) {
                if !primary.isEmpty { putCachedStream(primary, hit) }
                return hit
            }
            if let rs = probeInnertubeForVideo(vid) {
                putCachedStream(vid, rs)
                if !primary.isEmpty { putCachedStream(primary, rs) }
                return rs
            }
        }
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleanTitle.isEmpty {
            let q = "\(cleanTitle) \(artist.trimmingCharacters(in: .whitespacesAndNewlines)) official audio".trimmingCharacters(in: .whitespacesAndNewlines)
            for svid in searchInnertubeVideoIds(q) where !vids.contains(svid) {
                if let rs = probeInnertubeForVideo(svid) {
                    putCachedStream(svid, rs)
                    if !primary.isEmpty { putCachedStream(primary, rs) }
                    return rs
                }
            }
        }
        for vid in vids {
            if let rs = probePipedForVideo(vid) {
                putCachedStream(vid, rs)
                if !primary.isEmpty { putCachedStream(primary, rs) }
                return rs
            }
        }
        return nil
    }

    private static func probeInnertubeForVideo(_ videoId: String) -> ResolvedStream? {
        guard !videoId.isEmpty, let endpoint = URL(string: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false") else { return nil }
        let tier1VrProfiles: [(id: String, ver: String, ua: String, body: String)] = [
            (
                "28",
                "1.61.48",
                "com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
                "{\"context\":{\"client\":{\"clientName\":\"ANDROID_VR\",\"clientVersion\":\"1.61.48\",\"androidSdkVersion\":32,\"osName\":\"Android\",\"osVersion\":\"12L\",\"deviceMake\":\"Oculus\",\"deviceModel\":\"Quest 3\",\"hl\":\"en\",\"gl\":\"US\"}},\"videoId\":\"\(videoId)\",\"contentCheckOk\":true,\"racyCheckOk\":true}"
            ),
            (
                "28",
                "1.60.19",
                "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
                "{\"context\":{\"client\":{\"clientName\":\"ANDROID_VR\",\"clientVersion\":\"1.60.19\",\"androidSdkVersion\":32,\"osName\":\"Android\",\"osVersion\":\"12L\",\"deviceMake\":\"Oculus\",\"deviceModel\":\"Quest 3\",\"hl\":\"en\",\"gl\":\"US\"}},\"videoId\":\"\(videoId)\",\"contentCheckOk\":true,\"racyCheckOk\":true}"
            )
        ]
        let tier2FallbackProfiles: [(id: String, ver: String, ua: String, body: String)] = [
            (
                "5",
                "20.10.4",
                "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; en_US)",
                "{\"context\":{\"client\":{\"clientName\":\"IOS\",\"clientVersion\":\"20.10.4\",\"deviceMake\":\"Apple\",\"deviceModel\":\"iPhone16,2\",\"osName\":\"iPhone\",\"osVersion\":\"18.3.2.22D82\",\"hl\":\"en\",\"gl\":\"US\"}},\"videoId\":\"\(videoId)\",\"contentCheckOk\":true,\"racyCheckOk\":true}"
            ),
            (
                "3",
                "20.10.38",
                "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip",
                "{\"context\":{\"client\":{\"clientName\":\"ANDROID\",\"clientVersion\":\"20.10.38\",\"androidSdkVersion\":34,\"osName\":\"Android\",\"osVersion\":\"14\",\"hl\":\"en\",\"gl\":\"US\"}},\"videoId\":\"\(videoId)\",\"contentCheckOk\":true,\"racyCheckOk\":true}"
            ),
            (
                "30",
                "1.9",
                "com.google.android.youtube/1.9 (Linux; U; Android 11) gzip",
                "{\"context\":{\"client\":{\"clientName\":\"ANDROID_TESTSUITE\",\"clientVersion\":\"1.9\",\"androidSdkVersion\":30,\"osName\":\"Android\",\"osVersion\":\"11\",\"hl\":\"en\",\"gl\":\"US\"}},\"videoId\":\"\(videoId)\",\"contentCheckOk\":true,\"racyCheckOk\":true}"
            )
        ]

        if let vrStream = probeInnertubeBatch(tier1VrProfiles, endpoint: endpoint) {
            return vrStream
        }
        return probeInnertubeBatch(tier2FallbackProfiles, endpoint: endpoint)
    }

    private static func probeInnertubeBatch(_ profiles: [(id: String, ver: String, ua: String, body: String)], endpoint: URL) -> ResolvedStream? {
        let lock = NSLock()
        var winner: ResolvedStream?
        let doneSem = DispatchSemaphore(value: 0)
        var remaining = profiles.count

        for prof in profiles {
            var req = URLRequest(url: endpoint, timeoutInterval: 3.2)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue(prof.id, forHTTPHeaderField: "X-YouTube-Client-Name")
            req.setValue(prof.ver, forHTTPHeaderField: "X-YouTube-Client-Version")
            req.setValue(prof.ua, forHTTPHeaderField: "User-Agent")
            req.httpBody = prof.body.data(using: .utf8)

            URLSession.shared.dataTask(with: req) { data, response, _ in
                var found: ResolvedStream?
                if let http = response as? HTTPURLResponse, http.statusCode == 200,
                   let data = data,
                   let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                    let playability = root["playabilityStatus"] as? [String: Any]
                    let status = (playability?["status"] as? String) ?? "OK"
                    if status == "OK", let streaming = root["streamingData"] as? [String: Any] {
                        let adaptive = (streaming["adaptiveFormats"] as? [[String: Any]]) ?? []
                        let formats = (streaming["formats"] as? [[String: Any]]) ?? []
                        var bestM4aUrl = ""
                        var bestM4aBr = -1
                        for fmt in (adaptive + formats) {
                            guard let u = fmt["url"] as? String, !u.isEmpty,
                                  let mime = (fmt["mimeType"] as? String)?.lowercased(),
                                  mime.hasPrefix("audio/") else { continue }
                            // iOS AVPlayer + AVAssetReader require MP4/M4A/AAC/MP3 (WebM/Opus is not supported by AVFoundation)
                            if mime.contains("mp4") || mime.contains("m4a") || mime.contains("aac") || mime.contains("mpeg") || mime.contains("mp3") {
                                let br = (fmt["bitrate"] as? Int) ?? 0
                                if br > bestM4aBr {
                                    bestM4aBr = br
                                    bestM4aUrl = u
                                }
                            }
                        }
                        if !bestM4aUrl.isEmpty {
                            var durMs: Double = 0
                            if let vd = root["videoDetails"] as? [String: Any],
                               let lenStr = vd["lengthSeconds"] as? String,
                               let sec = Double(lenStr), sec > 0 {
                                durMs = sec * 1000.0
                            }
                            if durMs <= 0 {
                                durMs = extractDurationMsFromUrl(bestM4aUrl)
                            }
                            found = ResolvedStream(url: bestM4aUrl, userAgent: prof.ua, durationMs: durMs, mimeType: "audio/mp4")
                        }
                    }
                }
                lock.lock()
                if let f = found, winner == nil {
                    winner = f
                    lock.unlock()
                    doneSem.signal()
                    return
                }
                remaining -= 1
                let allDone = (remaining <= 0 && winner == nil)
                lock.unlock()
                if allDone {
                    doneSem.signal()
                }
            }.resume()
        }

        _ = doneSem.wait(timeout: .now() + 3.5)
        lock.lock()
        let result = winner
        lock.unlock()
        return result
    }

    private static func searchInnertubeVideoIds(_ query: String) -> [String] {
        guard let url = URL(string: "https://www.youtube.com/youtubei/v1/search?prettyPrint=false") else { return [] }
        var req = URLRequest(url: url, timeoutInterval: 4.5)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("https://www.youtube.com", forHTTPHeaderField: "Origin")
        req.setValue("https://www.youtube.com/", forHTTPHeaderField: "Referer")
        req.setValue(defaultUA, forHTTPHeaderField: "User-Agent")
        let safeQ = query.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        let payload = "{\"context\":{\"client\":{\"clientName\":\"WEB\",\"clientVersion\":\"2.20240815.00.00\",\"hl\":\"en\",\"gl\":\"US\"}},\"query\":\"\(safeQ)\"}"
        req.httpBody = payload.data(using: .utf8)

        var out: [String] = []
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { data, response, _ in
            defer { sem.signal() }
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let data = data, let text = String(data: data, encoding: .utf8),
                  let regex = try? NSRegularExpression(pattern: "\"videoId\"\\s*:\\s*\"([A-Za-z0-9_-]{11})\"") else { return }
            let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
            for m in matches {
                if let r = Range(m.range(at: 1), in: text) {
                    let vid = String(text[r])
                    if !out.contains(vid) {
                        out.append(vid)
                        if out.count >= 4 { break }
                    }
                }
            }
        }.resume()
        _ = sem.wait(timeout: .now() + 4.8)
        return out
    }

    private static func probePipedForVideo(_ videoId: String) -> ResolvedStream? {
        let hosts = [
            "https://api.piped.private.coffee",
            "https://pipedapi.kavin.rocks",
            "https://pipedapi.adminforge.de"
        ]
        for h in hosts {
            guard let url = URL(string: "\(h)/streams/\(videoId)") else { continue }
            var req = URLRequest(url: url, timeoutInterval: 4.0)
            req.setValue(defaultUA, forHTTPHeaderField: "User-Agent")
            var found: ResolvedStream?
            let sem = DispatchSemaphore(value: 0)
            URLSession.shared.dataTask(with: req) { data, response, _ in
                defer { sem.signal() }
                guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                      let data = data,
                      let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                      let streams = root["audioStreams"] as? [[String: Any]] else { return }
                var bestUrl = ""
                var bestBr = -1
                for s in streams {
                    guard let u = s["url"] as? String, !u.isEmpty else { continue }
                    let mime = ((s["mimeType"] as? String) ?? "").lowercased()
                    let fmt = ((s["format"] as? String) ?? "").lowercased()
                    if mime.contains("mp4") || mime.contains("m4a") || mime.contains("aac") || fmt.contains("m4a") || mime.contains("mpeg") {
                        let br = (s["bitrate"] as? Int) ?? 0
                        if br > bestBr {
                            bestBr = br
                            bestUrl = u
                        }
                    }
                }
                if !bestUrl.isEmpty {
                    let durSec = (root["duration"] as? Double) ?? 0
                    found = ResolvedStream(url: bestUrl, userAgent: defaultUA, durationMs: durSec * 1000.0, mimeType: "audio/mp4")
                }
            }.resume()
            _ = sem.wait(timeout: .now() + 4.2)
            if let f = found { return f }
        }
        return nil
    }
}
