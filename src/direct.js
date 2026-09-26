// MUCHI — "direct" endpoints ported 1:1 from server.js: health, version, moods.
// Same shapes as server.js lines 1455–1466 and 1660–1664.

import { APP_NAME, APP_VERSION, authConfig } from "./config.js";
import { json, cached, fetchJSON } from "./util.js";
import { regionCode, moodsForCountry } from "./data.js";

// The repo that hosts our releases (env-overridable; the Worker reads GitHub
// live so the ANDROID app sees a new release the moment it is published,
// even before the Worker itself is redeployed — and vice versa, a Worker
// redeploy with no matching release no longer advertises a phantom update
// pointing at the OLD apk, which is what "it downloads the same version
// again" actually was).
const DEFAULT_RELEASE_REPO = "Kaibshshdheueejw/Muchi";

/** Numeric-dot version compare (mirrors the client's verNewer). */
function verNewer(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Latest published GitHub release with a real APK asset (10-min cache,
 *  in-flight dedupe; degrades to null offline — never blocks /api/version). */
async function latestGithubRelease(env) {
  const repo = String((env && env.MUCHI_GITHUB_REPO) || DEFAULT_RELEASE_REPO).trim() || DEFAULT_RELEASE_REPO;
  try {
    return await cached(`ghrelease:${repo}`, 10 * 60 * 1000, async () => {
      const j = await fetchJSON(
        `https://api.github.com/repos/${repo}/releases/latest`,
        { headers: { Accept: "application/vnd.github+json", "User-Agent": `${APP_NAME}/${APP_VERSION}` } },
        6000
      );
      const tag = String((j && j.tag_name) || "").replace(/^v/i, "").trim();
      const assets = (j && j.assets) || [];
      const apk =
        assets.find((a) => /^muchi\.apk$/i.test(String(a.name || ""))) ||
        assets.find((a) => /\.apk$/i.test(String(a.name || "")));
      const apkUrl = apk && apk.browser_download_url ? String(apk.browser_download_url) : "";
      if (!tag || !apkUrl) return null;
      return { tag, apkUrl };
    });
  } catch {
    return null;
  }
}

/** Pure decision (fixture-tested in test/smoke.mjs): only advertise a newer
 *  version when the GitHub release actually carries an installable Android
 *  asset; the pinned per-release download URL means the file a user gets is
 *  ALWAYS exactly the version the app was told about (no more
 *  "it downloaded 1.5.3 again"). */
export function pickReleaseVersion(appVersion, gh, repo) {
  const fallbackUrl = `https://github.com/${repo || DEFAULT_RELEASE_REPO}/releases/latest/download/Muchi.apk`;
  const useGh = gh && gh.tag && gh.apkUrl && verNewer(gh.tag, appVersion) ? gh : null;
  return {
    version: useGh ? useGh.tag : appVersion,
    apkUrl: useGh ? useGh.apkUrl : fallbackUrl,
  };
}

/** /api/health + /api/version — same shape as server.js line 1455, plus a
 *  LIVE release check so the in-app updater can never offer a stale asset. */
export async function handleHealth(env) {
  const { github } = authConfig(env || {});
  const gh = await latestGithubRelease(env);
  const pick = pickReleaseVersion(APP_VERSION, gh, (env && env.MUCHI_GITHUB_REPO) || DEFAULT_RELEASE_REPO);
  return json(200, {
    ok: true,
    name: APP_NAME,
    version: pick.version,
    time: new Date().toISOString(),
    github: !!github,
    repo: String((env && env.MUCHI_GITHUB_REPO) || DEFAULT_RELEASE_REPO),
    api: "",
    // In-app updater (public/app.js checkUpdates) reads these.
    android: { apkUrl: pick.apkUrl },
    ios: { appStoreUrl: "" },
  });
}

/** /api/moods — same shape as server.js line 1660. */
export function handleMoods(url) {
  const gl = regionCode(url.searchParams.get("gl"));
  return json(200, { country: gl, moods: moodsForCountry(gl) });
}

/** Best-effort IP-region for a primary language (no region subtag). */
const LANG_DEFAULT_COUNTRY = {
  en: "US", hi: "IN", bn: "BD", pt: "BR", es: "ES", fr: "FR", de: "DE",
  ja: "JP", ko: "KR", zh: "CN", ar: "AE", ru: "RU", it: "IT", tr: "TR",
  id: "ID", vi: "VN", th: "TH", nl: "NL", sv: "SE", pl: "PL", ta: "IN", te: "IN",
};

function headerRegion(h) {
  const al = String((h && h.get && h.get("accept-language")) || "");
  if (!al) return "";
  const first = al.split(",")[0].trim();
  const parts = first.split("-");
  if (parts.length >= 2) {
    const r = parts[1].toUpperCase().slice(0, 2);
    if (r === "UK") return "GB";
    return /^[A-Z]{2}$/.test(r) ? r : "";
  }
  return LANG_DEFAULT_COUNTRY[first.toLowerCase().split("-")[0]] || "";
}

/** /api/geo — country for the caller, derived from request headers the way
 *  platform CDNs geo-tag (Cloudflare CF-IPCountry, Vercel x-vercel-ip-country,
 *  generic x-country-code), then Accept-Language. Returns the same 2-letter
 *  code the catalog uses (gl) so the app can auto-select the country shelf. */
export function handleGeo(request) {
  const h = request && request.headers ? request.headers : new Headers();
  const picks = [
    "cf-ipcountry", "CF-IPCountry", "x-vercel-ip-country",
    "x-country-code", "cf-ip-country", "x-ipcountry",
  ];
  let code = "";
  for (const k of picks) {
    const v = h.get(k);
    if (v) {
      code = regionCode(v.trim());
      if (code !== "IN") break;
      // a real two-letter code that isn't IN is authoritative; keep "IN" as a
      // last resort but keep looking for a stronger signal first
      if (/^[A-Z]{2}$/.test(v.trim())) code = v.trim().toUpperCase();
    }
  }
  if (!code) code = headerRegion(h);
  if (!code) code = "IN";
  return json(200, { country: regionCode(code), via: "header" });
}

export const APP_ICON_SPECS = [
  { id: "default", title: "Classic Muchi", bg: "#081612", discA: "#baffe6", discB: "#12c48c", ink: "#06241c", accent: "#34d399" },
  { id: "anime_cyber", title: "Cyber Anime", bg: "#0d0221", discA: "#ff007f", discB: "#00f0ff", ink: "#0f051d", accent: "#ff007f" },
  { id: "anime_kawaii", title: "Kawaii Mochi", bg: "#2a1526", discA: "#ffcbf2", discB: "#f72585", ink: "#ffffff", accent: "#ff70a6" },
  { id: "anime_mecha", title: "Mecha Unit-01", bg: "#120826", discA: "#7000ff", discB: "#39ff14", ink: "#0a0314", accent: "#39ff14" },
  { id: "anime_sakura", title: "Sakura Blossom", bg: "#1f1018", discA: "#ffe5ec", discB: "#fb7185", ink: "#3c0919", accent: "#fb7185" },
  { id: "anime_shonen", title: "Shonen Flame", bg: "#1a0800", discA: "#ffe600", discB: "#ff3d00", ink: "#260600", accent: "#ff9100" },
  { id: "anime_ninja", title: "Shadow Ninja", bg: "#05070e", discA: "#e63946", discB: "#1d3557", ink: "#ffffff", accent: "#e63946" },
  { id: "anime_chibi", title: "Chibi Sparkle", bg: "#19082a", discA: "#f1c0e8", discB: "#a3c4f3", ink: "#3c1361", accent: "#cfbaf0" },
  { id: "blurple_gamer", title: "Blurple Gamer", bg: "#1e1f22", discA: "#7289da", discB: "#5865f2", ink: "#ffffff", accent: "#5865f2" },
  { id: "gem_booster", title: "Gem Booster", bg: "#23153c", discA: "#f47fff", discB: "#be185d", ink: "#ffffff", accent: "#f47fff" },
  { id: "matrix_terminal", title: "Matrix Console", bg: "#001100", discA: "#80ff72", discB: "#008f11", ink: "#000000", accent: "#00ff66" },
  { id: "pixel_arcade", title: "8-Bit Arcade", bg: "#181425", discA: "#fbb954", discB: "#cd683d", ink: "#261b36", accent: "#e43b44" },
  { id: "solar_flare", title: "Solar Flare", bg: "#1c0d02", discA: "#ffea79", discB: "#ff6b00", ink: "#2b0d00", accent: "#ff8c00" },
  { id: "vaporwave", title: "Vaporwave 1984", bg: "#10061e", discA: "#f72585", discB: "#4cc9f0", ink: "#0e021a", accent: "#7209b7" },
  { id: "synthwave", title: "Synthwave Sunset", bg: "#180527", discA: "#ff4b91", discB: "#6c00ff", ink: "#ffffff", accent: "#ff4b91" },
  { id: "cosmic_nebula", title: "Cosmic Nebula", bg: "#090919", discA: "#b5179e", discB: "#480ca8", ink: "#ffffff", accent: "#4cc9f0" },
  { id: "ruby_crimson", title: "Crimson Ruby", bg: "#1a0006", discA: "#ff4d6d", discB: "#a4133c", ink: "#ffffff", accent: "#ff4d6d" },
  { id: "emerald_jade", title: "Imperial Jade", bg: "#021c14", discA: "#52b788", discB: "#1b4332", ink: "#ffffff", accent: "#74c69d" },
  { id: "holographic", title: "Holo Prism", bg: "#121420", discA: "#e0aaff", discB: "#7b2cbf", ink: "#ffffff", accent: "#c77dff" },
  { id: "y2k_chrome", title: "Y2K Liquid Chrome", bg: "#171a21", discA: "#e2e8f0", discB: "#64748b", ink: "#0f172a", accent: "#94a3b8" },
  { id: "midnight_stealth", title: "Obsidian Stealth", bg: "#000000", discA: "#334155", discB: "#0f172a", ink: "#f8fafc", accent: "#94a3b8" },
  { id: "sunset_lofi", title: "Lofi Twilight", bg: "#1e1022", discA: "#fca311", discB: "#e63946", ink: "#14213d", accent: "#fca311" },
  { id: "ocean_abyss", title: "Abyssal Deep", bg: "#030e1e", discA: "#48cae4", discB: "#0077b6", ink: "#03045e", accent: "#00b4d8" },
  { id: "citrus_burst", title: "Citrus Punch", bg: "#1a1600", discA: "#cbf3f0", discB: "#ff9f1c", ink: "#2ec4b6", accent: "#ffbf69" },
  { id: "royal_amethyst", title: "Royal Amethyst", bg: "#14041e", discA: "#d8b4e2", discB: "#5a189a", ink: "#ffffff", accent: "#e0aaff" },
];

export function handleAppIcon(url) {
  const rawId = String(url.searchParams.get("icon") || "default").trim();
  const size = Math.max(32, Math.min(1024, parseInt(url.searchParams.get("size") || "512", 10) || 512));
  const ic = APP_ICON_SPECS.find((x) => x.id === rawId) || APP_ICON_SPECS[0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">
  <defs>
    <linearGradient id="ic_disc_${ic.id}" x1="20%" y1="15%" x2="80%" y2="85%">
      <stop offset="0%" stop-color="${ic.discA}"/>
      <stop offset="100%" stop-color="${ic.discB}"/>
    </linearGradient>
    <radialGradient id="ic_glow_${ic.id}" cx="40%" cy="35%" r="60%">
      <stop offset="0%" stop-color="${ic.accent}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${ic.bg}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" rx="23" fill="${ic.bg}"/>
  <circle cx="50" cy="50" r="44" fill="url(#ic_glow_${ic.id})"/>
  <circle cx="50" cy="50" r="38" fill="none" stroke="${ic.accent}" stroke-width="1.8" opacity="0.55"/>
  <circle cx="50" cy="50" r="32" fill="url(#ic_disc_${ic.id})"/>
  <ellipse cx="41" cy="29" rx="13" ry="5" fill="#ffffff" opacity="0.28"/>
  <path d="M 33.5 64.5 L 33.5 35.5 L 50 56.5 L 66.5 35.5 L 66.5 64.5" fill="none" stroke="${ic.ink}" stroke-width="8.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="50" cy="66" r="4.3" fill="${ic.ink}"/>
</svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function handleManifest(url) {
  const rawId = String(url.searchParams.get("icon") || "default").trim();
  const ic = APP_ICON_SPECS.find((x) => x.id === rawId) || APP_ICON_SPECS[0];
  const isDefault = ic.id === "default";
  const icons = isDefault
    ? [
        { src: "/logo.png?v=53", sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: "/logo.png?v=53", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ]
    : [
        { src: `/api/app-icon?icon=${encodeURIComponent(ic.id)}&size=192`, sizes: "192x192", type: "image/svg+xml", purpose: "any maskable" },
        { src: `/api/app-icon?icon=${encodeURIComponent(ic.id)}&size=512`, sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" },
      ];
  return new Response(JSON.stringify({
    name: "Muchi",
    short_name: "Muchi",
    description: "Material You music player — YouTube official playback, Audius artists, live radio.",
    start_url: "/",
    display: "standalone",
    background_color: ic.bg,
    theme_color: ic.bg,
    icons,
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
