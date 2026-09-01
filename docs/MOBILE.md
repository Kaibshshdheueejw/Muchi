# MUCHI — mobile (Android + iOS): architecture, builds, testing

This repository contains the complete mobile projects (`android/`, `ios/`,
`capacitor.config.ts`). Both apps are **Capacitor 8** shells around the same
web app in `public/` (`webDir: "public"`); native code adds background
audio, lock-screen/notification media controls, deep links and platform
integration.

## Architecture

```
public/ (Liquid Glass UI — one codebase)
   ├─ Android: Capacitor WebView audio + capacitor-music-controls-plugin
   │           (notification, MediaSession, lock-screen/media-button controls)
   └─ iOS:     Capacitor WebView + WebKit media session (Now Playing,
               lock-screen + remote controls, UIBackgroundModes: audio)
```

- Native feature calls from the frontend: `P.MusicControls`
  (`capacitor-music-controls-plugin`) and the status bar / app / share /
  notifications plugins (`@capacitor/*` v8) — wired in `public/app.js`
  `initNativeBridge()`.
- **Android playback**: audio plays in the WebView `<audio>` element (with
  the MusicControls notification + lock-screen/media-button controls active,
  and a screen wake lock while playing). The `nativePlayTrack()` bridge in
  app.js targets an optional `MuchiAudio` Media3 foreground service that is
  **not included in this repository** — it degrades cleanly to the WebView
  path.
- **iOS background audio**: WebKit media session keeps playing with the
  screen off (`UIBackgroundModes = audio` in Info.plist) and exposes
  Now Playing / lock-screen / remote controls; the plugin bridge forwards
  control events back to the app.

## Deep-link auth (`muchi://`) — included in this repository

Native sign-in completes via the custom scheme:

1. Settings → Sign in → `/api/auth/google/url?platform=native` opens in the
   system browser (`window.open(url, "_system")`).
2. The Worker redirects to `muchi://auth/success?token=…` /
   `muchi://youtube/success` / `muchi://auth|youtube/error`.
3. The OS returns the URL to the app; Capacitor emits `appUrlOpen`;
   `handleAuthDeepLink()` stores the token and subsequent API calls send
   `Authorization: Bearer …`.

Registrations (both **added in this package** — they were missing in the
Render-era mobile projects, which broke native sign-in):

- Android: `android/app/src/main/AndroidManifest.xml` — intent filter
  `<data android:scheme="muchi"/>` on MainActivity.
- iOS: `ios/App/App/Info.plist` — `CFBundleURLTypes` with
  `CFBundleURLSchemes = [muchi]`.

No Google Console entry is needed for the custom scheme (OS-level).

## API base — one constant

`MUCHI_API_BASE_FALLBACK` in `public/app.js` (see `docs/API-CONFIG.md`):
- Web: same origin (the Worker) — nothing to configure.
- Native: absolute URL. Render until cutover, then the production Worker.
- After changing it: `npm run mobile:sync` and rebuild.

## Android details

- Project: `android/` (Capacitor). `app.muchi.music`, minSdk 24,
  compile/target SDK 36, versionName 1.2.1.
- **Native media controls**: `capacitor-music-controls-plugin` ^8
  (notification + MediaSession + media buttons; it is a controls plugin,
  not an audio player).
  The v83.1 `.longValue()` duration fix is included in that version
  (`MusicControlsInfos.java`: `duration = (long)(params.optDouble(...)*1000)`;
  `METADATA_KEY_DURATION` put as long) — pinned via `package-lock.json`.
- **Signing**: never in the repo. Release builds read
  `MUCHI_KEYSTORE_FILE` / `MUCHI_KEYSTORE_PASSWORD` / `MUCHI_KEYSTORE_ALIAS`
  from the environment; CI uses GitHub secrets `MUCHI_KEYSTORE_B64` etc.
  Without them the release build falls back to the debug key (testable,
  not for Play).
- Build locally: `npm run mobile:sync:android` then
  `cd android && ./gradlew assembleRelease bundleRelease`.

## iOS details

- Project: `ios/` (Capacitor). `UIBackgroundModes: audio`,
  `muchi://` URL scheme, portrait+landscape, dark Liquid Glass canvas.
- Now Playing / lock-screen / remote controls: WebKit media session
  (no native AVAudioSession code) — verify on a real device.
- Build locally: `npm run mobile:sync:ios` then
  `cd ios/App && xcodebuild -project App.xcodeproj -scheme App -configuration Release -sdk iphoneos -derivedDataPath ./DerivedData -archivePath ./output/Muchi.xcarchive CODE_SIGNING_ALLOWED=NO archive`
  (unsigned archive; `export-options.plist` included).
- App Store publishing: add the signing secrets documented in
  `ios-capacitor.yml` and export with a signing export options plist.

## Real-device test checklist (PENDING — needs a device + deployed Worker)

- [ ] Android + iOS: Google sign-in via `muchi://` deep link completes;
      token stored; Settings shows the account
- [ ] Android + iOS: session survives app restart (D1-backed)
- [ ] YouTube connect via deep link; Liked Songs / Playlists load
- [ ] Background playback continues with screen off (Android Media3
      service; iOS WebKit media session)
- [ ] Lock-screen/notification controls: play/pause/next/prev/seek
- [ ] Media notification artwork + progress update correctly
- [ ] App works against the staging Worker with
      `MUCHI_API_BASE_FALLBACK` set to the staging URL
- [ ] `allowMixedContent: false` — all API/stream URLs are https
