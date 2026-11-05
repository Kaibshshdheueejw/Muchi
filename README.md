# MUCHI — Cloudflare-native music app

MUCHI is a YouTube-Music-style player with official YouTube playback,
Audius independent artists, and live radio — **designed for and deployed on
Cloudflare Workers** (backend) + Cloudflare D1 (sessions/OAuth state) + KV
(caches), serving the complete Liquid Glass PWA and the Capacitor
Android/iOS apps.

This repository is the **authoritative, Cloudflare-first** MUCHI project:
the Worker is the only backend. The former Render deployment
(`muchi-music.onrender.com`) is a separate, independent fallback — it is not
part of this repository.

## What's inside

```
src/                       Cloudflare Worker backend (all 23 route groups)
  index.js                 Worker entry + router + OPTIONS + debug + assets
  direct.js                /api/health, /api/version, /api/moods
  oauth.js                 Google sign-in, YouTube auth, sessions (D1)
  aggregate.js             home, shelf, search, discover, for-you, related,
                           artist, radio, lyrics, yt/playlist
  stream.js                /api/stream, /api/img, /api/audius/*
  providers.js             YouTube Music, iTunes, Audius, Radio Browser, LRCLIB
  parse.js                 YouTube innerTube response parsers (verbatim port)
  data.js                  moods/shelves/charts tables (verbatim port)
  db.js                    D1 sessions + oauth_state, expiry sweep
  ssrf.js                  SSRF guard (IPv4/IPv6 blocklist)
  auth.js, util.js, config.js   HMAC tokens, caches, env config
migrations/0001_initial.sql     D1 schema (sessions + oauth_state)
public/                    The complete MUCHI web app (Liquid Glass PWA)
android/                   Capacitor Android app (WebView audio + media notification/lock-screen controls)
ios/                       Capacitor iOS app (background audio, lock screen)
capacitor.config.ts        Shared Capacitor config (webDir: public)
.github/workflows/         GitHub Actions:
  deploy.yml               test → D1 migrate → deploy → smoke (Cloudflare)
  android-capacitor.yml    Android APK/AAB build + signing
  ios-capacitor.yml        iOS archive build
scripts/setup.mjs          Creates D1 + KV, patches wrangler.toml, prints secrets
test/smoke.mjs             137-check suite (pure + live-worker)
wrangler.toml              Worker config (prod + staging envs)
docs/                      Setup, migration, testing, cutover, API config, audit
```

## Quickstart (local)

```bash
npm ci
npm run dev                  # local Node adapter: http://localhost:3000
npm test                     # offline smoke and focused integration checks
# Optional live checks require a running service and reachable upstreams:
npm run test:live            # targets http://127.0.0.1:3000
# For the Cloudflare Worker and D1 setup, follow SETUP.md / docs/TESTING.md.
```

## Deploy (summary — full steps in SETUP.md / docs/CUTOVER.md)

1. Create the new GitHub repository and push this project.
2. Cloudflare: create an API token (Workers/R2/KV/D1 Edit + Account Settings
   Read); add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` as the only
   GitHub secrets.
3. `npm run setup` — creates D1 `muchi` + `muchi-staging`, KV
   `muchi-cache` + `muchi-staging-cache`, patches `wrangler.toml`.
4. `npx wrangler secret put GOOGLE_CLIENT_ID` (+ SECRET, REDIRECT_URI,
   MUCHI_SESSION_SECRET) — secrets live only in Cloudflare, never in Git.
5. Push a branch → the workflow deploys the **staging** Worker
   (`muchi-staging.<account>.workers.dev`); merge to `main` for
   **production** (`muchi.<account>.workers.dev`).

## Mobile

`android/` and `ios/` are standard Capacitor projects. Their filtered UI entry
files live in `native-shell/`; `npm run native:sync` updates the native bundles
and `npm run native:check` verifies them. If Capacitor's `npm run mobile:sync`
is needed, run `npm run native:sync` afterward to restore the filtered entries.
Native features: background
playback (Android Media3 service via `capacitor-music-controls-plugin` +
WebKit media session on iOS), lock-screen/notification controls,
`muchi://` deep-link OAuth. The single API configuration point is
`MUCHI_API_BASE_FALLBACK` in `public/app.js` — see `docs/API-CONFIG.md`.

## Documentation

| Doc | Purpose |
|---|---|
| `SETUP.md` | Full first-time setup (GitHub, Cloudflare, D1, KV, secrets, deploy) |
| `docs/CUTOVER.md` | Staging → production → rollback procedure |
| `docs/API-CONFIG.md` | The one API-base config point per platform |
| `docs/TESTING.md` | Deployed-Worker test checklist (real-internet items) |
| `docs/MOBILE.md` | Android/iOS build, auth, background audio, real-device tests |
| `docs/CLOUDFLARE-GITHUB.md` | GitHub↔Cloudflare connection research + decisions |
| `docs/AUDIT.md` | Final two-pass audit: features, tests, removals, PENDING items |
| `MIGRATION.md` | Render→Cloudflare port details (route table, decisions) |

## Muchi 1.10.2 integration

The release metadata is synchronized across the Web, Android, and iOS projects.
The native WebView entry files are maintained in `native-shell/`; run
`npm run native:sync` to update packaged assets and `npm run native:check` to verify them.
Authentication and administration fail closed without deployment configuration:

- Supply a strong `MUCHI_SESSION_SECRET` of at least 32 characters and the
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` values
  required for OAuth. Do not reuse the session secret for another purpose.
- Configure `ADMIN_EMAILS` for verified session administrators, or supply
  `MUCHI_ADMIN_KEY` (the legacy `ADMIN_KEY` alias is also supported) for API
  administration. A previously stored admin role alone no longer grants access.
- Configure a dedicated `WEBHOOK_SECRET`, `GITHUB_WEBHOOK_SECRET`, or
  `MUCHI_WEBHOOK_SECRET`; webhooks return 503 when none is configured.

The Node adapter may create `.muchi-cloud-db.json` for local sessions and
library data. Treat it as private, back it up only in an appropriate secure
location, and never commit it, credentials, or signing material. A fresh
installation does not seed a signed-in user or an administrator.
