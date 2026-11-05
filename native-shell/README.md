# Filtered native WebView bundle

The Android and iOS app shells use the filtered entry files in this directory for their shared WebView UI/runtime:

- `android/public/index.html`, `app.js`, `styles.css`
- `ios/public/index.html`, `app.js`, `styles.css`

These entry files are intentionally separate from the browser/PWA files in `public/`. The browser files contain Web-only surfaces such as ambient lighting, Web View Transitions, and desktop download/motion UI. Approved native Home surfaces, including Smart Mood Mix, are implemented explicitly in these filtered entries rather than copied wholesale from the browser bundle.

The native Home bar intentionally has no Home search field. It does include the selectively approved notification control beside the profile button, including the local unread drawer, reduced-motion-safe open/close animation, and the profile blink-free open/close behavior.

`scripts/sync-native-bundle.mjs` copies only the reviewed shared-asset allowlist from `public/`, preserves the generated Cordova bridge files, rejects unapproved Web-only markers, stages and verifies each platform, and atomically installs the result for both platforms.

Run a non-mutating check with:

```sh
node scripts/sync-native-bundle.mjs --check
```

Run the approved sync with:

```sh
node scripts/sync-native-bundle.mjs
```

Changes to the filtered entry files require a separate native-UI approval and regression run. The native cache/playback implementation remains in the Android/iOS source and is not rewritten by this script.
