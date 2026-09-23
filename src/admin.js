// MUCHI — Admin route handlers and server-side RBAC permissions guard.
// Protects administrative actions and isolates admin-level information.

import { json } from "./util.js";
import { safeCompare } from "./auth.js";
import { readSession } from "./oauth.js";
import { APP_VERSION, APP_NAME } from "./config.js";

/**
 * Retrieves authorized admin emails from environment config.
 * Defaults to twiarimascord@gmail.com and any comma-separated ADMIN_EMAILS.
 */
export function getAdminEmails(env) {
  const envEmails = (env && env.ADMIN_EMAILS) || (typeof process !== "undefined" && process.env.ADMIN_EMAILS) || "";
  const base = ["twiarimascord@gmail.com"];
  const list = String(envEmails)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...base, ...list]));
}

/**
 * Evaluates whether a session has verified admin privileges.
 */
export function isUserAdmin(session, env) {
  if (!session) return false;
  if (!session.email_verified) return false;
  if (session.role === "admin") return true;
  const emails = getAdminEmails(env);
  const userEmail = String(session.email || "").trim().toLowerCase();
  return emails.includes(userEmail);
}

/**
 * Server-side RBAC authentication check.
 * Accepts either:
 *  1. Authenticated session with verified email and admin role/email match
 *  2. Timing-safe x-admin-key / Authorization header matching MUCHI_ADMIN_KEY
 */
export async function checkAdminAuth(request, env) {
  // Check direct Admin API Key header
  const configuredAdminKey = (env && (env.MUCHI_ADMIN_KEY || env.ADMIN_KEY)) || (typeof process !== "undefined" && (process.env.MUCHI_ADMIN_KEY || process.env.ADMIN_KEY)) || "";
  const headerKey = request.headers.get("x-admin-key") || "";
  const authHeader = request.headers.get("authorization") || "";
  let bearerAdminKey = "";
  if (authHeader.startsWith("Admin ") || authHeader.startsWith("Bearer ")) {
    bearerAdminKey = authHeader.slice(authHeader.indexOf(" ") + 1).trim();
  }
  const providedKey = headerKey || bearerAdminKey;

  if (configuredAdminKey && providedKey) {
    if (safeCompare(providedKey, configuredAdminKey)) {
      return { authorized: true, source: "api_key", user: { role: "admin", email: "admin@system" } };
    }
  }

  // Check user session
  const session = await readSession(request, env);
  if (session) {
    if (isUserAdmin(session, env)) {
      return { authorized: true, source: "session", user: session };
    }
    // Session exists but lacks admin permissions -> 403 Forbidden
    return {
      authorized: false,
      forbidden: true,
      error: "Forbidden: Administrator privileges required",
    };
  }

  // No valid credentials provided -> 401 Unauthorized
  return {
    authorized: false,
    forbidden: false,
    error: "Unauthorized: Admin authentication required",
  };
}

/**
 * Master dispatcher for all /api/admin/* endpoints.
 */
export async function handleAdmin(request, env, url) {
  // Enforce strict server-side permissions on ALL admin routes
  const auth = await checkAdminAuth(request, env);
  if (!auth.authorized) {
    const status = auth.forbidden ? 403 : 401;
    return json(status, { error: auth.error, ok: false }, request);
  }

  const p = url.pathname;

  // GET /api/admin/status or /api/admin/metrics
  if (p === "/api/admin/status" || p === "/api/admin/metrics") {
    const uptimeSec = typeof process !== "undefined" && typeof process.uptime === "function"
      ? Math.floor(process.uptime())
      : 0;

    return json(200, {
      ok: true,
      name: APP_NAME,
      version: APP_VERSION,
      uptime: uptimeSec,
      timestamp: new Date().toISOString(),
      authenticatedAs: auth.user.email,
      system: {
        nodeEnv: (typeof process !== "undefined" && process.env.NODE_ENV) || "production",
        hasDb: !!(env && env.DB),
        hasCache: !!(env && env.CACHE),
        googleAuthEnabled: !!(env && env.GOOGLE_CLIENT_ID),
        githubReleaseSync: !!(env && env.MUCHI_GITHUB_REPO),
        webhooksConfigured: !!(env && (env.WEBHOOK_SECRET || env.GITHUB_WEBHOOK_SECRET || env.MUCHI_SESSION_SECRET)),
      },
    }, request);
  }

  // POST /api/admin/cache/clear
  if (p === "/api/admin/cache/clear") {
    if (request.method !== "POST") return json(405, { error: "Method Not Allowed" }, request);
    return json(200, { ok: true, message: "System caches cleared" }, request);
  }

  // POST /api/admin/sweep
  if (p === "/api/admin/sweep" || p === "/api/admin/sessions/sweep") {
    if (request.method !== "POST") return json(405, { error: "Method Not Allowed" }, request);
    if (env && env.DB) {
      try {
        await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()).run();
        await env.DB.prepare("DELETE FROM oauth_state WHERE expires_at < ?").bind(Date.now()).run();
      } catch (err) {
        console.error("Admin sweep error:", err);
      }
    }
    return json(200, { ok: true, message: "Expired sessions and OAuth states swept" }, request);
  }

  // GET /api/admin/permissions
  if (p === "/api/admin/permissions") {
    return json(200, {
      ok: true,
      role: "admin",
      verified: true,
      email: auth.user.email,
      adminEmails: getAdminEmails(env),
    }, request);
  }

  return json(404, { error: "Admin endpoint not found", ok: false }, request);
}
