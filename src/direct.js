// MUCHI — "direct" endpoints ported 1:1 from server.js: health, version, moods.
// Same shapes as server.js lines 1455–1466 and 1660–1664.

import { APP_NAME, APP_VERSION, authConfig } from "./config.js";
import { json } from "./util.js";
import { regionCode, moodsForCountry } from "./data.js";

/** /api/health + /api/version — same shape as server.js line 1455. */
export function handleHealth(env) {
  const { github } = authConfig(env || {});
  return json(200, {
    ok: true,
    name: APP_NAME,
    version: APP_VERSION,
    time: new Date().toISOString(),
    github,
    api: "",
    // In-app updater (public/app.js checkUpdates) reads these.
    android: { apkUrl: "https://github.com/Kaibshshdheueejw/Muchi/releases/latest/download/Muchi.apk" },
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
