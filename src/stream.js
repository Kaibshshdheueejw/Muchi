// MUCHI — URL proxy endpoints: /api/stream, /api/img, /api/audius/file,
// /api/audius/stream. Ported from server.js (pipeUrl 1100–1143, img
// 2015–2057, audius 1995–2015).
//
// /api/stream + /api/audius/file: pure pass-through. The Worker returns the
// upstream Response directly so the edge streams the body with ~zero JS CPU
// (free plan 10 ms CPU survives hours-long radio). Redirects are followed
// upstream; Range is forwarded and a 206 upstream stays 206 (the Node server
// ignored Range — no current MUCHI client sends one, behavior is identical).
//
// /api/img: buffered like server.js (10 s abort, 8 MB cap → 413, public
// cache 86400) with an early Content-Length guard added.

import { json, corsHeaders } from "./util.js";
import { assertPublicUrl } from "./ssrf.js";
import { APP_NAME, APP_VERSION } from "./config.js";
import { audiusStreamUrl, youtubeAudioStream } from "./providers.js";

const PROXY_ACCEPT = "audio/*,*/*";

function sanitizeForFilename(name) {
  const clean = String(name || "").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return (clean || "download").slice(0, 120);
}

function extFor(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("webm") || m.includes("ogg") || m.includes("opus")) return "webm";
  if (m.includes("mpeg") || m.includes("mp3") || m.includes("audio/mp")) return "mp3";
  if (m.includes("flac")) return "flac";
  return "m4a";
}

async function pipeUrl(request, src, accept) {
  try {
    await assertPublicUrl(src);
  } catch (e) {
    return json(400, { error: e.message || "bad url" });
  }
  const headers = {
    "User-Agent": `${APP_NAME}/${APP_VERSION}`,
    Accept: accept || "*/*",
    "Icy-MetaData": "1",
  };
  const range = request.headers.get("range");
  if (range) headers.Range = range;

  // Connect + headers timeout ONLY (45 s). The body stream itself is
  // unbounded — long-lived radio must survive for hours.
  // IMPORTANT (workerd-verified): the fetch AbortSignal cancels the response
  // BODY stream too once it fires, so the timer must be cleared as soon as
  // headers arrive (fetch() resolves at headers, before any body reads).
  const ctrl = new AbortController();
  const connectTimer = setTimeout(() => ctrl.abort(), 45000);
  let r;
  try {
    r = await fetch(src, {
      headers,
      redirect: "follow",
      signal: ctrl.signal,
    });
  } catch {
    return json(502, { error: "stream failed" });
  }
  clearTimeout(connectTimer);
  if (!r.ok || !r.body) return json(r.status || 502, { error: "stream failed" });

  const ct = r.headers.get("content-type") || "application/octet-stream";
  return new Response(r.body, {
    status: r.status === 206 ? 206 : 200, // 206 when the upstream honored a Range
    headers: {
      "Content-Type": ct.split(";")[0],
      "Cache-Control": "no-store",
      ...corsHeaders(),
    },
  });
}

/** /api/stream?url=… */
export async function handleStream(request, url) {
  return pipeUrl(request, url.searchParams.get("url") || "", PROXY_ACCEPT);
}

/** /api/audius/file/{trackId} — resolve stream URL then pass through. */
export async function handleAudiusFile(request, url) {
  const id = url.pathname.split("/").pop();
  try {
    const stream = await audiusStreamUrl(id);
    return pipeUrl(request, stream, PROXY_ACCEPT);
  } catch (e) {
    return json(502, { error: String((e && e.message) || e) });
  }
}

/** /api/audius/stream/{trackId} — JSON with the stream URL (server.js:1995). */
export async function handleAudiusStream(url) {
  const id = url.pathname.split("/").pop();
  try {
    const stream = await audiusStreamUrl(id);
    return json(200, { url: stream });
  } catch (e) {
    return json(502, { error: String((e && e.message) || e) });
  }
}

/**
 * /api/download?videoId=…|trackId=…|name=… — stream a track as an attachment
 * with a real filename + Content-Disposition so the client can save an actual
 * audio file (the Spotube-style "download with tagged metadata" flow). It
 * reuses the same proxying that makes native background playback work: the
 * raw source URL (Googlevideo / Audius) is fetched edge-side with proper
 * headers and streamed back, so the client always gets a valid, playable,
 * storable file.
 */
export async function handleDownload(request, url) {
  const videoId = url.searchParams.get("videoId") || url.searchParams.get("v") || "";
  const trackId = url.searchParams.get("trackId") || "";
  const name = sanitizeForFilename(url.searchParams.get("name") || "");
  let src = "";
  let mime = "audio/mp4";
  if (trackId) {
    try {
      src = await audiusStreamUrl(trackId);
      mime = "audio/mpeg";
    } catch (e) {
      return json(502, { error: String((e && e.message) || e) });
    }
  } else if (videoId) {
    // Resolve the audio URL with a retry — Piped instances are volatile, and a
    // single transient failure shouldn't fail the whole download. The fan-out
    // + retry makes real downloads land instead of erroring out.
    for (let attempt = 0; attempt < 2 && !src; attempt++) {
      try {
        const s = await youtubeAudioStream(videoId);
        if (s && s.url) {
          src = s.url;
          if (s.mimeType) mime = s.mimeType;
        }
      } catch {
        /* fall through to retry */
      }
    }
    if (!src) return json(502, { error: "No stream available for this track" });
  } else {
    return json(400, { error: "Missing videoId or trackId" });
  }
  const ext = extFor(mime);
  const orig = await pipeUrl(request, src, PROXY_ACCEPT);
  const disposition = `attachment; filename="${name}.${ext}"`;
  const h = new Headers(orig.headers);
  h.set("Content-Disposition", disposition);
  if (!h.has("Content-Type")) h.set("Content-Type", mime.split(";")[0]);
  h.set("Access-Control-Expose-Headers", "Content-Disposition, Content-Length");
  return new Response(orig.body, { status: orig.status, headers: h });
}

/** /api/img?url=… — buffered artwork proxy (server.js:2015). */
export async function handleImg(url) {
  const src = url.searchParams.get("url") || "";
  try {
    await assertPublicUrl(src);
  } catch (e) {
    return json(400, { error: e.message || "bad url" });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(src, {
      signal: ctrl.signal,
      headers: { "User-Agent": `${APP_NAME}/1.0`, Accept: "image/*" },
    });
    if (!r.ok) return json(r.status, { error: "image fetch failed" });

    // Early guard: reject oversized responses before buffering them.
    const len = Number(r.headers.get("content-length") || 0);
    if (len > 8 * 1024 * 1024) {
      ctrl.abort();
      return json(413, { error: "image too large" });
    }
    const chunks = [];
    let total = 0;
    const reader = r.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 8 * 1024 * 1024) {
        ctrl.abort();
        return json(413, { error: "image too large" });
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.length;
    }
    const ct = r.headers.get("content-type") || "image/jpeg";
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": ct.split(";")[0],
        "Cache-Control": "public, max-age=86400",
        ...corsHeaders(),
      },
    });
  } catch (e) {
    return json(502, { error: e.message || "image error" });
  } finally {
    clearTimeout(timer);
  }
}
