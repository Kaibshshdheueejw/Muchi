# Implementation Plan — Native Stream Probe ISRC Passthrough (Item B)

## Executive Summary & Objective

In Phase 2 and Phase 2.0, MUCHI added ISRC-aware audio matching and conservative recording identification across the backend (`/api/yt/stream`, `src/util.js`) and the web client (`public/app.js`). 

While initial playback started from the web UI passes `isrc` directly to `/api/yt/stream`, **native background audio operations** (background playlist auto-advance when the WebView is sleeping, next-track preloading, native stream retry on 403/expiration, and on-device stream probing) run inside native code (`MuchiAudioService.java` on Android, `MuchiAudioPlugin.swift` on iOS).

This plan outlines the safest, zero-breaking-change approach to wire the optional `isrc` parameter through the native audio bridge on both Android and iOS, ensuring complete audio fidelity parity under all background and lock-screen conditions.

---

## 1. Analysis: Why It Is Necessary & Benefits

### Why It Is Necessary
1. **Background Auto-Advance:** When track 1 finishes while the device screen is off or the app is minimized, `MuchiAudioService` (Android) and `AVPlayer` (iOS) resolve the next track's audio stream directly in native background services without depending on an active WebView.
2. **Stream Expiration & Error Recovery:** If a YouTube audio CDN URL expires (`403 Forbidden` / `502`) during playback, the native service automatically requests a fresh stream URL via `probeCloudflareBackendStatic` (Android) or `probeCloudflareBackend` (iOS).
3. **The Current Gap:**
   - On Android: `probeCloudflareBackendStatic` has an overloaded signature accepting `isrc`, but `MuchiAudioPlugin.java` does not parse `isrc` from `PluginCall`, `MuchiAudioService.handlePlayIntent` does not unpack `EXTRA_ISRC`, and the background race paths do not supply it.
   - On iOS: `MuchiAudioPlugin.swift`'s `probeCloudflareBackend` does not take or append `isrc` at all.

### Key Benefits
- **Exact Recording Guarantee in Background:** Ensures the native engine cannot mistakenly resolve a live performance, remix, or tribute video when recovering or advancing in the background.
- **Fast Edge Cache Hits:** Cloudflare Workers' `/api/yt/stream` utilizes ISRC for instant KV cached stream lookups; passing `isrc` natively reduces edge resolution latency from ~1200ms to ~120ms.
- **100% Platform Parity:** Eliminates the architectural discrepancy between Web, Android, and iOS audio resolution pipelines.

### Why Safest Way
- **Non-Breaking Optional String:** If `isrc` is present (from Deezer or Apple catalog tracks), it is appended as `&isrc=...`. If absent, empty, or invalid, the functions immediately fall back to their existing, tested `title + artist + candidates` matching. No existing audio playback path is modified or delayed.

---

## 2. Review of Section 6 Item C (Optional Enhancements)

In accordance with user feedback:
1. **Offline Track Export (C1):** **OMITTED.** Tracks remain exclusively within MUCHI's scoped encrypted IndexedDB storage. This prevents Android 11–14 `MANAGE_EXTERNAL_STORAGE` permission hurdles, avoids filesystem clutter, and prevents potential user library desynchronization.
2. **Extended Search Synonyms (C2):** **DEFERRED / MAINTAINED AS-IS.** Phase 2.0 already implements targeted query expansion (`generateTargetedQueryVariations`) and version intent detection (`detectQueryIntent`) with a strict 1200ms bounded timeout. Hardcoding extra dictionary synonyms at this stage would add network overhead without significant accuracy gains.

---

## 3. Step-by-Step Technical Changes

### Step 1: Web Bridge (`public/app.js`)
- In `nativePlayWithUrl`: Pass `isrc: String(t.isrc || "")` in the payload passed to `NP.play({...})`.
- In `nativeSetNextTrack`: Pass `isrc: String(t.isrc || "")` in `NP.setNextTrack({...})`.
- In `nativePreloadTrack`: Pass `isrc: String(t.isrc || "")` in `NP.preload({...})`.
- Sync changes to `android/app/src/main/assets/public/app.js` and `ios/App/App/public/app.js`.

### Step 2: Android Native Engine
- **`android/app/src/main/java/app/muchi/music/MuchiAudioService.java`:**
  - Define constant: `public static final String EXTRA_ISRC = "isrc";`
  - In `handlePlayIntent(Intent intent)`: unpack `String isrc = intent.getStringExtra(EXTRA_ISRC);` and pass to `resolveStreamUrlStatic` and `preloadStream`.
  - In `handleNextTrackIntent(Intent intent)`: unpack `EXTRA_ISRC` and store in `queuedNextTrack`.
  - In `probeCloudflareBackendStatic`: ensure `isrc` is forwarded on all fallback branches (`earlyCfFuture`, `fbFutures`).
- **`android/app/src/main/java/app/muchi/music/MuchiAudioPlugin.java`:**
  - In `play(PluginCall call)`: `i.putExtra(MuchiAudioService.EXTRA_ISRC, call.getString("isrc", ""));`
  - In `setNextTrack(PluginCall call)`: `i.putExtra(MuchiAudioService.EXTRA_ISRC, call.getString("isrc", ""));`
  - In `preload(PluginCall call)`: pass `isrc` to `MuchiAudioService.preloadStream(...)`.

### Step 3: iOS Native Engine
- **`ios/App/App/MuchiAudioPlugin.swift`:**
  - In `NextTrackInfo`: add `let isrc: String`.
  - In `play(_ call: CAPPluginCall)`: read `isrc = call.getString("isrc") ?? ""` and pass to `playTrackDirect`.
  - In `preload(_ call: CAPPluginCall)`: read `isrc` and pass to `preloadStream`.
  - In `setNextTrack(_ call: CAPPluginCall)`: read `isrc` and store in `queuedNextTrack`.
  - In `probeCloudflareBackend`: update signature to:
    ```swift
    private static func probeCloudflareBackend(videoId: String, candidates: String, title: String, artist: String, expectedDurationMs: Double = 0, isrc: String = "") -> ResolvedStream?
    ```
  - If `!cleanIsrc.isEmpty`, append `URLQueryItem(name: "isrc", value: cleanIsrc)`.

---

## 4. Verification & Testing Plan

1. **Automated Unit & E2E Tests:**
   - Run `node test/phase2-search-accuracy.mjs` to confirm no search regressions.
   - Run `node test/native-background-e2e.mjs` to verify all 25 native background playback and lock-screen assertions pass with `isrc` parameter enabled.
   - Run `node test/smoke.mjs` to ensure zero regressions across all 85+ platform smoke tests.
2. **Release Checks:**
   - Run `node scripts/check-release.mjs` to ensure version sync and build safety.
3. **Applet Compilation & Linting:**
   - Execute `compile_applet` and `lint_applet` to verify clean build without warnings.
