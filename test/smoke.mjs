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

import { hmac, sessionToken, sidFromToken } from "../src/auth.js";
import { isPrivateIp } from "../src/ssrf.js";
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
import { parseLyricsHit } from "../src/providers.js";
import { APP_VERSION } from "../src/config.js";
import { createHmac as nodeHmac } from "node:crypto";
import {
  parseVersion, versionAtLeast, versionEqual, checkVersionSync, isSync,
  readBuildGradleVersion, readPbxprojVersion, readConfigVersion, readAppJsVersion,
} from "../scripts/version-utils.mjs";
import { normalizeGain, volumeFor, qualityToYtRange, qualityLabel } from "../scripts/audio-utils.mjs";
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
ok("LOCAL_CHARTS 29 countries", Object.keys(LOCAL_CHARTS).length === 29);
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
  ok("shelf 200 w/ error field", shelf.status === 200 && shelf.body.id === "today" && shelf.body.title === "Today's Top Hits" && Array.isArray(shelf.body.tracks) && "error" in shelf.body);
  ok("shelf missing query → 400", (await get("/api/shelf?id=x")).status === 400);

  const search = await get("/api/search?q=hello");
  ok("search 200 full shape", search.status === 200 && ["query", "youtube", "audius", "radio", "apple", "artists", "playlists"].every((k) => k in search.body));
  ok("search empty arrays when providers down", search.body.youtube.length === 0 && search.body.audius.length === 0);
  ok("search missing q → 400", (await get("/api/search")).status === 400);

  const ytSearch = await get("/api/youtube/search?q=x");
  ok("youtube/search 502 graceful", ytSearch.status === 502 && Array.isArray(ytSearch.body.tracks));
  const ytPl = await get("/api/yt/playlist?id=PLx");
  ok("yt/playlist 200 empty", ytPl.status === 200 && Array.isArray(ytPl.body.tracks) && ytPl.body.playlistId === "PLx");

  const artist = await get("/api/artist");
  ok("artist no params → empty tracks", artist.status === 200 && Array.isArray(artist.body.tracks) && artist.body.latest === null);
  const artist2 = await get("/api/artist?q=test");
  ok("artist q → shape", artist2.status === 200 && "songs" in artist2.body && "albums" in artist2.body && "tracks" in artist2.body);

  const radio = await get("/api/radio?q=hits");
  ok("radio 502 graceful", radio.status === 502 && Array.isArray(radio.body.tracks));
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
  const dlAud = await fetch(BASE + "/api/download?trackId=xyz&name=t");
  ok("download trackId offline → graceful (400/502) + Content-Disposition", [400, 502].includes(dlAud.status) && (dlAud.headers.get("content-disposition") || "").includes("attachment") && (dlAud.headers.get("access-control-expose-headers") || "").includes("Content-Disposition"));
  const dlYt = await fetch(BASE + "/api/download?videoId=x&name=t");
  // When stream resolution itself fails (Piped unreachable) the endpoint
  // degrades to a graceful JSON error before any streaming, so no
  // Content-Disposition — that's fine; the client checks res.ok first.
  const dlYtBody = await dlYt.json().catch(() => ({}));
  ok("download videoId offline → graceful (400/502) JSON error", [400, 502].includes(dlYt.status) && ("error" in dlYtBody));

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
  ok("lyrics 200 empty", lyrics.status === 200 && lyrics.body.lyrics === "" && Array.isArray(lyrics.body.synced));

  const nf = await get("/api/does-not-exist");
  ok("unknown api → 404", nf.status === 404 && nf.body.error === "Not found");

  // CORS/OPTIONS/static/debug
  const pre = await get("/api/health", { Origin: "capacitor://localhost" });
  ok("CORS * on JSON", pre.headers.get("access-control-allow-origin") === "*");
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
} else {
  console.log("SKIP  live worker checks (set WRANGLER_DEV_URL=http://127.0.0.1:8787 with `npm run dev`)");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll smoke tests passed.");
process.exit(failures ? 1 : 0);
