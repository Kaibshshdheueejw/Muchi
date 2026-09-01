#!/usr/bin/env node
/**
 * MUCHI — Cloudflare resource setup (cross-platform Node).
 *
 * Creates (idempotently) the D1 databases and KV namespaces for the
 * production and staging Workers, patches the REPLACE_ME_* ids in
 * wrangler.toml, applies remote D1 migrations, and prints the exact
 * `wrangler secret put` commands you must run.
 *
 * Usage:
 *   npx wrangler login            # once (or export CLOUDFLARE_API_TOKEN)
 *   npm run setup                 # creates resources + patches wrangler.toml
 *   npm run setup -- --migrate    # also apply remote D1 migrations
 *   npm run setup -- --ci         # CI mode (needs CLOUDFLARE_API_TOKEN +
 *                                 # CLOUDFLARE_ACCOUNT_ID env, no prompts)
 *
 * No secrets are ever written to disk by this script.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WRANGLER = path.join(ROOT, "wrangler.toml");
const CI = process.argv.includes("--ci");
const MIGRATE = process.argv.includes("--migrate");

function run(args, opts = {}) {
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const out = execFileSync(cmd, ["wrangler", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, NO_D1_WARNING: "true" },
    ...opts,
  });
  return out;
}

function toml() {
  return readFileSync(WRANGLER, "utf8");
}

function patch(ids) {
  let t = toml();
  for (const [placeholder, value] of Object.entries(ids)) {
    if (!value) continue;
    if (!t.includes(placeholder)) {
      console.warn(`  ! placeholder ${placeholder} not found in wrangler.toml (already patched?)`);
      continue;
    }
    t = t.replace(placeholder, value);
  }
  writeFileSync(WRANGLER, t);
}

async function createD1(name) {
  // `wrangler d1 list` first — creating an existing DB errors out.
  try {
    const list = run(["d1", "list", "--json"]);
    const rows = JSON.parse(list);
    const hit = rows.find((r) => r.name === name);
    if (hit) {
      console.log(`  D1 "${name}" already exists (${hit.uuid})`);
      return hit.uuid;
    }
  } catch {}
  const out = run(["d1", "create", name]);
  const m = out.match(/database_id\s*=\s*"([^"]+)"/) || out.match(/"uuid"\s*:\s*"([^"]+)"/);
  if (!m) throw new Error(`Could not parse database id from: ${out}`);
  console.log(`  D1 "${name}" created (${m[1]})`);
  return m[1];
}

async function createKV(name) {
  try {
    const list = run(["kv", "namespace", "list"]);
    const rows = JSON.parse(list);
    const hit = rows.find((r) => r.title === name);
    if (hit) {
      console.log(`  KV "${name}" already exists (${hit.id})`);
      return hit.id;
    }
  } catch {}
  const out = run(["kv", "namespace", "create", name]);
  const m = out.match(/"id"\s*:\s*"([^"]+)"/);
  if (!m) throw new Error(`Could not parse KV namespace id from: ${out}`);
  console.log(`  KV "${name}" created (${m[1]})`);
  return m[1];
}

async function main() {
  console.log("MUCHI Cloudflare setup\n");
  const ids = {
    REPLACE_ME_D1_PRODUCTION: await createD1("muchi"),
    REPLACE_ME_D1_STAGING: await createD1("muchi-staging"),
    REPLACE_ME_KV_PRODUCTION: await createKV("muchi-cache"),
    REPLACE_ME_KV_STAGING: await createKV("muchi-staging-cache"),
  };
  patch(ids);
  console.log("\nwrangler.toml patched with resource ids.\n");

  if (MIGRATE) {
    console.log("Applying remote D1 migrations…");
    run(["d1", "migrations", "apply", "DB", "--remote"]);
    run(["d1", "migrations", "apply", "DB", "--remote", "--env", "staging"]);
    console.log("Migrations applied.\n");
  }

  console.log("Next — configure Worker secrets (run each command, paste the value, Enter):");
  console.log("  npx wrangler secret put GOOGLE_CLIENT_ID");
  console.log("  npx wrangler secret put GOOGLE_CLIENT_SECRET");
  console.log("  npx wrangler secret put GOOGLE_REDIRECT_URI   # https://muchi.<account>.workers.dev/api/auth/google/callback");
  console.log("  npx wrangler secret put MUCHI_SESSION_SECRET  # any long random string");
  console.log("  # staging (only if you will test auth on the staging worker):");
  console.log("  npx wrangler secret put GOOGLE_CLIENT_ID --env staging");
  console.log("  npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging");
  console.log("  npx wrangler secret put GOOGLE_REDIRECT_URI --env staging");
  console.log("  npx wrangler secret put MUCHI_SESSION_SECRET --env staging");
  console.log("\nThen deploy:  npm run deploy            (production)");
  console.log("              npm run deploy -- --env staging  (staging)");
}

main().catch((e) => {
  console.error("setup failed:", e.message);
  process.exit(1);
});
