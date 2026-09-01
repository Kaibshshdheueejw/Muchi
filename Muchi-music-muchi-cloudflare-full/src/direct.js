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
  });
}

/** /api/moods — same shape as server.js line 1660. */
export function handleMoods(url) {
  const gl = regionCode(url.searchParams.get("gl"));
  return json(200, { country: gl, moods: moodsForCountry(gl) });
}
