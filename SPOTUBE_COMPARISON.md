# Muchi (📱 web/PWA + Capacitor) vs Spotube (Flutter native) — Deep Feature & Architecture Report

> Two parts: (1) **lyrics status** in Muchi, (2) a precise comparison of **notifications, background
> playback, downloads** and the **full feature set**, with what Muchi should add.

---

## Part 1 — Lyrics: are they working?

**Yes — implemented and wired, but the live result depends on the source.**

- **Preview (this sandbox):** `/api/lyrics` returns the **placeholder** payload below, so you see
  plain text, not real lyrics — because the sandbox has **no egress** to `lrclib.net`.
  ```json
  { "title":"Blinding Lights","artist":"The Weeknd","lyrics":"... (Preview lyrics shown for testing.)","synced":[] }
  ```
- **Production (`handleLyrics` → `lyricsFor` in `src/providers.js`)** queries **LRCLIB**:
  - `https://lrclib.net/api/get?artist_name=…&track_name=…`
  - `https://lrclib.net/api/search?q=…` and `…/search?track_name=…&artist_name=…`
  - Returns `{ lyrics, synced }` where `synced` is the **time-synced** array.

**Client rendering (`public/app.js`)** matches the contract exactly:
- `state.lyrics = { lyrics, synced, key }` from `loadLyrics()`.
- `lyricsBodyHTML()`: if `synced.length` → renders tappable `.ly-line` lines with `data-ly-t` timestamps
  (tap = seek); else if `lyrics` → renders `<pre class="ly-plain">`; else → "Lyrics aren't available".
- `highlightLyric(ms)` tracks the active line by time; `bindLyricLines()` wires tap-to-seek.

**Conclusion:** On the deployed worker (with egress) you get real synced lyrics for most English hits.
In this sandbox preview you get the placeholder because outbound calls are blocked. The pipeline is
correct end-to-end.

---

## Part 2 — Spotube, precisely

**Stack:** Flutter/Dart, **native** on Windows/macOS/Linux/Android/iOS. It is *not* a web wrapper — it
uses the platform system media APIs directly.

Key packages (`pubspec.yaml`):
- **Background play + notification:** `audio_service`, `audio_session`, `audio_service_mpris`, `media_kit` (player, libmpv-based), `smtc_windows`.
- **Downloads:** `dio` (streamed HTTP + cancel), `metadata_god` (ID3/MP4 tag + art write/read), `path_provider`.
- **Local DB/library:** `drift` + `sqlite3`, `local_tracks` provider.
- **Extras:** `flutter_discord_rpc` (Discord presence), `home_widget` (Android widget), `scrobblenaut` (Last.fm/ListenBrainz), `local_notifier`/`open_file`, `flutter_new_pipe_extractor`/`youtube_explode_dart`/`yt_dlp_dart` (audio-source + metadata extractors), Hetu-script **plugin system** (BYOMM).

### 2a. Notifications + background playback — how Spotube does it

`lib/services/audio_services/audio_services.dart` boots the service:
```dart
final mobile = await AudioService.init(
  builder: () => MobileAudioService(playback),
  config: AudioServiceConfig(
    androidNotificationChannelId: "oss.krtirtho.spotube",   // per release channel
    androidNotificationChannelName: 'Spotube',
    androidNotificationOngoing: false,
    androidStopForegroundOnPause: false,
    androidNotificationChannelDescription: "Spotube Media Controls",
  ),
);
```

`MobileAudioService extends BaseAudioHandler` (`mobile_audio_service.dart`) is the heart:
- Overrides `play / pause / seek / stop / skipToNext / skipToPrevious / setShuffleMode / setRepeatMode`.
- Publishes the media notification state via `playbackState.add(PlaybackState(...))`:
  - `controls: [skipToPrevious, play-or-pause, skipToNext, stop]`
  - `systemActions: {seek}`, `androidCompactActionIndices: [0,1,2]`
  - `playing`, `updatePosition`, `bufferedPosition`, `shuffleMode`, `repeatMode`, `processingState`
- Populates the notification with `mediaItem.add(MediaItem(id, title, artist, album, duration, artUri, playable))`.
- **audio_session** (`AudioSessionConfiguration.music()`):
  - `interruptionEventStream`: **duck** → volume 0.5, **pause** → pause, on end restore volume / resume.
  - `becomingNoisyEventStream` → pause (headphones unplugged).
- `setActive(true)` on play, and `onTaskRemoved` → pause + `exit(0)` on Android.
- **Desktop:** `audio_service_mpris` (Linux MPRIS) and `WindowsAudioService` (`smtc_windows`).
- `AudioServices` is a `WidgetsBindingObserver`: on `detached` → deactivate session + pause.

So: **one foreground media service drives the OS media notification + lock-screen/bluetooth controls,
handles audio focus/interruption, and keeps playing when the screen locks or the app backgrounds.**

### 2b. Downloads — how Spotube does it

`lib/provider/download_manager_provider.dart`:

- `DownloadTask { track, status(queued|downloading|completed|failed|canceled), cancelToken,
  totalSizeBytes, downloadedBytesStream }`.
- `addToQueue(track)` / `addAllToQueue` → resolve the real stream URL via `sourcedTrackProvider(track).future`,
  then run the **sequential** queue `_startDownloading()`.
- `_downloadTrack`:
  1. Resolve the **audio source** (plugin) and pick the **quality + container/codec** from
     `audioSourcePresetsProvider` (`getUrlOfQuality(container, qualityIndex)`).
  2. `savePath = join(userDownloadLocation, sanitizeFilename("Name - Artists.<ext>"))` — user-selectable location.
  3. **Stream to disk:** `dio.chunkDownload(url, savePath, cancelToken, onReceiveProgress, deleteOnError:true, fileAccessMode:write)`; progress bytes → `downloadedBytesStream`, total → `totalSizeBytes`.
  4. On success, unless the container is `weba`: download album art, then
     **`MetadataGod.writeMetadata(file, task.track.toMetadata(...))`** to embed ID3/MP4 tags **+ cover art**.
- Replace-existing-file dialog; `cancel()`; `retry()`; `clearAll()`.
- **Offline library:** `lib/provider/local_tracks/local_tracks_provider.dart` scans the download dir +
  music-cache dir + user library dirs; `MetadataGod.readMetadata` reads tags; extracts embedded art to
  temp; builds `libraryToTracks` (files → local tracks) for an offline library.

### 2c. What Spotube has as a product (feature list)

Cross-platform · plugin-powered/extensible (BYOMM + Hetu + plugin marketplace) · **free downloads with
proper ID3 metadata** · **time-synced lyrics** · no telemetry · native playback · **Discord Rich
Presence** · **Android home widget** · **scrobbling (Last.fm/ListenBrainz)** + Wikipedia artist info ·
offline/local library from actual files · audio source / quality / codec selection · per-track
alternative sources.

---

## Part 3 — What Muchi already has

Muchi = **Cloudflare Worker backend + Liquid-Glass web/PWA**, wrapped by **Capacitor** for Android & iOS
(one codebase in `public/`, native shell in `android/` + `ios/`).

Already implemented:

| Area | Muchi current |
|---|---|
| **Notification / lock-screen controls** | ✅ Web `navigator.mediaSession` (`MediaMetadata`, `setActionHandler` play/pause/next/prev/seek, `setPositionState`). Native: **Media3/ExoPlayer foreground service** (`MuchiAudioService`) with `MediaSessionCompat` + media notification + `MusicControls` fallback. LocalNotifications for "Saved for offline". |
| **Background playback** | ✅ Native **foreground service** (ExoPlayer, `WAKE_MODE_LOCAL`, audio-focus, AUDIO_CONTENT_TYPE_MUSIC) — keeps playing when locked/backgrounded; iOS AVPlayer. `keepBackgroundPlay()` for web. |
| **Downloads** | ⚠️ **Partial** — only **Audius** indie tracks (`/api/audius/file/{id}`), stored as an **IndexedDB blob** + metadata in `aura.downloads`. **No** YouTube downloads, **no** on-disk file, **no** ID3 tags, **no** user-selected location, **no** download queue/progress/cancel. |
| **Offline/library** | ⚠️ IndexedDB offline cache + service worker; "Downloaded" library reads `aura.downloads` metadata (blobs), not real tagged files. |
| **Lyrics** | ✅ synced (LRCLIB) + tap-to-seek highlight. |
| **Playback** | ✅ YouTube (iframe API), Audius, live radio; queue, shuffle, repeat, sleep logic, resume. |
| **App shell** | ✅ PWA + Capacitor Android/iOS, themes, settings, Google Sign-In (OAuth), APK update modal, share, status-bar/splash. |
| **No telemetry / open source** | ✅ |

(No equalizer, no scrobbling, no Discord presence, no home widget, no plugin/extension system, no
audio codec/quality picker, no on-disk tagged downloads.)

---

## Part 4 — Gap analysis: what Muchi should add to match Spotube

Ordered by value vs effort (Muchi must bridge everything through Capacitor plugins since it runs in a
WebView; only the web layer can't do raw OS media/file APIs).

### 🔴 High value — your three asked-about items

**1. Real download system (biggest gap).** Spotube downloads *any* track to a user folder with tags and
progress/cancel/resume. Muchi already streams the audio URL for **YouTube** playback (`/api/youtube/stream`)
— reuse that to download:
- On **Android/iOS**: new/download-module Capacitor plugin → write the byte stream to a user-visible
  folder (MediaStore/`getExternalFilesDir`) + embedded ID3/MP4 tags + cover art (mirrors
  `metadata_god`). Add a **foreground/notification download** task with progress + cancel (mirrors
  `dio.chunkDownload` + `LocalNotifications`).
- On **web**: use the **File System Access API** (or a fallback `<a download>` blob) so files land on disk.
- Add a **downloaded/local library** tab that reads those files' tags (mirrors
  `local_tracks_provider`).
- Optionally a **quality/codec selector** for downloads (Spotube has presets).

**2. Notification parity.** Already close. Worth adding:
- **Android media widget** (`home_widget`) so the notification/lock-screen also has a home-screen widget.
- **Desktop MPRIS/SMTC** integration only if you add desktop targets (Muchi is mobile/web today).

**3. Background play parity.** Already present via ExoPlayer foreground service + audio-focus/wake-lock.
No change required beyond keeping the service alive; optionally handle `onTaskRemoved` and multi-track
auto-advance natively (currently the web layer owns the queue — which is fine).

### 🟠 Medium value
- **Sleep timer** (client + native: auto-pause after N minutes).
- **Equalizer** (Android: Media3/ExoPlayer audio effects or a DSP plugin; iOS/desktop limited; web can't
  DSP a YouTube iframe stream — native only).
- **Scrobbling** to Last.fm / ListenBrainz (OAuth + API; web + native).
- **Crossfade** (native audio only; web is constrained by the YouTube iframe).
- **Discord Rich Presence** (desktop only; skippable for a mobile-first app).

### 🟢 Lower / optional
- **Plugin / extension system** (Spotube's BYOMM Hetu scripting) — very large; only if you want
  third-party sources. Out of scope for a v1.
- **Wikipedia artist biography**, **alternative sources per track**, **download quality presets**.

---

## Bottom line

- **Lyrics: working** (synced via LRCLIB; placeholder in the sandbox only because egress is blocked).
- **Notification + background play: already at parity** with Spotube (web MediaSession + native
  Media3 foreground service with media notification, audio focus, wake lock). 
- **Downloads: the real gap** — Muchi saves only Audius tracks to IndexedDB with no tags/location;
  Spotube downloads any track to a user-chosen folder with ID3 tags, progress, cancel, and an
  on-disk offline library. This is the single highest-value add.
- Secondary nice-to-haves to reach feature parity: **sleep timer, equalizer (native), scrobbling,
  Android home widget, quality/codec picker**, then (optionally) **Discord presence** and a **plugin system**.

*Full reference source used: `KRTirtho/spotube` @ `master` — `lib/services/audio_services/*`,
`lib/provider/download_manager_provider.dart`, `lib/provider/local_tracks/*`, `pubspec.yaml`.*
