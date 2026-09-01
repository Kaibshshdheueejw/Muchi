# MUCHI Cloudflare — SETUP (exact steps)

Follow these in order. Everything below is also runnable from this folder on
Windows (Git Bash / PowerShell) or macOS/Linux with Node 18+ installed.

---

## 1. Create the new GitHub repository

1. Go to https://github.com/new
2. Repository name: `muchi-cloudflare` (or any name you like)
3. Visibility: **Private** or **Public** (your choice; public is fine — there
   are **no secrets in this repository** by design)
4. Do NOT check "Add a README" / ".gitignore" / "license" (avoid conflicts).
5. Click **Create repository**.

## 2. Upload the ZIP contents

> **Note (done already):** this project started life as a ZIP upload whose
> GitHub App couldn't push `.github/workflows/`, so the workflow files were
> moved into `.github/workflows/` in commit `7319b26`. The current repo
> already has them in the right place — no move needed.

Option A (recommended, keeps history):
```bash
# on your machine, in a folder that contains this project:
git init
git add -A
git commit -m "MUCHI Cloudflare — complete backend port"
git branch -M main
git remote add origin https://github.com/<you>/muchi-cloudflare.git
git push -u origin main
```

Option B (GitHub web UI): unzip the archive → open the `muchi-cloudflare/`
folder → select ALL files (Ctrl+A) → drag them into the repository's
"uploading an existing file" page → Commit changes → then run the `mkdir` /
`mv` steps above in the web UI (or use the git CLI once).

> Double-extraction trap: if the ZIP extracts to a folder *inside another
> folder* (e.g. `muchi-cloudflare/muchi-cloudflare/`), open the inner folder
> and upload **its contents**.

## 3. Cloudflare account prep

1. Create a Cloudflare account at https://dash.cloudflare.com/sign-up (Free
   plan is enough).
2. Claim your `workers.dev` subdomain (dashboard → Workers & Pages →
   "Create Worker" → follow the subdomain prompt once).

## 4. Connect GitHub → Cloudflare (what we recommend + why)

**Recommended: GitHub Actions + Wrangler** (already configured in
`.github/workflows/deploy.yml`). See `docs/CLOUDFLARE-GITHUB.md` for the
full comparison with Workers Builds and the reasons.

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token** →
   use the **"Edit Cloudflare Workers"** template. Add these permissions:
   - Account → Workers Scripts → **Edit**
   - Account → Workers D1 → **Edit**
   - Account → Workers KV Storage → **Edit**
   - Account → Account Settings → **Read** (needed for the workers.dev
     subdomain lookup used by the smoke test)
   - Zone → Workers Routes → **Edit** (only if you later add a custom domain)
2. Copy the token.
3. GitHub repo → **Settings → Secrets and variables → Actions** → add:
   - `CLOUDFLARE_API_TOKEN` = the token above
   - `CLOUDFLARE_ACCOUNT_ID` = your account id (dashboard → right sidebar,
     or `npx wrangler whoami`)

## 5. Create D1 + KV (two commands, or one script)

On your machine (needs the GitHub secret values OR a `wrangler login`):

```bash
npx wrangler login          # browser auth — easiest
npm run setup:migrate       # creates muchi + muchi-staging D1, muchi-cache +
                            # muchi-staging-cache KV, patches wrangler.toml,
                            # applies remote migrations
```

Manual alternative (if you prefer):
```bash
npx wrangler d1 create muchi            # copy database_id
npx wrangler d1 create muchi-staging    # copy database_id
npx wrangler kv namespace create muchi-cache           # copy id
npx wrangler kv namespace create muchi-staging-cache   # copy id
# paste the ids into wrangler.toml (REPLACE_ME_* — 4 places)
npx wrangler d1 migrations apply DB --remote
npx wrangler d1 migrations apply DB --remote --env staging
```

## 6. Configure Worker secrets (never in GitHub)

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REDIRECT_URI
npx wrangler secret put MUCHI_SESSION_SECRET
# staging (same values or separate Google OAuth client — separate is cleaner):
npx wrangler secret put GOOGLE_CLIENT_ID --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
npx wrangler secret put GOOGLE_REDIRECT_URI --env staging
npx wrangler secret put MUCHI_SESSION_SECRET --env staging
```

`GOOGLE_REDIRECT_URI` must be (`<SUB>` = your account's workers.dev subdomain,
e.g. `muchi` → `*.muchi.workers.dev`):
- production: `https://muchi.<SUB>.workers.dev/api/auth/google/callback`
- staging: `https://muchi-staging.<SUB>.workers.dev/api/auth/google/callback`

**Google Console (only for the test/staging Worker for now):** Google Cloud
Console → APIs & Services → Credentials → OAuth 2.0 Client (the *web* client
whose secret you use) → **Authorized redirect URIs**: add the staging
callback URL. **Do not touch the Render production client yet** — it keeps
working as the live fallback. Native apps need no Console entry for the
`muchi://` custom scheme.

`MUCHI_SESSION_SECRET`: any long random string (e.g.
`openssl rand -hex 32`). It signs session tokens. A new value simply signs
sessions on this Worker; the Render cookies are independent (see
MIGRATION.md §6).

## 7. Deploy

From your machine:
```bash
npm run deploy            # production
npm run deploy:staging    # staging
```
Or push to GitHub and let Actions do it (main → production, other branches →
staging, manual run → choice).

## 8. Database migrations (already handled by setup + CI)

```bash
npx wrangler d1 migrations apply DB --remote               # production
npx wrangler d1 migrations apply DB --remote --env staging # staging
```
CI applies them before every deploy. Migration files: `migrations/`.

## 9. Open the deployed Worker

(`<SUB>` = your account's workers.dev subdomain)
- Production: `https://muchi.<SUB>.workers.dev/`
- Staging: `https://muchi-staging.<SUB>.workers.dev/`

You should see the MUCHI app shell. `https://<url>/api/health` should return
`{"ok":true,"name":"Muchi","version":"1.2.1",...}`.

## 10. Test (staging → production)

Follow `docs/TESTING.md` exactly. Anything not testable from this sandbox is
explicitly marked PENDING there — run those on the real deployed Worker and
record results. Only after staging passes every item should production be
deployed (it already is, by `git push main` — or keep it manual with
`workflow_dispatch` until you're satisfied).

## 10b. Mobile builds (Android APK/AAB + iOS archive)

The mobile apps are Capacitor projects in `android/` + `ios/`; their UI is
`public/` (run `npm run mobile:sync` after changing the frontend). CI
workflows (moved to `.github/workflows/` in step 2):

- `android-capacitor.yml` — builds release APK + AAB. Optional GitHub
  secrets: `MUCHI_KEYSTORE_B64`, `MUCHI_KEYSTORE_PASSWORD`,
  `MUCHI_KEYSTORE_ALIAS` (without them it builds with the debug key).
- `ios-capacitor.yml` — builds an unsigned `.xcarchive` (no Apple
  credentials needed; signing secrets documented in the workflow for
  App Store publishing later).

API base for the apps: `MUCHI_API_BASE_FALLBACK` in `public/app.js` — see
`docs/API-CONFIG.md`.

## 11. Production cutover (LATER — do not do yet)

See `docs/CUTOVER.md` (§11 of MIGRATION.md): add the production callback to
Google Console, keep Render live as fallback, point mobile apps at the new
API only after full testing, then retire Render.

## 12. Rollback

- **Quick rollback (previous deployment):** `npx wrangler rollback` — or
  dashboard → Workers → your worker → **Deployments** → ⋯ → **Rollback to
  this deployment**.
- **Full rollback:** Render is still live and untouched; point the app back
  at `https://muchi-music.onrender.com` (the old APKs keep working).
- D1 rollback: `npx wrangler d1 export` for backups; schema changes are
  additive-only migrations (never destructive) by policy.
