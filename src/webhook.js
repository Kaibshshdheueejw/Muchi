// MUCHI — Webhook handler with cryptographic HMAC-SHA256 signature verification.
// Defends against forgery and replay attacks.

import { createHmac } from "node:crypto";
import { json } from "./util.js";
import { safeCompare } from "./auth.js";

/**
 * Handles incoming webhooks with mandatory cryptographic signature verification.
 * Supports:
 *   - GitHub Webhooks (X-Hub-Signature-256)
 *   - Generic HMAC webhooks (X-Webhook-Signature, X-Signature-SHA256)
 *   - Anti-replay timestamp checks (X-Webhook-Timestamp)
 */
export async function handleWebhook(request, env, url) {
  if (request.method !== "POST") {
    return json(405, { error: "Method Not Allowed" }, request);
  }

  // Resolve webhook secret
  const secret = (env && (env.WEBHOOK_SECRET || env.GITHUB_WEBHOOK_SECRET || env.MUCHI_WEBHOOK_SECRET)) ||
    (typeof process !== "undefined" && (process.env.WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET || process.env.MUCHI_WEBHOOK_SECRET)) ||
    (env && env.MUCHI_SESSION_SECRET) || "";

  if (!secret) {
    return json(503, { error: "Webhook secret is not configured on the server" }, request);
  }

  // Signature headers
  const ghSignature = request.headers.get("x-hub-signature-256") || "";
  const genericSignature = request.headers.get("x-webhook-signature") || request.headers.get("x-signature-sha256") || "";
  const providedSignature = ghSignature || genericSignature;

  if (!providedSignature) {
    return json(401, {
      error: "Missing required signature header (X-Hub-Signature-256 or X-Webhook-Signature)",
      ok: false,
    }, request);
  }

  // Replay attack prevention: verify timestamp freshness if provided
  const timestampHeader = request.headers.get("x-webhook-timestamp") || request.headers.get("x-signature-timestamp");
  if (timestampHeader) {
    const tsNum = Number(timestampHeader);
    if (!Number.isNaN(tsNum)) {
      const now = Date.now();
      const tsMs = tsNum < 1e11 ? tsNum * 1000 : tsNum;
      // Reject if timestamp is older than 5 minutes (300 seconds) or more than 1 minute in the future
      if (now - tsMs > 300000 || tsMs - now > 60000) {
        return json(400, { error: "Webhook timestamp expired or replay attack detected", ok: false }, request);
      }
    }
  }

  // Read raw payload text to compute exact HMAC
  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch (err) {
    return json(400, { error: "Invalid request payload", ok: false }, request);
  }

  // Calculate HMAC-SHA256
  const computedHash = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedSignature = `sha256=${computedHash}`;

  const normalizedProvided = providedSignature.startsWith("sha256=")
    ? providedSignature
    : `sha256=${providedSignature}`;

  // Timing-safe cryptographic comparison
  if (!safeCompare(normalizedProvided, expectedSignature)) {
    return json(401, { error: "Invalid webhook signature", ok: false }, request);
  }

  // Parse payload securely
  let payload = null;
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      // payload could be form-urlencoded or non-JSON
    }
  }

  const githubEvent = request.headers.get("x-github-event") || (payload && payload.event) || "generic";

  // Dispatch events safely
  if (githubEvent === "ping") {
    return json(200, { ok: true, event: "ping", message: "pong" }, request);
  }

  if (githubEvent === "release" || githubEvent === "push") {
    return json(200, { ok: true, event: githubEvent, received: true }, request);
  }

  return json(200, {
    ok: true,
    verified: true,
    event: githubEvent,
    timestamp: new Date().toISOString(),
  }, request);
}
