// MUCHI — YouTube response parsers, ported VERBATIM from server.js
// (lines 114–683). These walk innerTube JSON and must keep identical
// output shapes (id/source/videoId/title/artist/album/duration/artwork).

export function ytThumb(thumbs) {
  if (!thumbs) return "";
  return (thumbs.high && thumbs.high.url) || (thumbs.medium && thumbs.medium.url) || (thumbs.default && thumbs.default.url) || "";
}

export function ytDurationToSec(iso) {
  if (!iso) return 0;
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return 0;
  return (parseInt(m[1] || "0", 10) * 3600) + (parseInt(m[2] || "0", 10) * 60) + parseInt(m[3] || "0", 10);
}

export function ytTrack(item, prefix) {
  const sn = item && item.snippet ? item.snippet : {};
  const cd = item && item.contentDetails ? item.contentDetails : {};
  const rid = sn.resourceId && sn.resourceId.videoId;
  // playlistItems: item.id is the PLAYLIST-ITEM id — the real video id lives
  // in contentDetails.videoId (or snippet.resourceId). videos.list: no
  // contentDetails.videoId, so fall back to item.id.
  const videoId = cd.videoId || rid || (item && item.id) || "";
  if (!videoId || !sn.title || /^private video$/i.test(sn.title)) return null;
  return {
    id: `${prefix}${videoId}`,
    videoId,
    source: "youtube",
    title: sn.title,
    artist: sn.channelTitle || "YouTube",
    artwork: ytThumb(sn.thumbnails),
    duration: cd.duration ? ytDurationToSec(cd.duration) : 0,
    streamUrl: "",
  };
}

export function decodeIdToken(idToken) {
  try {
    const part = String(idToken).split(".")[1] || "";
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function parseDuration(text) {
  if (!text) return 0;
  if (typeof text === "number") return text;
  const parts = String(text)
    .trim()
    .split(":")
    .map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

export function runsText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.simpleText) return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((r) => r.text || "").join("");
  return "";
}

export function extractVideoId(obj) {
  if (!obj || typeof obj !== "object") return "";
  if (obj.videoId) return obj.videoId;
  if (obj.playlistItemData && obj.playlistItemData.videoId) return obj.playlistItemData.videoId;
  const we =
    obj.watchEndpoint ||
    (obj.navigationEndpoint && obj.navigationEndpoint.watchEndpoint) ||
    (obj.playNavigationEndpoint && obj.playNavigationEndpoint.watchEndpoint);
  if (we && we.videoId) return we.videoId;
  return "";
}

export function parseMusicItem(m) {
  const videoId =
    extractVideoId(m) ||
    extractVideoId(
      m.overlay &&
        m.overlay.musicItemThumbnailOverlayRenderer &&
        m.overlay.musicItemThumbnailOverlayRenderer.content &&
        m.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer
    );
  if (!videoId) return null;

  const flex = m.flexColumns || [];
  const cols = flex.map((c) => {
    const t = c.musicResponsiveListItemFlexColumnRenderer && c.musicResponsiveListItemFlexColumnRenderer.text;
    return { text: runsText(t), runs: (t && t.runs) || [] };
  });
  const title = (cols[0] && cols[0].text) || "Unknown";
  let artist = "";
  let album = "";
  let duration = 0;
  const TYPE = /^(song|video|album|ep|playlist|artist|single|official)$/i;
  if (cols[1]) {
    const parts = cols[1].text.split("•").map((s) => s.trim()).filter(Boolean);
    const meta = parts.filter((p) => !TYPE.test(p) && !/^\d+:\d+/.test(p) && !/plays$/i.test(p) && !/^\d+(\.\d+)?[kmb]?\s*plays$/i.test(p));
    artist = meta[0] || "";
    if (meta[1]) album = meta[1];
    const durPart = parts.find((p) => /^\d+:\d+/.test(p));
    if (durPart) duration = parseDuration(durPart);
  }
  const fixed = m.fixedColumns || [];
  for (const f of fixed) {
    const t = f.musicResponsiveListItemFixedColumnRenderer && f.musicResponsiveListItemFixedColumnRenderer.text;
    const d = parseDuration(runsText(t));
    if (d) duration = d;
  }
  const thumbs =
    (m.thumbnail &&
      m.thumbnail.musicThumbnailRenderer &&
      m.thumbnail.musicThumbnailRenderer.thumbnail &&
      m.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails) ||
    [];
  const artwork = thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return {
    id: `yt:${videoId}`,
    source: "youtube",
    videoId,
    title,
    artist: artist || "YouTube",
    album,
    duration,
    artwork,
  };
}

export function parseVideoRenderer(v) {
  if (!v || !v.videoId) return null;
  const title = runsText(v.title);
  const artist = runsText(v.ownerText || v.longBylineText || v.shortBylineText) || "YouTube";
  const duration = parseDuration(runsText(v.lengthText));
  const thumbs = (v.thumbnail && v.thumbnail.thumbnails) || [];
  return {
    id: `yt:${v.videoId}`,
    source: "youtube",
    videoId: v.videoId,
    title,
    artist,
    album: "",
    duration,
    artwork: thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
  };
}

export function isLikelyMusic(t, loose) {
  if (!t || !t.videoId) return false;
  const title = String(t.title || "");
  const artist = String(t.artist || "");
  const blob = `${title} ${artist}`.toLowerCase();
  if (/^(episode|podcast|clip|news|trailer)$/i.test(artist.trim())) return false;
  if (/\b(gameplay|walkthrough|playthrough|trailer|teaser|full movie|watch online|episode|season\s*\d|vlog|tutorial|how to|unboxing|reaction|highlights?|podcast|asmr|minecraft|fortnite|roblox|gta\s*5|documentary|full match|press conference|#shorts?)\b/i.test(blob)) return false;
  if (/\b(funny moments|best moments|try not to laugh|top 10|explained|imran khan|nato)\b/i.test(blob)) return false;
  if (loose) return true;
  const dur = Number(t.duration) || 0;
  if (dur && dur < 35) return false;
  if (dur && dur > 20 * 60 && !/\b(mix|album|playlist|compilation|concert|live|set|lofi|lo-fi)\b/i.test(blob)) return false;
  return true;
}

// ── Strict "songs only" filter (all providers) ───────────────────────────
// Search, artist and playlist surfaces must list single songs — not
// playlist videos, 2-hour mixes, Topic-channel re-uploads or non-music
// content. Mirrors the client's looksLikeSong() so server and client
// agree on what counts as a song.
const JUNK_TEXT = /\b(episode|podcast|trailer|teaser|full movie|full length|gameplay|walkthrough|playthrough|watch online|vlog|tutorial|how to|unboxing|reaction|highlights?|minecraft|fortnite|roblox|gta\s*5|documentary|full match|press conference|nato|imran khan|#shorts?)\b/i;
const JUNK_TITLE = /\b(non[- ]?stop|full album|entire album|album mix|megamix|compilation|collection|dj set|live set|greatest hits|best of|billboard|top ?(?:10|20|40|50|100) ?songs?|hits ?(?:19\d\d|20\d\d|vol\.?\s*\d)|1 ?hour|one hour|hour mix|karaoke|sped ?up|slowed|reverb|mashup|medley|mixtape|mix tape|playlist|sleep mix|lofi mix)\b/i;
const JUNK_ARTIST = /\b(topic|mix|remix|hits|top|live|radio|station|compilation|various artists)\b/i;

export function isSongRow(t) {
  if (!t || !t.title) return false;
  const title = String(t.title);
  const artist = String(t.artist || "");
  const dur = Number(t.duration) || 0;
  if (dur > 1200) return false; // 20+ minutes = mix/compilation, not a song
  if (JUNK_TEXT.test(`${title} ${artist}`)) return false;
  if (JUNK_TITLE.test(title)) return false;
  if (JUNK_ARTIST.test(artist)) return false;
  return true;
}

// Filter + dedupe (title|artist) across providers.
export function strictSongs(list) {
  const out = [];
  const seen = new Set();
  for (const t of list || []) {
    if (!isSongRow(t)) continue;
    const k = `${String(t.title || "").toLowerCase()}|${String(t.artist || "").toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function walkCollect(node, out, seen, visiting = new Set(), opts = {}) {
  if (!node || typeof node !== "object") return;
  if (visiting.has(node)) return;
  visiting.add(node);
  const cap = Number(opts.limit) > 0 ? Number(opts.limit) : 40;
  if (out.length >= cap) return;
  if (Array.isArray(node)) {
    node.forEach((n) => walkCollect(n, out, seen, visiting, opts));
    return;
  }
  const keep = (item) => item && item.videoId && !seen.has(item.videoId) && isLikelyMusic(item, opts.loose);
  if (node.musicResponsiveListItemRenderer) {
    const item = parseMusicItem(node.musicResponsiveListItemRenderer);
    if (keep(item)) {
      seen.add(item.videoId);
      out.push(item);
    }
  }
  if (node.videoRenderer) {
    const item = parseVideoRenderer(node.videoRenderer);
    if (keep(item) && (!opts.musicOnly || opts.loose)) {
      seen.add(item.videoId);
      out.push(item);
    }
  }
  if (node.compactVideoRenderer) {
    const item = parseVideoRenderer(node.compactVideoRenderer);
    if (keep(item) && (!opts.musicOnly || opts.loose)) {
      seen.add(item.videoId);
      out.push(item);
    }
  }
  if (node.playlistVideoRenderer) {
    const v = node.playlistVideoRenderer;
    const item = parseVideoRenderer({
      videoId: v.videoId,
      title: v.title,
      shortBylineText: v.shortBylineText || v.ownerText,
      lengthText: v.lengthText,
      thumbnail: v.thumbnail,
    });
    if (keep(item)) {
      seen.add(item.videoId);
      out.push(item);
    }
  }
  if (node.playlistItemData && node.playlistItemData.videoId && node.flexColumns) {
    const item = parseMusicItem(node);
    if (keep(item)) {
      seen.add(item.videoId);
      out.push(item);
    }
  }
  for (const v of Object.values(node)) walkCollect(v, out, seen, visiting, opts);
}

export function lastThumb(thumbs) {
  if (!thumbs || !thumbs.length) return "/cover-default.jpg";
  return thumbs[thumbs.length - 1].url || thumbs[0].url || "/cover-default.jpg";
}

export function parseYtArtist(m) {
  if (!m) return null;
  const browse = (m.navigationEndpoint && m.navigationEndpoint.browseEndpoint) || {};
  const browseId = browse.browseId || "";
  const pageType =
    (browse.browseEndpointContextSupportedConfigs &&
      browse.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig &&
      browse.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType) ||
    "";
  const isArtist = pageType === "MUSIC_PAGE_TYPE_ARTIST" || /^UC/.test(browseId);
  if (!isArtist && !m.subscriberCountText) return null;
  const flex = m.flexColumns || [];
  const name =
    runsText(
      flex[0] &&
        flex[0].musicResponsiveListItemFlexColumnRenderer &&
        flex[0].musicResponsiveListItemFlexColumnRenderer.text
    ) ||
    runsText(m.title) ||
    "";
  if (!name) return null;
  const thumbs =
    (m.thumbnail &&
      m.thumbnail.musicThumbnailRenderer &&
      m.thumbnail.musicThumbnailRenderer.thumbnail &&
      m.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails) ||
    (m.thumbnail && m.thumbnail.thumbnails) ||
    [];
  return {
    id: `artist:${browseId || name}`,
    kind: "artist",
    name,
    artwork: lastThumb(thumbs),
    source: "youtube",
    query: name,
  };
}

export function parseYtPlaylist(node) {
  if (!node || typeof node !== "object") return null;
  const p = node.playlistRenderer || node;
  const m = node.musicTwoRowItemRenderer || node.musicResponsiveListItemRenderer || null;
  let playlistId = p.playlistId || "";
  const nav = p.navigationEndpoint || (m && m.navigationEndpoint) || {};
  if (!playlistId && nav.watchEndpoint && nav.watchEndpoint.playlistId) playlistId = nav.watchEndpoint.playlistId;
  if (!playlistId && nav.browseEndpoint && String(nav.browseEndpoint.browseId || "").startsWith("VL")) {
    playlistId = String(nav.browseEndpoint.browseId).slice(2);
  }
  if (!playlistId) return null;
  const title =
    runsText(p.title) ||
    runsText(m && m.title) ||
    (m &&
      m.flexColumns &&
      runsText(
        m.flexColumns[0] &&
          m.flexColumns[0].musicResponsiveListItemFlexColumnRenderer &&
          m.flexColumns[0].musicResponsiveListItemFlexColumnRenderer.text
      )) ||
    "Playlist";
  const thumbs =
    (p.thumbnails && p.thumbnails[0] && p.thumbnails[0].thumbnails) ||
    (p.thumbnail && p.thumbnail.thumbnails) ||
    (m &&
      m.thumbnailRenderer &&
      m.thumbnailRenderer.musicThumbnailRenderer &&
      m.thumbnailRenderer.musicThumbnailRenderer.thumbnail &&
      m.thumbnailRenderer.musicThumbnailRenderer.thumbnail.thumbnails) ||
    (m && m.thumbnail && m.thumbnail.musicThumbnailRenderer && m.thumbnail.musicThumbnailRenderer.thumbnail && m.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails) ||
    [];
  return {
    id: `ytpl:${playlistId}`,
    kind: "playlist",
    playlistId,
    title,
    artist: runsText(p.shortBylineText || p.longBylineText) || "YouTube",
    artwork: lastThumb(thumbs),
    source: "youtube",
    videoCount: p.videoCount || 0,
  };
}

export function walkCatalog(node, bag, visiting = new Set()) {
  if (!node || typeof node !== "object") return;
  if (visiting.has(node)) return;
  visiting.add(node);
  if (bag.artists.length >= 16 && bag.playlists.length >= 16) return;
  if (Array.isArray(node)) {
    node.forEach((n) => walkCatalog(n, bag, visiting));
    return;
  }
  if (node.channelRenderer) {
    const c = node.channelRenderer;
    const name = runsText(c.title);
    if (name && bag.artists.length < 16 && !bag.seenArt.has(name.toLowerCase())) {
      bag.seenArt.add(name.toLowerCase());
      bag.artists.push({
        id: `artist:${c.channelId || name}`,
        kind: "artist",
        name,
        artwork: lastThumb(c.thumbnail && c.thumbnail.thumbnails),
        source: "youtube",
        query: name,
      });
    }
  }
  if (node.playlistRenderer) {
    const pl = parseYtPlaylist(node);
    if (pl && bag.playlists.length < 16 && !bag.seenPl.has(pl.playlistId)) {
      bag.seenPl.add(pl.playlistId);
      bag.playlists.push(pl);
    }
  }
  if (node.musicTwoRowItemRenderer) {
    const pl = parseYtPlaylist({ musicTwoRowItemRenderer: node.musicTwoRowItemRenderer });
    if (pl && bag.playlists.length < 16 && !bag.seenPl.has(pl.playlistId)) {
      bag.seenPl.add(pl.playlistId);
      bag.playlists.push(pl);
    }
    const art = parseYtArtist(node.musicTwoRowItemRenderer);
    if (art && bag.artists.length < 16 && !bag.seenArt.has(art.name.toLowerCase())) {
      bag.seenArt.add(art.name.toLowerCase());
      bag.artists.push(art);
    }
  }
  if (node.musicResponsiveListItemRenderer) {
    const m = node.musicResponsiveListItemRenderer;
    const art = parseYtArtist(m);
    if (art && bag.artists.length < 16 && !bag.seenArt.has(art.name.toLowerCase())) {
      bag.seenArt.add(art.name.toLowerCase());
      bag.artists.push(art);
    }
    const pl = parseYtPlaylist({ musicResponsiveListItemRenderer: m });
    if (pl && bag.playlists.length < 16 && !bag.seenPl.has(pl.playlistId)) {
      bag.seenPl.add(pl.playlistId);
      bag.playlists.push(pl);
    }
  }
  for (const v of Object.values(node)) walkCatalog(v, bag, visiting);
}
