import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import worker from "./src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const HOST = "0.0.0.0";
const CLOUD_DB_FILE = path.join(__dirname, ".muchi-cloud-db.json");

// Persistent Cloudflare D1 stub for session, OAuth state & user library storage
function createInMemoryD1() {
  const sessions = new Map();
  const oauthStates = new Map();
  const userLibraries = new Map();

  // Load persisted sessions & user libraries from disk if present
  try {
    if (fs.existsSync(CLOUD_DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CLOUD_DB_FILE, "utf8") || "{}");
      if (raw && raw.sessions && typeof raw.sessions === "object") {
        for (const [k, v] of Object.entries(raw.sessions)) {
          if (v && v.expires_at > Date.now()) sessions.set(k, v);
        }
      }
      if (raw && raw.userLibraries && typeof raw.userLibraries === "object") {
        for (const [k, v] of Object.entries(raw.userLibraries)) {
          if (v && v.payload) userLibraries.set(k, v);
        }
      }
    }
  } catch {}

  let saveTimer = null;
  const schedulePersist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const dump = {
          sessions: Object.fromEntries(sessions.entries()),
          userLibraries: Object.fromEntries(userLibraries.entries()),
        };
        fs.writeFileSync(CLOUD_DB_FILE, JSON.stringify(dump), "utf8");
      } catch {}
    }, 150);
  };

  // Never seed an authenticated session. Local tests must use an explicit
  // test database/fixture and production must receive real signed sessions
  // created by OAuth; a known SID must never be deployable.
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("DELETE FROM oauth_state WHERE state = ? AND expires_at > ? RETURNING payload")) {
                const [state, exp] = args;
                const o = oauthStates.get(state);
                if (o && o.expires_at > exp) {
                  oauthStates.delete(state);
                  return { payload: o.payload };
                }
                return null;
              }
              if (sql.includes("FROM sessions WHERE sid = ? AND expires_at > ?")) {
                const [sid, exp] = args;
                const s = sessions.get(sid);
                if (s && s.expires_at > exp) {
                  return { payload: s.payload };
                }
                return null;
              }
              if (sql.includes("FROM oauth_state WHERE state = ? AND expires_at > ?")) {
                const [state, exp] = args;
                const o = oauthStates.get(state);
                if (o && o.expires_at > exp) {
                  return { payload: o.payload };
                }
                return null;
              }
              if (sql.includes("FROM user_library WHERE user_id = ?")) {
                const [userId] = args;
                const u = userLibraries.get(userId);
                if (u) return { payload: u.payload };
                return null;
              }
              return null;
            },
            async run() {
              if (sql.includes("INSERT INTO sessions")) {
                const [sid, payload, expires_at, created_at, updated_at] = args;
                const existing = sessions.get(sid);
                sessions.set(sid, {
                  payload,
                  expires_at,
                  created_at: existing ? existing.created_at : created_at,
                  updated_at,
                });
                schedulePersist();
                return { success: true };
              }
              if (sql.includes("INSERT INTO user_library")) {
                const [userId, payload, updatedAt] = args;
                userLibraries.set(userId, { payload, updated_at: updatedAt });
                schedulePersist();
                return { success: true };
              }
              if (sql.includes("DELETE FROM sessions WHERE sid = ?")) {
                const [sid] = args;
                sessions.delete(sid);
                schedulePersist();
                return { success: true };
              }
              if (sql.includes("DELETE FROM sessions WHERE expires_at < ?")) {
                const [exp] = args;
                for (const [sid, s] of sessions.entries()) {
                  if (s.expires_at < exp) sessions.delete(sid);
                }
                return { success: true };
              }
              if (sql.includes("INSERT INTO oauth_state")) {
                const [state, payload, expires_at] = args;
                oauthStates.set(state, { payload, expires_at });
                return { success: true };
              }
              if (sql.includes("DELETE FROM oauth_state WHERE state = ?")) {
                const [state] = args;
                oauthStates.delete(state);
                return { success: true };
              }
              if (sql.includes("DELETE FROM oauth_state WHERE expires_at < ?")) {
                const [exp] = args;
                for (const [state, o] of oauthStates.entries()) {
                  if (o.expires_at < exp) oauthStates.delete(state);
                }
                return { success: true };
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
}

// In-memory Cloudflare KV stub for daily caches
function createInMemoryKV() {
  const kv = new Map();
  return {
    async get(key) {
      const item = kv.get(key);
      if (!item) return null;
      if (item.expiresAt && Date.now() > item.expiresAt) {
        kv.delete(key);
        return null;
      }
      return item.value;
    },
    async put(key, value, options = {}) {
      const expiresAt = options.expirationTtl
        ? Date.now() + options.expirationTtl * 1000
        : null;
      kv.set(key, { value: String(value), expiresAt });
    },
    async delete(key) {
      kv.delete(key);
    },
  };
}

const env = {
  DB: createInMemoryD1(),
  CACHE: createInMemoryKV(),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || "",
  // Secrets must be injected explicitly. Empty values keep auth/webhooks off
  // instead of silently enabling a shared preview credential in production.
  MUCHI_SESSION_SECRET: process.env.MUCHI_SESSION_SECRET || "",
  MUCHI_ADMIN_KEY: process.env.MUCHI_ADMIN_KEY || process.env.ADMIN_KEY || "",
  ADMIN_EMAILS: process.env.ADMIN_EMAILS || "",
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || "",
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET || "",
  MUCHI_WEBHOOK_SECRET: process.env.MUCHI_WEBHOOK_SECRET || "",
  MUCHI_GITHUB: process.env.MUCHI_GITHUB || "",
  MUCHI_GITHUB_REPO: process.env.MUCHI_GITHUB_REPO || "Kaibshshdheueejw/Muchi",
  MUCHI_PREVIEW_SEED: process.env.MUCHI_PREVIEW_SEED || "",
  MUCHI_CORS_ORIGINS: process.env.MUCHI_CORS_ORIGINS || "",
  MUCHI_DEBUG: process.env.MUCHI_DEBUG || "",
  NODE_ENV: process.env.NODE_ENV || "production",
};

const app = express();
app.disable("x-powered-by");

// Global HTTP Security Headers. The policy is intentionally compatible with
// the existing Web shell (inline styles, generated markup, YouTube iframe),
// while blocking objects, unknown framing, and non-HTTPS remote code.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https: wss:; font-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' https://www.youtube.com https://www.gstatic.com; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; worker-src 'self' blob:;");
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (req.secure || forwardedProto === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

// Never let the private local session/library database resolve through the SPA
// fallback or a static-file route, even if a developer creates it locally.
app.get("/.muchi-cloud-db.json", (_req, res) => res.sendStatus(404));

// Serve static assets from public/ directory
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get(["/privacy", "/privacy.html"], (req, res) => {
  res.sendFile(path.join(publicDir, "privacy.html"));
});
app.get(["/terms", "/terms.html"], (req, res) => {
  res.sendFile(path.join(publicDir, "terms.html"));
});

// Route all /api requests to the Worker fetch handler
app.use("/api", async (req, res) => {
  try {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.get("host") || "localhost:3000";
    const fullUrl = new URL(req.originalUrl, `${protocol}://${host}`);

    const headers = new Headers();
    for (const [key, val] of Object.entries(req.headers)) {
      if (val !== undefined) {
        if (Array.isArray(val)) {
          for (const v of val) headers.append(key, v);
        } else {
          headers.set(key, val);
        }
      }
    }

    const method = req.method.toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD";

    const webReq = new Request(fullUrl.toString(), {
      method,
      headers,
      body: hasBody ? req : undefined,
      duplex: hasBody ? "half" : undefined,
    });

    const webRes = await worker.fetch(webReq, env, {
      waitUntil: (p) => p && typeof p.catch === "function" && p.catch(console.error),
      passThroughOnException: () => {},
    });

    res.status(webRes.status);

    if (typeof webRes.headers.getSetCookie === "function") {
      const cookies = webRes.headers.getSetCookie();
      if (cookies.length > 0) {
        res.setHeader("set-cookie", cookies);
      }
    }

    for (const [k, v] of webRes.headers.entries()) {
      if (k.toLowerCase() === "set-cookie") continue;
      res.setHeader(k, v);
    }

    if (!webRes.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(webRes.body);
    nodeStream.pipe(res);
  } catch (err) {
    console.error("API handler error:", err);
    if (!res.headersSent) {
      const isDev = process.env.NODE_ENV === "development";
      res.status(500).json({ error: isDev ? String((err && err.message) || err) : "Internal server error" });
    }
  }
});

// SPA fallback for all unmatched navigation requests
app.use((req, res) => {
  if (req.method === "GET") {
    res.sendFile(path.join(publicDir, "index.html"));
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Muchi server running on http://${HOST}:${PORT}`);
});
