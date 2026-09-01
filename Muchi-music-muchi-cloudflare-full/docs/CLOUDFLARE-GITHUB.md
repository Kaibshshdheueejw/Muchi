# Cloudflare + GitHub connection (researched 2026-08-31)

This answers the 12 questions about managing a Cloudflare Worker through a
new GitHub repository, and why this repo is structured the way it is.

## 1. What repository structure Cloudflare expects

Both deployment paths accept a normal repo root containing:

- `wrangler.toml` (or `wrangler.jsonc`) at the root — the single source of
  truth for name, entry point, compat date, bindings (D1/KV), assets.
- `src/` with the Worker entry (`main = "src/index.js"`).
- `public/` (or any dir) for Workers Static Assets (`assets.directory`).
- `package.json` + `package-lock.json` for install/build/test steps.
- `.github/workflows/*.yml` if using GitHub Actions (ignored by Workers
  Builds, used by Actions).

This repo follows exactly that layout. No special Cloudflare metadata files
are required (no `_worker.js`, no `wrangler.toml` special keys beyond the
standard ones).

## 2. Workers Builds vs GitHub Actions + Wrangler — which is current (2026)

Both are current and officially supported:

- **Workers Builds** (dashboard → Workers → *your worker* → Settings →
  Builds, or "Connect to Git" at creation): Cloudflare connects to your
  GitHub repo directly and auto-deploys on push. Supports GitHub and
  GitLab. Build status shows in GitHub via check runs.
- **GitHub Actions + `cloudflare/wrangler-action@v3`**: you own the
  pipeline — install deps, run tests, run D1 migrations, deploy with
  `wrangler deploy [--env staging]`, smoke-test the result, gate deploys.

## 3. Which is better for MUCHI and why → **GitHub Actions + Wrangler**

- **D1 migrations must run before deploy** — Actions runs them explicitly
  (`wrangler d1 migrations apply DB --remote`); Workers Builds requires a
  separate manual migration step and has no migration lifecycle (per
  Cloudflare docs and NuxtHub's CI/CD guide).
- **Staging/test Worker** — we deploy `--env staging` from every non-main
  branch; with Workers Builds this is per-branch preview deployments which
  are less controllable for D1-backed workers.
- **Tests in the pipeline** — `npm test` gates deploys.
- **Deployment history + gating in GitHub** — Actions UI, protected
  environments, manual approval for production if desired.
- **No lock-in** — the same `wrangler deploy` works from a laptop; Workers
  Builds ties deploys to the dashboard connection.
- **Workers Builds is a fine choice** if you prefer zero-YAML; nothing in
  this repo prevents switching later (same wrangler.toml).

## 4. What to connect in the Cloudflare dashboard

With GitHub Actions you do NOT "connect" the repo in the dashboard at all.
You only:

1. Create an API token (My Profile → API Tokens → Create Token → "Edit
   Cloudflare Workers" template).
2. Add it (plus your account id) as GitHub Actions secrets.

(If you later choose Workers Builds: dashboard → Workers → Create →
"Connect to Git" → authorize the GitHub App → pick the repo → choose
production branch. Workers Builds requires a Cloudflare-managed GitHub App
with repo read access.)

## 5. Which GitHub permissions are required

- **GitHub Actions path:** none beyond the repo's own Actions (free on
  public repos; private repos get 2,000 min/month on the free plan). The
  API token authenticates to Cloudflare, not GitHub.
- **Workers Builds path:** you grant the Cloudflare GitHub App read access
  to the repository (it only reads code/builds).

## 6. Which Cloudflare permissions are required (API token)

- Account → Workers Scripts → Edit (deploy)
- Account → Workers D1 → Edit (create/migrate databases)
- Account → Workers KV Storage → Edit (create namespaces)
- Account → Account Settings → Read (the smoke test reads your workers.dev
  subdomain)
- Zone → Workers Routes → Edit (only when you add a custom domain later)

## 7. How automatic deployment works after a Git push

`.github/workflows/deploy.yml`:

- `push` to `main` → tests → ensure D1/KV → migrations (prod) → deploy
  production → smoke test `/api/health` + app shell.
- `push` to any other branch → same pipeline against `--env staging`
  (deploys `muchi-staging.<account>.workers.dev`).
- Manual `workflow_dispatch` → choose staging or production.
- Deploys are versioned; Cloudflare keeps a deployment history (rollback
  in the dashboard, see §11).

## 8. How D1 migrations are handled safely

- Migrations live in `migrations/*.sql` with numeric prefixes, applied with
  `wrangler d1 migrations apply DB --remote` (wrangler tracks applied
  migrations in a `d1_migrations` table — it only runs new ones).
- CI applies migrations **before** the deploy step.
- Policy: **additive-only migrations** (create tables/indexes, never drop/
  destructive) so a rollback never needs schema surgery.
- Known wrangler quirk (workers-sdk#13568): `migrations apply` reads the
  directory in filesystem order, not sorted — with our single numeric-
  prefixed file this is a non-issue; keep numeric prefixes for future files.
- Local dev: `npm run d1:local:migrate` (miniflare D1).

## 9. How secrets are configured without putting them in GitHub

Worker secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI`, `MUCHI_SESSION_SECRET`) are stored **in Cloudflare's
secrets store** via `npx wrangler secret put NAME [--env staging]` — they
are bound to the Worker at runtime, never appear in wrangler.toml, never in
Git, never in the browser. GitHub only holds the two *deployment* secrets
(API token + account id), which are equally safe as Actions secrets. The
Workers dashboard shows secrets as `********` and lets you rotate them.

## 10. How to deploy a test/staging Worker before production

- Separate environment `[env.staging]` in wrangler.toml with its own D1
  (`muchi-staging`) and KV (`muchi-staging-cache`) → staging never touches
  production data.
- Push to a branch (or `npm run deploy:staging`) → `muchi-staging.<account>
  .workers.dev`.
- Google Console: add the staging callback URL as an authorized redirect —
  production Render callback stays untouched.
- Run `docs/TESTING.md` against the staging URL. The frontend is served by
  the same Worker, so you test the real app.

## 11. How to roll back to the previous Worker version

- `npx wrangler rollback` — redeploys the previous deployment.
- Dashboard → your Worker → **Deployments** → pick any previous version →
  **Rollback to this deployment** (instant, versioned).
- Data: D1 stays as-is (no destructive migrations); KV entries expire by
  TTL. Render remains the full fallback (§12).

## 12. How Render remains available during the entire migration

- Render (`muchi-music.onrender.com`) is **not modified, disabled, or
  deleted** — its code, env vars (incl. the Google web client secret) and
  Google Console redirect URIs stay as they are.
- The mobile apps still point at Render (the one-line API base in
  `public/app.js:10-11` is unchanged) — users are unaffected.
- Only at the final cutover (MIGRATION.md §11) does the production Worker
  get its callback registered and the apps repointed; Render stays live as
  the fallback until the new deployment is proven stable, then can be
  decommissioned.
- Rollback = point the app back at Render (old APKs keep working); nothing
  about Render changes during the process.
