// Focused integration regressions for the 1.10.2 selective merge. All secrets,
// session IDs, and database contents in this file are generated at runtime.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync, existsSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { authConfig } from "../src/config.js";
import { sessionToken, sidFromToken } from "../src/auth.js";
import { readSession, handleAuthStatus, handleGoogleCallback, handleYoutubeCallback } from "../src/oauth.js";
import { checkAdminAuth, isUserAdmin } from "../src/admin.js";
import { handleWebhook } from "../src/webhook.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rendererPaths = ["public/app.js", "native-shell/android/public/app.js", "native-shell/ios/public/app.js"];
const random = () => randomBytes(32).toString("base64url");
const load = (path) => readFileSync(join(root, path), "utf8");
const digest = (text) => createHash("sha256").update(text).digest("hex");

// The test process must not inherit operator credentials or environment
// defaults. Each fixture below supplies its own random, isolated values.
for (const name of ["MUCHI_SESSION_SECRET", "WEBHOOK_SECRET", "GITHUB_WEBHOOK_SECRET", "MUCHI_WEBHOOK_SECRET", "MUCHI_ADMIN_KEY", "ADMIN_KEY", "ADMIN_EMAILS"]) {
  delete process.env[name];
}

function between(text, start, end) {
  const a = text.indexOf(start);
  assert.ok(a >= 0, `Missing start marker: ${start}`);
  const b = text.indexOf(end, a + start.length);
  assert.ok(b > a, `Missing end marker: ${end}`);
  return text.slice(a, b);
}

function sessionDb(session) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              return sql.includes("FROM sessions WHERE sid") && args[0] === session.sid
                ? { payload: JSON.stringify(session) }
                : null;
            },
            async run() { return { success: true }; },
          };
        },
      };
    },
  };
}

function requestWith(token, cookie = false) {
  return new Request("https://muchi.invalid/api/auth/status", {
    headers: cookie ? { cookie: `muchi_sid=${encodeURIComponent(token)}` } : { authorization: `Bearer ${token}` },
  });
}

test("missing or short signing secrets disable authentication, including persisted sessions", async () => {
  const secret = random();
  const shortSecret = random().slice(0, 5);
  const sid = random();
  const session = { sid, email: "member@example.invalid", email_verified: true, role: "user" };
  const db = sessionDb(session);
  const token = sessionToken(sid, secret);
  const google = { GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: random(), GOOGLE_REDIRECT_URI: "https://muchi.invalid/callback" };
  assert.equal(authConfig({ ...google, MUCHI_SESSION_SECRET: "" }).on, false);
  assert.equal(authConfig({ ...google, MUCHI_SESSION_SECRET: shortSecret }).on, false);
  assert.equal(authConfig({ ...google, MUCHI_SESSION_SECRET: secret }).on, true);
  assert.equal(sidFromToken(token, ""), null);
  assert.ok(await readSession(requestWith(token), { DB: db, MUCHI_SESSION_SECRET: secret }));
  assert.ok(await readSession(requestWith(token, true), { DB: db, MUCHI_SESSION_SECRET: secret }));
  assert.equal(await readSession(requestWith(sid), { DB: db, MUCHI_SESSION_SECRET: secret }), null);
  assert.equal(await readSession(requestWith(sessionToken(sid, random())), { DB: db, MUCHI_SESSION_SECRET: secret }), null);
  assert.equal(await readSession(requestWith(sessionToken(sid, "")), { DB: db, MUCHI_SESSION_SECRET: "" }), null);
  assert.equal(await readSession(requestWith(sessionToken(sid, shortSecret)), { DB: db, MUCHI_SESSION_SECRET: shortSecret }), null);
});

test("a stored admin role is insufficient without a verified email on the current allowlist", async () => {
  const secret = random();
  const sid = random();
  const session = { sid, email: "member@example.invalid", email_verified: true, role: "admin" };
  const env = { DB: sessionDb(session), MUCHI_SESSION_SECRET: secret, ADMIN_EMAILS: "" };
  const request = requestWith(sessionToken(sid, secret));
  assert.equal(isUserAdmin(session, env), false);
  assert.equal(isUserAdmin({ ...session, email_verified: "false" }, { ...env, ADMIN_EMAILS: session.email }), false);
  assert.equal(isUserAdmin(session, { ...env, ADMIN_EMAILS: session.email }), true);
  assert.equal((await checkAdminAuth(request, env)).forbidden, true);
  assert.equal((await checkAdminAuth(request, { ...env, ADMIN_EMAILS: session.email })).authorized, true);
  assert.equal((await checkAdminAuth(request, { ...env, MUCHI_SESSION_SECRET: "" })).authorized, false);
  const status = await (await handleAuthStatus(request, env)).json();
  assert.equal(status.signedIn, true);
  assert.equal(status.profile.role, "user");
});

test("OAuth callbacks fail closed for missing and short secrets before any external exchange", async () => {
  let externalCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { externalCalls++; throw new Error("external exchange must not run"); };
  try {
    const db = {
      prepare() {
        return { bind() { return { async first() { return { payload: JSON.stringify({ platform: "native", step: "signin", exp: Date.now() + 60000 }) }; } }; } };
      },
    };
    for (const secret of ["", random().slice(0, 5)]) {
      const env = { DB: db, GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: random(), GOOGLE_REDIRECT_URI: "https://muchi.invalid/callback", MUCHI_SESSION_SECRET: secret };
      for (const [route, handler] of [["google", handleGoogleCallback], ["youtube", handleYoutubeCallback]]) {
        const url = new URL(`https://muchi.invalid/api/auth/${route}/callback?code=fixture&state=fixture`);
        const response = await handler(new Request(url), env, url);
        assert.equal(response.status, 302);
        assert.match(response.headers.get("location") || "", /error/);
      }
    }
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("webhooks require dedicated configured secrets and reject forgery and replay", async () => {
  const sessionSecret = random();
  const hookSecret = random();
  const body = JSON.stringify({ event: "ping" });
  const sign = (secret) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const request = (signature, timestamp) => new Request("https://muchi.invalid/api/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}), ...(timestamp ? { "x-webhook-timestamp": timestamp } : {}) },
    body,
  });
  const url = new URL("https://muchi.invalid/api/webhook");
  assert.equal((await handleWebhook(request(sign(sessionSecret)), { MUCHI_SESSION_SECRET: sessionSecret }, url)).status, 503);
  for (const alias of ["WEBHOOK_SECRET", "GITHUB_WEBHOOK_SECRET", "MUCHI_WEBHOOK_SECRET"]) {
    const env = { [alias]: hookSecret, MUCHI_SESSION_SECRET: sessionSecret };
    assert.equal((await handleWebhook(request(sign(hookSecret)), env, url)).status, 200);
    assert.equal((await handleWebhook(request(sign(sessionSecret)), env, url)).status, 401);
    assert.equal((await handleWebhook(request(""), env, url)).status, 401);
    assert.equal((await handleWebhook(request(sign(hookSecret), String(Math.floor(Date.now() / 1000) - 600)), env, url)).status, 400);
  }
});

test("Arena candidate pushes run CI without triggering deployment", () => {
  const workflow = load(".github/workflows/deploy.yml");
  const testJob = workflow.indexOf("  test:\n");
  const deployJob = between(workflow, "  deploy:\n", "    runs-on: ubuntu-latest");
  assert.ok(testJob >= 0 && testJob < workflow.indexOf("  deploy:\n"));
  assert.ok(deployJob.includes("needs: test"));
  assert.ok(deployJob.includes("if: ${{ !startsWith(github.ref, 'refs/heads/arena/') }}"));
});

test("empty local database initializes with zero seeded sessions", () => {
  const source = load("server.js");
  const dbFactory = between(source, "function createInMemoryD1() {", "// In-memory Cloudflare KV stub");
  const marker = "  return {\n    prepare(sql) {";
  assert.equal(dbFactory.split(marker).length, 2);
  let sessionCount = -1;
  const instrumented = dbFactory.replace(marker, `  globalThis.inspectSessionCount(sessions.size);\n${marker}`);
  runInNewContext(`${instrumented}\ncreateInMemoryD1();`, {
    fs: { existsSync: () => false }, CLOUD_DB_FILE: "unused", clearTimeout, setTimeout,
    inspectSessionCount: (count) => { sessionCount = count; },
  });
  assert.equal(sessionCount, 0);
});

async function unusedPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = server.address().port;
  await new Promise((resolveClose, reject) => server.close((err) => err ? reject(err) : resolveClose()));
  return port;
}

// The server copy only changes its hard-coded bind address/port, so tests can
// run in parallel with a developer server and cannot expose a listening port.
async function withServer(settings, dbFixture, action) {
  const dir = mkdtempSync(join(tmpdir(), "muchi-security-test-"));
  let child;
  try {
    const port = await unusedPort();
    let source = load("server.js");
    assert.equal(source.split("const PORT = 3000;").length, 2);
    assert.equal(source.split('const HOST = "0.0.0.0";').length, 2);
    source = source.replace("const PORT = 3000;", `const PORT = ${port};`).replace('const HOST = "0.0.0.0";', 'const HOST = "127.0.0.1";');
    writeFileSync(join(dir, "server.js"), source);
    writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
    for (const name of ["src", "public", "node_modules"]) {
      symlinkSync(join(root, name), join(dir, name), process.platform === "win32" ? "junction" : "dir");
    }
    const dbPath = join(dir, ".muchi-cloud-db.json");
    if (dbFixture) writeFileSync(dbPath, JSON.stringify(dbFixture), { mode: 0o600 });
    child = spawn(process.execPath, [join(dir, "server.js")], {
      cwd: dir,
      env: { PATH: process.env.PATH || "", NODE_ENV: "production", ...settings },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolveReady, reject) => {
      let output = "";
      const deadline = setTimeout(() => reject(new Error("Isolated server startup timed out")), 15000);
      const finish = (error) => { clearTimeout(deadline); error ? reject(error) : resolveReady(); };
      child.once("error", () => finish(new Error("Isolated server failed to start")));
      child.once("exit", (code) => finish(new Error(`Isolated server exited before readiness (${code})`)));
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("Muchi server running on")) finish();
      });
      // Consume stderr without echoing it: the test never logs request headers.
      child.stderr.resume();
    });
    await action(`http://127.0.0.1:${port}`, dbPath);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise((resolveExit) => {
        child.once("exit", resolveExit);
        child.kill("SIGTERM");
      });
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

test("clean server starts without a database and validly signed unseeded sessions cannot authenticate", async () => {
  const secret = random();
  const sid = random();
  const token = sessionToken(sid, secret);
  assert.ok(sidFromToken(token, secret) === sid);
  await withServer({ MUCHI_SESSION_SECRET: secret }, null, async (base, dbPath) => {
    assert.equal(existsSync(dbPath), false);
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/.muchi-cloud-db.json`)).status, 404);
    const headers = { authorization: `Bearer ${token}` };
    assert.equal((await (await fetch(`${base}/api/auth/status`, { headers })).json()).signedIn, false);
    assert.equal((await fetch(`${base}/api/user/library`, { headers })).status, 401);
    assert.equal((await fetch(`${base}/api/user/library`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ liked: [{ id: "fixture" }] }) })).status, 401);
    assert.equal((await fetch(`${base}/api/admin/status`, { headers })).status, 401);
    const body = JSON.stringify({ event: "ping" });
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    assert.equal((await fetch(`${base}/api/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body })).status, 503);
    assert.equal(existsSync(dbPath), false);
  });
});

test("an explicitly provisioned test session works, but stale admin roles and forged webhooks do not", async () => {
  const secret = random(), sid = random(), webhook = random(), adminKey = random();
  const session = { sid, email: "member@example.invalid", email_verified: true, role: "admin" };
  const dbFixture = { sessions: { [sid]: { payload: JSON.stringify(session), expires_at: Date.now() + 60000 } }, userLibraries: {} };
  const token = sessionToken(sid, secret);
  await withServer({ MUCHI_SESSION_SECRET: secret, WEBHOOK_SECRET: webhook, MUCHI_ADMIN_KEY: adminKey }, dbFixture, async (base) => {
    const bearer = { authorization: `Bearer ${token}` };
    const signed = await (await fetch(`${base}/api/auth/status`, { headers: bearer })).json();
    assert.equal(signed.signedIn, true);
    assert.equal(signed.profile.role, "user");
    assert.equal((await (await fetch(`${base}/api/auth/status`, { headers: { cookie: `muchi_sid=${encodeURIComponent(token)}` } })).json()).signedIn, true);
    assert.equal((await fetch(`${base}/api/user/library`, { headers: bearer })).status, 200);
    assert.equal((await fetch(`${base}/api/admin/status`, { headers: bearer })).status, 403);
    assert.equal((await fetch(`${base}/api/admin/status`, { headers: { "x-admin-key": adminKey } })).status, 200);
    assert.equal((await fetch(`${base}/.muchi-cloud-db.json`)).status, 404);
    const body = JSON.stringify({ event: "ping" });
    const sig = (key) => `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;
    const post = (key) => fetch(`${base}/api/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig(key) }, body });
    assert.equal((await post(webhook)).status, 200);
    assert.equal((await post(secret)).status, 401);
  });
});

test("missing signing secret keeps OAuth and persisted-session auth disabled on the server", async () => {
  const sid = random();
  const session = { sid, email: "member@example.invalid", email_verified: true, role: "admin" };
  const dbFixture = { sessions: { [sid]: { payload: JSON.stringify(session), expires_at: Date.now() + 60000 } }, userLibraries: {} };
  await withServer({ GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: random(), GOOGLE_REDIRECT_URI: "https://muchi.invalid/callback" }, dbFixture, async (base) => {
    const headers = { authorization: `Bearer ${sessionToken(sid, "")}` };
    const status = await (await fetch(`${base}/api/auth/status`, { headers })).json();
    assert.equal(status.configured, false);
    assert.equal(status.signedIn, false);
    assert.equal((await fetch(`${base}/api/auth/google/url`)).status, 503);
    assert.equal((await fetch(`${base}/api/user/library`, { headers })).status, 401);
    assert.equal((await fetch(`${base}/api/admin/status`, { headers })).status, 401);
  });
});

test("native sync preserves existing non-package assets and bridge files", () => {
  const dir = mkdtempSync(join(tmpdir(), "muchi-sync-test-"));
  try {
    for (const rel of ["public", "native-shell", "android/app/src/main/assets/public", "ios/App/App/public"]) {
      const target = join(dir, rel);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, rel), target, { recursive: true });
    }
    mkdirSync(join(dir, "scripts"), { recursive: true });
    cpSync(join(root, "scripts/sync-native-bundle.mjs"), join(dir, "scripts/sync-native-bundle.mjs"));
    const destinations = ["android/app/src/main/assets/public", "ios/App/App/public"];
    for (const rel of destinations) {
      mkdirSync(join(dir, rel, "assets/aistudio"), { recursive: true });
      writeFileSync(join(dir, rel, "icons.svg"), "existing-icon-fixture");
      writeFileSync(join(dir, rel, "assets/aistudio", "keep.txt"), "existing-asset-fixture");
    }
    const bridges = destinations.flatMap((rel) => ["cordova.js", "cordova_plugins.js"].map((name) => [rel, name, readFileSync(join(dir, rel, name))]));
    const script = join(dir, "scripts/sync-native-bundle.mjs");
    assert.equal(spawnSync(process.execPath, [script], { cwd: dir, timeout: 30000 }).status, 0);
    assert.equal(spawnSync(process.execPath, [script, "--check"], { cwd: dir, timeout: 30000 }).status, 0);
    for (const rel of destinations) {
      assert.equal(readFileSync(join(dir, rel, "icons.svg"), "utf8"), "existing-icon-fixture");
      assert.equal(readFileSync(join(dir, rel, "assets/aistudio", "keep.txt"), "utf8"), "existing-asset-fixture");
    }
    for (const [rel, name, contents] of bridges) assert.equal(Buffer.compare(readFileSync(join(dir, rel, name)), contents), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Web, Android and iOS DSP code and protected assertions match the pre-integration baseline", () => {
  const webHash = "2c47c153b256a4e3e276ca317d2c34ec517636d43387cfe8a29a9253aa7144ee";
  for (const path of [...rendererPaths, "android/app/src/main/assets/public/app.js", "ios/App/App/public/app.js"]) {
    const source = load(path);
    assert.equal(digest(between(source, "  const fx = { ctx: null, src: null, nodes: [] };", "  try {\n    audio.playsInline = true;")), "62e2e84642bd8f4a9083791c329564d375d1cdbc8c28c2bfdeb81e11b26d9578", path);
    assert.equal(digest(between(source, "  function hookSound() {", "  try {\n    audio.playsInline = true;")), webHash, path);
  }
  assert.equal(digest(between(load("android/app/src/main/java/app/muchi/music/MuchiAudioService.java"), "    /* ── 1.5.5 / 1.6.6 Sound Stage & Volume/Speed DSP", "    /* ── On-device YouTube")), "1825c1b148f1d59b9ce35b5994a9ab2a6fc174fd2a532d575f6778b5a23ffaea");
  assert.equal(digest(between(load("ios/App/App/MuchiAudioPlugin.swift"), "    private final class BiquadStage {", "    @objc public func getStatus(")), "d0a3d9f3f8d56c9051a5834c456c076bba17efdbb81ad84dfcdfb593d20793fc");
  const e2e = load("test/native-background-e2e.mjs");
  assert.equal(digest(between(e2e, 'import { readFileSync }', "// ── 1. Verify Phone-Speaker DSP")), "f5a596860998c4ce9f0a2a269ad148ee87f7ea2590fd4adb90fbd7744aa5d2d0");
  assert.equal(digest(between(e2e, 'assertE2E(\n  "DSP: WebAudio', "\n\nassertE2E(")), "1ca7eddcfc89d57dbc68ba1891c96a1db466c6a5e5368af74cd16aec8904effd");
  assert.equal(digest(between(e2e, 'assertE2E(\n  "DSP: Native Android', "\n\n// ── 1b.")), "ec31d04ac0dd7882103e65e604407103d6cc0ed5c0503822ed8df3d377558601");
});

const escapeHTML = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const button = () => ({ handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }, click() { return this.handlers.click && this.handlers.click(); } });

test("all renderers show Liked/Downloads counts and hide only custom sidebar counts", () => {
  for (const path of rendererPaths) {
    const source = load(path);
    const nav = { dataset: {}, innerHTML: "" };
    const state = { liked: [{}, {}], downloads: [{}], playlists: [{ name: "<Mix>", tracks: [{}, {}, {}] }], libraryLayout: "list", activePlaylist: null };
    const sandbox = { state, $: () => nav, document: { querySelectorAll: () => [] }, LIBRARY_COVER_ART: { liked: "liked", downloads: "downloads", folder: "folder" }, escapeHTML, escapeAttr: escapeHTML, playlistArt: () => "", isNativeApp: () => false };
    runInNewContext(`${between(source, "  function renderPlaylistsNav() {", "\n  function skeleton()")}; renderPlaylistsNav();`, sandbox);
    const row = (attribute) => nav.innerHTML.match(new RegExp(`<button[^>]*${attribute}[^>]*>[\\s\\S]*?<\\/button>`))?.[0] || "";
    const liked = row("data-open-liked"), downloaded = row("data-open-downloads"), custom = row('data-pl="0"');
    assert.ok(liked.includes("Liked songs") && /(?:>2<|· 2<)/.test(liked), path);
    assert.ok(downloaded.includes("Downloads") && /(?:>1<|· 1<)/.test(downloaded), path);
    assert.ok(custom.includes("&lt;Mix&gt;") && !custom.includes("library-nav-count") && !custom.includes("· 3"), path);
    assert.ok(source.includes('<p class="lib-stats">${trackStats(p.tracks)}</p>'), path);
  }
});

test("status, success and error toasts remain visible in each renderer", () => {
  for (const path of rendererPaths) {
    const source = load(path);
    const classes = new Set();
    const el = { hidden: true, textContent: "", innerHTML: "", children: [], classList: { add: (...items) => items.forEach((x) => classes.add(x)), remove: (...items) => items.forEach((x) => classes.delete(x)), toggle: (item, on) => on ? classes.add(item) : classes.delete(item) }, append(...items) { this.children = items; } };
    const sandbox = { $: () => el, document: { createElement: () => ({}) }, setTimeout: () => 1, clearTimeout: () => {} };
    const code = between(source, "  function showEl(el, on) {", "\n  function fmt(");
    runInNewContext(`${code}; toast("Status");`, sandbox);
    assert.equal(el.textContent, "Status", path);
    assert.equal(el.hidden, false, path);
    runInNewContext('toast("Error", true, "error")', sandbox);
    assert.ok(classes.has("error") && el.children.some((child) => child.textContent === "Error"), path);
    runInNewContext('toast("Success", true, "success")', sandbox);
    assert.ok(classes.has("success") && !classes.has("error") && el.children.some((child) => child.textContent === "Success"), path);
    runInNewContext('toast("Hidden", false)', sandbox);
    assert.ok(el.children.some((child) => child.textContent === "Success"), path);
  }
});

test("pin, sort, layout and playlist dialogs provide status feedback on all renderers", () => {
  for (const path of rendererPaths) {
    const source = load(path), messages = [];
    const state = { pinnedPlaylists: [], prefs: { libLayout: "list", trackSort: "newest" }, playlists: [{ name: "Original", tracks: [] }], view: "library" };
    let modal;
    const sort = button(); sort.dataset = { libSort: "alpha" }; sort.querySelector = () => ({ textContent: "Alphabetical" });
    const grid = button(), trackSort = button();
    const card = { querySelectorAll: () => [sort], querySelector: () => null };
    const sandbox = {
      state, asArray: (value) => Array.isArray(value) ? value : [], toast: (message) => messages.push(message),
      save: () => {}, savePrefs: () => {}, render: () => {}, hideModal: () => {}, renderPlaylistsNav: () => {}, savePlaylists: () => {},
      showModal: (spec) => { modal = spec; }, plEditorHTML: () => "", wirePlEditor: () => {}, clearDeletedPlaylistTombstone: () => {},
      $: (id) => id === "modalCard" ? card : id === "plName" ? { value: "Updated" } : null,
      viewEl: { querySelector: (id) => id === "#libGridToggle" ? grid : id === "#libSortTrackBtn" ? trackSort : null },
      openPinFoldersModal: () => {}, openLibSortModal: () => {},
    };
    runInNewContext(`${between(source, "  function togglePinItem(id) {", "\n  function sortSongsList(")}; togglePinItem("liked"); togglePinItem("liked");`, sandbox);
    assert.ok(messages.includes("Folder pinned to top") && messages.includes("Folder unpinned"), path);
    assert.equal(state.pinnedPlaylists.length, 0, path);
    runInNewContext(`${between(source, "  function openLibSortModal() {", "\n  function openPinFoldersModal(")}; openLibSortModal();`, sandbox);
    assert.equal(modal.title, "Sort & Filter Library", path);
    sort.click();
    assert.equal(state.prefs.trackSort, "alpha", path);
    assert.ok(messages.includes("Sorted: Alphabetical"), path);
    runInNewContext(between(source, '    const libGridToggle = viewEl.querySelector("#libGridToggle");', '    viewEl.querySelectorAll("[data-open-yt-liked]")'), sandbox);
    grid.click();
    assert.equal(state.prefs.libLayout, "grid", path);
    assert.ok(messages.includes("Squares view (Spotify style)"), path);
    trackSort.click();
    assert.ok(messages.includes("Sorted: New to Old"), path);
    runInNewContext(`${between(source, "  function openPlaylistEditor(index) {", "\n  function newPlaylist(")}; openPlaylistEditor(0);`, sandbox);
    assert.equal(modal.title, "Edit playlist", path);
    modal.onOk();
    assert.equal(state.playlists[0].name, "Updated", path);
    assert.ok(messages.includes("Playlist updated"), path);
    runInNewContext("openPlaylistEditor(-1)", sandbox);
    assert.equal(modal.title, "New playlist", path);
    modal.onOk();
    assert.ok(messages.includes("Playlist ready"), path);
  }
});

test("Spotify import succeeds or displays errors without suppressing feedback", async () => {
  for (const path of rendererPaths) {
    const source = load(path), messages = [];
    const fetchBtn = button(), saveBtn = button(), playBtn = button();
    const input = { value: "" };
    const preview = { innerHTML: "", querySelector: (id) => id === "#spSavePlBtn" ? saveBtn : id === "#spPlayNowBtn" ? playBtn : null };
    const card = { querySelector: (id) => id === "#spUrlInput" ? input : id === "#spFetchBtn" ? fetchBtn : id === "#spPreviewArea" ? preview : null };
    let modal, played = false;
    const sandbox = {
      state: { playlists: [] }, showModal: (spec) => { modal = spec; }, $: () => card, escapeHTML, escapeAttr: escapeHTML,
      toast: (message) => messages.push(message), hideModal: () => {}, savePlaylists: () => {}, render: () => {},
      clearDeletedPlaylistTombstone: () => {}, setTimeout: () => {}, playFromList: () => { played = true; },
      fetch: async () => ({ json: async () => ({ ok: true, title: "Imported", artist: "Fixture", tracks: [{ id: "a" }, { id: "b" }], trackCount: 2 }) }),
    };
    runInNewContext(`${between(source, "  function openSpotifyImportModal(initialUrl) {", "\n  function renderLibrary(")}; openSpotifyImportModal("");`, sandbox);
    assert.equal(modal.title, "Import from Spotify", path);
    await fetchBtn.click();
    assert.ok(messages.includes("Paste a Spotify link first"), path);
    input.value = "https://open.spotify.com/playlist/fixture";
    await fetchBtn.click();
    saveBtn.click();
    assert.equal(sandbox.state.playlists.length, 1, path);
    assert.ok(messages.some((message) => message.includes('Added "Imported" (2 songs)')), path);
    playBtn.click();
    assert.equal(played, true, path);
    sandbox.fetch = async () => { throw new Error("offline"); };
    await fetchBtn.click();
    assert.ok(preview.innerHTML.includes("Error connecting to service"), path);
    assert.equal(fetchBtn.disabled, false, path);
  }
});

test("new-release notifications respect the preference while retaining manual feedback", async () => {
  for (const path of rendererPaths) {
    const source = load(path), messages = [];
    let nextId = "new-a";
    const state = { following: [{ name: "Artist", lastId: "old" }], prefs: { notifyInApp: true }, view: "library" };
    const sandbox = { state, api: async () => ({ latest: { id: nextId, title: "Release" } }), glq: () => "", addReleaseNotification: () => true, toast: (message) => messages.push(message), saveFollowing: () => {}, saveNotificationEntries: () => {}, syncNotificationSurface: () => {} };
    runInNewContext(between(source, "  async function checkFollowReleases(manual = false) {", "\n  async function loadRadio("), sandbox);
    await sandbox.checkFollowReleases(false);
    assert.ok(messages.some((message) => message.includes("New release from Artist")), path);
    messages.length = 0;
    state.prefs.notifyInApp = false;
    nextId = "new-b";
    await sandbox.checkFollowReleases(true);
    assert.ok(!messages.some((message) => message.includes("New release from Artist")), path);
    assert.ok(messages.some((message) => message.includes("Found 1 new release")), path);
  }
});
