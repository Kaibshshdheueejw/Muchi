// MUCHI — environment/binding accessors (Cloudflare env pattern).
// Secrets are injected via `wrangler secret put` — never committed to Git,
// never sent to the client. Mirrors server.js env contract (lines 19–33).

export const APP_NAME = "Muchi";
export const APP_VERSION = "1.2.1"; // keep in sync with package.json (root)
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (server.js line 35)

export function authConfig(env) {
  const googleClientId = String(env.GOOGLE_CLIENT_ID || "").trim();
  const googleClientSecret = String(env.GOOGLE_CLIENT_SECRET || "").trim();
  const googleRedirectUri = String(env.GOOGLE_REDIRECT_URI || "").trim();
  const sessionSecret = String(env.MUCHI_SESSION_SECRET || "").trim();
  return {
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
    sessionSecret,
    on: !!(googleClientId && googleClientSecret && googleRedirectUri && sessionSecret),
    github: String(env.MUCHI_GITHUB || "").trim(),
  };
}

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
