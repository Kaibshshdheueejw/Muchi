// MUCHI — pure, testable version plumbing for the release/update-safety guard.
// Kept dependency-free, imported by both scripts/check-release.mjs (CLI) and
// test/smoke.mjs (unit tests). Nothing here touches runtime app state, so it
// can never affect playback/library features.

/** Split a semver-ish string into {major, minor, patch, pre?}. Tolerant of
 *  "v1.2.3", "1.2.3", "1.2", "1", "1.2.3-beta.1". Missing parts default 0. */
export function parseVersion(raw) {
  const s = String(raw == null ? "" : raw).trim().replace(/^v/i, "");
  const m = s.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+]?(.*))?$/);
  if (!m) return { major: 0, minor: 0, patch: 0, pre: "" };
  return {
    major: Number(m[1]) || 0,
    minor: Number(m[2] || 0),
    patch: Number(m[3] || 0),
    pre: (m[4] || "").toLowerCase(),
  };
}

/** a >= b by numeric major/minor/patch (ignores pre-release text so a build
 *  label can change without tripping the monotonic versionCode check). */
export function versionAtLeast(a, b) {
  const A = parseVersion(a), B = parseVersion(b);
  for (const k of ["major", "minor", "patch"]) {
    if (A[k] !== B[k]) return A[k] > B[k];
  }
  return true;
}

export function versionEqual(a, b) {
  const A = parseVersion(a), B = parseVersion(b);
  return A.major === B.major && A.minor === B.minor && A.patch === B.patch;
}

// ── Reading the 4 places a version lives (each a tiny, regex-tolerant parse) ──

export function readPackageVersion(pkg) {
  if (!pkg || typeof pkg !== "object") return "";
  return String(pkg.version || "");
}

// package-lock.json mirrors the app version at its root ("version") and at
// packages[""].version. npm ci honors the lock, so a stale lock means installs
// report the old version even after package.json is bumped.
export function readPackageLockVersion(lock) {
  if (!lock || typeof lock !== "object") return "";
  return String(lock.version || "");
}

export function readConfigVersion(src) {
  const m = String(src).match(/APP_VERSION\s*=\s*["']([^"']+)["']/);
  return m ? m[1] : "";
}

// public/app.js is the SERVED web client. It is deliberately self-contained
// (no import of src/config.js) so it can run as a static file, which means its
// own `const APP_VERSION` can drift from the server/package/native versions.
// The guard reads it so a release can't ship a client that tells users
// "Installed 1.5.1" while every other layer says 1.5.2.
export function readAppJsVersion(src) {
  const m = String(src).match(/const\s+APP_VERSION\s*=\s*["']([^"']+)["']/);
  return m ? m[1] : "";
}

export function readBuildGradleVersion(buildGradle) {
  const name = String(buildGradle).match(/versionName\s+["']?([^"'\s]+)["']?/);
  const code = String(buildGradle).match(/versionCode\s+(\d+)/);
  return {
    versionName: name ? name[1] : "",
    versionCode: code ? Number(code[1]) : NaN,
  };
}

export function readPbxprojVersion(pbx) {
  const marketing = String(pbx).match(/MARKETING_VERSION\s*=\s*([^;\s]+)\s*;/);
  const build = String(pbx).match(/CURRENT_PROJECT_VERSION\s*=\s*([^;\s]+)\s*;/);
  return {
    marketingVersion: marketing ? marketing[1].replace(/"/g, "") : "",
    currentProjectVersion: build ? Number(build[1].replace(/"/g, "")) : NaN,
  };
}

/** Actually compare all stored version strings to the canonical one. */
export function checkVersionSync(opts) {
  const { pkgVersion, pkgLockVersion, configVersion, gradleVersionName, iosMarketing, publicAppVersion, canonical } = opts;
  const errors = [];
  const checks = [
    ["package.json", pkgVersion],
    ["package-lock.json", pkgLockVersion],
    ["src/config.js APP_VERSION", configVersion],
    ["public/app.js APP_VERSION", publicAppVersion],
    ["android build.gradle versionName", gradleVersionName],
    ["ios MARKETING_VERSION", iosMarketing],
  ];
  for (const [where, v] of checks) {
    if (!v) errors.push(`${where}: missing version string`);
    else if (canonical && !versionEqual(v, canonical)) {
      errors.push(`${where}: "${v}" != canonical "${canonical}"`);
    }
  }
  return { errors, canonical: canonical || pkgVersion || gradleVersionName };
}

/** True only if every stored version string agrees (used by the guard). */
export function isSync({ pkgVersion, pkgLockVersion, configVersion, gradleVersionName, iosMarketing, publicAppVersion }) {
  const names = [
    pkgVersion, pkgLockVersion, configVersion, gradleVersionName, iosMarketing, publicAppVersion,
  ].filter(Boolean);
  if (names.length < 2) return false;
  const first = names[0];
  return names.every((v) => versionEqual(v, first));
}
