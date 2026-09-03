// MUCHI — PREVIEW-ONLY sample data (dev seed).
//
// This module exists so the Arena/workspace preview can be exercised even
// though the sandbox has NO egress to the real providers (YouTube, iTunes,
// Audius, Google, Piped). It is GUARDED by `env.MUCHI_PREVIEW_SEED`, which is
// set only in the locally git-ignored `.dev.vars` — it is NEVER set as a
// Cloudflare secret, so it cannot influence the deployed/production Worker.
//
// When the flag is set, the /api handlers return these curated, real-song
// records (title/artist/duration/source) so the UI shows populated shelves,
// search results, artist pages, and a working playback pipeline. Each record
// carries `streamUrl` pointing at /api/preview/audio, a locally-served tone,
// so tapping a song actually plays audio in the preview. Production always
// uses the real providers (this file is inert there).
//
// NOTE: durations/artwork are illustrative; tracks play a short local tone in
// the preview only, and the sample title set below is real song metadata.

// ── Curated sample pool (real songs, 6 genres) ───────────────────────────
const POOL = [
  // Pop
  ["Blinding Lights", "The Weeknd", 200],
  ["As It Was", "Harry Styles", 174],
  ["Levitating", "Dua Lipa", 203],
  ["Uptown Funk", "Mark Ronson feat. Bruno Mars", 270],
  ["Shape of You", "Ed Sheeran", 234],
  ["Shake It Off", "Taylor Swift", 219],
  // Hip-Hop
  ["Sicko Mode", "Travis Scott", 312],
  ["HUMBLE.", "Kendrick Lamar", 177],
  ["God's Plan", "Drake", 198],
  ["Lose Yourself", "Eminem", 326],
  ["Old Town Road", "Lil Nas X", 193],
  ["Alright", "Kendrick Lamar", 219],
  // R&B
  ["Leave the Door Open", "Bruno Mars & Anderson .Paak", 242],
  ["Peaches", "Justin Bieber feat. Daniel Caesar", 198],
  ["Kiss Me More", "Doja Cat feat. SZA", 208],
  ["CUFF IT", "Beyoncé", 224],
  ["Snooze", "SZA", 208],
  // Rock
  ["Mr. Brightside", "The Killers", 222],
  ["Seven Nation Army", "The White Stripes", 231],
  ["Smells Like Teen Spirit", "Nirvana", 278],
  ["Livin' on a Prayer", "Bon Jovi", 249],
  ["Highway to Hell", "AC/DC", 208],
  // Dance / Electronic
  ["One Kiss", "Calvin Harris & Dua Lipa", 214],
  ["Titanium", "David Guetta feat. Sia", 245],
  ["Clarity", "Zedd feat. Foxes", 271],
  ["Wake Me Up", "Avicii", 271],
  ["Levels", "Avicii", 218],
  // Indie / Alternative
  ["Do I Wanna Know?", "Arctic Monkeys", 272],
  ["Riptide", "Vance Joy", 204],
  ["Dog Days Are Over", "Florence + The Machine", 252],
  ["Somebody Else", "The 1975", 338],
  ["Motion Sickness", "Phoebe Bridgers", 225],
];

const SHELVES = [
  { id: "today",   title: "Today's Top Hits",         q: "today top hits" },
  { id: "pop",     title: "Pop",                      q: "pop" },
  { id: "hiphop",  title: "Hip-Hop",                  q: "hiphop" },
  { id: "rnb",     title: "R&B",                      q: "rnb" },
  { id: "rock",    title: "Rock",                     q: "rock" },
  { id: "dance",   title: "Dance & Electronic",       q: "dance" },
  { id: "indie",   title: "Indie",                    q: "indie" },
];

const GENRE_TO_SHELF = {
  pop: 0, hiphop: 1, rnb: 2, rock: 3, dance: 4, indie: 5,
};

// Map each pool entry to a genre tag so shelves can be partitioned.
const POOL_TAGS = [
  "pop", "pop", "pop", "pop", "pop", "pop",
  "hiphop", "hiphop", "hiphop", "hiphop", "hiphop", "hiphop",
  "rnb", "rnb", "rnb", "rnb", "rnb",
  "rock", "rock", "rock", "rock", "rock",
  "dance", "dance", "dance", "dance", "dance",
  "indie", "indie", "indie", "indie", "indie",
];

const AUDIO_URL = "/api/preview/audio";
const ARTWORK = "/cover-default.png";

let seq = 0;
function mkTrack([title, artist, duration], tag) {
  seq += 1;
  return {
    id: `pv:${seq}`,
    source: "preview",
    title,
    artist,
    album: "",
    duration,
    artwork: ARTWORK,
    streamUrl: AUDIO_URL,
    playQuery: `${title} ${artist} official audio`,
    _tag: tag,
  };
}

// Build a stable, non-empty song list for a shelf by id.
function tracksForShelf(shelfId) {
  const idx = SHELVES.findIndex((s) => s.id === shelfId);
  if (idx < 0) return [];
  const tag = SHELVES[idx].q;
  const matches = POOL.map((p, i) => ({ p, t: POOL_TAGS[i] })).filter((x) => x.t === tag);
  const list = matches.map((x, i) => mkTrack(x.p, x.t));
  return list;
}

function allTracks() {
  return POOL.map((p, i) => mkTrack(p, POOL_TAGS[i]));
}

// Metadata-only catalog rows (iTunes + Deezer) so the preview exercises the
// real catalog path: these have NO streamUrl/videoId, so tapping one goes
// through resolveYouTubePlay() → the same code the real app uses. With
// MUCHI_PREVIEW_SEED set, the YouTube search below is also seeded, so they
// resolve to a playable preview track instantly.
const CATALOG = [
  { source: "itunes", title: "Bad Habits", artist: "Ed Sheeran", duration: 231 },
  { source: "itunes", title: "Blinding Lights", artist: "The Weeknd", duration: 200 },
  { source: "itunes", title: "Save Your Tears", artist: "The Weeknd", duration: 215 },
  { source: "deezer", title: "Shallow", artist: "Lady Gaga & Bradley Cooper", duration: 215 },
  { source: "deezer", title: "Sixtynine", artist: "The 1975", duration: 253 },
  { source: "deezer", title: "HUMBLE.", artist: "Kendrick Lamar", duration: 177 },
];
function mkCatalogTrack(c) {
  seq += 1;
  return {
    id: `${c.source}:${seq}`,
    source: c.source,
    title: c.title,
    artist: c.artist,
    album: "",
    duration: c.duration,
    artwork: ARTWORK,
    // Give it a streamUrl so the PREVIEW can actually start audio (the tone)
    // when it's tapped. In the real app (no seed) catalog songs have no
    // streamUrl/videoId, so they route through resolveYouTubePlay() to a real
    // YouTube stream — the exact path these represent.
    streamUrl: AUDIO_URL,
    playQuery: `${c.title} ${c.artist} official audio`,
  };
}
function catalogTracks() {
  return CATALOG.map(mkCatalogTrack);
}

// ── /api/home ───────────────────────────────────────────────────────────
export function previewHome(gl) {
  const shelves = SHELVES.map((s) => {
    const tracks = tracksForShelf(s.id);
    // "today" mixes a few from every genre.
    const list = s.id === "today"
      ? POOL.map((p, i) => mkTrack(p, POOL_TAGS[i])).filter((_, i) => i % 3 === 0)
      : tracks;
    return { id: s.id, title: s.title, query: s.q, tracks: list };
  });
  return {
    country: gl || "IN",
    day: new Date().toISOString().slice(0, 10),
    localQuery: "popular songs",
    moods: [
      { id: "pop", title: "Pop", query: "pop", color: "#90e0ef" },
      { id: "hiphop", title: "Hip-Hop", query: "hiphop", color: "#e9c46a" },
      { id: "rnb", title: "R&B", query: "rnb", color: "#c084fc" },
      { id: "rock", title: "Rock", query: "rock", color: "#fb7185" },
      { id: "dance", title: "Dance & Electronic", query: "dance", color: "#4cc9f0" },
      { id: "indie", title: "Indie", query: "indie", color: "#80ed99" },
    ],
    shelves,
    youtubeCharts: allTracks().slice(0, 20),
    youtubeIndia: allTracks().slice(0, 12),
    youtubeLocal: allTracks().slice(0, 10),
    countryPlaylists: [],
    globalPlaylists: [],
    forYouPlaylists: [],
    audius: [],
    underground: allTracks().slice(0, 8),
    radio: [],
  };
}

// ── /api/shelf ───────────────────────────────────────────────────────────
export function previewShelf(id, q, gl) {
  const shelf = SHELVES.find((s) => s.id === id);
  const tracks = shelf ? tracksForShelf(shelf.id) : allTracks().slice(0, 16);
  return { id: id || "", title: (shelf && shelf.title) || "Songs", query: q || "", tracks };
}

// ── /api/search + /api/youtube/search ────────────────────────────────────
function matchTracks(q) {
  const needle = String(q || "").toLowerCase().trim();
  if (!needle) return allTracks().slice(0, 24);
  const tags = ["pop", "hiphop", "rnb", "rock", "dance", "indie"];
  const wantTag = tags.find((t) => needle.includes(t)) || "";
  return allTracks().filter((t) => {
    const hay = `${t.title} ${t.artist} ${t._tag}`.toLowerCase();
    if (wantTag && t._tag === wantTag) return true;
    return needle.split(/\s+/).every((w) => hay.includes(w));
  }).slice(0, 24);
}

export function previewSearch(q) {
  const tracks = matchTracks(q);
  // Surface the iTunes catalog rows too so the preview shows "apple" results
  // (the real worker returns these from itunesSearch; here we seed them).
  const needle = String(q || "").toLowerCase().trim();
  const apple = catalogTracks().filter((t) =>
    !needle || `${t.title} ${t.artist}`.toLowerCase().includes(needle)
  );
  return {
    tracks: tracks.slice(0, 20),
    youtube: tracks.slice(0, 20),
    apple,
    audius: [],
  };
}

export function previewYtSearch(q) {
  return { tracks: matchTracks(q).slice(0, 80) };
}

// ── /api/artist ───────────────────────────────────────────────────────────
export function previewArtist(name) {
  const tracks = matchTracks(name);
  const songs = tracks.length ? tracks : allTracks().slice(0, 16);
  return {
    name: name || songs[0].artist,
    artwork: ARTWORK,
    songs: songs.slice(0, 500),
    albums: [],
    tracks: songs.slice(0, 16),
    latest: songs[0] || null,
  };
}

// ── /api/related + /api/discover ─────────────────────────────────────────
export function previewRelated(title) {
  const base = matchTracks(title);
  const tracks = base.length ? base : allTracks().slice(0, 24);
  return { tracks: tracks.slice(0, 24) };
}

export function previewDiscover(gl) {
  return { week: "preview", title: "Discovery Mix", tracks: allTracks().slice(0, 30) };
}

// ── /api/radio ───────────────────────────────────────────────────────────
export function previewRadio(q) {
  return { tracks: matchTracks(q).slice(0, 36) };
}

// ── /api/lyrics ──────────────────────────────────────────────────────────
export function previewLyrics(title, artist) {
  return {
    title: title || "Song",
    artist: artist || "Artist",
    synced: null,
    plain: [
      `♪ ${title || "This song"} ♪`,
      "",
      `— ${artist || "Artist"}`,
      "",
      "(Preview lyrics shown for testing.)",
    ],
  };
}

// ── /api/preview/audio — a short, pleasant local tone (WAV) ─────────────
// 16-bit PCM mono WAV. ~6 seconds of a soft arpeggio so tapping a song in
// the preview actually plays audio through the <audio> player.
const WAV_SAMPLE_RATE = 16000;
let wavCache = null;
export function previewAudioWav() {
  if (wavCache) return wavCache;
  const sr = WAV_SAMPLE_RATE;
  const dur = 6.0;
  const n = Math.floor(sr * dur);
  const data = new Int16Array(n);
  // A soft C-major arpeggio with a gentle decay, so it's audible but not harsh.
  const freqs = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const tnote = t % 0.5;
    const step = Math.floor(t / 0.5) % freqs.length;
    const f = freqs[step];
    const attack = Math.min(1, tnote / 0.02);
    const decay = Math.exp(-tnote * 5);
    const env = attack * decay * 0.5 * (1 + 0.02 * Math.sin(2 * Math.PI * 5 * t));
    data[i] = Math.max(-32768, Math.min(32767, Math.round(env * 32767 * Math.sin(2 * Math.PI * f * t))));
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + n * 2, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);        // fmt chunk size
  header.writeUInt16LE(1, 20);         // PCM
  header.writeUInt16LE(1, 22);         // mono
  header.writeUInt32LE(sr, 24);        // sample rate
  header.writeUInt32LE(sr * 2, 28);    // byte rate
  header.writeUInt16LE(2, 32);         // block align
  header.writeUInt16LE(16, 34);        // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(n * 2, 40);
  const buf = Buffer.concat([header, Buffer.from(data.buffer)]);
  wavCache = buf;
  return buf;
}
