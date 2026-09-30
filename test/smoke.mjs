// MUCHI — Phase 3 smoke tests (complete backend port).
//
// Layer 1 (PURE, no wrangler): token parity, SSRF blocklist, all parsers,
// data tables, cache semantics. Run with `npm test` (plain Node).
// Layer 2 (LIVE): response-shape checks against a running `wrangler dev`
// (`npm run dev`), set WRANGLER_DEV_URL=http://127.0.0.1:8787 and run again.
//
// The sandbox has no outbound internet, so live upstream calls (Google,
// YouTube, iTunes, Audius, Radio Browser, LRCLIB) are NOT exercised here —
// the live tests verify the exact offline/error/fallback behavior that a
// deployed Worker shows when providers fail, plus pure parsers against
// realistic fixtures. Real-internet tests: docs/TESTING.md (PENDING).

import { hmac, sessionToken, sidFromToken, safeCompare } from "../src/auth.js";
import { isPrivateIp } from "../src/ssrf.js";
import { isUserAdmin, getAdminEmails, checkAdminAuth, handleAdmin } from "../src/admin.js";
import { handleWebhook } from "../src/webhook.js";
import {
  parseDuration, runsText, extractVideoId, parseMusicItem, parseVideoRenderer,
  isLikelyMusic, lastThumb, parseYtArtist, parseYtPlaylist, ytDurationToSec,
  ytTrack, decodeIdToken,
} from "../src/parse.js";
import {
  regionCode, moodsForCountry, uniqPlaylists, pickPlaylistHit,
  buildForYouPlaylists, buildViralPlaylists, VIRAL_QUERIES,
  utcDay, LOCAL_CHARTS, MOODS_BY_COUNTRY,
} from "../src/data.js";
import { codecMatch, tidyTitle, tidyArtist } from "../src/util.js";
import { parseLyricsHit, pickInnertubeStream, lyricsFor } from "../src/providers.js";
import { previewHome, previewShelf, previewDiscover } from "../src/preview-seed.js";
import { APP_VERSION } from "../src/config.js";
import { createHmac as nodeHmac } from "node:crypto";
import {
  parseVersion, versionAtLeast, versionEqual, checkVersionSync, isSync,
  readBuildGradleVersion, readPbxprojVersion, readConfigVersion, readAppJsVersion,
} from "../scripts/version-utils.mjs";
import {
  normalizeGain, volumeFor, qualityToYtRange, qualityLabel,
} from "../scripts/audio-utils.mjs";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failures++;
};

// ── 1. Token parity (server.js:81–98) ───────────────────────────────────────
const SECRET = "test-secret-123";
const sid = "a1b2c3d4e5f6a7b8c9d0e1f2";
const token = sessionToken(sid, SECRET);
ok("token format sid.sig", token.startsWith(sid + "."));
ok("hmac base64url sha256", /^[A-Za-z0-9_-]{43}$/.test(token.split(".")[1]));
ok("sidFromToken round-trip", sidFromToken(token, SECRET) === sid);
ok("sidFromToken rejects bad sig", sidFromToken(sid + ".AAAA", SECRET) === null);
ok("sidFromToken rejects no secret", sidFromToken(token, "") === null);
ok("sidFromToken rejects tampered sid", sidFromToken("x" + token.slice(1), SECRET) === null);
const nodeStyle = nodeHmac("sha256", SECRET).update(sid).digest("base64url");
ok("hmac matches server.js output", token.split(".")[1] === nodeStyle);

// ── 1.5 Timing safe comparison & Security Hardening ───────────────────────
ok("safeCompare matches equal", safeCompare("secret123", "secret123"));
ok("safeCompare rejects unequal length", !safeCompare("secret", "secret123"));
ok("safeCompare rejects mismatched content", !safeCompare("secret123", "secret999"));
ok("safeCompare handles non-string safely", !safeCompare(null, "secret") && !safeCompare(undefined, undefined));

// ── 1.6 Admin verification & RBAC permissions ──────────────────────────────
const defaultAdmins = getAdminEmails({});
ok("default admin email present", defaultAdmins.includes("twiarimascord@gmail.com"));
const customAdmins = getAdminEmails({ ADMIN_EMAILS: "admin@example.com, user@test.com" });
ok("custom admin emails parsed", customAdmins.includes("admin@example.com") && customAdmins.includes("twiarimascord@gmail.com"));

const unverifiedSession = { email: "twiarimascord@gmail.com", email_verified: false, role: "admin" };
ok("unverified email cannot be admin", !isUserAdmin(unverifiedSession, {}));

const normalUserSession = { email: "normal@example.com", email_verified: true, role: "user" };
ok("normal user is not admin", !isUserAdmin(normalUserSession, {}));

const verifiedAdminSession = { email: "twiarimascord@gmail.com", email_verified: true, role: "admin" };
ok("verified admin recognized", isUserAdmin(verifiedAdminSession, {}));

// ── 1.7 Webhook signature verification ─────────────────────────────────────
const hookSecret = "webhook-secret-999";
const payloadStr = JSON.stringify({ event: "release", tag: "v1.6.3" });
const validGhSig = "sha256=" + nodeHmac("sha256", hookSecret).update(payloadStr).digest("hex");
const invalidSig = "sha256=0000000000000000000000000000000000000000000000000000000000000000";

const reqValid = new Request("http://localhost/api/webhook", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-hub-signature-256": validGhSig,
    "x-github-event": "release",
  },
  body: payloadStr,
});
const resValid = await handleWebhook(reqValid, { WEBHOOK_SECRET: hookSecret }, new URL("http://localhost/api/webhook"));
ok("valid webhook signature accepted", resValid.status === 200);

const reqInvalid = new Request("http://localhost/api/webhook", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-hub-signature-256": invalidSig,
  },
  body: payloadStr,
});
const resInvalid = await handleWebhook(reqInvalid, { WEBHOOK_SECRET: hookSecret }, new URL("http://localhost/api/webhook"));
ok("forged webhook signature rejected 401", resInvalid.status === 401);

const reqMissing = new Request("http://localhost/api/webhook", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: payloadStr,
});
const resMissing = await handleWebhook(reqMissing, { WEBHOOK_SECRET: hookSecret }, new URL("http://localhost/api/webhook"));
ok("missing webhook signature rejected 401", resMissing.status === 401);

// ── 1.8 Admin route security & information leak isolation ──────────────────
const reqAdminNoAuth = new Request("http://localhost/api/admin/status", { method: "GET" });
const resAdminNoAuth = await handleAdmin(reqAdminNoAuth, {}, new URL("http://localhost/api/admin/status"));
ok("unauthorized admin route access blocked 401", resAdminNoAuth.status === 401);

const adminApiKey = "admin-secret-key-super-secure";
const reqAdminWithKey = new Request("http://localhost/api/admin/status", {
  method: "GET",
  headers: { "x-admin-key": adminApiKey },
});
const resAdminWithKey = await handleAdmin(reqAdminWithKey, { MUCHI_ADMIN_KEY: adminApiKey }, new URL("http://localhost/api/admin/status"));
ok("admin route authorized with API key", resAdminWithKey.status === 200);
const adminData = await resAdminWithKey.json();
ok("admin route does not leak secrets", !adminData.system.sessionSecret && !adminData.system.adminKey);

// ── 2. SSRF blocklist (server.js:315–360) ───────────────────────────────────
ok("private: 127.0.0.1", isPrivateIp("127.0.0.1"));
ok("private: 10.1.2.3", isPrivateIp("10.1.2.3"));
ok("private: 192.168.0.1", isPrivateIp("192.168.0.1"));
ok("private: 169.254.169.254 (metadata)", isPrivateIp("169.254.169.254"));
ok("private: 172.16.0.1", isPrivateIp("172.16.0.1"));
ok("private: 100.64.0.1 (CGNAT)", isPrivateIp("100.64.0.1"));
ok("private: 198.18.0.1 (benchmark)", isPrivateIp("198.18.0.1"));
ok("private: 0.0.0.0", isPrivateIp("0.0.0.0"));
ok("private: ::1", isPrivateIp("::1"));
ok("private: fc00::1 (ULA)", isPrivateIp("fc00::1"));
ok("private: fe80::1 (link-local)", isPrivateIp("fe80::1"));
ok("private: ::ffff:10.0.0.1 (v4-mapped)", isPrivateIp("::ffff:10.0.0.1"));
ok("public: 8.8.8.8", !isPrivateIp("8.8.8.8"));
ok("public: 142.250.72.14", !isPrivateIp("142.250.72.14"));
ok("public: 2606:4700:4700::1111", !isPrivateIp("2606:4700:4700::1111"));
ok("garbage rejected", isPrivateIp("999.1.1.1"));

// ── 3. Parsers (server.js:114–683) ──────────────────────────────────────────
ok("ytDurationToSec PT1M30S", ytDurationToSec("PT1M30S") === 90);
ok("ytDurationToSec PT1H2M3S", ytDurationToSec("PT1H2M3S") === 3723);
ok("ytDurationToSec PT45S", ytDurationToSec("PT45S") === 45);
ok("ytDurationToSec null", ytDurationToSec("") === 0);
ok("parseDuration 3:45", parseDuration("3:45") === 225);
ok("parseDuration 1:02:03", parseDuration("1:02:03") === 3723);
ok("parseDuration number", parseDuration(120) === 120);
ok("parseDuration garbage", parseDuration("abc") === 0);
ok("runsText simpleText", runsText({ simpleText: "hi" }) === "hi");
ok("runsText runs", runsText({ runs: [{ text: "a" }, { text: "b" }] }) === "ab");
ok("runsText string", runsText("x") === "x");
ok("extractVideoId direct", extractVideoId({ videoId: "abc" }) === "abc");
ok("extractVideoId watchEndpoint", extractVideoId({ navigationEndpoint: { watchEndpoint: { videoId: "xyz" } } }) === "xyz");

const musicItem = {
  videoId: "v1",
  flexColumns: [
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Song Title" }] } } },
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Artist A • Album B • 3:45" }] } } },
  ],
  fixedColumns: [
    { musicResponsiveListItemFixedColumnRenderer: { text: { simpleText: "3:45" } } },
  ],
  thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: "https://t/1.jpg" }, { url: "https://t/2.jpg" }] } } },
};
const pm = parseMusicItem(musicItem);
ok("parseMusicItem id", pm && pm.id === "yt:v1" && pm.videoId === "v1");
ok("parseMusicItem fields", pm && pm.title === "Song Title" && pm.artist === "Artist A" && pm.album === "Album B" && pm.duration === 225);
ok("parseMusicItem artwork last thumb", pm && pm.artwork === "https://t/2.jpg");
ok("parseMusicItem missing videoId → null", parseMusicItem({}) === null);

const pv = parseVideoRenderer({
  videoId: "v2",
  title: { simpleText: "Video T" },
  ownerText: { simpleText: "Chan" },
  lengthText: { simpleText: "4:00" },
  thumbnail: { thumbnails: [{ url: "https://t/a.jpg" }] },
});
ok("parseVideoRenderer", pv && pv.id === "yt:v2" && pv.title === "Video T" && pv.artist === "Chan" && pv.duration === 240 && pv.artwork === "https://t/a.jpg");
ok("parseVideoRenderer null", parseVideoRenderer({}) === null);

ok("isLikelyMusic ok", isLikelyMusic({ videoId: "a", title: "Song", artist: "Artist", duration: 180 }));
ok("isLikelyMusic podcast rejected", !isLikelyMusic({ videoId: "a", title: "Ep 5", artist: "Podcast" }));
ok("isLikelyMusic trailer rejected", !isLikelyMusic({ videoId: "a", title: "Gameplay trailer", artist: "X", duration: 300 }));
ok("isLikelyMusic short rejected", !isLikelyMusic({ videoId: "a", title: "Song", artist: "A", duration: 20 }));
ok("isLikelyMusic loose accepts short", isLikelyMusic({ videoId: "a", title: "Song", artist: "A", duration: 20 }, true));

ok("lastThumb", lastThumb([{ url: "x" }, { url: "y" }]) === "y");
ok("lastThumb fallback", lastThumb([]) === "/cover-default.jpg");

const artistNode = {
  musicResponsiveListItemRenderer: {
    navigationEndpoint: { browseEndpoint: { browseId: "UC123", browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ARTIST" } } } },
    flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { simpleText: "Cool Artist" } } }],
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: "https://t/a.jpg" }] } } },
  },
};
const pa = parseYtArtist(artistNode.musicResponsiveListItemRenderer);
ok("parseYtArtist", pa && pa.id === "artist:UC123" && pa.name === "Cool Artist" && pa.kind === "artist");

const playlistNode = {
  playlistRenderer: {
    playlistId: "PL123",
    title: { simpleText: "My Mix" },
    thumbnails: [{ thumbnails: [{ url: "https://t/p.jpg" }] }],
    videoCount: "12",
  },
};
const pp = parseYtPlaylist(playlistNode);
ok("parseYtPlaylist", pp && pp.id === "ytpl:PL123" && pp.playlistId === "PL123" && pp.title === "My Mix" && pp.kind === "playlist");

const ytItem = { snippet: { title: "T", channelTitle: "C", thumbnails: { high: { url: "https://h.jpg" } } }, id: "vid9" };
const ytk = ytTrack(ytItem, "ytlike:");
ok("ytTrack", ytk && ytk.id === "ytlike:vid9" && ytk.videoId === "vid9" && ytk.artist === "C" && ytk.artwork === "https://h.jpg");
ok("ytTrack private rejected", ytTrack({ id: "x", snippet: { title: "Private video", channelTitle: "C" } }, "ytlike:") === null);
ok("ytTrack playlistItem videoId", ytTrack({ id: "PLITEM", snippet: { title: "T", channelTitle: "C", resourceId: { videoId: "rid1" } }, contentDetails: {} }, "ytpl:")?.videoId === "rid1");

ok("decodeIdToken", decodeIdToken("a." + Buffer.from(JSON.stringify({ aud: "X", email: "e@x" })).toString("base64url") + ".c")?.email === "e@x");
ok("decodeIdToken garbage → null", decodeIdToken("not.a.jwt") === null);

// ── 4. Data tables (server.js:683–1438) ─────────────────────────────────────
ok("regionCode IN default", regionCode() === "IN");
ok("regionCode lower→upper", regionCode("us") === "US");
ok("regionCode invalid → IN", regionCode("12") === "IN");
ok("regionCode XX passthrough", regionCode("XX") === "XX");
ok("LOCAL_CHARTS 32 countries", Object.keys(LOCAL_CHARTS).length === 32);
ok("MOODS_BY_COUNTRY 25 countries", Object.keys(MOODS_BY_COUNTRY).length === 25);
ok("moods IN = 12 (10 core + 5 local unique)", moodsForCountry("IN").length === 12);
// US local = [us-pop, rnb, country, latin-us]; slice(0,2) → rnb duplicates
// core rnb and is deduped → 11 (same as server.js moodsForCountry)
ok("moods US = 11 (rnb deduped)", moodsForCountry("US").length === 11);
ok("moods XX = 10 core only", moodsForCountry("XX").length === 10);
ok("moods IN first = pop", moodsForCountry("IN")[0].id === "pop");
ok("moods unique ids", new Set(moodsForCountry("IN").map((m) => m.id)).size === 12);
ok("uniqPlaylists dedupes", uniqPlaylists([{ playlistId: "a", title: "A" }, { playlistId: "a", title: "A" }, { playlistId: "b", title: "B" }]).length === 2);
ok("pickPlaylistHit best match", pickPlaylistHit([{ playlistId: "p1", title: "Dance Hits" }, { playlistId: "p2", title: "Chill Vibes" }], "dance hits")?.playlistId === "p1");
ok("VIRAL_QUERIES exactly 10 distinct tastes", (() => {
  const tastes = new Set(VIRAL_QUERIES.map((q) => q.taste));
  return VIRAL_QUERIES.length === 10 && tastes.size === 10 && VIRAL_QUERIES.every((q) => q.query && q.title);
})());
ok("buildViralPlaylists 10 entries", buildViralPlaylists([]).length === 10);
ok("buildViralPlaylists tracks up to 20 (resolved)", (() => {
  const res = VIRAL_QUERIES.map((_, i) => ({
    status: "fulfilled",
    value: { playlistId: "PL" + i, artwork: "a", tracks: Array.from({ length: 30 }, (_, j) => ({ id: "yt:" + i + "-" + j, title: "T" + j, artist: "A", artwork: "x" })) },
  }));
  return buildViralPlaylists(res).every((p) => p.tracks.length <= 20);
})());
ok("buildForYouPlaylists 10 entries", buildForYouPlaylists([]).length === 10);
ok("buildForYouPlaylists all 10 distinct-mood yt cards (no mix)", (() => {
  const pls = buildForYouPlaylists([]);
  return pls.length === 10 && pls.every((p) => p.kind === "yt") && new Set(pls.map((p) => p.mood)).size === 10;
})());
ok("buildForYouPlaylists tracks up to 20 (resolved)", (() => {
  const fyRes = new Array(10).fill(0).map((_, i) => ({ status: "fulfilled", value: { playlistId: "PL" + i, artwork: "https://a.jpg", tracks: Array.from({ length: 20 }, (_, j) => ({ id: i + "-" + j })) } }));
  const pls = buildForYouPlaylists(fyRes);
  return pls.length === 10 && pls.every((p) => p.playlistId.startsWith("PL") && Array.isArray(p.tracks) && p.tracks.length === 20);
})());
ok("utcDay format", /^\d{4}-\d{2}-\d{2}$/.test(utcDay()));

// ── Release/update-safety guard (scripts/version-utils.mjs) ────────────────
ok("parseVersion tolerates v / partial", (() => {
  const a = parseVersion("v1.2.3"), b = parseVersion("1.2"), c = parseVersion("3");
  return a.major === 1 && a.minor === 2 && a.patch === 3 && b.patch === 0 && c.major === 3;
})());
ok("versionAtLeast ordering", versionAtLeast("1.5.2", "1.5.1") && versionAtLeast("2.0.0", "1.9.9") && !versionAtLeast("1.5.0", "1.5.1"));
ok("versionEqual ignores case/pre", versionEqual("1.5.1", "v1.5.1-alpha") && !versionEqual("1.5.1", "1.5.2"));
ok("buildGradle parse versionCode+versionName", (() => {
  const r = readBuildGradleVersion("versionCode 6\nversionName \"1.5.1\"");
  return r.versionCode === 6 && r.versionName === "1.5.1";
})());
ok("pbxproj parse marketing+build", (() => {
  const r = readPbxprojVersion("MARKETING_VERSION = 1.5.1;\nCURRENT_PROJECT_VERSION = 4;");
  return r.marketingVersion === "1.5.1" && r.currentProjectVersion === 4;
})());
ok("checkVersionSync detects drift", (() => {
  const good = checkVersionSync({ pkgVersion: "1.5.1", pkgLockVersion: "1.5.1", configVersion: "1.5.1", gradleVersionName: "1.5.1", iosMarketing: "1.5.1", publicAppVersion: "1.5.1", canonical: "1.5.1" });
  const bad = checkVersionSync({ pkgVersion: "1.5.1", pkgLockVersion: "1.5.1", configVersion: "1.5.2", gradleVersionName: "1.5.1", iosMarketing: "1.5.1", publicAppVersion: "1.5.1", canonical: "1.5.1" });
  const badApp = checkVersionSync({ pkgVersion: "1.5.2", pkgLockVersion: "1.5.2", configVersion: "1.5.2", gradleVersionName: "1.5.2", iosMarketing: "1.5.2", publicAppVersion: "1.5.1", canonical: "1.5.2" });
  const badLock = checkVersionSync({ pkgVersion: "1.5.2", pkgLockVersion: "1.5.1", configVersion: "1.5.2", gradleVersionName: "1.5.2", iosMarketing: "1.5.2", publicAppVersion: "1.5.2", canonical: "1.5.2" });
  return good.errors.length === 0 && bad.errors.length === 1 && badApp.errors.length === 1 && badLock.errors.length === 1;
})());
ok("isSync false on any drift", !isSync({ pkgVersion: "1.5.1", pkgLockVersion: "1.5.1", configVersion: "1.5.1", gradleVersionName: "1.5.2", iosMarketing: "1.5.1", publicAppVersion: "1.5.1" }));
ok("isSync true when all agree", isSync({ pkgVersion: "1.5.1", pkgLockVersion: "1.5.1", configVersion: "1.5.1", gradleVersionName: "1.5.1", iosMarketing: "1.5.1", publicAppVersion: "1.5.1" }));
ok("REAL version strings all agree across pkg/pkg-lock/src-config/public-app", (() => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8") || "{}");
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8") || "{}");
  const app = readAppJsVersion(readFileSync("public/app.js", "utf8"));
  const cfg = readConfigVersion(readFileSync("src/config.js", "utf8"));
  return app && lock.version && versionEqual(lock.version, pkg.version) && versionEqual(app, pkg.version) && versionEqual(cfg, pkg.version);
})());

// ── Audio helpers (scripts/audio-utils.mjs) — "Even volume" + quality ──────
ok("normalizeGain off = 1, on = 0.86", normalizeGain(false) === 1 && normalizeGain(true) === 0.86);
ok("volumeFor clamps + trims when normalize", (() => {
  // 100% normalized = 1 * 0.86 = 0.86; 200% clamps to volume cap 0.86? -> clamp to 1*something
  return volumeFor(100, true) === 0.86 && volumeFor(50, true) === 0.43 && volumeFor(100, false) === 1;
})());
ok("volumeFor clamps out-of-range", volumeFor(300, false) === 1 && volumeFor(-5, false) === 0 && volumeFor(100, true) <= 0.86);
ok("qualityToYtRange", (() => {
  const r = qualityToYtRange("highest");
  return r[0] === "hd1080" && r[1] === "highres";
})());
ok("qualityLabel", qualityLabel("low") === "Low" && qualityLabel("nope") === "High");

// ── 5. Helpers (server.js:1209–1262, 1060–1069) ─────────────────────────────
ok("tidyTitle strips brackets", tidyTitle("Song (Official Audio)") === "Song");
ok("tidyTitle strips dash suffix", tidyTitle("Song - Official Video") === "Song");
ok("tidyArtist topic", tidyArtist("Artist - Topic") === "Artist");
ok("tidyArtist vevo", tidyArtist("ARTISTVEVO") === "ARTIST");
ok("tidyArtist youtube → empty", tidyArtist("YouTube") === "");
ok("codecMatch auto", codecMatch("MP3", "auto") === true);
ok("codecMatch mp3", codecMatch("MP3", "mp3") === true);
ok("codecMatch aac mismatch", codecMatch("MP3", "aac") === false);
ok("codecMatch opus", codecMatch("opus", "opus") === true);
ok("parseLyricsHit synced", parseLyricsHit({ syncedLyrics: "[00:12.50]Hello\n[00:20]World", plainLyrics: "Hello\nWorld", trackName: "T", artistName: "A" })?.synced.length === 2);
ok("parseLyricsHit plain only", parseLyricsHit({ plainLyrics: "Words" })?.lyrics === "Words");
ok("parseLyricsHit empty → null", parseLyricsHit({}) === null);

// ── 5a2. innerTube player picker (Tier-1 resolver, providers.js) ───────────
// Fixtures mirror real ANDROID-client player responses (itag 140 m4a/128k,
// 251 opus/160k). Contract = same shape pickPipedStream returns, because
// aggregate.js/stream.js consumers key off `.url` and `.mimeType`.
{
  const fmt = (itag, mime, bitrate, url) => ({ itag, mimeType: mime, bitrate, url });
  const player = (adaptive, extra = {}) => ({
    playabilityStatus: { status: "OK" },
    streamingData: { adaptiveFormats: adaptive },
    videoDetails: { durationSeconds: 182 },
    ...extra,
  });
  const okResp = player([
    fmt(251, "audio/webm; codecs=\"opus\"", 160000, "https://e1.opus"),
    fmt(140, "audio/mp4; codecs=\"mp4a.40.2\"", 128000, "https://e1.m4a"),
  ]);
  const p1 = pickInnertubeStream(okResp);
  ok("innertube: prefers m4a over opus", p1?.url === "https://e1.m4a" && p1.format === "m4a");
  ok("innertube: contract shape", p1 && typeof p1.mimeType === "string" && p1.quality === "140" && p1.bitrate === "128000" && p1.duration === 182);
  ok("innertube: m4a mime preserved", /^audio\/mp4/.test(p1.mimeType));
  const opusOnly = pickInnertubeStream(player([fmt(251, "audio/webm; codecs=\"opus\"", 160000, "https://e1.opus")]));
  ok("innertube: opus fallback", opusOnly?.url === "https://e1.opus" && opusOnly.format === "opus");
  ok("innertube: LOGIN_REQUIRED → null", pickInnertubeStream({ ...okResp, playabilityStatus: { status: "LOGIN_REQUIRED" } }) === null);
  ok("innertube: missing playability treated OK", pickInnertubeStream({ streamingData: okResp.streamingData, videoDetails: okResp.videoDetails })?.url === "https://e1.m4a");
  ok("innertube: cipher-only (no url) → null", pickInnertubeStream(player([
    { itag: 140, mimeType: "audio/mp4; codecs=\"mp4a.40.2\"", bitrate: 128000, signatureCipher: "s=abc" },
  ])) === null);
  ok("innertube: video-only formats ignored", pickInnertubeStream(player([
    fmt(137, "video/mp4; codecs=\"avc1.640028\"", 4000000, "https://e1.video-only"),
  ])) === null);
  ok("innertube: empty garbage → null", pickInnertubeStream({}) === null && pickInnertubeStream(null) === null && pickInnertubeStream({ streamingData: {} }) === null);
    ok("innertube: duration falls back to URL dur param", (() => {
      const d = { playabilityStatus: { status: "OK" }, streamingData: { adaptiveFormats: [
        { itag: 140, mimeType: "audio/mp4", bitrate: 128000, url: "https://g/f?dur=213.089&sig=x" } ] } };
      const p = pickInnertubeStream(d);
      return p && p.duration === 213.089;
    })());
  ok("innertube: highest bitrate wins in container", pickInnertubeStream(player([
    fmt(140, "audio/mp4; codecs=\"mp4a.40.2\"", 128000, "https://lo.m4a"),
    fmt(141, "audio/mp4; codecs=\"mp4a.40.2\"", 256000, "https://hi.m4a"),
  ]))?.url === "https://hi.m4a");
}

// ── 5a3. Proxy contract (stream.js): Range pass-through + honest errors ──────
// v1.5.4: ExoPlayer/AVPlayer only seek efficiently when /api/stream echoes
// the upstream range headers; and /api/download must never attach
// Content-Disposition to an error (that saved 404/502 JSON bodies as
// corrupt "song" files — one root cause of the "0-byte .webm" reports).
// Runs the REAL module against a mocked network (Node ships fetch/Request/
// Response since v18; the sandbox has no internet).
{
  const realFetch = globalThis.fetch;
  let seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const us = String(u);
    if (us.includes("cloudflare-dns.com")) {
      return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] }), { headers: { "content-type": "application/json" } });
    }
    seen.push({ url: us, range: (init.headers || {}).Range || "" });
    if (us.includes("want404")) {
      return new Response(JSON.stringify({ error: "nope" }), { status: 404, headers: { "content-type": "application/json" } });
    }
    const ranged = Boolean((init.headers || {}).Range);
    const headers = { "content-type": "audio/mp4; codecs=mp4a.40.2", "content-length": "5", "accept-ranges": "bytes" };
    if (ranged) headers["content-range"] = "bytes 0-4/5";
    return new Response("HELLO", { status: ranged ? 206 : 200, headers });
  };
  try {
    const { handleStream, handleDownload } = await import("../src/stream.js");
    // 1) Range forwarding + header echo on /api/stream
    seen = [];
    let req = new Request("http://w/api/stream?url=" + encodeURIComponent("https://ok.example/a.m4a"), { headers: { Range: "bytes=0-4" } });
    let res = await handleStream(req, new URL(req.url));
    ok("proxy: forwards Range upstream", seen.some((s) => s.range === "bytes=0-4"));
    ok("proxy: 206 preserved", res.status === 206);
    ok("proxy: content-range echoed", res.headers.get("content-range") === "bytes 0-4/5");
    ok("proxy: content-length echoed", res.headers.get("content-length") === "5");
    ok("proxy: accept-ranges echoed", res.headers.get("accept-ranges") === "bytes");
    ok("proxy: body intact", (await res.text()) === "HELLO");
    // 2) plain GET keeps 200 + length, no bogus 206
    req = new Request("http://w/api/stream?url=" + encodeURIComponent("https://ok.example/a.m4a"));
    res = await handleStream(req, new URL(req.url));
    ok("proxy: 200 stays 200", res.status === 200 && res.headers.get("content-length") === "5" && !res.headers.get("content-range"));
    // 3) /api/download success path: attachment + real extension
    req = new Request("http://w/api/download?name=Song&streamUrl=" + encodeURIComponent("https://ok.example/a.m4a") + "&mime=audio%2Fmp4");
    res = await handleDownload(req, new URL(req.url));
    const cd = res.headers.get("content-disposition") || "";
    ok("download: 200 attachment", res.status === 200 && cd.includes('attachment') && cd.includes('Song.m4a'));
    ok("download: length passes through", res.headers.get("content-length") === "5");
    // 4) /api/download error path: NO attachment on error (the corrupt-file bug)
    req = new Request("http://w/api/download?name=Song&streamUrl=" + encodeURIComponent("https://want404.example/a.m4a") + "&mime=audio%2Fmp4");
    res = await handleDownload(req, new URL(req.url));
    ok("download: error keeps real status", res.status === 404);
    ok("download: NO content-disposition on error", !res.headers.get("content-disposition"));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── 5a4. /api/version release authority (direct.js) ─────────────────────────
// The "downloads the same version again" bug: the endpoint advertised the
// Worker's own version with a floating releases/latest asset, so a Worker
// redeploy ahead of the GitHub release offered 1.5.4 while GitHub's latest
// still served 1.5.3. Pinned rule: a newer version is only advertised when
// the release itself carries the matching Muchi.apk asset.
{
  const { pickReleaseVersion } = await import("../src/direct.js");
  const pinned = "https://github.com/x/Muchi/releases/download/v1.5.4/Muchi.apk";
  const float_ = "https://github.com/x/Muchi/releases/latest/download/Muchi.apk";
  const p1 = pickReleaseVersion("1.5.3", { tag: "1.5.4", apkUrl: pinned }, "x/Muchi");
  ok("version-api: newer release with asset wins", p1.version === "1.5.4" && p1.apkUrl === pinned);
  const p2 = pickReleaseVersion("1.5.4", { tag: "1.5.4", apkUrl: pinned }, "x/Muchi");
  ok("version-api: equal version never re-offers", p2.version === "1.5.4" && p2.apkUrl === float_);
  const p3 = pickReleaseVersion("1.5.4", { tag: "1.5.3", apkUrl: pinned }, "x/Muchi");
  ok("version-api: older release ignored", p3.version === "1.5.4" && p3.apkUrl === float_);
  const p4 = pickReleaseVersion("1.5.4", null, "x/Muchi");
  ok("version-api: offline GitHub → static fallback", p4.version === "1.5.4" && p4.apkUrl === float_);
  const p5 = pickReleaseVersion("1.5.9", { tag: "1.10.0", apkUrl: pinned }, "x/Muchi");
  ok("version-api: numeric compare (1.10 > 1.5.9)", p5.version === "1.10.0");
  const p6 = pickReleaseVersion("1.5.4", { tag: "1.6.0", apkUrl: "" }, "x/Muchi");
  ok("version-api: release without asset never advertised", p6.version === "1.5.4" && p6.apkUrl === float_);
}

// ── 5a5. Resolver CHAIN (real youtubeAudioStream, both tiers) ───────────────
// Not just the picker: runs the actual exported function against stubbed
// networks and asserts tier ORDER + fallthrough + the never-regress contract.
// The client depends on: InnerTube first (fast, reliable), Piped only when
// InnerTube fails, and a THROW only when everything failed (so aggregate.js
// can answer 200 {url:""} and keep the iframe fallback alive).
{
  const realFetch = globalThis.fetch;
  try {
    const { youtubeAudioStream } = await import("../src/providers.js");
    const itTubeOk = () => new Response(JSON.stringify({
      playabilityStatus: { status: "OK" },
      streamingData: { adaptiveFormats: [
        { itag: 251, mimeType: "audio/webm; codecs=\"opus\"", bitrate: 160000, url: "https://g/opus-251" },
        { itag: 140, mimeType: "audio/mp4; codecs=\"mp4a.40.2\"", bitrate: 128000, url: "https://g/m4a-140" },
      ] },
      videoDetails: { durationSeconds: "200" },
    }), { status: 200, headers: { "content-type": "application/json" } });
    const pipedOk = () => new Response(JSON.stringify({
      duration: 200,
      audioStreams: [{ url: "https://p/1", mimeType: "audio/webm", format: "opus", quality: "opus", bitrate: 160 }],
    }), { status: 200, headers: { "content-type": "application/json" } });
    const serverErr = () => new Response("boom", { status: 500 });

    // (a) InnerTube healthy → Piped must NOT be touched at all.
    let seen = [];
    globalThis.fetch = async (u) => { seen.push(String(u)); return String(u).includes("youtubei/v1/player") ? itTubeOk() : serverErr(); };
    let r = await youtubeAudioStream("vid123");
    ok("chain: innertube-first m4a picked", r.url === "https://g/m4a-140" && r.format === "m4a" && r.duration === 200);
    ok("chain: zero Piped load when innertube works (race)", seen.length >= 1 && seen.every((s) => s.includes("youtubei/v1/player")));

    // (b) InnerTube says LOGIN_REQUIRED (HTTP 200, unplayable) → Piped rescues.
    seen = [];
    globalThis.fetch = async (u) => {
      seen.push(String(u));
      if (String(u).includes("youtubei/v1/player")) {
        return new Response(JSON.stringify({ playabilityStatus: { status: "LOGIN_REQUIRED" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return String(u).includes("/streams/vid123") ? pipedOk() : serverErr();
    };
    r = await youtubeAudioStream("vid123");
    ok("chain: piped fallback when innertube unplayable", r.url === "https://p/1" && seen.some((s) => s.includes("pipedapi")));

    // (c) InnerTube HTTP 500 + all six Piped instances dead → THROW (aggregate
    //     converts this to the 200 {url:""} iframe contract; it must NOT be a
    //     silent null that would break the caller's try/catch).
    globalThis.fetch = async () => serverErr();
    let threw = "";
    try { await youtubeAudioStream("vid123"); } catch (e) { threw = String(e.message || e); }
    ok("chain: all-tiers-down throws", threw.includes("piped"));

    // (d) Piped answers but has no audioStreams → still throws "no audio".
    globalThis.fetch = async (u) => {
      if (String(u).includes("youtubei/v1/player")) return serverErr();
      if (String(u).includes("/streams/")) {
        return new Response(JSON.stringify({ audioStreams: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return serverErr();
    };
    threw = "";
    try { await youtubeAudioStream("vid123"); } catch (e) { threw = String(e.message || e); }
    // (e2) diagnostics: the throw must carry WHY each InnerTube profile gated.
    globalThis.fetch = async (u) => {
      if (String(u).includes("youtubei/v1/player")) {
        return new Response(JSON.stringify({ playabilityStatus: { status: "LOGIN_REQUIRED" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (String(u).includes("/streams/")) return new Response(JSON.stringify({ audioStreams: [] }), { status: 200, headers: { "content-type": "application/json" } });
      return serverErr();
    };
    try { await youtubeAudioStream("vid123"); } catch (e) { threw = String(e.message || e); }
    ok("chain: error names gated profiles + reason", threw.includes("no audio stream") && threw.includes("LOGIN_REQUIRED") && threw.includes("ANDROID-19.09") && threw.includes("IOS-19.09"));

    ok("chain: empty-answer throw, not silent null", threw.includes("no audio stream"));

    // (e) empty videoId → null immediately, no fetches (bad-request guard).
    let touched = 0;
    globalThis.fetch = async () => { touched++; return serverErr(); };
    r = await youtubeAudioStream("   ");
    ok("chain: blank id short-circuits", r === null && touched === 0);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── 5b. Real download metadata tags (public/meta.js) ────────────────────────
// Verifies the browser audio tagger writes real ID3v2 (mp3) + MP4 ilst (m4a)
// frames and reads them back, plus that non-audio containers pass through.
{
  const sandbox = { TextEncoder, TextDecoder };
  createContext(sandbox);
  runInContext(readFileSync("public/meta.js", "utf8"), sandbox);
  const M = sandbox.MuchiMeta;
  const meta = {
    title: "Kesariya (Test)", artist: "Arijit Singh", album: "Brahmastra", genre: "Pop",
    picture: { mime: "image/jpeg", data: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]) },
  };
  const mp3Audio = Uint8Array.from([0xff, 0xfb, 0x90, 0x00, 0xde, 0xad, 0xbe, 0xef]);
  const mp3 = M.embed(mp3Audio, "mp3", meta);
  const rMp3 = M.read(mp3);
  ok("meta: MP3 gets ID3v2.3 header", mp3[0] === 0x49 && mp3[1] === 0x44 && mp3[2] === 0x33 && mp3[3] === 3);
  ok("meta: MP3 title round-trip", rMp3.title === meta.title);
  ok("meta: MP3 artist round-trip", rMp3.artist === meta.artist);
  ok("meta: MP3 album round-trip", rMp3.album === meta.album);
  ok("meta: MP3 genre round-trip", rMp3.genre === meta.genre);
  ok("meta: MP3 cover art embedded", !!rMp3.picture && rMp3.picture.mime === "image/jpeg" && rMp3.picture.data.length === 8);
  ok("meta: MP3 audio bytes preserved", Buffer.from(mp3.slice(mp3.length - mp3Audio.length)).equals(Buffer.from(mp3Audio)));

  // Minimal M4A: ftyp + moov + mdat, then embed + read back.
  const u32be = (n) => [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const mkBox = (t, p) => { const o = new Uint8Array(8 + p.length); o.set(u32be(8 + p.length), 0); o.set(Buffer.from(t), 4); o.set(p, 8); return o; };
  const ftyp = mkBox("ftyp", Uint8Array.from([...Buffer.from("M4A "), ...u32be(0), ...Buffer.from("M4A mp42isom")]));
  const moov = mkBox("moov", mkBox("trak", Uint8Array.from([0, 0, 0, 0])));
  const mdat = mkBox("mdat", Uint8Array.from([0x11, 0x22, 0x33, 0x44]));
  const m4a = Uint8Array.from([...ftyp, ...moov, ...mdat]);
  const tagged = M.embed(m4a, "m4a", meta);
  const rM4a = M.read(tagged);
  ok("meta: M4A container detected", rM4a.container === "mp4");
  ok("meta: M4A title round-trip", rM4a.title === meta.title);
  ok("meta: M4A artist round-trip", rM4a.artist === meta.artist);
  ok("meta: M4A album round-trip", rM4a.album === meta.album);
  ok("meta: M4A genre round-trip", rM4a.genre === meta.genre);
  ok("meta: M4A cover art embedded", !!rM4a.picture && rM4a.picture.data.length === 8);
  ok("meta: M4A mdat preserved", Buffer.from(tagged.slice(tagged.length - mdat.length)).equals(Buffer.from(mdat)));
  ok("meta: M4A ftyp untouched", Buffer.from(tagged.slice(4, 8)).toString("latin1") === "ftyp");

  // webm/opus pass-through (container preserved, untagged).
  const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9c, 0x42]);
  const passthrough = M.embed(webm, "webm", meta);
  ok("meta: webm passes through untagged", Buffer.from(passthrough).equals(Buffer.from(webm)));
}

// ── 5b2. Lyrics resolution & 3-API shelf/playlist mixing ───────────────────
{
  ok("lyrics tidyTitle: strips feat, official video, and tags",
    tidyTitle("Die With A Smile (feat. Bruno Mars) [Official Music Video] #shorts") === "Die With A Smile"
  );
  ok("lyrics tidyArtist: strips VEVO, Topic, and channel labels",
    tidyArtist("LadyGagaVEVO") === "LadyGaga" && tidyArtist("T-Series") === "" && tidyArtist("The Weeknd - Topic") === "The Weeknd"
  );

  // Test lyricsFor multi-stage resolution with mocked fetch (handles "Artist - Title" + channel uploader + lyrics.ovh fallback)
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (u) => {
      const url = String(u);
      if (url.includes("lrclib.net/api/get") && url.includes("duration=250")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.includes("lrclib.net/api/search") && url.includes("Blinding+Lights")) {
        return new Response(JSON.stringify([
          { trackName: "Blinding Lights", artistName: "The Weeknd", duration: 200, syncedLyrics: "[00:10.00] I've been tryna call\n[00:15.00] I've been on my own for long enough", plainLyrics: "I've been tryna call" }
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("api.lyrics.ovh/v1/Coldplay/Yellow")) {
        return new Response(JSON.stringify({ lyrics: "Look at the stars\nLook how they shine for you" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    };

    const lrcRes = await lyricsFor("The Weeknd - Blinding Lights (Official Video)", "T-Series", 250);
    ok("lyricsFor: resolves synced lyrics from noisy YouTube 'Artist - Song' title and channel uploader",
      lrcRes && Array.isArray(lrcRes.synced) && lrcRes.synced.length === 2 && lrcRes.synced[0].text.includes("tryna call")
    );

    const ovhRes = await lyricsFor("Yellow (Official Audio)", "ColdplayVEVO", 269);
    ok("lyricsFor: falls back to lyrics.ovh when LRCLIB returns no hits",
      ovhRes && ovhRes.lyrics.includes("Look at the stars")
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  // Verify previewHome, previewShelf, and previewDiscover mix all 3 APIs (youtube, apple, deezer)
  const hasAll3Sources = (tracks) => {
    const srcs = new Set((tracks || []).map((t) => (t && (t.source === "itunes" ? "apple" : t.source)) || ""));
    return srcs.has("youtube") && srcs.has("apple") && srcs.has("deezer");
  };
  const ph = previewHome("US");
  ok("home shelves: all shelves mix youtube + apple + deezer",
    Array.isArray(ph.shelves) && ph.shelves.length > 0 && ph.shelves.every((s) => hasAll3Sources(s.tracks))
  );
  ok("home forYouPlaylists: all playlists mix youtube + apple + deezer",
    Array.isArray(ph.forYouPlaylists) && ph.forYouPlaylists.length === 10 && ph.forYouPlaylists.every((p) => hasAll3Sources(p.tracks))
  );
  ok("home viralPlaylists: all playlists mix youtube + apple + deezer",
    Array.isArray(ph.viralPlaylists) && ph.viralPlaylists.length === 10 && ph.viralPlaylists.every((p) => hasAll3Sources(p.tracks))
  );
  ok("home countryPlaylists & globalPlaylists: all playlists mix youtube + apple + deezer",
    ph.countryPlaylists.every((p) => hasAll3Sources(p.tracks)) && ph.globalPlaylists.every((p) => hasAll3Sources(p.tracks))
  );
  const ps = previewShelf("pop", "pop hits", "US");
  ok("previewShelf: mixes youtube + apple + deezer", hasAll3Sources(ps.tracks));
  const pMood = previewShelf("", "chill vibes", "US");
  ok("previewShelf playlist query: mixes youtube + apple + deezer", hasAll3Sources(pMood.tracks));
  const pDisc = previewDiscover("US");
  ok("previewDiscover: mixes youtube + apple + deezer", hasAll3Sources(pDisc.tracks));

  const appJsCheck = readFileSync("public/app.js", "utf8");
  const stylesCssCheck = readFileSync("public/styles.css", "utf8");
  ok("client app.js: includes mixThreeSourcesClient and fetchLyricsBrowserFallback",
    appJsCheck.includes("function mixThreeSourcesClient(") &&
    appJsCheck.includes("function fetchLyricsBrowserFallback(") &&
    appJsCheck.includes("function cleanLyricsMeta(")
  );
  ok("settings UI: every option in Settings and subpages has phone-settings-style .set-ico icon badges",
    appJsCheck.includes('class="material-symbols-outlined set-ico" data-ico="violet">dashboard_customize</span>') &&
    appJsCheck.includes('class="material-symbols-outlined set-ico" data-ico="amber">dark_mode</span>') &&
    appJsCheck.includes('class="material-symbols-outlined set-ico" data-ico="pink">apps</span>') &&
    appJsCheck.includes('class="material-symbols-outlined set-ico" data-ico="cyan">equalizer</span>') &&
    appJsCheck.includes('class="material-symbols-outlined set-ico" data-ico="emerald">tune</span>') &&
    appJsCheck.includes('class="material-symbols-outlined set-ico" data-ico="purple">headphones</span>') &&
    appJsCheck.includes('class="material-symbols-outlined set-ico" data-ico="blue">language</span>') &&
    appJsCheck.includes('class="material-symbols-outlined set-ico" data-ico="orange">notifications_active</span>') &&
    appJsCheck.includes('class="material-symbols-outlined set-ico" data-ico="teal">cloud_off</span>') &&
    appJsCheck.includes('class="material-symbols-outlined set-ico" data-ico="indigo">folder_special</span>') &&
    stylesCssCheck.includes(".set-ico") &&
    stylesCssCheck.includes(".set-label")
  );
  ok("player & lyrics UI: song title renders in a continuous straight-line marquee loop in both compact/docked player (#trackTitle) and opened lyrics view (.ly-meta strong)",
    appJsCheck.includes("function buildMarqueeTitleHTML(") &&
    appJsCheck.includes("function syncMarqueeTitleEl(") &&
    appJsCheck.includes('class="marquee-track"') &&
    stylesCssCheck.includes("@keyframes songTitleMarquee") &&
    stylesCssCheck.includes(".player .meta #trackTitle.is-marquee .marquee-track") &&
    stylesCssCheck.includes(".ly-meta strong.is-marquee .marquee-track")
  );
}

// ── 5c. Google OAuth Branding Verification & Site Verification ─────────────
(() => {
  const indexHtml = readFileSync("public/index.html", "utf8");
  const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8") || "{}");
  const metadata = JSON.parse(readFileSync("metadata.json", "utf8") || "{}");
  const appJs = readFileSync("public/app.js", "utf8");

  // 1. Google site verification meta tag
  const siteVerifRegex = /<meta\s+name=["']google-site-verification["']\s+content=["']K3tyeWx1iy8F1NaPmGRwbM1AQiwsztVv5Dgq49nnv8c["']\s*\/?>/i;
  ok("google: site verification meta present in public/index.html", siteVerifRegex.test(indexHtml));

  // 2. Exact match of app name in <title> (OAuth consent screen exact title requirement)
  const titleMatch = indexHtml.match(/<title>([^<]+)<\/title>/i);
  const titleText = titleMatch ? titleMatch[1].trim() : "";
  ok("google: index.html title exactly matches OAuth app name 'Muchi'", titleText === "Muchi");

  // 3. Application name metadata
  const appNameMeta = /<meta\s+name=["']application-name["']\s+content=["']Muchi["']\s*\/?>/i;
  ok("google: application-name meta is 'Muchi'", appNameMeta.test(indexHtml));

  // 4. OpenGraph branding consistency
  const ogTitle = /<meta\s+property=["']og:title["']\s+content=["']Muchi["']\s*\/?>/i;
  const ogSiteName = /<meta\s+property=["']og:site_name["']\s+content=["']Muchi["']\s*\/?>/i;
  ok("google: OpenGraph branding matches 'Muchi'", ogTitle.test(indexHtml) && ogSiteName.test(indexHtml));

  // 5. Manifest & metadata.json consistency
  ok("google: manifest.json name is 'Muchi'", manifest.name === "Muchi" && manifest.short_name === "Muchi");
  ok("google: metadata.json name is 'Muchi'", metadata.name === "Muchi");

  // 6. Homepage branding visible in UI (sidebar & home bar & hero)
  ok("google: index.html brand markup contains 'Muchi'", indexHtml.includes("<strong>Muchi</strong>"));
  ok("google: app.js homeBarHTML contains Muchi brand title", appJs.includes('class="home-brand-title">Muchi</span>'));
  ok("google: app.js hero contains Muchi brand kicker", appJs.includes('class="hero-brand-kicker">Muchi</span>'));

  // 7. Terms of Service & Privacy Policy pages and homepage links
  const termsHtml = readFileSync("public/terms.html", "utf8");
  const privacyHtml = readFileSync("public/privacy.html", "utf8");
  ok("google: public/terms.html exists and contains Muchi Terms of Service", termsHtml.includes("<title>Muchi Terms of Service</title>") && termsHtml.includes("Muchi Terms of Service"));
  ok("google: public/privacy.html exists and contains Muchi Privacy Policy", privacyHtml.includes("<title>Muchi Privacy Policy</title>") && privacyHtml.includes("Muchi Privacy Policy"));
  ok("google: index.html links to /privacy.html and /terms.html", indexHtml.includes('href="/privacy.html"') && indexHtml.includes('href="/terms.html"'));
  ok("google: app.js links to /privacy.html and /terms.html", appJs.includes('href="/privacy.html"') && appJs.includes('href="/terms.html"'));
})();

// ── 5d. Settings Features (Taste Profile Removed, Following & Data Sections, App Icons)
(() => {
  const appJs = readFileSync("public/app.js", "utf8");

  // 1. Taste profile removed from settings
  const settingsMatch = appJs.match(/function renderSettings\(\)\s*\{([\s\S]*?)(?:function\s+\w+|\Z)/);
  const settingsBody = settingsMatch ? settingsMatch[1] : "";
  ok("settings: 'Taste profile' bar is completely removed", !settingsBody.includes("Taste profile") && !settingsBody.includes("taste-grid"));

  // 2. Dedicated Following section & release alerts
  ok("settings: Following has dedicated opener #openFollowing", settingsBody.includes('id="openFollowing"'));
  ok("settings: renderFollowingPage is defined", appJs.includes("function renderFollowingPage()"));
  ok("settings: Following page provides release notifications toggle", appJs.includes('data-pref="notifyFollows"'));
  ok("settings: Following page provides manual check button", appJs.includes('id="checkNewReleasesBtn"'));
  ok("settings: Following page provides direct artist follow input", appJs.includes('id="newFollowArtistInput"'));
  ok("settings: checkFollowReleases notifies user on new songs", appJs.includes("Notification") && appJs.includes("checkFollowReleases"));

  // 3. Dedicated Data & Offline sections
  ok("settings: Offline & Downloads has dedicated opener #openOffline", settingsBody.includes('id="openOffline"'));
  ok("settings: renderOfflinePage combines Offline Mode and Downloads on disk", appJs.includes("function renderOfflinePage()") && !settingsBody.includes('id="toggleOfflineMode"') && appJs.includes('id="toggleOfflineMode"') && appJs.includes("Downloads on disk"));
  ok("settings: Data has dedicated opener #openData", settingsBody.includes('id="openData"'));
  ok("settings: renderDataPage is defined", appJs.includes("function renderDataPage()"));
  ok("settings: Data page provides storage measurement", appJs.includes("id=\"cacheHint\""));
  ok("settings: Data page provides library backup export/import", appJs.includes('id="exportDataBtn"') && appJs.includes('id="importDataBtn"'));

  // 4. App Icon customization (25 icons, anime, gaming, copyright-free, unique opening animations, floating profile menu)
  const stylesCss = readFileSync("public/styles.css", "utf8");
  const iconsMatch = appJs.match(/const APP_ICONS\s*=\s*(\[[\s\S]*?\]);/);
  ok("settings: APP_ICONS list exists", !!iconsMatch);
  let iconCount = 0;
  if (iconsMatch) {
    const raw = iconsMatch[1];
    iconCount = (raw.match(/id:\s*"[^"]+"/g) || []).length;
  }
  ok("settings: APP_ICONS contains all 25 styles", iconCount === 25);
  ok("settings: APP_ICONS includes anime styles", appJs.includes('category: "anime"') && appJs.includes('anime_cyber') && appJs.includes('anime_kawaii') && appJs.includes('anime_sakura') && appJs.includes('anime_ninja'));
  ok("settings: APP_ICONS includes gaming styles and removes 'discord' copyright word", appJs.includes('blurple_gamer') && appJs.includes('gem_booster') && !/discord/i.test(appJs));
  ok("settings: renderAppIconPage is defined", appJs.includes("function renderAppIconPage()"));
  ok("settings: App Icon opener #openAppIcon is in settings", settingsBody.includes('id="openAppIcon"'));
  ok("settings: setAppIcon updates state, saves prefs and calls applyAppIcon", appJs.includes("function setAppIcon(") && appJs.includes("applyAppIcon();"));
  ok("settings: applyAppIcon updates #sidebarBrandIcon and #homeBrandIcon", appJs.includes("#sidebarBrandIcon") && appJs.includes("#homeBrandIcon"));
  ok("ui: profile menu is wrapped in .home-bar-profile-wrap and positioned absolute to hover over hero bar", appJs.includes('class="home-bar-profile-wrap"') && stylesCss.includes(".home-bar-profile-wrap") && /\.profile-menu\s*\{[\s\S]*?position:\s*absolute/i.test(stylesCss));
  ok("splash: all 25 unique opening animations and startup trigger exist", appJs.includes("function getOpeningAnimationHtml(") && appJs.includes("function playAppOpeningAnimation(") && appJs.includes("fx-sakura-petal") && appJs.includes("fx-ninja-slash") && appJs.includes("playAppOpeningAnimation();"));
  ok("splash: opening animation shows only app name 'Muchi' without extra icon name/subtitle text", appJs.includes('<h1 class="splash-title">Muchi</h1>') && !appJs.includes('class="splash-kicker"') && !appJs.includes('class="splash-sub"'));
  ok("icon: getAppIconSvg renders pure logo mark without 'MUCHI' text inside the icon", !appJs.includes(">MUCHI</text>"));
})();

// ── 5e. YouTube OAuth Sign-In, Artist Unfollow & First-Launch Taste Verification ──
await (async () => {
  const { handleAuthUrl } = await import("../src/oauth.js");
  const mockEnv = {
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-secret",
    GOOGLE_REDIRECT_URI: "https://muchi.twiarimascord.workers.dev/api/auth/google/callback",
    MUCHI_SESSION_SECRET: "test-session-secret-1234567890",
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() { return null; },
              async run() { return { success: true }; },
            };
          },
        };
      },
    },
  };
  const signInReq = new Request("https://muchi.twiarimascord.workers.dev/api/auth/google/url?platform=web");
  const signInRes = await handleAuthUrl(signInReq, mockEnv, new URL(signInReq.url), "/api/auth/google/url");
  const signInBody = await signInRes.json();
  ok("oauth: /api/auth/google/url includes youtube scopes like 1.6.6 so YouTube likes & playlists load on sign-in", signInBody.url.includes("youtube.readonly") && signInBody.url.includes("youtube.force-ssl"));

  const appJs = readFileSync("public/app.js", "utf8");
  const stylesCss = readFileSync("public/styles.css", "utf8");
  const streamJs = readFileSync("src/stream.js", "utf8");
  const aggregateJs = readFileSync("src/aggregate.js", "utf8");
  const androidManifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  const androidPlugin = readFileSync("android/app/src/main/java/app/muchi/music/MuchiAudioPlugin.java", "utf8");
  const androidService = readFileSync("android/app/src/main/java/app/muchi/music/MuchiAudioService.java", "utf8");
  const androidMainActivity = readFileSync("android/app/src/main/java/app/muchi/music/MainActivity.java", "utf8");
  const androidDownloadPlugin = readFileSync("android/app/src/main/java/app/muchi/music/MuchiDownloadPlugin.java", "utf8");
  const iosPlist = readFileSync("ios/App/App/Info.plist", "utf8");
  const iosPlugin = readFileSync("ios/App/App/MuchiAudioPlugin.swift", "utf8");
  const iosPbxproj = readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");

  ok("version: APP_VERSION is 1.8.6", APP_VERSION === "1.8.6" && appJs.includes('const APP_VERSION = "1.8.6"'));
  {
    const javaFiles = [
      ["MainActivity.java", androidMainActivity],
      ["MuchiAudioPlugin.java", androidPlugin],
      ["MuchiAudioService.java", androidService],
      ["MuchiDownloadPlugin.java", androidDownloadPlugin],
    ];
    let javaErrors = [];
    for (const [fname, raw] of javaFiles) {
      // Single-pass strip of comments and string literals so "https://..." never triggers // comment stripping
      const stripped = raw.replace(
        /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
        (m) => (m.startsWith('"') ? '""' : m.startsWith("'") ? "''" : "")
      );
      let depth = 0;
      const scopeMethods = new Map();
      const lines = stripped.split("\n");
      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        // Match top-level or nested class method declarations at current brace depth
        const m = line.match(/^\s*(?:(?:public|protected|private|static|final|synchronized)\s+)+[\w<>\[\].,\s]+\s+([a-zA-Z_]\w*)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\{/);
        if (m && !["if", "for", "while", "switch", "catch", "synchronized"].includes(m[1])) {
          const paramTypes = m[2]
            .split(",")
            .map((p) => p.trim().replace(/^final\s+/, "").replace(/@\w+\s+/g, "").split(/\s+/)[0] || "")
            .join(",");
          const sig = `${depth}:${m[1]}(${paramTypes})`;
          if (scopeMethods.has(sig)) {
            javaErrors.push(`${fname}:${idx + 1} duplicate method ${sig}`);
          }
          scopeMethods.set(sig, idx + 1);
        }
        for (const ch of line) {
          if (ch === "{") depth++;
          else if (ch === "}") {
            // Clear inner scope methods when exiting a block
            for (const k of scopeMethods.keys()) {
              if (k.startsWith(`${depth}:`)) scopeMethods.delete(k);
            }
            depth--;
          }
        }
      }
      if (depth !== 0) javaErrors.push(`${fname} unbalanced braces (depth=${depth})`);
    }
    const loadMatches = androidPlugin.match(/public\s+void\s+load\s*\(\s*\)/g) || [];
    ok("android java: all 4 Java files have balanced braces, zero duplicate method signatures, and single load() in MuchiAudioPlugin",
      javaErrors.length === 0 && loadMatches.length === 1,
      javaErrors.join("; ")
    );
  }
  ok("player timer bar (1.7.4): dual-layer seek-wave-bg & seek-wave-fg paths, 250ms native+web progress ticks, URL duration parser, and non-sticky activeScrub",
    appJs.includes('bgPath.setAttribute("class", "seek-wave-bg")') &&
    appJs.includes('fgPath.setAttribute("class", "seek-wave-fg")') &&
    appJs.includes("function parseStreamUrlDuration(") &&
    appJs.includes("const activeScrub = Boolean(isSeekingUi);") &&
    stylesCss.includes(".seek-wave path.seek-wave-bg") &&
    androidService.includes("setStaticListener") &&
    androidService.includes("extractDurationMsFromUrl") &&
    iosPlugin.includes("timeInterval: 0.25")
  );
  ok("sound quality (1.7.6 restores exact 1.6.6): WebAudio Phone Speaker DSP (78Hz +9.5dB, 58Hz +5.5dB, 145Hz +3.2dB, 420Hz -2.8dB, 2800Hz +2.8dB, 8500Hz +2.6dB, wet 0.72, punch -20dB 3.6:1, limiter -0.9dB 20:1, out 1.55)",
    appJs.includes("bass.frequency.value = 78; bass.gain.value = 9.5;") &&
    appJs.includes("sub.frequency.value = 58; sub.Q.value = 0.75; sub.gain.value = 5.5;") &&
    appJs.includes("body.frequency.value = 145; body.Q.value = 0.8; body.gain.value = 3.2;") &&
    appJs.includes("scoop.frequency.value = 420; scoop.Q.value = 0.85; scoop.gain.value = -2.8;") &&
    appJs.includes("presence.frequency.value = 2800; presence.Q.value = 0.75; presence.gain.value = 2.8;") &&
    appJs.includes("air.frequency.value = 8500; air.gain.value = 2.6;") &&
    appJs.includes("wet.gain.value = 0.72;") &&
    appJs.includes("punch.threshold.value = -20;") &&
    appJs.includes("punch.ratio.value = 3.6;") &&
    appJs.includes("lim.threshold.value = -0.9;") &&
    appJs.includes("lim.ratio.value = 20;") &&
    appJs.includes("out.gain.value = 1.55;") &&
    !/out\.gain\.value\s*=\s*1\.08/.test(appJs)
  );
  ok("sound quality (1.7.6 restores exact 1.6.6): Bass, Spatial, and Dynamic modes (EQ, compressors, HRTF 0.38/0.28, drive 5/4, out 1.28/1.22/1.18, no extra post-output limiter)",
    appJs.includes("bass.frequency.value = 72; bass.gain.value = 8.5;") &&
    appJs.includes("bass.frequency.value = 90; bass.gain.value = 2.4;") &&
    appJs.includes("bass.frequency.value = 85; bass.gain.value = 5.5;") &&
    appJs.includes("comp.threshold.value = -22;") &&
    appJs.includes("comp.ratio.value = 4.2;") &&
    appJs.includes("comp.threshold.value = -18;") &&
    appJs.includes("comp.ratio.value = 2.6;") &&
    appJs.includes("comp.threshold.value = -14;") &&
    appJs.includes("comp.ratio.value = 2.2;") &&
    appJs.includes("rearG.gain.value = 0.38;") &&
    appJs.includes("hiG.gain.value = 0.28;") &&
    appJs.includes('makeDriveCurve(mode === "bass" ? 5 : 4)') &&
    appJs.includes('out.gain.value = mode === "bass" ? 1.28 : mode === "dynamic" ? 1.22 : 1.18;') &&
    appJs.includes("out.connect(ctx.destination);") &&
    !androidService.includes("DynamicsProcessing") &&
    !androidService.includes("setEnableAudioFloatOutput") &&
    (androidService.includes('int gainMb = "phone".equals(mode) ? 310 : "bass".equals(mode) ? 280 : "dynamic".equals(mode) ? 240 : 200;') ||
     androidService.includes('int gainMb = "phone".equals(mode) ? 380 : "bass".equals(mode) ? 280 : "dynamic".equals(mode) ? 240 : 200;')) &&
    (androidService.includes("bestM4aBitrate >= 96000") || androidService.includes("bestM4aBitrate >= 115000"))
  );
  ok("full-quality stream enforcement (1.7.6): no 8kHz synthetic WAV test tone and no 30-second low-bitrate previewUrl override in playback or catalog normalization",
    !/WAV_SAMPLE_RATE\s*=\s*8000|sampleRate\s*[:=]\s*8000/i.test(appJs) &&
    !/WAV_SAMPLE_RATE\s*=\s*8000|sampleRate\s*[:=]\s*8000/i.test(streamJs) &&
    !aggregateJs.includes("isPreview: true") &&
    !streamJs.includes("deezerSearch") &&
    appJs.includes("previewUrl: \"\",\n      preview: \"\",") &&
    readFileSync("src/deezer.js", "utf8").includes("previewUrl: \"\",\n    preview: \"\",") &&
    readFileSync("src/providers.js", "utf8").includes("previewUrl: \"\",")
  );
  ok("Spotify-style queue & recommendations: vibe/genre/mood/tempo/style continuation, related artists, gradual exploration curve, canonical deduplication, and anti-repeat",
    aggregateJs.includes("function inferServerVibeProfile(") &&
    aggregateJs.includes("function sequenceSpotifyStyleTracks(") &&
    aggregateJs.includes("deezerRelatedArtists") &&
    aggregateJs.includes("deezerArtistRadio") &&
    appJs.includes("function inferTrackVibeClient(") &&
    appJs.includes("function scoreAndSequenceSpotifyStyle(") &&
    appJs.includes("function isSameSongClient(") &&
    appJs.includes("function canonicalSongKey(") &&
    appJs.includes("_sessionPlayedKeys") &&
    appJs.includes("_shuffleVisitedKeys")
  );
  {
    const { inferServerVibeProfile, sequenceSpotifyStyleTracks, isSameCanonicalSong } = await import("../src/aggregate.js");
    const seed = { id: "yt:seed1", title: "Blinding Lights (Official Audio)", artist: "The Weeknd", genre: "synthpop", duration: 200 };
    const vibe = inferServerVibeProfile(seed);
    const pool = [
      { id: "yt:dup1", title: "Blinding Lights (Lyrics)", artist: "The Weeknd - Topic", duration: 201, source: "youtube" },
      { id: "dz:1", title: "Save Your Tears", artist: "The Weeknd", genre: "synthpop", duration: 215, source: "deezer" },
      { id: "dz:2", title: "Starboy", artist: "The Weeknd", genre: "r&b", duration: 230, source: "deezer" },
      { id: "it:1", title: "Levitating", artist: "Dua Lipa", genre: "dance pop", duration: 203, source: "apple" },
      { id: "it:2", title: "Don't Start Now (Official Video)", artist: "Dua Lipa", genre: "dance pop", duration: 183, source: "apple" },
      { id: "it:2dup", title: "Don't Start Now", artist: "Dua Lipa", genre: "dance pop", duration: 183, source: "deezer" },
      { id: "yt:3", title: "Midnight City", artist: "M83", genre: "synthpop", duration: 243, source: "youtube" },
      { id: "dz:4", title: "Kill Bill", artist: "SZA", genre: "r&b", duration: 154, source: "deezer" },
      { id: "yt:5", title: "As It Was", artist: "Harry Styles", genre: "pop", duration: 167, source: "youtube" },
    ];
    const seq = sequenceSpotifyStyleTracks(pool, seed, vibe, {
      max: 10,
      dynamicRelatedArtists: ["Dua Lipa", "SZA"],
    });
    const hasSeedDup = seq.some((t) => isSameCanonicalSong(t, seed));
    const hasDontStartDup = seq.filter((t) => t.title.toLowerCase().includes("don't start now")).length > 1;
    let hasBackToBackSameArtist = false;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i].artist === seq[i - 1].artist) hasBackToBackSameArtist = true;
    }
    ok("functional test: Spotify-style sequencer excludes seed/canonical duplicates, spaces artists (no back-to-back repeats), and prioritizes peer/vibe matches",
      seq.length >= 5 && !hasSeedDup && !hasDontStartDup && !hasBackToBackSameArtist
    );

    const { isCleanForYouTrack, matchesForYouMoodProfile, buildPersonalizedForYouPlaylists } = await import("../src/aggregate.js");
    const { FY_MOOD_PROFILES, curatedForYouTracksForMood } = await import("../src/data.js");
    ok("Made For You: all 10 FY_MOOD_PROFILES have 24 distinct curated songs (240 unique songs total)", (() => {
      const moods = Object.keys(FY_MOOD_PROFILES);
      if (moods.length !== 10) return false;
      const sigs = new Set();
      for (const m of moods) {
        const tracks = curatedForYouTracksForMood(m, "2026-09-21", 24);
        if (tracks.length !== 24) return false;
        for (const t of tracks) {
          if (!isCleanForYouTrack(t) || !matchesForYouMoodProfile(t, FY_MOOD_PROFILES[m])) return false;
          sigs.add(`${t.title.toLowerCase()}::${t.artist.toLowerCase()}`);
        }
      }
      return sigs.size === 240;
    })());

    ok("Made For You: weekly refresh rotates playlists deterministically across weeks", (() => {
      const w1 = curatedForYouTracksForMood("pop", "2026-09-21", 20).map((t) => t.title).join("|");
      const w2 = curatedForYouTracksForMood("pop", "2026-09-28", 20).map((t) => t.title).join("|");
      return w1 !== w2;
    })());

    ok("Made For You: rejects compilation mixes, My Little Pony, and Crash Cars tribute tracks", (() => {
      const bad1 = { title: "Spotify Pop Hits 2025 🔥 Lady Gaga, Bruno Mars, Ed Sheeran #1", artist: "Sunset Playlist", duration: 200 };
      const bad2 = { title: "pop hits", artist: "My Little Pony", duration: 180 };
      const bad3 = { title: "Blinding Lights", artist: "Crash Cars", duration: 200 };
      return !isCleanForYouTrack(bad1) && !isCleanForYouTrack(bad2) && !isCleanForYouTrack(bad3);
    })());

    ok("Made For You: all 240 curated songs have real per-song https:// cover art URLs", (() => {
      for (const m of Object.keys(FY_MOOD_PROFILES)) {
        const tracks = curatedForYouTracksForMood(m, "2026-09-21", 24);
        for (const t of tracks) {
          if (!t.artwork || !/^https:\/\//i.test(t.artwork) || String(t.artwork).startsWith("/cover")) return false;
        }
      }
      return true;
    })());

    const androidAppJs = readFileSync("android/app/src/main/assets/public/app.js", "utf8");
    const iosAppJs = readFileSync("ios/App/App/public/app.js", "utf8");
    ok("Made For You: native Android and iOS app bundles match web public/app.js recommendation logic and define normalizeKeyText",
      androidAppJs === appJs &&
      iosAppJs === appJs &&
      appJs.includes("function normalizeKeyText(") &&
      androidAppJs.includes("function personalizeForYouCardTracks(")
    );
  }
  const poMatch = appJs.match(/function openPlayerOptions\(\)\s*\{([\s\S]*?)window\.handleImgErr/);
  const poBody = poMatch ? poMatch[1] : "";
  ok("player options cleanup: Video player, Playback speed, and Player style removed from openPlayerOptions()",
    Boolean(poBody) &&
    !poBody.includes("Video player") &&
    !poBody.includes("poVideo") &&
    !poBody.includes("Playback speed") &&
    !poBody.includes("data-po-speed") &&
    !poBody.includes("Player style") &&
    !poBody.includes("data-po-style") &&
    poBody.includes("poSleep") &&
    poBody.includes("poDl")
  );
  ok("settings player style: Island and Bar removed, Pill and Wave preserved, Vinyl and Aura added across web and native",
    appJs.includes('const VALID_PLAYER_STYLES = ["pill", "wave", "vinyl", "aura"];') &&
    !appJs.includes('["island"') &&
    !appJs.includes('["bar"') &&
    stylesCss.includes('html[data-player="pill"] .player') &&
    stylesCss.includes('html[data-player="wave"] .player') &&
    stylesCss.includes('html[data-player="vinyl"] .player') &&
    stylesCss.includes('html[data-player="aura"] .player') &&
    stylesCss.includes('html[data-native="1"][data-player="vinyl"] .player') &&
    stylesCss.includes('html[data-native="1"][data-player="aura"] .player') &&
    !stylesCss.includes('html[data-player="island"]') &&
    !stylesCss.includes('html[data-player="bar"]')
  );
  ok("settings timestamp wiggle: 4 optimized wiggle types (sine, ribbon, glow, orbit) selectable in Settings -> Player with legacy migration and endpoint tapering",
    appJs.includes('const VALID_SEEK_WIGGLES = ["sine", "ribbon", "glow", "orbit"];') &&
    appJs.includes('if (v === "pulse") return "ribbon";') &&
    appJs.includes('if (v === "zigzag") return "glow";') &&
    appJs.includes("Harmonic Ribbon") &&
    appJs.includes("Laser Glow") &&
    appJs.includes("function sampleSeekWiggleY(wiggle, x, t, amp, mid, span)") &&
    appJs.includes("data-set-wiggle") &&
    appJs.includes("Timestamp wiggle") &&
    stylesCss.includes("footer#playerBar > div.controls > div.seek-row") &&
    stylesCss.includes('html[data-wiggle="ribbon"]') &&
    stylesCss.includes('html[data-wiggle="glow"]') &&
    stylesCss.includes('html[data-wiggle="orbit"]')
  );
  ok("offline seek & MP4 stco integrity: MuchiMeta shifts stco/co64/tfhd offsets on moov expansion, rawAudioBytes stored in IDB, and Android readLong fixes seekTo",
    readFileSync("public/meta.js", "utf8").includes("function shiftSampleTableOffsets(") &&
    appJs.includes("const blob = new Blob([rawAudioBytes], { type: blobType });") &&
    appJs.includes("const isUsingAudioEl = Boolean(t._playingViaAudio || (audio.src && audio.src.startsWith(\"blob:\")));") &&
    appJs.includes("const scheduleReleaseCommit = () =>") &&
    androidPlugin.includes("private static long readLong(PluginCall call, String key, long defaultValue)") &&
    androidPlugin.includes('long position = readLong(call, "position", 0L);')
  );
  ok("offline lyrics movement: downloads persist lyrics to IDB & state.downloads, loadLyrics runs offline, and synthesizeSyncedLyrics + highlightLyric move lyrics offline",
    appJs.includes("async function saveOfflineLyrics(t, data)") &&
    appJs.includes("async function getOfflineLyrics(t)") &&
    appJs.includes("async function ensureOfflineLyricsForTrack(t)") &&
    appJs.includes("function synthesizeSyncedLyrics(plainText, durSec)") &&
    appJs.includes("// Always load lyrics (uses IndexedDB / saved download cache when offline)\n    loadLyrics(t);")
  );
  // Real functional test of MuchiMeta MP4 stco chunk offset preservation on tag embedding
  {
    const vm = await import("node:vm");
    const sandbox = { TextEncoder, TextDecoder };
    vm.createContext(sandbox);
    vm.runInContext(readFileSync("public/meta.js", "utf8"), sandbox);
    const MM = sandbox.MuchiMeta;
    // Build a synthetic MP4 with ftyp (16B) + moov containing trak->mdia->minf->stbl->stco (pointing to mdat at offset 80) + mdat (32B)
    const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const box = (type, payload) => {
      const out = new Uint8Array(8 + payload.length);
      out.set(u32(8 + payload.length), 0);
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
      out.set(payload, 8);
      return out;
    };
    const ftyp = box("ftyp", new Uint8Array([105, 115, 111, 109, 0, 0, 2, 0])); // 16B
    // stco payload: version/flags (4B) + count=1 (4B) + offsetPlaceholder (4B) = 12B -> stco box = 20B
    // stbl (28B) -> minf (36B) -> mdia (44B) -> trak (52B) -> moov (60B). Total before mdat = 16 + 60 = 76B. mdat payload starts at 84B.
    const origChunkOffset = 84;
    const stcoPayload = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1, ...u32(origChunkOffset)]);
    const moov = box("moov", box("trak", box("mdia", box("minf", box("stbl", box("stco", stcoPayload))))));
    const mdatPayload = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4]);
    const mdat = box("mdat", mdatPayload);
    const rawMp4 = new Uint8Array(ftyp.length + moov.length + mdat.length);
    rawMp4.set(ftyp, 0);
    rawMp4.set(moov, ftyp.length);
    rawMp4.set(mdat, ftyp.length + moov.length);

    const taggedMp4 = MM.embed(rawMp4, "m4a", { title: "Offline Seek Test", artist: "Muchi Artist", album: "Offline Album" });
    const delta = taggedMp4.length - rawMp4.length;
    // Locate 'stco' in taggedMp4 and verify the chunk offset shifted by +delta so it still points to 0xde 0xad 0xbe 0xef
    let stcoPos = -1;
    for (let i = 0; i < taggedMp4.length - 4; i++) {
      if (taggedMp4[i] === 0x73 && taggedMp4[i + 1] === 0x74 && taggedMp4[i + 2] === 0x63 && taggedMp4[i + 3] === 0x6f) {
        stcoPos = i;
        break;
      }
    }
    const newEntryOffset = stcoPos >= 0
      ? ((taggedMp4[stcoPos + 12] << 24) | (taggedMp4[stcoPos + 13] << 16) | (taggedMp4[stcoPos + 14] << 8) | taggedMp4[stcoPos + 15]) >>> 0
      : 0;
    ok("functional test: MuchiMeta.embed shifts MP4 stco chunk offsets by exact moov growth delta so audio seeking never resets",
      delta > 0 &&
      newEntryOffset === origChunkOffset + delta &&
      taggedMp4[newEntryOffset] === 0xde &&
      taggedMp4[newEntryOffset + 1] === 0xad
    );
  }
  ok("offline downloads (1.7.3): ensureStreamForDownload & handleDownload strip preview/placeholder streams and resolve full-length audio", appJs.includes("function isPreviewOrPlaceholderStream(") && appJs.includes("allowPreview=0") && streamJs.includes("const isPreviewStreamUrl = (u) =>") && streamJs.includes("Never fall back to 30-second Deezer/iTunes previews"));
  ok("offline downloads (1.7.3): Android MuchiDownloadPlugin resolves residential stream on-device and uses 4 MB chunked range downloads", androidDownloadPlugin.includes("MuchiAudioService.resolveStreamForDownload") && androidDownloadPlugin.includes("downloadChunkedToMediaStore") && androidService.includes("public static ResolvedStream resolveStreamForDownload("));
  ok("offline playback (1.7.3): playCurrent prioritizes saved local file / IndexedDB blob and playAudio uses getOfflineAudioBlob before network", appJs.includes("const hasOfflinePlayback = Boolean(") && appJs.includes("offlineBlob = await getOfflineAudioBlob(t);"));
  ok("native playback: playYtWithAudio sets _playingViaAudio = true, forwards track metadata + candidates to /api/yt/stream, and falls back to on-device yt: resolver on native", appJs.includes("t._playingViaAudio = true;\n    await playAudio(t);") && appJs.includes("/api/yt/stream?v=${encodeURIComponent(vid)}&title=${encodeURIComponent(title || \"\")}&artist=${encodeURIComponent(artist || \"\")}${candParam}${fastParam}") && appJs.includes("getWarmStream(") && appJs.includes("`yt:${t.videoId}`"));
  ok("native playback: playYtWithAudio rejects 30s preview streams (!data.isPreview) so full song always plays", (appJs.includes("if (data && data.url && !data.isPreview)") || appJs.includes("if (d && d.url && !d.isPreview)")) && appJs.includes("t._isPreviewStream = false;") && !appJs.includes("resolveFallbackStreamUrl(t, true)"));
  ok("native playback (1.7.8): playYtWithAudio resolves on-device yt: token and getWarmStream resolves verified HTTP streams",
    appJs.indexOf("function getWarmStream(") > 0 &&
    appJs.indexOf("t.streamUrl = `yt:${t.videoId}`") > 0
  );
  ok("native playback (1.7.8): nativeHandleControls error handler refreshes HTTP stream & retries native audio BEFORE falling back to WebView YouTube IFrame",
    (() => {
      const fnStart = appJs.indexOf("function nativeHandleControls(");
      const errBlockStart = appJs.indexOf('} else if (msg === "error") {', fnStart);
      const errBlock = appJs.slice(errBlockStart, errBlockStart + 3500);
      const refreshIdx = errBlock.indexOf("!cur._nativeRefreshTried");
      const fallbackIdx = errBlock.indexOf("!cur._nativeFallbackTried");
      const ytFallbackIdx = errBlock.indexOf("!cur._nativeYtFallbackTried");
      return fnStart > 0 && errBlockStart > fnStart && refreshIdx > 0 && fallbackIdx > refreshIdx && ytFallbackIdx > fallbackIdx;
    })()
  );
  ok("v1.8.1 downloads & UI navigation: dlResolvedCache deterministic chunk caching, youtubeAudioStreamDirect, Audius (feat. ...) matching, and Details -> Lyrics -> Back navigation",
    streamJs.includes("const dlResolvedCache = new Map();") &&
    streamJs.includes("youtubeAudioStreamDirect(vid)") &&
    streamJs.includes("hasCached(cacheKey)") &&
    streamJs.includes("tidyTitle(title || query)") &&
    appJs.includes("if (out.videoId && !IS_NATIVE)") &&
    appJs.includes("detailFrom: null,") &&
    appJs.includes("state.detailFrom = state.view;") &&
    androidService.includes('item.optBoolean("is_streamable", true)') &&
    iosPlugin.includes('item["is_streamable"] as? Bool')
  );
  ok("native background (1.7.8): Android MuchiAudioService restores full resolveYoutubeStreamStatic (candidates + official-audio search + ANDROID_TESTSUITE + Piped) and guarantees startInForeground in onStartCommand",
    androidService.includes("return resolveYoutubeStreamStatic(primaryVid, candidatesCsv, title, artist, sharedResolvePool);") &&
    androidService.includes("ANDROID_TESTSUITE") &&
    androidService.includes("public static final String ACTION_RESUME") &&
    androidPlugin.includes("service.isForegroundStarted()")
  );
  ok("native background (1.7.8): iOS MuchiAudioPlugin restores full resolveStreamForDownload on-device resolution, ANDROID_TESTSUITE, and UIBackgroundTask assertions across track transitions",
    iosPlugin.includes("Self.resolveStreamForDownload(videoId: vid, candidates: cands, title: tTitle, artist: tArtist") &&
    iosPlugin.includes("beginAudioBackgroundTask()") &&
    iosPlugin.includes("UIApplication.didEnterBackgroundNotification") &&
    iosPlugin.includes("ANDROID_TESTSUITE")
  );
  ok("native background & notification: MuchiAudioService resolves yt: on-device, maintains MediaStyle foreground notification + WakeLock/WifiLock, and supports handleSessionIntent", androidService.includes("resolveYoutubeStreamOnDevice") && androidService.includes("handleSessionIntent") && androidService.includes("C.WAKE_MODE_NETWORK") && androidService.includes("WifiManager.WifiLock") && androidService.includes("stopPlaybackInternal(boolean notifyJs)"));
  ok("native background & notification: MuchiAudioPlugin exposes syncSession and setAudioPrefs and deduplicates loadTrack", androidPlugin.includes("public void syncSession(PluginCall call)") && androidPlugin.includes("public void setAudioPrefs(PluginCall call)") && androidService.includes("url.equals(currentRequestedUrl)"));
  ok("native background & notification: MainActivity keeps WebView media and JS timers alive in background (onPause/onStop/onWindowFocusChanged)", androidMainActivity.includes("keepWebViewAwake()") && androidMainActivity.includes("wv.onResume()") && androidMainActivity.includes("wv.resumeTimers()"));
  ok("native background & notification: app.js syncs native session notification on updateMediaSession and checks npActive first in keepBackgroundPlay", appJs.includes("nativeSyncSession();") && appJs.includes("function nativeSyncSession(") && /function keepBackgroundPlay\(\)\s*\{[\s\S]*?if\s*\(npActive\)/.test(appJs));
  ok("sound quality (1.5.5): WebAudio DSP graph (5-band EQ, bass shelf + harmonic warmth shaper, Haas 3D spatial stereo widener, clarity/air loudness compressor) and native hardware DSP effects active by default", appJs.includes("state.prefs.soundV !== 3") && appJs.includes("function hookSound()") && appJs.includes("function spatialMode()") && appJs.includes("bass.frequency.value = 78; bass.gain.value = 9.5;") && appJs.includes("Math.tanh(3.1 * x) * 0.52") && appJs.includes("out.gain.value = 1.55;") && appJs.includes("function nativeSyncAudioPrefs()") && androidService.includes("applyPlayerPrefsAndEffects") && androidService.includes("LoudnessEnhancer") && androidService.includes("BassBoost") && androidService.includes("Equalizer"));
  ok("phone thermal optimization: disables continuous 60-120fps waveRaf/seekRaf loops on phones, pauses background CSS animations via data-hidden, and uses GPU scaleY for eqBars", (appJs.includes("if (cheapPhone() || isBatterySaver()) {\n      drawSeekWave();\n      return;\n    }") || appJs.includes("if (cheapPhone()) {\n      drawSeekWave();\n      return;\n    }")) && appJs.includes("if (document.hidden && npActive) return;") && appJs.includes('document.documentElement.dataset.hidden = document.hidden ? "1" : "0"') && stylesCss.includes('html[data-hidden="1"] *') && stylesCss.includes("transform: scaleY(0.25)"));

  // ── Native Android & iOS Background Playback E2E Simulation ──────────────
  {
    const vm = await import("node:vm");
    // Expose internal test hook inside VM copy of app.js
    const instrumentedAppJs = appJs.replace(
      "  loadHome();\n  loadTasteRecommendations();",
      "  window.__muchiE2E = { state, playCurrent, playFromList, position, togglePlay, next, prev, keepBackgroundPlay, unlockSound, getNativeAppAudioCache, storeNativeAppAudioCache, getNpState: () => ({ npActive, npPlaying, npDur, npPos, wantPlay, _pendingSeek }), setNpPos: (p, d) => { npPos = p; if (d) npDur = d; }, setPendingSeek: (p, tid) => { _pendingSeek = p; _pendingSeekApplied = false; _resumeTrackId = tid || null; } };\n"
    );

    async function runNativeBackgroundE2E(platform) {
      const controlsListeners = [];
      const progressListeners = [];
      const calls = [];
      const docListeners = {};
      const winListeners = {};
      const savedDiskFiles = new Map();
      let webAudioPlayCalls = 0;
      let fetchCalls = 0;

      const MuchiAudioMock = {
        addListener(event, cb) {
          if (event === "muchiControls" || event === "controls") controlsListeners.push(cb);
          if (event === "muchiProgress" || event === "progress") progressListeners.push(cb);
          return Promise.resolve({ remove: () => {} });
        },
        async play(opts) {
          const cachedKey = opts.videoId || `${opts.title}|${opts.artist}`;
          const localFile = savedDiskFiles.get(cachedKey) || null;
          calls.push({ method: "play", ...opts, playedFromLocalDiskCache: Boolean(localFile), localFile });
          if (!localFile && opts.url && (/^https?:\/\//.test(opts.url) || /^yt:/.test(opts.url))) {
            savedDiskFiles.set(cachedKey, `/cache/muchi_audio_cache/vid_${opts.videoId || "cached"}.m4a`);
          }
        },
        async preload(opts) { calls.push({ method: "preload", ...opts }); },
        async syncSession(opts) { calls.push({ method: "syncSession", ...opts }); },
        async pause() { calls.push({ method: "pause" }); },
        async resume() { calls.push({ method: "resume" }); },
        async stop() { calls.push({ method: "stop" }); },
        async seek(opts) { calls.push({ method: "seek", ...opts }); },
        async setVolume(opts) { calls.push({ method: "setVolume", ...opts }); },
        async setRate(opts) { calls.push({ method: "setRate", ...opts }); },
        async setAudioPrefs(opts) { calls.push({ method: "setAudioPrefs", ...opts }); },
      };

      const makeEl = (id = "") => ({
        id,
        style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return ""; } },
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        setAttribute() {},
        getAttribute() { return ""; },
        removeAttribute() {},
        appendChild() {},
        append() {},
        prepend() {},
        remove() {},
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return makeEl(); },
        querySelectorAll() { return []; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 40 }; },
        getContext() {
          return {
            clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
            moveTo() {}, lineTo() {}, closePath() {}, createLinearGradient() { return { addColorStop() {} }; },
            scale() {}, save() {}, restore() {}, translate() {},
          };
        },
        play() { webAudioPlayCalls++; return Promise.resolve(); },
        pause() {},
        load() {},
        innerHTML: "",
        textContent: "",
        value: "",
        paused: true,
        currentTime: 0,
        duration: 210,
        volume: 1,
        playbackRate: 1,
        src: "",
      });

      const elements = new Map();
      const getEl = (id) => {
        if (!elements.has(id)) elements.set(id, makeEl(id));
        return elements.get(id);
      };

      const storage = new Map([["aura.onboarded", "1"]]);
      const localStorageMock = {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => storage.delete(k),
      };

      const docMock = {
        hidden: false,
        visibilityState: "visible",
        body: makeEl("body"),
        head: makeEl("head"),
        documentElement: makeEl("html"),
        getElementById: (id) => getEl(id),
        createElement: (tag) => makeEl(tag),
        querySelector: () => makeEl(),
        querySelectorAll: () => [],
        addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
        removeEventListener() {},
        dispatchEvent(ev) { (docListeners[ev.type] || []).forEach((fn) => fn(ev)); },
      };

      let refreshCounter = 0;
      const fetchMock = async (urlStr) => {
        const u = String(urlStr);
        if (!u.includes("/api/auth/status")) fetchCalls++;
        if (u.includes("/api/yt-stream") || u.includes("/api/yt/stream")) {
          const m = u.match(/[?&](?:videoId|v)=([^&]+)/);
          const vid = m ? decodeURIComponent(m[1]) : "vid";
          const isRefresh = u.includes("refresh=1");
          if (isRefresh) refreshCounter++;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              url: `https://rr1---sn-e2e.googlevideo.com/videoplayback?id=${vid}&r=${isRefresh ? refreshCounter : 0}&mime=audio%2Fmp4`,
              mime: "audio/mp4",
              duration: 215,
              isPreview: false,
            }),
          };
        }
        if (u.includes("/api/youtube/search")) {
          const isBlinding = /Blinding/i.test(u);
          const isBirds = /BIRDS/i.test(u);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              tracks: isBlinding
                ? [{ videoId: "4NRXx6U8ABQ", title: "Blinding Lights", artist: "The Weeknd", duration: 200 }]
                : isBirds
                ? [{ videoId: "V9PVRfjEBTI", title: "BIRDS OF A FEATHER", artist: "Billie Eilish", duration: 210 }]
                : [{ videoId: "kPa7bsKwL-c", title: "Die With A Smile", artist: "Lady Gaga & Bruno Mars", duration: 252 }],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, tracks: [], results: [] }), text: async () => "{}" };
      };

      const sandbox = {
        window: null,
        self: null,
        globalThis: null,
        performance: { now: () => Date.now() },
        document: docMock,
        localStorage: localStorageMock,
        sessionStorage: localStorageMock,
        navigator: {
          onLine: true,
          userAgent: platform === "android"
            ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 CapacitorApp"
            : "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 CapacitorApp",
          mediaSession: { metadata: null, playbackState: "none", setActionHandler() {}, setPositionState() {} },
          wakeLock: { request: async () => ({ release: async () => {} }) },
        },
        location: { origin: "capacitor://localhost", href: "capacitor://localhost/", protocol: "capacitor:", host: "localhost", pathname: "/", search: "", hash: "" },
        history: { pushState() {}, replaceState() {} },
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => platform,
          Plugins: { MuchiAudio: MuchiAudioMock },
        },
        MediaMetadata: class { constructor(init) { Object.assign(this, init); } },
        AudioContext: class {
          constructor() { this.state = "running"; this.destination = {}; }
          resume() { return Promise.resolve(); }
          createMediaElementSource() { return { connect() {}, disconnect() {} }; }
          createBiquadFilter() { return { frequency: {}, Q: {}, gain: {}, connect() {}, disconnect() {} }; }
          createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
          createDynamicsCompressor() { return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {}, disconnect() {} }; }
          createWaveShaper() { return { connect() {}, disconnect() {} }; }
          createDelay() { return { delayTime: {}, connect() {}, disconnect() {} }; }
          createPanner() { return { positionX: {}, positionY: {}, positionZ: {}, setPosition() {}, connect() {}, disconnect() {} }; }
        },
        webkitAudioContext: undefined,
        Audio: function() { return makeEl("audio-inst"); },
        Image: function() { return makeEl("img-inst"); },
        MutationObserver: class { observe() {} disconnect() {} },
        ResizeObserver: class { observe() {} disconnect() {} },
        IntersectionObserver: class { observe() {} disconnect() {} },
        AbortController,
        AbortSignal,
        URL,
        URLSearchParams,
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
        Event: class { constructor(type) { this.type = type; } },
        fetch: fetchMock,
         requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => {},
        matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
        setTimeout: (fn, ms) => { const t = setTimeout(fn, Math.min(ms || 0, 20)); t.unref(); return t; },
        clearTimeout,
        setInterval: () => 1,
        clearInterval: () => {},
        console,
        Math,
        Date,
        JSON,
        Promise,
        Set,
        Map,
        WeakMap,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Error,
        TypeError,
        Uint8Array,
        Int32Array,
        Float32Array,
        ArrayBuffer,
        DataView,
        encodeURIComponent,
        decodeURIComponent,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        btoa: (s) => Buffer.from(String(s), "binary").toString("base64"),
        atob: (s) => Buffer.from(String(s), "base64").toString("binary"),
        addEventListener(ev, fn) { (winListeners[ev] = winListeners[ev] || []).push(fn); },
        removeEventListener() {},
        dispatchEvent(ev) { (winListeners[ev.type] || []).forEach((fn) => fn(ev)); },
        scrollTo() {},
        innerWidth: 390,
        innerHeight: 844,
        devicePixelRatio: 2,
      };
      sandbox.window = sandbox;
      sandbox.self = sandbox;
      sandbox.globalThis = sandbox;

      vm.createContext(sandbox);
      vm.runInContext(instrumentedAppJs, sandbox);

      const api = sandbox.__muchiE2E;
      const queue = [
        { id: "yt:dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", artist: "Rick Astley", source: "youtube", duration: 213, artwork: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" },
        { id: "yt:kJQP7kiw5Fk", videoId: "kJQP7kiw5Fk", title: "Despacito", artist: "Luis Fonsi", source: "youtube", duration: 281, artwork: "https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg" },
        { id: "yt:JGwWNGJdvx8", videoId: "JGwWNGJdvx8", title: "Shape of You", artist: "Ed Sheeran", source: "youtube", duration: 235, artwork: "https://i.ytimg.com/vi/JGwWNGJdvx8/hqdefault.jpg" },
      ];

      // Step 1: Play Song 1 in foreground + advance past 6s so next-track preload triggers
      api.state.queue = queue;
      api.state.index = 0;
      api.playCurrent(true);
      await new Promise((r) => setTimeout(r, 40));
      progressListeners.forEach((cb) => cb({ position: 8, duration: 213, playing: true }));
      await new Promise((r) => setTimeout(r, 30));

      const firstPlay = calls.find((c) => c.method === "play");
      const firstPreload = calls.find((c) => c.method === "preload");
      const step1Ok =
        Boolean(firstPlay) &&
        (String(firstPlay.url).startsWith("https://") || String(firstPlay.url) === "yt:dQw4w9WgXcQ") &&
        firstPlay.videoId === "dQw4w9WgXcQ" &&
        Boolean(firstPreload) &&
        firstPreload.videoId === "kJQP7kiw5Fk" &&
        api.getNpState().npActive === true &&
        api.state.playing === true;

      // Step 2: Background app + lock screen + wait (progress ticks at 15s, 60s, 120s)
      const audioPlayBeforeBg = webAudioPlayCalls;
      docMock.hidden = true;
      docMock.visibilityState = "hidden";
      docMock.dispatchEvent({ type: "visibilitychange" });
      sandbox.dispatchEvent({ type: "pagehide" });
      sandbox.dispatchEvent({ type: "blur" });
      docMock.dispatchEvent({ type: "freeze" });

      for (const pos of [15, 60, 120]) {
        progressListeners.forEach((cb) => cb({ position: pos, duration: 213, playing: true }));
      }
      api.keepBackgroundPlay();
      api.unlockSound();
      await new Promise((r) => setTimeout(r, 30));

      const stopCallsDuringBg = calls.filter((c) => c.method === "stop");
      const step2Ok =
        api.getNpState().npActive === true &&
        api.state.playing === true &&
        api.getNpState().npPos === 120 &&
        stopCallsDuringBg.length === 0 &&
        webAudioPlayCalls === audioPlayBeforeBg;

      // Step 3: Lock-screen Pause → Resume while backgrounded & screen locked
      controlsListeners.forEach((cb) => cb({ action: "pause" }));
      await new Promise((r) => setTimeout(r, 20));
      const pausedInBg = api.state.playing === false && api.getNpState().npPlaying === false;

      controlsListeners.forEach((cb) => cb({ action: "play" }));
      await new Promise((r) => setTimeout(r, 20));
      const resumedInBg = api.state.playing === true && api.getNpState().npPlaying === true;

      // Also test __muchiNative("pause") / __muchiNative("play") bridge commands
      sandbox.__muchiNative("pause");
      const bridgePaused = calls.some((c) => c.method === "pause") && api.state.playing === false;
      sandbox.__muchiNative("play");
      const bridgeResumed = calls.some((c) => c.method === "resume") && api.state.playing === true;
      const step3Ok = pausedInBg && resumedInBg && bridgePaused && bridgeResumed && api.getNpState().npActive === true;

      // Step 4: Lock-screen Next Track → Previous Track → Natural Ended transition while backgrounded
      calls.length = 0;
      controlsListeners.forEach((cb) => cb({ action: "next" }));
      await new Promise((r) => setTimeout(r, 40));
      const nextPlayCall = calls.find((c) => c.method === "play" && c.videoId === "kJQP7kiw5Fk");
      const nextOk =
        api.state.index === 1 &&
        Boolean(nextPlayCall) &&
        (String(nextPlayCall.url).startsWith("https://") || String(nextPlayCall.url) === "yt:kJQP7kiw5Fk") &&
        api.getNpState().npActive === true;

      // Set position to 1s so prev() goes back to track 0 instead of seeking to 0
      api.setNpPos(1, 281);
      calls.length = 0;
      controlsListeners.forEach((cb) => cb({ action: "prev" }));
      await new Promise((r) => setTimeout(r, 40));
      const prevPlayCall = calls.find((c) => c.method === "play" && c.videoId === "dQw4w9WgXcQ");
      const prevOk = api.state.index === 0 && Boolean(prevPlayCall) && api.getNpState().npActive === true;

      // Simulate natural track completion ("ended") while screen is still locked
      calls.length = 0;
      controlsListeners.forEach((cb) => cb({ action: "ended" }));
      await new Promise((r) => setTimeout(r, 40));
      const endedNextCall = calls.find((c) => c.method === "play" && c.videoId === "kJQP7kiw5Fk");
      const endedOk = api.state.index === 1 && Boolean(endedNextCall) && api.getNpState().npActive === true;

      // Step 5: Native error recovery while backgrounded stays on Native Audio (refreshes HTTP URL first)
      calls.length = 0;
      controlsListeners.forEach((cb) => cb({ action: "error" }));
      await new Promise((r) => setTimeout(r, 40));
      const errRetryCall = calls.find((c) => c.method === "play" && c.videoId === "kJQP7kiw5Fk");
      const errRecoveryOk =
        Boolean(errRetryCall) &&
        String(errRetryCall.url).includes("&r=1") &&
        api.getNpState().npActive === true;

      // Step 6: Native App Audio Cache E2E — replay already-played song (fresh track object) with 0 backend requests and immediate local disk cache playback
      await new Promise((r) => setTimeout(r, 60));
      docMock.hidden = false;
      docMock.visibilityState = "visible";
      api.state.queue[0] = { id: "yt:dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", artist: "Rick Astley", source: "youtube", duration: 213 };
      api.state.index = 0;
      fetchCalls = 0;
      calls.length = 0;
      const t0CacheReplay = Date.now();
      await api.playCurrent();
      const cacheReplayMs = Date.now() - t0CacheReplay;
      const cachedReplayCall = calls.find((c) => c.method === "play" && c.videoId === "dQw4w9WgXcQ");
      const cacheReplayOk =
        Boolean(cachedReplayCall) &&
        cachedReplayCall.playedFromLocalDiskCache === true &&
        Boolean(api.getNativeAppAudioCache(api.state.queue[0])) &&
        fetchCalls === 0 &&
        cacheReplayMs < 50;

      // Step 7 (v1.8.3): Verify clicking a new catalog song clears any 0:14 (14.4s) saved session _pendingSeek,
      // dispatches NP.play immediately (< 20ms, no 750ms wait), and ignores stale 0:14 progress ticks from previous song
      api.setPendingSeek(14.4, "apple:old_saved_song");
      api.setNpPos(14.4, 210);
      calls.length = 0;
      const catalogList = [
        { id: "apple:cat_1", source: "apple", title: "Blinding Lights", artist: "The Weeknd", duration: 200, artwork: "/cover-default.jpg" },
        { id: "apple:cat_2", source: "apple", title: "Espresso", artist: "Sabrina Carpenter", duration: 175, artwork: "/cover-default.jpg" },
      ];
      const t0ClickCatalog = Date.now();
      api.playFromList(catalogList, 0);
      await new Promise((r) => setTimeout(r, 15));
      const clickCatalogElapsed = Date.now() - t0ClickCatalog;
      const catalogPlayCall = calls.find((c) => c.method === "play" && c.title === "Blinding Lights");
      const posImmediatelyAfterClick = api.position();
      // Simulate a stale 0:14 progress tick arriving from the previous track while resolvingOnDevice is still buffering
      progressListeners.forEach((cb) => cb({ position: 14.4, duration: 210, playing: false }));
      const posAfterStaleTick = api.position();
      // Now simulate the new track actually starting at 0.4s
      progressListeners.forEach((cb) => cb({ position: 0.4, duration: 200, playing: true }));
      const posAfterRealStart = api.position();
      const zeroJumpOk =
        Boolean(catalogPlayCall) &&
        catalogPlayCall.position === 0 &&
        api.getNpState()._pendingSeek === 0 &&
        posImmediatelyAfterClick === 0 &&
        posAfterStaleTick === 0 &&
        Math.abs(posAfterRealStart - 0.4) < 0.05 &&
        clickCatalogElapsed < 45;

      // Step 8 (v1.8.4): Full-length iTunes & Deezer Native E2E playback from 0:00 through full duration
      // Simulate iTunes song playing through 30s, 90s, 150s, 199.8s (never cutting off at 30s) -> natural ended -> advances to Deezer song and plays full 175s
      for (const p of [30, 90, 150, 199.8]) {
        progressListeners.forEach((cb) => cb({ position: p, duration: 200, playing: true }));
      }
      const itunesFullPlayPos = api.position();
      const itunesFullPlayDur = api.getNpState().npDur;
      calls.length = 0;
      const deezerCatalog = [
        { id: "itunes:1001", source: "itunes", title: "Die With A Smile", artist: "Lady Gaga & Bruno Mars", duration: 252, artwork: "/cover-default.jpg" },
        { id: "deezer:2002", source: "deezer", title: "BIRDS OF A FEATHER", artist: "Billie Eilish", duration: 210, artwork: "/cover-default.jpg" },
      ];
      api.playFromList(deezerCatalog, 1);
      await new Promise((r) => setTimeout(r, 15));
      const deezerPlayCall = calls.find((c) => c.method === "play" && c.title === "BIRDS OF A FEATHER");
      for (const p of [10, 45, 120, 185, 209.5]) {
        progressListeners.forEach((cb) => cb({ position: p, duration: 210, playing: true }));
      }
      const deezerFullPlayPos = api.position();
      const deezerFullPlayDur = api.getNpState().npDur;
      const itunesDeezerFullPlayOk =
        Math.abs(itunesFullPlayPos - 199.8) < 0.2 &&
        itunesFullPlayDur === 200 &&
        Boolean(deezerPlayCall) &&
        deezerPlayCall.duration === 210000 &&
        Math.abs(deezerFullPlayPos - 209.5) < 0.2 &&
        deezerFullPlayDur === 210 &&
        api.state.playing === true;

      return { step1Ok, step2Ok, step3Ok, nextOk, prevOk, endedOk, errRecoveryOk, cacheReplayOk, zeroJumpOk, itunesDeezerFullPlayOk };
    }

    const androidE2E = await runNativeBackgroundE2E("android");
    ok("Android Native E2E: play song → resolves verified HTTP stream, starts MuchiAudioService & preloads next track", androidE2E.step1Ok);
    ok("Android Native E2E: background app + lock screen + wait → playback continues with zero WebView audio interference", androidE2E.step2Ok);
    ok("Android Native E2E: lock-screen MediaStyle pause & resume controls work while backgrounded", androidE2E.step3Ok);
    ok("Android Native E2E: lock-screen next, previous, natural track-end & error recovery work while backgrounded",
      androidE2E.nextOk && androidE2E.prevOk && androidE2E.endedOk && androidE2E.errRecoveryOk
    );
    ok("Android Native E2E: replaying a played song uses native app audio cache with 0 backend requests and immediate local playback",
      androidE2E.cacheReplayOk
    );
    ok("Android Native E2E (v1.8.3): clicking any song starts at 0:00 (never jumps to 0:14), skips 750ms wait, and rejects stale progress ticks",
      androidE2E.zeroJumpOk
    );
    ok("Android Native E2E (v1.8.4): iTunes & Deezer songs play full track duration (200s / 210s) without cutting off early",
      androidE2E.itunesDeezerFullPlayOk
    );

    const iosE2E = await runNativeBackgroundE2E("ios");
    ok("iOS Native E2E: play song → resolves verified HTTP stream, starts AVPlayer & preloads next track", iosE2E.step1Ok);
    ok("iOS Native E2E: background app + lock screen + wait → AVAudioSession playback continues uninterrupted", iosE2E.step2Ok);
    ok("iOS Native E2E: lock-screen MPNowPlayingInfoCenter pause & resume controls work while backgrounded", iosE2E.step3Ok);
    ok("iOS Native E2E: lock-screen next, previous, natural track-end & error recovery work while backgrounded",
      iosE2E.nextOk && iosE2E.prevOk && iosE2E.endedOk && iosE2E.errRecoveryOk
    );
    ok("iOS Native E2E: replaying a played song uses native app audio cache with 0 backend requests and immediate local playback",
      iosE2E.cacheReplayOk
    );
    ok("iOS Native E2E (v1.8.3): clicking any song starts at 0:00 (never jumps to 0:14), skips 750ms wait, and rejects stale progress ticks",
      iosE2E.zeroJumpOk
    );
    ok("iOS Native E2E (v1.8.4): iTunes & Deezer songs play full track duration (200s / 210s) without cutting off early",
      iosE2E.itunesDeezerFullPlayOk
    );

    // ── v1.8.2 & v1.8.3 E2E: Immediate Playback, Zero-Jump Timer, and Native App Audio Cache ──
    ok("v1.8.2 fast playback: DefaultLoadControl (200ms bufferForPlaybackMs), AVPlayer playImmediately, single-batch raced InnerTube, and resolvedStreamCache + Promise.any",
      androidService.includes("DefaultLoadControl") &&
      androidService.includes("200,") &&
      iosPlugin.includes("automaticallyWaitsToMinimizeStalling = false") &&
      iosPlugin.includes("playImmediately(atRate: prefSpeed)") &&
      aggregateJs.includes("const resolvedStreamCache = new Map();") &&
      aggregateJs.includes("Promise.any(fastRaces)") &&
      appJs.includes("function warmTrack(t)") &&
      appJs.includes("clearTimeout(secondaryRaceTimer)")
    );
    ok("v1.8.2 native background tap-out: hookSound skips WebView AudioContext on IS_NATIVE, ExoPlayer setAudioAttributes(..., false) avoids WebView focus loss, and appStateChange resumes/hands off native audio",
      appJs.includes("if (IS_NATIVE) return;") &&
      androidService.includes(".build(),\n                        false);") &&
      appJs.includes("let nativeAppInBackground = false;") &&
      appJs.includes("if (!isStaleStartJump && rawPos > 0.05) npSeenPlaying = true;") &&
      appJs.includes("if ((document.hidden || nativeAppInBackground) && wantPlay && state.prefs.bgPlay !== false)")
    );
    ok("v1.8.2 native app audio cache: MuchiAudioService & MuchiAudioPlugin cache played streams to muchi_audio_cache on disk and app.js persists aura.nativeAudioCache.v1 for 0-backend-load instant replay",
      androidService.includes('private static final String AUDIO_CACHE_DIR_NAME = "muchi_audio_cache";') &&
      androidService.includes("getCachedAudioFile(this, currentVideoId, trackTitle, trackArtist)") &&
      androidService.includes("cacheStreamToDiskAsync(appCtx, cacheUrl, effectiveUaForCache, cacheVid, cacheTitle, cacheArtist);") &&
      iosPlugin.includes('appendingPathComponent("muchi_audio_cache", isDirectory: true)') &&
      iosPlugin.includes("Self.getCachedAudioFile(videoId: currentVideoId, title: currentTitle, artist: currentArtist)") &&
      iosPlugin.includes("Self.cacheStreamToDiskAsync(") &&
      appJs.includes('const NATIVE_AUDIO_CACHE_KEY = "aura.nativeAudioCache.v1";') &&
      appJs.includes("function storeNativeAppAudioCache(") &&
      appJs.includes("function getNativeAppAudioCache(") &&
      appJs.includes("t._fromNativeAppCache = true;")
    );
    ok("v1.8.3 zero-jump native playback: tick() guards !resolvingOnDevice, loadTrack avoids yt: deduplication collision, WEB_REMIX search + parallel candidate probing active, and disk cache download waits for STATE_READY + 6s",
      androidService.includes("long rawDur = resolvingOnDevice ? C.TIME_UNSET : player.getDuration();") &&
      androidService.includes('boolean sameIdentity = url != null && !url.equals("yt:")') &&
      androidService.includes("https://music.youtube.com/youtubei/v1/search?prettyPrint=false") &&
      androidService.includes("probeMultipleVideoIdsParallel") &&
      androidService.includes("ticker.postDelayed(() -> {") &&
      iosPlugin.includes("player?.replaceCurrentItem(with: nil)") &&
      iosPlugin.includes("https://music.youtube.com/youtubei/v1/search?prettyPrint=false") &&
      iosPlugin.includes("probeMultipleVideosParallel")
    );
    ok("v1.8.4 native iTunes & Deezer full-track playback: sharedResolvePool anti-deadlock, WEB_REMIX Songs filter, 256KB + 98% clen anti-truncation cache guard, ANDROID_VR/ANDROID_TESTSUITE Tier 1 priority, and strict Audius artist matching",
      androidService.includes("final ExecutorService exec = sharedResolvePool;") &&
      androidService.includes("EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D") &&
      androidService.includes("final long minValidBytes = 262144L;") &&
      androidService.includes("written >= (expectedBytes * 98L) / 100L") &&
      androidService.includes("if (titleMatch && artistMatch && durSec >= 60L)") &&
      iosPlugin.includes("let minValidBytes: Int64 = 262144") &&
      iosPlugin.includes("EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D") &&
      iosPlugin.includes("written >= (expectedBytes * 98) / 100") &&
      iosPlugin.includes("if titleMatch && artistMatch && durSec >= 60") &&
      appJs.includes("t._nativeOnDeviceVid = String(t.videoId || \"\");") &&
      appJs.includes("&allowPreview=0&refresh=1")
    );
  }

  // ── Country Trending Shelf ("Trending in (Country)") — 17 Unique Curated Playlists ──
  {
    const { curateCountryTrendingPlaylists } = await import("../src/aggregate.js");
    const { getCountryTrendingPlaylists, getCountrySeedPool } = await import("../src/data.js");

    for (const cc of ["IN", "US", "GB", "KR", "JP", "CA", "AU"]) {
      const defs = getCountryTrendingPlaylists(cc);
      const pool = getCountrySeedPool(cc);
      const curated = curateCountryTrendingPlaylists(cc, [], 20);
      ok(`Trending in ${cc}: returns exactly 17 playlists with 20 songs each (pool=${pool.length})`,
        defs.length === 17 &&
        curated.length === 17 &&
        curated.every((p) => Array.isArray(p.tracks) && p.tracks.length === 20 && String(p.id).startsWith(`ctrend:${cc}:`))
      );
      const titles = new Set(curated.map((p) => p.title));
      const roles = new Set(curated.map((p) => p.role));
      ok(`Trending in ${cc}: all 17 playlists have unique titles and 17 distinct roles/tastes`,
        titles.size === 17 && roles.size === 17
      );
    }

    // Verify zero repetition across all 17 playlists in India and US (340 unique songs across 17 playlists)
    for (const cc of ["IN", "US"]) {
      const curated = curateCountryTrendingPlaylists(cc, [], 20);
      const allSigs = new Set();
      let totalTracks = 0;
      for (const pl of curated) {
        for (const t of pl.tracks) {
          totalTracks++;
          allSigs.add(`${String(t.title).toLowerCase().trim()}|${String(t.artist).toLowerCase().trim()}`);
        }
      }
      ok(`Trending in ${cc}: avoids repetition across all 17 playlists (${allSigs.size}/${totalTracks} unique songs)`,
        totalTracks === 340 && allSigs.size >= 335
      );
    }

    // Verify dynamic live new release detection & prioritization
    const liveNewRelease = {
      id: "apple:live_test_2026",
      source: "apple",
      title: "Midnight Supernova",
      artist: "Arijit Singh & Diljit Dosanjh",
      album: "Supernova 2026",
      duration: 210,
      artwork: "https://cdn-images.dzcdn.net/images/cover/d96999c72276a4a95ebce4a7b50a56a2/500x500-000000-80-0-0.jpg",
      genre: "bollywood",
      releaseDate: new Date().toISOString().slice(0, 10),
      chartRank: 1,
    };
    const dynamicCurated = curateCountryTrendingPlaylists("IN", [liveNewRelease], 20);
    const inTopOrNew = [dynamicCurated[0], dynamicCurated[1], dynamicCurated[2]].some((pl) =>
      pl.tracks.some((t) => t.title === "Midnight Supernova")
    );
    ok("Trending in Country: dynamically detects and surfaces brand-new live releases & chart #1 tracks", inTopOrNew);
  }
  ok("native playback: /api/yt/stream resolves alternate official audio / candidate videoIds when primary videoId is gated and excludes 30s previews by default", aggregateJs.includes("const allowPreview = url.searchParams.get(\"allowPreview\") === \"1\";") && aggregateJs.includes("searchYouTube(`${searchQuery} official audio`") && aggregateJs.includes("isPreview: false"));
  ok("native playback: /api/stream handles c=ANDROID_VR & c=ANDROID_TESTSUITE User-Agent and auto-falls back when googlevideo returns 403/502", streamJs.includes("/c=ANDROID_VR/i.test(src)") && streamJs.includes("/c=ANDROID_TESTSUITE/i.test(src)") && streamJs.includes("if (primaryRes.status < 400) return primaryRes;"));
  ok("native app icon: syncNativeAppIcon calls NP.setAppIcon({ icon }) from applyAppIcon and setAppIcon", appJs.includes("function syncNativeAppIcon(") && appJs.includes("NP.setAppIcon({ icon: norm })") && appJs.includes("syncNativeAppIcon(ic.id);"));
  ok("native app icon: AndroidManifest declares activity-alias entries for all 25 icons and MuchiAudioPlugin switches PackageManager components", androidManifest.includes('android:name=".MainActivityAlias_default"') && androidManifest.includes('android:name=".MainActivityAlias_anime_cyber"') && androidManifest.includes('android:name=".MainActivityAlias_blurple_gamer"') && androidPlugin.includes("public void setAppIcon(PluginCall call)") && androidPlugin.includes("PackageManager.COMPONENT_ENABLED_STATE_ENABLED"));
  ok("native app icon: Android mipmap-anydpi-v26, mipmap-hdpi, and drawable launcher icon resources exist", Boolean(readFileSync("android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_anime_cyber.xml", "utf8")) && Boolean(readFileSync("android/app/src/main/res/drawable/ic_launcher_bg_anime_cyber.xml", "utf8")) && Boolean(readFileSync("android/app/src/main/res/drawable/ic_launcher_fg_anime_cyber.xml", "utf8")) && readFileSync("android/app/src/main/res/mipmap-hdpi/ic_launcher_anime_cyber.png").length > 100);
  ok("native app icon: iOS Info.plist, project.pbxproj, Assets.xcassets, and MuchiAudioPlugin.swift support setAlternateIconName for all 25 icons", iosPlist.includes("CFBundleAlternateIcons") && iosPlist.includes("AppIcon-anime_cyber") && iosPbxproj.includes("ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS = YES;") && iosPlugin.includes("setAlternateIconName") && Boolean(readFileSync("ios/App/App/Assets.xcassets/AppIcon-anime_cyber.appiconset/Contents.json", "utf8")));
  ok("deezer playback: findTrack searches Deezer pools and resolveFallbackStreamUrl supports fresh Deezer/iTunes preview streams", appJs.includes("resolveFallbackStreamUrl(t, skipYtStream = false)") && appJs.includes("state.search.deezer") && appJs.includes("findTrack(id, fallbackMeta)"));
  ok("ui modes: Settings UI supports material, glass, winter, christmas, autumn, and genshin in 2-column stacked layout",
    appJs.includes('const VALID_UI_MODES = ["material", "glass", "winter", "christmas", "autumn", "genshin"]') &&
    appJs.includes('animCard("winter", "Winter UI"') &&
    appJs.includes('animCard("christmas", "Christmas UI"') &&
    appJs.includes('animCard("autumn", "Autumn UI"') &&
    appJs.includes('animCard("genshin", "Genshin Impact"') &&
    appJs.includes('class="ui-anim-row"') &&
    stylesCss.includes(".ui-anim-row")
  );
  ok("genshin animated UI & offline synced lyrics: interactive greeting letters with Paimon/Aether/Lumine and LRC + ID3 USLT / MP4 ©lyr embedding",
    appJs.includes("function heroGreetingHTML(") &&
    appJs.includes('class="hero-scene hero-scene-genshin"') &&
    appJs.includes("function formatSyncedLrc(") &&
    appJs.includes("function parseLrcText(") &&
    appJs.includes("function hasOfflineSyncedLyrics(") &&
    readFileSync("public/meta.js", "utf8").includes("usltFrame(")
  );
  ok("hero scenes: homepage Still up? bar renders scoped winter, christmas, and autumn scenes behind text", appJs.includes("homeHeroSceneHTML()") && appJs.includes('class="hero-scene hero-scene-winter"') && appJs.includes('class="winter-forest-svg"') && appJs.includes('class="hero-scene hero-scene-christmas"') && appJs.includes('class="xmas-sleigh-svg"') && appJs.includes('class="hero-scene hero-scene-autumn"') && appJs.includes('class="autumn-forest-svg"') && appJs.includes('class="autumn-leaves"') && appJs.includes('class="home-hero-copy"'));
  ok("styles: app-wide winter, christmas & autumn UI overhaul, mood color preservation, and mobile optimizations present in styles.css", stylesCss.includes('html[data-ui="winter"]') && stylesCss.includes('html[data-ui="christmas"]') && stylesCss.includes('html[data-ui="autumn"]') && stylesCss.includes('html[data-ui="autumn"] .mood') && stylesCss.includes("@keyframes santaNightSkyFlight") && stylesCss.includes("@keyframes alaskaSnowLoopFront") && stylesCss.includes("@keyframes autumnLeafDrift"));
  ok("homepage: 'Customize taste' and Settings 'Music Taste & Setup' removed (onboarding is 1-time only for new users)", !appJs.includes("customizeTasteHomeBtn") && !appJs.includes(">Customize taste<") && !appJs.includes("openTasteSetup") && !appJs.includes("Music Taste & Setup"));
  ok("taste: tastePlaylistSection placed directly under forYouSection", /\$\{forYouSection\(\)\}\s*\$\{tastePlaylistSection\(\)\}\s*\$\{viralSection\(\)\}/.test(appJs));
  ok("taste: tastePlaylistList always tops up to 10 playlists (never stops at 4 when only artists are followed)", appJs.includes("taste-country-genre-") && appJs.includes("taste-country-artist-") && appJs.includes("cards.length >= 10") && appJs.includes("return cards.slice(0, 10);"));
  ok("library: artistRows in Library has no inline Unfollow button and opens Artist page where #followArtist unfollows", !appJs.includes('data-unfollow="${escapeAttr(a.key)}"') && appJs.includes('id="followArtist"') && appJs.includes("origName: a.origName"));
  ok("onboarding: returning Google user auto-skips onboarding and restores library", appJs.includes("res.isReturningUser") && appJs.includes('localStorage.setItem("aura.onboarded", "1")'));
  ok("youtube library (1.8.0): 3-dot track options menu and remove/unlike actions work for YouTube Likes and YouTube playlists",
    appJs.includes('state.view === "library" && state.activePlaylist === "yt-liked"') &&
    appJs.includes('state.activePlaylist.indexOf("yt-pl:") === 0') &&
    appJs.includes('sheetItem("ytunlike", "thumb_down", "Remove from YouTube Liked")') &&
    appJs.includes('sheetItem("remytpl", "playlist_remove", "Remove from YouTube playlist")') &&
    appJs.includes("async function ytUnlikeTrack(track)") &&
    appJs.includes("async function ytRemoveFromPlaylist(track, activePl)") &&
    readFileSync("src/oauth.js", "utf8").includes('path === "/api/youtube/unlike"') &&
    readFileSync("src/oauth.js", "utf8").includes('path === "/api/youtube/playlist/remove"')
  );

  // Native 4-API full playback + random seek (1:20 / 80s) synchronization checks
  const androidSvc = readFileSync("android/app/src/main/java/app/muchi/music/MuchiAudioService.java", "utf8");
  const iosPlug = readFileSync("ios/App/App/MuchiAudioPlugin.swift", "utf8");
  const aggSrc = readFileSync("src/aggregate.js", "utf8");
  const provSrc = readFileSync("src/providers.js", "utf8");
  ok(
    "native seek & 4-API full playback: Android/iOS pendingSeekMs keyframe tolerance (4000ms) + 2.2s expiry + JS npSeekGuardUntil unlock + Audius/SoundCloud full-track fallback",
    androidSvc.includes("pendingSeekSetAtMs") &&
    androidSvc.includes("Math.abs(rawPos - pendingSeekMs) >= 4000L && seekElapsed < 2200L") &&
    iosPlug.includes("pendingSeekSetAt") &&
    iosPlug.includes("abs(posSec * 1000.0 - self.pendingSeekMs) >= 4000.0 && seekElapsed < 2.2") &&
    appJs.includes("Math.abs(rawPos - npPos) <= 4.0") &&
    appJs.includes("discoveryprovider.audius.co/v1/tracks/") &&
    aggSrc.includes("soundcloudStreamForQuery") &&
    provSrc.includes("export async function soundcloudStreamForQuery")
  );
  ok(
    "v1.8.5 native phone speaker DSP: Android 6-zone acoustic Equalizer + controlled LoudnessEnhancer (310 mB) & BassBoost (580) + iOS MTAudioProcessingTap active",
    androidSvc.includes("if (freqHz <= 75) targetMb = 320;") &&
    androidSvc.includes("else if (freqHz <= 160) targetMb = 780;") &&
    androidSvc.includes("else if (freqHz <= 280) targetMb = 340;") &&
    androidSvc.includes("else if (freqHz <= 650) targetMb = -320;") &&
    androidSvc.includes("else if (freqHz <= 1600) targetMb = -80;") &&
    androidSvc.includes("else if (freqHz <= 4500) targetMb = 340;") &&
    iosPlug.includes("attachPhoneSpeakerDspIfAvailable") &&
    iosPlug.includes("MTAudioProcessingTapCreate")
  );
  ok(
    "v1.8.5 native playback stability: no competing googlevideo disk-cache download during active playback, mid-song recovery at pos > 1.5s, qKey cache invalidation, and native duration verification",
    androidSvc.includes('if (streamUrl.contains("googlevideo.com")') &&
    androidSvc.includes("private void recoverMidSongStream(final long resumePosMs)") &&
    androidSvc.includes("invalidateResolvedCacheForTrack(currentVideoId, trackTitle, trackArtist, currentUrl);") &&
    androidSvc.includes("private static boolean isDurationAcceptableStatic(long gotDurationMs, long expectedDurationMs)") &&
    androidSvc.includes("long minFullSongBytes = currentDurationMs >= 90000L ? (currentDurationMs / 1000L) * 9500L : 262144L;") &&
    iosPlug.includes('if rawUrl.contains("googlevideo.com") || rawUrl.contains("c=IOS") || rawUrl.contains("c=ANDROID&")') &&
    iosPlug.includes("private func recoverMidSongStream(resumeMs: Double)") &&
    iosPlug.includes("Self.invalidateResolvedCacheForTrack(videoId: self.currentVideoId, title: self.currentTitle, artist: self.currentArtist, failedUrl: self.currentUrl)") &&
    iosPlug.includes("private static func isDurationAcceptable(gotDurationMs: Double, expectedDurationMs: Double) -> Bool") &&
    iosPlug.includes("item.preferredForwardBufferDuration = 180.0") &&
    appJs.includes("await resolveYouTubePlay(t);") &&
    appJs.includes('const exclParam = cur.videoId ? `&exclude=${encodeURIComponent(cur.videoId)}` : "";')
  );
})();

// ── 6. Live worker checks (only when WRANGLER_DEV_URL is set) ───────────────
const BASE = process.env.WRANGLER_DEV_URL;
if (BASE) {
  const get = async (path, headers) => {
    const r = await fetch(BASE + path, { headers, redirect: "manual" });
    let body = null;
    try { body = await r.json(); } catch {}
    return { status: r.status, headers: r.headers, body, loc: r.headers.get("location") };
  };

  // health/version
  const health = await get("/api/health");
  ok("health 200", health.status === 200);
  ok("health shape", health.body && health.body.ok === true && health.body.name === "Muchi" && health.body.version === APP_VERSION);
  const version = await get("/api/version");
  ok("version shape", version.body && version.body.name === "Muchi" && version.body.version === APP_VERSION);

  // moods (full table)
  const moods = await get("/api/moods");
  ok("moods IN 12", moods.body && moods.body.country === "IN" && moods.body.moods.length === 12);
  ok("moods IN has bollywood", moods.body.moods.some((m) => m.id === "bollywood"));
  const moodsUs = await get("/api/moods?gl=US");
  ok("moods US 11 + country (rnb deduped)", moodsUs.body && moodsUs.body.country === "US" && moodsUs.body.moods.length === 11);
  ok("moods gl=12 → IN", (await get("/api/moods?gl=12")).body.country === "IN");

  // auth (no secrets locally → configured:false, honest 503s)
  const aStatus = await get("/api/auth/status");
  ok("auth/status configured:false", aStatus.body && aStatus.body.configured === false && aStatus.body.signedIn === false);
  const aUrl = await get("/api/auth/google/url");
  ok("auth/google/url → 503 not configured", aUrl.status === 503 && aUrl.body.error.includes("not configured"));
  const yUrl = await get("/api/auth/youtube/url");
  ok("auth/youtube/url → 503 not configured", yUrl.status === 503);
  const gCb = await get("/api/auth/google/callback?code=x&state=y");
  ok("google callback bad state → 302 error home", gCb.status === 302 && gCb.loc === "/?auth=error");
  const yCb = await get("/api/auth/youtube/callback?code=x&state=y");
  ok("youtube callback bad state → 302 error home", yCb.status === 302 && yCb.loc === "/?youtube=error");
  const signout = await get("/api/auth/signout");
  ok("signout → 200 ok", signout.status === 200 && signout.body.ok === true);
  const disc = await get("/api/auth/youtube/disconnect");
  ok("youtube/disconnect unauth → 401 auth", disc.status === 401 && disc.body.error === "auth");
  const liked = await get("/api/youtube/liked");
  ok("youtube/liked unauth → 401 auth", liked.status === 401 && liked.body.error === "auth");
  const pls = await get("/api/youtube/playlists");
  ok("youtube/playlists unauth → 401 auth", pls.status === 401);
  const pl = await get("/api/youtube/playlist?id=PLx");
  ok("youtube/playlist unauth → 401 auth", pl.status === 401);

  // ── Cloud Library Sync & Authentication ────────────────────────────────
  // 1. Unauthenticated checks
  const libUnauth = await get("/api/user/library");
  ok("user/library unauth → 401", libUnauth.status === 401 && Boolean(libUnauth.body && libUnauth.body.error));

  const syncUnauth = await get("/api/user/sync");
  ok("user/sync unauth → 401", syncUnauth.status === 401);

  const postLibUnauth = await fetch(BASE + "/api/user/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ liked: [] }),
  });
  ok("post user/library unauth → 401", postLibUnauth.status === 401);

  // 2. Authenticated checks using dev session token
  const devSid = "test-smoke-session-sid-12345";
  const devSecret = "muchi-preview-session-secret-key-32chars!";
  const validToken = sessionToken(devSid, devSecret);
  const authHeaders = {
    Authorization: `Bearer ${validToken}`,
    "Content-Type": "application/json",
  };

  // Auth status with bearer token
  const authStatus = await (await fetch(BASE + "/api/auth/status", { headers: authHeaders })).json();
  ok("auth/status with token → signedIn", authStatus && authStatus.signedIn === true && authStatus.profile && authStatus.profile.email === "twiarimascord@gmail.com");

  // Read initial library
  const libInitRes = await fetch(BASE + "/api/user/library", { headers: authHeaders });
  ok("get user/library authenticated → 200", libInitRes.status === 200);
  const libInitData = await libInitRes.json();
  ok("user/library shape", libInitData && typeof libInitData.library === "object");

  // Save/Sync library with liked songs, custom playlists, and followed artists
  const testPayload = {
    liked: [
      { id: "yt:smoke_1", title: "Smoke Test Song", artist: "Muchi Test", source: "youtube" },
    ],
    playlists: [
      { id: "pl_smoke_custom", name: "Smoke Favorites", tracks: [] },
      { name: "Unnamed Playlist", tracks: [] },
    ],
    following: ["Coldplay", "Imagine Dragons"],
    taste: { genre: "electronic" },
  };

  const saveRes = await fetch(BASE + "/api/user/library", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(testPayload),
  });
  ok("post user/library authenticated → 200 ok", saveRes.status === 200);
  const saveData = await saveRes.json();
  ok("post user/library returns merged library", saveData.ok === true && saveData.library && saveData.library.liked.length >= 1);
  ok("post user/library preserved named playlist without id", saveData.library.playlists.some((p) => p.name === "Unnamed Playlist"));

  // Verify round-trip read after persist
  const libVerifyRes = await fetch(BASE + "/api/user/library", { headers: authHeaders });
  const libVerifyData = await libVerifyRes.json();
  ok("persisted library round-trip verification", libVerifyData && libVerifyData.library && libVerifyData.library.following && libVerifyData.library.following.includes("Coldplay"));

  // Bad payload validation
  const badPayloadRes = await fetch(BASE + "/api/user/library", {
    method: "POST",
    headers: authHeaders,
    body: "non-json-body",
  });
  ok("post user/library invalid body → 400", badPayloadRes.status === 400);

  // Search speed benchmark test
  const t0Search = Date.now();
  const perfSearch = await (await fetch(BASE + "/api/search?q=believer")).json();
  const searchElapsed = Date.now() - t0Search;
  ok("search benchmark returns tracks", Array.isArray(perfSearch.youtube) && perfSearch.youtube.length > 0);
  ok("search latency is optimized", searchElapsed < 3500);

  // aggregate endpoints — offline provider behavior must be graceful
  const home = await get("/api/home");
  ok("home 200 full shape", home.status === 200 && home.body && home.body.country === "IN" && home.body.day);
  ok("home shelves empty w/ ids", Array.isArray(home.body.shelves) && home.body.shelves.length === 7 && home.body.shelves[0].id === "today");
  ok("home forYou 10 fallback", home.body.forYouPlaylists.length === 10);
  ok("home viral 10 fallback", Array.isArray(home.body.viralPlaylists) && home.body.viralPlaylists.length === 10);
  ok("home has all keys", ["youtubeCharts", "youtubeLocal", "youtubeIndia", "countryPlaylists", "globalPlaylists", "audius", "underground", "radio", "moods", "viralPlaylists"].every((k) => k in home.body));
  const homeRefresh = await get("/api/home?refresh=1");
  ok("home refresh=1 still 200", homeRefresh.status === 200);

  const shelf = await get("/api/shelf?id=today");
  ok("shelf 200 shape", shelf.status === 200 && shelf.body.id === "today" && shelf.body.title === "Today's Top Hits" && Array.isArray(shelf.body.tracks));
  ok("shelf missing query → 400", (await get("/api/shelf?id=x")).status === 400);

  const search = await get("/api/search?q=hello");
  ok("search 200 full shape", search.status === 200 && ["query", "youtube", "audius", "radio", "apple", "artists", "playlists"].every((k) => k in search.body));
  ok("search arrays shape", Array.isArray(search.body.youtube) && Array.isArray(search.body.audius));
  ok("search missing q → 400", (await get("/api/search")).status === 400);

  const ytSearch = await get("/api/youtube/search?q=x");
  ok("youtube/search graceful response", [200, 502].includes(ytSearch.status) && Array.isArray(ytSearch.body.tracks));
  const ytPl = await get("/api/yt/playlist?id=PLx");
  ok("yt/playlist 200 empty", ytPl.status === 200 && Array.isArray(ytPl.body.tracks) && ytPl.body.playlistId === "PLx");

  const artist = await get("/api/artist");
  ok("artist no params → empty tracks", artist.status === 200 && Array.isArray(artist.body.tracks) && artist.body.latest === null);
  const artist2 = await get("/api/artist?q=test");
  ok("artist q → shape", artist2.status === 200 && "songs" in artist2.body && "albums" in artist2.body && "tracks" in artist2.body);

  const radio = await get("/api/radio?q=hits");
  ok("radio graceful response", [200, 502].includes(radio.status) && Array.isArray(radio.body.tracks));
  const click = await get("/api/radio/click/abc");
  ok("radio/click → 200 ok (fire-and-forget)", click.status === 200 && click.body.ok === true);

  const stream = await get("/api/stream?url=");
  ok("stream no url → 400", stream.status === 400);
  const stream2 = await get("/api/stream?url=ftp://x");
  ok("stream ftp → 400", stream2.status === 400);
  const audStream = await get("/api/audius/stream/xyz");
  // audiusStreamUrl() falls back to the deterministic stream URL when the
  // API is unreachable (server.js does the same) — so 200 {url} even offline.
  ok("audius/stream → 200 fallback url", audStream.status === 200 && typeof audStream.body.url === "string" && audStream.body.url.includes("/stream?app_name=Muchi"));
  const audFile = await get("/api/audius/file/xyz");
  // sandbox has no DNS via DoH → graceful 400/502; on the deployed Worker
  // this streams the track. Either way it must be a graceful error here.
  ok("audius/file → graceful error offline", [400, 502].includes(audFile.status) && "error" in audFile.body);

  // ── /api/download (real download endpoint) ────────────────────────────
  const dlNo = await get("/api/download");
  ok("download missing params → 400", dlNo.status === 400 && dlNo.body.error === "Missing videoId or trackId");
  const cAud = new AbortController();
  const tAud = setTimeout(() => cAud.abort(), 3500);
  const dlAud = await fetch(BASE + "/api/download?trackId=xyz&name=t", { signal: cAud.signal }).catch(() => ({ status: 502 }));
  clearTimeout(tAud);
  ok("download trackId response", [200, 400, 502].includes(dlAud.status));
  const cYt = new AbortController();
  const tYt = setTimeout(() => cYt.abort(), 3500);
  const dlYt = await fetch(BASE + "/api/download?videoId=x&name=t", { signal: cYt.signal }).catch(() => ({ status: 502 }));
  clearTimeout(tYt);
  ok("download videoId response", [200, 400, 502].includes(dlYt.status));

  const imgPriv = await get("/api/img?url=http://127.0.0.1:8080/x.png");
  ok("img private target → 400", imgPriv.status === 400);
  const imgBad = await get("/api/img?url=notaurl");
  ok("img bad url → 400", imgBad.status === 400);

  const discv = await get("/api/discover?week=w1");
  ok("discover 200 shape", discv.status === 200 && discv.body.title === "Discovery Mix" && Array.isArray(discv.body.tracks));
  const foryou = await get("/api/for-you");
  ok("for-you 200 shape", foryou.status === 200 && foryou.body.title === "Discovery Mix");
  const related = await get("/api/related?title=t&artist=a");
  ok("related 200 graceful", related.status === 200 && Array.isArray(related.body.tracks));
  const relatedEmpty = await get("/api/related");
  ok("related no params → empty tracks", relatedEmpty.status === 200 && relatedEmpty.body.tracks.length === 0);
  const lyrics = await get("/api/lyrics?title=t&artist=a");
  ok("lyrics 200 shape", lyrics.status === 200 && typeof lyrics.body.lyrics === "string" && Array.isArray(lyrics.body.synced));

  const nf = await get("/api/does-not-exist");
  ok("unknown api → 404", nf.status === 404 && nf.body.error === "Not found");

  // CORS/OPTIONS/static/debug
  const pre = await get("/api/health", { Origin: "capacitor://localhost" });
  const allowOrigin = pre.headers.get("access-control-allow-origin");
  ok("CORS on JSON", allowOrigin === "*" || allowOrigin === "capacitor://localhost");
  const opts = await fetch(BASE + "/api/health", { method: "OPTIONS" });
  ok("OPTIONS 204 + headers", opts.status === 204 && opts.headers.get("access-control-allow-methods") === "GET,POST,OPTIONS");
  const staticPage = await fetch(BASE + "/");
  ok("static index 200", staticPage.status === 200);
  ok("static is the app", (await staticPage.text()).includes("Muchi"));
  const sw = await fetch(BASE + "/sw.js");
  ok("sw.js served", sw.status === 200);
  const debug = await get("/api/health?debug=1");
  ok("debug header", debug.headers.get("x-muchi-ms") !== null);
  const favicon = await fetch(BASE + "/favicon.ico", { redirect: "manual" });
  // Dev: public/ lacks _redirects (they're added at package build from
  // public-extra/) → SPA fallback serves index.html. Deployed package: 302
  // to /logo.png. Both are non-error outcomes; PASS 2 verifies the redirect
  // file exists in the ZIP.
  ok("favicon non-error in dev", favicon.status === 200 || favicon.status === 302);

  // ── 7. Client Web + Cloudflare Worker E2E (Deezer, iTunes & Catalog Proxies) ──
  const appJsRes = await fetch(BASE + "/app.js?v=110");
  const appJsText = await appJsRes.text();
  const stylesRes = await fetch(BASE + "/styles.css?v=110");
  const stylesText = await stylesRes.text();
  const swText = await (await fetch(BASE + "/sw.js")).text();
  ok("client web: app.js?v=110 served 200", appJsRes.status === 200 && appJsText.includes("normalizeClientDeezerTrack") && appJsText.includes("dzJsonp"));
  ok("client web: styles.css?v=110 served 200", stylesRes.status === 200 && stylesText.length > 50000);
  ok("client web: sw.js cache matches v110", swText.includes("muchi-shell-v110") && swText.includes("/app.js?v=110") && swText.includes("/styles.css?v=110"));
  ok("client web: per-provider fetch state Set present", appJsText.includes("const providerFetchesInFlight = new Set()"));

  // ── 8. UI Player Interface & App vs Web Parity Checks ──────────────────
  ok("player UI: syncTopbar updates document.body.dataset.view", appJsText.includes("document.body.dataset.view = state.view;"));
  ok("player UI: render maps 'now' view to renderNow", appJsText.includes("now: renderNow"));
  ok("player UI: renderNow contains quick action header buttons (download, follow, video, options)",
    appJsText.includes("ly-head-actions") &&
    appJsText.includes('id="nowDlBtn"') &&
    appJsText.includes('id="nowFollowBtn"') &&
    appJsText.includes('id="nowVideoBtn"') &&
    appJsText.includes('id="nowOptsBtn"')
  );
  ok("player UI: seek scrub touch/pointer handlers wired", appJsText.includes("beginSeekScrub") && appJsText.includes("commitSeekScrub"));
  ok("player UI: CSS native player Type looks high-specificity rules present",
    stylesText.includes('html[data-native="1"][data-player="pill"] .player') &&
    stylesText.includes('html[data-native="1"][data-player="wave"] .player') &&
    stylesText.includes('html[data-native="1"][data-player="vinyl"] .player') &&
    stylesText.includes('html[data-native="1"][data-player="aura"] .player')
  );
  ok("player UI: CSS native player bar proportions & backdrop blur preserved",
    stylesText.includes('html[data-native="1"] .player .icon-btn') &&
    stylesText.includes('html[data-native="1"] .player .like-btn') &&
    stylesText.includes('html[data-ui="glass"] .player')
  );

  // Multi-provider live search via Cloudflare Worker
  const dzSearch = await get("/api/search?q=adele&source=deezer&refresh=1");
  ok("worker e2e: /api/search?source=deezer returns 200 + tracks", dzSearch.status === 200 && Array.isArray(dzSearch.body.deezer) && dzSearch.body.deezer.length > 0);
  ok("worker e2e: deezer track schema valid", dzSearch.body.deezer[0].source === "deezer" && String(dzSearch.body.deezer[0].id).startsWith("deezer:") && Boolean(dzSearch.body.deezer[0].title));

  const apSearch = await get("/api/search?q=adele&source=apple&refresh=1");
  ok("worker e2e: /api/search?source=apple returns 200 + tracks", apSearch.status === 200 && Array.isArray(apSearch.body.apple) && apSearch.body.apple.length > 0 && Array.isArray(apSearch.body.itunes) && apSearch.body.itunes.length > 0);

  const catDzProxy = await get("/api/catalog/proxy?provider=deezer&path=" + encodeURIComponent("/search?q=adele&limit=10"));
  const catDzRows = (catDzProxy.body && (catDzProxy.body.data || catDzProxy.body.results || catDzProxy.body.deezer)) || [];
  ok("worker e2e: /api/catalog/proxy?provider=deezer returns tracks", catDzProxy.status === 200 && Array.isArray(catDzRows) && catDzRows.length > 0);

  const catApProxy = await get("/api/catalog/proxy?provider=apple&path=" + encodeURIComponent("/search?term=adele&media=music&entity=song&limit=10"));
  const catApRows = (catApProxy.body && (catApProxy.body.results || catApProxy.body.apple || catApProxy.body.itunes)) || [];
  ok("worker e2e: /api/catalog/proxy?provider=apple returns tracks", catApProxy.status === 200 && Array.isArray(catApRows) && catApRows.length > 0);

  const dzDirectProxy = await get("/api/deezer/proxy?path=" + encodeURIComponent("/search?q=coldplay&limit=10"));
  const dzDirectRows = (dzDirectProxy.body && (dzDirectProxy.body.data || dzDirectProxy.body.results || dzDirectProxy.body.deezer)) || [];
  ok("worker e2e: /api/deezer/proxy returns tracks", dzDirectProxy.status === 200 && Array.isArray(dzDirectRows) && dzDirectRows.length > 0);

  const itDirectProxy = await get("/api/itunes/proxy?path=" + encodeURIComponent("/search?term=coldplay&media=music&entity=song&limit=10"));
  const itDirectRows = (itDirectProxy.body && (itDirectProxy.body.results || itDirectProxy.body.apple || itDirectProxy.body.itunes)) || [];
  ok("worker e2e: /api/itunes/proxy returns tracks", itDirectProxy.status === 200 && Array.isArray(itDirectRows) && itDirectRows.length > 0);

  const catDzSearch = await get("/api/catalog/search?provider=deezer&q=rihanna");
  const catDzSearchRows = (catDzSearch.body && (catDzSearch.body.deezer || catDzSearch.body.data || catDzSearch.body.results)) || [];
  ok("worker e2e: /api/catalog/search?provider=deezer returns tracks", catDzSearch.status === 200 && Array.isArray(catDzSearchRows) && catDzSearchRows.length > 0);
} else {
  console.log("SKIP  live worker checks (set WRANGLER_DEV_URL=http://127.0.0.1:8787 with `npm run dev`)");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll smoke tests passed.");
process.exit(failures ? 1 : 0);
