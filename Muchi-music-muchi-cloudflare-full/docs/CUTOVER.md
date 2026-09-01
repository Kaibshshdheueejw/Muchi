# MUCHI Cloudflare — deployment, cutover and rollback (complete procedure)

This is the exact, ordered procedure for taking this package from a new empty
GitHub repository to a tested Cloudflare staging Worker, then — only after
everything passes — to production, with Render kept as the instant rollback
path. **Nothing in this document touches the Render deployment or the
production API URL until Phase 6, and even then the frontend keeps pointing
at Render until you decide otherwise.**

---

## 0. Safety rules (read first)

1. **Do not** delete, disable, or change the Render service (`muchi-music`).
2. **Do not** change `MUCHI_API_BASE` in the frontend yet — the app must keep
   talking to Render until the Cloudflare Worker has passed all tests.
3. **Do not** remove `https://muchi-music.onrender.com` from the Google Cloud
   Console OAuth authorized origins/redirect URIs — it stays as rollback.
4. Worker secrets live **only in Cloudflare** (and your local terminal).
   GitHub holds exactly two secrets: `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`. No OAuth secrets in Git, ever.
5. Staging deploys happen on **any push to a non-`main` branch** (or a manual
   workflow run). Production deploys only on **push to `main`** or a manual
   production run. You control when production changes.

---

## 1. Prerequisites

| Item | What you need |
|---|---|
| GitHub account | Free; your new repo will be **private or public — either works** |
| Cloudflare account | Free plan; verify your email |
| Cloudflare API token | Created in Phase 3 (or before), scoped to Workers/D1/KV |
| Google OAuth credentials | Existing MUCHI OAuth Client ID/secret (web app type) — reuse the same client; you only add the Worker URLs as an additional redirect URI + JS origin |
| `MUCHI_SESSION_SECRET` | Any long random string (e.g. `openssl rand -hex 32`). NOTE: sessions signed with a new secret will not validate old Render cookies — that is fine (users just sign in again); keep the same value in staging and production |
| Node.js 18+ locally (optional) | Only needed if you want to run `npm test` locally before pushing |

---

## 2. Create the NEW GitHub repository and upload this package

1. Open https://github.com/new
2. Repository name (suggestion): `muchi-cloudflare`
3. Description: `MUCHI backend + frontend for Cloudflare Workers (D1 + KV)`
4. Visibility: your choice. **Do NOT** check "Add a README", ".gitignore",
   or "license" — an empty repo avoids merge conflicts.
5. Create repository.
6. Upload the ZIP contents so that `wrangler.toml`, `package.json`,
   `src/`, `public/`, `migrations/`, `scripts/`, `.github/`, `docs/` sit at
   the repository **root** (not inside a subfolder):

   **Option A — web upload (no git needed):**
   - Click **Add file → Upload files** on the repo page.
   - Drag the *contents* of the unzipped `muchi-cloudflare-full` folder
     (select all files, including hidden ones like `.github` — drag the
     `.github` folder itself) into the browser.
   - Commit directly to `main`.

   **Option B — git push:**
   ```bash
   mkdir muchi-cloudflare && cd muchi-cloudflare
   unzip /path/to/muchi-cloudflare-full.zip
   git init -b main
   git add -A
   git commit -m "MUCHI Cloudflare package (complete backend port)"
   git remote add origin https://github.com/YOU/muchi-cloudflare.git
   git push -u origin main
   ```

   > Important: the first push to `main` triggers the workflow's
   > **production** path — but it cannot run yet because the two GitHub
   > secrets are not set (Phase 3). To be safe, you may instead push to a
   > branch (`git push -u origin staging`) so the first auto-deploy targets
   > **staging** only.

7. Sanity-check the repo root looks like:

   ```
   .github/workflows/deploy.yml
   docs/  migrations/  public/  scripts/  src/  test/
   package.json  package-lock.json  wrangler.toml
   README.md  SETUP.md  MIGRATION.md  .dev.vars.example  .gitignore
   ```

---

## 3. Connect GitHub → Cloudflare (GitHub Actions + Wrangler — the recommended method)

**Method chosen: GitHub Actions + `cloudflare/wrangler-action@v3`.**
Why not "Workers Builds" (the dashboard git integration)? Because Workers
Builds does **not** run D1 migrations for you, gives you less control over
staging-vs-production, and keeps deployment history inside the dashboard
instead of your repo. With GitHub Actions every deploy is a reviewable,
rerunnable workflow and migrations run explicitly. See
`docs/CLOUDFLARE-GITHUB.md` for the full comparison.

There is **no dashboard "Connect to GitHub" step** — the connection is the
API token. Do this:

1. **Create the Cloudflare API token** (in Cloudflare dashboard):
   - https://dash.cloudflare.com/profile/api-tokens → **Create Token** →
     **Create Custom Token**.
   - Name: `muchi-deploy`.
   - Permissions (Account → all resources or your MUCHI account scope):
     - Workers Scripts → **Edit**
     - Workers R2 Storage → **Edit** (required by wrangler for uploads)
     - Workers KV Storage → **Edit**
     - Workers D1 → **Edit**
     - Account Settings → **Read** (required by the workflow's smoke-test
       step, which reads your account's workers.dev subdomain)
     - (Memberships → Read is included by default — keep it)
   - Account resources: your account. Zone resources: none needed.
   - Create and **copy the token once** (it is shown only once).
2. **Find your Account ID**: dashboard → right sidebar shows "Account ID"
   (also at https://dash.cloudflare.com/profile → API tokens → Account ID).
3. **Add the two GitHub secrets** (repo → Settings → Secrets and variables →
   Actions → New repository secret):
   - `CLOUDFLARE_API_TOKEN` = the token from step 1
   - `CLOUDFLARE_ACCOUNT_ID` = your account ID

   These are the **only** secrets GitHub ever needs. The workflow uses them
   to create resources, run migrations, deploy, and smoke-test.

4. (Optional, for local work) `npx wrangler login` on your machine once —
   the Actions workflow does not need this.

---

## 4. Create and configure D1 + KV (one-time)

Run this **locally** on your machine (or let the workflow do it — it is
idempotent and runs on every deploy via `node scripts/setup.mjs --ci`):

```bash
cd muchi-cloudflare
npm ci
npm run setup            # creates D1 "muchi" + "muchi-staging",
                         # KV "muchi-cache" + "muchi-staging-cache",
                         # patches the REPLACE_ME_* ids in wrangler.toml
```

Manual equivalent (if you prefer):
```bash
npx wrangler d1 create muchi
npx wrangler d1 create muchi-staging
npx wrangler kv namespace create muchi-cache
npx wrangler kv namespace create muchi-staging-cache
# then paste the returned ids into wrangler.toml for
# REPLACE_ME_D1_PRODUCTION / REPLACE_ME_D1_STAGING /
# REPLACE_ME_KV_PRODUCTION / REPLACE_ME_KV_STAGING
```

Result: `wrangler.toml` now contains real resource ids. **Commit the patched
`wrangler.toml`** (ids are not secrets).

> D1 = sessions + OAuth single-use state (strong consistency).
> KV = bounded daily caches only (home/shelf blocks, 60 s+ TTL).
> No other storage is required.

---

## 5. Configure Worker secrets (in Cloudflare, never in Git)

From the package directory, run each command and paste the value when
prompted (values are stored encrypted by Cloudflare):

```bash
# Production worker
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REDIRECT_URI
#   value: https://muchi.YOUR-ACCOUNT.workers.dev/api/auth/google/callback
npx wrangler secret put MUCHI_SESSION_SECRET

# Staging worker (only if you will test Google sign-in on staging —
# recommended: yes, with the staging callback URL)
npx wrangler secret put GOOGLE_CLIENT_ID --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
npx wrangler secret put GOOGLE_REDIRECT_URI --env staging
#   value: https://muchi-staging.YOUR-ACCOUNT.workers.dev/api/auth/google/callback
npx wrangler secret put MUCHI_SESSION_SECRET --env staging
```

> **Google Cloud Console (one-time, do NOT remove Render entries):**
> In your existing OAuth client (Web application), add to **Authorized
> redirect URIs**:
> - `https://muchi-staging.YOUR-ACCOUNT.workers.dev/api/auth/google/callback`
> - `https://muchi.YOUR-ACCOUNT.workers.dev/api/auth/google/callback`
>
> and add to **Authorized JavaScript origins**:
> - `https://muchi-staging.YOUR-ACCOUNT.workers.dev`
> - `https://muchi.YOUR-ACCOUNT.workers.dev`
>
> Keep `https://muchi-music.onrender.com` and its callback — Render remains
> the rollback. (Native apps are unaffected: they use the deep link
> `muchi://auth/success?token=…`.)

If you skip secrets, the Worker still deploys and everything works except
Google sign-in / YouTube — `/api/auth/status` then reports
`configured: false` (and the auth endpoints answer 503 "not configured"),
which is exactly the designed offline behavior.

---

## 6. Deploy staging + run migrations

### 6.1 Staging deployment (recommended first run)

Push to a branch (or use the manual workflow run):

```bash
git checkout -b staging
git push -u origin staging
```

The workflow runs automatically:
1. `test` job: `npm ci` + `npm test` (pure, offline-safe).
2. `deploy` job: creates D1/KV if missing (`setup.mjs --ci`), applies D1
   migrations to the **staging** database
   (`wrangler d1 migrations apply DB --remote --env staging`), deploys the
   **staging** Worker (`wrangler deploy --env staging`), then smoke-tests
   `https://muchi-staging.YOUR-ACCOUNT.workers.dev/api/health`.

Manual equivalent:
```bash
npm run setup:migrate          # resources + remote migrations (both envs)
npm run deploy:staging         # wrangler deploy --env staging
```

### 6.2 Migration safety note

This package contains a single ordered migration (`0001_initial.sql`), so
`wrangler d1 migrations apply` is safe. If you later add migrations, apply
**one at a time** and verify each (`wrangler d1 execute DB --remote
--command "SELECT count(*) FROM d1_migrations"`) — there is a known
filesystem-ordering bug in `d1 migrations apply`
(workers-sdk#13568); keeping one migration per release avoids it entirely.

### 6.3 Verify staging

Open in a browser:
- `https://muchi-staging.YOUR-ACCOUNT.workers.dev/api/health` →
  `{"ok":true,"name":"Muchi","version":"1.2.1",…}`
- `https://muchi-staging.YOUR-ACCOUNT.workers.dev/` → the MUCHI app shell
- `https://muchi-staging.YOUR-ACCOUNT.workers.dev/api/moods` → 12 moods
- `https://muchi-staging.YOUR-ACCOUNT.workers.dev/api/health?debug=1` →
  `x-muchi-ms` header present

Then run the **full test checklist** — `docs/TESTING.md` — item by item
(stream, img, search, radio, Audius, YouTube, Google sign-in, D1 session
persistence, long-running playback, reconnect). Record every result in
`docs/AUDIT.md` (PASS 2 section). Anything failing here is fixed **before**
production; Render keeps serving users meanwhile.

---

## 7. Production deployment (cutover)

Only after **every** staging item passes:

```bash
git checkout main
git merge staging
git push origin main
```

The workflow now: tests → D1 migrations on the **production** database →
deploy **production** Worker (`muchi.YOUR-ACCOUNT.workers.dev`) → smoke
test. The Worker is production-ready and serving the API, but the app still
points at Render — so **zero user impact**.

**Cutover checklist (each step is separate and reversible):**
- [ ] `https://muchi.YOUR-ACCOUNT.workers.dev/api/health` → `ok:true`
- [ ] `?debug=1` shows sane wall-times (aggregates should be well under 1 s;
      most endpoints under 100 ms; home first-hit ~1–3 s cold)
- [ ] Google sign-in on production Worker (redirect URI must be the
      production one)
- [ ] YouTube connect → Liked Songs / Playlists load
- [ ] Sessions persist across a redeploy (D1)
- [ ] Run `docs/TESTING.md` against the production URL too
- [ ] Keep Render running (do not touch)

**Only now decide** whether to move the app to Cloudflare: change
`MUCHI_API_BASE` (public/app.js line 10–11 for native, or the
`MUCHI_API_BASE` env var for the web app) to
`https://muchi.YOUR-ACCOUNT.workers.dev` **in the Render deployment**, or
deploy the frontend to Cloudflare Static Assets (the assets are already in
this package at `public/`). You may also keep the app on Render and only
switch the API base — both work. This is a **later, explicit decision**; it
is NOT automatic.

---

## 8. Rollback (any time)

You always have two independent rollback layers:

1. **Worker rollback (Cloudflare)**
   - Dashboard: Workers & Pages → `muchi` → **Deployments** → ⋯ →
     **Rollback to previous deployment** (or use
     `npx wrangler rollback` from the CLI).
   - Or push a revert commit to `main` — the workflow redeploys the old code.
   - D1: migrations are additive; a rollback does not need schema undo.
     If you must remove a migration's effects, run the reverse
     `wrangler d1 execute DB --remote --file=rollback.sql` manually (never
     edit `d1_migrations` unless you know exactly what you are doing).

2. **Render rollback (unchanged service)**
   - The Render deployment was never modified. The app's API base still
     points at Render (unless you performed the optional final cutover step).
   - If you did switch the API base and need to revert: change it back to
     `https://muchi-music.onrender.com` and redeploy Render — instant.
   - Google Console: the Render callback/origin entries were kept, so OAuth
     keeps working against Render.

**Production never had a single point of failure:** during the whole
migration, real users stay on Render; the Cloudflare Worker is a parallel
environment tested to parity before any traffic moves.

---

## 9. After cutover (only when everything is green)

- Consider disabling the Render sleep/scale-to-zero (or leaving it — your
  choice) once Cloudflare carries production.
- Run the mobile real-device checklist (`docs/MOBILE.md`) against the
  production Worker.
- Update `docs/AUDIT.md` with final production results and close out
  PENDING items.

---

## Quick command reference

| Action | Command |
|---|---|
| Local dev | `npm run dev` (then http://localhost:8787) |
| Local tests | `npm test` (pure) / `npm run test:live` (with dev running) |
| Setup resources | `npm run setup` |
| Setup + remote migrations | `npm run setup:migrate` |
| Deploy production | `npm run deploy` (or push to `main`) |
| Deploy staging | `npm run deploy:staging` (or push to branch) |
| Migrate production D1 | `npm run d1:migrate` |
| Migrate staging D1 | `npm run d1:migrate:staging` |
| Secrets | `npx wrangler secret put NAME [--env staging]` |
| Rollback worker | `npx wrangler rollback` (or dashboard Deployments) |
