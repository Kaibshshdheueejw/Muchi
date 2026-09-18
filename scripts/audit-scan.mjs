// Comprehensive audit scan & smoke test for MUCHI v1.5.7
import { itunesSearch } from "../src/providers.js";
import { deezerSearch } from "../src/deezer.js";
import { handleSearch } from "../src/aggregate.js";
import { readFileSync } from "node:fs";
import { checkVersionSync } from "./version-utils.mjs";

async function runAudit() {
  console.log("=== MUCHI v1.5.7 AUDIT & SMOKE TEST ===");
  let passed = 0;
  let failed = 0;

  function assert(name, cond, details = "") {
    if (cond) {
      console.log(`[PASS] ${name}${details ? " - " + details : ""}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}${details ? " - " + details : ""}`);
      failed++;
    }
  }

  // 1. Versioning Audit
  console.log("\n--- 1. Version Synchronization ---");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const pkgLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const cfgSrc = readFileSync("src/config.js", "utf8");
  const appJsSrc = readFileSync("public/app.js", "utf8");
  const gradle = readFileSync("android/app/build.gradle", "utf8");
  const pbx = readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");

  const { errors: vErrors } = checkVersionSync({
    canonical: pkg.version,
    pkgVersion: pkg.version,
    pkgLockVersion: pkgLock.version,
    configVersion: cfgSrc.match(/APP_VERSION\s*=\s*["']([^"']+)["']/)?.[1],
    publicAppVersion: appJsSrc.match(/APP_VERSION\s*=\s*["']([^"']+)["']/)?.[1],
    gradleVersionName: gradle.match(/versionName\s+["']([^"']+)["']/)?.[1],
    iosMarketing: pbx.match(/MARKETING_VERSION\s*=\s*([^;\s]+)\s*;/)?.[1]?.replace(/"/g, ""),
  });

  assert("Version check across all platform targets", !vErrors || vErrors.length === 0, `Version: ${pkg.version}`);
  const gradleCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
  assert("Android target is 1.5.7 (code: 12)", pkg.version === "1.5.7" && gradleCode === 12, `versionCode: ${gradleCode}`);
  assert("iOS target is 1.5.7", pbx.includes("MARKETING_VERSION = 1.5.7;"));

  // 2. Equalizer & Dolby Atmos Complete Removal Audit
  console.log("\n--- 2. Equalizer & Dolby Atmos Removal Audit ---");
  const appJs = readFileSync("public/app.js", "utf8");
  const stylesCss = readFileSync("public/styles.css", "utf8");
  const audioUtils = readFileSync("scripts/audio-utils.mjs", "utf8");

  assert("app.js has no renderEqualizerPage", !appJs.includes("renderEqualizerPage"));
  assert("app.js has no openEqualizer route/button", !appJs.includes("openEqualizer"));
  assert("app.js has no eqMasterToggle", !appJs.includes("eqMasterToggle"));
  assert("app.js has no dolbyAtmosToggle", !appJs.includes("dolbyAtmosToggle"));
  const hookSoundStr = appJs.slice(appJs.indexOf("function hookSound()"), appJs.indexOf("function hookSound()") + 2000);
  assert("app.js hookSound has no equalizer bands or dolby processing", !hookSoundStr.includes("eqBands") && !hookSoundStr.includes("dolby") && !appJs.includes("renderEqualizerPage"));
  assert("app.js hookSound does not create ConvolverNode", !appJs.includes("createConvolver"));
  assert("styles.css has no .eq-fader or .dolby-badge", !stylesCss.includes(".eq-fader") && !stylesCss.includes(".dolby-badge"));
  assert("audio-utils.mjs has no EQ_FREQS export", !audioUtils.includes("EQ_FREQS"));

  // 3. Provider Search Audit (iTunes & Deezer)
  console.log("\n--- 3. Provider Search Audit (Live API Integration) ---");
  try {
    const itunesRes = await itunesSearch("Coldplay", { includeExtra: true });
    assert("itunesSearch returns songs array", Array.isArray(itunesRes.songs) && itunesRes.songs.length > 0, `Found: ${itunesRes.songs.length} songs`);
    if (itunesRes.songs && itunesRes.songs[0]) {
      const s0 = itunesRes.songs[0];
      assert("iTunes song structure valid", !!s0.id && !!s0.title && !!s0.artist && !!s0.previewUrl, `Title: ${s0.title} by ${s0.artist}`);
    }
  } catch (err) {
    assert("itunesSearch executed without exception", false, err.message);
  }

  try {
    const deezerRes = await deezerSearch("Coldplay", { limit: 50, includeExtra: true });
    assert("deezerSearch returns songs array", Array.isArray(deezerRes.songs) && deezerRes.songs.length > 0, `Found: ${deezerRes.songs.length} songs`);
    if (deezerRes.songs && deezerRes.songs[0]) {
      const s0 = deezerRes.songs[0];
      assert("Deezer song structure valid", !!s0.id && !!s0.title && !!s0.artist && !!s0.previewUrl, `Title: ${s0.title} by ${s0.artist}`);
    }
  } catch (err) {
    assert("deezerSearch executed without exception", false, err.message);
  }

  // 4. Aggregated Search API Performance & Coverage
  console.log("\n--- 4. Search API Endpoint Audit ---");
  const t0 = Date.now();
  const searchAllRes = await handleSearch({}, new URL("https://test.local/api/search?q=Coldplay"));
  const elapsed = Date.now() - t0;
  assert("Search completed smoothly", elapsed < 10000, `Completed in ${elapsed}ms`);
  const searchJson = await searchAllRes.json();
  assert("Aggregated search contains itunes array", Array.isArray(searchJson.itunes) && searchJson.itunes.length > 0, `Count: ${searchJson.itunes?.length}`);
  assert("Aggregated search contains apple array", Array.isArray(searchJson.apple) && searchJson.apple.length > 0, `Count: ${searchJson.apple?.length}`);
  assert("Aggregated search contains deezer array", Array.isArray(searchJson.deezer) && searchJson.deezer.length > 0, `Count: ${searchJson.deezer?.length}`);
  assert("Aggregated search contains youtube array", Array.isArray(searchJson.youtube) && searchJson.youtube.length > 0, `Count: ${searchJson.youtube?.length}`);
  assert("Aggregated search contains artists array", Array.isArray(searchJson.artists) && searchJson.artists.length > 0, `Count: ${searchJson.artists?.length}`);

  // Test individual provider search
  const itSearchRes = await handleSearch({}, new URL("https://test.local/api/search?q=Coldplay&source=itunes"));
  const itJson = await itSearchRes.json();
  assert("Direct iTunes search returns songs", Array.isArray(itJson.itunes) && itJson.itunes.length > 0, `Count: ${itJson.itunes?.length}`);

  const dzSearchRes = await handleSearch({}, new URL("https://test.local/api/search?q=Coldplay&source=deezer"));
  const dzJson = await dzSearchRes.json();
  assert("Direct Deezer search returns songs", Array.isArray(dzJson.deezer) && dzJson.deezer.length > 0, `Count: ${dzJson.deezer?.length}`);

  // 5. Client Search Tab UI Integrity Check
  console.log("\n--- 5. Client Search Tab UI Logic ---");
  assert("Client search tab handles itunes filter with truthy check", appJs.includes("Array.isArray(s.itunes) && s.itunes.length"));
  assert("Client ensureProviderResults synchronizes apple and itunes", appJs.includes("state.search.itunes = state.search.apple") || appJs.includes("state.search.itunes = songs"));

  console.log(`\n=== AUDIT COMPLETE: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) process.exit(1);
}

runAudit().catch((e) => {
  console.error("Audit crash:", e);
  process.exit(1);
});
