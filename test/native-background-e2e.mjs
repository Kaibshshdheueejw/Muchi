// MUCHI v1.7.8 — Mocked Android & iOS Native Background Playback E2E Test Suite
//
// Verifies the native background playback lifecycle against the real tracked
// Android/iOS source files and public/app.js runtime, using a mocked WebView,
// bridge, resolver, and OS-audio environment:
//   1. Phone-speaker DSP / audio pipeline integrity (100% unmodified check)
//   2. Play song in foreground -> mocked verified HTTP stream + native service start + next-track preload
//   3. Background the app -> mocked foreground service / AVAudioSession + UIBackgroundTask stay active
//   4. Lock the screen & wait -> mocked continuous progress ticks (0s -> 120s) with zero WebView interference
//   5. Lock-screen Pause & Resume controls -> mocked MediaStyle / MPRemoteCommandCenter + NP.pause/resume
//   6. Lock-screen Next-track, Previous-track, natural track-end auto-advance & error recovery
//
// This suite is not physical Android/iOS device acceptance; run the external
// device checklist separately for release validation.

import { readFileSync } from "node:fs";
import vm from "node:vm";

const appJs = readFileSync("public/app.js", "utf8");
const androidPluginJava = readFileSync("android/app/src/main/java/app/muchi/music/MuchiAudioPlugin.java", "utf8");
const androidServiceJava = readFileSync("android/app/src/main/java/app/muchi/music/MuchiAudioService.java", "utf8");
const androidMainJava = readFileSync("android/app/src/main/java/app/muchi/music/MainActivity.java", "utf8");
const iosPluginSwift = readFileSync("ios/App/App/MuchiAudioPlugin.swift", "utf8");
const iosInfoPlist = readFileSync("ios/App/App/Info.plist", "utf8");

let passed = 0;
let failed = 0;

function assertE2E(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}${detail ? ` (${detail})` : ""}`);
  } else {
    failed++;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1. Verify Phone-Speaker DSP / Audio Pipeline is 100% Unmodified ─────────
console.log("\n=== 1. Phone-Speaker DSP & Audio Pipeline Integrity ===");
assertE2E(
  "DSP: WebAudio Phone Speaker 5-band EQ, 78Hz +9.5dB bass shelf, warmth shaper, Haas 3D spatial widener & 1.55x output gain intact",
  appJs.includes("function hookSound()") &&
    appJs.includes("function spatialMode()") &&
    appJs.includes("bass.frequency.value = 78; bass.gain.value = 9.5;") &&
    appJs.includes("sub.frequency.value = 58; sub.Q.value = 0.75; sub.gain.value = 5.5;") &&
    appJs.includes("body.frequency.value = 145; body.Q.value = 0.8; body.gain.value = 3.2;") &&
    appJs.includes("scoop.frequency.value = 420; scoop.Q.value = 0.85; scoop.gain.value = -2.8;") &&
    appJs.includes("presence.frequency.value = 2800; presence.Q.value = 0.75; presence.gain.value = 2.8;") &&
    appJs.includes("air.frequency.value = 8500; air.gain.value = 2.6;") &&
    appJs.includes("wet.gain.value = 0.72;") &&
    appJs.includes("punch.threshold.value = -20;") &&
    appJs.includes("punch.ratio.value = 3.6;") &&
    appJs.includes("lim.threshold.value = -0.9;") &&
    appJs.includes("lim.ratio.value = 20;") &&
    appJs.includes("Math.tanh(3.1 * x) * 0.52") &&
    appJs.includes("out.gain.value = 1.55;")
);

assertE2E(
  "DSP: Native Android hardware DSP (LoudnessEnhancer 310mB, BassBoost 580, 6-Zone Acoustic Equalizer) & iOS MTAudioProcessingTap intact",
  androidServiceJava.includes("private void applyPlayerPrefsAndEffects()") &&
    androidServiceJava.includes("new LoudnessEnhancer(sessionId)") &&
    androidServiceJava.includes("new BassBoost(0, sessionId)") &&
    androidServiceJava.includes("new Equalizer(0, sessionId)") &&
    androidServiceJava.includes("if (freqHz <= 75) targetMb = 320;") &&
    androidServiceJava.includes("else if (freqHz <= 160) targetMb = 780;") &&
    androidServiceJava.includes("else if (freqHz <= 1600) targetMb = -80;") &&
    iosPluginSwift.includes("attachPhoneSpeakerDspIfAvailable") &&
    iosPluginSwift.includes("MTAudioProcessingTapCreate")
);

// ── 1b. Expired native stream URL recovery ──────────────────────────────────
// This is a source-level regression check. The stateful harness below is not a
// physical Android/iOS device; real device playback remains a release gate.
console.log("\n=== 1b. Expired Native Stream URL Recovery ===");
const androidExpiryAt = androidServiceJava.indexOf("Check if the provided URL is an expired googlevideo stream URL");
const androidYtResolveAt = androidServiceJava.indexOf('if (url != null && url.startsWith("yt:"))', androidExpiryAt);
assertE2E(
  "Android: near-expiry googlevideo URLs invalidate matching cache entries before on-device resolve",
  androidExpiryAt >= 0 &&
    androidExpiryAt < androidYtResolveAt &&
    androidServiceJava.includes("urlExpireSec") &&
    androidServiceJava.includes("invalidateResolvedCacheForTrack(currentVideoId, trackTitle, trackArtist, url)") &&
    androidServiceJava.includes('url = !currentVideoId.isEmpty() ? ("yt:" + currentVideoId) : "yt:";')
);
const iosExpiryAt = iosPluginSwift.indexOf("var effectiveUrl = url");
const iosResolveAt = iosPluginSwift.indexOf('if effectiveLowUrl.hasPrefix("yt:")');
assertE2E(
  "iOS: near-expiry googlevideo URLs invalidate matching cache entries before AVPlayer/resolve",
  iosExpiryAt >= 0 &&
    iosExpiryAt < iosResolveAt &&
    iosPluginSwift.includes("urlExpireSec") &&
    iosPluginSwift.includes("Self.invalidateResolvedCacheForTrack(videoId: currentVideoId, title: currentTitle, artist: currentArtist, failedUrl: effectiveUrl)") &&
    iosPluginSwift.includes('effectiveUrl = !currentVideoId.isEmpty ? ("yt:" + currentVideoId) : "yt:"') &&
    iosPluginSwift.includes("URL(string: effectiveUrl)")
);
assertE2E(
  "iOS: WebM and Opus URL variants route through the compatible native resolver",
  iosPluginSwift.includes('effectiveLowUrl.hasSuffix(".webm")') &&
    iosPluginSwift.includes('effectiveLowUrl.contains("format=opus")') &&
    iosPluginSwift.includes("if effectiveLowUrl.hasPrefix(\"yt:\") || (isUnsupportedWebm && !currentVideoId.isEmpty)")
);
const androidRadioCacheAt = androidServiceJava.indexOf("Never attempt to cache infinite live radio streams");
const androidGoogleCacheAt = androidServiceJava.indexOf("Never open a second competing HTTP download connection to googlevideo.com", androidRadioCacheAt);
assertE2E(
  "Android: live radio and playlist manifests are rejected before disk-cache work",
  androidRadioCacheAt >= 0 &&
    androidRadioCacheAt < androidGoogleCacheAt &&
    androidServiceJava.includes('lowCacheUrl.contains("/radio/")') &&
    androidServiceJava.includes('lowCacheUrl.contains(":8000/")') &&
    androidServiceJava.includes('lowCacheUrl.contains(":8080/")') &&
    androidServiceJava.includes('lowCacheUrl.contains(".pls")') &&
    androidServiceJava.includes('lowCacheUrl.contains(".m3u")') &&
    androidServiceJava.includes('URLDecoder.decode(streamUrl, "UTF-8")')
);
const iosRadioCacheAt = iosPluginSwift.indexOf("Never attempt to cache infinite live radio streams");
const iosGoogleCacheAt = iosPluginSwift.indexOf("Never open a second competing HTTP download connection to googlevideo.com", iosRadioCacheAt);
assertE2E(
  "iOS: live radio and playlist manifests are rejected before disk-cache work",
  iosRadioCacheAt >= 0 &&
    iosRadioCacheAt < iosGoogleCacheAt &&
    iosPluginSwift.includes('lowerRawUrl.contains("/radio/")') &&
    iosPluginSwift.includes('lowerRawUrl.contains(":8000/")') &&
    iosPluginSwift.includes('lowerRawUrl.contains(":8080/")') &&
    iosPluginSwift.includes('lowerRawUrl.contains(".pls")') &&
    iosPluginSwift.includes('lowerRawUrl.contains(".m3u")') &&
    iosPluginSwift.includes("rawUrl.removingPercentEncoding")
);
assertE2E(
  "Android: native notification artwork has a bundled default fallback",
  androidServiceJava.includes("with asset fallback") &&
    androidServiceJava.includes('getAssets().open("public/cover-default.jpg")') &&
    androidServiceJava.includes('artworkUrl.startsWith("http://")') &&
    androidServiceJava.includes("Remote artwork failed")
);
assertE2E(
  "iOS: lock-screen artwork has a bundled default fallback",
  iosPluginSwift.includes("func applyDefaultArtworkFallback()") &&
    iosPluginSwift.includes('Bundle.main.path(forResource: "cover-default"') &&
    iosPluginSwift.includes("applyDefaultArtworkFallback()") &&
    iosPluginSwift.includes('artUrl.scheme == "http" || artUrl.scheme == "https"')
);
const nativeOfflineRouteAt = appJs.indexOf("Native shells cannot hand a WebView blob URL");
const nativeAudioPredicateAt = appJs.indexOf('^file:\\/\\//i.test(url)');
assertE2E(
  "Native offline routing accepts persisted file/content URIs without pretending yt: is offline",
  nativeOfflineRouteAt >= 0 &&
    nativeAudioPredicateAt > nativeOfflineRouteAt &&
    appJs.includes('saved.uri && (/^file:\\/\\//i.test(saved.uri) || /^content:\\/\\//i.test(saved.uri))') &&
    appJs.includes('else if (!isNetworkOff && (t.videoId || t.title))') &&
    appJs.includes("rather than pretending that a network-only yt: token is offline audio")
);
assertE2E(
  "Web fallback remains available for non-native playback",
  appJs.includes("await playAudioWeb(url);") &&
    appJs.includes("if (nativePlayer() &&")
);
assertE2E(
  "Android: Muchi's six-second cache-start guard remains intact",
  androidServiceJava.includes("Delay background disk caching by 6 seconds") &&
    androidServiceJava.includes("ticker.postDelayed(pendingCacheStart, 6000L);")
);

// ── 1c. Bounded native fallback ─────────────────────────────────────────────
// The fallback state machine is source-checked here because the device bridge
// is mocked below; physical failure injection remains an external device gate.
const nativeFallbackAt = appJs.indexOf("const NATIVE_MAX_ATTEMPTS = 3;");
const nativePlayAt = appJs.indexOf("function nativePlayTrack(", nativeFallbackAt);
const nativeErrorAt = appJs.indexOf('} else if (msg === "error") {', nativePlayAt);
const nativeErrorBlock = nativeErrorAt >= 0 ? appJs.slice(nativeErrorAt, nativeErrorAt + 8000) : "";
const nativeRefreshAt = nativeErrorBlock.indexOf("!cur._nativeRefreshTried");
const nativeResolvedAt = nativeErrorBlock.indexOf("!cur._nativeFallbackTried");
const nativeIdentifierAt = nativeErrorBlock.indexOf("!cur._nativeOnDeviceTried");
const nativeWebAt = nativeErrorBlock.indexOf("!cur._nativeYtFallbackTried");
const nativeExhaustedAt = nativeErrorBlock.indexOf("cur._nativeFallbackExhausted = true");
assertE2E(
  "Native fallback is bounded and ordered local -> resolved stream -> one native identifier -> report failure",
  nativeFallbackAt >= 0 &&
    nativePlayAt > nativeFallbackAt &&
    nativeErrorAt > nativePlayAt &&
    nativeRefreshAt >= 0 &&
    nativeResolvedAt > nativeRefreshAt &&
    nativeIdentifierAt > nativeResolvedAt &&
    nativeWebAt > nativeIdentifierAt &&
    nativeExhaustedAt > nativeWebAt &&
    appJs.includes("attempts >= NATIVE_MAX_ATTEMPTS") &&
    appJs.includes("t._nativeFallbackExhausted = false") &&
    appJs.includes("nativeRouteForUrl(url)") &&
    appJs.includes("nativeResolvedStreamCandidate(cur)") &&
    appJs.includes("const offline = nativeNetworkOffline()") &&
    appJs.includes("nativeHandleControls({ message: \"error\"")
);
assertE2E(
  "Native fallback cannot retry network-only paths while offline or re-enter after exhaustion",
  nativeErrorBlock.includes("if (!offline &&") &&
    nativeErrorBlock.includes("cur._nativeFallbackExhausted || cur._nativeFallbackInFlight") &&
    nativeErrorBlock.includes("Track is not available offline") &&
    nativeErrorBlock.includes("All native attempts are exhausted")
);

// ── 1d. Sequence-safe native next-track synchronization ─────────────────────
const nextSyncAt = appJs.indexOf("function syncNativeNextTrack()");
const nextWarmAt = appJs.indexOf("function warmTrack(");
const tickWarmAt = appJs.indexOf("// Audio playback optimization:");
const tickWarmEndAt = appJs.indexOf("// When screen is off and native service owns playback", tickWarmAt);
const tickWarmBlock = tickWarmAt >= 0 && tickWarmEndAt > tickWarmAt ? appJs.slice(tickWarmAt, tickWarmEndAt) : "";
assertE2E(
  "Phase 2C source guard: JS next-track sync carries a monotonic token and stale warm results cannot update a replaced queue entry",
  nextSyncAt >= 0 &&
    nextWarmAt >= 0 &&
    appJs.includes("let nativeNextSyncSeq = 0;") &&
    appJs.includes("let nativeNextTrackRef = null;") &&
    appJs.includes("function nextNativeNextSyncSequence()") &&
    appJs.includes("sequence: syncSeq") &&
    appJs.includes("nativeNextSequence === nativeNextSyncSeq && nativeNextTrackRef === t") &&
    appJs.includes("t._nativeWarmRequestSeq === warmRequestSeq") &&
    !tickWarmBlock.includes("NP.preload")
);
assertE2E(
  "Phase 2C native source guard: Android and iOS reject older or unsequenced next-track deliveries and gate duplicate native preload ownership",
  androidPluginJava.includes("EXTRA_NEXT_SEQUENCE") &&
    androidPluginJava.includes("EXTRA_PRELOAD") &&
    androidServiceJava.includes("final long sequence") &&
    androidServiceJava.includes("if (sequence <= nextTrackSequence) return;") &&
    androidServiceJava.includes("else if (nextTrackSequence > 0L)") &&
    androidServiceJava.includes("if (shouldPreload && videoId") &&
    iosPluginSwift.includes('let sequence = max(0, Int64(call.getDouble("sequence") ?? 0))') &&
    iosPluginSwift.includes("if sequence <= nextTrackSequence") &&
    iosPluginSwift.includes("else if nextTrackSequence > 0") &&
    iosPluginSwift.includes("if shouldPreload && !videoId.isEmpty")
);

// ── 1e. Phase 3A native delayed cache-start guard ───────────────────────────
// These are source-level checks over the tracked native implementations. The
// stateful harness below remains mocked and does not substitute for physical
// Android/iOS device acceptance.
console.log("\n=== 1e. Phase 3A Native Delayed Cache-Start Guard ===");
const androidPauseBlock = androidServiceJava.slice(
  androidServiceJava.indexOf("public void pausePlayback()"),
  androidServiceJava.indexOf("public void resumePlayback()")
);
const androidLoadBlock = androidServiceJava.slice(
  androidServiceJava.indexOf("private synchronized void loadTrack("),
  androidServiceJava.indexOf("private void startExoPlayerWithUrl(")
);
const androidStopBlock = androidServiceJava.slice(
  androidServiceJava.indexOf("private synchronized void stopPlaybackInternal("),
  androidServiceJava.indexOf("/* ── notification / session metadata", androidServiceJava.indexOf("private synchronized void stopPlaybackInternal("))
);
assertE2E(
  "Phase 3A Android: delayed disk-cache start is explicitly cancellable on replacement, pause, and stop",
  androidServiceJava.includes("private Runnable pendingCacheStart;") &&
    androidServiceJava.includes("ticker.removeCallbacks(pendingCacheStart)") &&
    androidPauseBlock.includes("cancelPendingCacheStart();") &&
    androidLoadBlock.includes("cancelPendingCacheStart();") &&
    androidStopBlock.includes("cancelPendingCacheStart();")
);
assertE2E(
  "Phase 3A Android: six-second cache guard requires the current load, resolver idle, READY state, playWhenReady, and active playback",
  androidServiceJava.includes("ticker.postDelayed(pendingCacheStart, 6000L);") &&
    androidServiceJava.includes("expectedSeq != loadSeq") &&
    androidServiceJava.includes("resolvingOnDevice") &&
    androidServiceJava.includes("player.getPlaybackState() != Player.STATE_READY") &&
    androidServiceJava.includes("!player.getPlayWhenReady()") &&
    androidServiceJava.includes("!player.isPlaying()") &&
    androidServiceJava.includes("MIN_UNCAPPED_AUDIO_CACHE_BYTES = 1150000L")
);
const iosPlayBlock = iosPluginSwift.slice(
  iosPluginSwift.indexOf("private func playTrackDirect("),
  iosPluginSwift.indexOf("private func startPlayer(")
);
const iosPauseBlock = iosPluginSwift.slice(
  iosPluginSwift.indexOf("@objc public func pause("),
  iosPluginSwift.indexOf("@objc public func resume(")
);
const iosStopBlock = iosPluginSwift.slice(
  iosPluginSwift.indexOf("private func doStop("),
  iosPluginSwift.indexOf("private func configureAudioSession(")
);
assertE2E(
  "Phase 3A iOS: delayed disk-cache start is explicitly cancellable on replacement, pause, and stop",
  iosPluginSwift.includes("private var pendingCacheStart: DispatchWorkItem?") &&
    iosPluginSwift.includes("pendingCacheStart?.cancel()") &&
    iosPlayBlock.includes("cancelPendingCacheStart()") &&
    iosPauseBlock.includes("cancelPendingCacheStart()") &&
    iosStopBlock.includes("cancelPendingCacheStart()")
);
assertE2E(
  "Phase 3A iOS: six-second cache guard requires the current token/load, resolver idle, READY item, active rate, and playing time-control state",
  iosPluginSwift.includes("DispatchQueue.main.asyncAfter(deadline: .now() + 6.0, execute: work)") &&
    iosPluginSwift.includes("self.cacheStartToken == expectedCacheToken") &&
    iosPluginSwift.includes("self.loadSeq == expectedSeq") &&
    iosPluginSwift.includes("!self.resolvingOnDevice") &&
    iosPluginSwift.includes("item.status == .readyToPlay") &&
    iosPluginSwift.includes("p.rate > 0") &&
    iosPluginSwift.includes("p.timeControlStatus == .playing") &&
    iosPluginSwift.includes("private static let minUncappedAudioCacheBytes: Int64 = 1150000")
);

// ── 1f. Phase 3B single-flight cache downloads ──────────────────────────────
console.log("\n=== 1f. Phase 3B Single-Flight Cache Downloads ===");
assertE2E(
  "Phase 3B Android: video/query/ISRC aliases share one synchronized active download and one canonical artifact",
  androidServiceJava.includes("private static final Object AUDIO_CACHE_LOCK") &&
    androidServiceJava.includes("Map<String, AudioCacheDownload> activeAudioCacheDownloads") &&
    androidServiceJava.includes("claimAudioCacheDownload(canonicalKey, cacheKeys)") &&
    androidServiceJava.includes("audioCacheIsrcKey") &&
    androidServiceJava.includes('new File(dir, key + ".alias")') &&
    androidServiceJava.includes('canonicalKey + ".meta"') &&
    !androidServiceJava.includes("secondaryKey") &&
    !androidServiceJava.includes("new java.io.FileInputStream(targetFile)")
);
assertE2E(
  "Phase 3B Android: active cache cancellation, atomic temp publication, metadata, and incomplete-file rejection are guarded",
  androidServiceJava.includes("cancelAudioCacheDownload(currentVideoId, trackTitle, trackArtist, trackIsrc)") &&
    androidServiceJava.includes("state.cancelled") &&
    androidServiceJava.includes("state.connection") &&
    androidServiceJava.includes("tmpFile.renameTo(targetFile)") &&
    androidServiceJava.includes("writeAudioCacheMetadata") &&
    androidServiceJava.includes("MIN_UNCAPPED_AUDIO_CACHE_BYTES = 1150000L") &&
    androidServiceJava.includes("written >= MIN_UNCAPPED_AUDIO_CACHE_BYTES")
);
assertE2E(
  "Phase 3B iOS: video/query/ISRC aliases share one synchronized active download and one canonical artifact",
  iosPluginSwift.includes("private static var activeAudioCacheDownloads: [String: AudioCacheDownload] = [:]") &&
    iosPluginSwift.includes("claimAudioCacheDownload(primaryKey, cacheKeys)") &&
    iosPluginSwift.includes("audioCacheIsrcKey") &&
    iosPluginSwift.includes(".alias") &&
    iosPluginSwift.includes(".meta") &&
    !iosPluginSwift.includes("try? fm.copyItem(at: targetUrl, to: secUrl)")
);
assertE2E(
  "Phase 3B iOS: active URLSession cancellation, atomic temp publication, metadata, and incomplete-file rejection are guarded",
  iosPluginSwift.includes("Self.cancelAudioCacheDownload") &&
    iosPluginSwift.includes("state.cancelled") &&
    iosPluginSwift.includes("state.task") &&
    iosPluginSwift.includes("try fm.moveItem(at: tempUrl, to: targetUrl)") &&
    iosPluginSwift.includes("writeAudioCacheMetadata") &&
    iosPluginSwift.includes("private static let minUncappedAudioCacheBytes: Int64 = 1150000") &&
    iosPluginSwift.includes("written >= minUncappedAudioCacheBytes") &&
    iosPluginSwift.includes("written != 983040")
);
assertE2E(
  "Phase 3C Android: startup cleanup, cache lookup, eviction, and pruning preserve only complete canonical artifacts",
  androidServiceJava.includes("private static boolean audioCacheCleanChecked = false") &&
    androidServiceJava.includes("cleanAudioCacheDirOnStartup(dir)") &&
    androidServiceJava.includes("Temporary downloads and unknown cache debris are never reusable after restart") &&
    androidServiceJava.includes("synchronized (AUDIO_CACHE_LOCK) {\n            for (String key : keys)") &&
    androidServiceJava.includes("cancelAudioCacheDownload(videoId, title, artist, isrc);") &&
    androidServiceJava.includes("private static boolean isAudioCacheCanonicalActive") &&
    androidServiceJava.includes("if (!isCompleteAudioCacheFile(file))") &&
    androidServiceJava.includes("audioFiles.sort") &&
    androidServiceJava.includes("deleteAudioCacheArtifact(dir, canonicalKey)")
);
assertE2E(
  "Phase 3C iOS: serialized startup cleanup, cache lookup, eviction, and pruning preserve only complete canonical artifacts",
  iosPluginSwift.includes("cleanAudioCacheDirOnStartup(dir)") &&
    iosPluginSwift.includes("Temporary downloads and unknown cache debris are never reusable after restart") &&
    iosPluginSwift.includes("cacheLock.lock()\n        defer { cacheLock.unlock() }\n        for key in keys") &&
    iosPluginSwift.includes("cancelAudioCacheDownload(videoId: videoId, title: title, artist: artist, isrc: isrc)") &&
    iosPluginSwift.includes("private static func isAudioCacheCanonicalActive") &&
    iosPluginSwift.includes("if !isCompleteAudioCacheFile(url)") &&
    iosPluginSwift.includes("audioFiles.sort") &&
    iosPluginSwift.includes("deleteAudioCacheArtifact(dir, entry.key)")
);
assertE2E(
  "Phase 3C native cache acceptance: both platforms retain the six-second guard, 1.15 MB floor, capped-file rejection, and safe upper bound",
  androidServiceJava.includes("ticker.postDelayed(pendingCacheStart, 6000L);") &&
    !androidServiceJava.includes("MIN_AUDIO_CACHE_BYTES = 262144L") &&
    androidServiceJava.includes("written >= MIN_UNCAPPED_AUDIO_CACHE_BYTES") &&
    androidServiceJava.includes("written < 45L * 1024L * 1024L") &&
    androidServiceJava.includes("written != 983040L") &&
    iosPluginSwift.includes("DispatchQueue.main.asyncAfter(deadline: .now() + 6.0, execute: work)") &&
    !iosPluginSwift.includes("minAudioCacheBytes: Int64 = 262144") &&
    iosPluginSwift.includes("written >= minUncappedAudioCacheBytes") &&
    iosPluginSwift.includes("written < 45 * 1024 * 1024") &&
    iosPluginSwift.includes("written != 983040")
);

// ── 2. Stateful Native OS Audio Service Emulators (Android & iOS) ───────────
function createNativeOSHarness(platform) {
  const controlsListeners = [];
  const progressListeners = [];
  const calls = [];
  let evalBridgeFn = null;

  // Stateful Android MuchiAudioService + ExoPlayer + MediaSession + Locks state
  const androidState = {
    serviceCreated: false,
    foregroundStarted: false,
    notificationPosted: false,
    wakeLockHeld: false,
    wifiLockHeld: false,
    audioFocusGranted: false,
    exoPlaying: false,
    sessionOnlyMode: false,
    currentUrl: "",
    currentRequestedUrl: "",
    currentVideoId: "",
    currentTitle: "",
    currentArtist: "",
    positionMs: 0,
    durationMs: 0,
    preloadedMap: new Map(),
    queuedNextTrack: null,
    nextTrackSequence: 0,
    mediaSessionState: "NONE",
    dspApplied: false,
  };

  // Stateful iOS AVAudioSession + AVPlayer + MPNowPlayingInfoCenter + UIBackgroundTask state
  const iosState = {
    audioSessionCategory: "ambient",
    audioSessionActive: false,
    bgTaskActive: false,
    bgTaskHistory: [],
    avPlayerPlaying: false,
    currentUrl: "",
    currentVideoId: "",
    currentTitle: "",
    currentArtist: "",
    positionSec: 0,
    durationSec: 0,
    preloadedStreams: new Map(),
    queuedNextTrack: null,
    nextTrackSequence: 0,
    nowPlayingInfo: {},
  };

  const emitToJs = (action) => {
    controlsListeners.forEach((cb) => cb({ action, message: action }));
    // Mirror native background WebView evaluation fallback for next/prev/ended/play/pause
    if (evalBridgeFn && (action === "next" || action === "prev" || action === "ended")) {
      const mapped = action === "ended" ? "next" : action;
      evalBridgeFn(mapped);
    }
  };

  const MuchiAudioPluginBridge = {
    addListener(event, cb) {
      if (event === "muchiControls" || event === "controls") controlsListeners.push(cb);
      if (event === "muchiProgress" || event === "progress") progressListeners.push(cb);
      return Promise.resolve({ remove: () => {} });
    },

    async play(opts) {
      calls.push({ method: "play", ...opts });
      if (platform === "android") {
        // Mirrors MuchiAudioPlugin.play() -> startService(i) + service.playIntent(i)
        androidState.serviceCreated = true;
        androidState.foregroundStarted = true;
        androidState.notificationPosted = true;
        androidState.wakeLockHeld = true;
        androidState.wifiLockHeld = true;
        androidState.audioFocusGranted = true;
        androidState.sessionOnlyMode = false;
        androidState.currentRequestedUrl = opts.url || "";
        androidState.currentUrl = opts.url || "";
        androidState.currentVideoId = opts.videoId || "";
        androidState.currentTitle = opts.title || "Muchi";
        androidState.currentArtist = opts.artist || "";
        androidState.durationMs = Number(opts.duration) || 213000;
        androidState.positionMs = 0;
        androidState.exoPlaying = true;
        androidState.mediaSessionState = "STATE_PLAYING";
        androidState.dspApplied = true;
      } else {
        // Mirrors MuchiAudioPlugin.swift play() -> beginAudioBackgroundTask + ensureAudioSessionActive + startPlayer
        iosState.bgTaskActive = true;
        iosState.bgTaskHistory.push("begin:play");
        iosState.audioSessionCategory = "AVAudioSessionCategoryPlayback";
        iosState.audioSessionActive = true;
        iosState.currentUrl = opts.url || "";
        iosState.currentVideoId = opts.videoId || "";
        iosState.currentTitle = opts.title || "Muchi";
        iosState.currentArtist = opts.artist || "";
        iosState.durationSec = (Number(opts.duration) || 213000) / 1000;
        iosState.positionSec = 0;
        iosState.avPlayerPlaying = true;
        iosState.nowPlayingInfo = {
          MPMediaItemPropertyTitle: iosState.currentTitle,
          MPMediaItemPropertyArtist: iosState.currentArtist,
          MPMediaItemPropertyPlaybackDuration: iosState.durationSec,
          MPNowPlayingInfoPropertyElapsedPlaybackTime: 0,
          MPNowPlayingInfoPropertyPlaybackRate: 1.0,
        };
        // Once AVPlayer renders audio (timeControlStatus == .playing), endAudioBackgroundTask() is called
        iosState.bgTaskActive = false;
        iosState.bgTaskHistory.push("end:playing");
      }
    },

    async preload(opts) {
      calls.push({ method: "preload", ...opts });
      if (platform === "android") {
        androidState.preloadedMap.set(opts.videoId, `https://rr1---sn-e2e.googlevideo.com/videoplayback?id=${opts.videoId}&preloaded=1`);
      } else {
        iosState.preloadedStreams.set(opts.videoId, `https://rr1---sn-e2e.googlevideo.com/videoplayback?id=${opts.videoId}&preloaded=1`);
      }
    },

    async setNextTrack(opts) {
      calls.push({ method: "setNextTrack", ...opts });
      const nativeState = platform === "android" ? androidState : iosState;
      const sequence = Number(opts.sequence) || 0;
      if (sequence > 0 && sequence <= nativeState.nextTrackSequence) return;
      if (sequence > 0) nativeState.nextTrackSequence = sequence;
      nativeState.queuedNextTrack = (opts.url || opts.videoId || opts.title)
        ? { ...opts }
        : null;
    },

    async syncSession(opts) {
      calls.push({ method: "syncSession", ...opts });
    },

    async pause() {
      calls.push({ method: "pause" });
      if (platform === "android") {
        androidState.exoPlaying = false;
        androidState.mediaSessionState = "STATE_PAUSED";
      } else {
        iosState.avPlayerPlaying = false;
        iosState.nowPlayingInfo.MPNowPlayingInfoPropertyPlaybackRate = 0.0;
      }
    },

    async resume() {
      calls.push({ method: "resume" });
      if (platform === "android") {
        // Mirrors ACTION_RESUME in MuchiAudioService.java
        androidState.foregroundStarted = true;
        androidState.wakeLockHeld = true;
        androidState.wifiLockHeld = true;
        androidState.audioFocusGranted = true;
        androidState.exoPlaying = true;
        androidState.mediaSessionState = "STATE_PLAYING";
      } else {
        // Mirrors resume() in MuchiAudioPlugin.swift
        iosState.audioSessionActive = true;
        iosState.avPlayerPlaying = true;
        iosState.nowPlayingInfo.MPNowPlayingInfoPropertyPlaybackRate = 1.0;
      }
    },

    async stop() {
      calls.push({ method: "stop" });
      if (platform === "android") {
        androidState.exoPlaying = false;
        androidState.foregroundStarted = false;
        androidState.currentUrl = "";
        androidState.currentRequestedUrl = "";
      } else {
        iosState.avPlayerPlaying = false;
        iosState.currentUrl = "";
      }
    },

    async seekTo(opts) {
      calls.push({ method: "seekTo", ...opts });
      if (platform === "android") {
        androidState.positionMs = Number(opts.position) || 0;
      } else {
        iosState.positionSec = (Number(opts.position) || 0) / 1000;
      }
    },

    async setVolume(opts) { calls.push({ method: "setVolume", ...opts }); },
    async setRate(opts) { calls.push({ method: "setRate", ...opts }); },
    async setAudioPrefs(opts) { calls.push({ method: "setAudioPrefs", ...opts }); },

    // Native OS Lock-Screen / Notification Transport Actions
    triggerLockScreenPause() {
      if (platform === "android") {
        androidState.exoPlaying = false;
        androidState.mediaSessionState = "STATE_PAUSED";
      } else {
        iosState.avPlayerPlaying = false;
        iosState.nowPlayingInfo.MPNowPlayingInfoPropertyPlaybackRate = 0.0;
      }
      controlsListeners.forEach((cb) => cb({ action: "pause", message: "pause" }));
    },

    triggerLockScreenResume() {
      if (platform === "android") {
        androidState.foregroundStarted = true;
        androidState.wakeLockHeld = true;
        androidState.wifiLockHeld = true;
        androidState.exoPlaying = true;
        androidState.mediaSessionState = "STATE_PLAYING";
      } else {
        iosState.audioSessionActive = true;
        iosState.avPlayerPlaying = true;
        iosState.nowPlayingInfo.MPNowPlayingInfoPropertyPlaybackRate = 1.0;
      }
      controlsListeners.forEach((cb) => cb({ action: "play", message: "play" }));
    },

    triggerLockScreenNext() {
      if (platform === "ios") {
        iosState.bgTaskActive = true;
        iosState.bgTaskHistory.push("begin:remoteNext");
      }
      controlsListeners.forEach((cb) => cb({ action: "next", message: "next" }));
    },

    triggerLockScreenPrev() {
      if (platform === "ios") {
        iosState.bgTaskActive = true;
        iosState.bgTaskHistory.push("begin:remotePrev");
      }
      controlsListeners.forEach((cb) => cb({ action: "prev", message: "prev" }));
    },

    triggerNativeTrackEnded() {
      if (platform === "ios") {
        iosState.bgTaskActive = true;
        iosState.bgTaskHistory.push("begin:itemDidFinishPlaying");
      }
      controlsListeners.forEach((cb) => cb({ action: "ended", message: "ended" }));
    },

    triggerNativeStreamError(posMs = 0) {
      if (platform === "ios") {
        iosState.bgTaskActive = true;
        iosState.bgTaskHistory.push("begin:streamError");
      }
      controlsListeners.forEach((cb) => cb({ action: "error", message: "error", position: posMs }));
    },

    tickProgress(sec, durSec = 213) {
      if (platform === "android") {
        androidState.positionMs = sec * 1000;
        androidState.durationMs = durSec * 1000;
        progressListeners.forEach((cb) =>
          cb({
            position: sec,
            duration: durSec,
            positionMs: sec * 1000,
            durationMs: durSec * 1000,
            playing: androidState.exoPlaying,
          })
        );
      } else {
        iosState.positionSec = sec;
        iosState.durationSec = durSec;
        iosState.nowPlayingInfo.MPNowPlayingInfoPropertyElapsedPlaybackTime = sec;
        progressListeners.forEach((cb) =>
          cb({
            position: sec,
            duration: durSec,
            positionMs: sec * 1000,
            durationMs: durSec * 1000,
            playing: iosState.avPlayerPlaying,
          })
        );
      }
    },

    notifyAppDidEnterBackground() {
      if (platform === "ios" && iosState.avPlayerPlaying) {
        iosState.bgTaskActive = true;
        iosState.bgTaskHistory.push("begin:didEnterBackground");
        iosState.audioSessionActive = true;
      }
    },
  };

  return {
    MuchiAudioPluginBridge,
    calls,
    androidState,
    iosState,
    setEvalBridge(fn) { evalBridgeFn = fn; },
  };
}

// ── 3. Full E2E Runner for a Target Native Platform ("android" | "ios") ─────
async function runFullPlatformE2E(platform) {
  const label = platform === "android" ? "Android" : "iOS";
  console.log(`\n=== Running Mocked ${label} Native Background Playback E2E ===`);

  const harness = createNativeOSHarness(platform);
  const { MuchiAudioPluginBridge, calls, androidState, iosState } = harness;

  let webAudioPlayCalls = 0;
  let ytIframeCreated = false;
  let audioCtxCreated = 0;
  const docListeners = {};
  const winListeners = {};

  const makeAudioParam = (initVal = 0) => ({
    value: initVal,
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
    exponentialRampToValueAtTime(v) { this.value = v; },
    setTargetAtTime(v) { this.value = v; },
  });

  const makeAudioNode = () => ({
    connect() { return this; },
    disconnect() {},
    frequency: makeAudioParam(440),
    Q: makeAudioParam(1),
    gain: makeAudioParam(1),
    delayTime: makeAudioParam(0),
    threshold: makeAudioParam(-24),
    knee: makeAudioParam(10),
    ratio: makeAudioParam(4),
    attack: makeAudioParam(0.003),
    release: makeAudioParam(0.25),
    pan: makeAudioParam(0),
    curve: null,
    oversample: "none",
    type: "peaking",
  });

  class MockAudioContext {
    constructor() {
      audioCtxCreated++;
      this.state = "running";
      this.currentTime = 0;
      this.destination = makeAudioNode();
    }
    createMediaElementSource() { return makeAudioNode(); }
    createBiquadFilter() { return makeAudioNode(); }
    createDynamicsCompressor() { return makeAudioNode(); }
    createWaveShaper() { return makeAudioNode(); }
    createGain() { return makeAudioNode(); }
    createDelay() { return makeAudioNode(); }
    createChannelSplitter() { return makeAudioNode(); }
    createChannelMerger() { return makeAudioNode(); }
    createStereoPanner() { return makeAudioNode(); }
    resume() { this.state = "running"; return Promise.resolve(); }
  }

  const makeEl = (id = "") => ({
    id,
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return ""; } },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return ""; },
    removeAttribute() {},
    appendChild() {},
    append() {},
    prepend() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 40 }; },
    getContext() {
      return {
        clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
        moveTo() {}, lineTo() {}, closePath() {}, createLinearGradient() { return { addColorStop() {} }; },
        scale() {}, save() {}, restore() {}, translate() {},
      };
    },
    play() { webAudioPlayCalls++; return Promise.resolve(); },
    pause() {},
    load() {},
    innerHTML: "",
    textContent: "",
    value: "",
    paused: true,
    currentTime: 0,
    duration: 213,
    volume: 1,
    playbackRate: 1,
    src: "",
  });

  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  };

  const storage = new Map([["aura.onboarded", "1"]]);
  const localStorageMock = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };

  const docMock = {
    hidden: false,
    visibilityState: "visible",
    body: makeEl("body"),
    head: makeEl("head"),
    documentElement: makeEl("html"),
    getElementById: (id) => getEl(id),
    createElement: (tag) => makeEl(tag),
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(ev) { (docListeners[ev.type] || []).forEach((fn) => fn(ev)); },
  };

  let refreshCount = 0;
  const fetchMock = async (urlStr) => {
    const u = String(urlStr);
    if (u.includes("/api/yt-stream") || u.includes("/api/yt/stream")) {
      const m = u.match(/[?&](?:videoId|v)=([^&]+)/);
      const vid = m ? decodeURIComponent(m[1]) : "vid";
      const isRefresh = u.includes("refresh=1");
      if (isRefresh) refreshCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          url: `https://rr1---sn-e2e.googlevideo.com/videoplayback?id=${vid}&r=${isRefresh ? refreshCount : 0}&mime=audio%2Fmp4`,
          mime: "audio/mp4",
          duration: vid === "kJQP7kiw5Fk" ? 281 : vid === "JGwWNGJdvx8" ? 235 : 213,
          isPreview: false,
        }),
      };
    }
    if (u.includes("/api/youtube/search")) {
      const isDieWithASmile = /Die%20With%20A%20Smile|Die\+With\+A\+Smile/i.test(u);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          tracks: isDieWithASmile
            ? [
                { videoId: "kPa7bsKwL-c", title: "Die With A Smile", artist: "Lady Gaga & Bruno Mars", duration: 252 },
                { videoId: "RVDCeVG90Rg", title: "Die With A Smile (Official Audio)", artist: "Lady Gaga & Bruno Mars", duration: 252 },
              ]
            : [
                { videoId: "V9PVRfjEBTI", title: "BIRDS OF A FEATHER", artist: "Billie Eilish", duration: 210 },
              ],
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, tracks: [], results: [] }),
      text: async () => "{}",
    };
  };

  const instrumentedAppJs = appJs.replace(
    "  loadHome();\n  loadTasteRecommendations();",
    "  window.__muchiE2E = { state, playCurrent, syncNativeNextTrack, togglePlay, next, prev, keepBackgroundPlay, unlockSound, getNpState: () => ({ npActive, npPlaying, npDur, npPos, wantPlay }), setNpPos: (p, d) => { npPos = p; if (d) npDur = d; } };\n"
  );

  const sandbox = {
    window: null,
    self: null,
    globalThis: null,
    performance: { now: () => Date.now() },
    document: docMock,
    localStorage: localStorageMock,
    sessionStorage: localStorageMock,
    navigator: {
      onLine: true,
      userAgent:
        platform === "android"
          ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 CapacitorApp"
          : "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 CapacitorApp",
      mediaSession: { metadata: null, playbackState: "none", setActionHandler() {}, setPositionState() {} },
      wakeLock: { request: async () => ({ release: async () => {} }) },
    },
    location: { origin: "capacitor://localhost", href: "capacitor://localhost/", protocol: "capacitor:", host: "localhost", pathname: "/", search: "", hash: "" },
    history: { pushState() {}, replaceState() {} },
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => platform,
      Plugins: { MuchiAudio: MuchiAudioPluginBridge },
    },
    YT: {
      Player: class {
        constructor() { ytIframeCreated = true; }
      },
    },
    MediaMetadata: class { constructor(init) { Object.assign(this, init); } },
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    Audio: function () { return makeEl("audio-inst"); },
    Image: function () { return makeEl("img-inst"); },
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    AbortController,
    AbortSignal,
    URL,
    URLSearchParams,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Event: class { constructor(type) { this.type = type; } },
    fetch: fetchMock,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    setTimeout: (fn, ms) => { const t = setTimeout(fn, Math.min(ms || 0, 20)); t.unref(); return t; },
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    console,
    Math,
    Date,
    JSON,
    Promise,
    Set,
    Map,
    WeakMap,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    TypeError,
    Uint8Array,
    Int32Array,
    Float32Array,
    ArrayBuffer,
    DataView,
    encodeURIComponent,
    decodeURIComponent,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    btoa: (s) => Buffer.from(String(s), "binary").toString("base64"),
    atob: (s) => Buffer.from(String(s), "base64").toString("binary"),
    addEventListener(ev, fn) { (winListeners[ev] = winListeners[ev] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(ev) { (winListeners[ev.type] || []).forEach((fn) => fn(ev)); },
    scrollTo() {},
    innerWidth: 390,
    innerHeight: 844,
    devicePixelRatio: 2,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(instrumentedAppJs, sandbox);
  harness.setEvalBridge(sandbox.__muchiNative);

  const api = sandbox.__muchiE2E;
  const queue = [
    {
      id: "yt:dQw4w9WgXcQ",
      videoId: "dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      artist: "Rick Astley",
      source: "youtube",
      duration: 213,
      artwork: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    },
    {
      id: "yt:kJQP7kiw5Fk",
      videoId: "kJQP7kiw5Fk",
      title: "Despacito",
      artist: "Luis Fonsi",
      source: "youtube",
      duration: 281,
      artwork: "https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg",
    },
    {
      id: "yt:JGwWNGJdvx8",
      videoId: "JGwWNGJdvx8",
      title: "Shape of You",
      artist: "Ed Sheeran",
      source: "youtube",
      duration: 235,
      artwork: "https://i.ytimg.com/vi/JGwWNGJdvx8/hqdefault.jpg",
    },
  ];

  // ── STEP 1: Play Song 1 in Foreground ──
  api.state.queue = queue;
  api.state.index = 0;
  await api.playCurrent(true);
  await new Promise((r) => setTimeout(r, 35));

  // Advance to 8s so next-track pre-warming triggers (NP.preload + getWarmStream)
  MuchiAudioPluginBridge.tickProgress(8, 213);
  await new Promise((r) => setTimeout(r, 35));

  const playCall1 = calls.find((c) => c.method === "play" && c.videoId === "dQw4w9WgXcQ");
  const preloadCall1 = calls.find((c) => c.method === "preload" && c.videoId === "kJQP7kiw5Fk");

  assertE2E(
    `${label} Step 1 (Play Song): resolves verified HTTP/on-device stream & starts native audio service without waking YouTube IFrame`,
    Boolean(playCall1) &&
      (String(playCall1.url).startsWith("yt:dQw4w9WgXcQ") || String(playCall1.url).startsWith("https://rr1---sn-e2e.googlevideo.com/videoplayback?id=dQw4w9WgXcQ")) &&
      playCall1.spatial === "phone" &&
      api.getNpState().npActive === true &&
      api.state.playing === true &&
      ytIframeCreated === false,
    `url=${playCall1?.url?.slice(0, 58)}...`
  );

  assertE2E(
    `${label} Step 1b (Next-Track Preload): preloads Track 2 (kJQP7kiw5Fk) in native plugin`,
    Boolean(preloadCall1) &&
      preloadCall1.videoId === "kJQP7kiw5Fk" &&
      (platform === "android" ? androidState.preloadedMap.has("kJQP7kiw5Fk") : iosState.preloadedStreams.has("kJQP7kiw5Fk")),
    `preloadedVid=${preloadCall1?.videoId}`
  );

  // Phase 2C mocked bridge check: two rapid queue snapshots must leave the
  // newest track active even when an older native delivery arrives afterward.
  const initialNextCall = calls.find((c) => c.method === "setNextTrack" && Number(c.sequence) > 0);
  const initialSeq = Number(initialNextCall?.sequence) || 0;
  const track2 = queue[1];
  const track3 = queue[2];
  api.state.queue[1] = track3;
  api.syncNativeNextTrack();
  const replacementNextCall = calls.filter((c) => c.method === "setNextTrack").at(-1);
  const replacementSeq = Number(replacementNextCall?.sequence) || 0;
  api.state.queue[1] = track2;
  api.syncNativeNextTrack();
  const newestNextCall = calls.filter((c) => c.method === "setNextTrack").at(-1);
  const newestSeq = Number(newestNextCall?.sequence) || 0;
  await MuchiAudioPluginBridge.setNextTrack({
    url: `yt:${track3.videoId}`,
    videoId: track3.videoId,
    title: track3.title,
    artist: track3.artist,
    sequence: initialSeq,
    preload: true,
  });
  const nativeState = platform === "android" ? androidState : iosState;
  const sequenceSafe =
    initialSeq > 0 &&
    replacementSeq > initialSeq &&
    newestSeq > replacementSeq &&
    initialNextCall?.preload === false &&
    replacementNextCall?.preload === false &&
    newestNextCall?.preload === false &&
    nativeState.nextTrackSequence === newestSeq &&
    nativeState.queuedNextTrack?.videoId === track2.videoId;
  assertE2E(
    `${label} Step 1c (Phase 2C mocked next-track sync): newest queue metadata wins over a stale delivery`,
    sequenceSafe,
    `sequences=${initialSeq}->${replacementSeq}->${newestSeq}, queued=${nativeState.queuedNextTrack?.videoId}`
  );
  const track2PreloadCalls = calls.filter((c) => c.method === "preload" && c.videoId === track2.videoId);
  assertE2E(
    `${label} Step 1d (Phase 2C mocked preload ownership): one native preload request serves Track 2 despite repeated sync calls`,
    track2PreloadCalls.length === 1,
    `track2Preloads=${track2PreloadCalls.length}`
  );

  if (platform === "android") {
    assertE2E(
      `Android Step 1e (Foreground Service & Locks): MuchiAudioService promoted to foreground with MediaStyle notification, WakeLock, WifiLock, AudioFocus & hardware DSP`,
      androidState.serviceCreated &&
        androidState.foregroundStarted &&
        androidState.notificationPosted &&
        androidState.wakeLockHeld &&
        androidState.wifiLockHeld &&
        androidState.audioFocusGranted &&
        androidState.dspApplied &&
        androidState.mediaSessionState === "STATE_PLAYING"
    );
  } else {
    assertE2E(
      `iOS Step 1e (AVAudioSession & NowPlaying): AVAudioSession(.playback) active, UIBackgroundModes=audio present, and MPNowPlayingInfoCenter populated`,
      iosInfoPlist.includes("<string>audio</string>") &&
        iosState.audioSessionCategory === "AVAudioSessionCategoryPlayback" &&
        iosState.audioSessionActive &&
        iosState.nowPlayingInfo.MPMediaItemPropertyTitle === "Never Gonna Give You Up" &&
        iosState.nowPlayingInfo.MPNowPlayingInfoPropertyPlaybackRate === 1.0
    );
  }

  // ── STEP 2: Background the App ──
  const webAudioPlaysBeforeBg = webAudioPlayCalls;
  docMock.hidden = true;
  docMock.visibilityState = "hidden";
  MuchiAudioPluginBridge.notifyAppDidEnterBackground();
  docMock.dispatchEvent({ type: "visibilitychange" });
  sandbox.dispatchEvent({ type: "pagehide" });
  sandbox.dispatchEvent({ type: "blur" });

  api.keepBackgroundPlay();
  api.unlockSound();
  await new Promise((r) => setTimeout(r, 30));

  assertE2E(
    `${label} Step 2 (Background App): playback remains active on native engine with zero stop() calls and zero WebView <audio> interference`,
    api.getNpState().npActive === true &&
      api.state.playing === true &&
      calls.filter((c) => c.method === "stop").length === 0 &&
      webAudioPlayCalls === webAudioPlaysBeforeBg &&
      ytIframeCreated === false
  );

  // ── STEP 3: Lock Screen & Wait (Continuous Playback Verification) ──
  docMock.dispatchEvent({ type: "freeze" });
  const tickPositions = [15, 30, 45, 60, 75, 90, 105, 120];
  for (const pos of tickPositions) {
    MuchiAudioPluginBridge.tickProgress(pos, 213);
  }
  await new Promise((r) => setTimeout(r, 30));

  assertE2E(
    `${label} Step 3 (Lock Screen & Wait 15s -> 120s): song continues playing smoothly with screen locked (position=${api.getNpState().npPos}s / 213s)`,
    api.getNpState().npActive === true &&
      api. getNpState().npPlaying === true &&
      api.state.playing === true &&
      api.getNpState().npPos === 120 &&
      (platform === "android"
        ? androidState.exoPlaying && androidState.foregroundStarted && androidState.wakeLockHeld
        : iosState.avPlayerPlaying && iosState.audioSessionActive)
  );

  // ── STEP 4: Lock-Screen Pause & Resume Controls ──
  // 4a. Lock-screen hardware/notification Pause
  MuchiAudioPluginBridge.triggerLockScreenPause();
  await new Promise((r) => setTimeout(r, 25));
  const pausedViaLockScreen =
    api.state.playing === false &&
    api.getNpState().npPlaying === false &&
    (platform === "android" ? !androidState.exoPlaying : !iosState.avPlayerPlaying);

  // 4b. Lock-screen hardware/notification Resume
  MuchiAudioPluginBridge.triggerLockScreenResume();
  await new Promise((r) => setTimeout(r, 25));
  const resumedViaLockScreen =
    api.state.playing === true &&
    api.getNpState().npPlaying === true &&
    (platform === "android" ? androidState.exoPlaying : iosState.avPlayerPlaying);

  // 4c. Bridge __muchiNative("pause") & __muchiNative("play") -> NP.pause() & NP.resume()
  sandbox.__muchiNative("pause");
  await new Promise((r) => setTimeout(r, 20));
  const pausedViaBridge = calls.some((c) => c.method === "pause") && api.state.playing === false;

  sandbox.__muchiNative("play");
  await new Promise((r) => setTimeout(r, 20));
  const resumedViaBridge = calls.some((c) => c.method === "resume") && api.state.playing === true;

  assertE2E(
    `${label} Step 4 (Lock-Screen Pause & Resume): pause & resume work from both OS lock-screen controls and native bridge while screen is locked`,
    pausedViaLockScreen && resumedViaLockScreen && pausedViaBridge && resumedViaBridge && api.getNpState().npActive === true
  );

  // ── STEP 5: Lock-Screen Next-Track, Previous-Track, Auto-Advance & Error Recovery ──
  // 5a. Lock-screen Next Track (Track 1 -> Track 2) while backgrounded & locked
  calls.length = 0;
  MuchiAudioPluginBridge.triggerLockScreenNext();
  await new Promise((r) => setTimeout(r, 40));

  const nextPlayCall = calls.find((c) => c.method === "play" && c.videoId === "kJQP7kiw5Fk");
  assertE2E(
    `${label} Step 5a (Lock-Screen Next Track): advances to Track 2 ("Despacito") in background using verified HTTP/on-device stream`,
    api.state.index === 1 &&
      Boolean(nextPlayCall) &&
      (String(nextPlayCall.url).startsWith("yt:kJQP7kiw5Fk") || String(nextPlayCall.url).startsWith("https://rr1---sn-e2e.googlevideo.com/videoplayback?id=kJQP7kiw5Fk")) &&
      nextPlayCall.title === "Despacito" &&
      api.getNpState().npActive === true &&
      api.state.playing === true,
    `track=${nextPlayCall?.title}, idx=${api.state.index}`
  );

  // 5b. Lock-screen Previous Track (Track 2 -> Track 1 when pos <= 3s) while backgrounded & locked
  api.setNpPos(1, 281);
  calls.length = 0;
  MuchiAudioPluginBridge.triggerLockScreenPrev();
  await new Promise((r) => setTimeout(r, 40));

  const prevPlayCall = calls.find((c) => c.method === "play" && c.videoId === "dQw4w9WgXcQ");
  assertE2E(
    `${label} Step 5b (Lock-Screen Previous Track): returns to Track 1 ("Never Gonna Give You Up") while screen is locked`,
    api.state.index === 0 &&
      Boolean(prevPlayCall) &&
      prevPlayCall.title === "Never Gonna Give You Up" &&
      api.getNpState().npActive === true &&
      api.state.playing === true
  );

  // 5c. Natural Track Completion ("ended" event) while screen is locked -> auto-advances to Track 2
  calls.length = 0;
  MuchiAudioPluginBridge.triggerNativeTrackEnded();
  await new Promise((r) => setTimeout(r, 40));

  const endedNextCall = calls.find((c) => c.method === "play" && c.videoId === "kJQP7kiw5Fk");
  assertE2E(
    `${label} Step 5c (Background Auto-Advance on Track End): automatically transitions to Track 2 ("Despacito") when Track 1 finishes with screen off`,
    api.state.index === 1 &&
      Boolean(endedNextCall) &&
      endedNextCall.title === "Despacito" &&
      api.getNpState().npActive === true &&
      ytIframeCreated === false
  );

  // 5d. Mid-stream Error Recovery while backgrounded -> refreshes HTTP stream and stays on Native Player
  calls.length = 0;
  MuchiAudioPluginBridge.triggerNativeStreamError();
  await new Promise((r) => setTimeout(r, 45));

  const errRetryCall = calls.find((c) => c.method === "play" && c.videoId === "kJQP7kiw5Fk");
  assertE2E(
    `${label} Step 5d (Background Stream Error Recovery): refreshes HTTP stream (&r=1) and retries native player first without falling back to WebView IFrame`,
    Boolean(errRetryCall) &&
      String(errRetryCall.url).includes("&r=1") &&
      api.getNpState().npActive === true &&
      ytIframeCreated === false,
    `refreshedUrl=${errRetryCall?.url?.slice(0, 62)}...`
  );

  if (platform === "ios") {
    assertE2E(
      `iOS Step 5e (UIBackgroundTask Assertions): UIBackgroundTaskIdentifier acquired across background transitions and released once AVPlayer plays`,
      iosState.bgTaskHistory.includes("begin:play") &&
        iosState.bgTaskHistory.includes("begin:didEnterBackground") &&
        iosState.bgTaskHistory.includes("begin:remoteNext") &&
        iosState.bgTaskHistory.includes("begin:itemDidFinishPlaying") &&
        iosState.bgTaskHistory.includes("end:playing") &&
        iosState.bgTaskActive === false
    );
  }

  // 5f. Two additional mocked errors must consume only the one identifier
  // fallback and then stop; the hidden WebView must never be woken. Respect
  // the bridge's duplicate-control debounce between injected errors.
  await new Promise((r) => setTimeout(r, 100));
  const boundedTrack = api.state.queue[api.state.index];
  const playCountBeforeIdentifier = calls.filter((c) => c.method === "play").length;
  MuchiAudioPluginBridge.triggerNativeStreamError();
  await new Promise((r) => setTimeout(r, 35));
  const identifierRetryCall = calls.find((c) => c.method === "play" && String(c.url).startsWith("yt:"));
  const playCountAfterIdentifier = calls.filter((c) => c.method === "play").length;
  // Isolate the terminal failure from the later queue/refill test.
  api.state.queue = [boundedTrack];
  api.state.index = 0;
  await new Promise((r) => setTimeout(r, 100));
  MuchiAudioPluginBridge.triggerNativeStreamError();
  await new Promise((r) => setTimeout(r, 5));
  const playCountAfterExhaustion = calls.filter((c) => c.method === "play").length;
  assertE2E(
    `${label} Step 5f (Bounded Native Fallback): one native identifier retry is allowed, then background playback reports failure without another native attempt`,
    Boolean(identifierRetryCall) &&
      playCountAfterIdentifier === playCountBeforeIdentifier + 1 &&
      boundedTrack._nativeAttemptCount <= 3 &&
      boundedTrack._nativeOnDeviceTried === true &&
      boundedTrack._nativeFallbackExhausted === true &&
      playCountAfterExhaustion === playCountAfterIdentifier &&
      ytIframeCreated === false
  );
  await new Promise((r) => setTimeout(r, 50));

  // ── STEP 6: iTunes & Deezer Song Playback Past 1 Minute + Mid-Song Cutoff Recovery at 1:02 (62s) ──
  const itunesDeezerQueue = [
    {
      id: "itunes:9001",
      source: "itunes",
      title: "Die With A Smile",
      artist: "Lady Gaga & Bruno Mars",
      duration: 252,
      artwork: "/cover-default.jpg",
    },
    {
      id: "deezer:9002",
      source: "deezer",
      title: "BIRDS OF A FEATHER",
      artist: "Billie Eilish",
      duration: 210,
      artwork: "/cover-default.jpg",
    },
  ];
  calls.length = 0;
  api.state.queue = itunesDeezerQueue;
  api.state.index = 0;
  await api.playCurrent(true);
  await new Promise((r) => setTimeout(r, 45));

  const itunesPlayCall = calls.find((c) => c.method === "play" && c.title === "Die With A Smile");
  // Simulate playing smoothly past 1 minute (15s -> 45s -> 62s)
  for (const pos of [15, 45, 62]) {
    MuchiAudioPluginBridge.tickProgress(pos, 252);
  }
  await new Promise((r) => setTimeout(r, 25));

  // Simulate a mid-song stream drop at 1:02 (62,000 ms) and verify recovery resumes at 62s without stopping
  calls.length = 0;
  MuchiAudioPluginBridge.triggerNativeStreamError(62000);
  await new Promise((r) => setTimeout(r, 50));
  const midSongRecoveryCall = calls.find((c) => c.method === "play" && c.title === "Die With A Smile");

  // Continue playing from 62s through 90s, 150s, 210s, 251s to full completion
  for (const pos of [62, 90, 150, 210, 251]) {
    MuchiAudioPluginBridge.tickProgress(pos, 252);
  }
  await new Promise((r) => setTimeout(r, 25));

  assertE2E(
    `${label} Step 6 (iTunes/Deezer Full Playback & 1:02 Mid-Song Recovery): resolves verified stream, recovers mid-song at 62s (1:02) without stopping, and plays full 252s track`,
    Boolean(itunesPlayCall) &&
      Boolean(midSongRecoveryCall) &&
      midSongRecoveryCall.position === 62000 &&
      api.getNpState().npActive === true &&
      api.state.playing === true &&
      api.getNpState().npPos === 251
  );
}

await runFullPlatformE2E("android");
await runFullPlatformE2E("ios");

console.log(`\n=== Mocked Native Background Playback E2E Summary: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
