# MUCHI Cloudflare migration — architecture, decisions, status

## 1. What moved (complete port, verified against server.js)

Every one of the 23 route groups in `server.js` is implemented:

| Group | Worker module | Notes |
|---|---|---|
| health, version | direct.js | byte-identical shape |
| moods | direct.js | full MOOD_CORE + 24-country MOODS_BY_COUNTRY, `.slice(0,12)` |
| auth/status | oauth.js | D1-backed |
| auth/google/url, auth/youtube/url | oauth.js | KV→**D1** oauth state (see §3) |
| auth/google/callback, auth/youtube/callback | oauth.js | cookie **bug fixed** (see §6) |
| auth/signout, auth/youtube/disconnect | oauth.js | revoke + D1 delete |
| youtube/liked, playlists, playlist | oauth.js | YouTube Data API, 60 s per-session cache, 4-page pagination |
| home | aggregate.js | decomposed: per-day KV blocks, never-cache-empty |
| shelf | aggregate.js | per-day KV per shelf, full/row caps |
| search | aggregate.js | 5 sources, artists/playlists dedupe (verbatim) |
| youtube/search | aggregate.js | slice 80 |
| yt/playlist | aggregate.js | browse VL + continuations ≤300 |
| artist | aggregate.js | iTunes lookup + Audius + YouTube fallbacks |
| radio, radio/click | aggregate.js | Radio Browser 4-host `Promise.any` |
| stream | stream.js | fetch passthrough (see §5) |
| audius/stream, audius/file | stream.js | stream-URL resolve + passthrough |
| img | stream.js | buffered, 8 MB cap, public 86400 |
| discover, for-you | aggregate.js | seeded shuffle, 6 h cache |
| related | aggregate.js | 3 min cache, skip-dedupe |
| lyrics | aggregate.js | LRCLIB 3 attempts |

Dependencies: **zero runtime npm packages** (server.js has none either);
only `wrangler` as a devDependency. `node:crypto` (HMAC, randomBytes) works
via the `nodejs_compat` flag.

## 2. Response shapes

Unchanged from server.js — including the odd-but-real ones:
- `searchYouTube()` returns an **array with `.artists` and `.playlists`
  attached as own properties** (aggregate.js reads them exactly like
  server.js does).
- `/api/search` flattens `apple` to a songs array and deletes
  `audiusUsers` after merging into `artists`.
- `/api/artist` has two distinct shapes (`{name, artwork, songs, albums,
  tracks, latest}` vs `{tracks, latest}`).
- `/api/shelf` and friends degrade to `200 {…, tracks: [], error}` on
  provider failure (never a raw 500) — same as server.js.

## 3. Storage decisions (re-verified against Cloudflare free limits)

| Data | Store | Why |
|---|---|---|
| sessions | **D1** | strong consistency (must see session right after callback), 5M reads/100k writes/day free; survives redeploys — the fix for Render's ephemeral-FS logout bug |
| oauth state | **D1** (plan said KV — **changed**) | a Google callback can hit a different edge PoP than `/url`; KV is eventually consistent and could drop the single-use state → failed login. D1 is strongly consistent. Cost: trivial (2 writes/login) |
| home/shelf caches | **KV** (bounded keys) | daily keys, ~30 writes/day ≪ KV free's 1k/day; shared across isolates so the heavy build runs once/day |
| discover/related/search caches | in-memory (per isolate) | user-generated keys would blow KV's 1k writes/day; same as server.js's in-memory Map |
| per-session YouTube cache | in-memory | same reason; 60 s freshness, correctness unaffected (worst case refetch) |
| static assets | Workers Static Assets | same files as Render; `run_worker_first: /api/*` keeps OAuth callbacks hitting the Worker |

## 4. CPU budget (free plan 10 ms/request) — honest analysis

- Cache-hit requests (home/shelf after first build): a KV read + JSON
  parse ≈ 1–3 ms CPU. ✓
- `?debug=1` returns `x-muchi-ms` wall time; **the real metric is per-
  invocation CPU in the dashboard** — verify after deploy (TESTING.md).
- Cold builds (home ≈ 16 subrequests, discover ≈ 6, search ≈ 10): subrequest
  count is within the free 50/request, but the CPU of parsing 6+ YouTube
  responses in one request may exceed 10 ms. Mitigations: daily KV caching
  (builds once per day globally), in-memory caching for discover/related,
  `Promise.allSettled` parallelism (I/O waits don't count toward CPU).
  **If a cold request still exceeds 10 ms on the real Worker**, the plan
  already defines the next step: split each provider into its own KV-cached
  unit (Phase 8 decomposition) — do NOT delete or merge endpoints.
- `/api/stream` returns the upstream Response; the edge streams the body
  with ~zero JS CPU even for hours-long radio. ✓ (verify on deploy)

## 5. /api/stream — passthrough design (no 302)

Behavior mirrored from the verified server.js pipeUrl: SSRF guard → fetch
with `User-Agent: Muchi/1.2.1`, `Accept: audio/*,*/*`, `Icy-MetaData: 1`,
`redirect: follow`, 45 s connect timeout → pass through status
(200/206), Content-Type (params stripped), `Cache-Control: no-store`, CORS
`*`. The Worker returns the upstream Response object so the body streams
through the edge without per-chunk JS work.

Deployed-Worker verification checklist (status, content-type, streaming,
Range, redirects, headers, long-running playback, reconnect, CPU) is in
docs/TESTING.md — **PENDING until deployed** (this sandbox has no outbound
internet; that is not evidence about Cloudflare's behavior).

## 6. Bugs found during the port (fixed in the Worker, reported honestly)

1. **Web session cookie never authenticated (server.js:218 vs 87–95).**
   `setSessionCookie()` stores the raw sid, but `readSession()` →
   `sessionFromToken()` requires `sid.signature` (HMAC). So web cookie auth
   could never resolve a session — on Render this was masked by the
   ephemeral-FS bug (both produce "logged out"); on any persistent host it
   would have surfaced. Present in v82 AND v83.1. **Worker fix:** the cookie
   carries the full signed token. Native Bearer path is unchanged
   (it always used the full token). The Render repo is untouched (per your
   constraint); this is a documented migration-time fix.
2. `moodsForCountry` has `.slice(0, 12)` after dedupe (port honors it).
3. `cached()` unbounded in server.js → size-capped (500) in the Worker
   (isolate memory safety); semantics identical.

## 7. Mobile (Android + iOS) — now included in this repository

The final Cloudflare repository contains the **complete mobile projects**
(`android/`, `ios/`, `capacitor.config.ts`) — they are no longer
"unchanged elsewhere":

- **Android** — Capacitor 8 app (`app.muchi.music`). Audio plays in the
  WebView; `capacitor-music-controls-plugin` v8 provides the media
  notification, MediaSession and lock-screen/media-button controls
  (driven from `public/app.js` via `P.MusicControls`). The optional
  `MuchiAudio` Media3/ExoPlayer background service that `nativePlayTrack()`
  targets is **NOT shipped in this repository** — `nativePlayer()` returns
  null and the WebView path is used; the bridge keeps the plugin interface
  so the service can be added later without web changes. The v8
  `.longValue()` duration fix is present in the plugin
  (`MusicControlsInfos.java:50` parses duration as `long`) — pinned in
  `package-lock.json`. Release signing is env/secret-driven
  (`MUCHI_KEYSTORE_FILE/PASSWORD/ALIAS`), never in the repo.
- **iOS** — Capacitor 8 app; `UIBackgroundModes: audio`, WebKit media
  session (Now Playing / lock-screen / remote controls), `muchi://` URL
  scheme registered in `Info.plist`, `export-options.plist` for unsigned
  archives.
- **Deep-link auth (fixed in this package):** the native OAuth flow already
  redirected to `muchi://auth/success?token=…`, but the scheme was not
  registered on either platform — native sign-in could not complete. This
  package adds the Android `<intent-filter android:scheme="muchi">` and the
  iOS `CFBundleURLSchemes = [muchi]` entry. (Apply the same two additions
  to the Render repo's mobile projects if you keep building APKs there.)
- **API base:** single configuration constant
  `MUCHI_API_BASE_FALLBACK` in `public/app.js` (see docs/API-CONFIG.md).
  Web is same-origin automatically; native uses the constant — Render
  until cutover, then the production Worker URL (one line).


## 8. Status

- ✅ Complete backend port (23/23 route groups), local unit tests
- ✅ D1 schema, KV usage, SSRF, CORS, cookies, static assets
- ✅ GitHub Actions pipeline (test → migrate → deploy → smoke)
- ✅ Two-pass verification (AUDIT.md)
- ⏳ Deployed-Worker live tests — PENDING (needs your Cloudflare account +
  internet; run docs/TESTING.md)
- ⏳ Google OAuth full chain on the deployed Worker — PENDING (the flow is
  implemented and locally shape-tested, but "working" only counts after the
  real chain: Google login → callback → MUCHI session → Settings account →
  YouTube authorization → real Liked Songs/Playlists)
- ⏳ Production cutover — later (docs/CUTOVER.md)

## 9. Remaining blockers

1. Sandbox has no outbound internet → no live Google/YouTube/Audius/Radio
   Browser calls possible here; `wrangler deploy` needs your machine or CI.
2. `wrangler.toml` has `REPLACE_ME_*` ids until `npm run setup` runs.
3. Google Console needs the staging redirect URI added (production Render
   URIs stay).
4. Free-plan CPU verification for cold heavy requests (dashboard) — if it
   exceeds 10 ms, apply the per-source KV decomposition (plan Phase 8).

## 10. Rollback

- `npx wrangler rollback` / dashboard Deployments → Rollback.
- Render fully live and untouched the whole time; old APKs keep working.
- D1 migrations are additive-only.

## 11. Cutover (NOT now — checklist for later)

1. All TESTING.md items PASS on staging.
2. Add production Worker callback to Google Console (keep Render's).
3. Deploy production Worker; run TESTING.md against it.
4. Repoint mobile apps to the production Worker URL (the one-liner).
5. Monitor a soak period; keep Render as fallback.
6. Only then consider disabling Render.

## 12. Real-internet test status

Everything network-dependent is **PENDING** until the Worker is deployed;
`docs/TESTING.md` lists each test with exact expected results so the
post-deploy audit is mechanical.
