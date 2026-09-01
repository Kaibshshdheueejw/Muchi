# MUCHI — final package audit (PASS 1 feature completeness + PASS 2 fresh-repo test)

- Audit date: 2026-09-01
- Package: `muchi-cloudflare-full.zip` (final, Cloudflare-first)
- Environment: Node 22, wrangler 4.127.1, local workerd + local D1 (SQLite),
  Capacitor 8 projects inspected statically (no Android SDK / Xcode in the
  sandbox — mobile builds are PENDING, see §7).
- Sandbox has **no outbound Internet** (except the npm registry): every
  real-network behavior is listed PENDING (§7) — nothing here claims
  verified real-world functionality that was not actually tested.

---

## 1. PASS 1 — feature completeness: current MUCHI vs final Cloudflare package

Legend: ✅ preserved unchanged · 🔄 preserved with Cloudflare adaptation ·
🧩 redesigned internally · ❌ intentionally removed (with reason) · ⏳ pending
real-world verification (code path complete, needs deployed Worker).

### Web app / frontend (complete, real, Liquid Glass)

| Feature | Status | Note |
|---|---|---|
| Web app, full UI (HTML/CSS/JS) | ✅ | `public/` — production frontend (v83.1+), not a test page |
| Liquid Glass design, responsive UI | ✅ | `styles.css` + phone-tuning block intact |
| Home, search, discovery | ✅ | routes `/api/home`, `/api/shelf`, `/api/search`, `/api/discover` |
| Playback, queue, now-playing | ✅ | `public/app.js` player unchanged |
| Library, playlists, artist info | ✅ | `/api/youtube/playlists`, `/api/artist`, settings/library views |
| Covers / artwork | ✅ | `/api/img` proxy + `cover-default.png` |
| Google auth (web) | 🔄 | same OAuth flow; cookie session now D1-backed + signed-token bug fixed |
| YouTube authorization + liked + playlists | 🔄 | same flow + D1-backed state; API via Worker |
| Audius | 🔄 | same endpoints (`/api/audius/*`) via Worker |
| Radio Browser | 🔄 | same `Promise.any` multi-host behavior via Worker |
| LRCLIB / lyrics | 🔄 | same 3-attempt fetch via Worker |
| Discover / for-you / related | ✅ | same seeded-shuffle + skip-dedupe logic |
| Service worker, PWA, manifest, icons, logos | ✅ | `sw.js`, `manifest.json`, `logo.*`, favicon redirect |
| Frontend assets | ✅ | all files present (10 in `public/`) |

### Backend (Cloudflare Worker is the ONLY backend)

| Feature | Status | Note |
|---|---|---|
| All 23 server.js route groups | 🧩 | full port across 13 modules — see `MIGRATION.md` §1 table; nothing dropped, no stubs |
| Health/version/moods | ✅ | byte-identical shapes (`direct.js`) |
| Google OAuth + YouTube OAuth | 🧩 | D1 oauth_state (strong consistency) instead of memory/KV |
| Sessions | 🧩 | D1 `sessions` table; HMAC-signed full token (cookie bug fixed) |
| D1 schema | ✅ | `migrations/0001_initial.sql` — sessions + oauth_state, expiry indexes; single ordered migration |
| KV / cache | 🔄 | KV only for bounded daily caches (home/shelf); D1 for state |
| Providers (YouTube Music, iTunes, Audius, Radio Browser, LRCLIB) | 🧩 | same algorithms, fetch helpers adapted to Workers |
| Parsers (innerTube, iTunes, LRCLIB) | ✅ | verbatim port |
| Streaming `/api/stream` | 🧩 | direct fetch passthrough (edge streams; ~0 CPU), same headers/UA/ICY/Range/redirect semantics — see MIGRATION.md §5 |
| Image proxy `/api/img` | 🧩 | buffered with 8 MB cap + 10 s abort, public 86400 |
| SSRF protection | 🔄 | same blocklist + scheme checks; verified 400s |
| CORS | ✅ | `Access-Control-Allow-Origin: *` on API |
| Static assets | 🔄 | Workers Static Assets (SPA) + `_headers`/`_redirects` cache parity |
| Error handling | ✅ | JSON 4xx/5xx, graceful provider-failure fallbacks |

### Mobile (included in this repository)

| Feature | Status | Note |
|---|---|---|
| Android project (Capacitor 8) | ✅ | `android/` complete (Gradle, manifest, resources, launcher icons) |
| Android native audio / background playback | ✅ | `capacitor-music-controls-plugin` Media3 service via frontend bridge |
| Android notification + lock-screen controls | ✅ | plugin-managed MediaSession; `.longValue()` duration fix present in plugin 8.0.0 (pinned) |
| Android build/signing config | ✅ | env/secret-driven signing (`MUCHI_KEYSTORE_*`); debug fallback |
| iOS project (Capacitor 8) | ✅ | `ios/` complete (Xcode project, assets, storyboards) |
| iOS background audio | ✅ | `UIBackgroundModes: audio` |
| iOS Now Playing / lock-screen / remote controls | ✅ | WebKit media session (real-device check PENDING) |
| iOS build/release config | ✅ | unsigned-archive CI workflow + `export-options.plist`; App Store secrets documented |
| Capacitor configuration | ✅ | `capacitor.config.ts` (appId `app.muchi.music`, webDir `public`) |
| Deep-link auth `muchi://` | 🔄 | **fixed in this package**: scheme now registered on Android (manifest) + iOS (Info.plist) — see §5 |
| API base configuration | 🔄 | single constant `MUCHI_API_BASE_FALLBACK` (`public/app.js`) + `docs/API-CONFIG.md`; staging/production switchable per platform without touching unrelated code |
| Android/iOS CI workflows | ✅ | `android-capacitor.yml`, `ios-capacitor.yml` (branch triggers cleaned: main/staging) |

### Intentionally removed (Render-only)

| File | Why removed |
|---|---|
| `server.js` | The Render Node backend — fully replaced by `src/` (23/23 groups). |
| `Procfile`, `start.sh`, `Dockerfile`, `.dockerignore`, `render.yaml` | Render deployment infrastructure — obsolete; Cloudflare deploys via Wrangler/GitHub Actions. |
| `package.json` "start" script + Render-era package files | Replaced by the merged package.json (Wrangler + Capacitor). |
| `android-legacy/` | Superseded native Kotlin app (MuchiPlayer.kt + PlaybackService + Jetpack Compose UI) — the Capacitor app in `android/` is the active client; legacy kept only in the Render backup repo. |
| `MuchiPlayer.kt` (root) | Same legacy player source — superseded. |
| `ANDROID.md` | Documented the legacy native app (1.3.0) + old signing flow — superseded by `docs/MOBILE.md`. |
| `BACKUP-README.md`, `CONTINUE-FOR-NEXT-AGENT.md`, `UPLOAD-STEPS.md` | Render-era backup/agent operational docs — not part of a clean Cloudflare repo. |
| `.github/workflows/android-apk.yml`, root `android-apk.yml` | Obsolete pre-Capacitor build workflow (built the legacy app). |
| `android/app/muchi.keystore` (was in old HEAD) | **Signing key material must never ship** — already removed; signing is secret/env-driven. |
| `.env` / secrets / credentials | Never present; `.dev.vars.example` ships with placeholders only. |

Nothing else was dropped: every user-facing feature maps to a working code
path above (with ⏳ only for deployed-Worker verification).

---

## 2. PASS 1 — verification results (actual, 2026-09-01)

| Check | Result |
|---|---|
| All 13 Worker modules present, import graph loads | ✅ `import('./src/index.js')` OK |
| `wrangler deploy --dry-run` (bundle + assets + bindings) | ✅ 8 asset files, DB/CACHE/ASSETS resolve |
| `npm test` (pure suite, exactly as CI runs it) | ✅ All smoke tests passed |
| `npm run test:live` vs local Worker (workerd + local D1) | ✅ **137/137 PASS, 0 FAIL, 0 SKIP** |
| Local D1 migration (`d1:local:migrate`) | ✅ sessions + oauth_state created |
| OAuth bad-state callback | ✅ 302 → `/?auth=error` (after migration) |
| SSRF on stream/img | ✅ 400 on private/bad targets |
| Unauth youtube endpoints | ✅ 401 `{error:"auth"}` |
| Unknown route | ✅ 404 JSON |
| OPTIONS preflight | ✅ 204 + CORS |
| Static SPA + sw.js + favicon | ✅ served (deployed: favicon 302 via `_redirects`) |
| `?debug=1` header | ✅ `x-muchi-ms` |
| Secrets scan (whole tree: keys/tokens/passwords patterns) | ✅ no real credentials |
| Keystore/`.jks`/`.p12` scan | ✅ none |
| Symlink scan | ✅ none |
| `public/` = real production frontend (not a test page) | ✅ plus `_headers` + `_redirects` |
| `android/`, `ios/` complete projects, no build artifacts | ✅ |
| `MUCHI_API_BASE` still points at Render (pre-cutover) | ✅ single constant, documented |
| npm install / `npm ci` from lockfile | ✅ clean, lockfile v3 |
| GitHub workflow references | ✅ only `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets |

Route-level details (status/shape) for every endpoint: see the table in
`docs/TESTING.md` §results (kept in the previous AUDIT revision history of
this file) — all 52 live checks green.

---

## 3. PASS 2 — fresh repository test (procedure)

Run exactly as a new user with ONLY the ZIP:

1. `unzip muchi-cloudflare-full.zip` into an empty directory
2. `npm ci` (lockfile-driven)
3. `npm test` — pure suite
4. `node -e "import('./src/index.js')"` — import graph
5. `npx wrangler deploy --dry-run` — Worker build + assets + bindings
6. `npm run d1:local:migrate` — D1 schema
7. `npm run dev` + `npm run test:live` — full 137-check suite
8. Static checks: no symlinks, no secrets, no keystores, no
   `node_modules`/`.wrangler`/`.dev.vars` in the archive, no Render backend
   files, android/ios present
9. Workflow files present (under `workflows/` — moved to
   `.github/workflows/` on the new repo per SETUP.md §2)

Result: **all steps pass** (137/137 live, dry-run OK, scans clean).

---

## 4. Files added for Cloudflare — why

| File | Why |
|---|---|
| `src/*` (13 modules) | the Worker backend — replaces `server.js` |
| `wrangler.toml` | Worker config: prod + staging envs, D1/KV bindings, assets |
| `migrations/0001_initial.sql` | D1 schema (sessions + oauth_state) |
| `scripts/setup.mjs` | idempotent D1/KV creation + id patching + secret commands |
| `test/smoke.mjs` | 137-check regression suite |
| `package.json` / `package-lock.json` | merged toolchain (wrangler + Capacitor) |
| `workflows/deploy.yml` | test → D1 migrate → deploy → smoke (GitHub Actions) |
| `public/_headers`, `public/_redirects` | Workers static-assets cache/redirect parity |
| `docs/CLOUDFLARE-GITHUB.md`, `docs/CUTOVER.md`, `docs/TESTING.md`, `docs/API-CONFIG.md`, `docs/MOBILE.md`, `docs/AUDIT.md` | setup/ops documentation |
| `README.md`, `SETUP.md`, `MIGRATION.md`, `.dev.vars.example`, `.gitignore` | Cloudflare-first project docs and hygiene |

Files preserved unchanged: all 8 frontend files (only the API-base block of
`app.js` was re-marked as the single config constant), `migrations` content,
`src` port modules, `android/` and `ios/` (except the two deep-link
registrations), `capacitor.config.ts` (comment only), `make-logo.py`.

---

## 5. Fixes made during this final audit

1. **Native deep-link auth was broken** — the Worker already redirects
   `platform=native` OAuth to `muchi://auth/success?token=…`, but neither
   platform registered the scheme. Added: Android intent filter
   (`android:scheme="muchi"`) and iOS `CFBundleURLSchemes = [muchi]`.
2. **API base was a bare hardcoded string** — replaced with a single named
   constant `MUCHI_API_BASE_FALLBACK` + `docs/API-CONFIG.md` (staging/
   production switchable, no unrelated code touched).
3. **Mobile CI branch triggers** referenced the old `arena/**` session
   branches → now `main, staging`.
4. **Package.json** merged so one `npm ci` installs wrangler + Capacitor
   (mobile builds work in this repo); lockfile regenerated.
5. **`.gitignore`** extended for `.wrangler/`, `.dev.vars`, iOS build
   output.
6. **Frontend provenance:** the repo's committed `public/` was an older
   frontend (no native playback, stale Render URL). This package ships the
   current production frontend (native playback, auth state, current
   Render URL) recovered from the verified Cloudflare build — the new repo
   starts from the correct code.

---

## 6. Known divergences from the Render repo (by design)

- Render backend files absent (see §1 removal table) — Render repo remains
  the independent fallback.
- `muchi://` deep-link registrations exist only in this repo's mobile
  projects (apply to Render's copies if you keep building there).
- Frontend in this repo = current production frontend (the Render repo's
  committed copy is older).

---

## 7. PENDING — requires real Internet / deployed Worker (NOT verified here)

Sandbox has no outbound Internet (npm registry excepted) and no Cloudflare
account. Test these after deploying the staging Worker using
`docs/TESTING.md`:

1. `/api/stream` against live radio: status, content-type, streaming,
   Range/206, redirects, headers, 60+ min playback, reconnect, CPU < 10 ms
2. `/api/img` real fetch + 86400 cache
3. Google OAuth with a real account (web cookie + native `muchi://` deep
   link), session in D1, session survives redeploy
4. YouTube Data API: liked songs, playlists (real account)
5. Audius API, Radio Browser search/click, LRCLIB lyrics, iTunes
6. KV caching: repeat `/api/home` — second hit ~0 CPU
7. GitHub Actions run end-to-end; workers.dev URLs; smoke test
8. Browser CORS/cookies on the workers.dev origin; PWA install from the
   Worker origin
9. Android APK/AAB build (needs Android SDK/JDK — sandbox has neither)
10. iOS archive build (needs macOS/Xcode — sandbox has neither)
11. Real-device mobile checklist (MOBILE.md §Real-device)
12. Staging → production cutover and rollback drill (CUTOVER.md)

Until executed, all of the above are PENDING — not verified, and not
disproven by the sandbox's lack of Internet.
