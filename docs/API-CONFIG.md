# MUCHI — API base configuration (the single place to point MUCHI at an API)

MUCHI's backend URL is configurable per platform with **no code changes
anywhere else**. There is exactly ONE configuration point per platform.

## Web (browser / PWA)

The Cloudflare Worker serves the app, so the web app talks to **the same
origin that served it** — nothing to configure:

```js
// public/app.js — API_BASE is "" (same origin) for the web by default
const API_BASE = String(window.MUCHI_API_BASE || "").trim().replace(/\/+$/, "");
```

If you ever need an explicit URL (e.g. during staged testing), inject
`window.MUCHI_API_BASE` before `app.js` loads (the Worker or your test page
can set it; the value is read at startup).

## Native (Android + iOS Capacitor apps)

The native WebView has no origin, so the app must call an **absolute** URL.
There is a single named constant in the frontend:

```js
// public/app.js — THE one line to change for native apps
const MUCHI_API_BASE_FALLBACK = "https://muchi.twiarimascord.workers.dev";
```

| Environment | Value to use |
|---|---|
| Production Worker (current default, since the cutover) | `"https://muchi.twiarimascord.workers.dev"` |
| Staging Worker | `"https://muchi-staging.<account>.workers.dev"` |

> The old Render backend (`muchi-music.onrender.com`) is intentionally left
> running for already-installed pre-cutover APKs only. No new build may use
> it. See docs/CUTOVER.md for the rollback plan.

To test native apps against the staging Worker, set the constant to the
staging URL, run `npm run mobile:sync` (or `cap sync android && cap sync
ios`), and rebuild the app. The same constant is used by both platforms —
one line, no other code touched.

> The server also accepts `window.MUCHI_API_BASE` as an override
> (e.g. injected by a test harness); the fallback constant is only used when
> nothing is injected.

## Auth flow (why the deep link matters)

Native sign-in:

1. Settings → Sign in → the app calls
   `/api/auth/google/url?platform=native` and opens the URL in the system
   browser (`window.open(url, "_system")`).
2. Google authorizes; the Worker redirects to
   `muchi://auth/success?token=…` (or `muchi://youtube/success` /
   `muchi://auth/error`).
3. The OS hands the URL back to the app (Android intent filter
   `android:scheme="muchi"` in `AndroidManifest.xml`; iOS
   `CFBundleURLSchemes = [muchi]` in `Info.plist`).
4. Capacitor emits `appUrlOpen`; `handleAuthDeepLink()` stores the token in
   localStorage and all future API calls send `Authorization: Bearer …`.

Web sign-in uses the same flow with `/?auth=success` redirects and the
httpOnly `muchi_sid` cookie instead.

## Cutover checklist (later, only after staging passes)

- [ ] Set `MUCHI_API_BASE_FALLBACK` to the production Worker URL
- [ ] `npm run mobile:sync:android && npm run mobile:sync:ios`
- [ ] Rebuild Android APK/AAB (`android-capacitor.yml`) and iOS archive
      (`ios-capacitor.yml`)
- [ ] Google Cloud Console: keep Render + Worker redirect URIs; the
      `muchi://` scheme needs **no** Console entry (custom scheme is
      handled by the OS)
