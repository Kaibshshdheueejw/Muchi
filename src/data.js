// MUCHI — static data tables, ported VERBATIM from server.js (lines 683–1438).
// Same ids, titles, queries, colors, order — response shapes must not change.

export const LOCAL_CHARTS = {
  IN: "bollywood hits official",
  US: "top 40 usa official audio",
  GB: "uk top 40 official audio",
  CA: "canada top hits official",
  AU: "australia top hits official",
  DE: "deutsche charts official",
  FR: "france top hits official",
  JP: "jpop hits official",
  KR: "kpop hits official audio",
  BR: "brazil top hits official",
  MX: "mexico hits official",
  NG: "afrobeats hits official",
  ZA: "south africa amapiano hits",
  AE: "arabic hits official",
  SA: "khaleeji hits official",
  PK: "pakistan hits official",
  BD: "bangla hits official",
  ID: "indonesia hits official",
  MY: "malaysia hits official",
  SG: "singapore hits official",
  PH: "opm hits official",
  TH: "thai hits official",
  VN: "vpop hits official",
  EG: "egypt hits official",
  IT: "italy hits official",
  ES: "spain hits official",
  TR: "turkce pop hits official",
};

export const YT_SONGS_PARAMS = "EgWKAQIIAWoKEAkQBRAKEAMQBA==";

export const MOOD_CORE = [
  { id: "pop", title: "Pop", query: "english pop hits official audio", color: "#90e0ef", tags: "pop english hits" },
  { id: "hiphop", title: "Hip-Hop", query: "hip hop rap official audio", color: "#e9c46a", tags: "hiphop rap" },
  { id: "rnb", title: "R&B", query: "rnb soul hits official audio", color: "#c084fc", tags: "rnb soul" },
  { id: "rock", title: "Rock", query: "rock hits official audio", color: "#fb7185", tags: "rock alternative" },
  { id: "dance", title: "Dance", query: "edm dance hits official audio", color: "#4cc9f0", tags: "edm dance electronic" },
  { id: "indie", title: "Indie", query: "indie pop alternative official audio", color: "#80ed99", tags: "indie alternative" },
  { id: "lofi", title: "Lo-fi Focus", query: "lofi hip hop beats to relax", color: "#7c6cff", tags: "lofi chill study" },
  { id: "workout", title: "Workout", query: "workout gym motivation songs", color: "#c8f542", tags: "workout gym rap edm" },
  { id: "romance", title: "Late Night Love", query: "romantic english songs official audio", color: "#ff6b9d", tags: "romance love slow" },
  { id: "latin", title: "Latin", query: "latin hits official audio", color: "#f59e0b", tags: "latin reggaeton" },
];

export const ENGLISH_SHELVES = [
  { id: "today", title: "Today's Top Hits", query: "billboard hot 100 official audio" },
  { id: "pop", title: "Pop", query: "english pop hits official audio" },
  { id: "hiphop", title: "Hip-Hop", query: "hip hop rap hits official audio" },
  { id: "rnb", title: "R&B", query: "rnb soul hits official audio" },
  { id: "rock", title: "Rock", query: "classic and new rock hits official audio" },
  { id: "dance", title: "Dance & Electronic", query: "edm dance hits official audio" },
  { id: "indie", title: "Indie", query: "indie pop alternative official audio" },
];

export const MOODS_BY_COUNTRY = {
  IN: [
    { id: "bollywood", title: "Bollywood Gold", query: "best bollywood songs official", color: "#ff4d6d", tags: "bollywood hindi arijit" },
    { id: "punjabi", title: "Punjabi Heat", query: "punjabi hits official audio", color: "#ffb703", tags: "punjabi sidhu diljit" },
    { id: "tamil", title: "Kollywood", query: "tamil hits official", color: "#fb8500", tags: "tamil kollywood" },
    { id: "telugu", title: "Tollywood", query: "telugu hits official", color: "#ff6b35", tags: "telugu tollywood" },
    { id: "indie", title: "Indie India", query: "indian indie songs", color: "#4cc9f0", tags: "indie india" },
    { id: "romance-in", title: "Hindi Romance", query: "romantic hindi songs arijit singh", color: "#ff6b9d", tags: "romance hindi arijit" },
  ],
  PK: [
    { id: "pakistan", title: "Pakistani Hits", query: "pakistan hits official", color: "#22c55e", tags: "pakistan urdu" },
    { id: "qawwali", title: "Qawwali", query: "qawwali nusrat official", color: "#a78bfa", tags: "qawwali sufi" },
  ],
  BD: [{ id: "bangla", title: "Bangla Hits", query: "bangla hits official", color: "#22c55e", tags: "bangla bangladesh" }],
  US: [
    { id: "us-pop", title: "US Pop", query: "usa top 40 official audio", color: "#60a5fa", tags: "pop usa" },
    { id: "rnb", title: "R&B", query: "rnb hits official audio", color: "#c084fc", tags: "rnb soul" },
    { id: "country", title: "Country", query: "country hits official audio", color: "#f59e0b", tags: "country" },
    { id: "latin-us", title: "Latin", query: "latin hits official audio", color: "#fb7185", tags: "latin reggaeton" },
  ],
  GB: [
    { id: "uk-pop", title: "UK Hits", query: "uk top 40 official audio", color: "#818cf8", tags: "uk pop" },
    { id: "drill", title: "UK Drill", query: "uk drill official audio", color: "#64748b", tags: "drill grime uk" },
  ],
  KR: [
    { id: "kpop", title: "K-Pop", query: "kpop hits official audio", color: "#f72585", tags: "kpop korea" },
    { id: "krnb", title: "K-R&B", query: "k rnb official audio", color: "#c084fc", tags: "krnb kpop" },
  ],
  JP: [
    { id: "jpop", title: "J-Pop", query: "jpop hits official", color: "#fb7185", tags: "jpop japan" },
    { id: "anime", title: "Anime", query: "anime openings official", color: "#38bdf8", tags: "anime jpop" },
  ],
  NG: [{ id: "afrobeats", title: "Afrobeats", query: "afrobeats hits official", color: "#f59e0b", tags: "afrobeats nigeria" }],
  ZA: [{ id: "amapiano", title: "Amapiano", query: "amapiano hits official", color: "#84cc16", tags: "amapiano south africa" }],
  BR: [
    { id: "brazil", title: "Brazil Hits", query: "brazil top hits official", color: "#22c55e", tags: "brazil funk" },
    { id: "sertanejo", title: "Sertanejo", query: "sertanejo oficial", color: "#eab308", tags: "sertanejo brazil" },
  ],
  MX: [{ id: "mexico", title: "México", query: "mexico hits official", color: "#f97316", tags: "mexico latin regional" }],
  DE: [{ id: "german", title: "German Hits", query: "deutsche charts official", color: "#fbbf24", tags: "german pop" }],
  FR: [{ id: "french", title: "French Hits", query: "france top hits official", color: "#60a5fa", tags: "french pop" }],
  TR: [{ id: "turkish", title: "Türkçe Pop", query: "turkce pop hits official", color: "#ef4444", tags: "turkish pop" }],
  PH: [{ id: "opm", title: "OPM", query: "opm hits official", color: "#22d3ee", tags: "opm philippines" }],
  TH: [{ id: "tpop", title: "T-Pop", query: "thai hits official", color: "#f472b6", tags: "thai tpop" }],
  VN: [{ id: "vpop", title: "V-Pop", query: "vpop hits official", color: "#34d399", tags: "vpop vietnam" }],
  ID: [{ id: "indo", title: "Indonesia", query: "indonesia hits official", color: "#fb7185", tags: "indonesia pop" }],
  AE: [{ id: "arabic", title: "Arabic Hits", query: "arabic hits official", color: "#fbbf24", tags: "arabic khaleeji" }],
  SA: [{ id: "khaleeji", title: "Khaleeji", query: "khaleeji hits official", color: "#22c55e", tags: "arabic khaleeji" }],
  EG: [{ id: "egypt", title: "Egypt Hits", query: "egypt hits official", color: "#f59e0b", tags: "arabic egypt" }],
  IT: [{ id: "italian", title: "Italia", query: "italy hits official", color: "#22c55e", tags: "italian pop" }],
  ES: [{ id: "spain", title: "España", query: "spain hits official", color: "#f97316", tags: "spanish latin" }],
};

// "Made for you" curated playlists (server.js FY_QUERIES).
export const FY_QUERIES = [
  { title: "Trending", subtitle: "What the world is playing", query: "trending music hits" },
  { title: "Hit Releases", subtitle: "Fresh hits, just out", query: "new hit releases official audio" },
  { title: "Top 50 Global", subtitle: "The biggest songs right now", query: "top 50 global hits official audio" },
  { title: "Dance Hits", subtitle: "Club-ready anthems", query: "dance hits official audio" },
  { title: "Chill Vibes", subtitle: "Easy listening, all day", query: "chill vibes songs official audio" },
  { title: "Workout Energy", subtitle: "Push through the burn", query: "workout motivation songs official audio" },
  { title: "Indie Radar", subtitle: "Fresh independent sounds", query: "indie alternative hits official audio" },
  { title: "Throwback", subtitle: "90s & 2000s classics", query: "throwback 90s 2000s hits official audio" },
];

export const RADIO_HOSTS = [
  "https://de1.api.radio-browser.info",
  "https://fi1.api.radio-browser.info",
  "https://at1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
];

export function regionCode(raw) {
  const gl = String(raw || "IN").toUpperCase();
  return /^[A-Z]{2}$/.test(gl) ? gl : "IN";
}

export function moodsForCountry(gl) {
  const local = (MOODS_BY_COUNTRY[gl] || []).slice(0, 2);
  const seen = new Set();
  const out = [];
  for (const m of [...MOOD_CORE, ...local]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.slice(0, 12);
}

export function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

export function playlistsOf(v) {
  if (!v) return [];
  if (Array.isArray(v.playlists)) return v.playlists;
  if (Array.isArray(v) && Array.isArray(v.playlists)) return v.playlists;
  return [];
}

export function uniqPlaylists(list) {
  const seen = new Set();
  const out = [];
  for (const p of list || []) {
    const k = String((p && (p.playlistId || p.id || p.title)) || "").toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

export function pickPlaylistHit(pls, query) {
  const qw = String(query || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  let best = null;
  let bestScore = 0;
  for (const p of pls || []) {
    if (!p || !p.playlistId) continue;
    const t = String(p.title || "").toLowerCase();
    let s = 0;
    for (const w of qw) if (t.includes(w)) s += 1;
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best || (pls && pls[0]) || null;
}

// fyRes = Promise.allSettled results aligned with FY_QUERIES; may be [].
export function buildForYouPlaylists(fyRes) {
  return [
    ...FY_QUERIES.map((f, i) => {
      const v = fyRes && fyRes[i] && fyRes[i].status === "fulfilled" ? fyRes[i].value : null;
      return {
        id: `fy-${i}`,
        title: f.title,
        subtitle: f.subtitle,
        artwork: (v && v.artwork) || "",
        playlistId: (v && v.playlistId) || "",
        query: f.query,
        kind: "yt",
      };
    }),
    {
      id: "fy-mix",
      title: "Your Mix",
      subtitle: "From artists you like",
      artwork: "",
      playlistId: "",
      query: "",
      kind: "mix",
    },
    {
      id: "fy-chill",
      title: "Chill Mix",
      subtitle: "Easy listening",
      artwork: "",
      playlistId: "",
      query: "",
      kind: "mix",
    },
  ];
}
