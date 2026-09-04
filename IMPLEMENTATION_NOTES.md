# Muchi — Implementation Notes (background/notification + downloads)

This documents the code changes that make Muchi's **background playback /
media notification** actually work on Android + iOS (emulating the way
Spotube's `audio_service` + `audio_session` layer does it) and that add a
**real on-disk download system** (not just IndexedDB blobs).

All changes are on `arena/01a0673f-muchi`. Static web files (`public/`) are
served immediately; the Worker (Cloudflare) reads `src/`, so deploy the
Worker after you merge.

---

## 1. Android background playback + media notification

### What was wrong
- `MuchiAudioPlugin` binds to `MuchiAudioService` **asynchronously**
  (`ServiceConnection`). `pause()`, `resume()`, `seekTo()` and `stop()` all
  checked `if (service != null)` and **silently did nothing** when the bind
  hadn't completed yet — so taps during launch were dropped and playback
  appeared to "not work".
- The service's notification lifecycle was fragile: no handling of a
  `START_STICKY` restart, and no `setSessionActivity`, so a tap on the
  notification could fail to reopen the app.

### What changed
- **`android/app/src/main/java/app/muchi/music/MuchiAudioPlugin.java`**
  - Controls that arrive before the service is bound are now **buffered in a
    queue and replayed on `onServiceConnected`**, so no tap is ever dropped.
  - `play()` now resolves **only after the service binds** (with a 4 s
    timeout), so the web layer can fall back to the WebView `<audio>` element
    if the native service never comes up.
- **`android/app/src/main/java/app/muchi/music/MuchiAudioService.java`**
  - `onStartCommand` handles a `START_STICKY` null-intent restart by
    re-attaching the foreground notification (survives aggressive OEM battery
    managers).
  - The media session now gets a `setSessionActivity` so tapping the
    notification/lock-screen reopens the app.
  - The manifest already declares `foregroundServiceType="mediaPlayback"`,
    `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `WAKE_LOCK` and `POST_NOTIFICATIONS`.
    Keep those — they are required and correct.

### iOS
- `MuchiAudioPlugin.swift` already uses `AVPlayer` + `AVAudioSession(.playback)`
  + `MPRemoteCommandCenter` + `MPNowPlayingInfoCenter`, and `Info.plist` has
  `UIBackgroundModes: audio`. On iOS the background audio + lock-screen controls
  work as-is; no change was needed beyond registering the download plugin.

---

## 2. Real download system (files on disk, tagged)

### Server
- **`src/stream.js`** — new `handleDownload(request, url)` at `/api/download`:
  - `?videoId=…` → resolves the Piped audio stream then proxies it with
    `Content-Disposition: attachment; filename="<name>.<ext>"` and the real
    `Content-Type`. The client gets a real, playable, storable file.
  - `?trackId=…` → same for independent Audius tracks.
  - Reuses `pipeUrl`, so Googlevideo IP/token headers are handled edge-side.
- **`src/index.js`** — routes `/api/download` to `handleDownload`.

### Web / PWA (`public/app.js`)
- Replaced the old "Audius-only → IndexedDB blob" `downloadTrack` with a real
  download manager (`downloadTrack`, `saveDownloadToDisk`, `downloadFilePath`,
  `slimTrack`, `fmtBytes`).
- Any track with a `videoId` or `trackId` can now be saved.
- **Native**: calls `MuchiDownload.startDownload` (new plugin) → the file lands
  in `MediaStore.Audio` (Android) or `Documents/Muchi` (iOS).
- **Web**: uses the **File System Access API** (`showSaveFilePicker`) when
  available, so the user picks where the real file is saved; otherwise falls
  back to a blob + `a[download]` browser save. The File System Access handle is
  persisted in IndexedDB so the app can replay the actual file offline.
- **Queue + progress + cancel**: a live `dl-panel` overlay shows active
  downloads with a progress bar and a cancel button from any screen; a
  "Downloads" card in Settings lists everything with remove buttons.
- `makeDlPanel` / `renderDlPanel` render the overlay; `renderDlManager` feeds
  the Settings card.
- `playAudio` now prefers a saved local file (native content-URI, or the web
  FSP handle / blob) before streaming, giving real offline playback.
- The `api()` cache regex now excludes `/api/download`.

### Android plugin (new)
- **`android/app/src/main/java/app/muchi/music/MuchiDownloadPlugin.java`**
  - `startDownload({id,url,filename,title,artist,album,genre,artwork,mime})`
    streams the URL to a real file:
    - **API 29+**: inserted into `MediaStore.Audio` (Music/Muchi) with
      `TITLE/ARTIST/ALBUM/GENRE/IS_MUSIC` so it appears in the user's music
      library with its metadata. The real upstream `Content-Type` is used to
      pick the correct extension/mime (m4a / webm / mp3).
    - **API < 29**: written to the app's Music folder (`getExternalFilesDir`).
  - `progress`, `done`, `error` events streamed to JS; `cancelDownload` aborts
    and deletes the partial file; `removeDownload` deletes the file from disk.
- **`android/app/src/main/java/app/muchi/music/MainActivity.java`** — registers
  `MuchiDownloadPlugin`.

### iOS plugin (new)
- **`ios/App/App/MuchiDownloadPlugin.swift`** — `URLSession.downloadTask` writing
  to `Documents/Muchi`, progress + cancel, `removeDownload` deletes the file.
- **`ios/App/App/MuchiBridgeViewController.swift`** — registers
  `MuchiDownloadPlugin`.
- **`ios/App/App/Info.plist`** — added `UIFileSharingEnabled` +
  `LSSupportsOpeningDocumentsInPlace` so saved files show up in the Files app.

---

## 3. "Made for you" — 10 playlists × 20 songs (fresh, taste-adaptive)

### What was wrong
The user saw only 6 "Made for you" playlists. The root causes:
1. An **old cached `/api/home` payload** in the app's IndexedDB API cache.
2. The old data only shipped some cards.

### What changed
- **`src/data.js`** — `FY_QUERIES` is exactly **10 distinct moods**
  (pop, hip-hop, R&B, rock, dance, indie, trending, chill, workout, throwback),
  each tagged with `mood` + `genres`. `buildForYouPlaylists` returns **10**
  cards, each carrying `kind:"yt"`, `mood`, `genres` and up-to-**20** `tracks`
  (so the card shows "20 songs" and opens fully populated).
- **`public/app.js`** — bumped the API cache version (`API_CACHE_V` → `v3-fy10`)
  so clients refetch home instead of showing a stale 6-playlist payload.
- `tasteProfile()` now collects `t.genre || t._tag || t.mood` so the moods a
  listener actually plays drive the profile.
- `fyTasteScore()` reorders "Made for you" cards by (a) mood/genre match and
  (b) how many songs in a card are by artists the listener plays — so the
  section visibly reorders as the user listens. `forYouPlaylistList()` applies
  a **stable** sort (no taste = original order, a sensible default row).
- `forYouCardHTML` shows the real song count ("20 songs").
- **`public/index.html`** — bumped `favicon`/`styles.css?v=91`/`app.js?v=91`
  cache-busting.

The preview seed (`src/preview-seed.js`) already returns 10 disjoint
20-song mood cards; the client + server data now match.

---

## 4. Testing done in this workflow, and bugs found + fixed

I ran the changes through the only test tools available in this sandbox (there is
**no Android SDK**, **no Xcode**, and **no internet egress** for Piped/Audius/
Googlevideo). What I could do, I did — and it caught **three real bugs**, all fixed:

### Tests that passed
- **Worker endpoint regression sweep** (all `200 OK`): `/api/home`, `/api/health`,
  `/api/version`, `/api/search`, `/api/shelf`, `/api/discover`, `/api/for-you`,
  `/api/lyrics`. `/api/yt/stream` and `/api/audius/stream` return graceful 200
  payloads (Piped/Audius are unreachable here, so they report "all piped stream
  instances failed" rather than crashing).
- **`/api/download` routing + headers**: returns `400` with `Missing videoId or
  trackId` on no params; with a track it streams (or 400/502 when egress is
  blocked) and sets `Content-Disposition: attachment; filename="<name>.<ext>"` +
  the real `Content-Type`, plus `Access-Control-Expose-Headers`.
- **Web DOM boot test (`jsdom`, real `index.html` + `app.js` against the running
  Worker)** — **zero JS boot errors**, and the "Made for you" section renders
  **10 cards, each with "20 songs"** (no "Mix" placeholders):
  ```
  cards with a real song count (N songs): 10
  cards still showing 'Mix': 0
  VERDICT: PASS
  ```

### Bugs found and fixed
1. **Offline replay of a web-saved file was broken.** `playAudio` gated the
   File-System-Access-handle branch on `/^blob:/`, but the handle URI is `fsp:` —
   so it fell through to `URL.createObjectURL({handle,fname})`, which is invalid.
   Fixed the branch to test `fsp:`.
2. **Native downloads stored the wrong `.uri`.** `saveDownloadToDisk` returned the
   native plugin's whole resolved value `{id, uri}` instead of the URI string, so
   the saved download record's `.uri` was an object (breaking offline replay and
   delete). Fixed to extract `res.uri`.
3. **iOS wouldn't compile the new plugin.** The Xcode project is **not** using
   synchronized file groups, so `MuchiDownloadPlugin.swift` was never added to the
   target. Fixed by adding the `PBXBuildFile`, `PBXFileReference`, group child and
   `Sources` phase entries to `App.xcodeproj/project.pbxproj`.
4. **Android `MediaStore.Audio.Media.GENRE` doesn't exist** (`AudioColumns` has no
   `GENRE` column) — would be a compile error. Removed that `ContentValues` line.
5. **Cancel on native could hang the JS promise** if the task hadn't started
   (queued) — added a `Map<id, PluginCall>` so `cancelDownload` rejects the
   original call.

### What could NOT be tested here (environment limits)
- **Android/iOS native build** — no SDK/Xcode in the sandbox. A build is required
  to confirm the media notification + background playback and the MediaStore /
  Documents write on a real device/emulator.
- **Real streaming (YouTube/Audius) download** — blocked: no outbound network. The
  `/api/download` endpoint reuses the same worker proxy path that already streams
  playback; its header logic is verified (see above) but a live byte-for-byte
  download needs real egress.

## 5. How to verify

- **Web preview**: Home → "Made for you" should show **10** cards, each
  labelled "20 songs". Tap one → a 20-song catalog of that mood opens.
- **Android/iOS build**:
  - Play a track → the OS media notification + lock-screen controls appear and
    playback continues in the background (verify the notification taps and that
    next/previous reach the app).
  - Tap the player/download button → "Save offline" → the file downloads with a
    progress bar; on Android it shows up in the system Music library, on iOS in
    the Files app → `Muchi`. Kill the app and replay → plays from disk.
- **PWA/web**: the download button uses the File System Access picker; saved
  files are real files on the user's disk.
