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
    github,
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
