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

import { json, corsHeaders, cached } from "./util.js";
import { assertPublicUrl } from "./ssrf.js";
import { APP_NAME, APP_VERSION } from "./config.js";
import { audiusStreamUrl, youtubeAudioStream, searchYouTube } from "./providers.js";

const PROXY_ACCEPT = "audio/*,*/*";

function sanitizeForFilename(name) {
  const clean = String(name || "").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return (clean || "download").slice(0, 120);
}

function extFor(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("webm") || m.includes("ogg") || m.includes("opus")) return "webm";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("flac")) return "flac";
  return "m4a";
}

async function pipeUrl(request, src, accept, overrideMime) {
  try {
    await assertPublicUrl(src);
  } catch (e) {
    return json(400, { error: e.message || "bad url" });
  }

  const isYt = /googlevideo\.com|youtube\.com/i.test(src);
  const isAudius = /audius|cidstream|open-audio-validator/i.test(src) || overrideMime === "audio/mpeg";
  const isRadio = /radio/i.test(src) || request.headers.get("icy-metadata") === "1";

  const headers = {
    Accept: accept || "*/*",
  };

  if (isYt) {
    if (/c=ANDROID/i.test(src)) {
      if (/cver=20\.10/i.test(src)) {
        headers["User-Agent"] = "com.google.android.youtube/20.10.44 (Linux; U; Android 14) gzip";
      } else {
        headers["User-Agent"] = "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip";
      }
    } else if (/c=IOS/i.test(src)) {
      headers["User-Agent"] = "com.google.ios.youtube/19.09.3 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X) gzip";
    } else {
      const clientUa = request && request.headers && request.headers.get("user-agent");
      headers["User-Agent"] = (clientUa && !clientUa.includes("Cloudflare-Workers") && !clientUa.includes("node-fetch"))
        ? clientUa
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    }
    headers.Origin = "https://www.youtube.com";
    headers.Referer = "https://www.youtube.com/";
  } else {
    headers["User-Agent"] = `${APP_NAME}/${APP_VERSION}`;
    if (isRadio) headers["Icy-MetaData"] = "1";
  }

  const range = request.headers.get("range");
  if (range) {
    headers.Range = range;
  } else if (isYt) {
    // Googlevideo videoplayback streams require a byte range
    headers.Range = "bytes=0-";
  }

  // Connect + headers timeout ONLY. The body stream itself is
  // unbounded — long-lived radio must survive for hours.
  // IMPORTANT (workerd-verified): the fetch AbortSignal cancels the response
  // BODY stream too once it fires, so the timer must be cleared as soon as
  // headers arrive (fetch() resolves at headers, before any body reads).
  const ctrl = new AbortController();
  const connectTimer = setTimeout(() => ctrl.abort(), isRadio ? 30000 : 15000);
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

  // If Googlevideo returns 403, retry with standard browser User-Agent AND explicit Referer/Origin
  if (isYt && r.status === 403) {
    try {
      const retryHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        Origin: "https://www.youtube.com",
        Referer: "https://www.youtube.com/",
        Accept: accept || "*/*",
        Range: headers.Range || "bytes=0-",
      };
      const r2 = await fetch(src, {
        headers: retryHeaders,
        redirect: "follow",
      });
      if (r2.ok && r2.body) {
        r = r2;
      } else if (r2.status === 403) {
        // Fallback retry without Referer (certain Android/GoogleVideo edge nodes reject browser Referer)
        const r3 = await fetch(src, {
          headers: {
            "User-Agent": headers["User-Agent"] || retryHeaders["User-Agent"],
            Accept: accept || "*/*",
            Range: headers.Range || "bytes=0-",
          },
          redirect: "follow",
        });
        if (r3.ok && r3.body) r = r3;
      }
    } catch {}
  }

  if (!r.ok || !r.body) return json(r.status || 502, { error: "stream failed" });

  let ct = overrideMime || r.headers.get("content-type") || "application/octet-stream";
  if (isAudius && (!overrideMime || ct === "application/octet-stream")) {
    ct = "audio/mpeg";
  } else if (isYt && ct === "application/octet-stream") {
    ct = "audio/mp4";
  }

  const outHeaders = {
    "Content-Type": ct.split(";")[0],
    "Cache-Control": "no-store",
    ...corsHeaders(),
  };

  const clientHadRange = Boolean(range);
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const v = r.headers.get(h);
    if (v) outHeaders[h] = v;
  }
  // Ensure Accept-Ranges is advertised for seeking
  outHeaders["accept-ranges"] = "bytes";

  // If client did not send a Range header, do not echo an unsolicited content-range
  if (!clientHadRange) {
    delete outHeaders["content-range"];
  }

  outHeaders["Access-Control-Expose-Headers"] = "Content-Disposition, Content-Length, Content-Range, Accept-Ranges";
  return new Response(r.body, {
    status: (clientHadRange && r.status === 206) ? 206 : 200,
    headers: outHeaders,
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
    return pipeUrl(request, stream, "audio/mpeg, audio/*;q=0.9, */*;q=0.8", "audio/mpeg");
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
  const streamUrl = url.searchParams.get("streamUrl") || "";
  const query = url.searchParams.get("query") || url.searchParams.get("q") || "";
  const name = sanitizeForFilename(url.searchParams.get("name") || "");
  let src = "";
  let mime = url.searchParams.get("mime") || (trackId ? "audio/mpeg" : "audio/mp4");

  if (streamUrl) {
    // The client may already know a working stream URL (e.g. it resolved one
    // for playback via /api/yt/stream). Proxying it directly avoids re-hitting
    // Piped, whose instance endpoints are volatile — so downloads land even
    // when the Piped resolver is down. SSRF-guarded like every other fetch.
    src = streamUrl;
    try {
      if (src.includes("/api/stream") && src.includes("url=")) {
        const parsed = new URL(src, "http://localhost");
        const inner = parsed.searchParams.get("url");
        if (inner) src = inner;
      }
    } catch {}
  } else if (trackId) {
    try {
      src = await audiusStreamUrl(trackId);
      mime = "audio/mpeg";
    } catch (e) {
      return json(502, { error: String((e && e.message) || e) });
    }
  } else if (videoId) {
    // Resolve the audio URL via the SAME `ytstream:<id>` cache that
    // /api/yt/stream uses.
    try {
      const s = await cached(`ytstream:${videoId}`, 15 * 60 * 1000, () => youtubeAudioStream(videoId));
      if (s && s.url) {
        src = s.url;
        if (s.mimeType) mime = s.mimeType;
      }
    } catch {
      for (let attempt = 0; attempt < 2 && !src; attempt++) {
        try {
          const s = await youtubeAudioStream(videoId);
          if (s && s.url) {
            src = s.url;
            if (s.mimeType) mime = s.mimeType;
          }
        } catch {}
      }
    }
  } else if (query) {
    try {
      const res = await searchYouTube(query);
      const hit = (res || []).find((x) => x && x.videoId);
      if (hit) {
        const s = await youtubeAudioStream(hit.videoId);
        if (s && s.url) {
          src = s.url;
          if (s.mimeType) mime = s.mimeType;
        }
      }
    } catch {}
  }

  if (!src && videoId) {
    try {
      const s = await youtubeAudioStream(videoId);
      if (s && s.url) {
        src = s.url;
        if (s.mimeType) mime = s.mimeType;
      }
    } catch {}
  }

  if (!src && trackId) {
    try {
      src = await audiusStreamUrl(trackId);
      mime = "audio/mpeg";
    } catch {}
  }

  if (!src) return json(502, { error: "No stream available for this track" });

  let orig = await pipeUrl(request, src, PROXY_ACCEPT, mime);

  // If the stream failed (e.g. 403 on expired/IP-mismatched Googlevideo URL)
  // resolve a fresh stream URL directly and retry!
  if (orig.status >= 400) {
    try {
      let vId = videoId;
      let tId = trackId;
      if (!vId && !tId && streamUrl) {
        const mYt = streamUrl.match(/[?&](?:id|v|docid)=([a-zA-Z0-9_-]{11})/);
        if (mYt) vId = mYt[1];
        const mAud = streamUrl.match(/\/audius\/(?:file|stream)\/([a-zA-Z0-9_-]+)/) || streamUrl.match(/tracks\/([a-zA-Z0-9_-]+)\/stream/);
        if (mAud) tId = mAud[1];
      }
      if (tId) {
        src = await audiusStreamUrl(tId);
        mime = "audio/mpeg";
        orig = await pipeUrl(request, src, PROXY_ACCEPT, mime);
      } else {
        if (!vId && query) {
          const res = await searchYouTube(query);
          vId = (res || []).find((x) => x && x.videoId)?.videoId || "";
        }
        if (vId) {
          const fresh = await youtubeAudioStream(vId);
          if (fresh && fresh.url) {
            src = fresh.url;
            if (fresh.mimeType) mime = fresh.mimeType;
            orig = await pipeUrl(request, src, PROXY_ACCEPT, mime);
          }
        }
      }
    } catch {}
  }

  if (orig.status >= 400) return orig;
  const ext = extFor(mime);
  const cleanName = sanitizeForFilename(name) || "track";
  const asciiName = cleanName.replace(/[^\x20-\x7E]/g, "_");
  const encodedName = encodeURIComponent(`${cleanName}.${ext}`).replace(/['()]/g, escape).replace(/\*/g, "%2A");
  const disposition = `attachment; filename="${asciiName}.${ext}"; filename*=UTF-8''${encodedName}`;
  const h = new Headers(orig.headers);
  h.set("Content-Disposition", disposition);
  h.set("Content-Type", (mime || orig.headers.get("Content-Type") || "audio/mp4").split(";")[0]);
  h.set("Access-Control-Expose-Headers", "Content-Disposition, Content-Length, Content-Range, Accept-Ranges");
  const clientHadRange = Boolean(request.headers.get("range"));
  const dlStatus = (clientHadRange && orig.status === 206) ? 206 : 200;
  if (!clientHadRange) h.delete("content-range");
  return new Response(orig.body, { status: dlStatus, headers: h });
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
