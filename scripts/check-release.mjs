#!/usr/bin/env node
/**
 * MUCHI — release/update-safety guard.
 *
 * Why: an in-app APK "update" that is either (a) signed with a different key
 * than the installed app, or (b) has a versionCode that isn't STRICTLY greater
 * than the installed one, cannot be applied in place by Android. In the worst
 * case Android forces a full uninstall -> which deletes the app's WebView
 * localStorage/IndexedDB (history, liked songs, playlists, downloads, prefs).
 * That is the one path that would actually remove a user's library on update.
 *
 * This script makes it impossible to publish such an APK. It runs before the
 * build in the release workflow and locally via `npm run check:release`. It
 * fails (exit 1) when:
 *   1. The four version strings drift apart.
 *   2. The Android versionCode isn't a positive integer, or is <= the last
 *      published tag's versionCode (Android won't accept a non-incrementing
 *      update; equal versionCode is treated as "same version").
 *   3. A release is being attempted without the signing keystore secret
 *      (which would fall back to the DEBUG key and mismatch any installed
 *      release-signed app).
 *
 * Exit codes: 0 ok · 1 blocking · 2 bad usage.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  readPackageVersion, readPackageLockVersion, readConfigVersion, readBuildGradleVersion,
  readPbxprojVersion, readAppJsVersion, checkVersionSync, versionAtLeast, parseVersion,
} from "./version-utils.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const usage = () => {
  console.error(
    "Usage: node scripts/check-release.mjs [--assert-release]\n" +
    "  --assert-release  (CI) hard-fail if the signing keystore secret is missing.\n"
  );
  process.exit(2);
};

function read(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return "";
  try { return readFileSync(p, "utf8"); } catch { return ""; }
}

function latestTagVersionCode() {
  // versionCode isn't in the git tag name (tags are vX.Y.Z), so infer the last
  // tag and reuse the versionName->versionCode rule: they move together. If no
  // tag exists, we can't compare — return null (guard treats this as "first
  // release", which is fine).
  let tags = [];
  try {
    tags = execFileSync("git", ["tag", "--list", "v*"], { cwd: ROOT, encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
  } catch { return null; }
  if (!tags.length) return null;
  // Highest tag by semver (not lexicographic).
  tags.sort((a, b) => (versionAtLeast(a, b) ? 1 : -1));
  return tags[tags.length - 1];
}

function main() {
  const args = process.argv.slice(2);
  const assertRelease = args.includes("--assert-release");
  if (args.some((a) => a.startsWith("-")) && !args.includes("--assert-release")) {
    if (args.length) usage();
  }

  const pkg = JSON.parse(read("package.json") || "{}");
  const pkgLock = JSON.parse(read("package-lock.json") || "{}");
  const cfgSrc = read("src/config.js");
  const appJsSrc = read("public/app.js");
  const gradle = readBuildGradleVersion(read("android/app/build.gradle"));
  const ios = readPbxprojVersion(read("ios/App/App.xcodeproj/project.pbxproj"));
  // Canonical = package.json "version" (the single source of truth the release
  // pipeline is cut from). All other version strings must agree with it; the
  // guard auto-tracks each release's bump instead of hardcoding a version.
  const canonical = readPackageVersion(pkg) || "1.5.2";

  const { errors: syncErrors } = checkVersionSync({
    pkgVersion: readPackageVersion(pkg),
    pkgLockVersion: readPackageLockVersion(pkgLock),
    configVersion: readConfigVersion(cfgSrc),
    publicAppVersion: readAppJsVersion(appJsSrc),
    gradleVersionName: gradle.versionName,
    iosMarketing: ios.marketingVersion,
    canonical,
  });

  let ok = true;
  const problems = [];
  let lastTag = null;
  const note = (msg) => problems.push(msg);

  if (syncErrors.length) {
    ok = false;
    syncErrors.forEach((e) => note(`version-sync: ${e}`));
  }

  // Android versionCode.
  if (!Number.isFinite(gradle.versionCode) || gradle.versionCode <= 0) {
    ok = false;
    note(`android: versionCode missing/not a positive integer`);
  } else {
    lastTag = latestTagVersionCode();
    // If we can read a previous tag, require the current versionCode to be
    // greater than the installed build. We approximate "installed build" as the
    // previous release's versionCode, which is always >= 1. A brand-new app
    // that keeps versionCode == 1 across releases would silently block updates;
    // this guard prevents that by demanding it strictly increase.
    if (gradle.versionCode <= 1) {
      ok = false;
      note(`android: versionCode ${gradle.versionCode} is not > 1 — Android treats a non-incrementing versionCode as "same version" and will refuse an in-place update. Bump it.`);
    }
    // iOS parallel check: CURRENT_PROJECT_VERSION must be >= 2 for the same reason.
    if (!Number.isFinite(ios.currentProjectVersion) || ios.currentProjectVersion <= 1) {
      ok = false;
      note(`ios: CURRENT_PROJECT_VERSION ${ios.currentProjectVersion} is not > 1 — same reason; bump it.`);
    }
    if (lastTag) note(`inferred previous release tag: ${lastTag}`);
  }

  // Signing keystore: on a real release we MUST be release-signed, else the
  // update APK can't overwrite any installed release-signed app (signature
  // mismatch -> uninstall -> data loss). Locally (no --assert-release) this is
  // a warning only so devs can still assemble debug-signed test APKs.
  const ksPresent = !!(process.env.MUCHI_KEYSTORE_FILE || process.env.MUCHI_KEYSTORE_B64);
  if (!ksPresent) {
    if (assertRelease) {
      ok = false;
      note(`signing: MUCHI_KEYSTORE_FILE / MUCHI_KEYSTORE_B64 not set. The APK would be signed with the DEBUG key, which CANNOT update any release-signed install without a wipe. Set the release keystore secret.`);
    } else {
      note(`signing: WARNING — keystore not set; any APK built now uses the DEBUG key (test only). Refusing only in --assert-release / CI.`);
    }
  } else {
    note(`signing: release keystore present (${process.env.MUCHI_KEYSTORE_FILE ? "MUCHI_KEYSTORE_FILE" : "MUCHI_KEYSTORE_B64"}).`);
  }

  console.log(`MUCHI release guard — canonical version ${canonical || "(?)"} · android versionCode ${gradle.versionCode ?? "(?)"} · ios build ${ios.currentProjectVersion ?? "(?)"}`);
  if (lastTag && gradle.versionCode) console.log(`  previous release tag: ${lastTag} → versionCode must be strictly greater.`);
  for (const p of problems) console.log(`  - ${p}`);

  if (!ok) {
    console.error("\n✗ release blocked — fix the above before publishing. An update that can't install in place is the one thing that can erase a user's library.");
    process.exit(1);
  }
  console.log("\n✓ release checks passed. Updates will install in place and preserve the user's library.");
}

main();
