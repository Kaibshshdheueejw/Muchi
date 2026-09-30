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
    private var resolvingOnDevice = false
    private var pendingSeekMs: Double = 0
    private var pendingSeekSetAt: CFAbsoluteTime = 0
    private var lastKnownPositionMs: Double = 0
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
        let rawTitle = call.getString("title") ?? ""
        if url.isEmpty && (!videoId.isEmpty || !rawTitle.isEmpty) {
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
        let startPosMs = max(0, call.getDouble("position") ?? 0)
        pendingSeekMs = startPosMs
        pendingSeekSetAt = startPosMs > 0 ? CFAbsoluteTimeGetCurrent() : 0
        lastKnownPositionMs = startPosMs

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
            durationMs: fallbackDurationMs,
            elapsedMs: startPosMs
        )

        let lowUrl = url.lowercased()
        // Instant App Audio Cache Hit: If this song has already been played and cached in
        // muchi_audio_cache on disk, play the local cached audio file immediately in 0ms
        // with zero backend or network load!
        if !lowUrl.hasPrefix("file:") {
            if let cachedFileUrl = Self.getCachedAudioFile(videoId: currentVideoId, title: currentTitle, artist: currentArtist) {
                resolvingOnDevice = false
                triedOnDeviceResolve = false
                startPlayer(with: cachedFileUrl, rawUrl: cachedFileUrl.absoluteString, userAgent: "")
                call.resolve()
                return
            }
        }

        let isUnsupportedWebm = lowUrl.contains("mime=audio%2fwebm") || lowUrl.contains("mime=audio/webm") || lowUrl.contains(" codecs=\"opus\"")
        if lowUrl.hasPrefix("yt:") || (isUnsupportedWebm && !currentVideoId.isEmpty) {
            triedOnDeviceResolve = true
            resolvingOnDevice = true
            stopTicker()
            player?.pause()
            player?.replaceCurrentItem(with: nil)
            currentItem = nil
            let vid = currentVideoId
            let cands = currentCandidates
            let tTitle = currentTitle
            let tArtist = currentArtist
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let rs = Self.resolveStreamForDownload(videoId: vid, candidates: cands, title: tTitle, artist: tArtist)
                DispatchQueue.main.async {
                    guard let self = self, seq == self.loadSeq else { return }
                    self.resolvingOnDevice = false
                    if let rs = rs, !rs.url.isEmpty, let streamUrl = URL(string: rs.url) {
                        if rs.durationMs > 0 && self.fallbackDurationMs <= 0 {
                            self.fallbackDurationMs = rs.durationMs
                        }
                        self.startPlayer(with: streamUrl, rawUrl: rs.url, userAgent: rs.userAgent)
                    } else {
                        self.errorSent = true
                        self.notifyListeners("muchiControls", data: ["message": "error", "position": Int(self.lastKnownPositionMs)])
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
        resolvingOnDevice = false
        triedOnDeviceResolve = false
        startPlayer(with: streamUrl, rawUrl: url, userAgent: Self.userAgentForStreamUrl(url))
        call.resolve()
    }

    private func startPlayer(with streamUrl: URL, rawUrl: String, userAgent: String) {
        let p: AVPlayer
        if let existing = player { p = existing } else { p = AVPlayer() }
        p.automaticallyWaitsToMinimizeStalling = false
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
        item.preferredForwardBufferDuration = 12.0
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
        let startAtMs = max(0, pendingSeekMs)
        if startAtMs > 0 {
            lastKnownPositionMs = startAtMs
            let targetTime = CMTime(seconds: startAtMs / 1000.0, preferredTimescale: 600)
            item.seek(to: targetTime, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
                if finished {
                    self?.pendingSeekMs = 0
                }
            }
        }
        p.playImmediately(atRate: prefSpeed)
        if !streamUrl.isFileURL && (rawUrl.hasPrefix("http://") || rawUrl.hasPrefix("https://")) {
            let expectedSeq = loadSeq
            let vid = currentVideoId
            let tTitle = currentTitle
            let tArtist = currentArtist
            DispatchQueue.main.asyncAfter(deadline: .now() + 6.0) { [weak self] in
                guard let self = self, self.loadSeq == expectedSeq, (self.player?.rate ?? 0) > 0 else { return }
                Self.cacheStreamToDiskAsync(
                    streamUrl: streamUrl,
                    rawUrl: rawUrl,
                    userAgent: ua,
                    videoId: vid,
                    title: tTitle,
                    artist: tArtist
                )
            }
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
        let ms = max(0, call.getDouble("position") ?? 0)
        lastKnownPositionMs = ms
        pendingSeekMs = ms
        pendingSeekSetAt = CFAbsoluteTimeGetCurrent()
        if !resolvingOnDevice, let p = player {
            let target = CMTime(seconds: ms / 1000.0, preferredTimescale: 600)
            let tol = CMTime(seconds: 0.3, preferredTimescale: 600)
            p.seek(to: target, toleranceBefore: tol, toleranceAfter: tol) { [weak self] _ in
                guard let self = self else { return }
                self.pendingSeekMs = 0
                if (self.player?.rate ?? 0) == 0 {
                    self.player?.playImmediately(atRate: self.prefSpeed)
                }
            }
        }
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = ms / 1000.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
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
                var errPosMs = max(self.pendingSeekMs, self.lastKnownPositionMs)
                let cur = p.currentTime()
                if cur.isNumeric && cur.seconds.isFinite && cur.seconds > 0 {
                    errPosMs = max(errPosMs, cur.seconds * 1000.0)
                }
                if !self.currentVideoId.isEmpty {
                    Self.invalidateResolvedCache(self.currentVideoId)
                }
                if let urlAsset = item.asset as? AVURLAsset, urlAsset.url.isFileURL {
                    Self.evictCachedAudioFile(videoId: self.currentVideoId, title: self.currentTitle, artist: self.currentArtist)
                    self.triedOnDeviceResolve = false
                }
                if !self.triedOnDeviceResolve && (!self.currentVideoId.isEmpty || !self.currentTitle.isEmpty) {
                    self.triedOnDeviceResolve = true
                    self.resolvingOnDevice = true
                    self.pendingSeekMs = errPosMs
                    self.lastKnownPositionMs = errPosMs
                    self.stopTicker()
                    self.beginAudioBackgroundTask()
                    let seq = self.loadSeq
                    let vid = self.currentVideoId
                    let cands = self.currentCandidates
                    let tTitle = self.currentTitle
                    let tArtist = self.currentArtist
                    let resumeMs = errPosMs
                    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                        let rs = Self.resolveStreamForDownload(videoId: vid, candidates: cands, title: tTitle, artist: tArtist)
                        DispatchQueue.main.async {
                            guard let self = self, seq == self.loadSeq else { return }
                            self.resolvingOnDevice = false
                            if let rs = rs, !rs.url.isEmpty, let streamUrl = URL(string: rs.url) {
                                if rs.durationMs > 0 && self.fallbackDurationMs <= 0 {
                                    self.fallbackDurationMs = rs.durationMs
                                }
                                if self.pendingSeekMs <= 0 && resumeMs > 0 {
                                    self.pendingSeekMs = resumeMs
                                }
                                self.startPlayer(with: streamUrl, rawUrl: rs.url, userAgent: rs.userAgent)
                            } else {
                                self.errorSent = true
                                self.notifyListeners("muchiControls", data: ["message": "error", "position": Int(resumeMs)])
                            }
                        }
                    }
                    return
                }
                self.errorSent = true
                self.notifyListeners("muchiControls", data: ["message": "error", "position": Int(errPosMs)])
                return
            }
            if p.rate > 0 && item.status == .readyToPlay {
                self.endAudioBackgroundTask()
            }
            let pos = p.currentTime()
            var posSec = pos.isNumeric && pos.seconds.isFinite && pos.seconds >= 0 ? pos.seconds : 0
            let seekElapsed = CFAbsoluteTimeGetCurrent() - self.pendingSeekSetAt
            if self.pendingSeekMs > 0 && (item.status != .readyToPlay || (abs(posSec * 1000.0 - self.pendingSeekMs) >= 4000.0 && seekElapsed < 2.2)) {
                posSec = self.pendingSeekMs / 1000.0
            } else if posSec > 0 {
                self.lastKnownPositionMs = posSec * 1000.0
                if self.pendingSeekMs > 0 && (abs(posSec * 1000.0 - self.pendingSeekMs) < 4000.0 || seekElapsed >= 2.2) {
                    self.pendingSeekMs = 0
                }
            }
            let rawDurMs = (item.duration.isNumeric && item.duration.seconds.isFinite && item.duration.seconds > 0)
                ? (item.duration.seconds * 1000.0)
                : self.fallbackDurationMs
            let isPlayingNow = self.resolvingOnDevice || p.rate > 0 || p.timeControlStatus == .waitingToPlayAtSpecifiedRate || self.pendingSeekMs > 0
            self.notifyListeners("muchiProgress", data: [
                "positionMs": Int(posSec * 1000.0),
                "durationMs": Int(max(0, rawDurMs)),
                "playing": isPlayingNow
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

    private func updateNowPlaying(title: String, artist: String, artwork: String, durationMs: Double, elapsedMs: Double = 0) {
        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = title
        if !artist.isEmpty { info[MPMediaItemPropertyArtist] = artist }
        if durationMs > 0 { info[MPMediaItemPropertyPlaybackDuration] = durationMs / 1000.0 }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = max(0, elapsedMs) / 1000.0
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
                let ms = max(0, posEvent.positionTime * 1000.0)
                self?.lastKnownPositionMs = ms
                self?.pendingSeekMs = ms
                let target = CMTime(seconds: posEvent.positionTime, preferredTimescale: 600)
                self?.player?.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { finished in
                    if finished {
                        self?.pendingSeekMs = 0
                    }
                }
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
    private static var activeAudioCacheDownloads = Set<String>()
    private static let maxAudioCacheBytes: Int64 = 250 * 1024 * 1024

    private static func getAudioCacheDir() -> URL? {
        guard let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let dir = base.appendingPathComponent("muchi_audio_cache", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    private static func sanitizeAudioCacheKey(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "" }
        let cleaned = trimmed.replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "_", options: .regularExpression)
        if cleaned.count > 96 {
            let prefix = String(cleaned.prefix(64))
            return "\(prefix)_\(abs(trimmed.hashValue))"
        }
        return cleaned
    }

    public static func getCachedAudioFile(videoId: String, title: String, artist: String) -> URL? {
        guard let dir = getAudioCacheDir() else { return nil }
        let fm = FileManager.default
        let minValidBytes: Int64 = 262144 // 256 KB minimum to reject truncated/partial stream files
        let vid = videoId.trimmingCharacters(in: .whitespacesAndNewlines)
        if !vid.isEmpty {
            let vf = dir.appendingPathComponent(sanitizeAudioCacheKey("vid_\(vid)") + ".m4a")
            if fm.fileExists(atPath: vf.path) {
                if let attrs = try? fm.attributesOfItem(atPath: vf.path),
                   let size = attrs[.size] as? NSNumber, size.int64Value >= minValidBytes {
                    try? fm.setAttributes([.modificationDate: Date()], ofItemAtPath: vf.path)
                    return vf
                } else {
                    try? fm.removeItem(at: vf)
                }
            }
        }
        let qKey = queryCacheKey(title: title, artist: artist)
        if !qKey.isEmpty {
            let qf = dir.appendingPathComponent(sanitizeAudioCacheKey(qKey) + ".m4a")
            if fm.fileExists(atPath: qf.path) {
                if let attrs = try? fm.attributesOfItem(atPath: qf.path),
                   let size = attrs[.size] as? NSNumber, size.int64Value >= minValidBytes {
                    try? fm.setAttributes([.modificationDate: Date()], ofItemAtPath: qf.path)
                    return qf
                } else {
                    try? fm.removeItem(at: qf)
                }
            }
        }
        return nil
    }

    public static func evictCachedAudioFile(videoId: String, title: String, artist: String) {
        guard let dir = getAudioCacheDir() else { return }
        let fm = FileManager.default
        let vid = videoId.trimmingCharacters(in: .whitespacesAndNewlines)
        if !vid.isEmpty {
            let vf = dir.appendingPathComponent(sanitizeAudioCacheKey("vid_\(vid)") + ".m4a")
            try? fm.removeItem(at: vf)
        }
        let qKey = queryCacheKey(title: title, artist: artist)
        if !qKey.isEmpty {
            let qf = dir.appendingPathComponent(sanitizeAudioCacheKey(qKey) + ".m4a")
            try? fm.removeItem(at: qf)
        }
    }

    private static func pruneAudioCacheDir(_ dir: URL) {
        let fm = FileManager.default
        guard let urls = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey], options: [.skipsHiddenFiles]) else { return }
        var total: Int64 = 0
        var entries: [(url: URL, size: Int64, date: Date)] = []
        for u in urls {
            if let vals = try? u.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey]),
               let sz = vals.fileSize {
                let s64 = Int64(sz)
                total += s64
                entries.append((u, s64, vals.contentModificationDate ?? Date.distantPast))
            }
        }
        if total <= maxAudioCacheBytes { return }
        entries.sort { $0.date < $1.date }
        for e in entries {
            if (try? fm.removeItem(at: e.url)) != nil {
                total -= e.size
                if total <= (maxAudioCacheBytes * 80) / 100 { break }
            }
        }
    }

    private static func cacheStreamToDiskAsync(streamUrl: URL, rawUrl: String, userAgent: String, videoId: String, title: String, artist: String) {
        if getCachedAudioFile(videoId: videoId, title: title, artist: artist) != nil { return }
        if rawUrl.contains("googlevideo.com") && (rawUrl.contains("c=IOS") || rawUrl.contains("c=ANDROID&")) {
            return
        }
        let vid = videoId.trimmingCharacters(in: .whitespacesAndNewlines)
        let primaryKey = !vid.isEmpty ? sanitizeAudioCacheKey("vid_\(vid)") : sanitizeAudioCacheKey(queryCacheKey(title: title, artist: artist))
        guard !primaryKey.isEmpty else { return }
        let secondaryKey = (!vid.isEmpty && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            ? sanitizeAudioCacheKey(queryCacheKey(title: title, artist: artist))
            : ""
        cacheLock.lock()
        if activeAudioCacheDownloads.contains(primaryKey) {
            cacheLock.unlock()
            return
        }
        activeAudioCacheDownloads.insert(primaryKey)
        cacheLock.unlock()

        var urlClen: Int64 = 0
        if let regex = try? NSRegularExpression(pattern: "(?:[?&]|%26)clen(?:=|%3D)([0-9]+)"),
           let match = regex.firstMatch(in: rawUrl, range: NSRange(rawUrl.startIndex..., in: rawUrl)),
           let r = Range(match.range(at: 1), in: rawUrl),
           let parsed = Int64(rawUrl[r]) {
            urlClen = parsed
        }

        var req = URLRequest(url: streamUrl, timeoutInterval: 25.0)
        let ua = userAgent.isEmpty ? userAgentForStreamUrl(rawUrl) : userAgent
        if !ua.isEmpty { req.setValue(ua, forHTTPHeaderField: "User-Agent") }
        if rawUrl.contains("googlevideo.com") && !rawUrl.contains("c=ANDROID") && !rawUrl.contains("c=IOS") {
            req.setValue("https://www.youtube.com", forHTTPHeaderField: "Origin")
            req.setValue("https://www.youtube.com/", forHTTPHeaderField: "Referer")
        }
        URLSession.shared.downloadTask(with: req) { tempUrl, response, _ in
            defer {
                cacheLock.lock()
                activeAudioCacheDownloads.remove(primaryKey)
                cacheLock.unlock()
            }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  let tempUrl = tempUrl,
                  let dir = getAudioCacheDir() else { return }
            let fm = FileManager.default
            let expectedBytes = http.expectedContentLength > 0 ? http.expectedContentLength : urlClen
            guard let attrs = try? fm.attributesOfItem(atPath: tempUrl.path),
                  let size = attrs[.size] as? NSNumber else { return }
            let written = size.int64Value
            let completeEnough = written >= 262144
                && written < 45 * 1024 * 1024
                && (expectedBytes <= 0 || written >= (expectedBytes * 98) / 100)
            guard completeEnough else { return }
            let targetUrl = dir.appendingPathComponent(primaryKey + ".m4a")
            try? fm.removeItem(at: targetUrl)
            if (try? fm.moveItem(at: tempUrl, to: targetUrl)) != nil {
                if !secondaryKey.isEmpty && secondaryKey != primaryKey {
                    let secUrl = dir.appendingPathComponent(secondaryKey + ".m4a")
                    if !fm.fileExists(atPath: secUrl.path) {
                        try? fm.copyItem(at: targetUrl, to: secUrl)
                    }
                }
                pruneAudioCacheDir(dir)
            }
        }.resume()
    }

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

    private static func queryCacheKey(title: String, artist: String) -> String {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if t.isEmpty { return "" }
        let a = artist.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return "q:\(t)|\(a)"
    }

    public static func preloadStream(videoId: String, candidates: String, title: String, artist: String) {
        let vid = videoId.trimmingCharacters(in: .whitespacesAndNewlines)
        if vid.isEmpty && title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return }
        if !vid.isEmpty && getCachedStream(vid) != nil { return }
        let qKey = queryCacheKey(title: title, artist: artist)
        if !qKey.isEmpty && getCachedStream(qKey) != nil { return }
        DispatchQueue.global(qos: .utility).async {
            _ = resolveStreamForDownload(videoId: vid, candidates: candidates, title: title, artist: artist)
        }
    }

    public static func resolveStreamFast(videoId: String, candidates: String) -> ResolvedStream? {
        return resolveStreamForDownload(videoId: videoId, candidates: candidates, title: "", artist: "")
    }

    public static func resolveStreamForDownload(videoId: String, candidates: String, title: String, artist: String) -> ResolvedStream? {
        let primary = videoId.trimmingCharacters(in: .whitespacesAndNewlines)
        let qKey = queryCacheKey(title: title, artist: artist)
        if !primary.isEmpty, let hit = getCachedStream(primary) {
            return hit
        }
        if !qKey.isEmpty, let hit = getCachedStream(qKey) {
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
                if !qKey.isEmpty { putCachedStream(qKey, hit) }
                return hit
            }
        }
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanArtist = artist.trimmingCharacters(in: .whitespacesAndNewlines)
        var searchedVids: [String] = []
        let searchSem = DispatchSemaphore(value: 0)
        let startConcurrentSearch = (vids.count <= 1 && !cleanTitle.isEmpty)
        if startConcurrentSearch {
            let q = "\(cleanTitle) \(cleanArtist)".trimmingCharacters(in: .whitespacesAndNewlines)
            DispatchQueue.global(qos: .userInitiated).async {
                searchedVids = searchInnertubeVideoIds(q)
                searchSem.signal()
            }
        }
        if !vids.isEmpty {
            if let rs = probeMultipleVideosParallel(Array(vids.prefix(3))) {
                if !primary.isEmpty { putCachedStream(primary, rs) }
                if !qKey.isEmpty { putCachedStream(qKey, rs) }
                return rs
            }
        }
        if !cleanTitle.isEmpty {
            if startConcurrentSearch {
                _ = searchSem.wait(timeout: .now() + 2.8)
            }
            if searchedVids.isEmpty {
                let q = "\(cleanTitle) \(cleanArtist)".trimmingCharacters(in: .whitespacesAndNewlines)
                searchedVids = searchInnertubeVideoIds(q)
            }
            let freshSearch = searchedVids.filter { !$0.isEmpty && !vids.contains($0) }
            for sv in freshSearch where !vids.contains(sv) { vids.append(sv) }
            if !freshSearch.isEmpty, let rs = probeMultipleVideosParallel(Array(freshSearch.prefix(4))) {
                if !primary.isEmpty { putCachedStream(primary, rs) }
                if !qKey.isEmpty { putCachedStream(qKey, rs) }
                return rs
            }
        }
        for vid in vids.prefix(3) {
            if let rs = probePipedForVideo(vid) {
                putCachedStream(vid, rs)
                if !primary.isEmpty { putCachedStream(primary, rs) }
                if !qKey.isEmpty { putCachedStream(qKey, rs) }
                return rs
            }
        }
        if !cleanTitle.isEmpty {
            if let aud = probeAudiusForTitle(title: cleanTitle, artist: cleanArtist) {
                if !primary.isEmpty { putCachedStream(primary, aud) }
                if !qKey.isEmpty { putCachedStream(qKey, aud) }
                return aud
            }
        }
        return nil
    }

    private static func probeMultipleVideosParallel(_ videoIds: [String]) -> ResolvedStream? {
        guard !videoIds.isEmpty else { return nil }
        if videoIds.count == 1 {
            let vid = videoIds[0]
            if let hit = getCachedStream(vid) { return hit }
            if let rs = probeInnertubeForVideo(vid) {
                putCachedStream(vid, rs)
                return rs
            }
            return nil
        }
        let lock = NSLock()
        var winner: ResolvedStream?
        let sem = DispatchSemaphore(value: 0)
        var remaining = videoIds.count
        for vid in videoIds {
            DispatchQueue.global(qos: .userInitiated).async {
                var found = getCachedStream(vid)
                if found == nil, let r = probeInnertubeForVideo(vid) {
                    putCachedStream(vid, r)
                    found = r
                }
                lock.lock()
                if let f = found, winner == nil {
                    winner = f
                    lock.unlock()
                    sem.signal()
                    return
                }
                remaining -= 1
                let done = (remaining <= 0 && winner == nil)
                lock.unlock()
                if done { sem.signal() }
            }
        }
        _ = sem.wait(timeout: .now() + 2.8)
        lock.lock()
        let res = winner
        lock.unlock()
        return res
    }

    private static func probeInnertubeForVideo(_ videoId: String) -> ResolvedStream? {
        guard !videoId.isEmpty, let endpoint = URL(string: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false") else { return nil }
        let primaryProfiles: [(id: String, ver: String, ua: String, body: String)] = [
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
            ),
            (
                "30",
                "1.9",
                "com.google.android.youtube/1.9 (Linux; U; Android 11) gzip",
                "{\"context\":{\"client\":{\"clientName\":\"ANDROID_TESTSUITE\",\"clientVersion\":\"1.9\",\"androidSdkVersion\":30,\"osName\":\"Android\",\"osVersion\":\"11\",\"hl\":\"en\",\"gl\":\"US\"}},\"videoId\":\"\(videoId)\",\"contentCheckOk\":true,\"racyCheckOk\":true}"
            )
        ]
        if let hit = probeInnertubeBatch(primaryProfiles, endpoint: endpoint) {
            return hit
        }
        let secondaryProfiles: [(id: String, ver: String, ua: String, body: String)] = [
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
            )
        ]
        return probeInnertubeBatch(secondaryProfiles, endpoint: endpoint)
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
        let cleanQ = query.replacingOccurrences(of: "\\bofficial\\s+audio\\b", with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let effCleanQ = cleanQ.isEmpty ? query.trimmingCharacters(in: .whitespacesAndNewlines) : cleanQ
        let safeCleanQ = effCleanQ.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        let safeRawQ = query.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        var out: [String] = []

        // 1a. Primary: YouTube Music WEB_REMIX Songs-shelf search
        if let musicUrl = URL(string: "https://music.youtube.com/youtubei/v1/search?prettyPrint=false") {
            var req = URLRequest(url: musicUrl, timeoutInterval: 2.6)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("https://music.youtube.com", forHTTPHeaderField: "Origin")
            req.setValue("https://music.youtube.com/", forHTTPHeaderField: "Referer")
            req.setValue(defaultUA, forHTTPHeaderField: "User-Agent")
            let payload = "{\"context\":{\"client\":{\"clientName\":\"WEB_REMIX\",\"clientVersion\":\"1.20240814.01.00\",\"hl\":\"en\",\"gl\":\"US\"}},\"query\":\"\(safeCleanQ)\",\"params\":\"EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D\"}"
            req.httpBody = payload.data(using: .utf8)

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
                            if out.count >= 5 { break }
                        }
                    }
                }
            }.resume()
            _ = sem.wait(timeout: .now() + 2.8)
            if out.count >= 3 { return out }

            // 1b. Secondary: unfiltered WEB_REMIX search
            var req1b = URLRequest(url: musicUrl, timeoutInterval: 2.6)
            req1b.httpMethod = "POST"
            req1b.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req1b.setValue("https://music.youtube.com", forHTTPHeaderField: "Origin")
            req1b.setValue("https://music.youtube.com/", forHTTPHeaderField: "Referer")
            req1b.setValue(defaultUA, forHTTPHeaderField: "User-Agent")
            let payload1b = "{\"context\":{\"client\":{\"clientName\":\"WEB_REMIX\",\"clientVersion\":\"1.20240814.01.00\",\"hl\":\"en\",\"gl\":\"US\"}},\"query\":\"\(safeRawQ)\"}"
            req1b.httpBody = payload1b.data(using: .utf8)
            let sem1b = DispatchSemaphore(value: 0)
            URLSession.shared.dataTask(with: req1b) { data, response, _ in
                defer { sem1b.signal() }
                guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                      let data = data, let text = String(data: data, encoding: .utf8),
                      let regex = try? NSRegularExpression(pattern: "\"videoId\"\\s*:\\s*\"([A-Za-z0-9_-]{11})\"") else { return }
                let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
                for m in matches {
                    if let r = Range(m.range(at: 1), in: text) {
                        let vid = String(text[r])
                        if !out.contains(vid) {
                            out.append(vid)
                            if out.count >= 6 { break }
                        }
                    }
                }
            }.resume()
            _ = sem1b.wait(timeout: .now() + 2.8)
            if !out.isEmpty { return out }
        }

        // 2. Fallback: standard YouTube WEB search
        guard let url = URL(string: "https://www.youtube.com/youtubei/v1/search?prettyPrint=false") else { return [] }
        var req = URLRequest(url: url, timeoutInterval: 3.0)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("https://www.youtube.com", forHTTPHeaderField: "Origin")
        req.setValue("https://www.youtube.com/", forHTTPHeaderField: "Referer")
        req.setValue(defaultUA, forHTTPHeaderField: "User-Agent")
        let payload = "{\"context\":{\"client\":{\"clientName\":\"WEB\",\"clientVersion\":\"2.20240815.00.00\",\"hl\":\"en\",\"gl\":\"US\"}},\"query\":\"\(safeRawQ)\"}"
        req.httpBody = payload.data(using: .utf8)

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
                        if out.count >= 5 { break }
                    }
                }
            }
        }.resume()
        _ = sem.wait(timeout: .now() + 3.2)
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

    private static func probeAudiusForTitle(title: String, artist: String) -> ResolvedStream? {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanArtist = artist.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty else { return nil }
        var coreTitle = cleanTitle.replacingOccurrences(
            of: "\\s*[\\[(][^)\\]]*(?:feat\\.?|ft\\.?|featuring|with|from\\b|official|video|audio|lyric|remaster|version)[^)\\]]*[)\\]]",
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        coreTitle = coreTitle.replacingOccurrences(
            of: "\\s+(?:feat\\.?|ft\\.?|featuring)\\s+.*$",
            with: "",
            options: [.regularExpression, .caseInsensitive]
        ).trimmingCharacters(in: .whitespacesAndNewlines)
        if coreTitle.isEmpty { coreTitle = cleanTitle }
        let strippedArtist = cleanArtist.replacingOccurrences(
            of: "\\s*[\\[(]?\\s*(?:feat\\.?|ft\\.?|featuring)\\s+.*$",
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        let rawArtistParts = strippedArtist
            .components(separatedBy: CharacterSet(charactersIn: ",&/"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let coreArtist = rawArtistParts.first ?? cleanArtist
        let artistTokens = rawArtistParts
            .map { $0.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.count >= 2 }
        var queries: [String] = []
        if !coreArtist.isEmpty { queries.append("\(coreTitle) \(coreArtist)") }
        if rawArtistParts.count > 1 {
            let qSecond = "\(coreTitle) \(rawArtistParts[1])"
            if !queries.contains(qSecond) { queries.append(qSecond) }
        }
        if !queries.contains(coreTitle) { queries.append(coreTitle) }
        if !cleanArtist.isEmpty {
            let fullQ = "\(cleanTitle) \(cleanArtist)"
            if !queries.contains(fullQ) { queries.append(fullQ) }
        }
        let wantTitle = cleanTitle.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        let wantCore = coreTitle.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        for q in queries {
            guard let encodedQ = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
                  let url = URL(string: "https://discoveryprovider.audius.co/v1/tracks/search?query=\(encodedQ)&app_name=MUCHI") else {
                continue
            }
            var req = URLRequest(url: url, timeoutInterval: 3.5)
            req.setValue(defaultUA, forHTTPHeaderField: "User-Agent")
            var found: ResolvedStream?
            let sem = DispatchSemaphore(value: 0)
            URLSession.shared.dataTask(with: req) { data, response, _ in
                defer { sem.signal() }
                guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                      let data = data,
                      let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                      let items = root["data"] as? [[String: Any]] else { return }
                for item in items {
                    if (item["is_delete"] as? Bool) == true || (item["is_streamable"] as? Bool) == false { continue }
                    if let access = item["access"] as? [String: Any], (access["stream"] as? Bool) == false { continue }
                    guard let id = item["id"] as? String, !id.isEmpty else { continue }
                    let durSec = (item["duration"] as? Double) ?? Double((item["duration"] as? Int) ?? 0)
                    if durSec < 45 { continue }
                    let rawItemTitle = (item["title"] as? String) ?? ""
                    let gotTitle = rawItemTitle.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
                    let strippedTitle = rawItemTitle.replacingOccurrences(
                        of: "\\s*[\\[(][^)\\]]*(?:feat\\.?|ft\\.?|featuring|with|from\\b|official|video|audio|lyric|remaster|version|hd|hq|4k|\\d+kbps|[A-Za-z0-9_-]{11})[^)\\]]*[)\\]]",
                        with: "",
                        options: [.regularExpression, .caseInsensitive]
                    ).replacingOccurrences(
                        of: "\\s+(?:feat\\.?|ft\\.?|featuring)\\s+.*$",
                        with: "",
                        options: [.regularExpression, .caseInsensitive]
                    ).trimmingCharacters(in: .whitespacesAndNewlines)
                    let gotCore = strippedTitle.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
                    let dashSegments = strippedTitle.components(separatedBy: " - ")
                    let userDict = item["user"] as? [String: Any]
                    let rawArtist = "\((userDict?["name"] as? String) ?? "") \((userDict?["handle"] as? String) ?? "")"
                    let gotArtist = rawArtist.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
                    let combinedArtistText = "\(gotArtist) \(gotTitle)".trimmingCharacters(in: .whitespacesAndNewlines)
                    var titleMatch = (!wantTitle.isEmpty && !gotTitle.isEmpty && (gotTitle == wantTitle || gotTitle.hasPrefix(wantTitle + " ")))
                        || (!wantCore.isEmpty && !gotCore.isEmpty && (gotCore == wantCore || gotCore.hasPrefix(wantCore + " ")))
                    if !titleMatch {
                        for seg in dashSegments {
                            let cleanSeg = seg.replacingOccurrences(of: "\\s+(?:feat\\.?|ft\\.?|featuring)\\s+.*$", with: "", options: [.regularExpression, .caseInsensitive])
                                .lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
                            if !cleanSeg.isEmpty && ((!wantTitle.isEmpty && (cleanSeg == wantTitle || cleanSeg.hasPrefix(wantTitle + " ")))
                                || (!wantCore.isEmpty && (cleanSeg == wantCore || cleanSeg.hasPrefix(wantCore + " ")))) {
                                titleMatch = true
                                break
                            }
                        }
                    }
                    let wantIsRemix = wantTitle.range(of: "\\b(remix|bootleg|flip|mashup|cover|sped up|slowed|edit)\\b", options: .regularExpression) != nil
                    let gotIsRemix = gotTitle.range(of: "\\b(remix|bootleg|flip|mashup|cover|sped up|slowed|edit|karaoke|instrumental)\\b", options: .regularExpression) != nil
                    if !wantIsRemix && gotIsRemix { continue }
                    let artistMatch = artistTokens.isEmpty || artistTokens.contains(where: { combinedArtistText.contains($0) || (!gotArtist.isEmpty && $0.contains(gotArtist)) })
                    if titleMatch && artistMatch && durSec >= 60 {
                        if let encId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) {
                            let streamUrl = "https://discoveryprovider.audius.co/v1/tracks/\(encId)/stream?app_name=MUCHI"
                            found = ResolvedStream(url: streamUrl, userAgent: defaultUA, durationMs: durSec * 1000.0, mimeType: "audio/mpeg")
                            break
                        }
                    }
                }
            }.resume()
            _ = sem.wait(timeout: .now() + 3.8)
            if let f = found { return f }
        }
        return nil
    }
}
