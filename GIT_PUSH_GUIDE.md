# MUCHI — Release v1.5.2 Push Guide (Windows Git Bash)

**Target:** push v1.5.2 to `main` (auto-deploys the Worker) and tag `v1.5.2`
(publishes the production-signed APK release). **No debug/demo build.**

---

## The two things that went wrong last time

1. **You ran `git` from your home folder (`~`), not the repo.** Your prompt
   was `Mochi@Water MINGW64 ~`. The repo clone is `~/Muchi`. Always `cd` into
   it first.
2. **The patch file is not on your machine.** It lives in the Arena workspace
   (the sandbox), which is a *different* computer. `git apply` looks for the
   file on **your** disk, so you must download the patch into `~/Muchi` first.

---

## STEP 0 — Set your GitHub Secrets FIRST (or the release is blocked)

The release workflow **hard-fails** if the release keystore is not set (this is
deliberate, so a debug-signed APK can never be published as "the release").
Open GitHub → your repo → **Settings → Secrets and variables → Actions**, and
add these if they are not already there:

| Secret | Value |
|--------|-------|
| `MUCHI_KEYSTORE_B64` | base64 of your **production** `.jks` / `.p12` |
| `MUCHI_KEYSTORE_PASSWORD` | keystore password |
| `MUCHI_KEYSTORE_ALIAS` | key alias (defaults to `muchi`) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare token (for the Worker deploy) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id |
| `GOOGLE_CLIENT_ID` | (set in Worker, see below) |
| `GOOGLE_CLIENT_SECRET` | (set in Worker, see below) |
| `GOOGLE_REDIRECT_URI` | (set in Worker, see below) |
| `MUCHI_SESSION_SECRET` | (set in Worker, see below) |

> The `GOOGLE_*` / `MUCHI_SESSION_SECRET` are Worker runtime secrets — if your
> Worker deploy uses `wrangler secret put`, run those on your own machine:
> `npx wrangler secret put GOOGLE_CLIENT_ID` etc. The GitHub Actions secrets
> above are what `deploy.yml` / `release.yml` read directly.

If `MUCHI_KEYSTORE_B64` is missing, `release.yml` stops with "release signing
keystore not configured" — that is intended. Set it and re-trigger.

---

## STEP 1 — Go into the repo and sync

One command at a time. Run **this first**:

```bash
cd ~/Muchi
```

Confirm you are in the repo (this must print a path, not an error):

```bash
git rev-parse --show-toplevel
```

If that prints `fatal: not a git repository`, your clone is named differently.
Find it with `ls ~` and `cd` into the folder that has a `.git` directory.

Then sync `main`:

```bash
git checkout main
git pull origin main
```

---

## STEP 2 — Get the patch onto your machine

The patch is **not** on your disk, so download it from the Arena file viewer
(the file `MUCHI-V1.5.2-ALL-FIXES.patch` is open in your viewer):
click the **download** button and save it **as `MUCHI-V1.5.2-ALL-FIXES.patch`
inside `~/Muchi`**. It must sit in the same folder where you run `git apply`.

Then verify it is there:

```bash
ls -la MUCHI-V1.5.2-ALL-FIXES.patch
```

You should see a file of about **90 KB**. If the download saved it elsewhere,
`mv` it into `~/Muchi`. Its sha256 checksum is
`647600014c761c8e60ca5b4ade9f3ed33b493812f9b7b2d98f2998b3da554598`.

> Verify the checksum with:
> ```bash
> sha256sum MUCHI-V1.5.2-ALL-FIXES.patch
> ```
> It must print `647600014c761c8e60ca5b4ade9f3ed33b493812f9b7b2d98f2998b3da554598`.
> If it differs, the download was truncated or you grabbed an older copy —
> re-download from the viewer before continuing.

> `MUCHI-V1.5.2-ALL-FIXES.patch` is the full patch that applies to clean
> `origin/main` by itself — use this one. The older/V1.5.1 incremental patches
> have been removed to avoid confusion; this is the only patch you need.

---

## STEP 3 — Dry-run, then apply the patch

```bash
git apply --check MUCHI-V1.5.2-ALL-FIXES.patch
```

If that prints nothing (exit 0), apply it:

```bash
git apply MUCHI-V1.5.2-ALL-FIXES.patch
```

If the `--check` prints errors, stop and paste them to me — do not force it.

---

## STEP 4 — Verify the version is 1.5.2 everywhere

The version lives in **six** places. Run all of them:

```bash
grep '"version"' package.json
sed -n '3p' package-lock.json
grep 'APP_VERSION' src/config.js
grep 'const APP_VERSION' public/app.js
grep -E 'versionCode|versionName' android/app/build.gradle
grep -E 'CURRENT_PROJECT_VERSION|MARKETING_VERSION' ios/App/App.xcodeproj/project.pbxproj
```

Expected output:
- `"version": "1.5.2"` (package.json)
- `"version": "1.5.2"` (package-lock.json)
- `APP_VERSION = "1.5.2"` (src/config.js)
- `const APP_VERSION = "1.5.2"` (public/app.js)
- `versionCode 7` / `versionName "1.5.2"`
- `CURRENT_PROJECT_VERSION = 5` / `MARKETING_VERSION = 1.5.2`

> **`public/app.js` is the served web client.** It was a bug that this file
> stayed at `1.5.1` while everything else bumped — the app would have shown
> "Installed 1.5.1" and offered a spurious 1.5.2 update forever. The patch now
> bumps it to 1.5.2, and the release guard is updated to check it (plus
> `package-lock.json`), so this can't silently regress. If `public/app.js`
> still says `1.5.1` after applying, the patch did not fully apply — re-check.

---

## STEP 5 — Run the release guard + tests (your safety net)

```bash
npm ci
node scripts/check-release.mjs
```

The guard must print `✓ release checks passed.` and exit 0. It now checks the
version is synced across **package.json, package-lock.json, src/config.js,
public/app.js, android build.gradle and the iOS pbxproj**, plus the Android
`versionCode` is `> 1` and the iOS build number is `> 1`. If it prints
version-sync or code errors, fix them before pushing.

> Without `--assert-release` (plain `node scripts/check-release.mjs`) a missing
> keystore is only a warning, so this is safe to run locally before you've set
> secrets. In CI the same script is called with `--assert-release` on the tag
> build, which hard-fails if `MUCHI_KEYSTORE_B64` is missing.

Then run the smoke tests:

```bash
npm test
```

This runs the pure (offline) test layer — including a real-file regression
that reads `package.json`, `package-lock.json`, `src/config.js` and
`public/app.js` and asserts all four report the same version. Look for
"All smoke tests passed." (If `npm test` also wants the live worker layer, start
`npm run dev` in a second terminal first — but the pure layer is what matters
for verifying the patch applied cleanly.)

---

## STEP 6 — Commit and push to `main` (this deploys the Worker)

```bash
git add -A
git commit -m "release(v1.5.2): bump all version strings, guards, patches"
git push origin main
```

`deploy.yml` runs on any push to `main` and deploys the **production Worker**.
After this, `/api/version` returns `1.5.2`.

---

## STEP 7 — Tag the release (this publishes the production APK)

```bash
git tag -a v1.5.2 -m "v1.5.2: production release"
git push origin v1.5.2
```

`release.yml` triggers on the `v*` tag, runs the Android build with the
production keystore (fails if `MUCHI_KEYSTORE_B64` is missing), and publishes
a GitHub Release with `Muchi.apk`. The in-app updater reads
`releases/latest/download/Muchi.apk`, which now points to this release.

---

## STEP 8 — Verify

- Watch CI: `gh run list --limit 6` (or GitHub → Actions).
- Worker: confirm `/api/version` returns `{"version":"1.5.2"}`.
- In the app: Settings → About shows **Installed 1.5.2 / Latest 1.5.2 / Up to date**.
- On an older build the updater offers **1.5.2** → updates in place (library kept,
  because signing key + `versionCode 7` now match).

---

## Golden rules

- Run every `git` command **inside `~/Muchi`** (where `.git` is), not in `~`.
- The patch file must be in `~/Muchi` when you run `git apply`.
- Never `git push --force` on `main` or `release/*`.
- `v1.5.2` tag must match the version strings exactly.
- After any push, check the Actions tab.

## Files (in the Arena workspace `/home/user/Muchi/`)
- `MUCHI-V1.5.2-ALL-FIXES.patch` — the only patch you need; applies to clean `origin/main` → 1.5.2.
- `GIT_PUSH_GUIDE.md` — this guide.

> The older/V1.5.1 incremental patches were removed so there is exactly one
> patch to apply. Do not apply any other patch file.
