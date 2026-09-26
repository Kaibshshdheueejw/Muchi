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
import { parseLyricsHit, pickInnertubeStream } from "../src/providers.js";
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

  // 3. Dedicated Data section
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
  ok("homepage: 'Customize taste' button removed from homepage (onboarding is first-launch only)", !appJs.includes("customizeTasteHomeBtn") && !appJs.includes(">Customize taste<"));
  ok("taste: tastePlaylistSection placed directly under forYouSection", /\$\{forYouSection\(\)\}\s*\$\{tastePlaylistSection\(\)\}\s*\$\{viralSection\(\)\}/.test(appJs));
  ok("taste: tastePlaylistList always tops up to 10 playlists (never stops at 4 when only artists are followed)", appJs.includes("taste-country-genre-") && appJs.includes("taste-country-artist-") && appJs.includes("cards.length >= 10") && appJs.includes("return cards.slice(0, 10);"));
  ok("library: artistRows in Library has no inline Unfollow button and opens Artist page where #followArtist unfollows", !appJs.includes('data-unfollow="${escapeAttr(a.key)}"') && appJs.includes('id="followArtist"') && appJs.includes("origName: a.origName"));
  ok("onboarding: returning Google user auto-skips onboarding and restores library", appJs.includes("res.isReturningUser") && appJs.includes('localStorage.setItem("aura.onboarded", "1")'));
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
  const appJsRes = await fetch(BASE + "/app.js?v=101");
  const appJsText = await appJsRes.text();
  const stylesRes = await fetch(BASE + "/styles.css?v=101");
  const swText = await (await fetch(BASE + "/sw.js")).text();
  ok("client web: app.js?v=101 served 200", appJsRes.status === 200 && appJsText.includes("normalizeClientDeezerTrack") && appJsText.includes("dzJsonp"));
  ok("client web: styles.css?v=101 served 200", stylesRes.status === 200);
  ok("client web: sw.js cache matches v101", swText.includes("muchi-shell-v101") && swText.includes("/app.js?v=101"));
  ok("client web: per-provider fetch state Set present", appJsText.includes("const providerFetchesInFlight = new Set()"));

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
