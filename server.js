import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import worker from "./src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const HOST = "0.0.0.0";

// In-memory Cloudflare D1 stub for session & OAuth state storage
function createInMemoryD1() {
  const sessions = new Map();
  const oauthStates = new Map();

  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
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
                return { success: true };
              }
              if (sql.includes("DELETE FROM sessions WHERE sid = ?")) {
                const [sid] = args;
                sessions.delete(sid);
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
  MUCHI_SESSION_SECRET: process.env.MUCHI_SESSION_SECRET || "muchi-preview-session-secret-key-32chars!",
  MUCHI_GITHUB: process.env.MUCHI_GITHUB || "",
  MUCHI_GITHUB_REPO: process.env.MUCHI_GITHUB_REPO || "Kaibshshdheueejw/Muchi",
  MUCHI_PREVIEW_SEED: process.env.MUCHI_PREVIEW_SEED || "",
};

const app = express();

// Serve static assets from public/ directory
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

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
      res.status(500).json({ error: String((err && err.message) || err || "Internal error") });
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
