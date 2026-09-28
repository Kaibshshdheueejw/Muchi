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

import { json, corsHeaders, cached, invalidateCached } from "./util.js";
import { assertPublicUrl } from "./ssrf.js";
import { APP_NAME, APP_VERSION } from "./config.js";
import { audiusStreamUrl, youtubeAudioStream, searchYouTube, audiusSearch } from "./providers.js";

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
  const isDeezerCdn = /dzcdn\.net|deezer\.com/i.test(src);
  const isAppleCdn = /mzstatic\.com|apple\.com|itunes\.com/i.test(src);
  const isAudius = /audius|cidstream|open-audio-validator/i.test(src) || overrideMime === "audio/mpeg" || isDeezerCdn;
  const isRadio = /radio/i.test(src) || request.headers.get("icy-metadata") === "1";

  const headers = {
    Accept: accept || "*/*",
  };

  if (isYt) {
    if (/c=ANDROID_VR/i.test(src)) {
      headers["User-Agent"] = /cver=1\.61/i.test(src)
        ? "com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"
        : "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";
    } else if (/c=ANDROID_TESTSUITE/i.test(src)) {
      headers["User-Agent"] = "com.google.android.youtube/1.9 (Linux; U; Android 11) gzip";
    } else if (/c=TVHTML5/i.test(src)) {
      headers["User-Agent"] = "Mozilla/5.0 (PlayStation; PlayStation 4/11.50) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15";
      headers.Origin = "https://www.youtube.com";
      headers.Referer = "https://www.youtube.com/";
    } else if (/c=ANDROID/i.test(src)) {
      headers["User-Agent"] = "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip";
    } else if (/c=IOS/i.test(src)) {
      headers["User-Agent"] = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; en_US)";
    } else {
      const clientUa = request && request.headers && request.headers.get("user-agent");
      headers["User-Agent"] = (clientUa && !clientUa.includes("Cloudflare-Workers") && !clientUa.includes("node-fetch"))
        ? clientUa
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
      headers.Origin = "https://www.youtube.com";
      headers.Referer = "https://www.youtube.com/";
    }
  } else if (isDeezerCdn || isAppleCdn) {
    headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    if (isDeezerCdn) headers.Referer = "https://www.deezer.com/";
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
  const targetUrl = url.searchParams.get("url") || "";
  const primaryRes = await pipeUrl(request, targetUrl, PROXY_ACCEPT);
  if (primaryRes.status < 400) return primaryRes;

  // If upstream (e.g. expired or IP-bound googlevideo URL) failed with 403/410/502,
  // first try re-resolving a fresh full-length YouTube audio stream for the videoId or track query.
  const vId = (url.searchParams.get("v") || url.searchParams.get("videoId") || "").trim();
  const title = (url.searchParams.get("title") || "").trim();
  const artist = (url.searchParams.get("artist") || "").trim();
  const q = `${title} ${artist}`.trim();

  if (vId) {
    try {
      invalidateCached(`ytstream:${vId}`);
      const fresh = await youtubeAudioStream(vId);
      if (fresh && fresh.url && fresh.url !== targetUrl) {
        const rFresh = await pipeUrl(request, fresh.url, PROXY_ACCEPT, fresh.mimeType || "audio/mp4");
        if (rFresh.status < 400) return rFresh;
      }
    } catch {}
  }

  if (q) {
    try {
      const ytHits = await searchYouTube(`${q} official audio`, "US", true);
      const candidates = (Array.isArray(ytHits) ? ytHits : [])
        .filter((x) => x && x.videoId && x.videoId !== vId && (!x.duration || x.duration >= 45))
        .slice(0, 3);
      for (const cand of candidates) {
        try {
          const alt = await youtubeAudioStream(cand.videoId);
          if (alt && alt.url) {
            const rAlt = await pipeUrl(request, alt.url, PROXY_ACCEPT, alt.mimeType || "audio/mp4");
            if (rAlt.status < 400) return rAlt;
          }
        } catch {}
      }
    } catch {}

    if (title) {
      try {
        const audHits = await audiusSearch(q);
        if (Array.isArray(audHits) && audHits.length) {
          const wantTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          const matchAud = audHits.find((a) => {
            if (!a || (Number(a.duration) || 0) < 45) return false;
            const gotTitle = String(a.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
            return gotTitle && wantTitle && (gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle));
          });
          if (matchAud) {
            const audId = String(matchAud.trackId || matchAud.id || "").replace(/^audius:/, "");
            if (audId) {
              const audUrl = await audiusStreamUrl(audId);
              if (audUrl) {
                const rAud = await pipeUrl(request, audUrl, "audio/mpeg, audio/*;q=0.9, */*;q=0.8", "audio/mpeg");
                if (rAud.status < 400) return rAud;
              }
            }
          }
        }
      } catch {}
    }
  }

  return primaryRes;
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
  const videoId = (url.searchParams.get("videoId") || url.searchParams.get("v") || "").trim();
  const trackId = (url.searchParams.get("trackId") || "").trim();
  const rawStreamUrl = (url.searchParams.get("streamUrl") || url.searchParams.get("url") || "").trim();
  const isPreviewStreamUrl = (u) =>
    !u ||
    /^yt:/i.test(u) ||
    /\/api\/preview\/audio|dzcdn\.net|mzstatic\.com|itunes\.apple\.com|allowPreview=1/i.test(u);
  const streamUrl = isPreviewStreamUrl(rawStreamUrl) ? "" : rawStreamUrl;
  const title = (url.searchParams.get("title") || "").trim();
  const artist = (url.searchParams.get("artist") || "").trim();
  const query = (url.searchParams.get("query") || url.searchParams.get("q") || `${title} ${artist}`.trim()).trim();
  const name = sanitizeForFilename(url.searchParams.get("name") || title || "");
  const rawCands = (url.searchParams.get("candidates") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-zA-Z0-9_-]{6,20}$/.test(s) && s !== videoId);

  if (!videoId && !trackId && !streamUrl && !query) {
    return json(400, { error: "Missing videoId or trackId" });
  }

  let src = "";
  let mime = url.searchParams.get("mime") || (trackId ? "audio/mpeg" : "audio/mp4");

  const resolveYtCandidates = async (seedId) => {
    const ids = [];
    if (seedId) ids.push(seedId);
    for (const c of rawCands.slice(0, 4)) {
      if (!ids.includes(c)) ids.push(c);
    }
    if (query && ids.length < 4) {
      try {
        const res = await searchYouTube(`${query} official audio`.trim());
        for (const h of res || []) {
          if (h && h.videoId && !ids.includes(h.videoId)) {
            ids.push(h.videoId);
            if (ids.length >= 4) break;
          }
        }
      } catch {}
    }
    for (const vid of ids) {
      try {
        const s = await cached(`ytstream:${vid}`, 15 * 60 * 1000, () => youtubeAudioStream(vid));
        if (s && s.url) return s;
      } catch {
        try {
          const s = await youtubeAudioStream(vid);
          if (s && s.url) return s;
        } catch {}
      }
    }
    return null;
  };

  if (streamUrl) {
    src = streamUrl;
    try {
      if (src.includes("/api/stream") && src.includes("url=")) {
        const parsed = new URL(src, "http://localhost");
        const inner = parsed.searchParams.get("url");
        if (inner) src = isPreviewStreamUrl(inner) ? "" : inner;
      }
    } catch {}
  }
  if (!src && trackId) {
    try {
      src = await audiusStreamUrl(trackId);
      mime = "audio/mpeg";
    } catch (e) {
      return json(502, { error: String((e && e.message) || e) });
    }
  } else if (!src && (videoId || rawCands.length || query)) {
    const s = await resolveYtCandidates(videoId);
    if (s && s.url) {
      src = s.url;
      if (s.mimeType) mime = s.mimeType;
    }
  }

  const cleanName = sanitizeForFilename(name) || "track";
  const searchQuery = query || name || "";

  let orig = src ? await pipeUrl(request, src, PROXY_ACCEPT, mime) : { status: 502 };

  // If the upstream returned an explicit 404 (not found), do not attempt resolution or
  // fallback — pass the error through directly without Content-Disposition.
  if (orig.status === 404) {
    return orig instanceof Response ? orig : json(404, { error: "not found" });
  }

  // If the stream failed (e.g. 403 on expired/IP-mismatched Googlevideo URL, 410, or 502)
  // resolve a fresh stream URL directly across candidate videoIds and retry!
  if (orig.status === 403 || orig.status === 410 || orig.status >= 500 || !src) {
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
        const audCleanId = String(tId).replace(/^audius:/, "");
        src = await audiusStreamUrl(audCleanId);
        mime = "audio/mpeg";
        orig = await pipeUrl(request, src, PROXY_ACCEPT, mime);
      } else {
        if (vId) invalidateCached(`ytstream:${vId}`);
        const fresh = await resolveYtCandidates(vId);
        if (fresh && fresh.url) {
          src = fresh.url;
          if (fresh.mimeType) mime = fresh.mimeType;
          orig = await pipeUrl(request, src, PROXY_ACCEPT, mime);
        }
      }
    } catch {}
  }

  // Strict full-song Audius fallback ONLY if both title and artist genuinely match
  if ((!src || orig.status >= 400) && title && artist) {
    try {
      const audHits = await audiusSearch(`${title} ${artist}`.trim());
      if (Array.isArray(audHits) && audHits.length) {
        const cleanT = title.toLowerCase().replace(/[^\w\s]/g, "").trim();
        const cleanA = artist.toLowerCase().replace(/[^\w\s]/g, "").trim();
        const matchedAud = audHits.find((a) => {
          const ht = String(a.title || "").toLowerCase().replace(/[^\w\s]/g, "").trim();
          const ha = String(a.artist || "").toLowerCase().replace(/[^\w\s]/g, "").trim();
          return cleanT && cleanA && (ht.includes(cleanT) || cleanT.includes(ht)) && (ha.includes(cleanA) || cleanA.includes(ha)) && (a.duration || 0) >= 60;
        });
        const audId = matchedAud ? String(matchedAud.trackId || matchedAud.id || "").replace(/^audius:/, "") : "";
        if (audId) {
          const audUrl = await audiusStreamUrl(audId);
          if (audUrl) {
            src = audUrl;
            mime = "audio/mpeg";
            orig = await pipeUrl(request, src, PROXY_ACCEPT, mime);
          }
        }
      }
    } catch {}
  }

  // Never fall back to 30-second Deezer/iTunes previews or synthetic previewAudioWav tunes!
  if (!src || orig.status >= 400) {
    return orig instanceof Response ? orig : json(orig.status || 502, { error: "download failed" });
  }
  const ext = extFor(mime);
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
    const imgHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    };
    if (/dzcdn\.net|deezer\.com/i.test(src)) {
      imgHeaders.Referer = "https://www.deezer.com/";
    } else if (/ytimg\.com|googleusercontent\.com|ggpht\.com|youtube\.com/i.test(src)) {
      imgHeaders.Referer = "https://www.youtube.com/";
    }
    const r = await fetch(src, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: imgHeaders,
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
    // Block XSS / Content Sniffing: strictly restrict allowed content-types to safe raster images
    const rawCt = (r.headers.get("content-type") || "image/jpeg").toLowerCase().split(";")[0].trim();
    const safeImageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/x-icon"];
    const ct = safeImageTypes.includes(rawCt) ? rawCt : "image/jpeg";

    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        ...corsHeaders(),
      },
    });
  } catch (e) {
    return json(502, { error: "image fetch failed" });
  } finally {
    clearTimeout(timer);
  }
}
