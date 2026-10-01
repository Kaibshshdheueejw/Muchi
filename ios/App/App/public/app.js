(() => {
  const $ = (id) => document.getElementById(id);
  const viewEl = $("view");
  const audio = $("audio");

  // ═══════ API BASE — THE single configuration point (docs/API-CONFIG.md) ═══════
  // Web (browser): the Worker serves this app, so API_BASE stays "" and API
  //   calls go to the SAME ORIGIN. Nothing to change.
  // Native (Android/iOS WebView): the app has no origin, so it must call an
  //   absolute backend URL. Current default is the production Worker:
  //     Staging:     "https://muchi-staging.<account>.workers.dev"
  //     Production:  "https://muchi.twiarimascord.workers.dev"
  //   (The old Render backend is only kept alive for pre-cutover APKs —
  //   see docs/CUTOVER.md. Never point new builds at Render.)
  const MUCHI_API_BASE_FALLBACK = "https://muchi.twiarimascord.workers.dev";
  // ═══════════════════════════════════════════════════════════════════════
  // Native shell (Capacitor) detection — the native apps load this same web
  // code inside a WebView with no server-side injection, so they always
  // talk to the absolute API origin configured above.
  const IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (IS_NATIVE && !window.MUCHI_API_BASE) {
    window.MUCHI_API_BASE = MUCHI_API_BASE_FALLBACK;
  }
  // Flag the native shell for CSS: the phone-tuning block in styles.css is
  // scoped to html[data-native="1"] so browser layout is never affected.
  if (IS_NATIVE) document.documentElement.setAttribute("data-native", "1");

  // Optional API base, injected by the server via window.MUCHI_API_BASE
  // (server.js reads MUCHI_API_BASE env). Empty = same-origin (default deploy).
  const API_BASE = String(window.MUCHI_API_BASE || "").trim().replace(/\/+$/, "");

  const state = {
    view: "home",
    home: null,
    apiStatus: "idle",
    search: null,
    query: "",
    filter: "all",
    artistPage: null,
    queue: [],
    index: -1,
    playing: false,
    shuffle: false,
    repeat: "off",
    volume: Number(localStorage.getItem("aura.vol") || 100),
    liked: load("aura.liked", []),
    recents: load("aura.recents", []),
    playlists: load("aura.playlists", []),
    lyrics: null,
    showQueue: false,
    showVideo: false,
    ytReady: false,
    yt: null,
    timer: null,
    radio: [],
    activePlaylist: null,
    auth: null,          // { configured, signedIn, profile, youtube }
    ytLiked: null,       // { tracks, truncated } | null
    ytPlaylists: null,   // [{id,title,artwork,count}] | null
    ytOpen: null,        // { id, title, tracks, loading, error } — open YT playlist
    ytBusy: false,
    ytReconnect: false,
    prefs: Object.assign({
      country: "IN",
      autoplay: true,
      normalize: false,
      speed: 1,
      spatial: "phone",
      quality: "high",
      appearance: "system",
      theme: "dark",
      crossfade: 0,
      resume: true,
      wake: false,
      bgPlay: true,
      autoLyrics: false,
      autoVideo: false,
      // ytAudio: play YouTube as a background audio stream on native shells
      // (enables OS media notification + lock-screen/background playback).
      // Default on for native; disabled automatically on web. Set to false to
      // force the in-app video player instead.
      ytAudio: null,
      codec: "auto",
      notifyFollows: true,
      github: "",
      username: "",
      avatar: "",
      ui: "glass",
      playerStyle: "pill",
      iconSize: "default",
      tasteGenres: [],
      tasteMoods: [],
      tasteEras: [],
      tasteStyles: [],
      tasteArtists: [],
      onboarded: false,
    }, load("aura.prefs", {})),
    offlineMode: Boolean(load("aura.offlineMode", false)),
    isNetworkOffline: typeof navigator !== "undefined" ? !navigator.onLine : false,
    showProfile: false,
    downloads: [],
    dlQueue: [],
    following: [],
    forYou: [],
    tasteTracks: load("aura.tasteTracks", []),
    followedArtistTracks: load("aura.followedArtistTracks", []),
    discovery: load("aura.discovery", { week: "", tracks: [] }),
    homeTasteTab: "moods",
    sleep: { mode: "off", until: 0, timer: null },
    playerReady: false,
    detailTrack: null,
    detailFrom: null,
    settingsPage: null,
    catalogPlaylist: null,
    queueRecs: [],
    _queueRecsSeed: "",
  };
  // Clean up removed equalizer/atmos preferences from state
  delete state.prefs.eqEnabled;
  delete state.prefs.eqPreset;
  delete state.prefs.eqBands;
  delete state.prefs.dolbyAtmos;
  delete state.prefs.atmosSurround;
  delete state.prefs.atmosHeight;
  delete state.prefs.atmosDialogue;

  // One-time migration: the old theme values "light"/"dark"/"system" were the
  // appearance mode itself — move them into the new `appearance` preference
  // so existing users keep exactly what they had. Only fires when the user
  // actually SAVED such a pref (not on the built-in default, which must keep
  // meaning "system" for brand-new users).
  const _savedPrefs = load("aura.prefs", {});
  if (_savedPrefs && ["system", "light", "dark"].includes(_savedPrefs.theme) && !_savedPrefs.appearance) {
    state.prefs.appearance = _savedPrefs.theme;
    state.prefs.theme = "dark";
  }
  if (!state.prefs.appearance) state.prefs.appearance = "system";
  const APP_VERSION = "1.9.2";

  const COUNTRIES = [
    ["IN", "India"], ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"],
    ["AU", "Australia"], ["DE", "Germany"], ["FR", "France"], ["JP", "Japan"],
    ["KR", "South Korea"], ["BR", "Brazil"], ["MX", "Mexico"], ["NG", "Nigeria"],
    ["ZA", "South Africa"], ["AE", "UAE"], ["SA", "Saudi Arabia"], ["PK", "Pakistan"],
    ["BD", "Bangladesh"], ["ID", "Indonesia"], ["MY", "Malaysia"], ["SG", "Singapore"],
    ["PH", "Philippines"], ["TH", "Thailand"], ["VN", "Vietnam"], ["EG", "Egypt"],
    ["IT", "Italy"], ["ES", "Spain"], ["TR", "Turkey"], ["NZ", "New Zealand"],
    ["NL", "Netherlands"], ["SE", "Sweden"],
    ["CN", "China"], ["HK", "Hong Kong"],
  ];

  function countryName(code) {
    const hit = COUNTRIES.find((c) => c[0] === code);
    return hit ? hit[1] : code;
  }

  function savePrefs() { save("aura.prefs", state.prefs); }

  function updateOfflineIndicator() {
    const offlineBtn = $("offlineBtn");
    if (offlineBtn) {
      const active = Boolean(state.offlineMode || state.isNetworkOffline);
      offlineBtn.style.display = active ? "inline-flex" : "none";
      offlineBtn.title = state.offlineMode
        ? "Offline mode active (click to reconnect online)"
        : "Network disconnected (click to retry connection)";
    }
  }

  async function retryServerConnection(btnEl) {
    const icon = btnEl && btnEl.querySelector(".material-symbols-outlined");
    if (icon) icon.classList.add("spin");
    toast("Checking connection to server…");
    try {
      const res = await fetch(`${API_BASE}/api/version`, { cache: "no-store", signal: AbortSignal.timeout(4500) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      state.isNetworkOffline = false;
      state.offlineMode = false;
      save("aura.offlineMode", false);
      updateOfflineIndicator();
      toast("Connected to server! Online catalog restored.", false, "success");
      if (state.query && state.view === "search") {
        doSearch(state.query);
      } else {
        render();
      }
    } catch {
      toast("Server unreachable. Still offline — try again in a moment.", false, "warning");
    } finally {
      if (icon) icon.classList.remove("spin");
    }
  }

  function setOfflineMode(enabled) {
    state.offlineMode = Boolean(enabled);
    save("aura.offlineMode", state.offlineMode);
    updateOfflineIndicator();
    toast(state.offlineMode ? "Offline mode active — only downloaded music" : "Online mode restored — all catalogs enabled");
    if (state.view === "settings" || state.view === "search" || state.view === "home") {
      render();
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      state.isNetworkOffline = false;
      updateOfflineIndicator();
      toast("Internet restored");
      if (state.view === "search" || state.view === "settings") render();
    });
    window.addEventListener("offline", () => {
      state.isNetworkOffline = true;
      updateOfflineIndicator();
      toast("Network offline — switched to downloaded music");
      if (state.view === "search" || state.view === "settings") render();
    });
  }

  // ── Persistent last-song player (Settings → Playback → Resume) ────────────
  // Saves the live queue + index + position on close/hide so the docked player
  // shows the last song (ready to resume) after the app is reopened.
  const PLAYER_SESSION_KEY = "aura.player.session";
  function slimPlayerQueue(q) {
    return (q || []).filter(Boolean).map((t) => ({
      id: t.id, title: t.title, artist: t.artist, artwork: t.artwork, duration: t.duration,
      source: t.source, videoId: t.videoId, trackId: t.trackId, stationId: t.stationId,
      playQuery: t.playQuery, album: t.album,
    }));
  }
  function savePlayerSession() {
    try {
      if (!state.queue.length || !current()) return;
      let pos = 0;
      try { pos = Math.max(0, Number(position()) || 0); } catch {}
      save(PLAYER_SESSION_KEY, {
        at: Date.now(),
        queue: slimPlayerQueue(state.queue),
        index: state.index,
        pos,
        playing: !!state.playing,
      });
    } catch {}
  }
  function restorePlayerSession() {
    if (!state.prefs.resume) return null;
    const s = load(PLAYER_SESSION_KEY, null);
    if (!s || !Array.isArray(s.queue) || !s.queue.length) return null;
    if (!Number.isInteger(s.index) || s.index < 0 || s.index >= s.queue.length) return null;
    return s;
  }
  if (state.prefs.soundV !== 3) {
    if (!state.prefs.spatial || state.prefs.spatial === "off" || !["phone", "bass", "spatial", "dynamic"].includes(state.prefs.spatial)) {
      state.prefs.spatial = "phone";
    }
    state.prefs.bgPlay = true;
    if (state.prefs.ytAudio === false) state.prefs.ytAudio = null;
    state.prefs.soundV = 3;
    savePrefs();
  }
  if (state.prefs.bgPlay !== true && state.prefs.bgPlay !== false) {
    state.prefs.bgPlay = true;
    savePrefs();
  }
  if (!state.prefs.loudV) {
    if (state.volume < 95) {
      state.volume = 100;
      save("aura.vol", 100);
    }
    state.prefs.loudV = 1;
    savePrefs();
  }
  if (!state.prefs.hqV) {
    state.prefs.quality = "high";
    state.prefs.hqV = 1;
    savePrefs();
  }

  const THEMES = [
    { id: "system", name: "Sync", blurb: "Match this device", group: "classic", surface: null, a: "#7dd3bb", b: "#a8cbe2" },
    { id: "dark", name: "Muchi", blurb: "Mint night", group: "classic", surface: "#101413", a: "#7dd3bb", b: "#a8cbe2" },
    { id: "midnight", name: "Midnight", blurb: "True black", group: "classic", surface: "#000000", a: "#c4b5fd", b: "#5865f2" },
    { id: "ash", name: "Ash", blurb: "Cool slate", group: "classic", surface: "#1a1c1e", a: "#b8c4d4", b: "#c6b8d6" },
    { id: "mono", name: "Mono", blurb: "Ink & paper", group: "classic", surface: "#0a0a0a", a: "#f2f2f2", b: "#888888" },
    { id: "light", name: "Daylight", blurb: "Soft light", group: "classic", surface: "#e6eae6", a: "#006b56", b: "#406278" },
    { id: "sunset", name: "Sunset", blurb: "Orange dusk", group: "color", surface: "#1a1014", a: "#ffb086", b: "#ff6b9a" },
    { id: "chroma", name: "Chroma", blurb: "Cyan glow", group: "color", surface: "#0c1018", a: "#64f0ff", b: "#ff8ad8" },
    { id: "candy", name: "Cotton candy", blurb: "Pink & sky", group: "color", surface: "#1a1220", a: "#ffb3e0", b: "#9ad8ff" },
    { id: "mars", name: "Mars", blurb: "Red desert", group: "color", surface: "#1a0e0c", a: "#ffb4a4", b: "#e8c089" },
    { id: "ocean", name: "Under the sea", blurb: "Deep teal", group: "color", surface: "#06141c", a: "#7dd3ff", b: "#8ee0c8" },
    { id: "forest", name: "Forest", blurb: "Moss & leaf", group: "color", surface: "#0c1410", a: "#8ee0a8", b: "#c6d48a" },
    { id: "twilight", name: "Twilight", blurb: "Violet hour", group: "color", surface: "#120e1c", a: "#d0bcff", b: "#ffb1c8" },
    { id: "blossom", name: "Blossom", blurb: "Sakura", group: "color", surface: "#1c1014", a: "#ffb1c8", b: "#ffcfc0" },
    { id: "ember", name: "Ember", blurb: "Warm gold", group: "color", surface: "#18110a", a: "#ffb95c", b: "#ffb086" },
    { id: "neon", name: "Neon", blurb: "Cyber mint", group: "color", surface: "#07080e", a: "#39ffb6", b: "#ff4fd8" },
    { id: "grape", name: "Grape", blurb: "Blurple night", group: "color", surface: "#0f1020", a: "#a78bfa", b: "#5865f2" },
    { id: "rose", name: "Rose", blurb: "Deep rose", group: "color", surface: "#1a0c12", a: "#ff8fb1", b: "#e11d48" },
    { id: "ice", name: "Ice", blurb: "Arctic glass", group: "color", surface: "#0b1418", a: "#a5f3fc", b: "#93c5fd" },
    { id: "lava", name: "Lava", blurb: "Molten red", group: "color", surface: "#140808", a: "#fb7185", b: "#f97316" },
    { id: "aurora", name: "Aurora", blurb: "North lights", group: "color", surface: "#081412", a: "#5eead4", b: "#c084fc" },
    { id: "coffee", name: "Coffee", blurb: "Espresso", group: "color", surface: "#16110c", a: "#d6b48a", b: "#8b5e34" },
    { id: "royal", name: "Royal", blurb: "Navy & gold", group: "color", surface: "#0b1020", a: "#f5d76e", b: "#60a5fa" },
    { id: "matcha", name: "Matcha", blurb: "Tea garden", group: "color", surface: "#10160e", a: "#bbf7d0", b: "#84cc16" },
    { id: "honey", name: "Honey", blurb: "Warm amber", group: "color", surface: "#1a1408", a: "#fcd34d", b: "#f59e0b" },
    { id: "ink", name: "Ink", blurb: "Deep navy", group: "color", surface: "#070b16", a: "#93c5fd", b: "#818cf8" },
    { id: "peach", name: "Peach", blurb: "Soft fruit", group: "color", surface: "#1c1210", a: "#fdba74", b: "#fda4af" },
  ];

  const APP_ICONS = [
    { id: "default", title: "Classic Muchi", category: "classic", bg: "#081612", discA: "#baffe6", discB: "#12c48c", ink: "#06241c", accent: "#34d399", desc: "Original mint emerald signature" },
    { id: "anime_cyber", title: "Cyber Anime", category: "anime", bg: "#0d0221", discA: "#ff007f", discB: "#00f0ff", ink: "#0f051d", accent: "#ff007f", desc: "Cyberpunk Tokyo neon glow" },
    { id: "anime_kawaii", title: "Kawaii Mochi", category: "anime", bg: "#2a1526", discA: "#ffcbf2", discB: "#f72585", ink: "#ffffff", accent: "#ff70a6", desc: "Pastel strawberry sparkle" },
    { id: "anime_mecha", title: "Mecha Unit-01", category: "anime", bg: "#120826", discA: "#7000ff", discB: "#39ff14", ink: "#0a0314", accent: "#39ff14", desc: "Purple armor with bio-green" },
    { id: "anime_sakura", title: "Sakura Blossom", category: "anime", bg: "#1f1018", discA: "#ffe5ec", discB: "#fb7185", ink: "#3c0919", accent: "#fb7185", desc: "Spring cherry blossom pink" },
    { id: "anime_shonen", title: "Shonen Flame", category: "anime", bg: "#1a0800", discA: "#ffe600", discB: "#ff3d00", ink: "#260600", accent: "#ff9100", desc: "Blazing golden fighting aura" },
    { id: "anime_ninja", title: "Shadow Ninja", category: "anime", bg: "#05070e", discA: "#e63946", discB: "#1d3557", ink: "#ffffff", accent: "#e63946", desc: "Stealth dark with crimson focus" },
    { id: "anime_chibi", title: "Chibi Sparkle", category: "anime", bg: "#19082a", discA: "#f1c0e8", discB: "#a3c4f3", ink: "#3c1361", accent: "#cfbaf0", desc: "Magic girl star wand pastel" },
    { id: "blurple_gamer", title: "Blurple Gamer", category: "gaming", bg: "#1e1f22", discA: "#7289da", discB: "#5865f2", ink: "#ffffff", accent: "#5865f2", desc: "Classic voice chat gaming aesthetic" },
    { id: "gem_booster", title: "Gem Booster", category: "gaming", bg: "#23153c", discA: "#f47fff", discB: "#be185d", ink: "#ffffff", accent: "#f47fff", desc: "Iridescent jewel booster glow" },
    { id: "matrix_terminal", title: "Matrix Console", category: "gaming", bg: "#001100", discA: "#80ff72", discB: "#008f11", ink: "#000000", accent: "#00ff66", desc: "Terminal digital stream" },
    { id: "pixel_arcade", title: "8-Bit Arcade", category: "gaming", bg: "#181425", discA: "#fbb954", discB: "#cd683d", ink: "#261b36", accent: "#e43b44", desc: "Nostalgic chiptune cartridge" },
    { id: "solar_flare", title: "Solar Flare", category: "vibrant", bg: "#1c0d02", discA: "#ffea79", discB: "#ff6b00", ink: "#2b0d00", accent: "#ff8c00", desc: "Blinding solar prominence" },
    { id: "vaporwave", title: "Vaporwave 1984", category: "vibrant", bg: "#10061e", discA: "#f72585", discB: "#4cc9f0", ink: "#0e021a", accent: "#7209b7", desc: "Synth-pop twilight aesthetic" },
    { id: "synthwave", title: "Synthwave Sunset", category: "vibrant", bg: "#180527", discA: "#ff4b91", discB: "#6c00ff", ink: "#ffffff", accent: "#ff4b91", desc: "80s outrun palm skyline" },
    { id: "cosmic_nebula", title: "Cosmic Nebula", category: "vibrant", bg: "#090919", discA: "#b5179e", discB: "#480ca8", ink: "#ffffff", accent: "#4cc9f0", desc: "Deep space interstellar cloud" },
    { id: "ruby_crimson", title: "Crimson Ruby", category: "vibrant", bg: "#1a0006", discA: "#ff4d6d", discB: "#a4133c", ink: "#ffffff", accent: "#ff4d6d", desc: "Precious gemstone scarlet" },
    { id: "emerald_jade", title: "Imperial Jade", category: "classic", bg: "#021c14", discA: "#52b788", discB: "#1b4332", ink: "#ffffff", accent: "#74c69d", desc: "Lush ancient rainforest green" },
    { id: "holographic", title: "Holo Prism", category: "vibrant", bg: "#121420", discA: "#e0aaff", discB: "#7b2cbf", ink: "#ffffff", accent: "#c77dff", desc: "Reflective iridescent crystal" },
    { id: "y2k_chrome", title: "Y2K Liquid Chrome", category: "vibrant", bg: "#171a21", discA: "#e2e8f0", discB: "#64748b", ink: "#0f172a", accent: "#94a3b8", desc: "Millennium metallic mercury" },
    { id: "midnight_stealth", title: "Obsidian Stealth", category: "minimal", bg: "#000000", discA: "#334155", discB: "#0f172a", ink: "#f8fafc", accent: "#94a3b8", desc: "Ultra-dark OLED monochrome" },
    { id: "sunset_lofi", title: "Lofi Twilight", category: "vibrant", bg: "#1e1022", discA: "#fca311", discB: "#e63946", ink: "#14213d", accent: "#fca311", desc: "Rooftop study beats warmth" },
    { id: "ocean_abyss", title: "Abyssal Deep", category: "classic", bg: "#030e1e", discA: "#48cae4", discB: "#0077b6", ink: "#03045e", accent: "#00b4d8", desc: "Bioluminescent ocean trench" },
    { id: "citrus_burst", title: "Citrus Punch", category: "vibrant", bg: "#1a1600", discA: "#cbf3f0", discB: "#ff9f1c", ink: "#2ec4b6", accent: "#ffbf69", desc: "Electric yuzu and blood orange" },
    { id: "royal_amethyst", title: "Royal Amethyst", category: "minimal", bg: "#14041e", discA: "#d8b4e2", discB: "#5a189a", ink: "#ffffff", accent: "#e0aaff", desc: "Deep imperial velvet violet" },
  ];

  function normalizeAppIconId(id) {
    const found = APP_ICONS.some((i) => i.id === id);
    return found ? id : "default";
  }

  function getIconThemeMotifSvg(id, accent, discA, discB, ink) {
    switch (id) {
      case "anime_sakura":
        return `
          <g opacity="0.9">
            <path d="M20 22 C24 16 30 20 25 26 C20 28 16 25 20 22 Z" fill="#ffcbf2">
              <animateTransform attributeName="transform" type="translate" values="0,0; 6,14; 0,0" dur="3.6s" repeatCount="indefinite"/>
            </path>
            <path d="M78 24 C82 18 88 22 83 28 C78 30 74 27 78 24 Z" fill="#fb7185">
              <animateTransform attributeName="transform" type="translate" values="0,0; -8,16; 0,0" dur="4.2s" repeatCount="indefinite"/>
            </path>
            <path d="M24 74 C28 68 34 72 29 78 C24 80 20 77 24 74 Z" fill="#ffe5ec">
              <animateTransform attributeName="transform" type="translate" values="0,0; 8,-10; 0,0" dur="3.8s" repeatCount="indefinite"/>
            </path>
          </g>`;
      case "anime_ninja":
        return `
          <g>
            <g transform="translate(76,22)">
              <polygon points="0,-10 3,-3 10,0 3,3 0,10 -3,3 -10,0 -3,-3" fill="${accent}">
                <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2.8s" repeatCount="indefinite"/>
              </polygon>
            </g>
            <line x1="16" y1="78" x2="84" y2="18" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" opacity="0.75">
              <animate attributeName="opacity" values="0.2;0.9;0.2" dur="2.2s" repeatCount="indefinite"/>
            </line>
          </g>`;
      case "anime_cyber":
        return `
          <g stroke="${discB}" stroke-width="1.6" fill="none" opacity="0.8">
            <path d="M12 30 H24 L30 24" />
            <path d="M88 70 H76 L70 76" stroke="${discA}" />
            <rect x="10" y="10" width="80" height="80" rx="18" stroke="${discB}" stroke-dasharray="14 8" opacity="0.45">
              <animate attributeName="stroke-dashoffset" from="0" to="44" dur="3s" repeatCount="indefinite"/>
            </rect>
          </g>`;
      case "anime_kawaii":
        return `
          <g fill="#ffffff">
            <polygon points="22,16 24,21 29,23 24,25 22,30 20,25 15,23 20,21">
              <animate attributeName="opacity" values="0.3;1;0.3" dur="2s" repeatCount="indefinite"/>
            </polygon>
            <polygon points="78,20 79.5,24 83.5,25.5 79.5,27 78,31 76.5,27 72.5,25.5 76.5,24">
              <animate attributeName="opacity" values="1;0.3;1" dur="2.4s" repeatCount="indefinite"/>
            </polygon>
          </g>`;
      case "anime_mecha":
        return `
          <polygon points="50,8 86,28 86,72 50,92 14,72 14,28" fill="none" stroke="${accent}" stroke-width="2" opacity="0.7">
            <animate attributeName="opacity" values="0.35;0.9;0.35" dur="2.4s" repeatCount="indefinite"/>
          </polygon>`;
      case "anime_shonen":
        return `
          <circle cx="50" cy="50" r="39" fill="none" stroke="${discA}" stroke-width="2.5" stroke-dasharray="6 6" opacity="0.8">
            <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="4s" repeatCount="indefinite"/>
          </circle>`;
      case "anime_chibi":
        return `
          <g fill="${accent}">
            <circle cx="20" cy="26" r="3"><animate attributeName="r" values="2;4.2;2" dur="2.2s" repeatCount="indefinite"/></circle>
            <circle cx="80" cy="26" r="3"><animate attributeName="r" values="4;2;4" dur="2.2s" repeatCount="indefinite"/></circle>
          </g>`;
      case "blurple_gamer":
        return `
          <circle cx="50" cy="50" r="38" fill="none" stroke="#ffffff" stroke-width="1.8" opacity="0.45">
            <animate attributeName="r" values="34;42;34" dur="2.6s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.6;0.1;0.6" dur="2.6s" repeatCount="indefinite"/>
          </circle>`;
      case "gem_booster":
        return `
          <polygon points="50,10 90,50 50,90 10,50" fill="none" stroke="#ffffff" stroke-width="1.8" opacity="0.55">
            <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="6s" repeatCount="indefinite"/>
          </polygon>`;
      case "matrix_terminal":
        return `
          <g fill="${accent}" font-family="monospace" font-size="8" font-weight="700" opacity="0.75">
            <text x="14" y="22">01</text>
            <text x="76" y="22">10</text>
            <text x="14" y="84">11</text>
            <text x="76" y="84">01</text>
          </g>`;
      case "pixel_arcade":
        return `
          <g fill="${accent}">
            <rect x="14" y="14" width="6" height="6"><animate attributeName="opacity" values="1;0.2;1" dur="1.4s" repeatCount="indefinite"/></rect>
            <rect x="80" y="14" width="6" height="6"><animate attributeName="opacity" values="0.2;1;0.2" dur="1.4s" repeatCount="indefinite"/></rect>
            <rect x="14" y="80" width="6" height="6"><animate attributeName="opacity" values="0.2;1;0.2" dur="1.4s" repeatCount="indefinite"/></rect>
            <rect x="80" y="80" width="6" height="6"><animate attributeName="opacity" values="1;0.2;1" dur="1.4s" repeatCount="indefinite"/></rect>
          </g>`;
      case "solar_flare":
        return `
          <circle cx="50" cy="50" r="39" fill="none" stroke="${discA}" stroke-width="2.2" stroke-dasharray="4 8" opacity="0.85">
            <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="5s" repeatCount="indefinite"/>
          </circle>`;
      case "vaporwave":
        return `
          <g stroke="${discB}" stroke-width="1.5" opacity="0.7">
            <line x1="12" y1="78" x2="88" y2="78"><animate attributeName="opacity" values="0.3;0.9;0.3" dur="2.2s" repeatCount="indefinite"/></line>
            <line x1="18" y1="84" x2="82" y2="84"/>
          </g>`;
      case "synthwave":
        return `
          <path d="M14 68 Q50 56 86 68" fill="none" stroke="${accent}" stroke-width="2" opacity="0.75">
            <animate attributeName="opacity" values="0.35;0.95;0.35" dur="2.5s" repeatCount="indefinite"/>
          </path>`;
      case "cosmic_nebula":
        return `
          <g fill="#ffffff">
            <circle cx="20" cy="22" r="1.8"><animate attributeName="opacity" values="0.2;1;0.2" dur="1.8s" repeatCount="indefinite"/></circle>
            <circle cx="82" cy="26" r="2.2"><animate attributeName="opacity" values="1;0.2;1" dur="2.1s" repeatCount="indefinite"/></circle>
            <circle cx="18" cy="78" r="1.6"><animate attributeName="opacity" values="0.4;1;0.4" dur="2.5s" repeatCount="indefinite"/></circle>
          </g>`;
      case "ruby_crimson":
        return `
          <polygon points="50,10 90,50 50,90 10,50" fill="none" stroke="${accent}" stroke-width="1.6" opacity="0.65">
            <animate attributeName="opacity" values="0.3;0.85;0.3" dur="2.2s" repeatCount="indefinite"/>
          </polygon>`;
      case "emerald_jade":
        return `
          <circle cx="50" cy="50" r="38" fill="none" stroke="${accent}" stroke-width="1.8" opacity="0.6">
            <animate attributeName="r" values="35;41;35" dur="3s" repeatCount="indefinite"/>
          </circle>`;
      case "holographic":
        return `
          <ellipse cx="50" cy="50" rx="40" ry="24" fill="none" stroke="${accent}" stroke-width="1.6" opacity="0.65">
            <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="5.5s" repeatCount="indefinite"/>
          </ellipse>`;
      case "y2k_chrome":
        return `
          <g stroke="#ffffff" stroke-width="1.6" opacity="0.75">
            <line x1="22" y1="14" x2="22" y2="26"/><line x1="16" y1="20" x2="28" y2="20"/>
            <line x1="78" y1="74" x2="78" y2="86"/><line x1="72" y1="80" x2="84" y2="80"/>
          </g>`;
      case "midnight_stealth":
        return `
          <rect x="12" y="12" width="76" height="76" rx="18" fill="none" stroke="${accent}" stroke-width="1.4" opacity="0.5">
            <animate attributeName="opacity" values="0.2;0.65;0.2" dur="2.8s" repeatCount="indefinite"/>
          </rect>`;
      case "sunset_lofi":
        return `
          <circle cx="50" cy="50" r="37" fill="none" stroke="${accent}" stroke-width="1.5" stroke-dasharray="10 6" opacity="0.7">
            <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="8s" repeatCount="indefinite"/>
          </circle>`;
      case "ocean_abyss":
        return `
          <circle cx="50" cy="50" r="36" fill="none" stroke="${accent}" stroke-width="1.8" opacity="0.55">
            <animate attributeName="r" values="33;42;33" dur="2.8s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.7;0.15;0.7" dur="2.8s" repeatCount="indefinite"/>
          </circle>`;
      case "citrus_burst":
        return `
          <circle cx="50" cy="50" r="38" fill="none" stroke="${accent}" stroke-width="2" stroke-dasharray="3 7" opacity="0.8">
            <animateTransform attributeName="transform" type="rotate" from="360 50 50" to="0 50 50" dur="6s" repeatCount="indefinite"/>
          </circle>`;
      case "royal_amethyst":
        return `
          <polygon points="34,14 42,22 50,12 58,22 66,14 64,24 36,24" fill="${accent}" opacity="0.8">
            <animate attributeName="opacity" values="0.45;0.95;0.45" dur="2.4s" repeatCount="indefinite"/>
          </polygon>`;
      case "default":
      default:
        return `
          <circle cx="50" cy="50" r="38" fill="none" stroke="${accent}" stroke-width="1.5" opacity="0.4">
            <animate attributeName="r" values="35;40;35" dur="3.2s" repeatCount="indefinite"/>
          </circle>`;
    }
  }

  function getAppIconSvg(iconId, size = 64) {
    const rawId = normalizeAppIconId(iconId);
    const icon = APP_ICONS.find((i) => i.id === rawId) || APP_ICONS[0];
    const { id, bg, discA, discB, ink, accent } = icon;
    const motif = getIconThemeMotifSvg(id, accent, discA, discB, ink);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">
      <defs>
        <linearGradient id="ic_disc_${id}" x1="20%" y1="15%" x2="80%" y2="85%">
          <stop offset="0%" stop-color="${discA}"/>
          <stop offset="100%" stop-color="${discB}"/>
        </linearGradient>
        <radialGradient id="ic_glow_${id}" cx="40%" cy="35%" r="60%">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="${bg}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100" height="100" rx="23" fill="${bg}"/>
      <circle cx="50" cy="50" r="44" fill="url(#ic_glow_${id})"/>
      ${motif}
      <circle cx="50" cy="50" r="32" fill="url(#ic_disc_${id})"/>
      <ellipse cx="41" cy="29" rx="13" ry="5" fill="#ffffff" opacity="0.28"/>
      <path d="M 33.5 64.5 L 33.5 35.5 L 50 56.5 L 66.5 35.5 L 66.5 64.5" fill="none" stroke="${ink}" stroke-width="8.2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="50" cy="66" r="4.3" fill="${ink}"/>
    </svg>`;
  }

  function getAppIconDataUri(iconId) {
    const rawId = normalizeAppIconId(iconId);
    if (rawId === "default") return "/logo.png?v=53";
    const svg = getAppIconSvg(rawId, 128);
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  function activeAppIconUrl() {
    const iconId = normalizeAppIconId(state.prefs && state.prefs.appIcon);
    return getAppIconDataUri(iconId);
  }

  function appIconLabel() {
    const curId = normalizeAppIconId(state.prefs && state.prefs.appIcon);
    const cur = APP_ICONS.find((i) => i.id === curId) || APP_ICONS[0];
    return cur.title;
  }

  function syncNativeAppIcon(iconId) {
    const norm = normalizeAppIconId(iconId || (state.prefs && state.prefs.appIcon));
    const NP = nativePlayer();
    if (NP && typeof NP.setAppIcon === "function") {
      try {
        NP.setAppIcon({ icon: norm }).catch(() => {});
      } catch {}
    }
  }

  function applyAppIcon() {
    const url = activeAppIconUrl();
    const imgs = document.querySelectorAll(".brand img, .home-brand img, #sidebarBrandIcon, #homeBrandIcon");
    imgs.forEach((el) => {
      el.src = url;
    });
    const iconLink = document.querySelector('link[rel="icon"]');
    if (iconLink) iconLink.href = url;
    const shortcutLink = document.querySelector('link[rel="shortcut icon"]');
    if (shortcutLink) shortcutLink.href = url;
    const appleLink = document.querySelector('link[rel="apple-touch-icon"]');
    if (appleLink) appleLink.href = url;
    syncNativeAppIcon(state.prefs && state.prefs.appIcon);
  }

  function setAppIcon(id) {
    const norm = normalizeAppIconId(id);
    const ic = APP_ICONS.find((x) => x.id === norm) || APP_ICONS[0];
    state.prefs.appIcon = ic.id;
    savePrefs();
    applyAppIcon();
    syncNativeAppIcon(ic.id);
    toast(`App icon changed to "${ic.title}"`, true, "success");
    playAppOpeningAnimation(ic.id, true);
    render();
  }

  function getOpeningAnimationHtml(icon) {
    const id = (icon && icon.id) || "default";
    const bg = (icon && icon.bg) || "#081612";
    const iconSvg = renderAppIconPreview(icon, 76);

    let fxMarkup = "";

    switch (id) {
      case "anime_sakura":
        fxMarkup = `
          <div class="fx-sakura-glow"></div>
          ${Array.from({ length: 14 }).map((_, i) => `
            <div class="fx-sakura-petal" style="--sx:${(i * 7.2)}vw;--drift:${((i % 2 === 0 ? 1 : -1) * (35 + (i * 7)))}px;animation-delay:${(i * 65)}ms"></div>
          `).join("")}
        `;
        break;
      case "anime_ninja":
        fxMarkup = `
          <div class="fx-ninja-slash"></div>
          <svg class="fx-ninja-shuriken" viewBox="0 0 100 100">
            <polygon points="50,0 60,35 95,50 60,65 50,100 40,65 5,50 40,35" fill="#e63946"/>
            <circle cx="50" cy="50" r="14" fill="#05070e"/>
          </svg>
        `;
        break;
      case "anime_cyber":
        fxMarkup = `
          <div class="fx-cyber-grid"></div>
          <div class="fx-cyber-scanline"></div>
        `;
        break;
      case "anime_kawaii":
        fxMarkup = `
          ${["★", "✦", "♥", "✿", "★", "✦", "♥"].map((sym, i) => `
            <div class="fx-mochi-star" style="--mx:${(i * 14 - 42)}px;--my:${((i % 3 - 1) * 35)}px;animation-delay:${(i * 90)}ms">${sym}</div>
          `).join("")}
        `;
        break;
      case "anime_mecha":
        fxMarkup = `
          <div class="fx-at-field"></div>
          <div class="fx-at-field" style="animation-delay:180ms;border-color:#7000ff"></div>
        `;
        break;
      case "anime_shonen":
        fxMarkup = `
          <div class="fx-shonen-flame"></div>
        `;
        break;
      case "anime_chibi":
        fxMarkup = `
          ${Array.from({ length: 8 }).map((_, i) => `
            <div class="fx-chibi-sparkle" style="--deg:${(i * 45)}deg;animation-delay:${(i * 60)}ms"></div>
          `).join("")}
        `;
        break;
      case "blurple_gamer":
        fxMarkup = `
          <div class="fx-blurple-ring"></div>
          <div class="fx-blurple-ring" style="animation-delay:180ms"></div>
        `;
        break;
      case "gem_booster":
        fxMarkup = `
          <div class="fx-booster-facet"></div>
        `;
        break;
      case "matrix_terminal":
        fxMarkup = `
          ${Array.from({ length: 6 }).map((_, i) => `
            <div class="fx-matrix-col" style="left:${(12 + i * 16)}vw;animation-delay:${(i * 110)}ms">010110<br/>101001<br/>MUCHI<br/>110010<br/>001101</div>
          `).join("")}
        `;
        break;
      case "pixel_arcade":
        fxMarkup = `
          <div class="fx-arcade-coin"></div>
        `;
        break;
      case "solar_flare":
        fxMarkup = `
          <div class="fx-solar-burst"></div>
        `;
        break;
      case "vaporwave":
        fxMarkup = `
          <div class="fx-vwave-grid"></div>
        `;
        break;
      case "synthwave":
        fxMarkup = `
          <div class="fx-synth-sun"></div>
        `;
        break;
      case "cosmic_nebula":
        fxMarkup = `
          <div class="fx-nebula-swirl"></div>
        `;
        break;
      case "ruby_crimson":
        fxMarkup = `
          <div class="fx-ruby-spark"></div>
        `;
        break;
      case "emerald_jade":
        fxMarkup = `
          <div class="fx-jade-ripple"></div>
          <div class="fx-jade-ripple" style="animation-delay:190ms"></div>
        `;
        break;
      case "holographic":
        fxMarkup = `
          <div class="fx-holo-prism"></div>
        `;
        break;
      case "y2k_chrome":
        fxMarkup = `
          <div class="fx-chrome-drop"></div>
        `;
        break;
      case "midnight_stealth":
        fxMarkup = `
          <div class="fx-stealth-laser"></div>
        `;
        break;
      case "sunset_lofi":
        fxMarkup = `
          <div class="fx-lofi-vinyl"></div>
        `;
        break;
      case "ocean_abyss":
        fxMarkup = `
          <div class="fx-abyss-sonar"></div>
          <div class="fx-abyss-sonar" style="animation-delay:210ms"></div>
        `;
        break;
      case "citrus_burst":
        fxMarkup = `
          <div class="fx-citrus-splash"></div>
        `;
        break;
      case "royal_amethyst":
        fxMarkup = `
          <div class="fx-amethyst-crown"></div>
        `;
        break;
      case "default":
      default:
        fxMarkup = `
          <div class="fx-classic-ring"></div>
          <div class="fx-classic-ring" style="animation-delay:180ms"></div>
        `;
        break;
    }

    return `
      <div class="splash-fx-layer">${fxMarkup}</div>
      <div class="splash-stage">
        <div class="splash-icon-box" style="background:${bg}">
          ${iconSvg}
        </div>
        <h1 class="splash-title">Muchi</h1>
        <div class="splash-yt-bar" aria-hidden="true"><i style="background:${icon.accent || "#34d399"}"></i></div>
      </div>
    `;
  }

  let _splashTimeout = null;
  let _splashFadeTimeout = null;

  function playAppOpeningAnimation(customIconId, isPreview = false) {
    const rawId = customIconId || (state.prefs && state.prefs.appIcon) || "default";
    const iconId = normalizeAppIconId(rawId);
    const icon = APP_ICONS.find((i) => i.id === iconId) || APP_ICONS[0];

    let splash = document.getElementById("appSplashScreen");
    if (!splash) {
      splash = document.createElement("div");
      splash.id = "appSplashScreen";
      splash.className = "app-splash-screen";
      document.body.prepend(splash);
    }

    if (_splashTimeout) clearTimeout(_splashTimeout);
    if (_splashFadeTimeout) clearTimeout(_splashFadeTimeout);

    splash.style.background = icon.bg || "#081612";
    splash.innerHTML = getOpeningAnimationHtml(icon);
    splash.classList.remove("fade-out");
    splash.removeAttribute("hidden");
    splash.style.display = "flex";

    const closeSplash = () => {
      if (_splashTimeout) clearTimeout(_splashTimeout);
      if (_splashFadeTimeout) clearTimeout(_splashFadeTimeout);
      splash.classList.add("fade-out");
      setTimeout(() => {
        splash.setAttribute("hidden", "true");
        splash.style.display = "none";
        splash.innerHTML = "";
      }, 220);
    };

    splash.onclick = closeSplash;
    splash.ontouchstart = closeSplash;

    _splashFadeTimeout = setTimeout(() => {
      splash.classList.add("fade-out");
    }, 1100);

    _splashTimeout = setTimeout(() => {
      splash.setAttribute("hidden", "true");
      splash.style.display = "none";
      splash.innerHTML = "";
    }, 1320);
  }
  const THEME_IDS = THEMES.map((t) => t.id).concat("custom");
  const BASE_THEME_IDS = ["system", "light", "dark"];
  const SKIN_IDS = new Set(THEME_IDS.filter((id) => !BASE_THEME_IDS.includes(id)));
  const isBaseThemeId = (id) => BASE_THEME_IDS.includes(id);
  const CUSTOM_VARS = [
    "--md-sys-color-primary", "--md-sys-color-on-primary", "--md-sys-color-primary-container", "--md-sys-color-on-primary-container",
    "--md-sys-color-secondary", "--md-sys-color-on-secondary", "--md-sys-color-secondary-container", "--md-sys-color-on-secondary-container",
    "--md-sys-color-tertiary", "--md-sys-color-on-tertiary", "--md-sys-color-tertiary-container",
    "--md-sys-color-surface", "--md-sys-color-surface-dim", "--md-sys-color-surface-bright",
    "--md-sys-color-surface-container-lowest", "--md-sys-color-surface-container-low", "--md-sys-color-surface-container",
    "--md-sys-color-surface-container-high", "--md-sys-color-surface-container-highest",
    "--md-sys-color-on-surface", "--md-sys-color-on-surface-variant", "--md-sys-color-outline", "--md-sys-color-outline-variant",
    "--md-sys-color-inverse-surface", "--md-sys-color-inverse-on-surface", "--md-sys-color-inverse-primary",
    "--song-primary", "--song-on-primary", "--song-container", "--song-glow",
    "--theme-glow-a", "--theme-glow-b", "--yt", "--au", "--rd",
  ];
  const CUSTOM_DEFAULT = { name: "My theme", mode: "dark", surface: "#121218", primary: "#7c6af7", accent: "#ff7ac6", text: "#eee8ff", card: "#1c1c26" };

  function customTheme() {
    return Object.assign({}, CUSTOM_DEFAULT, state.prefs.customTheme || {});
  }
  function hexOk(s) { return /^#[0-9a-fA-F]{6}$/.test(String(s || "")); }
  function hexToRgb(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
  }
  function mixHex(a, b, t) {
    if (!hexOk(a) || !hexOk(b)) return a || b || "#888888";
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
  }
  function luma(hex) {
    if (!hexOk(hex)) return 0.2;
    const { r, g, b } = hexToRgb(hex);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  function onInk(bg) { return luma(bg) > 0.55 ? "#161616" : "#ffffff"; }
  function hexA(hex, a) {
    if (!hexOk(hex)) return `rgba(0,0,0,${a})`;
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  function applyCustomVars(raw) {
    const c = Object.assign({}, CUSTOM_DEFAULT, raw || {});
    const surface = hexOk(c.surface) ? c.surface : CUSTOM_DEFAULT.surface;
    const primary = hexOk(c.primary) ? c.primary : CUSTOM_DEFAULT.primary;
    const accent = hexOk(c.accent) ? c.accent : CUSTOM_DEFAULT.accent;
    const text = hexOk(c.text) ? c.text : CUSTOM_DEFAULT.text;
    const card = hexOk(c.card) ? c.card : CUSTOM_DEFAULT.card;
    const root = document.documentElement.style;
    const onP = onInk(primary);
    root.setProperty("--md-sys-color-primary", primary);
    root.setProperty("--md-sys-color-on-primary", onP);
    root.setProperty("--md-sys-color-primary-container", mixHex(primary, surface, 0.55));
    root.setProperty("--md-sys-color-on-primary-container", mixHex(text, primary, 0.15));
    root.setProperty("--md-sys-color-secondary", accent);
    root.setProperty("--md-sys-color-on-secondary", onInk(accent));
    root.setProperty("--md-sys-color-secondary-container", mixHex(accent, surface, 0.6));
    root.setProperty("--md-sys-color-on-secondary-container", text);
    root.setProperty("--md-sys-color-tertiary", mixHex(primary, accent, 0.5));
    root.setProperty("--md-sys-color-on-tertiary", onInk(mixHex(primary, accent, 0.5)));
    root.setProperty("--md-sys-color-tertiary-container", mixHex(accent, surface, 0.5));
    root.setProperty("--md-sys-color-surface", surface);
    root.setProperty("--md-sys-color-surface-dim", mixHex(surface, "#000000", 0.15));
    root.setProperty("--md-sys-color-surface-bright", mixHex(surface, "#ffffff", 0.12));
    root.setProperty("--md-sys-color-surface-container-lowest", mixHex(surface, "#000000", 0.25));
    root.setProperty("--md-sys-color-surface-container-low", mixHex(card, surface, 0.35));
    root.setProperty("--md-sys-color-surface-container", card);
    root.setProperty("--md-sys-color-surface-container-high", mixHex(card, text, 0.08));
    root.setProperty("--md-sys-color-surface-container-highest", mixHex(card, text, 0.14));
    root.setProperty("--md-sys-color-on-surface", text);
    root.setProperty("--md-sys-color-on-surface-variant", mixHex(text, surface, 0.32));
    root.setProperty("--md-sys-color-outline", mixHex(text, surface, 0.5));
    root.setProperty("--md-sys-color-outline-variant", mixHex(text, surface, 0.72));
    root.setProperty("--md-sys-color-inverse-surface", text);
    root.setProperty("--md-sys-color-inverse-on-surface", surface);
    root.setProperty("--md-sys-color-inverse-primary", mixHex(primary, surface, 0.2));
    root.setProperty("--song-primary", primary);
    root.setProperty("--song-on-primary", onP);
    root.setProperty("--song-container", card);
    root.setProperty("--song-glow", hexA(primary, 0.36));
    root.setProperty("--theme-glow-a", hexA(primary, 0.24));
    root.setProperty("--theme-glow-b", hexA(accent, 0.18));
    root.setProperty("--yt", mixHex("#ff8a80", primary, 0.25));
    root.setProperty("--au", primary);
    root.setProperty("--rd", accent);
    document.documentElement.style.colorScheme = c.mode === "light" ? "light" : "dark";
  }

  function resolvedTheme() {
    const t = state.prefs.theme || "dark";
    if (t === "custom" || SKIN_IDS.has(t)) return t;
    const ap = state.prefs.appearance || "system";
    if (ap === "light") return "light";
    if (ap === "dark") return "dark";
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function isSkinTheme() {
    const t = resolvedTheme();
    return t === "custom" || SKIN_IDS.has(t);
  }
  let systemMQL = null;
  function watchSystemTheme() {
    // In System mode, react live to OS light/dark changes — no restart needed.
    try {
      if (systemMQL || !window.matchMedia) return;
      systemMQL = window.matchMedia("(prefers-color-scheme: light)");
      systemMQL.addEventListener("change", () => {
        if ((state.prefs.appearance || "system") === "system" && !isSkinTheme()) applyTheme();
      });
    } catch { systemMQL = null; }
  }
  function syncNativeStatusBar(t) {
    // Keep the native status bar consistent with the in-app theme
    // (Capacitor StatusBar plugin; no-op on web). On iOS this flips the
    // status bar text light/dark so Light mode stays readable; on Android
    // it also recolors the bar itself.
    const P = nativePlugins();
    const SB = P && P.StatusBar;
    if (!SB || !window.Capacitor || !window.Capacitor.getPlatform) return;
    const plat = window.Capacitor.getPlatform();
    if (plat !== "android" && plat !== "ios") return;
    const light = t === "light";
    try {
      SB.setStyle({ style: light ? "DARK" : "LIGHT" });
      if (plat === "android") SB.setBackgroundColor({ color: light ? "#e6eae6" : "#101413" });
    } catch {}
  }
  function applyTheme() {
    const root = document.documentElement.style;
    CUSTOM_VARS.forEach((k) => root.removeProperty(k));
    root.removeProperty("color-scheme");
    const t = resolvedTheme();
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (t === "custom") {
      applyCustomVars(customTheme());
      if (meta) meta.content = customTheme().surface;
      syncNativeStatusBar("dark");
      applyUi();
      return;
    }
    const pack = THEMES.find((x) => x.id === t);
    if (meta) meta.content = (pack && pack.surface) || (t === "light" ? "#e6eae6" : "#101413");
    syncNativeStatusBar(t);
    watchSystemTheme();
    applyUi();
  }
  const VALID_UI_MODES = ["material", "glass", "winter", "christmas", "autumn", "genshin"];
  function normalizeUiMode(v) {
    return VALID_UI_MODES.includes(v) ? v : "glass";
  }
  const VALID_PLAYER_STYLES = ["pill", "wave", "vinyl", "aura"];
  function normalizePlayerStyle(v) {
    return VALID_PLAYER_STYLES.includes(v) ? v : "pill";
  }
  const VALID_SEEK_WIGGLES = ["sine", "ribbon", "glow", "orbit"];
  function normalizeSeekWiggle(v) {
    if (v === "pulse") return "ribbon";
    if (v === "zigzag") return "glow";
    return VALID_SEEK_WIGGLES.includes(v) ? v : "sine";
  }
  function isBatterySaver() {
    return Boolean(state.prefs && state.prefs.batterySaver);
  }
  function applyUi() {
    const ui = normalizeUiMode(state.prefs.ui);
    document.documentElement.dataset.ui = ui;
    const ps = normalizePlayerStyle(state.prefs.playerStyle);
    document.documentElement.dataset.player = ps;
    const wg = normalizeSeekWiggle(state.prefs.seekWiggle);
    document.documentElement.dataset.wiggle = wg;
    document.documentElement.dataset.batterySaver = isBatterySaver() ? "1" : "0";
    const icons = ["small", "default", "medium", "large"].includes(state.prefs.iconSize) ? state.prefs.iconSize : "default";
    document.documentElement.dataset.icons = icons;
    // "Interface size" drives the WHOLE app, not just icon glyphs: pick a
    // uniform scale (0.92× / 1× / 1.12× / 1.24×) applied via CSS `zoom`, which
    // scales text, spacing, touch targets and icons together. This is the
    // standard, layout-safe way to scale an entire PWA/native WebView (works on
    // Chrome, Safari/WKWebView and Android WebView). We still set data-icons so
    // the icon/dock CSS vars stay in sync; zoom is the multiplier.
    const scaleMap = { small: 0.92, default: 1, medium: 1.12, large: 1.24 };
    const uiScale = scaleMap[icons] || 1;
    if (Math.abs(Number(uiScale) - 1) > 0.001) {
      document.documentElement.style.setProperty("--ui-zoom", String(uiScale));
      document.documentElement.style.zoom = String(uiScale);
    } else {
      document.documentElement.style.setProperty("--ui-zoom", "1");
      document.documentElement.style.zoom = "";
    }
    const bar = $("playerBar");
    if (bar) {
      bar.dataset.player = ps;
      bar.dataset.wiggle = wg;
    }
    syncPlayerVisibility();
  }
  function uiLabel() {
    const map = {
      material: "Material 3",
      glass: "Glass UI",
      winter: "Winter UI",
      christmas: "Christmas UI",
      autumn: "Autumn UI",
      genshin: "Genshin Impact",
    };
    return map[normalizeUiMode(state.prefs.ui)] || "Glass UI";
  }
  function themeLabel() {
    if (state.prefs.theme === "custom") return customTheme().name || "Custom";
    const pack = THEMES.find((x) => x.id === state.prefs.theme);
    if (pack && SKIN_IDS.has(pack.id)) return pack.name;
    const ap = state.prefs.appearance || "system";
    return ap === "light" ? "Light" : ap === "dark" ? "Dark" : "System";
  }
  function themeCardHTML(th, on) {
    const bg = th.surface || (window.matchMedia("(prefers-color-scheme: light)").matches ? "#e6eae6" : "#101413");
    return `<button type="button" class="theme-card ${on ? "on" : ""}" data-set-theme="${th.id}" style="--mood:${th.a};--tp-bg:${bg};--tp-a:${th.a};--tp-b:${th.b}">
      <div class="theme-preview" style="background:${bg};--tp-a:${th.a};--tp-b:${th.b}">
        <i class="tp-bar"></i><i class="tp-row"></i><i class="tp-row dim"></i><i class="tp-pill"></i>
      </div>
      <span><strong>${th.name}</strong></span>
    </button>`;
  }

  function glq() { return `gl=${encodeURIComponent(state.prefs.country || "IN")}`; }

  function asArray(v) { return Array.isArray(v) ? v : []; }

  function load(k, fallback) {
    const read = (key) => {
      const raw = localStorage.getItem(key);
      if (raw == null || raw === "") return undefined;
      return JSON.parse(raw);
    };
    try {
      const v = read(k);
      if (v !== undefined && v !== null) return v;
    } catch {}
    try {
      const b = read(k + ".bak");
      if (b !== undefined && b !== null) return b;
    } catch {}
    return fallback;
  }

  function save(k, v) {
    let json;
    try { json = JSON.stringify(v); } catch { return false; }
    try {
      const prev = localStorage.getItem(k);
      if (prev && prev.length > 2 && (json === "[]" || json === "{}") && LIBRARY_WIPE.has(k)) {
        /* allow intentional empties — caller already set state */
      }
      localStorage.setItem(k, json);
      if (LIBRARY_KEYS.has(k) && json.length > 2) {
        try { localStorage.setItem(k + ".bak", json); } catch {}
      }
      return true;
    } catch {
      return false;
    }
  }

  const LIBRARY_KEYS = new Set(["aura.liked", "aura.playlists", "aura.recents", "aura.following", "aura.downloads", "aura.prefs"]);
  const LIBRARY_WIPE = new Set(["aura.liked", "aura.playlists", "aura.recents", "aura.following", "aura.downloads"]);

  function normalizeFollowEntry(f) {
    if (!f) return null;
    if (typeof f === "string") {
      const raw = f.replace(/^(name:|audius:)/i, "").trim();
      if (!raw) return null;
      return {
        key: f.toLowerCase().startsWith("audius:") ? f.toLowerCase() : `name:${raw.toLowerCase()}`,
        name: raw,
        source: "catalog",
        handle: "",
        artwork: "/cover-default.jpg",
      };
    }
    if (typeof f !== "object") return null;
    const rawName = String(f.name || f.key || "").replace(/^(name:|audius:)/i, "").trim();
    if (!rawName) return null;
    const handle = String(f.handle || "").trim();
    const rawKey = String(f.key || "").trim().toLowerCase();
    const key = handle
      ? `audius:${handle.toLowerCase()}`
      : rawKey.startsWith("audius:")
        ? rawKey
        : `name:${rawName.toLowerCase()}`;
    return {
      ...f,
      key,
      name: rawName,
      source: f.source || "catalog",
      handle,
      artwork: f.artwork || "/cover-default.jpg",
    };
  }

  function dedupeFollowingList(list) {
    const out = [];
    const seen = new Set();
    for (const item of asArray(list)) {
      const norm = normalizeFollowEntry(item);
      if (!norm) continue;
      const nameKey = norm.name.toLowerCase();
      if (seen.has(norm.key) || seen.has(nameKey)) continue;
      seen.add(norm.key);
      seen.add(nameKey);
      out.push(norm);
    }
    return out;
  }

  function hydrateLibrary() {
    state.liked = asArray(load("aura.liked", state.liked));
    state.recents = asArray(load("aura.recents", state.recents));
    state.following = dedupeFollowingList(load("aura.following", state.following));
    state.downloads = asArray(load("aura.downloads", state.downloads));
    state.dlQueue = asArray(load("aura.dlQueue", state.dlQueue)).filter((d) => d && d.status === "downloading");
    const pls = asArray(load("aura.playlists", state.playlists)).map((p) => ({
      name: (p && p.name) || "Playlist",
      tracks: asArray(p && p.tracks),
      cover: (p && p.cover) || "",
      banner: (p && p.banner) || "",
    }));
    state.playlists = pls;
    const storedPrefs = load("aura.prefs", null);
    if (storedPrefs && typeof storedPrefs === "object") Object.assign(state.prefs, storedPrefs);
    for (const k of LIBRARY_KEYS) {
      try {
        const cur = localStorage.getItem(k);
        if (cur && cur.length > 2 && !localStorage.getItem(k + ".bak")) localStorage.setItem(k + ".bak", cur);
      } catch {}
    }
  }
  hydrateLibrary();

  let syncLibraryTimeout = null;
  let _pendingReplaceFollowing = false;
  function scheduleUserLibraryPush(opts) {
    if (opts && opts.replaceFollowing) _pendingReplaceFollowing = true;
    if (!state.auth || !state.auth.signedIn) return;
    clearTimeout(syncLibraryTimeout);
    syncLibraryTimeout = setTimeout(() => {
      const rep = _pendingReplaceFollowing;
      _pendingReplaceFollowing = false;
      pushUserLibrary({ replaceFollowing: rep });
    }, 1200);
  }

  async function pushUserLibrary(opts) {
    if (!state.auth || !state.auth.signedIn) return;
    const onboardedFlag = Boolean(localStorage.getItem("aura.onboarded") || state.prefs.onboarded);
    try {
      await api("/api/user/library", 10000, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          liked: (state.liked || []).slice(0, 1500),
          playlists: (state.playlists || []).slice(0, 150),
          following: dedupeFollowingList(state.following).slice(0, 400),
          recents: (state.recents || []).slice(0, 100),
          replaceFollowing: Boolean(opts && opts.replaceFollowing),
          onboarded: onboardedFlag,
          taste: {
            tasteGenres: Array.isArray(state.prefs.tasteGenres) ? state.prefs.tasteGenres : [],
            tasteMoods: Array.isArray(state.prefs.tasteMoods) ? state.prefs.tasteMoods : [],
            tasteEras: Array.isArray(state.prefs.tasteEras) ? state.prefs.tasteEras : [],
            tasteStyles: Array.isArray(state.prefs.tasteStyles) ? state.prefs.tasteStyles : [],
            tasteArtists: Array.isArray(state.prefs.tasteArtists) ? state.prefs.tasteArtists : [],
            country: state.prefs.country || "",
            countryChosen: Boolean(state.prefs.countryChosen),
            onboarded: onboardedFlag,
          },
        }),
      });
    } catch {}
  }

  let isSyncingLibrary = false;
  async function syncUserLibrary(forcePull) {
    if (!state.auth || !state.auth.signedIn || isSyncingLibrary) return;
    isSyncingLibrary = true;
    try {
      const res = await api("/api/user/library", 10000);
      if (res && res.library) {
        const remote = res.library;
        let modified = false;
        let restoredAny = false;

        // Check if this Google user is an existing ("old") user with recorded data in Muchi
        const remoteTaste = (remote.taste && typeof remote.taste === "object") ? remote.taste : {};
        const hasRemoteTaste = Boolean(
          (Array.isArray(remoteTaste.tasteGenres) && remoteTaste.tasteGenres.length > 0) ||
          (Array.isArray(remoteTaste.tasteMoods) && remoteTaste.tasteMoods.length > 0) ||
          (Array.isArray(remoteTaste.tasteEras) && remoteTaste.tasteEras.length > 0) ||
          (Array.isArray(remoteTaste.tasteStyles) && remoteTaste.tasteStyles.length > 0) ||
          (Array.isArray(remoteTaste.tasteArtists) && remoteTaste.tasteArtists.length > 0) ||
          remoteTaste.onboarded
        );
        const isReturningUser = Boolean(
          res.isReturningUser ||
          remote.onboarded ||
          hasRemoteTaste ||
          (Array.isArray(remote.liked) && remote.liked.length > 0) ||
          (Array.isArray(remote.playlists) && remote.playlists.length > 0) ||
          (Array.isArray(remote.following) && remote.following.length > 0) ||
          (Array.isArray(remote.recents) && remote.recents.length > 0)
        );

        // 1. Liked songs merge
        if (Array.isArray(remote.liked) && remote.liked.length > 0) {
          const likedMap = new Map();
          for (const t of remote.liked) {
            if (t && t.id) likedMap.set(t.id, t);
          }
          for (const t of state.liked) {
            if (t && t.id && !likedMap.has(t.id)) {
              likedMap.set(t.id, t);
              modified = true;
            }
          }
          state.liked = Array.from(likedMap.values());
          save("aura.liked", state.liked);
          restoredAny = true;
        } else if (state.liked.length > 0) {
          modified = true;
        }

        // 2. Playlists merge
        if (Array.isArray(remote.playlists) && remote.playlists.length > 0) {
          const plMap = new Map();
          for (const p of remote.playlists) {
            if (p && (p.id || p.name)) plMap.set(p.id || p.name, p);
          }
          for (const p of state.playlists) {
            const key = p && (p.id || p.name);
            if (key && !plMap.has(key)) {
              plMap.set(key, p);
              modified = true;
            }
          }
          state.playlists = Array.from(plMap.values());
          save("aura.playlists", state.playlists);
          renderPlaylistsNav();
          restoredAny = true;
        } else if (state.playlists.length > 0) {
          modified = true;
        }

        // 3. Following merge (normalized keys)
        if (Array.isArray(remote.following) && remote.following.length > 0) {
          const mergedFollowing = dedupeFollowingList([...remote.following, ...state.following]);
          if (mergedFollowing.length > dedupeFollowingList(remote.following).length) {
            modified = true;
          }
          state.following = mergedFollowing;
          save("aura.following", state.following);
          restoredAny = true;
        } else if (state.following.length > 0) {
          modified = true;
        }

        // 4. Recents merge
        if (Array.isArray(remote.recents) && remote.recents.length > 0) {
          const recMap = new Map();
          for (const t of state.recents) {
            if (t && t.id) recMap.set(t.id, t);
          }
          for (const t of remote.recents) {
            if (t && t.id && !recMap.has(t.id)) recMap.set(t.id, t);
          }
          state.recents = Array.from(recMap.values()).slice(0, 200);
          save("aura.recents", state.recents);
          restoredAny = true;
        } else if (state.recents.length > 0) {
          modified = true;
        }

        // 5. Taste preferences merge
        if (hasRemoteTaste || remoteTaste.country) {
          const mergeArr = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
          state.prefs.tasteGenres = mergeArr(remoteTaste.tasteGenres, state.prefs.tasteGenres);
          state.prefs.tasteMoods = mergeArr(remoteTaste.tasteMoods, state.prefs.tasteMoods);
          state.prefs.tasteEras = mergeArr(remoteTaste.tasteEras, state.prefs.tasteEras);
          state.prefs.tasteStyles = mergeArr(remoteTaste.tasteStyles, state.prefs.tasteStyles);
          state.prefs.tasteArtists = mergeArr(remoteTaste.tasteArtists, state.prefs.tasteArtists);
          if (remoteTaste.country && !state.prefs.countryChosen) {
            state.prefs.country = remoteTaste.country;
            if (remoteTaste.countryChosen) state.prefs.countryChosen = true;
          }
          restoredAny = true;
        }

        // 6. Returning ("old") user handling: skip onboarding & start using app directly!
        const pendingOnbAuth = (() => {
          try { return sessionStorage.getItem("aura.onb_pending_auth") === "1"; } catch { return false; }
        })();
        try { sessionStorage.removeItem("aura.onb_pending_auth"); } catch {}

        if (isReturningUser) {
          const wasUnonboarded = !localStorage.getItem("aura.onboarded") || !state.prefs.onboarded || pendingOnbAuth;
          localStorage.setItem("aura.onboarded", "1");
          state.prefs.onboarded = true;
          savePrefs();
          const onbOverlay = document.getElementById("tasteOnboardingOverlay");
          if (onbOverlay) {
            window.__refreshTasteOnboarding = null;
            onbOverlay.remove();
          }
          if (wasUnonboarded || forcePull || restoredAny) {
            if (wasUnonboarded) {
              toast("Welcome back! Your saved library and taste have been restored.", true, "success");
            }
            loadHome(true);
            loadTasteRecommendations(true);
            loadForYou();
            loadDiscoveryMix(true);
          }
        } else {
          // Brand-new Google user who has NOT used Muchi before:
          // Keep them in the onboarding flow so they can pick their taste preferences.
          if (typeof window.__refreshTasteOnboarding === "function") {
            window.__refreshTasteOnboarding();
          } else if (!localStorage.getItem("aura.onboarded") && !state.prefs.onboarded) {
            openTasteOnboarding(false);
          }
        }

        if (modified) {
          scheduleUserLibraryPush();
        }
        render();
      }
    } catch {} finally {
      isSyncingLibrary = false;
    }
  }

  function savePlaylists() {
    save("aura.playlists", state.playlists);
    scheduleUserLibraryPush();
  }
  if (!state.prefs.hqV) {
    state.prefs.quality = "high";
    state.prefs.hqV = 1;
    savePrefs();
  }

  function showEl(el, on) {
    if (!el) return;
    el.hidden = !on;
    el.classList.toggle("show", !!on);
  }

  function toast(msg, show, kind) {
    if (show === false) return;
    const el = $("toast");
    if (!el || !msg) return;
    el.classList.remove("error", "success");
    if (kind === "error" || kind === "success") {
      el.classList.add(kind);
      el.innerHTML = "";
      const ico = document.createElement("span");
      ico.className = "material-symbols-outlined";
      ico.textContent = kind === "error" ? "error" : "check";
      const txt = document.createElement("span");
      txt.textContent = msg;
      el.append(ico, txt);
    } else {
      el.textContent = msg;
    }
    showEl(el, true);
    clearTimeout(toast._t);
    toast._t = setTimeout(() => showEl(el, false), kind === "error" ? 3800 : 2800);
  }

  function fmt(sec) {
    if (!sec || !isFinite(sec)) return "0:00";
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }

  function trackStats(tracks) {
    const rows = (tracks || []).filter(Boolean);
    const n = rows.length;
    const songs = `${n} song${n === 1 ? "" : "s"}`;
    if (!n) return songs;
    let sec = 0;
    let missing = 0;
    for (const tr of rows) {
      const d = Number(tr.duration) || 0;
      if (d > 0) sec += d;
      else missing += 1;
    }
    if (missing) sec += missing * 210;
    const h = Math.floor(sec / 3600);
    const m = Math.max(1, Math.round((sec % 3600) / 60));
    const time = h ? `${h} hr ${m} min` : `${m} min`;
    return `${songs} • ${time}`;
  }

  function syncPlayerVisibility() {
    const bar = $("playerBar");
    const hide = !state.playerReady || !current() || state.showQueue || state.view === "now";
    document.body.classList.toggle("player-idle", hide);
    document.body.classList.toggle("queue-open", !!state.showQueue);
    if (bar) {
      bar.classList.toggle("idle", hide);
      bar.hidden = hide;
      if (state.showQueue || state.view === "now") bar.classList.add("away");
      else if (!hide) bar.classList.remove("away");
    }
  }

  const COUNTRY_TZ = {
    IN: "Asia/Kolkata", US: "America/New_York", GB: "Europe/London", CA: "America/Toronto",
    AU: "Australia/Sydney", DE: "Europe/Berlin", FR: "Europe/Paris", JP: "Asia/Tokyo",
    KR: "Asia/Seoul", BR: "America/Sao_Paulo", MX: "America/Mexico_City", NG: "Africa/Lagos",
    ZA: "Africa/Johannesburg", AE: "Asia/Dubai", SA: "Asia/Riyadh", PK: "Asia/Karachi",
    BD: "Asia/Dhaka", ID: "Asia/Jakarta", MY: "Asia/Kuala_Lumpur", SG: "Asia/Singapore",
    PH: "Asia/Manila", TH: "Asia/Bangkok", VN: "Asia/Ho_Chi_Minh", EG: "Africa/Cairo",
    IT: "Europe/Rome", ES: "Europe/Madrid", TR: "Europe/Istanbul", NZ: "Pacific/Auckland",
    NL: "Europe/Amsterdam", SE: "Europe/Stockholm",
  };

  function hourInCountry(code) {
    const tz = COUNTRY_TZ[code || state.prefs.country || "IN"] || "Asia/Kolkata";
    try {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).formatToParts(new Date());
      const hit = parts.find((p) => p.type === "hour");
      const n = Number(hit && hit.value);
      return Number.isFinite(n) ? n : new Date().getHours();
    } catch {
      return new Date().getHours();
    }
  }

  function mondayWeekKey(code) {
    const tz = COUNTRY_TZ[code || state.prefs.country || "IN"] || "Asia/Kolkata";
    try {
      const s = new Date().toLocaleString("en-US", { timeZone: tz });
      const d = new Date(s);
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const da = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${da}`;
    } catch {
      const d = new Date();
      const day = d.getDay();
      d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
      return d.toISOString().slice(0, 10);
    }
  }

  function greeting() {
    const code = state.prefs.country || "IN";
    const h = hourInCountry(code);
    if (h < 5) return "Still up?";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    if (h < 21) return "Good evening";
    return "Late night listening";
  }

  function heroGreetingHTML() {
    const text = greeting();
    if (normalizeUiMode(state.prefs.ui) !== "genshin") {
      return escapeHTML(text);
    }
    // Split greeting (e.g. "Good morning") into interactive letters so:
    // 1. Lumine (Female Traveler) sits perched on top of the first word ("Good"), swinging her legs & bouncing the letters underneath.
    // 2. Paimon floats & sits/bounces playfully on the middle letters ("mor"), squishing the letter beneath her.
    // 3. Aether (Male Traveler) braces at the right end and physically pulls out the last letter ("g") with an Anemo/Geo starlight tether.
    const chars = Array.from(text);
    const len = chars.length;
    const spaceIdx = chars.indexOf(" ");
    const lumineSeatA = 1;
    const lumineSeatB = Math.min(2, Math.max(1, (spaceIdx > 1 ? spaceIdx - 1 : 2)));
    const paimonSeat = spaceIdx > 0 && spaceIdx + 2 < len - 1 ? spaceIdx + 2 : Math.max(3, Math.floor(len * 0.55));
    const pulledIdx = len - 1;

    const lumineRigSVG = `
      <span class="gi-char-rig gi-lumine-rig" aria-hidden="true">
        <svg class="gi-char-svg gi-lumine-svg" viewBox="0 0 88 96" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Floating Anemo/Geo Starlight Sparkles around Lumine -->
          <g class="gi-sparkle-group">
            <path d="M14,22 L16,27 L21,29 L16,31 L14,36 L12,31 L7,29 L12,27 Z" fill="#fef08a"/>
            <path d="M74,16 L75.5,20 L79.5,21.5 L75.5,23 L74,27 L72.5,23 L68.5,21.5 L72.5,20 Z" fill="#7dd3fc"/>
          </g>
          <g class="gi-lumine-body-bounce">
            <!-- Flowing White & Gold Scarf / Dress Back Drapes -->
            <path class="gi-lumine-cape" d="M28,48 Q16,58 13,70 Q21,69 29,58 Z" fill="#e0f2fe" stroke="#fbbf24" stroke-width="1.2"/>
            <path class="gi-lumine-cape r" d="M58,48 Q69,57 73,68 Q64,68 56,57 Z" fill="#e0f2fe" stroke="#fbbf24" stroke-width="1.2"/>
            <!-- Lumine Seated Skirt & Gold Trim resting on top of the letters -->
            <path d="M27,56 Q44,51 61,56 L65,70 Q44,74 23,70 Z" fill="#f8fafc" stroke="#eab308" stroke-width="1.5"/>
            <path d="M33,57 L44,69 L55,57" fill="#1e293b" stroke="#fbbf24" stroke-width="1.2"/>
            <!-- Lumine Torso: White & Navy Gold-Trimmed Traveler Bodice -->
            <path d="M32,40 Q44,38 56,40 L58,57 Q44,60 30,57 Z" fill="#ffffff" stroke="#d97706" stroke-width="1.4"/>
            <path d="M37,42 L44,53 L51,42 Z" fill="#1e3a5f"/>
            <!-- Glowing Chest Elemental Diamond (Anemo/Geo) -->
            <polygon points="44,44 47.5,48 44,52 40.5,48" fill="#38bdf8" stroke="#fef08a" stroke-width="1"/>
            <!-- Detached White & Gold Sleeves + Waving Arm -->
            <path d="M31,42 Q23,48 26,56" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round"/>
            <path d="M31,42 Q23,48 26,56" stroke="#fbbf24" stroke-width="1.3" stroke-linecap="round"/>
            <g class="gi-lumine-wave-arm">
              <path d="M56,42 Q67,35 70,25" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round"/>
              <path d="M56,42 Q67,35 70,25" stroke="#fbbf24" stroke-width="1.4" stroke-linecap="round"/>
              <circle cx="70.5" cy="24" r="2.8" fill="#fde68a"/>
            </g>
            <!-- Lumine Head & Golden Blonde Twin Side-Locks -->
            <g class="gi-lumine-head">
              <!-- Back Golden Bob Hair -->
              <path d="M25,25 Q24,9 44,9 Q64,9 63,25 Q64,36 57,40 L31,40 Q24,36 25,25 Z" fill="#fde047" stroke="#ca8a04" stroke-width="1.3"/>
              <!-- Face -->
              <path d="M30,22 Q30,39 44,40 Q58,39 58,22 Q58,14 44,14 Q30,14 30,22 Z" fill="#fff1e6"/>
              <!-- Golden Anime Eyes + Star Highlights -->
              <ellipse cx="38" cy="27" rx="3.2" ry="3.8" fill="#b45309"/>
              <ellipse cx="50" cy="27" rx="3.2" ry="3.8" fill="#b45309"/>
              <circle cx="38" cy="28" r="2.1" fill="#fbbf24"/>
              <circle cx="50" cy="28" r="2.1" fill="#fbbf24"/>
              <circle cx="36.8" cy="25.8" r="1.1" fill="#ffffff"/>
              <circle cx="48.8" cy="25.8" r="1.1" fill="#ffffff"/>
              <path d="M34,23.5 Q38,21.5 41.5,23.5" stroke="#78350f" stroke-width="1.4" stroke-linecap="round"/>
              <path d="M46.5,23.5 Q50,21.5 54,23.5" stroke="#78350f" stroke-width="1.4" stroke-linecap="round"/>
              <!-- Soft Blush & Happy Smile -->
              <ellipse cx="33.5" cy="31" rx="2.4" ry="1.2" fill="#fda4af" opacity="0.65"/>
              <ellipse cx="54.5" cy="31" rx="2.4" ry="1.2" fill="#fda4af" opacity="0.65"/>
              <path d="M41,33 Q44,36 47,33" stroke="#9a3412" stroke-width="1.4" stroke-linecap="round" fill="none"/>
              <!-- Iconic Blonde Bangs & Ahoge -->
              <path d="M43,9 Q46,2 51,6 Q47,8 45,10" fill="#fef08a" stroke="#ca8a04" stroke-width="1.1"/>
              <path d="M27,22 Q33,12 44,13 Q55,12 61,22 Q56,17 51,23 Q44,15 37,23 Q32,17 27,22 Z" fill="#fef08a" stroke="#ca8a04" stroke-width="1.2"/>
              <!-- Twin Long Blonde Front Side-Locks (framing face) -->
              <path class="gi-hair-lock l" d="M27,23 Q23,36 25,50 Q29,46 30,34 Z" fill="#fde047" stroke="#ca8a04" stroke-width="1.1"/>
              <path class="gi-hair-lock r" d="M61,23 Q65,36 63,50 Q59,46 58,34 Z" fill="#fde047" stroke="#ca8a04" stroke-width="1.1"/>
              <!-- Iconic Inteyvat Hair Flowers (Blue & White 5-petal Teyvat blooms + Twin Feathers) -->
              <path d="M25,16 Q15,10 13,16 Q18,19 25,19 Z" fill="#ffffff" stroke="#93c5fd" stroke-width="0.9"/>
              <path d="M24,19 Q14,17 14,22 Q19,23 25,21 Z" fill="#e0f2fe" stroke="#93c5fd" stroke-width="0.9"/>
              <circle cx="28" cy="17" r="5" fill="#eff6ff" stroke="#38bdf8" stroke-width="1.2"/>
              <circle cx="28" cy="17" r="2" fill="#fbbf24"/>
            </g>
            <!-- Dangling & Swinging White-Gold Traveler Boots (hanging over the top of "Good") -->
            <g class="gi-lumine-leg l">
              <path d="M37,68 L35,85" stroke="#fff1e6" stroke-width="4.6" stroke-linecap="round"/>
              <path d="M35,74 L34,87" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
              <path d="M33,74 L37,74" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/>
              <ellipse cx="33.5" cy="88.5" rx="4.2" ry="2.6" fill="#1e293b" stroke="#fbbf24" stroke-width="1.2"/>
            </g>
            <g class="gi-lumine-leg r">
              <path d="M51,68 L53,85" stroke="#fff1e6" stroke-width="4.6" stroke-linecap="round"/>
              <path d="M53,74 L54,87" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
              <path d="M51,74 L55,74" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"/>
              <ellipse cx="54.5" cy="88.5" rx="4.2" ry="2.6" fill="#1e293b" stroke="#fbbf24" stroke-width="1.2"/>
            </g>
          </g>
        </svg>
      </span>`;

    const paimonRigSVG = `
      <span class="gi-char-rig gi-paimon-rig" aria-hidden="true">
        <svg class="gi-char-svg gi-paimon-svg" viewBox="0 0 92 98" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g class="gi-paimon-float">
            <!-- Paimon's Iconic Starry Night-Sky Constellation Cape -->
            <g class="gi-paimon-cape">
              <path d="M24,45 Q10,56 12,75 Q24,78 33,66 L59,66 Q68,78 80,75 Q82,56 68,45 Z" fill="#1e1b4b" stroke="#fbbf24" stroke-width="1.3"/>
              <circle cx="20" cy="62" r="1.5" fill="#fef08a"/>
              <circle cx="26" cy="70" r="1.2" fill="#7dd3fc"/>
              <circle cx="71" cy="61" r="1.5" fill="#fef08a"/>
              <circle cx="65" cy="70" r="1.2" fill="#7dd3fc"/>
              <path d="M20,62 L26,70 M71,61 L65,70" stroke="#fde047" stroke-width="0.7" opacity="0.75"/>
            </g>
            <!-- Paimon's Levitating Rose-Gold Crown Halo -->
            <g class="gi-paimon-crown">
              <ellipse cx="46" cy="11" rx="14" ry="3.5" fill="none" stroke="#fbbf24" stroke-width="2"/>
              <path d="M33,10 L36,3 L41,9 L46,1 L51,9 L56,3 L59,10" fill="#fde68a" stroke="#d97706" stroke-width="1.3" stroke-linejoin="round"/>
              <circle cx="46" cy="5" r="1.5" fill="#38bdf8"/>
            </g>
            <!-- Paimon Seated / Bouncing Puffy White Romper & Gold Triquetra Emblem -->
            <path d="M31,47 Q46,43 61,47 Q65,61 57,68 Q46,71 35,68 Q27,61 31,47 Z" fill="#ffffff" stroke="#f59e0b" stroke-width="1.5"/>
            <!-- Rose-Gold Scarf Collar -->
            <path d="M32,46 Q46,52 60,46 Q57,54 46,55 Q35,54 32,46 Z" fill="#1e293b" stroke="#fbbf24" stroke-width="1.2"/>
            <!-- Iconic Gold Triquetra Knot on Chest -->
            <circle cx="46" cy="58" r="5" fill="none" stroke="#eab308" stroke-width="1.6"/>
            <circle cx="46" cy="58" r="1.8" fill="#fbbf24"/>
            <!-- Paimon's Excited Waving Little Arms -->
            <g class="gi-paimon-arm l">
              <path d="M32,49 Q20,42 18,33" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round"/>
              <circle cx="17.5" cy="32" r="2.8" fill="#fde68a" stroke="#d97706" stroke-width="1"/>
            </g>
            <g class="gi-paimon-arm r">
              <path d="M60,49 Q72,42 74,33" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round"/>
              <circle cx="74.5" cy="32" r="2.8" fill="#fde68a" stroke="#d97706" stroke-width="1"/>
            </g>
            <!-- Paimon's Fluffy Silver-White Bob Hair & Starry Hairpin -->
            <g class="gi-paimon-head">
              <path d="M24,31 Q23,15 46,15 Q69,15 68,31 Q70,44 60,47 L32,47 Q22,44 24,31 Z" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.4"/>
              <path d="M31,26 Q31,44 46,45 Q61,44 61,26 Q61,18 46,18 Q31,18 31,26 Z" fill="#fff1e6"/>
              <!-- Big Sparkling Dark-Indigo Anime Eyes -->
              <ellipse cx="39.5" cy="32" rx="3.5" ry="4.2" fill="#1e1b4b"/>
              <ellipse cx="52.5" cy="32" rx="3.5" ry="4.2" fill="#1e1b4b"/>
              <circle cx="39.5" cy="33" r="2.2" fill="#6366f1"/>
              <circle cx="52.5" cy="33" r="2.2" fill="#6366f1"/>
              <circle cx="38.2" cy="30.5" r="1.3" fill="#ffffff"/>
              <circle cx="51.2" cy="30.5" r="1.3" fill="#ffffff"/>
              <!-- Cheerful Open Paimon Smile -->
              <path d="M42.5,37.5 Q46,42 49.5,37.5 Z" fill="#fb7185" stroke="#be123c" stroke-width="1"/>
              <ellipse cx="34.5" cy="35.5" rx="2.5" ry="1.3" fill="#fda4af" opacity="0.75"/>
              <ellipse cx="57.5" cy="35.5" rx="2.5" ry="1.3" fill="#fda4af" opacity="0.75"/>
              <!-- Fluffy Silver-White Bangs + Iconic Black/Gold Star Hairclip -->
              <path d="M25,28 Q33,16 46,17 Q59,16 67,28 Q60,22 54,28 Q46,19 38,28 Q32,22 25,28 Z" fill="#ffffff" stroke="#94a3b8" stroke-width="1.3"/>
              <polygon points="31,21 37,19 39,24 32,26" fill="#0f172a" stroke="#fbbf24" stroke-width="1.1"/>
            </g>
            <!-- Paimon's Kicking Little White & Gold Boots sitting on the word -->
            <g class="gi-paimon-leg l">
              <path d="M39,67 L36,82" stroke="#1e1b4b" stroke-width="4.2" stroke-linecap="round"/>
              <path d="M36,75 L35,84" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
              <circle cx="34.5" cy="85" r="3.2" fill="#fbbf24"/>
            </g>
            <g class="gi-paimon-leg r">
              <path d="M53,67 L56,82" stroke="#1e1b4b" stroke-width="4.2" stroke-linecap="round"/>
              <path d="M56,75 L57,84" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
              <circle cx="57.5" cy="85" r="3.2" fill="#fbbf24"/>
            </g>
          </g>
        </svg>
      </span>`;

    const aetherRigSVG = `
      <span class="gi-char-rig gi-aether-rig" aria-hidden="true">
        <svg class="gi-char-svg gi-aether-svg" viewBox="0 0 118 96" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- Glowing Golden & Anemo Elemental Tether Rope attached to the pulled letter -->
          <g class="gi-aether-tether">
            <path d="M2,54 Q24,49 46,52" stroke="#38bdf8" stroke-width="3.4" stroke-linecap="round" opacity="0.55"/>
            <path d="M2,54 Q24,49 46,52" stroke="#fef08a" stroke-width="2" stroke-dasharray="4 3" stroke-linecap="round"/>
            <circle cx="8" cy="53" r="3.2" fill="#fef08a"/>
            <path d="M16,42 L18,46 L22,48 L18,50 L16,54 L14,50 L10,48 L14,46 Z" fill="#7dd3fc"/>
          </g>
          <!-- Aether's Full Articulated Body Leaning Back & Tugging the Letter Out -->
          <g class="gi-aether-tug-body">
            <!-- Iconic Long Golden Braided Ponytail whipping back as he pulls -->
            <g class="gi-aether-braid">
              <path d="M68,31 Q86,34 99,45 Q108,53 113,62" stroke="#eab308" stroke-width="5.5" stroke-linecap="round" fill="none"/>
              <path d="M68,31 Q86,34 99,45 Q108,53 113,62" stroke="#fef08a" stroke-width="2.5" stroke-dasharray="5 4" stroke-linecap="round" fill="none"/>
              <circle cx="113" cy="62" r="3.2" fill="#38bdf8" stroke="#fbbf24" stroke-width="1.2"/>
            </g>
            <!-- Flowing White & Gold Traveler Scarf Cape Tails -->
            <path class="gi-aether-scarf" d="M66,42 Q88,38 105,47 Q93,55 72,50 Z" fill="#f8fafc" stroke="#fbbf24" stroke-width="1.3"/>
            <!-- Braced Legs & Boots pulling backward -->
            <path d="M56,66 L43,88" stroke="#1c1917" stroke-width="6" stroke-linecap="round"/>
            <path d="M66,66 L78,88" stroke="#1c1917" stroke-width="6" stroke-linecap="round"/>
            <!-- Gold Knee Guards & Boots -->
            <path d="M46,79 L41,89" stroke="#f8fafc" stroke-width="5.5" stroke-linecap="round"/>
            <path d="M74,79 L79,89" stroke="#f8fafc" stroke-width="5.5" stroke-linecap="round"/>
            <ellipse cx="39" cy="90" rx="5.5" ry="2.8" fill="#292524" stroke="#fbbf24" stroke-width="1.2"/>
            <ellipse cx="81" cy="90" rx="5.5" ry="2.8" fill="#292524" stroke="#fbbf24" stroke-width="1.2"/>
            <!-- Aether's Cropped Dark Tunic, Midriff & Gold Armor Sash -->
            <path d="M52,56 L70,56 L72,68 L50,68 Z" fill="#fff1e6"/>
            <path d="M50,61 L72,61 L73,69 L49,69 Z" fill="#292524" stroke="#fbbf24" stroke-width="1.4"/>
            <path d="M49,39 Q61,36 73,39 L71,57 Q61,59 51,57 Z" fill="#1c1917" stroke="#f59e0b" stroke-width="1.5"/>
            <!-- Glowing Anemo/Geo Diamond Core on Aether's Chest -->
            <polygon points="61,43 65,48 61,53 57,48" fill="#fde047" stroke="#38bdf8" stroke-width="1.1"/>
            <!-- Both Arms Reaching Left to Grip & Pull the Tether -->
            <path d="M53,45 L34,51" stroke="#1c1917" stroke-width="5" stroke-linecap="round"/>
            <path d="M58,49 L38,54" stroke="#fff1e6" stroke-width="4.5" stroke-linecap="round"/>
            <circle cx="34" cy="52" r="3.4" fill="#292524" stroke="#fbbf24" stroke-width="1.2"/>
            <!-- Aether's Head, Golden Spiky Hair & Determined Anime Eyes -->
            <g class="gi-aether-head">
              <path d="M45,23 Q45,8 61,8 Q77,8 77,23 Q78,34 71,38 L51,38 Q44,34 45,23 Z" fill="#facc15" stroke="#b45309" stroke-width="1.3"/>
              <path d="M49,21 Q49,37 61,38 Q73,37 73,21 Q73,14 61,14 Q49,14 49,21 Z" fill="#fff1e6"/>
              <!-- Golden Amber Eyes Looking at the Pulled Letter -->
              <ellipse cx="55" cy="26" rx="2.9" ry="3.4" fill="#92400e"/>
              <ellipse cx="66" cy="26" rx="2.9" ry="3.4" fill="#92400e"/>
              <circle cx="54.5" cy="26.8" r="1.9" fill="#fbbf24"/>
              <circle cx="65.5" cy="26.8" r="1.9" fill="#fbbf24"/>
              <circle cx="53.8" cy="25" r="1" fill="#ffffff"/>
              <circle cx="64.8" cy="25" r="1" fill="#ffffff"/>
              <!-- Determined Brows & Effort Grin -->
              <path d="M51.5,22 L58,23.2" stroke="#78350f" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M63,23.2 L69.5,22" stroke="#78350f" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M58,32 Q61,34.5 64.5,31.8" stroke="#9a3412" stroke-width="1.4" stroke-linecap="round" fill="none"/>
              <!-- Iconic Golden Spiky Bangs & Ahoge + Left Ear Gold Ring -->
              <path d="M60,8 Q65,1 70,5 Q65,7 63,9" fill="#fef08a" stroke="#b45309" stroke-width="1.1"/>
              <path d="M45,22 Q51,11 61,12 Q72,11 78,22 Q72,17 67,22 Q61,14 55,22 Q49,17 45,22 Z" fill="#fef08a" stroke="#b45309" stroke-width="1.2"/>
              <circle cx="74.5" cy="29" r="2" fill="#fbbf24"/>
            </g>
          </g>
        </svg>
      </span>`;

    let out = `<span class="gi-greeting-stage" title="Paimon, Lumine &amp; Aether interacting with ${escapeAttr(text)}">`;
    for (let i = 0; i < len; i++) {
      const ch = chars[i];
      if (ch === " ") {
        out += `<span class="gi-space">&nbsp;</span>`;
        continue;
      }
      const isLumineAnchor = i === lumineSeatA;
      const isLumineSeat = i === lumineSeatA || i === lumineSeatB;
      const isPaimonAnchor = i === paimonSeat;
      const isPulled = i === pulledIdx;

      if (isPulled) {
        out += `<span class="gi-word-anchor gi-anchor-aether"><span class="gi-letter gi-letter-pulled">${escapeHTML(ch)}</span>${aetherRigSVG}</span>`;
      } else if (isLumineAnchor) {
        out += `<span class="gi-word-anchor gi-anchor-lumine">${lumineRigSVG}<span class="gi-letter gi-letter-seat-lumine">${escapeHTML(ch)}</span></span>`;
      } else if (isPaimonAnchor) {
        out += `<span class="gi-word-anchor gi-anchor-paimon">${paimonRigSVG}<span class="gi-letter gi-letter-seat-paimon">${escapeHTML(ch)}</span></span>`;
      } else {
        const seatCls = isLumineSeat ? " gi-letter-seat-lumine" : "";
        out += `<span class="gi-letter${seatCls}">${escapeHTML(ch)}</span>`;
      }
    }
    out += `</span>`;
    return out;
  }

  async function api(path, timeoutMs = 18000, opts) {
    const method = String(((opts && opts.method) || "GET")).toUpperCase();
    // Only cache safe, anonymous, idempotent GET catalog reads. Never cache
    // auth/session/version/live endpoints, stream/info URLs, or `refresh=1`
    // (which exists precisely to bypass caches).
    const cacheable =
      method === "GET" &&
      !/\/api\/(auth|youtube|health|version|geo|stream|img|radio\/click|audius\/file|audius\/stream|yt\/stream|download|user)\b/.test(path) &&
      !/[?&]refresh=1\b/.test(path);
    const cacheKey = cacheable ? `${API_CACHE_V}:${path}` : "";
    if (cacheable) {
      const hit = await apiCacheGet(cacheKey);
      if (hit != null) return hit;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = Object.assign({}, (opts && opts.headers) || {}, authHeaders());
      const creds = (API_BASE && IS_NATIVE) ? "omit" : "include";
      const res = await fetch(API_BASE + path, Object.assign({ signal: ctrl.signal, credentials: creds }, opts || {}, { headers }));
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (cacheable && apiCacheIsUsable(data)) await apiCachePut(cacheKey, data).catch(() => {});
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function current() {
    return state.queue[state.index] || null;
  }

  function trackKey(t) {
    if (!t) return "";
    if (t.id) return t.id;
    if (t.videoId) return `yt:${t.videoId}`;
    if (t.trackId) return `audius:${t.trackId}`;
    return "";
  }

  function isLiked(track) {
    if (!track) return false;
    const k = trackKey(track);
    return state.liked.some((t) => trackKey(t) === k);
  }

  function findSavedTrack(t) {
    if (!t) return null;
    const k = trackKey(t);
    const vId = t.videoId ? String(t.videoId) : "";
    const tId = t.trackId ? String(t.trackId) : "";
    const downloads = state.downloads || [];
    let hit = downloads.find((d) => {
      if (!d) return false;
      if (d.id && (d.id === t.id || d.id === k)) return true;
      if (k && trackKey(d) === k) return true;
      if (vId && (d.videoId === vId || d.id === vId || d.id === `yt:${vId}`)) return true;
      if (tId && (d.trackId === tId || d.id === tId || d.id === `audius:${tId}`)) return true;
      return false;
    });
    if (hit) return hit;
    if (t.title) {
      const tNorm = String(t.title).trim().toLowerCase();
      const aNorm = String(artistName(t) || t.artist || "").trim().toLowerCase();
      hit = downloads.find((d) => {
        if (!d || !d.title) return false;
        if (String(d.title).trim().toLowerCase() !== tNorm) return false;
        if (!aNorm) return true;
        const daNorm = String(artistName(d) || d.artist || "").trim().toLowerCase();
        return !daNorm || daNorm === aNorm || daNorm.includes(aNorm) || aNorm.includes(daNorm);
      });
    }
    if (!hit && t.title) {
      const cKey = canonicalSongKey(t);
      if (cKey) {
        hit = downloads.find((d) => d && canonicalSongKey(d) === cKey);
      }
    }
    return hit || null;
  }

  function hasOfflineSyncedLyrics(t) {
    const saved = findSavedTrack(t) || t;
    if (!saved) return false;
    if (Array.isArray(saved.synced) && saved.synced.length) return true;
    if (saved.lrc && /\[\d+:\d+/.test(String(saved.lrc))) return true;
    return Boolean(saved.lyrics && String(saved.lyrics).trim());
  }

  function isSaved(track) {
    return Boolean(findSavedTrack(track));
  }

  function toggleLike(track) {
    if (!track) return;
    const was = isLiked(track);
    if (was) state.liked = state.liked.filter((t) => trackKey(t) !== trackKey(track));
    else state.liked.unshift(track);
    save("aura.liked", state.liked);
    scheduleUserLibraryPush();
    const btn = $("likeBtn");
    if (btn) {
      btn.classList.toggle("pop", !was);
      setTimeout(() => btn.classList.remove("pop"), 400);
    }
    renderChrome();
    if (!was) {
      burstHearts(btn);
    }
    // No toast on like/unlike — the heart fills/empties and the button pop are
    // enough feedback. A toast on every tap is noisy and interrupts playback.
    if (state.view === "library" || state.view === "home") render();
    // Liking shifts the taste profile — reorder "Made for you" cards too.
    paintHomeSoon();
  }

  function openLikedFolder() {
    if (state.view !== "library") state.prevView = state.view;
    state.showProfile = false;
    state.view = "library";
    state.activePlaylist = "liked";
    closeOverlays();
    softRender();
  }

  function sheetItem(id, icon, label) {
    return `<button type="button" class="sheet-item" data-sheet="${id}">
      <span class="material-symbols-outlined">${icon}</span>
      <span>${label}</span>
    </button>`;
  }

  function openLikeMenu(track) {
    if (!track) return;
    showModal({
      title: track.title,
      body: `<p>${escapeHTML(track.artist)}</p>
        <div class="sheet-list">
          ${sheetItem("unlike", "heart_minus", "Remove from Liked Songs")}
          ${sheetItem("addpl", "playlist_add", "Add to playlist")}
          ${sheetItem("liked", "favorite", "Go to Liked Songs")}
        </div>`,
      ok: "Close",
      onOk: () => {},
    });
    $("modalCard").querySelectorAll("[data-sheet]").forEach((b) => {
      b.addEventListener("click", () => {
        const act = b.dataset.sheet;
        hideModal();
        if (act === "unlike") toggleLike(track);
        else if (act === "addpl") addToPlaylist(track);
        else if (act === "liked") openLikedFolder();
      });
    });
  }

  function openTrackMenu(track, where) {
    if (!track) return;
    const liked = isLiked(track);
    const inLiked = where === "liked";
    const inPl = where === "playlist" && typeof state.activePlaylist === "number";
    const inYtLiked = where === "yt-liked";
    const inYtPl = where === "yt-playlist" && typeof state.activePlaylist === "string" && state.activePlaylist.indexOf("yt-pl:") === 0;
    const ytAlreadyLiked = inYtLiked || isYtLiked(track);
    const inDl = where === "downloads" || isSaved(track);
    const canDl = !!(track && (track.trackId || track.videoId || track.source === "apple" || track.source === "itunes" || track.source === "deezer"));
    const hasOfflineLyr = hasOfflineSyncedLyrics(track);
    showModal({
      title: track.title,
      body: `<p>${escapeHTML(track.artist)}</p>
        <div class="sheet-list">
          ${sheetItem("next", "playlist_play", "Play next")}
          ${sheetItem("queue", "queue_music", "Add to queue")}
          ${sheetItem("addpl", "playlist_add", "Add to playlist")}
          ${inLiked
            ? sheetItem("unlike", "heart_minus", "Remove from Liked Songs")
            : liked
              ? sheetItem("unlike", "heart_minus", "Remove from Liked Songs")
              : sheetItem("like", "favorite", "Add to Liked Songs")}
          ${inPl ? sheetItem("rempl", "playlist_remove", "Remove from this playlist") : ""}
          ${inYtLiked ? sheetItem("ytunlike", "thumb_down", "Remove from YouTube Liked") : ""}
          ${inYtPl ? sheetItem("remytpl", "playlist_remove", "Remove from YouTube playlist") : ""}
          ${track.source !== "radio" ? sheetItem("follow", isFollowing(track) ? "person_remove" : "person_add", isFollowing(track) ? "Unfollow artist" : "Follow artist") : ""}
          ${inDl ? sheetItem("deldl", "delete", "Delete download") : (canDl ? sheetItem("dl", "download", "Save offline") : "")}
          ${track.source !== "radio" ? sheetItem("savelyrics", "subtitles", hasOfflineLyr ? "Update offline synced lyrics" : "Save synced lyrics offline") : ""}
          ${hasOfflineLyr ? sheetItem("exportlrc", "description", "Export synced lyrics (.lrc)") : ""}
          ${ytConnected() && track.videoId && !inYtLiked
            ? (ytAlreadyLiked
              ? sheetItem("ytunlike", "thumb_down", "Remove from YouTube Liked")
              : sheetItem("ytlike", "thumb_up", "Add to YouTube Liked"))
            : ""}
          ${ytConnected() && track.videoId ? sheetItem("ytpl", "playlist_add", "Add to YouTube playlist") : ""}
          ${IS_NATIVE ? sheetItem("share", "share", "Share") : ""}
          ${sheetItem("now", "lyrics", "Song details & lyrics")}
        </div>`,
      ok: "Close",
      onOk: () => {},
    });
    $("modalCard").querySelectorAll("[data-sheet]").forEach((b) => {
      b.addEventListener("click", () => {
        const act = b.dataset.sheet;
        hideModal(true);
        if (act === "next") playNext(track);
        else if (act === "queue") addToQueue(track);
        else if (act === "addpl") addToPlaylist(track);
        else if (act === "like" || act === "unlike") toggleLike(track);
        else if (act === "rempl") removeFromPlaylist(track, state.activePlaylist);
        else if (act === "ytunlike") ytUnlikeTrack(track);
        else if (act === "remytpl") ytRemoveFromPlaylist(track, state.activePlaylist);
        else if (act === "follow") toggleFollow(track);
        else if (act === "dl") downloadTrack(track);
        else if (act === "deldl") removeDownload(track.id);
        else if (act === "savelyrics") saveSyncedLyricsForTrackInteractive(track);
        else if (act === "exportlrc") exportTrackLrc(track);
        else if (act === "share") shareTrack(track);
        else if (act === "ytlike") ytToggleLike(track);
        else if (act === "ytpl") ytAddToPlaylist(track);
        else if (act === "now") {
          const list = inLiked ? state.liked
            : inPl ? state.playlists[state.activePlaylist].tracks
            : inYtLiked ? ((state.ytLiked && state.ytLiked.tracks) || [])
            : inYtPl ? ((state.ytOpen && state.ytOpen.tracks) || [])
            : state.queue;
          const i = list.findIndex((x) => x && x.id === track.id);
          if (i >= 0) playFromList(list, i);
          setView("now");
        }
      });
    });
  }

  function removeFromPlaylist(track, index) {
    const p = state.playlists[index];
    if (!p || !track) return;
    p.tracks = p.tracks.filter((t) => t.id !== track.id);
    savePlaylists();
    toast(`Removed from ${p.name}`, true, "success");
    if (state.view === "library") render();
  }

  // Session-level anti-repeat & shuffle tracking so the queue and recommendations
  // never play the same song twice in a row or repeat songs too often.
  const _sessionPlayedKeys = [];
  const _sessionPlayedSet = new Set();
  const _sessionAutoQueuedKeys = [];
  const _sessionAutoQueuedSet = new Set();
  const _shuffleVisitedKeys = new Set();

  function normalizeKeyText(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function canonicalSongTitleClient(rawTitle, rawArtist = "") {
    let s = String(rawTitle || "").toLowerCase().trim();
    if (!s) return "";
    let mod = "";
    if (/\b(remix|vip\s*mix|club\s*mix|extended\s*mix)\b/i.test(s)) mod = "remix";
    else if (/\b(acoustic|unplugged|stripped)\b/i.test(s)) mod = "acoustic";
    else if (/\b(live)\b/i.test(s)) mod = "live";
    else if (/\b(slowed|sped\s*up|nightcore)\b/i.test(s)) mod = "edit";
    const aNorm = String(rawArtist || "").toLowerCase().replace(/\s*-\s*topic\b/gi, "").trim();
    if (aNorm && s.includes(" - ")) {
      const parts = s.split(/\s+-\s+/);
      if (parts.length >= 2) {
        const p0 = parts[0].trim();
        const pLast = parts[parts.length - 1].trim();
        if (p0 === aNorm || p0.includes(aNorm)) s = parts.slice(1).join(" ").trim();
        else if (pLast === aNorm || pLast.includes(aNorm)) s = parts.slice(0, -1).join(" ").trim();
      }
    }
    s = s
      .replace(/\((?:official|lyric|lyrics|audio|video|music\s*video|visualizer|hd|hq|4k|remaster(?:ed)?|explicit|clean|version|edit|feat\.?|ft\.?|with|prod\.?)[^)]*\)/gi, " ")
      .replace(/\[(?:official|lyric|lyrics|audio|video|music\s*video|visualizer|hd|hq|4k|remaster(?:ed)?|explicit|clean|version|edit|feat\.?|ft\.?|with|prod\.?)[^\]]*\]/gi, " ")
      .replace(/\b(?:feat\.?|ft\.?|featuring)\s+[^-–—()[\]]+/gi, " ")
      .replace(/\b(?:official\s+(?:music\s+)?(?:video|audio|lyric\s+video|visualizer)|full\s+song|lyric\s+video|lyrics|audio|hd|hq|4k|remastered\s*\d*)\b/gi, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    return mod ? `${s} ${mod}`.trim() : s;
  }

  function canonicalPrimaryArtistClient(tOrArtist) {
    const raw = typeof tOrArtist === "string"
      ? tOrArtist
      : (tOrArtist && (tOrArtist.artist || (tOrArtist.user && tOrArtist.user.name) || tOrArtist.author)) || "";
    let s = String(raw || "").toLowerCase().trim();
    if (!s) return "";
    s = s
      .replace(/\s*-\s*topic\b/gi, "")
      .replace(/\bvevo\b/gi, "")
      .replace(/\bofficial\b/gi, "")
      .split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bx\b|\bwith\b|\/|;|\band\b)\s*/i)[0]
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    return s;
  }

  function canonicalSongKey(t) {
    if (!t) return "";
    const titleNorm = canonicalSongTitleClient(t.title || "", t.artist || "");
    const artistNorm = canonicalPrimaryArtistClient(t);
    if (titleNorm && artistNorm) return `${titleNorm}__${artistNorm}`;
    if (titleNorm) return `${titleNorm}__`;
    return String(t.id || t.videoId || t.trackId || "").toLowerCase().trim();
  }

  function isSameSongClient(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.id && b.id && String(a.id) === String(b.id)) return true;
    if (a.videoId && b.videoId && String(a.videoId) === String(b.videoId)) return true;
    if (a.trackId && b.trackId && String(a.trackId) === String(b.trackId) && a.source === b.source) return true;
    const ka = canonicalSongKey(a);
    const kb = canonicalSongKey(b);
    if (ka && kb && ka === kb) return true;
    const ta = canonicalSongTitleClient(a.title || "", a.artist || "");
    const tb = canonicalSongTitleClient(b.title || "", b.artist || "");
    if (ta && tb && ta === tb) {
      const aa = canonicalPrimaryArtistClient(a);
      const ab = canonicalPrimaryArtistClient(b);
      if (!aa || !ab || aa === ab || aa.includes(ab) || ab.includes(aa)) return true;
    }
    return false;
  }

  function recordSessionPlayed(t) {
    const k = canonicalSongKey(t);
    if (!k) return;
    _shuffleVisitedKeys.add(k);
    if (!_sessionPlayedSet.has(k)) {
      _sessionPlayedSet.add(k);
      _sessionPlayedKeys.unshift(k);
      while (_sessionPlayedKeys.length > 80) {
        const old = _sessionPlayedKeys.pop();
        if (old) _sessionPlayedSet.delete(old);
      }
    }
  }

  function recordSessionAutoQueued(t) {
    const k = canonicalSongKey(t);
    if (!k) return;
    if (!_sessionAutoQueuedSet.has(k)) {
      _sessionAutoQueuedSet.add(k);
      _sessionAutoQueuedKeys.unshift(k);
      while (_sessionAutoQueuedKeys.length > 90) {
        const old = _sessionAutoQueuedKeys.pop();
        if (old) _sessionAutoQueuedSet.delete(old);
      }
    }
  }

  function pushRecent(track) {
    if (!track) return;
    recordSessionPlayed(track);
    const item = { ...track, playedAt: Date.now() };
    state.recents = [item, ...state.recents.filter((t) => !isSameSongClient(t, track))].slice(0, 200);
    save("aura.recents", state.recents);
    // Taste-adaptive "Made for you": a fresh play shifts the taste profile, so
    // re-render the home row to reorder the mood cards around the listener.
    paintHomeSoon();
  }

  function artistName(t) {
    return String((t && t.artist) || "").split("·")[0].trim();
  }
  function audiusHandle(t) {
    if (!t || !t.permalink) return "";
    return String(t.permalink).replace(/^\//, "").split("/")[0] || "";
  }
  function artistKey(t) {
    if (!t) return "";
    if (typeof t === "string") {
      const clean = t.replace(/^(name:|audius:)/i, "").trim().toLowerCase();
      return clean ? `name:${clean}` : "";
    }
    const h = audiusHandle(t);
    if (h) return `audius:${h.toLowerCase()}`;
    const n = String(artistName(t) || t.name || "").toLowerCase().trim();
    return n ? `name:${n}` : "";
  }
  function isFollowing(t) {
    if (!t) return false;
    const k = artistKey(t);
    const targetName = (typeof t === "string" ? t : String(artistName(t) || t.name || ""))
      .replace(/^(name:|audius:)/i, "")
      .toLowerCase()
      .trim();
    const origName = (typeof t === "object" && t.origName ? String(t.origName) : "")
      .replace(/^(name:|audius:)/i, "")
      .toLowerCase()
      .trim();
    const targetFold = targetName ? dzFold(targetName) : "";
    const origFold = origName ? dzFold(origName) : "";
    return (state.following || []).some((f) => {
      if (!f) return false;
      const fk = String(f.key || "").toLowerCase().trim();
      const fn = String(f.name || fk.replace(/^(name:|audius:)/i, "")).toLowerCase().trim();
      const fnFold = fn ? dzFold(fn) : "";
      return (
        (k && fk === k) ||
        (targetName && (fn === targetName || fk === targetName || fk === `name:${targetName}`)) ||
        (origName && (fn === origName || fk === origName || fk === `name:${origName}`)) ||
        (fnFold && ((targetFold && fnFold === targetFold) || (origFold && fnFold === origFold)))
      );
    });
  }
  function saveFollowing(opts) {
    state.following = dedupeFollowingList(state.following);
    save("aura.following", state.following);
    scheduleUserLibraryPush(opts);
  }
  function unfollowArtistByKeyOrName(keyOrName, extraName) {
    const raw = String(keyOrName || "").trim();
    if (!raw && !extraName) return "";
    const targetLower = raw.toLowerCase();
    const targetName = targetLower.replace(/^(name:|audius:)/i, "").trim();
    const altName = String(extraName || "").replace(/^(name:|audius:)/i, "").toLowerCase().trim();
    const targetFold = targetName ? dzFold(targetName) : "";
    const altFold = altName ? dzFold(altName) : "";
    let removedName = "";
    state.following = (state.following || []).filter((f) => {
      if (!f) return false;
      const fk = String(f.key || "").toLowerCase().trim();
      const fn = String(f.name || "").toLowerCase().trim();
      const fnFold = fn ? dzFold(fn) : "";
      const match =
        fk === targetLower ||
        (targetName && (fn === targetName || fk.replace(/^(name:|audius:)/i, "") === targetName)) ||
        (altName && (fn === altName || fk.replace(/^(name:|audius:)/i, "") === altName)) ||
        (fnFold && ((targetFold && fnFold === targetFold) || (altFold && fnFold === altFold)));
      if (match && !removedName) removedName = f.name || raw;
      return !match;
    });
    if (Array.isArray(state.prefs.tasteArtists)) {
      state.prefs.tasteArtists = state.prefs.tasteArtists.filter((a) => {
        const al = String(a || "").toLowerCase().trim();
        const af = al ? dzFold(al) : "";
        return al !== targetName && al !== altName && (!af || (af !== targetFold && af !== altFold));
      });
      savePrefs();
    }
    saveFollowing({ replaceFollowing: true });
    return removedName || raw.replace(/^(name:|audius:)/i, "");
  }

  function toggleFollow(track) {
    if (!track || track.source === "radio") {
      toast("Radio stations can’t be followed as artists");
      return;
    }
    const key = artistKey(track);
    const name = artistName(track) || track.name || "";
    if (!key || !name) return;
    if (isFollowing(track)) {
      const unfollowed = unfollowArtistByKeyOrName(key || name, track.origName || "");
      toast(`Unfollowed ${unfollowed || name}`, true, "success");
    } else {
      state.following.unshift({
        key,
        name,
        source: track.source || "catalog",
        handle: audiusHandle(track),
        artwork: artUrl(track),
        lastId: track.id || "",
        followedAt: Date.now(),
      });
      saveFollowing();
      toast(`Following ${name}`, true, "success");
      if (state.prefs.notifyFollows && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    }
    renderChrome();
    if (state.view === "library" || state.view === "settings" || state.artistPage) render();
  }

  const ONBOARD_CORE_GENRES = [
    { id: "pop", title: "Pop", sub: "Top hits & chart anthems", query: "pop hits official audio", color: "#ff4d6d" },
    { id: "hiphop", title: "Hip-Hop & Rap", sub: "Trap, melodic rap & flows", query: "hip hop rap hits official audio", color: "#f72585" },
    { id: "rnb", title: "R&B & Soul", sub: "Smooth vocals & late-night grooves", query: "rnb soul hits official audio", color: "#c77dff" },
    { id: "rock", title: "Rock & Alternative", sub: "Guitar anthems & modern rock", query: "rock hits official audio", color: "#ef476f" },
    { id: "dance", title: "Dance & Electronic", sub: "EDM, house & club energy", query: "edm dance hits official audio", color: "#4cc9f0" },
    { id: "indie", title: "Indie & Bedroom Pop", sub: "Dreamy & alternative sounds", query: "indie pop alternative official audio", color: "#80ed99" },
    { id: "lofi", title: "Lo-Fi & Chillhop", sub: "Cozy beats & instrumentals", query: "lofi chill beats songs", color: "#4361ee" },
    { id: "throwback", title: "90s & 2000s Throwback", sub: "Timeless classics & nostalgia", query: "throwback 90s 2000s hits official audio", color: "#f4a261" },
  ];

  const ONBOARD_COUNTRY_GENRES = {
    IN: [
      { id: "bollywood", title: "Bollywood & Hindi", sub: "Romantic hits & chartbusters", query: "bollywood hindi hits official audio", color: "#ff9f1c" },
      { id: "punjabi", title: "Punjabi", sub: "Bhangra, hip-hop & viral beats", query: "punjabi hits official audio", color: "#ffb703" },
      { id: "tamil", title: "Tamil & Kollywood", sub: "Kollywood melodies & hits", query: "tamil kollywood hits official audio", color: "#fb8500" },
      { id: "telugu", title: "Telugu & Tollywood", sub: "Tollywood chartbusters", query: "telugu tollywood hits official audio", color: "#ff6b35" },
      { id: "indie_in", title: "Indian Indie", sub: "Fresh independent Indian artists", query: "indian indie songs official audio", color: "#06d6a0" },
    ],
    PK: [
      { id: "pak_pop", title: "Pakistani Pop & OST", sub: "Coke Studio & chart hits", query: "pakistani pop coke studio official audio", color: "#22c55e" },
      { id: "urdu_rap", title: "Urdu Hip-Hop", sub: "Pakistani rap & new wave", query: "urdu rap pakistani hip hop official audio", color: "#f72585" },
      { id: "qawwali", title: "Sufi & Qawwali", sub: "Soulful classics & fusion", query: "sufi qawwali pakistani songs official", color: "#a78bfa" },
      { id: "punjabi", title: "Punjabi", sub: "Punjabi hits & beats", query: "punjabi hits official audio", color: "#ffb703" },
    ],
    BD: [
      { id: "bangla_pop", title: "Bangla Pop & Hits", sub: "Modern Bangladeshi chart toppers", query: "bangla pop hits new songs official", color: "#22c55e" },
      { id: "bangla_rock", title: "Bangla Rock & Band", sub: "Legendary Bangladeshi bands", query: "bangla rock bands warfaze artcell official", color: "#ef476f" },
      { id: "bangla_indie", title: "Bangla Indie & Folk", sub: "Coke Studio Bangla & indie", query: "coke studio bangla indie songs official", color: "#ffb703" },
    ],
    PH: [
      { id: "opm_pop", title: "OPM Pop & Hits", sub: "Top Filipino chartbusters", query: "opm pop hits philippines official audio", color: "#ff9f1c" },
      { id: "pinoy_rock", title: "Pinoy Rock & Bands", sub: "OPM bands & guitar anthems", query: "pinoy rock opm bands hits official audio", color: "#ef476f" },
      { id: "pinoy_indie", title: "Pinoy Indie & Alt", sub: "Modern Filipino indie bands", query: "pinoy indie opm alternative songs official", color: "#06d6a0" },
      { id: "pinoy_hiphop", title: "Pinoy Hip-Hop & R&B", sub: "Filipino rap & smooth R&B", query: "pinoy hip hop rnb hits official audio", color: "#b5179e" },
      { id: "hugot", title: "Hugot & Acoustic", sub: "Heartfelt OPM love ballads", query: "opm hugot love songs acoustic official", color: "#ff758f" },
    ],
    HK: [
      { id: "cantopop", title: "Cantopop (廣東歌)", sub: "Hong Kong pop hits & classics", query: "hong kong cantopop hits official audio", color: "#ff9f1c" },
      { id: "hk_rock", title: "HK Rock & Bands", sub: "Beyond, Dear Jane, Supper Moment", query: "hong kong rock band cantopop official", color: "#ef476f" },
      { id: "hk_indie", title: "Hong Kong Indie", sub: "Alternative & indie HK scene", query: "hong kong indie cantopop alternative official", color: "#06d6a0" },
      { id: "mandopop", title: "Mandopop (國語流行)", sub: "Mandarin pop chart hits", query: "mandopop hits official audio", color: "#b5179e" },
    ],
    CN: [
      { id: "mandopop", title: "Mandopop (华语流行)", sub: "Top Mandarin pop & ballads", query: "mandopop chinese pop hits official audio", color: "#ff9f1c" },
      { id: "cn_rock", title: "Chinese Rock & Band", sub: "Rock bands & live anthems", query: "chinese rock bands hits official audio", color: "#ef476f" },
      { id: "cn_rap", title: "Chinese Hip-Hop", sub: "C-Rap & urban beats", query: "chinese rap hip hop hits official", color: "#b5179e" },
      { id: "cn_indie", title: "Chinese Indie & Folk", sub: "Folk & indie singer-songwriters", query: "chinese indie folk songs official audio", color: "#06d6a0" },
    ],
    KR: [
      { id: "kpop", title: "K-Pop", sub: "Korean pop icons & chart hits", query: "kpop top hits official audio", color: "#b5179e" },
      { id: "krnb", title: "K-R&B & K-Hip-Hop", sub: "Korean R&B grooves & rap", query: "krnb khiphop hits official audio", color: "#c77dff" },
      { id: "krock", title: "Korean Band & Rock", sub: "DAY6, Wave to Earth & K-Rock", query: "korean rock band krock songs official", color: "#ef476f" },
      { id: "kindie", title: "K-Indie & Ballads", sub: "Korean indie & K-Drama OSTs", query: "korean indie kdrama ost songs official", color: "#06d6a0" },
    ],
    JP: [
      { id: "jpop", title: "J-Pop", sub: "Japan Hot 100 & top hits", query: "jpop top hits official audio", color: "#ff4d6d" },
      { id: "jrock", title: "J-Rock & Bands", sub: "Japanese rock bands & anthems", query: "jrock japanese rock bands official", color: "#ef476f" },
      { id: "anime", title: "Anime & Vocaloid", sub: "Anime themes & Vocaloid hits", query: "anime openings hits official audio", color: "#4cc9f0" },
      { id: "citypop", title: "City Pop & J-Indie", sub: "Retro grooves & Japanese indie", query: "japanese city pop indie official", color: "#ffb703" },
    ],
    TH: [
      { id: "tpop", title: "T-Pop", sub: "Thai pop hits & chart toppers", query: "tpop thai pop hits official", color: "#ff9f1c" },
      { id: "thai_rock", title: "Thai Rock & Bands", sub: "Thai bands & guitar hits", query: "thai rock bands songs official", color: "#ef476f" },
      { id: "thai_indie", title: "Thai Indie & Chill", sub: "Indie pop & chill Thai vibes", query: "thai indie songs official", color: "#06d6a0" },
    ],
    VN: [
      { id: "vpop", title: "V-Pop", sub: "Vietnamese pop chartbusters", query: "vpop top hits official", color: "#ff9f1c" },
      { id: "rap_viet", title: "Rap Việt & Hip-Hop", sub: "Vietnamese rap & urban hits", query: "rap viet hip hop official", color: "#b5179e" },
      { id: "viet_indie", title: "Viet Indie & Ballad", sub: "Indie bands & acoustic ballads", query: "viet indie ballad songs official", color: "#06d6a0" },
    ],
    ID: [
      { id: "indo_pop", title: "Lagu Pop Indonesia", sub: "Indonesian pop chart hits", query: "lagu pop indonesia hits official", color: "#ff9f1c" },
      { id: "indo_rock", title: "Band Rock Indonesia", sub: "Indonesian rock & pop bands", query: "band rock indonesia hits official", color: "#ef476f" },
      { id: "indo_indie", title: "Indie Indonesia", sub: "Senja, folk & Indonesian indie", query: "indie indonesia songs official", color: "#06d6a0" },
    ],
    MY: [
      { id: "my_pop", title: "Malaysia Pop & Melayu", sub: "Lagu Melayu & Malaysian hits", query: "malaysia pop lagu baru official", color: "#ff9f1c" },
      { id: "my_rock", title: "Malaysia Rock & Indie", sub: "Local bands & indie scene", query: "malaysia rock indie bands official", color: "#06d6a0" },
      { id: "mandopop", title: "Mandopop", sub: "Mandarin pop hits", query: "mandopop hits official audio", color: "#b5179e" },
    ],
    SG: [
      { id: "sg_pop", title: "Singapore Pop & Hits", sub: "Local & regional chart toppers", query: "singapore top hits pop official", color: "#ff9f1c" },
      { id: "mandopop", title: "Mandopop", sub: "JJ Lin, Stefanie Sun & hits", query: "mandopop hits official audio", color: "#b5179e" },
      { id: "sg_indie", title: "Singapore Indie", sub: "Homegrown indie & alternative", query: "singapore indie songs official", color: "#06d6a0" },
    ],
    NG: [
      { id: "afrobeats", title: "Afrobeats", sub: "Naija rhythms & global hits", query: "afrobeats top hits nigeria official", color: "#06d6a0" },
      { id: "afro_alte", title: "Afro-Fusion & Alte", sub: "Soulful Afro-R&B & Alte scene", query: "afro rnb alte nigeria official", color: "#ffb703" },
      { id: "amapiano", title: "Amapiano", sub: "Log drum grooves & club heat", query: "amapiano hits official audio", color: "#b5179e" },
    ],
    ZA: [
      { id: "amapiano", title: "Amapiano", sub: "South African log drum anthems", query: "amapiano south africa hits official", color: "#06d6a0" },
      { id: "za_house", title: "Afro Tech & SA House", sub: "Deep house & SA dance hits", query: "south africa afro house hits official", color: "#4cc9f0" },
      { id: "afrobeats", title: "Afrobeats & Pop", sub: "African pop & chart hits", query: "afrobeats pop south africa official", color: "#ffb703" },
    ],
    BR: [
      { id: "br_pop", title: "Pop Brasil & Funk", sub: "Top Brasil & baile funk", query: "pop brasil funk hits official", color: "#06d6a0" },
      { id: "sertanejo", title: "Sertanejo & Pagode", sub: "Brazilian chart favorites", query: "sertanejo pagode brasil official", color: "#ffb703" },
      { id: "br_rock", title: "Rock & Indie Brasil", sub: "Rock nacional & MPB", query: "rock nacional mpb brasil official", color: "#ef476f" },
    ],
    MX: [
      { id: "mex_reg", title: "Regional Mexicano", sub: "Corridos tumbados & banda", query: "regional mexicano corridos hits official", color: "#ff9f1c" },
      { id: "reggaeton", title: "Reggaeton & Urbano", sub: "Perreo & Latin club hits", query: "reggaeton urbano latino hits official", color: "#f72585" },
      { id: "rock_esp", title: "Rock & Indie en Español", sub: "Mexican rock & indie bands", query: "rock indie en espanol mexico official", color: "#06d6a0" },
    ],
    ES: [
      { id: "es_pop", title: "Pop Español", sub: "Top hits from Spain", query: "pop espanol exitos nuevos official", color: "#ff9f1c" },
      { id: "reggaeton", title: "Reggaeton & Urbano", sub: "Latin urban & Spanish trap", query: "reggaeton trap espana hits official", color: "#f72585" },
      { id: "es_indie", title: "Indie & Rock Español", sub: "Spanish indie & rock bands", query: "indie rock espanol hits official", color: "#06d6a0" },
    ],
    AE: [
      { id: "arabic_pop", title: "Arabic Pop", sub: "Top Arabic chart hits", query: "arabic pop top hits official", color: "#ff9f1c" },
      { id: "khaleeji", title: "Khaleeji Hits", sub: "Gulf rhythms & melodies", query: "khaleeji hits official audio", color: "#06d6a0" },
      { id: "arabic_indie", title: "Arabic Indie & Rock", sub: "Alternative Arabic bands", query: "arabic indie rock cairokee official", color: "#b5179e" },
    ],
    SA: [
      { id: "khaleeji", title: "Khaleeji Hits", sub: "Saudi & Gulf chartbusters", query: "khaleeji hits saudi official audio", color: "#06d6a0" },
      { id: "arabic_pop", title: "Arabic Pop", sub: "Pan-Arab pop favorites", query: "arabic pop top hits official", color: "#ff9f1c" },
      { id: "arabic_rap", title: "Arabic Hip-Hop", sub: "Saudi & Arab rap scene", query: "arabic hip hop rap official", color: "#b5179e" },
    ],
    EG: [
      { id: "egypt_pop", title: "Egyptian Pop", sub: "Aghani Gadida & chart hits", query: "egyptian pop hits official", color: "#ff9f1c" },
      { id: "mahraganat", title: "Mahraganat & Rap", sub: "Egyptian street beats & trap", query: "egyptian rap mahraganat wegz official", color: "#f72585" },
      { id: "egypt_indie", title: "Egyptian Rock & Indie", sub: "Cairokee & indie bands", query: "egyptian indie rock cairokee official", color: "#06d6a0" },
    ],
    TR: [
      { id: "tr_pop", title: "Türkçe Pop", sub: "Turkish pop chartbusters", query: "turkce pop hits official", color: "#ff9f1c" },
      { id: "tr_rock", title: "Türkçe Rock & Indie", sub: "Anatolian & modern Turkish rock", query: "turkce rock alternatif hits official", color: "#ef476f" },
      { id: "tr_rap", title: "Türkçe Rap", sub: "Turkish hip-hop & trap", query: "turkce rap hip hop official", color: "#b5179e" },
    ],
    DE: [
      { id: "de_pop", title: "Deutschpop", sub: "German pop chart toppers", query: "deutschpop deutsche charts official", color: "#ff9f1c" },
      { id: "deutschrap", title: "Deutschrap", sub: "German hip-hop & trap", query: "deutschrap hits official", color: "#b5179e" },
      { id: "de_indie", title: "German Rock & Indie", sub: "Indie & rock from Germany", query: "german indie rock hits official", color: "#06d6a0" },
    ],
    FR: [
      { id: "fr_pop", title: "Pop & Variété Française", sub: "French pop & chanson", query: "pop francaise hits officiels", color: "#ff9f1c" },
      { id: "fr_rap", title: "Rap Français", sub: "French hip-hop & urban hits", query: "rap francais hits officiels", color: "#b5179e" },
      { id: "french_touch", title: "French Touch & Indie", sub: "French electro & indie pop", query: "french touch indie pop official", color: "#4cc9f0" },
    ],
    IT: [
      { id: "it_pop", title: "Pop Italiano", sub: "Sanremo & Italian chart hits", query: "pop italiano classifica singoli", color: "#ff9f1c" },
      { id: "it_rap", title: "Rap & Trap Italiano", sub: "Italian urban & hip-hop", query: "rap trap italiano hits", color: "#b5179e" },
      { id: "it_indie", title: "Rock & Indie Italiano", sub: "Måneskin & indie italiano", query: "rock indie italiano hits", color: "#06d6a0" },
    ],
    GB: [
      { id: "uk_pop", title: "Britpop & UK Pop", sub: "Official UK Top 40 & chart icons", query: "uk pop hits dua lipa ed sheeran raye official", color: "#ff4d6d" },
      { id: "uk_drill", title: "UK Drill, Grime & Rap", sub: "Central Cee, Dave, Stormzy & UK rap", query: "uk drill grime rap hits official", color: "#b5179e" },
      { id: "uk_indie", title: "Britrock & UK Indie", sub: "Arctic Monkeys, Oasis, The 1975", query: "uk indie rock bands hits official", color: "#06d6a0" },
      { id: "uk_house", title: "UK House, Garage & DnB", sub: "Fred again.., Calvin Harris & club bass", query: "uk house garage dance hits official", color: "#4cc9f0" },
    ],
    US: [
      { id: "us_billboard", title: "US Hot 100 & Pop", sub: "Billboard chart toppers & US pop", query: "billboard hot 100 top hits official audio", color: "#ff4d6d" },
      { id: "country", title: "Country & Americana", sub: "Morgan Wallen, Zach Bryan & Nashville", query: "country hits billboard official audio", color: "#ff9f1c" },
      { id: "us_hiphop", title: "US Hip-Hop & Trap", sub: "Atlanta, West Coast & melodic rap", query: "us hip hop rap hits official audio", color: "#f72585" },
      { id: "latin", title: "Latin & Reggaeton", sub: "Global Latin chartbusters", query: "latin reggaeton hits official audio", color: "#ffb703" },
    ],
    CA: [
      { id: "ca_pop", title: "Canadian Pop & R&B", sub: "The Weeknd, Tate McRae & Toronto R&B", query: "canadian pop rnb hits the weeknd tate mcrae official", color: "#ff4d6d" },
      { id: "ca_indie", title: "Canadian Indie & Alt", sub: "Arcade Fire, Alvvays, Men I Trust", query: "canadian indie rock alternative songs official", color: "#06d6a0" },
      { id: "ca_rock", title: "Canadian Rock Classics", sub: "Sum 41, Billy Talent, The Tragically Hip", query: "canadian rock bands hits official", color: "#ef476f" },
      { id: "franco_ca", title: "Franco-Pop & Québec", sub: "Charlotte Cardin & French-Canadian hits", query: "chanson quebec franco pop hits official", color: "#4cc9f0" },
    ],
    AU: [
      { id: "au_pop", title: "Aussie Pop & ARIA Hits", sub: "Troye Sivan, The Kid LAROI & Sia", query: "australian pop hits aria chart official", color: "#ff9f1c" },
      { id: "au_indie", title: "Aussie Indie & Psych", sub: "Tame Impala, Spacey Jane, Ocean Alley", query: "australian indie rock triple j hottest 100 official", color: "#06d6a0" },
      { id: "au_dance", title: "Aussie Electronic & Club", sub: "RÜFÜS DU SOL, Dom Dolla, Flume, Fisher", query: "australian electronic dance rufus du sol dom dolla official", color: "#4cc9f0" },
      { id: "au_rock", title: "Aussie Rock & Pub Anthems", sub: "AC/DC, INXS, Gang of Youths", query: "australian rock bands hits official", color: "#ef476f" },
    ],
    NZ: [
      { id: "nz_pop", title: "Aotearoa Pop & Roots", sub: "SIX60, L.A.B, Lorde & BENEE", query: "new zealand pop hits six60 l.a.b lorde official", color: "#06d6a0" },
      { id: "nz_indie", title: "Kiwi Indie & Alternative", sub: "The Beths, Unknown Mortal Orchestra", query: "new zealand indie rock songs official", color: "#4cc9f0" },
      { id: "nz_rnb", title: "NZ Soul, Reggae & R&B", sub: "Stan Walker, Fat Freddy's Drop, Katchafire", query: "new zealand roots reggae soul hits official", color: "#ffb703" },
    ],
    NL: [
      { id: "nl_pop", title: "Nederpop & Top 40", sub: "Roxy Dekker, Flemming, Suzan & Freek", query: "nederpop nederlandse top 40 hits official", color: "#ff9f1c" },
      { id: "nl_edm", title: "Dutch EDM & Festival", sub: "Martin Garrix, Tiësto, Armin van Buuren", query: "dutch edm dance martin garrix tiesto official", color: "#4cc9f0" },
      { id: "nederhop", title: "Nederhop & Dutch Urban", sub: "Frenna, Boef, Ronnie Flex & hip-hop", query: "nederhop dutch hip hop hits official", color: "#b5179e" },
      { id: "nl_indie", title: "Dutch Rock & Indie", sub: "Son Mieux, Kensington, Within Temptation", query: "dutch rock indie bands hits official", color: "#06d6a0" },
    ],
    SE: [
      { id: "se_pop", title: "Svensk Pop & Topplistan", sub: "Zara Larsson, Benjamin Ingrosso, Molly Sandén", query: "svensk pop sverigetopplistan hits official", color: "#4cc9f0" },
      { id: "se_house", title: "Swedish House & Dance", sub: "Avicii, Swedish House Mafia, Alesso", query: "swedish house edm avicii alesso official", color: "#06d6a0" },
      { id: "se_hiphop", title: "Svensk Hip-Hop & Rap", sub: "Hov1, Bolaget, C.Gambino", query: "svensk hip hop rap hits official", color: "#b5179e" },
      { id: "se_indie", title: "Swedish Indie & Rock", sub: "The Hives, Lykke Li, First Aid Kit", query: "swedish indie rock pop songs official", color: "#ff9f1c" },
    ],
  };

  function getOnboardGenresForCountry(countryCode) {
    const code = String(countryCode || (state.prefs && state.prefs.country) || "US").toUpperCase();
    const regional = ONBOARD_COUNTRY_GENRES[code] || ONBOARD_COUNTRY_GENRES.US || [];
    const core = ONBOARD_CORE_GENRES.map((g) => ({
      ...g,
      query: shelfQueryForCountryClient(g.id, code, g.query),
    }));
    // Place regional options right at the top alongside core genres so users immediately see their country's music varieties
    const seen = new Set();
    const out = [];
    for (const item of [...regional, ...core]) {
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }

  function findOnboardGenreById(id, countryCode) {
    const list = getOnboardGenresForCountry(countryCode);
    const hit = list.find((g) => g.id === id);
    if (hit) return hit;
    for (const arr of Object.values(ONBOARD_COUNTRY_GENRES)) {
      const m = arr.find((g) => g.id === id);
      if (m) return m;
    }
    return ONBOARD_CORE_GENRES.find((g) => g.id === id) || null;
  }

  const ONBOARD_MOODS = [
    { id: "chill", title: "Chill & Relax", sub: "Easy listening & unwind", query: "chill vibes songs official audio", color: "#4cc9f0" },
    { id: "latenight", title: "Late Night Drive", sub: "Midnight synth & city lights", query: "late night drive songs official audio", color: "#7209b7" },
    { id: "workout", title: "Workout & Gym", sub: "High-tempo pump & energy", query: "workout motivation songs official audio", color: "#ff4d6d" },
    { id: "focus", title: "Focus & Study", sub: "Deep concentration & flow", query: "focus study music lofi", color: "#4361ee" },
    { id: "party", title: "Party & Club", sub: "Turn up the energy", query: "party dance club hits official audio", color: "#f72585" },
    { id: "morning", title: "Feel-Good Morning", sub: "Upbeat sunshine & good vibes", query: "morning feel good songs official", color: "#ffb703" },
    { id: "romance", title: "Romance & Love", sub: "Warm acoustic & love songs", query: "romantic love songs official audio", color: "#ff758f" },
    { id: "sad", title: "Heartbreak & Deep", sub: "Emotional ballads & late thoughts", query: "sad emotional songs official audio", color: "#4895ef" },
    { id: "roadtrip", title: "Road Trip Singalong", sub: "Anthems everyone knows", query: "road trip singalong hits official audio", color: "#f4a261" },
    { id: "gaming", title: "Gaming & Phonk", sub: "Bass-heavy phonk & electronic", query: "gaming phonk edm songs", color: "#06d6a0" },
    { id: "acoustic", title: "Acoustic & Unplugged", sub: "Stripped-back guitars & vocals", query: "acoustic unplugged songs official audio", color: "#80ed99" },
    { id: "rainy", title: "Rainy Day & Cozy", sub: "Warm coffeehouse melodies", query: "cozy rainy day indie acoustic songs", color: "#c77dff" },
  ];

  const ONBOARD_ERAS = [
    { id: "new_2025", title: "2024–2026 New & Trending", sub: "Fresh releases & viral chartbusters", query: "new trending hits 2025 2026 official audio", color: "#ff4d6d" },
    { id: "2010s", title: "2010s Anthems", sub: "2010–2019 pop, EDM & hip-hop classics", query: "2010s top hits anthems official audio", color: "#4cc9f0" },
    { id: "2000s", title: "2000s Throwbacks", sub: "Y2K pop, R&B & rock nostalgia", query: "2000s hits throwback songs official audio", color: "#f72585" },
    { id: "90s", title: "90s Classics", sub: "Golden era 90s hits & bands", query: "90s classic hits songs official audio", color: "#ffb703" },
    { id: "80s", title: "80s & Retro Gold", sub: "Synthpop, classic rock & legends", query: "80s greatest hits retro official audio", color: "#c77dff" },
    { id: "timeless", title: "All Eras Mix", sub: "Blend brand-new songs with classics", query: "all time greatest hits mix official audio", color: "#06d6a0" },
  ];

  function getOnboardStylesForCountry(countryCode) {
    const code = String(countryCode || (state.prefs && state.prefs.country) || "US").toUpperCase();
    const cName = countryName(code);
    return [
      { id: "mix_local_en", title: `${cName} + International Mix`, sub: `Blend ${cName} favorites with global hits`, query: `${cName} top hits official audio`, color: "#06d6a0" },
      { id: "mostly_local", title: `Mostly ${cName} Music`, sub: `Prioritize local artists & bands from ${cName}`, query: `${cName} popular songs official audio`, color: "#ff9f1c" },
      { id: "mostly_english", title: "Mostly International English", sub: "Global pop, rock, R&B & chart hits", query: "global english top hits official audio", color: "#4cc9f0" },
      { id: "vocal_melodic", title: "Melodic & Vocal-Focused", sub: "Rich vocals, hooks & storytelling", query: "melodic vocal pop rnb songs official audio", color: "#c77dff" },
      { id: "upbeat_energy", title: "Upbeat & High-Energy", sub: "Fast-paced anthems & feel-good beats", query: "upbeat energetic hits songs official audio", color: "#ff4d6d" },
      { id: "discovered_gems", title: "Hidden Gems & Indie", sub: "Rising artists & underrated tracks", query: "underrated indie pop hidden gems songs", color: "#80ed99" },
    ];
  }

  const ONBOARD_GLOBAL_ARTISTS = [
    { name: "The Weeknd", tag: "Pop · R&B", genres: ["pop", "rnb", "dance"] },
    { name: "Taylor Swift", tag: "Pop · Indie", genres: ["pop", "indie"] },
    { name: "Bruno Mars", tag: "Pop · R&B", genres: ["pop", "rnb", "throwback"] },
    { name: "Billie Eilish", tag: "Pop · Alternative", genres: ["pop", "indie"] },
    { name: "Coldplay", tag: "Rock · Pop", genres: ["rock", "pop", "indie"] },
    { name: "Ariana Grande", tag: "Pop · R&B", genres: ["pop", "rnb"] },
    { name: "Drake", tag: "Hip-Hop · R&B", genres: ["hiphop", "rnb"] },
    { name: "SZA", tag: "R&B · Soul", genres: ["rnb", "pop"] },
    { name: "Dua Lipa", tag: "Pop · Dance", genres: ["pop", "dance"] },
    { name: "Ed Sheeran", tag: "Pop · Acoustic", genres: ["pop"] },
    { name: "Kendrick Lamar", tag: "Hip-Hop", genres: ["hiphop"] },
    { name: "Post Malone", tag: "Pop · Hip-Hop", genres: ["pop", "hiphop", "rock"] },
    { name: "Linkin Park", tag: "Rock", genres: ["rock", "throwback"] },
    { name: "Lana Del Rey", tag: "Indie · Alternative", genres: ["indie", "pop"] },
    { name: "Sabrina Carpenter", tag: "Pop", genres: ["pop"] },
    { name: "Justin Bieber", tag: "Pop · R&B", genres: ["pop", "rnb"] },
    { name: "Travis Scott", tag: "Hip-Hop", genres: ["hiphop"] },
    { name: "Eminem", tag: "Hip-Hop", genres: ["hiphop", "throwback"] },
    { name: "Calvin Harris", tag: "Dance · EDM", genres: ["dance", "pop"] },
    { name: "Rihanna", tag: "Pop · R&B", genres: ["pop", "rnb", "throwback"] },
  ];

  const ONBOARD_ARTISTS_BY_COUNTRY = {
    IN: [
      { name: "Arijit Singh", tag: "India · Bollywood", genres: ["bollywood", "pop"], local: true },
      { name: "Diljit Dosanjh", tag: "India · Punjabi", genres: ["punjabi", "bollywood", "pop"], local: true },
      { name: "Karan Aujla", tag: "India · Punjabi", genres: ["punjabi", "hiphop"], local: true },
      { name: "Shreya Ghoshal", tag: "India · Melody", genres: ["bollywood", "tamil", "telugu"], local: true },
      { name: "A.R. Rahman", tag: "India · Legend", genres: ["bollywood", "tamil"], local: true },
      { name: "Anuv Jain", tag: "India · Indie", genres: ["indie_in", "indie"], local: true },
      { name: "Pritam", tag: "India · Bollywood", genres: ["bollywood", "pop"], local: true },
      { name: "AP Dhillon", tag: "India · Punjabi", genres: ["punjabi", "hiphop"], local: true },
      { name: "The Local Train", tag: "India · Rock", genres: ["rock", "indie_in"], local: true },
      { name: "Prateek Kuhad", tag: "India · Indie", genres: ["indie_in", "indie"], local: true },
    ],
    PK: [
      { name: "Atif Aslam", tag: "Pakistan · Pop & Rock", genres: ["pak_pop", "pop", "rock"], local: true },
      { name: "Young Stunners", tag: "Pakistan · Hip-Hop", genres: ["urdu_rap", "hiphop"], local: true },
      { name: "Abdul Hannan", tag: "Pakistan · Indie Pop", genres: ["pak_pop", "indie"], local: true },
      { name: "Nusrat Fateh Ali Khan", tag: "Pakistan · Qawwali", genres: ["qawwali"], local: true },
      { name: "Hasan Raheem", tag: "Pakistan · R&B & Indie", genres: ["pak_pop", "rnb", "indie"], local: true },
      { name: "Ali Zafar", tag: "Pakistan · Pop", genres: ["pak_pop", "pop"], local: true },
    ],
    BD: [
      { name: "Arnob", tag: "Bangladesh · Indie", genres: ["bangla_indie", "indie"], local: true },
      { name: "Artcell", tag: "Bangladesh · Rock", genres: ["bangla_rock", "rock"], local: true },
      { name: "Warfaze", tag: "Bangladesh · Rock", genres: ["bangla_rock", "rock"], local: true },
      { name: "Pritom Hasan", tag: "Bangladesh · Pop", genres: ["bangla_pop", "pop"], local: true },
      { name: "Tahsan", tag: "Bangladesh · Pop", genres: ["bangla_pop", "pop"], local: true },
      { name: "Habib Wahid", tag: "Bangladesh · Fusion", genres: ["bangla_pop", "dance"], local: true },
    ],
    PH: [
      { name: "BINI", tag: "Philippines · P-Pop", genres: ["opm_pop", "pop", "dance"], local: true },
      { name: "Ben&Ben", tag: "Philippines · Indie Folk", genres: ["pinoy_indie", "indie", "opm_pop"], local: true },
      { name: "SB19", tag: "Philippines · P-Pop", genres: ["opm_pop", "pop", "dance"], local: true },
      { name: "Zack Tabudlo", tag: "Philippines · OPM & R&B", genres: ["opm_pop", "rnb", "hugot"], local: true },
      { name: "Arthur Nery", tag: "Philippines · R&B", genres: ["pinoy_hiphop", "rnb", "hugot"], local: true },
      { name: "Cup of Joe", tag: "Philippines · Band", genres: ["pinoy_rock", "pinoy_indie", "opm_pop"], local: true },
      { name: "TJ Monterde", tag: "Philippines · Acoustic", genres: ["hugot", "opm_pop"], local: true },
      { name: "Eraserheads", tag: "Philippines · Pinoy Rock", genres: ["pinoy_rock", "rock", "throwback"], local: true },
      { name: "IV of Spades", tag: "Philippines · Alt Rock", genres: ["pinoy_rock", "pinoy_indie", "rock"], local: true },
      { name: "Lola Amour", tag: "Philippines · Indie Rock", genres: ["pinoy_indie", "pinoy_rock"], local: true },
    ],
    HK: [
      { name: "Eason Chan", tag: "Hong Kong · Cantopop", genres: ["cantopop", "pop", "mandopop"], local: true },
      { name: "Hins Cheung", tag: "Hong Kong · Cantopop", genres: ["cantopop", "pop"], local: true },
      { name: "G.E.M.", tag: "Hong Kong · Pop & Rock", genres: ["cantopop", "mandopop", "pop"], local: true },
      { name: "Beyond", tag: "Hong Kong · Rock Legend", genres: ["hk_rock", "rock", "cantopop"], local: true },
      { name: "Dear Jane", tag: "Hong Kong · Pop Rock", genres: ["hk_rock", "rock", "cantopop"], local: true },
      { name: "MIRROR", tag: "Hong Kong · Cantopop", genres: ["cantopop", "pop", "dance"], local: true },
      { name: "Keung To", tag: "Hong Kong · Cantopop", genres: ["cantopop", "pop"], local: true },
      { name: "Terence Lam", tag: "Hong Kong · Indie Pop", genres: ["hk_indie", "cantopop", "indie"], local: true },
      { name: "Gareth.T", tag: "Hong Kong · R&B & Indie", genres: ["hk_indie", "rnb", "cantopop"], local: true },
      { name: "Supper Moment", tag: "Hong Kong · Rock Band", genres: ["hk_rock", "rock"], local: true },
    ],
    CN: [
      { name: "Jay Chou", tag: "Mandopop · Legend", genres: ["mandopop", "pop", "rnb"], local: true },
      { name: "G.E.M.", tag: "Mandopop · Pop", genres: ["mandopop", "pop"], local: true },
      { name: "Xue Zhiqian", tag: "Mandopop · Ballad", genres: ["mandopop", "pop"], local: true },
      { name: "Mao Buyi", tag: "China · Folk & Pop", genres: ["cn_indie", "mandopop"], local: true },
      { name: "Mayday", tag: "Mandopop · Rock Band", genres: ["cn_rock", "rock", "mandopop"], local: true },
      { name: "Wang Leehom", tag: "Mandopop · R&B", genres: ["mandopop", "rnb"], local: true },
    ],
    KR: [
      { name: "BTS", tag: "Korea · K-Pop", genres: ["kpop", "pop"], local: true },
      { name: "BLACKPINK", tag: "Korea · K-Pop", genres: ["kpop", "pop", "dance"], local: true },
      { name: "NewJeans", tag: "Korea · K-Pop", genres: ["kpop", "pop", "rnb"], local: true },
      { name: "IU", tag: "Korea · K-Pop & Indie", genres: ["kpop", "kindie", "pop"], local: true },
      { name: "DAY6", tag: "Korea · K-Rock Band", genres: ["krock", "rock"], local: true },
      { name: "wave to earth", tag: "Korea · K-Indie", genres: ["kindie", "indie", "krock"], local: true },
      { name: "SEVENTEEN", tag: "Korea · K-Pop", genres: ["kpop", "pop"], local: true },
      { name: "aespa", tag: "Korea · K-Pop", genres: ["kpop", "dance"], local: true },
    ],
    JP: [
      { name: "YOASOBI", tag: "Japan · J-Pop", genres: ["jpop", "anime", "pop"], local: true },
      { name: "Fujii Kaze", tag: "Japan · J-Pop & R&B", genres: ["jpop", "citypop", "rnb"], local: true },
      { name: "Kenshi Yonezu", tag: "Japan · J-Pop & Rock", genres: ["jpop", "jrock", "anime"], local: true },
      { name: "Mrs. GREEN APPLE", tag: "Japan · J-Rock", genres: ["jrock", "jpop", "rock"], local: true },
      { name: "King Gnu", tag: "Japan · Alternative Rock", genres: ["jrock", "rock"], local: true },
      { name: "Vaundy", tag: "Japan · J-Indie & Rock", genres: ["citypop", "jrock", "indie"], local: true },
      { name: "Official HIGE DANdism", tag: "Japan · Pop Band", genres: ["jpop", "jrock"], local: true },
      { name: "Ado", tag: "Japan · J-Pop & Anime", genres: ["jpop", "anime"], local: true },
    ],
    TH: [
      { name: "Jeff Satur", tag: "Thailand · T-Pop & R&B", genres: ["tpop", "rnb", "pop"], local: true },
      { name: "Three Man Down", tag: "Thailand · Pop Rock", genres: ["thai_rock", "rock", "tpop"], local: true },
      { name: "Tilly Birds", tag: "Thailand · Alt Rock", genres: ["thai_rock", "thai_indie", "rock"], local: true },
      { name: "Bowkylion", tag: "Thailand · T-Pop", genres: ["tpop", "pop"], local: true },
      { name: "Billkin", tag: "Thailand · T-Pop & Soul", genres: ["tpop", "rnb"], local: true },
      { name: "Bodyslam", tag: "Thailand · Rock Band", genres: ["thai_rock", "rock"], local: true },
    ],
    VN: [
      { name: "Sơn Tùng M-TP", tag: "Vietnam · V-Pop", genres: ["vpop", "pop"], local: true },
      { name: "HIEUTHUHAI", tag: "Vietnam · Rap Việt", genres: ["rap_viet", "hiphop"], local: true },
      { name: "Đen Vâu", tag: "Vietnam · Rap & Indie", genres: ["rap_viet", "viet_indie"], local: true },
      { name: "Vũ.", tag: "Vietnam · Indie Ballad", genres: ["viet_indie", "indie"], local: true },
      { name: "tlinh", tag: "Vietnam · R&B & Rap", genres: ["rap_viet", "rnb", "vpop"], local: true },
      { name: "Chillies", tag: "Vietnam · Indie Rock", genres: ["viet_indie", "rock"], local: true },
    ],
    ID: [
      { name: "Tulus", tag: "Indonesia · Pop & Soul", genres: ["indo_pop", "pop", "rnb"], local: true },
      { name: "Mahalini", tag: "Indonesia · Pop", genres: ["indo_pop", "pop"], local: true },
      { name: "Sheila On 7", tag: "Indonesia · Pop Rock", genres: ["indo_rock", "rock"], local: true },
      { name: "Hindia", tag: "Indonesia · Indie", genres: ["indo_indie", "indie"], local: true },
      { name: "Bernadya", tag: "Indonesia · Indie Pop", genres: ["indo_pop", "indo_indie"], local: true },
      { name: "Dewa 19", tag: "Indonesia · Rock Legend", genres: ["indo_rock", "rock"], local: true },
    ],
    MY: [
      { name: "Siti Nurhaliza", tag: "Malaysia · Pop Legend", genres: ["my_pop", "pop"], local: true },
      { name: "Yuna", tag: "Malaysia · R&B & Indie", genres: ["my_pop", "rnb", "indie"], local: true },
      { name: "Insomniacks", tag: "Malaysia · Pop Rock", genres: ["my_rock", "rock", "my_pop"], local: true },
      { name: "DOLLA", tag: "Malaysia · M-Pop", genres: ["my_pop", "pop", "dance"], local: true },
      { name: "Kugiran Masdo", tag: "Malaysia · Indie Retro", genres: ["my_rock", "indie"], local: true },
    ],
    SG: [
      { name: "JJ Lin", tag: "Singapore · Mandopop", genres: ["mandopop", "sg_pop", "pop"], local: true },
      { name: "Stefanie Sun", tag: "Singapore · Mandopop", genres: ["mandopop", "sg_pop", "pop"], local: true },
      { name: "Gentle Bones", tag: "Singapore · R&B & Pop", genres: ["sg_pop", "rnb", "sg_indie"], local: true },
      { name: "Linying", tag: "Singapore · Indie", genres: ["sg_indie", "indie"], local: true },
    ],
    NG: [
      { name: "Burna Boy", tag: "Nigeria · Afrobeats", genres: ["afrobeats", "pop"], local: true },
      { name: "Wizkid", tag: "Nigeria · Afrobeats", genres: ["afrobeats", "rnb"], local: true },
      { name: "Rema", tag: "Nigeria · Afrorave", genres: ["afrobeats", "pop"], local: true },
      { name: "Tems", tag: "Nigeria · R&B & Soul", genres: ["afro_alte", "rnb", "afrobeats"], local: true },
      { name: "Asake", tag: "Nigeria · Afrobeats", genres: ["afrobeats", "amapiano"], local: true },
      { name: "Ayra Starr", tag: "Nigeria · Afropop", genres: ["afrobeats", "pop"], local: true },
    ],
    ZA: [
      { name: "Tyla", tag: "South Africa · Popiano", genres: ["amapiano", "pop", "rnb"], local: true },
      { name: "Kabza De Small", tag: "South Africa · Amapiano", genres: ["amapiano", "za_house"], local: true },
      { name: "Black Coffee", tag: "South Africa · Afro House", genres: ["za_house", "dance"], local: true },
      { name: "Nasty C", tag: "South Africa · Hip-Hop", genres: ["hiphop"], local: true },
    ],
    BR: [
      { name: "Anitta", tag: "Brazil · Pop & Funk", genres: ["br_pop", "pop", "dance"], local: true },
      { name: "Ludmilla", tag: "Brazil · Pagode & Pop", genres: ["br_pop", "sertanejo"], local: true },
      { name: "Alok", tag: "Brazil · Dance & EDM", genres: ["dance", "br_pop"], local: true },
      { name: "Henrique & Juliano", tag: "Brazil · Sertanejo", genres: ["sertanejo"], local: true },
      { name: "Charlie Brown Jr.", tag: "Brazil · Rock", genres: ["br_rock", "rock"], local: true },
    ],
    MX: [
      { name: "Peso Pluma", tag: "Mexico · Regional", genres: ["mex_reg", "reggaeton"], local: true },
      { name: "Natalia Lafourcade", tag: "Mexico · Folk & Indie", genres: ["rock_esp", "indie"], local: true },
      { name: "Zoé", tag: "Mexico · Indie Rock", genres: ["rock_esp", "rock", "indie"], local: true },
      { name: "Kevin Kaarl", tag: "Mexico · Indie Folk", genres: ["rock_esp", "indie"], local: true },
      { name: "Maná", tag: "Mexico · Rock en Español", genres: ["rock_esp", "rock"], local: true },
    ],
    ES: [
      { name: "Rosalía", tag: "Spain · Pop & Urbano", genres: ["es_pop", "reggaeton", "pop"], local: true },
      { name: "Quevedo", tag: "Spain · Urbano", genres: ["reggaeton", "hiphop"], local: true },
      { name: "Aitana", tag: "Spain · Pop", genres: ["es_pop", "pop"], local: true },
      { name: "Vetusta Morla", tag: "Spain · Indie Rock", genres: ["es_indie", "rock", "indie"], local: true },
    ],
    AE: [
      { name: "Amr Diab", tag: "Arabic Pop", genres: ["arabic_pop", "pop"], local: true },
      { name: "Nancy Ajram", tag: "Arabic Pop", genres: ["arabic_pop", "pop"], local: true },
      { name: "Cairokee", tag: "Arabic Rock & Indie", genres: ["arabic_indie", "rock"], local: true },
      { name: "Abdul Majeed Abdullah", tag: "Khaleeji", genres: ["khaleeji"], local: true },
    ],
    SA: [
      { name: "Abdul Majeed Abdullah", tag: "Saudi · Khaleeji", genres: ["khaleeji", "arabic_pop"], local: true },
      { name: "Assala", tag: "Arabic & Khaleeji", genres: ["khaleeji", "arabic_pop"], local: true },
      { name: "Majid Al Mohandis", tag: "Khaleeji Pop", genres: ["khaleeji", "arabic_pop"], local: true },
    ],
    EG: [
      { name: "Amr Diab", tag: "Egypt · Pop Legend", genres: ["egypt_pop", "pop"], local: true },
      { name: "Wegz", tag: "Egypt · Rap & Trap", genres: ["mahraganat", "hiphop"], local: true },
      { name: "Cairokee", tag: "Egypt · Rock Band", genres: ["egypt_indie", "rock"], local: true },
      { name: "Tamer Hosny", tag: "Egypt · Pop", genres: ["egypt_pop", "pop"], local: true },
    ],
    TR: [
      { name: "Tarkan", tag: "Turkey · Pop", genres: ["tr_pop", "pop"], local: true },
      { name: "Sezen Aksu", tag: "Turkey · Legend", genres: ["tr_pop", "pop"], local: true },
      { name: "Duman", tag: "Turkey · Rock Band", genres: ["tr_rock", "rock"], local: true },
      { name: "Mabel Matiz", tag: "Turkey · Alt Pop", genres: ["tr_pop", "tr_rock"], local: true },
      { name: "Ezhel", tag: "Turkey · Rap", genres: ["tr_rap", "hiphop"], local: true },
    ],
    DE: [
      { name: "Apache 207", tag: "Germany · Rap & Pop", genres: ["deutschrap", "de_pop"], local: true },
      { name: "Nina Chuba", tag: "Germany · Pop", genres: ["de_pop", "pop"], local: true },
      { name: "Rammstein", tag: "Germany · Rock", genres: ["de_indie", "rock"], local: true },
      { name: "Milky Chance", tag: "Germany · Indie", genres: ["de_indie", "indie"], local: true },
      { name: "Robin Schulz", tag: "Germany · Dance", genres: ["dance", "de_pop"], local: true },
    ],
    FR: [
      { name: "Stromae", tag: "Pop & Chanson", genres: ["fr_pop", "pop", "dance"], local: true },
      { name: "Aya Nakamura", tag: "France · Pop & R&B", genres: ["fr_pop", "rnb"], local: true },
      { name: "Daft Punk", tag: "France · Electronic", genres: ["french_touch", "dance"], local: true },
      { name: "Ninho", tag: "France · Rap", genres: ["fr_rap", "hiphop"], local: true },
      { name: "Phoenix", tag: "France · Indie Rock", genres: ["french_touch", "indie", "rock"], local: true },
    ],
    IT: [
      { name: "Måneskin", tag: "Italy · Rock Band", genres: ["it_indie", "rock"], local: true },
      { name: "Annalisa", tag: "Italy · Pop", genres: ["it_pop", "pop"], local: true },
      { name: "Mahmood", tag: "Italy · Pop & R&B", genres: ["it_pop", "rnb"], local: true },
      { name: "Geolier", tag: "Italy · Rap", genres: ["it_rap", "hiphop"], local: true },
    ],
    GB: [
      { name: "Ed Sheeran", tag: "UK · Pop", genres: ["uk_pop", "pop"], local: true },
      { name: "Dua Lipa", tag: "UK · Pop & Dance", genres: ["uk_pop", "pop", "dance"], local: true },
      { name: "Coldplay", tag: "UK · Rock & Pop", genres: ["rock", "pop", "uk_indie"], local: true },
      { name: "Arctic Monkeys", tag: "UK · Indie Rock", genres: ["uk_indie", "rock", "indie"], local: true },
      { name: "Central Cee", tag: "UK · Drill & Rap", genres: ["uk_drill", "hiphop"], local: true },
      { name: "RAYE", tag: "UK · R&B & Pop", genres: ["uk_pop", "rnb", "pop"], local: true },
      { name: "Fred again..", tag: "UK · Electronic", genres: ["uk_house", "dance"], local: true },
      { name: "Sam Fender", tag: "UK · Indie Rock", genres: ["uk_indie", "rock"], local: true },
      { name: "Dave", tag: "UK · Rap", genres: ["uk_drill", "hiphop"], local: true },
      { name: "The 1975", tag: "UK · Alt Pop", genres: ["uk_indie", "indie", "pop"], local: true },
    ],
    US: [
      { name: "Taylor Swift", tag: "US · Pop", genres: ["us_billboard", "pop"], local: true },
      { name: "Kendrick Lamar", tag: "US · Hip-Hop", genres: ["us_hiphop", "hiphop"], local: true },
      { name: "Billie Eilish", tag: "US · Alt Pop", genres: ["us_billboard", "pop", "indie"], local: true },
      { name: "SZA", tag: "US · R&B", genres: ["rnb", "us_billboard", "pop"], local: true },
      { name: "Morgan Wallen", tag: "US · Country", genres: ["country", "pop"], local: true },
      { name: "Sabrina Carpenter", tag: "US · Pop", genres: ["us_billboard", "pop"], local: true },
      { name: "Post Malone", tag: "US · Pop & Country", genres: ["country", "us_billboard", "pop"], local: true },
      { name: "Travis Scott", tag: "US · Hip-Hop", genres: ["us_hiphop", "hiphop"], local: true },
      { name: "Zach Bryan", tag: "US · Country & Folk", genres: ["country", "indie"], local: true },
      { name: "Bruno Mars", tag: "US · Pop & R&B", genres: ["us_billboard", "pop", "rnb"], local: true },
    ],
    AU: [
      { name: "Tame Impala", tag: "Australia · Psych Indie", genres: ["au_indie", "indie", "rock"], local: true },
      { name: "The Kid LAROI", tag: "Australia · Pop & Rap", genres: ["au_pop", "pop", "hiphop"], local: true },
      { name: "Troye Sivan", tag: "Australia · Pop & Dance", genres: ["au_pop", "pop", "dance"], local: true },
      { name: "RÜFÜS DU SOL", tag: "Australia · Electronic", genres: ["au_dance", "dance", "indie"], local: true },
      { name: "Spacey Jane", tag: "Australia · Indie Rock", genres: ["au_indie", "indie", "rock"], local: true },
      { name: "Dom Dolla", tag: "Australia · House", genres: ["au_dance", "dance"], local: true },
      { name: "Sia", tag: "Australia · Pop", genres: ["au_pop", "pop"], local: true },
      { name: "Flume", tag: "Australia · Electronic", genres: ["au_dance", "dance"], local: true },
    ],
    NZ: [
      { name: "Lorde", tag: "New Zealand · Indie Pop", genres: ["nz_pop", "indie", "pop"], local: true },
      { name: "SIX60", tag: "New Zealand · Pop & Roots", genres: ["nz_pop", "nz_rnb", "pop"], local: true },
      { name: "BENEE", tag: "New Zealand · Alt Pop", genres: ["nz_pop", "indie", "pop"], local: true },
      { name: "L.A.B", tag: "New Zealand · Roots & Soul", genres: ["nz_rnb", "nz_pop", "rnb"], local: true },
      { name: "The Beths", tag: "New Zealand · Indie Rock", genres: ["nz_indie", "indie", "rock"], local: true },
      { name: "Crowded House", tag: "New Zealand · Rock Legend", genres: ["nz_indie", "rock"], local: true },
      { name: "Stan Walker", tag: "New Zealand · R&B & Pop", genres: ["nz_rnb", "rnb", "pop"], local: true },
    ],
    CA: [
      { name: "The Weeknd", tag: "Canada · Pop & R&B", genres: ["ca_pop", "pop", "rnb"], local: true },
      { name: "Drake", tag: "Canada · Hip-Hop", genres: ["hiphop", "rnb"], local: true },
      { name: "Justin Bieber", tag: "Canada · Pop", genres: ["ca_pop", "pop", "rnb"], local: true },
      { name: "Tate McRae", tag: "Canada · Pop", genres: ["ca_pop", "pop", "dance"], local: true },
      { name: "Shawn Mendes", tag: "Canada · Pop", genres: ["ca_pop", "pop"], local: true },
      { name: "Charlotte Cardin", tag: "Canada · Indie & Franco-Pop", genres: ["franco_ca", "ca_pop", "indie"], local: true },
      { name: "Daniel Caesar", tag: "Canada · R&B", genres: ["ca_pop", "rnb"], local: true },
      { name: "Arcade Fire", tag: "Canada · Indie Rock", genres: ["ca_indie", "indie", "rock"], local: true },
    ],
    NL: [
      { name: "Martin Garrix", tag: "Netherlands · EDM", genres: ["nl_edm", "dance", "pop"], local: true },
      { name: "Tiësto", tag: "Netherlands · Dance", genres: ["nl_edm", "dance"], local: true },
      { name: "Roxy Dekker", tag: "Netherlands · Nederpop", genres: ["nl_pop", "pop"], local: true },
      { name: "Suzan & Freek", tag: "Netherlands · Nederpop", genres: ["nl_pop", "pop"], local: true },
      { name: "Flemming", tag: "Netherlands · Pop", genres: ["nl_pop", "pop"], local: true },
      { name: "Frenna", tag: "Netherlands · Nederhop", genres: ["nederhop", "hiphop"], local: true },
      { name: "Armin van Buuren", tag: "Netherlands · Trance & EDM", genres: ["nl_edm", "dance"], local: true },
      { name: "Son Mieux", tag: "Netherlands · Indie Pop", genres: ["nl_indie", "indie", "pop"], local: true },
    ],
    SE: [
      { name: "Zara Larsson", tag: "Sweden · Pop", genres: ["se_pop", "pop", "dance"], local: true },
      { name: "Avicii", tag: "Sweden · Dance Legend", genres: ["se_house", "dance", "pop"], local: true },
      { name: "Swedish House Mafia", tag: "Sweden · Electronic", genres: ["se_house", "dance"], local: true },
      { name: "Benjamin Ingrosso", tag: "Sweden · Pop", genres: ["se_pop", "pop"], local: true },
      { name: "Tove Lo", tag: "Sweden · Alt Pop", genres: ["se_pop", "pop", "indie"], local: true },
      { name: "Hov1", tag: "Sweden · Hip-Hop & Pop", genres: ["se_hiphop", "se_pop", "hiphop"], local: true },
      { name: "Robyn", tag: "Sweden · Electro Pop", genres: ["se_pop", "dance", "pop"], local: true },
      { name: "The Hives", tag: "Sweden · Garage Rock", genres: ["se_indie", "rock"], local: true },
    ],
  };

  function getOnboardArtistsForCountry(countryCode) {
    const code = String(countryCode || (state.prefs && state.prefs.country) || "US").toUpperCase();
    const localArtists = ONBOARD_ARTISTS_BY_COUNTRY[code] || [];
    const seen = new Set();
    const out = [];
    for (const a of [...localArtists, ...ONBOARD_GLOBAL_ARTISTS]) {
      if (!a || !a.name) continue;
      const k = a.name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(a);
    }
    return out;
  }

  function tasteProfile() {
    const pool = [...(state.recents || []), ...(state.liked || [])];
    const artists = {};
    const sources = {};
    const genres = {};

    // Seed from onboarding & followed artists so homepage personalization works immediately
    const prefGenres = Array.isArray(state.prefs.tasteGenres) ? state.prefs.tasteGenres : [];
    const prefMoods = Array.isArray(state.prefs.tasteMoods) ? state.prefs.tasteMoods : [];
    const prefEras = Array.isArray(state.prefs.tasteEras) ? state.prefs.tasteEras : [];
    const prefStyles = Array.isArray(state.prefs.tasteStyles) ? state.prefs.tasteStyles : [];
    const prefArtists = Array.isArray(state.prefs.tasteArtists) ? state.prefs.tasteArtists : [];

    for (const gId of prefGenres) {
      const gObj = findOnboardGenreById(gId);
      const label = gObj ? gObj.title : String(gId || "");
      if (label) genres[label] = (genres[label] || 0) + 4;
      if (gId) genres[gId] = (genres[gId] || 0) + 4;
    }
    for (const mId of prefMoods) {
      const mObj = ONBOARD_MOODS.find((x) => x.id === mId);
      const label = mObj ? mObj.title : String(mId || "");
      if (label) genres[label] = (genres[label] || 0) + 3;
      if (mId) genres[mId] = (genres[mId] || 0) + 3;
    }
    for (const eId of prefEras) {
      const eObj = ONBOARD_ERAS.find((x) => x.id === eId);
      if (eObj && eObj.title) genres[eObj.title] = (genres[eObj.title] || 0) + 2;
    }
    for (const aName of prefArtists) {
      const clean = String(aName || "").trim();
      if (clean) artists[clean] = (artists[clean] || 0) + 4;
    }
    for (const f of (state.following || [])) {
      if (f && f.name) artists[f.name] = (artists[f.name] || 0) + 5;
    }

    for (const t of pool) {
      if (!t) continue;
      const a = artistName(t);
      if (a && a !== "YouTube" && a !== "Live radio") artists[a] = (artists[a] || 0) + 1;
      sources[t.source || "other"] = (sources[t.source || "other"] || 0) + 1;
      const tag = String(t._tag || t.mood || t.genre || (t.album && t.source === "audius" ? t.album : "") || "").toLowerCase();
      if (tag) {
        genres[tag] = (genres[tag] || 0) + 1;
      } else {
        const v = inferTrackVibeClient(t);
        if (v && v.genre) genres[v.genre] = (genres[v.genre] || 0) + 1;
        if (v && v.mood) genres[v.mood] = (genres[v.mood] || 0) + 1;
      }
    }
    const rank = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
    const hasTaste = Boolean(
      state.recents.length ||
      state.liked.length ||
      state.following.length ||
      prefGenres.length ||
      prefMoods.length ||
      prefEras.length ||
      prefStyles.length ||
      prefArtists.length
    );
    return {
      plays: state.recents.length,
      liked: state.liked.length,
      following: state.following.length,
      hasTaste,
      artists: rank(artists).slice(0, 10),
      genres: rank(genres).slice(0, 8),
      sources: rank(sources),
    };
  }

  function personalizeMoods(base) {
    const list = (base || []).slice();
    const taste = tasteProfile();
    const hour = new Date().getHours();
    const palette = ["#ff4d6d", "#c77dff", "#4cc9f0", "#ffb703", "#80ed99", "#f72585"];
    const extra = [];
    taste.artists.slice(0, 3).forEach(([name], i) => {
      const short = name.split(" ")[0];
      extra.push({
        id: `taste-${i}`,
        title: `More ${short}`,
        query: `${name} songs official audio`,
        color: palette[i % palette.length],
        tags: name.toLowerCase(),
        personal: true,
      });
    });
    taste.genres.slice(0, 2).forEach(([g], i) => {
      extra.push({
        id: `genre-${i}`,
        title: g,
        query: `${g} songs official audio`,
        color: palette[(i + 3) % palette.length],
        tags: g.toLowerCase(),
        personal: true,
      });
    });
    if (hour >= 22 || hour < 6) {
      extra.unshift({
        id: "late",
        title: "Still up?",
        query: "late night lofi chill songs",
        color: "#4361ee",
        tags: "lofi chill night",
        personal: true,
      });
    } else if (hour < 11) {
      extra.unshift({
        id: "morning",
        title: "Morning mix",
        query: "morning feel good songs official",
        color: "#f4a261",
        tags: "pop morning",
        personal: true,
      });
    }
    const blob = [
      ...taste.artists.map((x) => x[0]),
      ...taste.genres.map((x) => x[0]),
    ].join(" ").toLowerCase();
    const scored = list.map((m) => {
      const hay = `${m.title} ${m.query} ${m.tags || ""}`.toLowerCase();
      let score = 0;
      for (const [name, n] of taste.artists) {
        const w = name.toLowerCase().split(" ")[0];
        if (w.length > 2 && hay.includes(w)) score += n * 4;
      }
      for (const [g, n] of taste.genres) {
        if (hay.includes(String(g).toLowerCase())) score += n * 5;
      }
      if (/punjabi|sidhu|diljit/.test(blob) && /punjabi/.test(hay)) score += 12;
      if (/arijit|bollywood|hindi/.test(blob) && /bollywood|hindi|arijit/.test(hay)) score += 12;
      if (/kpop|bts|blackpink/.test(blob) && /kpop/.test(hay)) score += 12;
      if (/lofi|chill/.test(blob) && /lofi/.test(hay)) score += 8;
      if ((hour >= 22 || hour < 6) && /lofi|love|romance|night/.test(hay)) score += 6;
      if (hour >= 6 && hour < 11 && /pop|morning|feel/.test(hay)) score += 4;
      return Object.assign({}, m, { score });
    });
    scored.sort((a, b) => (b.score || 0) - (a.score || 0));
    const seen = new Set();
    const out = [];
    for (const m of extra.concat(scored)) {
      const key = (m.title || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(m);
      if (out.length >= 10) break;
    }
    return out;
  }

  function playNext(track) {
    if (!track) return;
    if (!state.queue.length || state.index < 0) {
      playFromList([track], 0);
      toast("Playing now", true, "success");
      return;
    }
    const cur = current();
    if (cur && isSameSongClient(cur, track)) {
      toast("Already playing this song");
      return;
    }
    const rest = state.queue.filter((t, i) => i !== state.index && !isSameSongClient(t, track));
    state.queue = [cur, track, ...rest].filter(Boolean);
    state.index = 0;
    renderQueue();
    toast("Queued to play next", true, "success");
  }
  function addToQueue(track) {
    if (!track) return;
    if (!state.queue.length || state.index < 0) {
      playFromList([track], 0);
      return;
    }
    if (state.queue.some((t) => isSameSongClient(t, track))) {
      toast("Already in queue");
      return;
    }
    state.queue.push(track);
    renderQueue();
    toast("Added to queue", true, "success");
  }
  function removeQueued(i) {
    if (i === state.index) return;
    state.queue.splice(i, 1);
    if (i < state.index) state.index -= 1;
    renderQueue();
  }
  function clearUpcoming() {
    const cur = current();
    if (!cur) { state.queue = []; state.index = -1; renderQueue(); return; }
    state.queue = [cur];
    state.index = 0;
    renderQueue();
    toast("Upcoming cleared", true, "success");
  }
  function moveQueue(from, to) {
    if (from === to || from < 0 || to < 0 || from >= state.queue.length || to >= state.queue.length) return;
    const curId = current() && current().id;
    const [row] = state.queue.splice(from, 1);
    state.queue.splice(to, 0, row);
    if (curId) {
      const ni = state.queue.findIndex((t) => t.id === curId);
      if (ni >= 0) state.index = ni;
    }
    renderQueue();
  }

  function sourceBadge(src) {
    if (src === "youtube") return `<span class="badge yt">YouTube</span>`;
    if (src === "audius") return `<span class="badge au">Audius</span>`;
    if (src === "download") return `<span class="badge au">Saved</span>`;
    if (src === "preview") return `<span class="badge rd">Sample</span>`;
    if (src === "itunes" || src === "apple") return `<span class="badge au">iTunes</span>`;
    if (src === "deezer") return `<span class="badge au">Deezer</span>`;
    if (src === "radio") return `<span class="badge rd">Radio</span>`;
    return `<span class="badge rd">Radio</span>`;
  }

  const IDB_NAME = "aura";
  const IDB_STORE = "downloads";
  const API_STORE = "api";
  function openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
        if (!req.result.objectStoreNames.contains(API_STORE)) req.result.createObjectStore(API_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  // ── Client-side API response cache ────────────────────────────────────
  // GET /api responses are stored in IndexedDB so a playlist/search/home/
  // artist the user already opened loads INSTANTLY next time (no network
  // wait). Only used when the browser/WKWebView has IndexedDB; never blocks
  // the network fetch — a cache miss falls straight through to the API.
  const API_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 h (anything longer risks stale)
  // Bump this when the backend SHAPE of a cached GET changes (e.g. "Made for
  // you" went from 6 to 10 playlists). The cache key is namespaced with it, so
  // a stale IndexedDB/payload from the previous deployment (which is exactly
  // why some users kept seeing the OLD 6 playlists) is ignored and re-fetched.
  const API_CACHE_V = "v12-sync-167";
  // Never cache an "empty" catalog payload. If a provider is temporarily
  // unreachable the worker may return `{tracks: [], ...}` (or shelves with no
  // tracks); caching that would freeze the shelf empty for the whole TTL.
  // A miss just re-fetches — the safe direction.
  function apiCacheIsUsable(data) {
    if (!data || typeof data !== "object") return false;
    if ("lyrics" in data && !data.lyrics && (!Array.isArray(data.synced) || !data.synced.length)) return false;
    let s = "";
    try { s = JSON.stringify(data); } catch { return false; }
    if (s.length < 40) return false; // trivial/empty object
    if (Array.isArray(data.tracks) && data.tracks.length === 0) return false;
    if (Array.isArray(data.songs) && data.songs.length === 0) return false;
    if (Array.isArray(data.albums) && data.albums.length === 0) return false;
    if (Array.isArray(data.youtube) && data.youtube.length === 0) return false;
    if (Array.isArray(data.countryPlaylists) && data.countryPlaylists.length < 6) return false;
    if (Array.isArray(data.youtubeLocal) && data.youtubeLocal.length < 5) return false;
    if (Array.isArray(data.apple) && data.apple.length === 0) return false;
    if (Array.isArray(data.deezer) && data.deezer.length === 0) return false;
    if (Array.isArray(data.itunes) && data.itunes.length === 0) return false;
    if (Array.isArray(data.shelves)) {
      if (data.shelves.length === 0) return false;
      // A home payload whose every shelf is empty adds nothing.
      const anyTracks = data.shelves.some((sh) => sh && Array.isArray(sh.tracks) && sh.tracks.length);
      if (!anyTracks) return false;
    }
    return true;
  }
  async function apiCacheGet(key) {
    try {
      const db = await openIdb();
      return await new Promise((resolve) => {
        const req = db.transaction(API_STORE, "readonly").objectStore(API_STORE).get(key);
        req.onsuccess = () => {
          const rec = req.result;
          if (!rec || typeof rec.at !== "number") return resolve(null);
          resolve(Date.now() - rec.at < API_CACHE_TTL ? rec.value : null);
        };
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  }
  async function apiCachePut(key, value) {
    try {
      const db = await openIdb();
      await new Promise((resolve) => {
        const tx = db.transaction(API_STORE, "readwrite");
        tx.objectStore(API_STORE).put({ at: Date.now(), value }, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch { /* cache is best-effort */ }
  }
  async function idbPut(key, val) {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGet(key) {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbDel(key) {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbClear() {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getOfflineAudioBlob(t) {
    if (!t) return null;
    const saved = findSavedTrack(t);
    const candidateKeys = [
      t.id,
      trackKey(t),
      t.videoId ? `yt:${t.videoId}` : "",
      t.videoId || "",
      t.trackId ? `audius:${t.trackId}` : "",
      t.trackId || "",
      saved ? saved.id : "",
      saved ? trackKey(saved) : "",
      saved && saved.videoId ? `yt:${saved.videoId}` : "",
      saved && saved.videoId ? saved.videoId : "",
      saved && saved.trackId ? `audius:${saved.trackId}` : "",
      saved && saved.trackId ? saved.trackId : "",
    ].filter(Boolean);

    for (const k of candidateKeys) {
      try {
        const item = await idbGet(k);
        if (!item) continue;
        if (item instanceof Blob) return item;
        if (item && item.blob instanceof Blob) return item.blob;
        if (item && item.handle && typeof item.handle.getFile === "function") {
          try {
            const f = await item.handle.getFile();
            if (f) return f;
          } catch {}
        }
        if (item && item.data && (item.data instanceof ArrayBuffer || item.data instanceof Uint8Array)) {
          return new Blob([item.data], { type: item.mime || "audio/mp4" });
        }
      } catch {}
    }
    return null;
  }

  /* ── Real offline downloads (user-visible files on disk) ─────────────
     Native shells ship a MuchiDownload plugin that writes a real, tagged
     audio file to disk (Android MediaStore.Audio, iOS Documents). On the
     web we use the File System Access API where available and fall back to
     a blob + anchor download. Either way the file lands on disk with its
     ID3/MP4 metadata embedded, and the app keeps a file handle / local URI
     so it can be replayed offline. Downloads run through a queue with live
     progress + cancel. */
  function nativeDownloader() {
    if (IS_NATIVE && window.Capacitor && window.Capacitor.Plugins) {
      const p = window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : "";
      if (p === "android" || p === "ios") return window.Capacitor.Plugins.MuchiDownload || null;
    }
    return null;
  }
  // Item 7 — ask for storage permission when saving a song. Android 10+ writes
  // through scoped MediaStore (no permission needed); Android 9 and below needs
  // the legacy WRITE_EXTERNAL_STORAGE. The plugin declares the permission; this
  // one-time request surfaces the OS dialog at the first save, mirroring the
  // notification-permission pattern. Never blocks the save.
  let dlPermAsked = false;
  function nativeEnsureStoragePermission() {
    const ND = nativeDownloader();
    if (!ND) return;
    if (typeof ND.ensureStoragePermission === "function") {
      ND.ensureStoragePermission().catch(() => {});
      return;
    }
    if (typeof ND.checkPermissions === "function") {
      ND.checkPermissions()
        .then((st) => {
          if (!st || (st.storage !== "granted" && st.media_audio !== "granted")) {
            if (typeof ND.requestPermissions === "function") {
              ND.requestPermissions({ permissions: ["media_audio", "storage"] }).catch(() => {
                ND.requestPermissions().catch(() => {});
              });
            }
          }
        })
        .catch(() => {
          if (typeof ND.requestPermissions === "function") {
            ND.requestPermissions().catch(() => {});
          }
        });
    } else if (typeof ND.requestPermissions === "function") {
      ND.requestPermissions().catch(() => {});
    }
  }

  function webEnsurePermissions() {
    try {
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
      if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {});
      }
    } catch {}
  }
  /* Item 9 — POST_NOTIFICATIONS (Android 13+). The media/background-play
     foreground service runs WITHOUT a runtime permission and playback keeps
     going, but on Android 13+ the media notification + lock-screen controls
     only appear in the drawer if the user grants POST_NOTIFICATIONS. Spotify /
     YT Music ask once, at the first play. The app never asked at play time (it
     only asked when following an artist), so users saw "no permission prompt"
     and no working notification. Ask once, on Android, at first play / first
     save. Safe: if the user denies, playback still works — it just falls back
     to the FGS Task Manager as the OS documents. */
  // (v1.5.4) nativeEnsureNotificationPermission removed: the WebView
  // Notification.requestPermission() prompt does NOT grant the native
  // POST_NOTIFICATIONS permission on Android (different API surface) — it
  // only produced a second, useless dialog on top of the real one asked by
  // MuchiAudioPlugin (nativeEnsureNotifyPermission → plugin check/request,
  // at first play). The native plugin path is the single source.
  function sanitizeName(s) {
    return String(s || "track").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "track";
  }
  function extFromMime(t) {
    const src = String((t && t.streamMime) || "").toLowerCase();
    const u = String((t && t.streamUrl) || "");
    if (/mp3|mpeg/.test(src) || /\.mp3($|\?)/.test(u)) return "mp3";
    if (/flac/.test(src) || /\.flac($|\?)/.test(u)) return "flac";
    if (/m4a|mp4|aac|audio\/mp4/.test(src) || /\.m4a($|\?)/.test(u)) return "m4a";
    // Use the resolved container's own hint when available (e.g. a Piped
    // m4a stream resolves with a bare "audio/mp4"), otherwise fall back to
    // opus/webm which is what an unresolved/unknown YouTube stream really is.
    if (/opus|webm|ogg|vorbis/.test(src)) return "webm";
    if (/mp4|m4a/.test(src)) return "m4a";
    return "webm";
  }
  // Map an HTTP Content-Type to the RIGHT extension, so the saved filename and
  // the File System Access API accept-list agree with the actual bytes (the
  // native plugin does the same via extensionFor(realMime)). Without this the
  // client guessed ".webm" from an unresolved stream while the server returned
  // audio/mp4 — the mismatch made showSaveFilePicker throw and downloads show
  // an ugly ".webm" name. Mirrors server extFor().
  function extFromContentType(ctype) {
    const m = String(ctype || "").toLowerCase();
    if (/webm|ogg|opus|vorbis/.test(m)) return "webm";
    if (/mpeg|mp3/.test(m)) return "mp3";
    if (/flac/.test(m)) return "flac";
    return "m4a";
  }
  function slimTrack(t) {
    const dur = Math.round(Number(t.duration) || parseStreamUrlDuration(t.streamUrl || t.url || "") || 0);
    const s = { id: t.id, title: t.title, artist: t.artist, source: t.source, duration: dur };
    if (t.videoId) s.videoId = t.videoId;
    if (t.trackId) s.trackId = t.trackId;
    if (t.album) s.album = t.album;
    if (t.genre) s.genre = t.genre;
    if (t.artwork) s.artwork = t.artwork;
    if (t.lyrics) s.lyrics = t.lyrics;
    if (Array.isArray(t.synced) && t.synced.length) s.synced = t.synced;
    if (t.lrc) s.lrc = t.lrc;
    return s;
  }
  function isPreviewOrPlaceholderStream(u, t) {
    const s = String(u || "").trim();
    if (!s) return true;
    if (/^yt:/i.test(s)) return true;
    if (t && t._isPreviewStream) return true;
    if (/\/api\/preview\/audio|dzcdn\.net|mzstatic\.com|itunes\.apple\.com|allowPreview=1/i.test(s)) return true;
    return false;
  }

  async function ensureStreamForDownload(t) {
    if (!t) return t;
    const out = { ...t };
    if (isPreviewOrPlaceholderStream(out.streamUrl, out)) {
      if (!out.videoId && /^yt:([a-zA-Z0-9_-]{6,20})$/i.test(String(out.streamUrl || "").trim())) {
        out.videoId = String(out.streamUrl).trim().slice(3);
      }
      out.streamUrl = "";
      out._isPreviewStream = false;
    }
    // Audius: resolve active stream url if missing or unverified
    if (out.source === "audius" && out.trackId) {
      out.streamMime = "audio/mpeg";
      if (!out.streamUrl || out.streamUrl.includes("open-audio-validator") || out.streamUrl.includes("audius.co/v1/tracks")) {
        out.streamUrl = `${API_BASE}/api/audius/file/${encodeURIComponent(out.trackId)}`;
      }
      return out;
    }
    // Apple / iTunes / Deezer / unresolved catalog tracks: resolve via YouTube search first
    if (!out.videoId && !out.streamUrl && out.source !== "audius" && out.source !== "radio") {
      try {
        await resolveYouTubePlay(out);
        if (isPreviewOrPlaceholderStream(out.streamUrl, out)) {
          out.streamUrl = "";
          out._isPreviewStream = false;
        }
      } catch {}
    }
    // Already resolved to a full, real stream (played / audius / radio): keep it.
    if (out.streamUrl && !isPreviewOrPlaceholderStream(out.streamUrl, out)) return out;
    // YouTube: on Web, resolve via /api/yt/stream with allowPreview=0.
    // On Native (Android/iOS), MuchiDownloadPlugin resolves directly on-device via residential IP.
    if (out.videoId && !IS_NATIVE) {
      try {
        const cands = Array.isArray(out._ytCandidates) && out._ytCandidates.length
          ? `&candidates=${encodeURIComponent(out._ytCandidates.slice(0, 5).join(","))}`
          : "";
        const d = await api(
          `/api/yt/stream?v=${encodeURIComponent(out.videoId)}&title=${encodeURIComponent(out.title || "")}&artist=${encodeURIComponent(out.artist || "")}${cands}&allowPreview=0`,
          20000
        );
        if (d && d.url && !d.isPreview && !isPreviewOrPlaceholderStream(d.url, out)) {
          out.streamUrl = d.url;
          if (d.videoId) out.videoId = d.videoId;
          if (d.mimeType) out.streamMime = d.mimeType;
          if (d.duration) out.duration = Number(d.duration) || out.duration;
        }
      } catch { /* fall through — downloadFilePath will try the proxy path */ }
    }
    return out;
  }

  function isSameOriginStreamUrl(sid) {
    if (!sid) return false;
    if (API_BASE) {
      try {
        return new URL(API_BASE, window.location.origin).origin === window.location.origin;
      } catch {
        return false;
      }
    }
    if (sid.startsWith("/")) return true; // relative → same origin
    try {
      return new URL(sid, window.location.origin).origin === window.location.origin;
    } catch {
      return false;
    }
  }
  function downloadFilePath(t) {
    const rawSid = String((t && t.streamUrl) || "");
    let sid = isPreviewOrPlaceholderStream(rawSid, t) ? "" : rawSid;
    if (sid && t && t.videoId) {
      try {
        const decSid = decodeURIComponent(sid);
        if (/[?&]c=(?:ANDROID|IOS)(?:&|$)/i.test(decSid) && /[?&]svpuc=1/i.test(decSid)) {
          sid = "";
        }
      } catch {}
    }
    const nm = encodeURIComponent(t.title || "track");
    const titleParam = t && t.title ? `&title=${encodeURIComponent(t.title)}` : "";
    const artistParam = t && t.artist ? `&artist=${encodeURIComponent(t.artist)}` : "";
    const candParam = t && Array.isArray(t._ytCandidates) && t._ytCandidates.length
      ? `&candidates=${encodeURIComponent(t._ytCandidates.slice(0, 5).join(","))}`
      : "";
    if (t && t.videoId) {
      return `${API_BASE}/api/download?videoId=${encodeURIComponent(t.videoId)}&name=${nm}${titleParam}${artistParam}${candParam}${sid ? `&streamUrl=${encodeURIComponent(sid)}` : ""}&mime=${encodeURIComponent(t.streamMime || "audio/mp4")}`;
    }
    if (t && t.source === "audius" && t.trackId) {
      return `${API_BASE}/api/download?trackId=${encodeURIComponent(t.trackId)}&name=${nm}${titleParam}${artistParam}${sid ? `&streamUrl=${encodeURIComponent(sid)}` : ""}&mime=audio%2Fmpeg`;
    }
    if (t && (t.source === "apple" || t.source === "itunes" || t.source === "deezer")) {
      return `${API_BASE}/api/download?query=${encodeURIComponent(t.playQuery || `${t.title} ${t.artist}`)}&name=${nm}${titleParam}${artistParam}${candParam}`;
    }
    if (sid) {
      let resolvedSid = sid;
      if (resolvedSid.startsWith("/")) {
        resolvedSid = API_BASE ? `${API_BASE}${resolvedSid}` : resolvedSid;
      }
      return `${API_BASE}/api/download?streamUrl=${encodeURIComponent(resolvedSid)}&name=${nm}${titleParam}${artistParam}${candParam}&mime=${encodeURIComponent(t.streamMime || "audio/mp4")}`;
    }
    if (t && (t.title || t.artist)) {
      return `${API_BASE}/api/download?query=${encodeURIComponent(`${t.title || ""} ${t.artist || ""}`.trim())}&name=${nm}${titleParam}${artistParam}${candParam}`;
    }
    return "";
  }

  function concatBytes(parts) {
    let n = 0;
    for (const p of parts) n += p.byteLength;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p instanceof Uint8Array ? p : new Uint8Array(p), o); o += p.byteLength; }
    return out;
  }
  async function artworkDataURI(t) {
    const art = t && t.artwork;
    if (!art || typeof art !== "string") return "";
    if (/^data:/i.test(art)) return art;
    if (!/^https?:/i.test(art)) return "";
    try {
      const r = await fetch(art, { mode: "cors" });
      if (!r.ok) return "";
      const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
      const b64 = await blobToBase64(await r.arrayBuffer());
      return `data:${ct};base64,${b64}`;
    } catch { return ""; }
  }
  function blobToBase64(buf) {
    let s = "";
    const chunk = 0x8000;
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }
  function fmtBytes(b) {
    const n = Number(b) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
    return n + " B";
  }
  function dlProgressKey(id) { return `dlProgress:${id}`; }
  function saveDlJob(job) {
    state.dlQueue = state.dlQueue || [];
    const i = state.dlQueue.findIndex((d) => d.id === job.id);
    if (i >= 0) state.dlQueue[i] = job; else state.dlQueue.unshift(job);
    save("aura.dlQueue", state.dlQueue);
    const bar = $(`dlBar-${job.id}`);
    if (bar) {
      const pct = Math.min(100, Math.round((job.progress || 0) * 100));
      bar.style.width = `${pct}%`;
      const txt = $(`dlStat-${job.id}`);
      if (txt) txt.textContent = job.status === "downloading" ? `${pct}%` : job.status === "saving" ? "Saving…" : job.status;
    }
    renderDlPanel();
  }

  async function saveDownloadToDisk(meta, t, job, onProgress) {
    const ND = nativeDownloader();
    const embeddedLrcText = (t && (t.lrc || (Array.isArray(t.synced) && t.synced.length ? formatSyncedLrc(t.synced, t.lyrics || "", t) : (t.lyrics || "")))) || "";
    if (ND) {
      // Resolve cover art to a base64 data URI so the native plugin can embed
      // the picture into the file (best-effort; title/artist/album always tag).
      const artURI = await artworkDataURI(t);
      const res = await ND.startDownload({
        id: job.id,
        url: meta.url,
        videoId: t.videoId || "",
        candidates: Array.isArray(t._ytCandidates) ? t._ytCandidates.slice(0, 5).join(",") : "",
        filename: meta.filename,
        title: t.title || "",
        artist: t.artist || "",
        album: t.album || "",
        genre: t.genre || "",
        lyrics: embeddedLrcText,
        syncedLyrics: embeddedLrcText,
        artwork: (t.artwork && typeof t.artwork === "string") ? t.artwork : "",
        artworkData: artURI || "",
        mime: meta.mime,
      });
      // The native plugin resolves {id, uri} — keep only the URI string.
      return (res && typeof res === "object" && res.uri) ? res.uri : String(res || "");
    }
    // Web / PWA — File System Access API, then blob+<a download> fallback.
    const isValidAudioRes = (r) => {
      if (!r || !r.ok) return false;
      const ct = String(r.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json") || ct.includes("text/html") || ct.includes("text/plain")) return false;
      return true;
    };
    const isLikelyAudioBytes = (bytes) => {
      if (!bytes || bytes.byteLength < 1024) return false;
      // Reject JSON ("{") or HTML ("<") error bodies masquerading as audio
      if (bytes[0] === 0x7b || bytes[0] === 0x3c) return false;
      return true;
    };
    const fetchChunkedAudio = async (dlUrl) => {
      const CHUNK = 983040; // 960 KB (< 1 MB Googlevideo IOS/ANDROID chunk ceiling)
      const parts = [];
      let offset = 0;
      let totalBytes = 0;
      let detectedMime = "";
      let detectedDisp = "";
      try {
        const uObj = new URL(dlUrl, window.location.origin);
        const sParam = uObj.searchParams.get("streamUrl") || uObj.searchParams.get("url") || "";
        const mClen = sParam.match(/[?&]clen=(\d+)/);
        if (mClen && Number(mClen[1]) > 0) totalBytes = Number(mClen[1]);
      } catch {}
      while (true) {
        if (job.status === "cancelled") throw new Error("cancelled");
        const end = totalBytes > 0 ? Math.min(offset + CHUNK - 1, totalBytes - 1) : (offset + CHUNK - 1);
        let chunkRes = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const r = await fetch(dlUrl, {
            credentials: "same-origin",
            headers: { Range: `bytes=${offset}-${end}` },
          }).catch(() => null);
          if (isValidAudioRes(r)) {
            chunkRes = r;
            break;
          }
        }
        if (!chunkRes) return null;
        if (!detectedMime) detectedMime = chunkRes.headers.get("content-type") || "";
        if (!detectedDisp) detectedDisp = chunkRes.headers.get("content-disposition") || "";
        if (!totalBytes) {
          const cr = chunkRes.headers.get("content-range") || "";
          const mTot = cr.match(/\/(\d+)/);
          if (mTot && Number(mTot[1]) > 0) totalBytes = Number(mTot[1]);
          else if (chunkRes.status === 200) totalBytes = Number(chunkRes.headers.get("content-length") || 0);
        }
        const ab = await chunkRes.arrayBuffer();
        const chunkBytes = new Uint8Array(ab);
        if (!chunkBytes.byteLength) break;
        parts.push(chunkBytes);
        offset += chunkBytes.byteLength;
        onProgress({
          bytes: offset,
          total: totalBytes || offset,
          progress: totalBytes ? Math.min(1, offset / totalBytes) : 0,
        });
        if (chunkRes.status === 200) break;
        if (totalBytes > 0 && offset >= totalBytes) break;
        if (chunkBytes.byteLength < (end - (offset - chunkBytes.byteLength) + 1)) break;
      }
      const combined = concatBytes(parts);
      if (!isLikelyAudioBytes(combined)) return null;
      if (totalBytes > 0 && combined.byteLength < totalBytes) return null;
      return { bytes: combined, mime: detectedMime, disp: detectedDisp, total: combined.byteLength };
    };

    const readFullResponseBody = async (r) => {
      const expectedTotal = Number(r.headers.get("content-length") || 0);
      const collect = [];
      if (r.body && typeof r.body.getReader === "function") {
        const reader = r.body.getReader();
        let buf = 0;
        let cancelled = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (job.status === "cancelled") { cancelled = true; break; }
          if (value && value.byteLength) {
            collect.push(value);
            buf += value.byteLength;
            onProgress({ bytes: buf, total: expectedTotal || buf, progress: expectedTotal ? Math.min(1, buf / expectedTotal) : 0 });
          }
        }
        if (cancelled) throw new Error("cancelled");
      } else {
        const ab = await r.arrayBuffer();
        collect.push(new Uint8Array(ab));
        onProgress({ bytes: ab.byteLength, total: expectedTotal || ab.byteLength, progress: 1 });
      }
      const bytes = concatBytes(collect);
      if (!isLikelyAudioBytes(bytes)) return null;
      if (expectedTotal > 0 && bytes.byteLength < expectedTotal) return null;
      return {
        bytes,
        mime: r.headers.get("content-type") || "",
        disp: r.headers.get("content-disposition") || "",
        total: bytes.byteLength,
      };
    };

    const titleParam = t && t.title ? `&title=${encodeURIComponent(t.title)}` : "";
    const artistParam = t && t.artist ? `&artist=${encodeURIComponent(t.artist)}` : "";
    const candParam = t && Array.isArray(t._ytCandidates) && t._ytCandidates.length
      ? `&candidates=${encodeURIComponent(t._ytCandidates.slice(0, 5).join(","))}`
      : "";
    const fallbackUrl = (t && t.videoId)
      ? `${API_BASE}/api/download?videoId=${encodeURIComponent(t.videoId)}&name=${encodeURIComponent(t.title || "track")}${titleParam}${artistParam}${candParam}`
      : ((t && t.source === "audius" && t.trackId)
        ? `${API_BASE}/api/download?trackId=${encodeURIComponent(t.trackId)}&name=${encodeURIComponent(t.title || "track")}${titleParam}${artistParam}`
        : ((t && (t.source === "apple" || t.source === "itunes" || t.source === "deezer"))
          ? `${API_BASE}/api/download?query=${encodeURIComponent(t.playQuery || `${t.title} ${t.artist}`)}&name=${encodeURIComponent(t.title || "track")}${titleParam}${artistParam}${candParam}`
          : ""));
    const qName = `${t && t.title || ""} ${t && t.artist || ""}`.trim();
    const qUrl = qName
      ? `${API_BASE}/api/download?query=${encodeURIComponent(qName)}&name=${encodeURIComponent(t && t.title || "track")}${titleParam}${artistParam}${candParam}`
      : "";

    const candidateUrls = [meta.url, fallbackUrl, qUrl].filter((u, idx, arr) => u && arr.indexOf(u) === idx);
    let preloadedChunked = null;
    for (const tryUrl of candidateUrls) {
      if (job.status === "cancelled") throw new Error("cancelled");
      const r = await fetch(tryUrl, { credentials: "same-origin" }).catch(() => null);
      if (isValidAudioRes(r)) {
        try {
          const fullPayload = await readFullResponseBody(r);
          if (fullPayload && isLikelyAudioBytes(fullPayload.bytes)) {
            preloadedChunked = fullPayload;
            break;
          }
        } catch (readErr) {
          if (readErr && readErr.message === "cancelled") throw readErr;
        }
      }
      // If un-ranged fetch returned 403/5xx or aborted mid-stream, try 960KB bounded Range chunks
      const chunked = await fetchChunkedAudio(tryUrl).catch((chunkErr) => {
        if (chunkErr && chunkErr.message === "cancelled") throw chunkErr;
        return null;
      });
      if (chunked && isLikelyAudioBytes(chunked.bytes)) {
        preloadedChunked = chunked;
        break;
      }
    }
    if (!preloadedChunked) throw new Error("download failed: could not retrieve valid audio stream");
    const total = preloadedChunked.total;
    const cd = preloadedChunked.disp || "";
    const m = cd.match(/filename="?([^";]+)"?/i);
    let fname = (m && m[1]) ? m[1] : meta.filename;
    const ctype = (preloadedChunked.mime || meta.mime || "audio/mp4").split(";")[0].trim();
    // The pre-generated filename/extension can disagree with the actual bytes
    // (e.g. an unresolved stream guessed ".webm" while the server served
    // audio/mp4). Derive the extension from the REAL content type and reconcile
    // the name to it, so the saved file AND the File System Access API accept
    // list (which requires mime↔ext consistency) never mismatch again — that
    // mismatch is exactly what made showSaveFilePicker throw NotSupportedError.
    const ext = extFromContentType(ctype) || (fname.split(".").pop() || meta.ext).toLowerCase();
    fname = /\.([a-z0-9]{1,5})$/i.test(fname)
      ? fname.replace(/\.[a-z0-9]{1,5}$/i, "." + ext)
      : `${fname}.${ext}`;
    const w = window;
    // Real, embedded audio tags (ID3v2 for mp3, MP4 ilst for m4a) so the
    // downloaded file shows title/artist/album/cover in any music app. The
    // native shells mirror the same frames (see public/meta.js).
    const MM = w.MuchiMeta;
    const rawAudioBytes = preloadedChunked.bytes;
    if (!isLikelyAudioBytes(rawAudioBytes)) {
      throw new Error("download failed: invalid or non-audio payload received");
    }
    let taggedBytes = rawAudioBytes;
    if (MM) {
      try {
        // Best-effort artwork bytes (CORS-permitting); title/artist/album always embed.
        let picture;
        const art = t && t.artwork;
        if (art && /^https?:/i.test(art)) {
          try {
            const ar = await fetch(art, { mode: "cors" });
            if (ar.ok) picture = { mime: (ar.headers.get("content-type") || "image/jpeg").split(";")[0], data: new Uint8Array(await ar.arrayBuffer()) };
          } catch {}
        }
        taggedBytes = MM.embed(rawAudioBytes, ext, {
          title: t.title || "",
          artist: t.artist || "",
          album: t.album || "",
          genre: t.genre || "",
          lyrics: embeddedLrcText,
          picture,
        });
      } catch (metaErr) {
        console.warn("MuchiMeta embed failed, keeping raw audio bytes:", metaErr);
        taggedBytes = rawAudioBytes;
      }
    }
    const blobType = ctype || "audio/webm";
    // Always persist untouched raw audio bytes + synced lyrics payload into IndexedDB first under all candidate keys
    // so in-app offline playback, timestamp seeking, and offline synced lyrics work with 100% reliability.
    const blob = new Blob([rawAudioBytes], { type: blobType });
    const exportBlob = new Blob([taggedBytes], { type: blobType });
    const offlineRecord = {
      blob,
      fname,
      mime: blobType,
      title: t.title || "",
      artist: t.artist || "",
      lyrics: t.lyrics || "",
      synced: Array.isArray(t.synced) ? t.synced : [],
      lrc: embeddedLrcText,
      savedAt: Date.now(),
    };
    const keysToPersist = [
      t.id,
      trackKey(t),
      canonicalSongKey(t),
      t.videoId ? `yt:${t.videoId}` : "",
      t.videoId || "",
      t.trackId ? `audius:${t.trackId}` : "",
      t.trackId || "",
    ].filter((k, idx, arr) => k && arr.indexOf(k) === idx);
    for (const k of keysToPersist) {
      try { await idbPut(k, offlineRecord); } catch {}
    }

    // File System Access API (showSaveFilePicker) requires active user gesture,
    // which expires during streaming download. We try it safely in try/catch,
    // and seamlessly fall back to standard anchor download so web downloads never fail.
    if (w.showSaveFilePicker && /^(audio|video)\//i.test(blobType)) {
      try {
        const handle = await w.showSaveFilePicker({ suggestedName: fname, types: [{ description: "Audio", accept: { [blobType]: ["." + ext] } }] });
        const writable = await handle.createWritable();
        await writable.write(taggedBytes);
        await writable.close();
        // IMPORTANT: preserve { ...offlineRecord, handle } so offline playback and synced lyrics work
        // even if browser revokes file handle permission on page reload / offline!
        for (const k of keysToPersist) {
          try { await idbPut(k, { ...offlineRecord, handle }); } catch {}
        }
        return `fsp:${fname}`;
      } catch (pickerErr) {
        if (pickerErr && pickerErr.name === "AbortError") {
          throw new Error("cancelled");
        }
        console.warn("File System Access picker bypassed or gesture expired, falling back to browser download:", pickerErr);
      }
    }
    // Standard browser download fallback via temporary anchor
    const a = document.createElement("a");
    a.href = URL.createObjectURL(exportBlob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return `blob:${fname}`;
  }

  async function downloadTrack(t) {
    if (!t) return;
    // Already fully saved? Ensure synced lyrics are also saved offline alongside it!
    const existing = findSavedTrack(t);
    if (existing && existing.uri) {
      if (!hasOfflineSyncedLyrics(existing)) {
        toast("Saving synced lyrics for offline access…");
        const lyr = await ensureOfflineLyricsForTrack(existing).catch(() => null);
        if (lyr && (lyr.lyrics || (lyr.synced && lyr.synced.length))) {
          toast("Saved offline with synced lyrics", true, "success");
          if (state.view === "settings" || state.view === "library" || state.view === "now") render();
          return;
        }
      }
      toast("Already saved on this device (with offline lyrics)");
      return;
    }
    // Job id follows the track id so the native downloader can map the saved
    // file back to this track (removeDownload must be able to find + delete it).
    const jid = t.id || `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    // Already in progress?
    if ((state.dlQueue || []).some((d) => d.id === jid && (d.status === "downloading" || d.status === "saving"))) {
      toast("Already downloading");
      return;
    }
    // Item 7 — ask for storage permission once, at the moment of saving.
    if (IS_NATIVE) nativeEnsureStoragePermission();
    // Kick off offline synced lyrics fetch in parallel with stream resolution
    // so synced lyrics are ready to be embedded into the audio file & IndexedDB record!
    const lyricsPromise = ensureOfflineLyricsForTrack(t).catch(() => null);
    const resolved = await ensureStreamForDownload(t);
    if (resolved && t && t.id) resolved.id = t.id;
    const path = downloadFilePath(resolved);
    if (!path) {
      toast("This track can't be saved offline");
      return;
    }
    const meta = {
      url: path,
      filename: `${sanitizeName(t.title)}.${extFromMime(resolved)}`,
      mime: resolved.streamMime || (/mpeg|mp3/i.test(String(resolved.streamUrl)) ? "audio/mpeg" : "audio/mp4"),
      ext: extFromMime(resolved),
    };
    const job = {
      id: jid,
      track: slimTrack(resolved),
      filename: meta.filename,
      progress: 0, bytes: 0, total: 0,
      status: "downloading", cancel: false,
    };
    state.dlQueue = state.dlQueue || [];
    state.dlQueue.unshift(job);
    save("aura.dlQueue", state.dlQueue);
    render(); // show the download manager (library/settings) with live progress
    try {
      const onProgress = (p) => { job.bytes = p.bytes || 0; job.total = p.total || 0; job.progress = p.progress || 0; saveDlJob(job); };
      job.status = "downloading"; saveDlJob(job);
      // Wait briefly for lyricsPromise if it already resolved or finishes during stream prep,
      // and also resolve it after download if still pending.
      let dlLyrics = await Promise.race([
        lyricsPromise,
        new Promise((r) => setTimeout(() => r(null), 1200)),
      ]);
      if (dlLyrics && (dlLyrics.lyrics || (dlLyrics.synced && dlLyrics.synced.length))) {
        resolved.lyrics = dlLyrics.lyrics || "";
        resolved.synced = dlLyrics.synced || [];
        resolved.lrc = dlLyrics.lrc || formatSyncedLrc(resolved.synced, resolved.lyrics, resolved);
      }
      const uri = await saveDownloadToDisk(meta, resolved, job, onProgress);
      if (job.status === "cancelled" || !uri) throw new Error("cancelled");
      job.status = "saving"; saveDlJob(job);
      // Ensure offline synced lyrics finished fetching and are persisted alongside the downloaded audio
      if (!dlLyrics) {
        try {
          dlLyrics = await lyricsPromise || await ensureOfflineLyricsForTrack(resolved);
        } catch {}
      }
      const finalLyricsText = (dlLyrics && dlLyrics.lyrics) || resolved.lyrics || "";
      const finalSyncedArr = (dlLyrics && Array.isArray(dlLyrics.synced) && dlLyrics.synced.length)
        ? dlLyrics.synced
        : (Array.isArray(resolved.synced) ? resolved.synced : []);
      const finalLrc = (dlLyrics && dlLyrics.lrc) || resolved.lrc || formatSyncedLrc(finalSyncedArr, finalLyricsText, resolved);
      job.status = "done"; job.progress = 1; saveDlJob(job);
      // Record metadata + the local uri + cached synced lyrics & LRC so it replays offline with moving lyrics.
      const dl = {
        ...slimTrack(resolved),
        uri,
        streamMime: meta.mime,
        savedAt: Date.now(),
        ...(finalLyricsText || finalSyncedArr.length
          ? {
              lyrics: finalLyricsText,
              synced: finalSyncedArr,
              lrc: finalLrc,
              hasOfflineLyrics: true,
            }
          : {}),
      };
      delete dl.streamUrl;
      state.downloads = [dl, ...state.downloads.filter((d) => d.id !== dl.id && trackKey(d) !== trackKey(dl))];
      save("aura.downloads", state.downloads);
      if (finalLyricsText || finalSyncedArr.length) {
        await saveOfflineLyrics(dl, {
          lyrics: finalLyricsText,
          synced: finalSyncedArr,
          lrc: finalLrc,
          _synthesized: Boolean(dlLyrics && dlLyrics._synthesized),
        }).catch(() => {});
      }
      toast(
        finalSyncedArr.length
          ? "Saved offline with synced lyrics"
          : "Saved to your files",
        true,
        "success"
      );
      if (IS_NATIVE && document.hidden) nativeNotifySaved(t.title);
      // Clear the finished job from the active queue shortly after.
      setTimeout(() => {
        state.dlQueue = (state.dlQueue || []).filter((d) => d.id !== job.id);
        save("aura.dlQueue", state.dlQueue || []);
        if (state.view === "settings" || state.view === "library" || state.view === "home") render();
      }, 1500);
      if (state.view === "settings" || state.view === "library" || state.view === "now" || state.view === "home") render();
    } catch (e) {
      const isCancel = !!(e && (e.message === "cancelled" || e.name === "AbortError"));
      job.status = isCancel ? "cancelled" : "error";
      saveDlJob(job);
      if (isCancel) toast("Download cancelled");
      else { console.error(e); toast("Download failed", true, "error"); }
    }
  }

  async function cancelDownload(id) {
    state.dlQueue = (state.dlQueue || []).map((d) => d.id === id ? { ...d, status: "cancelled", cancel: true } : d);
    save("aura.dlQueue", state.dlQueue);
    const ND = nativeDownloader();
    if (ND && ND.cancelDownload) { try { ND.cancelDownload({ id }).catch(() => {}); } catch {} }
    toast("Cancelling…");
  }

  async function removeDownload(id) {
    if (!id) return;
    const target = (state.downloads || []).find((d) => d && (d.id === id || trackKey(d) === id || d.videoId === id || d.trackId === id)) || { id };
    const targetId = target.id || id;
    // Native: delete the file on disk too.
    const ND = nativeDownloader();
    try { if (ND && ND.removeDownload) await ND.removeDownload({ id: targetId }); } catch {}
    await idbDel(targetId).catch(() => {});
    if (target.videoId) await idbDel(`yt:${target.videoId}`).catch(() => {});
    if (target.trackId) await idbDel(`audius:${target.trackId}`).catch(() => {});
    state.downloads = (state.downloads || []).filter((d) => d && d.id !== targetId && trackKey(d) !== targetId && d.id !== id);
    save("aura.downloads", state.downloads);
    toast("Deleted downloaded song", true, "success");
    if (state.view === "settings" || state.view === "library") render();
  }

  function mountDlPanel() {
    if ($("dlPanel")) return;
    const el = document.createElement("div");
    el.id = "dlPanel";
    el.className = "dl-panel";
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cancel-dl]");
      if (b) { e.stopPropagation(); cancelDownload(b.dataset.cancelDl); }
    });
    $("app").appendChild(el);
  }
  function renderDlPanel() {
    mountDlPanel();
    const el = $("dlPanel");
    if (!el) return;
    const q = (state.dlQueue || []).filter((d) => d.status === "downloading" || d.status === "saving");
    if (!q.length) { el.classList.remove("show"); el.innerHTML = ""; return; }
    el.classList.add("show");
    el.innerHTML = q.map((job) => {
      const pct = Math.min(100, Math.round((job.progress || 0) * 100));
      return `
        <div class="dl-panel-row">
          <span class="material-symbols-outlined">download</span>
          <div class="dl-panel-main">
            <div class="dl-panel-title">${escapeHTML(job.filename)}</div>
            <div class="dl-progress"><div class="dl-progress-bar" style="width:${pct}%"></div></div>
          </div>
          <button type="button" class="icon-btn" data-cancel-dl="${escapeAttr(job.id)}" title="Cancel"><span class="material-symbols-outlined">close</span></button>
        </div>`;
    }).join("");
  }

  function renderDlManager() {
    const q = state.dlQueue || [];
    if (!q.length) return "";
    const rows = q.map((job) => {
      const pct = Math.min(100, Math.round((job.progress || 0) * 100));
      const icon = job.status === "error" ? "error" : job.status === "cancelled" ? "close" : job.status === "done" ? "check_circle" : "download";
      const cls = job.status === "error" ? "dl-err" : job.status === "cancelled" ? "dl-cancel" : "dl-live";
      const label = job.status === "error" ? "Failed" : job.status === "cancelled" ? "Cancelled" : job.status === "done" ? "Saved" : job.status === "saving" ? "Saving…" : `${pct}%`;
      return `
        <div class="dl-job ${cls}" id="dlRow-${job.id}">
          <span class="material-symbols-outlined">${icon}</span>
          <div class="dl-job-main">
            <div class="dl-job-title">${escapeHTML(job.filename)}</div>
            <div class="dl-progress"><div class="dl-progress-bar" id="dlBar-${job.id}" style="width:${pct}%"></div></div>
            <div class="dl-stat" id="dlStat-${job.id}">${label}${job.total ? " · " + escapeHTML(fmtBytes(job.bytes)) + " / " + escapeHTML(fmtBytes(job.total)) : ""}</div>
          </div>
          ${job.status === "downloading" || job.status === "saving" ? `<button class="icon-btn dl-cancel-btn" data-cancel-dl="${escapeAttr(job.id)}" title="Cancel"><span class="material-symbols-outlined">close</span></button>` : ""}
        </div>`;
    }).join("");
    return `<div class="set-card dl-card"><h3>Downloads</h3>${rows}</div>`;
  }

  function triggerFabRipple(button, e) {
    if (!button) return;
    try {
      const rect = button.getBoundingClientRect();
      const d = Math.max(rect.width, rect.height) * 2;
      const ripple = document.createElement("span");
      ripple.className = "fab-ripple";
      ripple.style.width = `${d}px`;
      ripple.style.height = `${d}px`;
      const hasCoord = e && typeof e.clientX === "number" && (e.clientX !== 0 || e.clientY !== 0);
      const x = hasCoord ? (e.clientX - rect.left - d / 2) : (rect.width - d) / 2;
      const y = hasCoord ? (e.clientY - rect.top - d / 2) : (rect.height - d) / 2;
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      button.appendChild(ripple);
      setTimeout(() => {
        if (ripple.parentNode) ripple.remove();
      }, 550);
    } catch {}
  }

  const fx = { ctx: null, src: null, nodes: [] };
  function clearFx() {
    (fx.nodes || []).forEach((n) => {
      try { if (n.stop) n.stop(); } catch {}
      try { n.disconnect(); } catch {}
    });
    fx.nodes = [];
  }
  function fxAdd(node) {
    fx.nodes.push(node);
    return node;
  }
  function makeDriveCurve(amount) {
    const n = 260;
    const curve = new Float32Array(n);
    const k = Number(amount) || 6;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }
  // Pure audio math (mirrors scripts/audio-utils.mjs). Kept inline so the app
  // never needs to import; the canonical copy is unit-tested in smoke.mjs and
  // must stay in sync with these three lines.
  function normalizeGain(on) { return on ? 0.86 : 1; }
  function volumeFor(volumePct, normalize) {
    const v = Math.max(0, Math.min(100, Number(volumePct) || 0)) / 100;
    return Math.min(1, v * normalizeGain(normalize));
  }

  function spatialMode() {
    const m = state.prefs.spatial || "phone";
    if (m === "wide" || m === "motion") return "spatial";
    if (m === "phone" || m === "bass" || m === "spatial" || m === "dynamic" || m === "off") return m;
    return "phone";
  }

  function setAudioVec(node, xName, yName, zName, x, y, z, legacy) {
    try {
      if (node[xName]) {
        node[xName].value = x;
        node[yName].value = y;
        node[zName].value = z;
        return;
      }
    } catch {}
    try { if (legacy) legacy.call(node, x, y, z); } catch {}
  }

  function makeHrtfPanner(ctx, azDeg, dist) {
    const p = fxAdd(ctx.createPanner());
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = 1;
    p.maxDistance = 12;
    p.rolloffFactor = 0.22;
    const rad = (azDeg * Math.PI) / 180;
    setAudioVec(p, "positionX", "positionY", "positionZ", Math.sin(rad) * dist, 0, -Math.cos(rad) * dist, p.setPosition);
    return p;
  }

  function hookSound() {
    // On Native (Android/iOS), MuchiAudioService / MuchiAudioPlugin handles playback
    // and hardware Sound Stage DSP (LoudnessEnhancer + BassBoost + Equalizer).
    // Never attach WebAudio createMediaElementSource(audio) in the native WebView,
    // as WebAudio AudioContext is suspended by the OS on app backgrounding and
    // steals Android AudioFocus from ExoPlayer.
    if (IS_NATIVE) return;
    const mode = spatialMode();
    try {
      if (mode === "off" && !fx.src) return;
      if (!fx.ctx) fx.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (fx.ctx.state === "suspended") fx.ctx.resume();
      if (!fx.src) fx.src = fx.ctx.createMediaElementSource(audio);
      fx.src.disconnect();
      clearFx();
      const ctx = fx.ctx;
      if (mode === "off") {
        fx.src.connect(ctx.destination);
        return;
      }

      const hpf = fxAdd(ctx.createBiquadFilter());
      hpf.type = "highpass"; hpf.frequency.value = 28; hpf.Q.value = 0.7;
      fx.src.connect(hpf);

      if (mode === "phone") {
        const bass = fxAdd(ctx.createBiquadFilter());
        bass.type = "lowshelf"; bass.frequency.value = 78; bass.gain.value = 9.5;
        const sub = fxAdd(ctx.createBiquadFilter());
        sub.type = "peaking"; sub.frequency.value = 58; sub.Q.value = 0.75; sub.gain.value = 5.5;
        const body = fxAdd(ctx.createBiquadFilter());
        body.type = "peaking"; body.frequency.value = 145; body.Q.value = 0.8; body.gain.value = 3.2;
        const scoop = fxAdd(ctx.createBiquadFilter());
        scoop.type = "peaking"; scoop.frequency.value = 420; scoop.Q.value = 0.85; scoop.gain.value = -2.8;
        const presence = fxAdd(ctx.createBiquadFilter());
        presence.type = "peaking"; presence.frequency.value = 2800; presence.Q.value = 0.75; presence.gain.value = 2.8;
        const air = fxAdd(ctx.createBiquadFilter());
        air.type = "highshelf"; air.frequency.value = 8500; air.gain.value = 2.6;
        hpf.connect(bass);
        bass.connect(sub);
        sub.connect(body);
        body.connect(scoop);
        scoop.connect(presence);
        presence.connect(air);

        const mix = fxAdd(ctx.createGain());
        mix.gain.value = 1;
        air.connect(mix);

        const bp = fxAdd(ctx.createBiquadFilter());
        bp.type = "bandpass"; bp.frequency.value = 68; bp.Q.value = 0.85;
        const harm = fxAdd(ctx.createWaveShaper());
        const hn = 1024;
        const hc = new Float32Array(hn);
        for (let i = 0; i < hn; i++) {
          const x = (i * 2) / hn - 1;
          hc[i] = Math.tanh(3.1 * x) * 0.52 + x * Math.abs(x) * 0.48;
        }
        harm.curve = hc;
        harm.oversample = "2x";
        const hpH = fxAdd(ctx.createBiquadFilter());
        hpH.type = "highpass"; hpH.frequency.value = 88; hpH.Q.value = 0.7;
        const lpH = fxAdd(ctx.createBiquadFilter());
        lpH.type = "lowpass"; lpH.frequency.value = 340; lpH.Q.value = 0.7;
        const wet = fxAdd(ctx.createGain());
        wet.gain.value = 0.72;
        hpf.connect(bp);
        bp.connect(harm);
        harm.connect(hpH);
        hpH.connect(lpH);
        lpH.connect(wet);
        wet.connect(mix);

        const punch = fxAdd(ctx.createDynamicsCompressor());
        punch.threshold.value = -20;
        punch.knee.value = 14;
        punch.ratio.value = 3.6;
        punch.attack.value = 0.005;
        punch.release.value = 0.14;
        const lim = fxAdd(ctx.createDynamicsCompressor());
        lim.threshold.value = -0.9;
        lim.knee.value = 1.5;
        lim.ratio.value = 20;
        lim.attack.value = 0.002;
        lim.release.value = 0.08;
        const out = fxAdd(ctx.createGain());
        out.gain.value = 1.55;
        mix.connect(punch);
        punch.connect(lim);
        lim.connect(out);
        out.connect(ctx.destination);
        return;
      }

      const bass = fxAdd(ctx.createBiquadFilter());
      bass.type = "lowshelf";
      const sub = fxAdd(ctx.createBiquadFilter());
      sub.type = "peaking"; sub.frequency.value = 62; sub.Q.value = 0.85;
      const scoop = fxAdd(ctx.createBiquadFilter());
      scoop.type = "peaking"; scoop.frequency.value = 380; scoop.Q.value = 0.9;
      const presence = fxAdd(ctx.createBiquadFilter());
      presence.type = "peaking"; presence.frequency.value = 3200; presence.Q.value = 0.8;
      const air = fxAdd(ctx.createBiquadFilter());
      air.type = "highshelf"; air.frequency.value = 9000;

      if (mode === "bass") {
        bass.frequency.value = 72; bass.gain.value = 8.5;
        sub.gain.value = 4.2;
        scoop.gain.value = -2.2;
        presence.gain.value = 1.2;
        air.gain.value = -0.8;
      } else if (mode === "spatial") {
        bass.frequency.value = 90; bass.gain.value = 2.4;
        sub.gain.value = 1.2;
        scoop.gain.value = -1.4;
        presence.gain.value = 2.4;
        air.gain.value = 3.2;
      } else {
        bass.frequency.value = 85; bass.gain.value = 5.5;
        sub.gain.value = 2.6;
        scoop.gain.value = -1.8;
        presence.gain.value = 3.1;
        air.gain.value = 2.4;
      }

      hpf.connect(bass);
      bass.connect(sub);
      sub.connect(scoop);
      scoop.connect(presence);
      presence.connect(air);

      const comp = fxAdd(ctx.createDynamicsCompressor());
      if (mode === "dynamic") {
        comp.threshold.value = -22;
        comp.knee.value = 18;
        comp.ratio.value = 4.2;
        comp.attack.value = 0.004;
        comp.release.value = 0.12;
      } else if (mode === "bass") {
        comp.threshold.value = -18;
        comp.knee.value = 12;
        comp.ratio.value = 2.6;
        comp.attack.value = 0.012;
        comp.release.value = 0.22;
      } else {
        comp.threshold.value = -14;
        comp.knee.value = 16;
        comp.ratio.value = 2.2;
        comp.attack.value = 0.008;
        comp.release.value = 0.18;
      }
      air.connect(comp);

      const out = fxAdd(ctx.createGain());
      out.gain.value = mode === "bass" ? 1.28 : mode === "dynamic" ? 1.22 : 1.18;

      if (mode === "spatial") {
        const lis = ctx.listener;
        setAudioVec(lis, "positionX", "positionY", "positionZ", 0, 0, 0, lis.setPosition);
        try {
          if (lis.forwardX) {
            lis.forwardX.value = 0; lis.forwardY.value = 0; lis.forwardZ.value = -1;
            lis.upX.value = 0; lis.upY.value = 1; lis.upZ.value = 0;
          } else if (lis.setOrientation) lis.setOrientation(0, 0, -1, 0, 1, 0);
        } catch {}
        const split = fxAdd(ctx.createChannelSplitter(2));
        const left = makeHrtfPanner(ctx, -38, 1.35);
        const right = makeHrtfPanner(ctx, 38, 1.35);
        const rearL = makeHrtfPanner(ctx, -125, 2.05);
        const rearR = makeHrtfPanner(ctx, 125, 2.05);
        const height = makeHrtfPanner(ctx, 0, 1.7);
        setAudioVec(height, "positionX", "positionY", "positionZ", 0, 0.55, -1.1, height.setPosition);
        const rearG = fxAdd(ctx.createGain());
        rearG.gain.value = 0.38;
        const hiG = fxAdd(ctx.createGain());
        hiG.gain.value = 0.28;
        comp.connect(split);
        split.connect(left, 0);
        split.connect(right, 1);
        split.connect(rearG, 0);
        split.connect(rearG, 1);
        rearG.connect(rearL);
        rearG.connect(rearR);
        comp.connect(hiG);
        hiG.connect(height);
        left.connect(out);
        right.connect(out);
        rearL.connect(out);
        rearR.connect(out);
        height.connect(out);
      } else {
        const shaper = fxAdd(ctx.createWaveShaper());
        shaper.curve = makeDriveCurve(mode === "bass" ? 5 : 4);
        shaper.oversample = "2x";
        comp.connect(shaper);
        shaper.connect(out);
      }
      out.connect(ctx.destination);
    } catch (e) {
      console.warn("sound stage", e);
    }
  }
  try {
    audio.playsInline = true;
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
  } catch {}

  // ── Adaptive Audio Buffering Strategy ─────────────────────────────────
  // Balances immediate start latency with smooth playback on high-bitrate
  // streams (AAC 256k, MP3 320k) under fluctuating network conditions.
  const adaptiveBuffer = {
    buffering: false,
    stallCount: 0,
    minBufferAhead: 2.0,    // Initial safety margin (seconds) for fast start
    targetBufferAhead: 2.0, // Dynamically expanded up to 5.5s upon buffer starvation
    lastStall: 0,
    startTime: 0,
  };

  function getBufferedAhead() {
    try {
      const pos = audio.currentTime || 0;
      const b = audio.buffered;
      if (!b || !b.length) return 0;
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) <= pos + 0.35 && pos <= b.end(i)) {
          return Math.max(0, b.end(i) - pos);
        }
      }
    } catch {}
    return 0;
  }

  function renderBufferState(isBuffering) {
    state.buffering = isBuffering;
    const playBtn = $("playBtn");
    if (playBtn) {
      if (isBuffering && state.playing) playBtn.classList.add("buffering");
      else playBtn.classList.remove("buffering");
    }
    const bar = $("playerBar");
    if (bar) {
      if (isBuffering && state.playing) bar.classList.add("is-buffering");
      else bar.classList.remove("is-buffering");
    }
  }

  function onPlaybackWaiting() {
    if (!state.playing || audio.paused || audio.ended) return;
    const now = performance.now();
    adaptiveBuffer.buffering = true;
    renderBufferState(true);

    // If another stall occurs within 45s, adaptively scale the buffer threshold
    if (now - adaptiveBuffer.lastStall < 45000) {
      adaptiveBuffer.stallCount += 1;
      adaptiveBuffer.targetBufferAhead = Math.min(6.0, 2.0 + adaptiveBuffer.stallCount * 1.0);
    } else {
      adaptiveBuffer.stallCount = 1;
      adaptiveBuffer.targetBufferAhead = 2.5;
    }
    adaptiveBuffer.lastStall = now;
  }

  function checkBufferResume() {
    if (!adaptiveBuffer.buffering) return;
    const ahead = getBufferedAhead();
    const dur = audio.duration;
    const isNearEnd = dur && isFinite(dur) && (ahead + audio.currentTime >= dur - 0.5);

    if (ahead >= adaptiveBuffer.targetBufferAhead || isNearEnd) {
      adaptiveBuffer.buffering = false;
      renderBufferState(false);
      if (state.playing && audio.paused && !audio.ended) {
        audio.play().catch(() => {});
      }
    }
  }

  function onPlaybackPlaying() {
    adaptiveBuffer.buffering = false;
    renderBufferState(false);
  }

  function unlockSound() {
    if (IS_NATIVE && npActive) return;
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      if (!fx.ctx) fx.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (fx.ctx.state === "suspended") fx.ctx.resume();
    } catch {}
  }
  window.addEventListener("pointerdown", unlockSound, true);
  window.addEventListener("touchstart", unlockSound, { capture: true, passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) unlockSound();
    keepBackgroundPlay();
  });

  function networkHint() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return "fast";
    const type = String(c.effectiveType || "");
    const down = Number(c.downlink || 10);
    if (type === "slow-2g" || type === "2g" || down > 0 && down < 0.7) return "slow";
    if (type === "3g" || (down > 0 && down < 2.2)) return "mid";
    if (c.saveData) return "mid";
    return "fast";
  }

  function resolvedQuality() {
    const q = state.prefs.quality || "high";
    if (q === "auto") {
      const net = networkHint();
      if (net === "slow") return "low";
      if (net === "mid") return "standard";
      return "high";
    }
    return ["low", "standard", "high", "highest"].includes(q) ? q : "high";
  }

  function ytQualityVq() {
    const q = resolvedQuality();
    if (q === "low") return "medium";
    if (q === "standard") return "hd720";
    if (q === "highest") return "hd2160"; // 4K where the video supports it; player falls back automatically
    return "hd1080";
  }

  function applyYtQuality() {
    if (!state.yt) return;
    const q = resolvedQuality();
    const level = ytQualityVq();
    try {
      if (state.yt.setPlaybackQualityRange) {
        if (q === "low") state.yt.setPlaybackQualityRange("tiny", "medium");
        else if (q === "standard") state.yt.setPlaybackQualityRange("medium", "hd720");
        else if (q === "highest") state.yt.setPlaybackQualityRange("hd1080", "highres");
        else state.yt.setPlaybackQualityRange("hd720", "highres");
      }
    } catch {}
    try {
      if (state.yt.setPlaybackQuality) state.yt.setPlaybackQuality(level);
    } catch {}
  }

  function applyPlaybackPrefs() {
    const rate = Number(state.prefs.speed || 1);
    try { audio.playbackRate = rate; } catch {}
    let vol = state.volume / 100;
    // Even volume — single, consistent loudness trim (was 0.92/0.88/0.92).
    audio.volume = volumeFor(state.volume, state.prefs.normalize);
    vol = audio.volume;
    if (state.yt && state.yt.setPlaybackRate) {
      try { state.yt.setPlaybackRate(rate); } catch {}
    }
    hookSound();
    applyYtQuality();
    nativeSyncAudioPrefs();
  }

  const QUALITY_NAMES = { low: "Low", standard: "Standard", high: "High", highest: "Highest" };
  function qualityLabel() {
    const auto = (state.prefs.quality || "auto") === "auto";
    const r = resolvedQuality();
    return auto ? `Auto · ${QUALITY_NAMES[r] || "High"}` : (QUALITY_NAMES[r] || "High");
  }

  function baseVolume() {
    return volumeFor(state.volume, state.prefs.normalize);
  }

  function fadeInTrack() {
    const fade = Number(state.prefs.crossfade || 0);
    state._xfading = false;
    if (!fade) {
      audio.volume = baseVolume();
      return;
    }
    const target = baseVolume();
    audio.volume = 0;
    const started = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - started) / (fade * 1000));
      audio.volume = target * t;
      if (t < 1 && !audio.paused) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function tickCrossfade(d, p) {
    const fade = Number(state.prefs.crossfade || 0);
    const t = current();
    if (npActive || !fade || !t || t.source === "youtube" || t.source === "radio") return;
    if (!d || d < fade + 1.5) return;
    const left = d - p;
    if (left <= fade && left > 0) {
      audio.volume = baseVolume() * Math.max(0, left / fade);
      if (left < 0.4 && !state._xfading) {
        state._xfading = true;
        next(false);
      }
    }
  }

  let wakeSentinel = null;
  async function updateWakeLock() {
    try {
      if (wakeSentinel) {
        await wakeSentinel.release();
        wakeSentinel = null;
      }
      if (state.prefs.wake && state.playing && navigator.wakeLock) {
        wakeSentinel = await navigator.wakeLock.request("screen");
        wakeSentinel.addEventListener("release", () => { wakeSentinel = null; });
      }
    } catch {}
  }

  function sleepLabel() {
    if (state.sleep.mode === "track") return "After this track";
    if (state.sleep.mode === "mins" && state.sleep.until) {
      const remSec = Math.max(0, Math.ceil((state.sleep.until - Date.now()) / 1000));
      if (!remSec) return "Off";
      const m = Math.ceil(remSec / 60);
      return `${m} min left`;
    }
    return "Off";
  }

  function pauseForSleep() {
    if (state.sleep.timer) clearTimeout(state.sleep.timer);
    state.sleep = { mode: "off", until: 0, timer: null, preset: "off" };
    setWantPlay(false);
    state.playing = false;
    showEl($("eqBars"), false);
    audio.pause();
    nativePausePlayback();
    if (state.yt && state.yt.pauseVideo) {
      try { state.yt.pauseVideo(); } catch {}
    }
    updateMediaSession();
    updateWakeLock();
    renderChrome();
    if (state.view === "settings") render();
    toast("Sleep timer — paused");
  }

  function setSleep(kind) {
    if (state.sleep.timer) clearTimeout(state.sleep.timer);
    if (kind === "off") {
      state.sleep = { mode: "off", until: 0, timer: null, preset: "off" };
      toast("Sleep timer off");
    } else if (kind === "track") {
      state.sleep = { mode: "track", until: 0, timer: null, preset: "track" };
      toast("Stops after this track");
    } else {
      const mins = Number(kind);
      state.sleep = {
        mode: "mins",
        preset: String(mins),
        until: Date.now() + mins * 60000,
        timer: setTimeout(pauseForSleep, mins * 60000),
      };
      toast(`Sleep in ${mins} minutes`);
    }
    renderChrome();
    if (state.view === "settings") render();
  }

  function cycleSleep() {
    const order = ["off", "15", "30", "45", "60", "track"];
    let cur = "off";
    if (state.sleep.mode === "track") cur = "track";
    else if (state.sleep.mode === "mins") {
      if (state.sleep.preset && order.includes(String(state.sleep.preset))) {
        cur = String(state.sleep.preset);
      } else {
        const left = Math.round((state.sleep.until - Date.now()) / 60000);
        cur = [15, 30, 45, 60].reduce((best, n) => (Math.abs(n - left) < Math.abs(best - left) ? n : best), 15);
        cur = String(cur);
      }
    }
    const nextKind = order[(order.indexOf(String(cur)) + 1) % order.length];
    setSleep(nextKind);
  }

  // Player options sheet (opened from the tune button in the mini player).
  // v1.5.4: one action per row — the sleep timer (tap to pick a preset in a
  // dedicated sheet) and downloading the current song for offline, plus the
  // add-to-YT actions when an account is connected. The player-look picker
  // moved out of here (it lives in Settings → Appearance where the rest of
  // the theming is, and this sheet was scrolling under it).
  function sleepStatusLabel() {
    const s = state.sleep || { mode: "off", until: 0 };
    if (s.mode === "track") return "End of this track";
    if (s.mode === "mins") {
      const remSec = Math.max(0, Math.ceil((s.until - Date.now()) / 1000));
      if (!remSec) return "Off";
      const mins = Math.floor(remSec / 60);
      const secs = remSec % 60;
      return `Stops in ${mins}:${secs < 10 ? "0" : ""}${secs} (${Math.max(1, Math.ceil(remSec / 60))} min left)`;
    }
    return "Off";
  }
  function openSleepTimerSheet() {
    const sleep = ["off", "5", "10", "15", "30", "45", "60", "90", "track"];
    const curSleep = state.sleep.mode === "track"
      ? "track"
      : state.sleep.mode === "mins"
        ? (state.sleep.preset || String(Math.round((state.sleep.until - Date.now()) / 60000)) || "off")
        : "off";
    showModal({
      title: "Sleep timer",
      body: `
        <div class="set-card">
          <p style="margin:0 0 10px">Pause playback automatically — currently: <strong id="sleepModalStatus">${escapeHTML(sleepStatusLabel())}</strong>.</p>
          <div class="po-chips">
            ${sleep.map((n) => {
              const label = n === "off" ? "Off" : n === "track" ? "End of track" : `${n} min`;
              const on = curSleep === n;
              return `<button type="button" class="chip ${on ? "active" : ""}" data-po-sleep="${n}">${label}</button>`;
            }).join("")}
          </div>
        </div>`,
      ok: "Close",
      onOk: () => {},
    });
    $("modalCard").querySelectorAll("[data-po-sleep]").forEach((b) => {
      b.addEventListener("click", () => { setSleep(b.dataset.poSleep); hideModal(); });
    });
  }
  function openPlayerOptions() {
    const t = current();
    const saved = !!(t && isSaved(t));
    hookSound();
    const canDl = !!t && t.source !== "radio" && !!(t.videoId || t.trackId || t.source === "youtube" || t.source === "apple" || t.source === "itunes" || t.source === "deezer" || saved);
    const canFollow = !!(t && t.source !== "radio");
    const followingNow = !!(canFollow && isFollowing(t));
    const ytChip = ytConnected() && t && t.videoId
      ? `<div class="po-row"><div><strong>YouTube</strong><p>Add the current song to your account.</p></div>
          <div class="po-yt-actions">
            <button type="button" class="chip-btn" id="poYtLike">Like</button>
            <button type="button" class="chip-btn" id="poYtPl">Add to playlist</button>
          </div></div>`
      : "";

    showModal({
      title: "Player options",
      body: `
        <div class="set-card">
          <div class="po-row">
            <div><strong>${saved ? "Saved offline" : "Download song"}</strong><p>${
              saved ? "Already on this device — it plays without internet."
              : canDl ? "Keep this track on the device (real audio file with cover art)."
              : t && t.source === "radio" ? "Live radio can't be saved."
              : "Nothing to save for this item."}</p></div>
            ${canDl
              ? `<button type="button" class="chip-btn" id="poDl">${saved ? "✓ Saved" : "Download"}</button>`
              : ""}
          </div>
          ${t && t.source !== "radio" ? `
          <div class="po-row">
            <div><strong>Playlist &amp; Artist</strong><p>${escapeHTML(artistName(t) || t.artist || "Artist")}</p></div>
            <div class="po-yt-actions">
              <button type="button" class="chip-btn" id="poAddPl">+ Playlist</button>
              ${canFollow ? `<button type="button" class="chip-btn" id="poFollow">${followingNow ? "✓ Following" : "Follow"}</button>` : ""}
              <button type="button" class="chip-btn" id="poDetails">Details</button>
            </div>
          </div>` : ""}
          <div class="po-row">
            <div><strong>Sleep timer</strong><p>${escapeHTML(sleepStatusLabel())}</p></div>
            <button type="button" class="chip-btn" id="poSleep">Choose…</button>
          </div>
        </div>
        ${ytChip}`,
      ok: "Done",
      onOk: () => {},
    });

    $("poSleep").addEventListener("click", () => { hideModal(); openSleepTimerSheet(); });
    const poDl = $("poDl");
    if (poDl) poDl.addEventListener("click", () => { hideModal(); downloadTrack(t); });
    const poAddPl = $("poAddPl");
    if (poAddPl) poAddPl.addEventListener("click", () => { hideModal(); addToPlaylist(t); });
    const poFollow = $("poFollow");
    if (poFollow) poFollow.addEventListener("click", () => { hideModal(); toggleFollow(t); });
    const poDetails = $("poDetails");
    if (poDetails) poDetails.addEventListener("click", () => { hideModal(); openTrackDetail(t); });
    const poYtLike = $("poYtLike");
    if (poYtLike) poYtLike.addEventListener("click", () => { hideModal(); ytToggleLike(t); });
    const poYtPl = $("poYtPl");
    if (poYtPl) poYtPl.addEventListener("click", () => { hideModal(); ytAddToPlaylist(t); });
  }

  const VERIFIED_SONG_COVERS = {"28":"7060ea038f51fdeff23bc40eb5027663","360":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/cf/0b/2b/cf0b2bae-d4c1-49ce-de5c-b7c3fcd9e4cd/075679643087.jpg/500x500bb.jpg","aaj ki raat|sachin jigar":"1f8faf6b803911ad2d33ea66cacb3033","aaj ki raat":"1f8faf6b803911ad2d33ea66cacb3033","tauba tauba|karan aujla":"ff6bb1420d9fcd2671cf6f86c2e49658","tauba tauba":"ff6bb1420d9fcd2671cf6f86c2e49658","sajni|ram sampath":"407e34575dc610b6592fda6d8210be18","sajni":"407e34575dc610b6592fda6d8210be18","big dawgs|hanumankind":"2d00c5a1488deb77bc1faa958f355b54","big dawgs":"2d00c5a1488deb77bc1faa958f355b54","winning speech|karan aujla":"b6ff41520784c1c1b8cbff7925817cd8","winning speech":"b6ff41520784c1c1b8cbff7925817cd8","born to shine|diljit dosanjh":"87516b74e8e95b373c57a5b74ff2a769","born to shine":"87516b74e8e95b373c57a5b74ff2a769","husn|anuv jain":"bdcf70737dc185ef7ec866fb29591137","husn":"bdcf70737dc185ef7ec866fb29591137","jo tum mere ho|anuv jain":"d0e556f8fbdb2020f8cb4caf86611c2a","jo tum mere ho":"d0e556f8fbdb2020f8cb4caf86611c2a","akhiyaan gulaab|mitraz":"8d786df765556de281ac3c502e49f643","akhiyaan gulaab":"8d786df765556de281ac3c502e49f643","pehle bhi main|vishal mishra":"e8503eb01fce97c7427b794e8cd3c478","pehle bhi main":"e8503eb01fce97c7427b794e8cd3c478","khat|seedhe maut":"a9f93d7a3ab2ff3d1e2a6d4d1c47c105","khat":"a9f93d7a3ab2ff3d1e2a6d4d1c47c105","prarthana|kr na":"0c2035c5f905a7d31e192c2f113e2c6f","prarthana":"0c2035c5f905a7d31e192c2f113e2c6f","mirchi|divine":"209bb3f2ead009e3ea3c3265400a28cf","mirchi":"209bb3f2ead009e3ea3c3265400a28cf","maan meri jaan|king":"https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/90/9d/aa/909daa9a-3a47-9314-2855-39f5a157f1e3/5054197407734.jpg/500x500bb.jpg","maan meri jaan":"https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/90/9d/aa/909daa9a-3a47-9314-2855-39f5a157f1e3/5054197407734.jpg/500x500bb.jpg","samjho na|aditya rikhari":"8d54f8a03637b9f40ad387b6e46c8985","samjho na":"8d54f8a03637b9f40ad387b6e46c8985","wishes|hasan raheem":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/c7/e5/02/c7e50222-40be-521e-b8e0-02df1aac4fde/17535.jpg/500x500bb.jpg","wishes":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/c7/e5/02/c7e50222-40be-521e-b8e0-02df1aac4fde/17535.jpg/500x500bb.jpg","choo lo|the local train":"8b26bfc0975e7c19dc45b3a0ee9360c9","choo lo":"8b26bfc0975e7c19dc45b3a0ee9360c9","aaoge tum kabhi|the local train":"8b26bfc0975e7c19dc45b3a0ee9360c9","aaoge tum kabhi":"8b26bfc0975e7c19dc45b3a0ee9360c9","kasoor|prateek kuhad":"5703f7b99e90720b01978fbca7923e70","kasoor":"5703f7b99e90720b01978fbca7923e70","udd gaye|ritviz":"0d6a03d9ec7c93ad31203f09216cfbf1","udd gaye":"0d6a03d9ec7c93ad31203f09216cfbf1","one love|shubh":"9b315dd75419b5f893cb84a1ff2e8ef0","one love":"9b315dd75419b5f893cb84a1ff2e8ef0","king shit|shubh":"412f1e05bbbc1d5f17018e9a4e6b40ec","king shit":"412f1e05bbbc1d5f17018e9a4e6b40ec","with you|ap dhillon":"ff7878c3ecade62c69ea2e10d4ec1ce8","with you":"ff7878c3ecade62c69ea2e10d4ec1ce8","chaleya|arijit singh":"87965798331705639c8965c7fc100ffc","chaleya":"87965798331705639c8965c7fc100ffc","nadaaniyan|akshath":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b8/29/f1/b829f155-0534-0808-8a6d-f168f9df3d4a/24UMGIM56452.rgb.jpg/500x500bb.jpg","nadaaniyan":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b8/29/f1/b829f155-0534-0808-8a6d-f168f9df3d4a/24UMGIM56452.rgb.jpg/500x500bb.jpg","ishq|faheem abdullah":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/a3/04/c1/a304c107-6887-c475-8377-d05e86cfe108/cover.jpg/500x500bb.jpg","ishq":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/a3/04/c1/a304c107-6887-c475-8377-d05e86cfe108/cover.jpg/500x500bb.jpg","katchi sera|sai abhyankkar":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/80/df/08/80df0808-17e7-ab41-5972-fec5f83e3819/cover.jpg/500x500bb.jpg","katchi sera":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/80/df/08/80df0808-17e7-ab41-5972-fec5f83e3819/cover.jpg/500x500bb.jpg","illuminati|sushin shyam":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/88/4e/29/884e290c-29ed-25d5-7b25-243b89097220/cover.jpg/500x500bb.jpg","illuminati":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/88/4e/29/884e290c-29ed-25d5-7b25-243b89097220/cover.jpg/500x500bb.jpg","naina|diljit dosanjh":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/bd/7b/bf/bd7bbfbd-8711-b6da-473a-7dd35b2d753b/8901854099214.jpg/500x500bb.jpg","naina":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/bd/7b/bf/bd7bbfbd-8711-b6da-473a-7dd35b2d753b/8901854099214.jpg/500x500bb.jpg","soulmate|badshah":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/a9/c7/32/a9c732cc-d880-1ee4-ff22-d01593ac6341/24UMGIM22464.rgb.jpg/500x500bb.jpg","soulmate":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/a9/c7/32/a9c732cc-d880-1ee4-ff22-d01593ac6341/24UMGIM22464.rgb.jpg/500x500bb.jpg","millionaire|yo yo honey singh":"https://is1-ssl.mzstatic.com/image/thumb/Music128/v4/cf/cd/24/cfcd248a-cbbd-10dd-7d25-894bbf9b9f20/8902633288584.jpg/500x500bb.jpg","millionaire":"https://is1-ssl.mzstatic.com/image/thumb/Music128/v4/cf/cd/24/cfcd248a-cbbd-10dd-7d25-894bbf9b9f20/8902633288584.jpg/500x500bb.jpg","taras|sachin jigar":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/7d/91/c8/7d91c851-00b0-6d25-9af8-865c32a75393/8909024032016.png/500x500bb.jpg","taras":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/7d/91/c8/7d91c851-00b0-6d25-9af8-865c32a75393/8909024032016.png/500x500bb.jpg","khudaya|sagar bhatia":"53bdfe2ba9539665069498cf4a44da4d","khudaya":"53bdfe2ba9539665069498cf4a44da4d","soni soni|darshan raval":"86a67dbe69bd2769bf1e20f1f4a5ad27","soni soni":"86a67dbe69bd2769bf1e20f1f4a5ad27","khoobsurat|vishal mishra":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/2d/e2/f7/2de2f7e0-b66f-50e8-ba18-e0ab41bec525/198846028354.jpg/500x500bb.jpg","khoobsurat":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/2d/e2/f7/2de2f7e0-b66f-50e8-ba18-e0ab41bec525/198846028354.jpg/500x500bb.jpg","tumhare hi rahenge hum|varun jain":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/d3/37/eb/d337eb52-2663-826d-d213-335598b14743/198846005553.jpg/500x500bb.jpg","tumhare hi rahenge hum":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/d3/37/eb/d337eb52-2663-826d-d213-335598b14743/198846005553.jpg/500x500bb.jpg","aayi nai|sachin jigar":"c85e4d98787aa04833e9682f90e56fb5","aayi nai":"c85e4d98787aa04833e9682f90e56fb5","khel khel mein|guru randhawa":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/27/58/c3275887-784f-4ad4-e05d-215c5f9dfbbc/8903431009845_cover.jpg/500x500bb.jpg","khel khel mein":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/27/58/c3275887-784f-4ad4-e05d-215c5f9dfbbc/8903431009845_cover.jpg/500x500bb.jpg","hauli hauli|guru randhawa":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/27/58/c3275887-784f-4ad4-e05d-215c5f9dfbbc/8903431009845_cover.jpg/500x500bb.jpg","hauli hauli":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/27/58/c3275887-784f-4ad4-e05d-215c5f9dfbbc/8903431009845_cover.jpg/500x500bb.jpg","guli mata|saad lamjarred":"d2b0e3341b6cabf610dec963e3d527da","guli mata":"d2b0e3341b6cabf610dec963e3d527da","heeriye|jasleen royal":"6b06bbbf7c2d9c6bcb60763bccc0571d","heeriye":"6b06bbbf7c2d9c6bcb60763bccc0571d","satranga|arijit singh":"e8503eb01fce97c7427b794e8cd3c478","satranga":"e8503eb01fce97c7427b794e8cd3c478","arjan vailly|bhupinder babbal":"e8503eb01fce97c7427b794e8cd3c478","arjan vailly":"e8503eb01fce97c7427b794e8cd3c478","apna bana le|sachin jigar":"5e2aaa0f0a9b4bccfdf01c447f2e169c","apna bana le":"5e2aaa0f0a9b4bccfdf01c447f2e169c","lalkara|diljit dosanjh":"91d4d713bec4015e35798c409425e7b7","lalkara":"91d4d713bec4015e35798c409425e7b7","hass hass|diljit dosanjh":"664682cefadc721cc099f1e652276eca","hass hass":"664682cefadc721cc099f1e652276eca","softly|karan aujla":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/d3/08/bc/d308bc6a-20e1-6532-d933-35d1b429210e/5054197755538.jpg/500x500bb.jpg","softly":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/d3/08/bc/d308bc6a-20e1-6532-d933-35d1b429210e/5054197755538.jpg/500x500bb.jpg","admirin you|karan aujla":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/d3/08/bc/d308bc6a-20e1-6532-d933-35d1b429210e/5054197755538.jpg/500x500bb.jpg","admirin you":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/d3/08/bc/d308bc6a-20e1-6532-d933-35d1b429210e/5054197755538.jpg/500x500bb.jpg","idk how|karan aujla":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c2/ce/a0/c2cea088-dbde-43db-346f-e536058fdcfb/5063483978438_cover.jpg/500x500bb.jpg","idk how":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c2/ce/a0/c2cea088-dbde-43db-346f-e536058fdcfb/5063483978438_cover.jpg/500x500bb.jpg","100 million|divine":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/bf/e1/19/bfe1195d-18c3-4f40-0a18-19beef6de0ca/197190848762.jpg/500x500bb.jpg","100 million":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/bf/e1/19/bfe1195d-18c3-4f40-0a18-19beef6de0ca/197190848762.jpg/500x500bb.jpg","baazigar|divine":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/97/d9/cf/97d9cf4f-abb1-c6b0-f4ea-be275658cc9b/197338226643.jpg/500x500bb.jpg","baazigar":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/97/d9/cf/97d9cf4f-abb1-c6b0-f4ea-be275658cc9b/197338226643.jpg/500x500bb.jpg","joota japani|kr na":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/53/6e/3d/536e3d41-fe71-9b51-d242-239d3050d66a/197190909999.jpg/500x500bb.jpg","joota japani":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/53/6e/3d/536e3d41-fe71-9b51-d242-239d3050d66a/197190909999.jpg/500x500bb.jpg","namastute|seedhe maut":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/8c/3c/10/8c3c1016-be7e-666c-225d-00b671fb38e0/199066150108.jpg/500x500bb.jpg","namastute":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/8c/3c/10/8c3c1016-be7e-666c-225d-00b671fb38e0/199066150108.jpg/500x500bb.jpg","luka chuppi|seedhe maut":"a9f93d7a3ab2ff3d1e2a6d4d1c47c105","luka chuppi":"a9f93d7a3ab2ff3d1e2a6d4d1c47c105","tu hai kahan|aur":"12d66b492d1e4792fec0c4d0ad754ded","tu hai kahan":"12d66b492d1e4792fec0c4d0ad754ded","shikayat|aur":"525221c08c67990a64b3f7adb3c368c8","shikayat":"525221c08c67990a64b3f7adb3c368c8","alag aasmaan|anuv jain":"1ed1f36c80fe430ca97098f68fc074e6","alag aasmaan":"1ed1f36c80fe430ca97098f68fc074e6","baarishein|anuv jain":"b4fcda10b32a70d8b9248ca7f6459903","baarishein":"b4fcda10b32a70d8b9248ca7f6459903","co2|prateek kuhad":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/13/b2/5e/13b25e33-746d-9567-0c36-b11af5b55ab0/075679754943.jpg/500x500bb.jpg","co2":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/13/b2/5e/13b25e33-746d-9567-0c36-b11af5b55ab0/075679754943.jpg/500x500bb.jpg","dil mere|the local train":"8b26bfc0975e7c19dc45b3a0ee9360c9","dil mere":"8b26bfc0975e7c19dc45b3a0ee9360c9","khudi|the local train":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/6e/4c/59/6e4c59e9-342c-3da7-fc09-61959c95dcb5/197189936456.jpg/500x500bb.jpg","khudi":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/6e/4c/59/6e4c59e9-342c-3da7-fc09-61959c95dcb5/197189936456.jpg/500x500bb.jpg","roz|ritviz":"https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/b2/86/a6/b286a68d-3b65-499f-03f0-6f32d96f7eb7/859750782298_cover.jpg/500x500bb.jpg","roz":"https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/b2/86/a6/b286a68d-3b65-499f-03f0-6f32d96f7eb7/859750782298_cover.jpg/500x500bb.jpg","liggi|ritviz":"d5f7a76e0c682b5d17cdb9aee1aa4a14","liggi":"d5f7a76e0c682b5d17cdb9aee1aa4a14","khayaal|talwiinder":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/da/22/b8/da22b844-b237-c414-2111-79276423c340/196589947482.jpg/500x500bb.jpg","khayaal":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/da/22/b8/da22b844-b237-c414-2111-79276423c340/196589947482.jpg/500x500bb.jpg","dhundhala|yashraj":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/30/63/c3/3063c36c-8537-ce66-4451-e9de6c2a13dc/23UM1IM04836.rgb.jpg/500x500bb.jpg","dhundhala":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/30/63/c3/3063c36c-8537-ce66-4451-e9de6c2a13dc/23UM1IM04836.rgb.jpg/500x500bb.jpg","daku|chani nattan":"4f6b75ee8d72644714ae5254efb27631","daku":"4f6b75ee8d72644714ae5254efb27631","mvp|shubh":"412f1e05bbbc1d5f17018e9a4e6b40ec","mvp":"412f1e05bbbc1d5f17018e9a4e6b40ec","bandana|shubh":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/f0/79/1d/f0791dcd-5415-61b1-cd67-94660c46e189/5021732271709.jpg/500x500bb.jpg","bandana":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/f0/79/1d/f0791dcd-5415-61b1-cd67-94660c46e189/5021732271709.jpg/500x500bb.jpg","tu aake dekhle|king":"934455d83d61359aa0d904bdfe86e5f2","tu aake dekhle":"934455d83d61359aa0d904bdfe86e5f2","sarkaare|king":"04a936117dd468270341c0df589781ea","sarkaare":"04a936117dd468270341c0df589781ea","faasle|aditya rikhari":"https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/d5/29/29/d5292970-e6e4-1199-baed-22c8c9f60988/cover.jpg/500x500bb.jpg","faasle":"https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/d5/29/29/d5292970-e6e4-1199-baed-22c8c9f60988/cover.jpg/500x500bb.jpg","teri yaad|aditya rikhari":"https://is1-ssl.mzstatic.com/image/thumb/Music113/v4/3d/45/11/3d451107-117e-c7b1-340a-bb730846c3d3/23UMGIM07285.rgb.jpg/500x500bb.jpg","teri yaad":"https://is1-ssl.mzstatic.com/image/thumb/Music113/v4/3d/45/11/3d451107-117e-c7b1-340a-bb730846c3d3/23UMGIM07285.rgb.jpg/500x500bb.jpg","gulabi sadi|sanju rathod":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/13/2d/eb/132deb17-aee2-6b64-d0cc-6446c213375d/cover.jpg/500x500bb.jpg","gulabi sadi":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/13/2d/eb/132deb17-aee2-6b64-d0cc-6446c213375d/cover.jpg/500x500bb.jpg","aasa kooda|sai abhyankkar":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/39/42/ba/3942ba45-40bd-5d0a-d7ad-0595f1336f3f/cover.jpg/500x500bb.jpg","aasa kooda":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/39/42/ba/3942ba45-40bd-5d0a-d7ad-0595f1336f3f/cover.jpg/500x500bb.jpg","paon ki jutti|jyoti nooran":"6f88346b2818313ccadbde509a411832","paon ki jutti":"6f88346b2818313ccadbde509a411832","mah jinna sohna|darshan raval":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/4b/73/1e/4b731eb5-13ab-825a-d164-fc665b2f02e5/5054197730122.jpg/500x500bb.jpg","mah jinna sohna":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/4b/73/1e/4b731eb5-13ab-825a-d164-fc665b2f02e5/5054197730122.jpg/500x500bb.jpg","apt|rose":"258e6042338ce64bb4157c0c94b232ac","apt":"258e6042338ce64bb4157c0c94b232ac","luther|kendrick lamar":"da5256ff8cacfe9ad90521f6e3792259","luther":"da5256ff8cacfe9ad90521f6e3792259","tv off|kendrick lamar":"da5256ff8cacfe9ad90521f6e3792259","tv off":"da5256ff8cacfe9ad90521f6e3792259","squabble up|kendrick lamar":"da5256ff8cacfe9ad90521f6e3792259","squabble up":"da5256ff8cacfe9ad90521f6e3792259","sailor song|gigi perez":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/25/d4/96/25d49699-acc0-401f-a7cc-d7697339a474/24UM1IM03751.rgb.jpg/500x500bb.jpg","sailor song":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/25/d4/96/25d49699-acc0-401f-a7cc-d7697339a474/24UM1IM03751.rgb.jpg/500x500bb.jpg","messy|lola young":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/5a/c6/b1/5ac6b183-8ff1-55e3-fa59-8cce5db3fc87/24UMGIM52751.rgb.jpg/500x500bb.jpg","messy":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/5a/c6/b1/5ac6b183-8ff1-55e3-fa59-8cce5db3fc87/24UMGIM52751.rgb.jpg/500x500bb.jpg","that s so true|gracie abrams":"967769c4612d74e8f5c7da8798b28e13","that s so true":"967769c4612d74e8f5c7da8798b28e13","close to you|gracie abrams":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/52/9a/a7/529aa76f-5d60-cd81-9eb0-0eb521de861d/24UMGIM43968.rgb.jpg/500x500bb.jpg","close to you":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/52/9a/a7/529aa76f-5d60-cd81-9eb0-0eb521de861d/24UMGIM43968.rgb.jpg/500x500bb.jpg","denial is a river|doechii":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/5f/a3/e8/5fa3e8b9-9065-47af-63e1-f213d3074580/24UMGIM88644.rgb.jpg/500x500bb.jpg","denial is a river":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/5f/a3/e8/5fa3e8b9-9065-47af-63e1-f213d3074580/24UMGIM88644.rgb.jpg/500x500bb.jpg","nissan altima|doechii":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/ec/cc/d6/ecccd6d4-2250-5caf-a98d-1ba10baf67f5/24UMGIM88644.rgb.jpg/500x500bb.jpg","nissan altima":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/ec/cc/d6/ecccd6d4-2250-5caf-a98d-1ba10baf67f5/24UMGIM88644.rgb.jpg/500x500bb.jpg","sports car|tate mcrae":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/51/8a/29/518a29f3-5915-662a-d861-663e6d0fbfe4/196872648911.jpg/500x500bb.jpg","sports car":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/51/8a/29/518a29f3-5915-662a-d861-663e6d0fbfe4/196872648911.jpg/500x500bb.jpg","it s ok i m ok|tate mcrae":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/62/f6/6d/62f66d3b-9539-51b9-8b3a-31a7a9c598ca/196872470574.jpg/500x500bb.jpg","it s ok i m ok":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/62/f6/6d/62f66d3b-9539-51b9-8b3a-31a7a9c598ca/196872470574.jpg/500x500bb.jpg","the emptiness machine|linkin park":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/85/cf/a1/85cfa1ed-d8f6-d021-2a9e-cb541b2bbe87/artwork.jpg/500x500bb.jpg","the emptiness machine":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/85/cf/a1/85cfa1ed-d8f6-d021-2a9e-cb541b2bbe87/artwork.jpg/500x500bb.jpg","heavy is the crown|linkin park":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/69/21/cf/6921cff3-7074-118a-ece2-4012450e6c75/093624839811.jpg/500x500bb.jpg","heavy is the crown":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/69/21/cf/6921cff3-7074-118a-ece2-4012450e6c75/093624839811.jpg/500x500bb.jpg","love somebody|morgan wallen":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/0e/6d/e1/0e6de152-3ff5-84a3-7ce7-7dfbdcb2c3e1/24UMGIM96374.rgb.jpg/500x500bb.jpg","love somebody":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/0e/6d/e1/0e6de152-3ff5-84a3-7ce7-7dfbdcb2c3e1/24UMGIM96374.rgb.jpg/500x500bb.jpg","lies lies lies|morgan wallen":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/0e/6d/e1/0e6de152-3ff5-84a3-7ce7-7dfbdcb2c3e1/24UMGIM96374.rgb.jpg/500x500bb.jpg","lies lies lies":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/0e/6d/e1/0e6de152-3ff5-84a3-7ce7-7dfbdcb2c3e1/24UMGIM96374.rgb.jpg/500x500bb.jpg","timeless|the weeknd":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/9f/c8/c39fc847-2d00-1b7f-7327-264436bd9957/24UM1IM21421.rgb.jpg/500x500bb.jpg","timeless":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/9f/c8/c39fc847-2d00-1b7f-7327-264436bd9957/24UM1IM21421.rgb.jpg/500x500bb.jpg","dancing in the flames|the weeknd":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/9f/c8/c39fc847-2d00-1b7f-7327-264436bd9957/24UM1IM21421.rgb.jpg/500x500bb.jpg","dancing in the flames":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/9f/c8/c39fc847-2d00-1b7f-7327-264436bd9957/24UM1IM21421.rgb.jpg/500x500bb.jpg","abracadabra|lady gaga":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/c5/43/8b/c5438b81-75e8-3a0a-05ee-4f29ae0b9bb3/25UMGIM07433.rgb.jpg/500x500bb.jpg","abracadabra":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/c5/43/8b/c5438b81-75e8-3a0a-05ee-4f29ae0b9bb3/25UMGIM07433.rgb.jpg/500x500bb.jpg","disease|lady gaga":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/c5/43/8b/c5438b81-75e8-3a0a-05ee-4f29ae0b9bb3/25UMGIM07433.rgb.jpg/500x500bb.jpg","disease":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/c5/43/8b/c5438b81-75e8-3a0a-05ee-4f29ae0b9bb3/25UMGIM07433.rgb.jpg/500x500bb.jpg","sticky|tyler":"https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/6d/31/ab/6d31abaf-7a07-05f1-13ad-72ec520b6bfb/22UMGIM67374.rgb.jpg/500x500bb.jpg","sticky":"https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/6d/31/ab/6d31abaf-7a07-05f1-13ad-72ec520b6bfb/22UMGIM67374.rgb.jpg/500x500bb.jpg","st chroma|tyler":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b6/ef/ee/b6efeefa-fc99-37d1-ad21-0d769b2a4958/196872796971.jpg/500x500bb.jpg","st chroma":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b6/ef/ee/b6efeefa-fc99-37d1-ad21-0d769b2a4958/196872796971.jpg/500x500bb.jpg","wildflower|billie eilish":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/92/9f/69/929f69f1-9977-3a44-d674-11f70c852d1b/24UMGIM36186.rgb.jpg/500x500bb.jpg","wildflower":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/92/9f/69/929f69f1-9977-3a44-d674-11f70c852d1b/24UMGIM36186.rgb.jpg/500x500bb.jpg","chihiro|billie eilish":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/92/9f/69/929f69f1-9977-3a44-d674-11f70c852d1b/24UMGIM36186.rgb.jpg/500x500bb.jpg","chihiro":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/92/9f/69/929f69f1-9977-3a44-d674-11f70c852d1b/24UMGIM36186.rgb.jpg/500x500bb.jpg","bed chem|sabrina carpenter":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/f6/15/d0/f615d0ab-e0c4-575d-907e-1cc084642357/24UMGIM61704.rgb.jpg/500x500bb.jpg","bed chem":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/f6/15/d0/f615d0ab-e0c4-575d-907e-1cc084642357/24UMGIM61704.rgb.jpg/500x500bb.jpg","juno|sabrina carpenter":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/a1/1c/ca/a11ccab6-7d4c-e041-d028-998bcebeb709/24UMGIM61704.rgb.jpg/500x500bb.jpg","juno":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/a1/1c/ca/a11ccab6-7d4c-e041-d028-998bcebeb709/24UMGIM61704.rgb.jpg/500x500bb.jpg","pink pony club|chappell roan":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/41/bc/fb/41bcfb43-91d5-931d-5747-fb381803143f/23UMGIM21715.rgb.jpg/500x500bb.jpg","pink pony club":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/41/bc/fb/41bcfb43-91d5-931d-5747-fb381803143f/23UMGIM21715.rgb.jpg/500x500bb.jpg","hot to go|chappell roan":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/fb/65/cb/fb65cb0f-4260-d740-d6f5-bb80c9c27c1b/23UMGIM84225.rgb.jpg/500x500bb.jpg","hot to go":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/fb/65/cb/fb65cb0f-4260-d740-d6f5-bb80c9c27c1b/23UMGIM84225.rgb.jpg/500x500bb.jpg","diet pepsi|addison rae":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/01/ef/7a/01ef7a06-1b48-0460-efbf-983d6a0a37fa/196872309959.jpg/500x500bb.jpg","diet pepsi":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/01/ef/7a/01ef7a06-1b48-0460-efbf-983d6a0a37fa/196872309959.jpg/500x500bb.jpg","ordinary|alex warren":"f4246416b5e3e71a35adf1e2cbe98bfb","ordinary":"f4246416b5e3e71a35adf1e2cbe98bfb","carry you home|alex warren":"f4246416b5e3e71a35adf1e2cbe98bfb","carry you home":"f4246416b5e3e71a35adf1e2cbe98bfb","back to friends|sombr":"37a20b62f754b7ff5a9a29a8f2fe9d27","back to friends":"37a20b62f754b7ff5a9a29a8f2fe9d27","undressed|sombr":"37a20b62f754b7ff5a9a29a8f2fe9d27","undressed":"37a20b62f754b7ff5a9a29a8f2fe9d27","mutts|leon thomas":"1c318762a31c79bd28e9f7951bdab5b4","mutts":"1c318762a31c79bd28e9f7951bdab5b4","tgif|glorilla":"a65e86966cfd34b2aa292856136ef9ac","tgif":"a65e86966cfd34b2aa292856136ef9ac","whatchu kno about me|glorilla":"a65e86966cfd34b2aa292856136ef9ac","whatchu kno about me":"a65e86966cfd34b2aa292856136ef9ac","360|charli xcx":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/cf/0b/2b/cf0b2bae-d4c1-49ce-de5c-b7c3fcd9e4cd/075679643087.jpg/500x500bb.jpg","von dutch|charli xcx":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/cf/0b/2b/cf0b2bae-d4c1-49ce-de5c-b7c3fcd9e4cd/075679643087.jpg/500x500bb.jpg","von dutch":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/cf/0b/2b/cf0b2bae-d4c1-49ce-de5c-b7c3fcd9e4cd/075679643087.jpg/500x500bb.jpg","guess|charli xcx":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/cf/0b/2b/cf0b2bae-d4c1-49ce-de5c-b7c3fcd9e4cd/075679643087.jpg/500x500bb.jpg","guess":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/cf/0b/2b/cf0b2bae-d4c1-49ce-de5c-b7c3fcd9e4cd/075679643087.jpg/500x500bb.jpg","where you are|john summit":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/26/86/a9/2686a9dc-0a17-8e7f-82e3-9bb7c53c1494/23UMGIM19042.rgb.jpg/500x500bb.jpg","where you are":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/26/86/a9/2686a9dc-0a17-8e7f-82e3-9bb7c53c1494/23UMGIM19042.rgb.jpg/500x500bb.jpg","shiver|john summit":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/e7/21/67/e721675b-c3a3-9338-bf24-9adb295b7e90/24UMGIM58701.rgb.jpg/500x500bb.jpg","shiver":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/e7/21/67/e721675b-c3a3-9338-bf24-9adb295b7e90/24UMGIM58701.rgb.jpg/500x500bb.jpg","places to be|fred again":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/fc/e8/81/fce8814b-c3c2-3cf1-8294-791326b9801e/cover.jpg/500x500bb.jpg","places to be":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/fc/e8/81/fce8814b-c3c2-3cf1-8294-791326b9801e/cover.jpg/500x500bb.jpg","band4band|central cee":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/e1/2d/c5/e12dc546-b50d-5a06-58cf-94227b0c78b9/196872154931.jpg/500x500bb.jpg","band4band":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/e1/2d/c5/e12dc546-b50d-5a06-58cf-94227b0c78b9/196872154931.jpg/500x500bb.jpg","did it first|ice spice":"8508be30ca355ef44597e9be0f834232","did it first":"8508be30ca355ef44597e9be0f834232","kehlani|jordan adetunji":"1c318762a31c79bd28e9f7951bdab5b4","kehlani":"1c318762a31c79bd28e9f7951bdab5b4","after hours|kehlani":"1c318762a31c79bd28e9f7951bdab5b4","after hours":"1c318762a31c79bd28e9f7951bdab5b4","bmf|sza":"992cc838b5f0cf0eebbd83011a979571","bmf":"992cc838b5f0cf0eebbd83011a979571","30 for 30|sza":"992cc838b5f0cf0eebbd83011a979571","30 for 30":"992cc838b5f0cf0eebbd83011a979571","pink skies|zach bryan":"7060ea038f51fdeff23bc40eb5027663","pink skies":"7060ea038f51fdeff23bc40eb5027663","28|zach bryan":"7060ea038f51fdeff23bc40eb5027663","ain t no love in oklahoma|luke combs":"473abf39f40221437fb7c590e36b7282","ain t no love in oklahoma":"473abf39f40221437fb7c590e36b7282","pour me a drink|post malone":"473abf39f40221437fb7c590e36b7282","pour me a drink":"473abf39f40221437fb7c590e36b7282","guy for that|post malone":"473abf39f40221437fb7c590e36b7282","guy for that":"473abf39f40221437fb7c590e36b7282","i am not okay|jelly roll":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/95/b9/ca/95b9ca00-29cb-8edc-1ecb-5bda742f3177/24UMGIM62166.rgb.jpg/500x500bb.jpg","i am not okay":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/95/b9/ca/95b9ca00-29cb-8edc-1ecb-5bda742f3177/24UMGIM62166.rgb.jpg/500x500bb.jpg","good news|shaboozey":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/23/f2/d9/23f2d96d-b842-5f8b-1a09-bcc9a5cf7032/197342797344_cover.jpg/500x500bb.jpg","good news":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/23/f2/d9/23f2d96d-b842-5f8b-1a09-bcc9a5cf7032/197342797344_cover.jpg/500x500bb.jpg","austin boots stop workin|dasha":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/85/b5/b0/85b5b00b-ca94-dfa1-a3cf-2da4a1e3dd39/054391277657.jpg/500x500bb.jpg","austin boots stop workin":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/85/b5/b0/85b5b00b-ca94-dfa1-a3cf-2da4a1e3dd39/054391277657.jpg/500x500bb.jpg","wind up missin you|tucker wetmore":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/a1/54/e2/a154e275-9a98-3491-26cf-a1c6f3fb4ea1/24UMGIM54949.rgb.jpg/500x500bb.jpg","wind up missin you":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/a1/54/e2/a154e275-9a98-3491-26cf-a1c6f3fb4ea1/24UMGIM54949.rgb.jpg/500x500bb.jpg","am i okay|megan moroney":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/de/2a/43/de2a438b-bb7c-16db-64db-954057aca5aa/196872040302.jpg/500x500bb.jpg","am i okay":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/de/2a/43/de2a438b-bb7c-16db-64db-954057aca5aa/196872040302.jpg/500x500bb.jpg","juna|clairo":"6dfa4ea965a74b93870a85daa74b7ca3","juna":"6dfa4ea965a74b93870a85daa74b7ca3","nomad|clairo":"6dfa4ea965a74b93870a85daa74b7ca3","nomad":"6dfa4ea965a74b93870a85daa74b7ca3","take a bite|beabadoobee":"6dfa4ea965a74b93870a85daa74b7ca3","take a bite":"6dfa4ea965a74b93870a85daa74b7ca3","beaches|beabadoobee":"6dfa4ea965a74b93870a85daa74b7ca3","beaches":"6dfa4ea965a74b93870a85daa74b7ca3","sally when the wine runs out|role model":"6dfa4ea965a74b93870a85daa74b7ca3","sally when the wine runs out":"6dfa4ea965a74b93870a85daa74b7ca3","love me not|ravyn lenae":"1c318762a31c79bd28e9f7951bdab5b4","love me not":"1c318762a31c79bd28e9f7951bdab5b4","chest pain i love|malcolm todd":"37a20b62f754b7ff5a9a29a8f2fe9d27","chest pain i love":"37a20b62f754b7ff5a9a29a8f2fe9d27","alesis|mk gee":"37a20b62f754b7ff5a9a29a8f2fe9d27","alesis":"37a20b62f754b7ff5a9a29a8f2fe9d27","i like the way you kiss me|artemas":"ee890cf16d00c684be76b0087c7108c4","i like the way you kiss me":"ee890cf16d00c684be76b0087c7108c4","favourite|fontaines d c":"1e8ffbd401303b5693226c12ee0b84fb","favourite":"1e8ffbd401303b5693226c12ee0b84fb","starburster|fontaines d c":"1e8ffbd401303b5693226c12ee0b84fb","starburster":"1e8ffbd401303b5693226c12ee0b84fb","people watching|sam fender":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/bd/8c/24/bd8c2468-7978-cace-67b1-e0b3e5a643b8/24UM1IM05583.rgb.jpg/500x500bb.jpg","people watching":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/bd/8c/24/bd8c2468-7978-cace-67b1-e0b3e5a643b8/24UM1IM05583.rgb.jpg/500x500bb.jpg","nothing matters|the last dinner party":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/69/74/ab/6974abd9-0415-aa60-240c-b2fac4c62e1b/23UMGIM23237.rgb.jpg/500x500bb.jpg","nothing matters":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/69/74/ab/6974abd9-0415-aa60-240c-b2fac4c62e1b/23UMGIM23237.rgb.jpg/500x500bb.jpg","the summoning|sleep token":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/e2/c6/0f/e2c60f68-7cec-fa08-6dd3-891aa72c247e/5401148000849_cover.jpg/500x500bb.jpg","the summoning":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/e2/c6/0f/e2c60f68-7cec-fa08-6dd3-891aa72c247e/5401148000849_cover.jpg/500x500bb.jpg","just pretend|bad omens":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/f0/ce/0d/f0ce0d9c-934d-770d-e62f-74564fc410e1/00810016765424_Cover.jpg/500x500bb.jpg","just pretend":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/f0/ce/0d/f0ce0d9c-934d-770d-e62f-74564fc410e1/00810016765424_Cover.jpg/500x500bb.jpg","slow it down|benson boone":"e8947b2a3e00fde8763011ebee2a02fd","slow it down":"e8947b2a3e00fde8763011ebee2a02fd","bad dreams|teddy swims":"f4246416b5e3e71a35adf1e2cbe98bfb","bad dreams":"f4246416b5e3e71a35adf1e2cbe98bfb","the door|teddy swims":"f4246416b5e3e71a35adf1e2cbe98bfb","the door":"f4246416b5e3e71a35adf1e2cbe98bfb","from the start|laufey":"6dfa4ea965a74b93870a85daa74b7ca3","from the start":"6dfa4ea965a74b93870a85daa74b7ca3","goddess|laufey":"6dfa4ea965a74b93870a85daa74b7ca3","goddess":"6dfa4ea965a74b93870a85daa74b7ca3","whiplash|aespa":"258e6042338ce64bb4157c0c94b232ac","whiplash":"258e6042338ce64bb4157c0c94b232ac","mantra|jennie":"258e6042338ce64bb4157c0c94b232ac","mantra":"258e6042338ce64bb4157c0c94b232ac","chk chk boom|stray kids":"258e6042338ce64bb4157c0c94b232ac","chk chk boom":"258e6042338ce64bb4157c0c94b232ac","magnetic|illit":"258e6042338ce64bb4157c0c94b232ac","magnetic":"258e6042338ce64bb4157c0c94b232ac","bling bang bang born|creepy nuts":"74a47f9832735b37a41d8fd49cd23354","bling bang bang born":"74a47f9832735b37a41d8fd49cd23354","otonoke|creepy nuts":"74a47f9832735b37a41d8fd49cd23354","otonoke":"74a47f9832735b37a41d8fd49cd23354","lilac|mrs green apple":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/4c/3b/b2/4c3bb247-3be8-0c57-aa9a-7f1775a7b7a8/24UMGIM32931.rgb.jpg/500x500bb.jpg","lilac":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/4c/3b/b2/4c3bb247-3be8-0c57-aa9a-7f1775a7b7a8/24UMGIM32931.rgb.jpg/500x500bb.jpg","ozaka|rema":"cb415a59a7bc198ec4aab01f02600691","ozaka":"cb415a59a7bc198ec4aab01f02600691","active|asake":"https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/dc/b7/78/dcb7782e-3100-b227-ed40-985954cfc6c8/artwork.jpg/500x500bb.jpg","active":"https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/dc/b7/78/dcb7782e-3100-b227-ed40-985954cfc6c8/artwork.jpg/500x500bb.jpg","kese dance|wizkid":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/82/60/3b/82603b3c-1aad-6e37-3b81-d5451046accf/196872637434.jpg/500x500bb.jpg","kese dance":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/82/60/3b/82603b3c-1aad-6e37-3b81-d5451046accf/196872637434.jpg/500x500bb.jpg","push 2 start|tyla":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/2a/cc/48/2acc48c7-e092-6b83-ce65-ff80ac6eb51c/196872520118.jpg/500x500bb.jpg","push 2 start":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/2a/cc/48/2acc48c7-e092-6b83-ce65-ff80ac6eb51c/196872520118.jpg/500x500bb.jpg","tshwala bam|titom":"e70f7518f5dbe0b0be643cbabc87ca4b","tshwala bam":"e70f7518f5dbe0b0be643cbabc87ca4b","si antes te hubiera conocido|karol g":"2a769f6f0cce0ca9e129ce4b61f83973","si antes te hubiera conocido":"2a769f6f0cce0ca9e129ce4b61f83973","dtmf|bad bunny":"e4b16c1afe136140bba34368357e8f05","dtmf":"e4b16c1afe136140bba34368357e8f05","baile inolvidable|bad bunny":"e4b16c1afe136140bba34368357e8f05","baile inolvidable":"e4b16c1afe136140bba34368357e8f05","pantropiko|bini":"0fd6e3b346b959a8781ccfa89b63607a","pantropiko":"0fd6e3b346b959a8781ccfa89b63607a","salamin salamin|bini":"0fd6e3b346b959a8781ccfa89b63607a","salamin salamin":"0fd6e3b346b959a8781ccfa89b63607a","dilaw|maki":"37a20b62f754b7ff5a9a29a8f2fe9d27","dilaw":"37a20b62f754b7ff5a9a29a8f2fe9d27","palagi|tj monterde":"f4246416b5e3e71a35adf1e2cbe98bfb","palagi":"f4246416b5e3e71a35adf1e2cbe98bfb","2 hands|tate mcrae":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/62/f6/6d/62f66d3b-9539-51b9-8b3a-31a7a9c598ca/196872470574.jpg/500x500bb.jpg","2 hands":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/62/f6/6d/62f66d3b-9539-51b9-8b3a-31a7a9c598ca/196872470574.jpg/500x500bb.jpg","the giver|chappell roan":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/fb/65/cb/fb65cb0f-4260-d740-d6f5-bb80c9c27c1b/23UMGIM84225.rgb.jpg/500x500bb.jpg","the giver":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/fb/65/cb/fb65cb0f-4260-d740-d6f5-bb80c9c27c1b/23UMGIM84225.rgb.jpg/500x500bb.jpg","cry for me|the weeknd":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/13/fd/a3/13fda38d-fc63-ddc3-1cf2-c09251adc532/25UMGIM09489.rgb.jpg/500x500bb.jpg","cry for me":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/13/fd/a3/13fda38d-fc63-ddc3-1cf2-c09251adc532/25UMGIM09489.rgb.jpg/500x500bb.jpg","sao paulo|the weeknd":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/9f/c8/c39fc847-2d00-1b7f-7327-264436bd9957/24UM1IM21421.rgb.jpg/500x500bb.jpg","sao paulo":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/9f/c8/c39fc847-2d00-1b7f-7327-264436bd9957/24UM1IM21421.rgb.jpg/500x500bb.jpg","nokia|drake":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/23/7c/a2/237ca270-9926-4b78-be81-410b6fc85f47/50291.jpg/500x500bb.jpg","nokia":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/23/7c/a2/237ca270-9926-4b78-be81-410b6fc85f47/50291.jpg/500x500bb.jpg","gimme a hug|drake":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/23/7c/a2/237ca270-9926-4b78-be81-410b6fc85f47/50291.jpg/500x500bb.jpg","gimme a hug":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/23/7c/a2/237ca270-9926-4b78-be81-410b6fc85f47/50291.jpg/500x500bb.jpg","darling i|tyler":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b6/ef/ee/b6efeefa-fc99-37d1-ad21-0d769b2a4958/196872796971.jpg/500x500bb.jpg","darling i":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b6/ef/ee/b6efeefa-fc99-37d1-ad21-0d769b2a4958/196872796971.jpg/500x500bb.jpg","like him|tyler":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b6/ef/ee/b6efeefa-fc99-37d1-ad21-0d769b2a4958/196872796971.jpg/500x500bb.jpg","like him":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b6/ef/ee/b6efeefa-fc99-37d1-ad21-0d769b2a4958/196872796971.jpg/500x500bb.jpg","revolving door|tate mcrae":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/62/f6/6d/62f66d3b-9539-51b9-8b3a-31a7a9c598ca/196872470574.jpg/500x500bb.jpg","revolving door":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/62/f6/6d/62f66d3b-9539-51b9-8b3a-31a7a9c598ca/196872470574.jpg/500x500bb.jpg","number one girl|rose":"258e6042338ce64bb4157c0c94b232ac","number one girl":"258e6042338ce64bb4157c0c94b232ac","toxic till the end|rose":"258e6042338ce64bb4157c0c94b232ac","toxic till the end":"258e6042338ce64bb4157c0c94b232ac","born again|lisa":"258e6042338ce64bb4157c0c94b232ac","born again":"258e6042338ce64bb4157c0c94b232ac","new woman|lisa":"258e6042338ce64bb4157c0c94b232ac","new woman":"258e6042338ce64bb4157c0c94b232ac","love hangover|jennie":"258e6042338ce64bb4157c0c94b232ac","love hangover":"258e6042338ce64bb4157c0c94b232ac","extral|jennie":"258e6042338ce64bb4157c0c94b232ac","extral":"258e6042338ce64bb4157c0c94b232ac","stargazing|myles smith":"f4246416b5e3e71a35adf1e2cbe98bfb","stargazing":"f4246416b5e3e71a35adf1e2cbe98bfb","nice to meet you|myles smith":"f4246416b5e3e71a35adf1e2cbe98bfb","nice to meet you":"f4246416b5e3e71a35adf1e2cbe98bfb","fable|gigi perez":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/21/6f/68/216f6844-711c-84ea-a041-3f37635f6688/24UM1IM12889.rgb.jpg/500x500bb.jpg","fable":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/21/6f/68/216f6844-711c-84ea-a041-3f37635f6688/24UM1IM12889.rgb.jpg/500x500bb.jpg","two faced|linkin park":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/cd/7b/91/cd7b9189-5c62-5f99-c39a-e268a31ec7c2/093624821380.jpg/500x500bb.jpg","two faced":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/cd/7b/91/cd7b9189-5c62-5f99-c39a-e268a31ec7c2/093624821380.jpg/500x500bb.jpg","high road|koe wetzel":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/a1/5a/2c/a15a2c42-ce9c-8c47-2b68-8cff0ab75708/196872445718.jpg/500x500bb.jpg","high road":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/a1/5a/2c/a15a2c42-ce9c-8c47-2b68-8cff0ab75708/196872445718.jpg/500x500bb.jpg","liar|jelly roll":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/95/b9/ca/95b9ca00-29cb-8edc-1ecb-5bda742f3177/24UMGIM62166.rgb.jpg/500x500bb.jpg","liar":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/95/b9/ca/95b9ca00-29cb-8edc-1ecb-5bda742f3177/24UMGIM62166.rgb.jpg/500x500bb.jpg","4x4xu|lainey wilson":"473abf39f40221437fb7c590e36b7282","4x4xu":"473abf39f40221437fb7c590e36b7282","i never lie|zach top":"7060ea038f51fdeff23bc40eb5027663","i never lie":"7060ea038f51fdeff23bc40eb5027663","kiss my boots|bakar":"37a20b62f754b7ff5a9a29a8f2fe9d27","kiss my boots":"37a20b62f754b7ff5a9a29a8f2fe9d27","kisses|bl3ss":"e70f7518f5dbe0b0be643cbabc87ca4b","kisses":"e70f7518f5dbe0b0be643cbabc87ca4b","somedays|sonny fodera":"e70f7518f5dbe0b0be643cbabc87ca4b","somedays":"e70f7518f5dbe0b0be643cbabc87ca4b","espresso|sabrina carpenter":"e3221287a77eb262944e6528766eeba4","espresso":"e3221287a77eb262944e6528766eeba4","blinding lights|the weeknd":"fd00ebd6d30d7253f813dba3bb1c66a9","blinding lights":"fd00ebd6d30d7253f813dba3bb1c66a9","levitating|dua lipa":"f8364f090ba04f1b19b381ec0390f3e4","levitating":"f8364f090ba04f1b19b381ec0390f3e4","as it was|harry styles":"b0e936124f59e669ddba02ebe5893f95","as it was":"b0e936124f59e669ddba02ebe5893f95","cruel summer|taylor swift":"6111c5ab9729c8eac47883e4e50e9cf8","cruel summer":"6111c5ab9729c8eac47883e4e50e9cf8","we can t be friends wait for your love|ariana grande":"9349b2fcb4bd060060a33f054a619e83","we can t be friends wait for your love":"9349b2fcb4bd060060a33f054a619e83","vampire|olivia rodrigo":"4bb79214365c0049e031f5e2caae4752","vampire":"4bb79214365c0049e031f5e2caae4752","greedy|tate mcrae":"ef25b6bec265332a059879f45d33cd7e","greedy":"ef25b6bec265332a059879f45d33cd7e","flowers|miley cyrus":"98610629a40996b61b3d24bd5ab8c2e1","flowers":"98610629a40996b61b3d24bd5ab8c2e1","shape of you|ed sheeran":"107c2b43f10c249077c1f7618563bb63","shape of you":"107c2b43f10c249077c1f7618563bb63","attention|charlie puth":"da7eb4c99604b2fda5f123aba3897850","attention":"da7eb4c99604b2fda5f123aba3897850","bad guy|billie eilish":"6630083f454d48eadb6a9b53f035d734","bad guy":"6630083f454d48eadb6a9b53f035d734","24k magic|bruno mars":"012b27906b430a37ec1d8f793d5c4fa6","24k magic":"012b27906b430a37ec1d8f793d5c4fa6","anti hero|taylor swift":"f571cb780b339ec087201b1cea53c3d9","anti hero":"f571cb780b339ec087201b1cea53c3d9","watermelon sugar|harry styles":"346c524c15ecccbc4a8a78e8972a352c","watermelon sugar":"346c524c15ecccbc4a8a78e8972a352c","please please please|sabrina carpenter":"0fd6e3b346b959a8781ccfa89b63607a","please please please":"0fd6e3b346b959a8781ccfa89b63607a","save your tears|the weeknd":"fd00ebd6d30d7253f813dba3bb1c66a9","save your tears":"fd00ebd6d30d7253f813dba3bb1c66a9","houdini|dua lipa":"12c05200e9097af48e0ad4fc259cee25","houdini":"12c05200e9097af48e0ad4fc259cee25","into you|ariana grande":"1a8f399e9ddbb8ec2530232c0dfd953f","into you":"1a8f399e9ddbb8ec2530232c0dfd953f","deja vu|olivia rodrigo":"e68da86fd7976135c2d2d1715afaef7c","deja vu":"e68da86fd7976135c2d2d1715afaef7c","shivers|ed sheeran":"82f1bc61739e54407f05674256747ae4","shivers":"82f1bc61739e54407f05674256747ae4","stay|the kid laroi":"dd6fe7fa9267185c4b835bd4f155d1d2","stay":"dd6fe7fa9267185c4b835bd4f155d1d2","there s nothing holdin me back|shawn mendes":"35d5f7dd0b398bb37287b3454f0b05b9","there s nothing holdin me back":"35d5f7dd0b398bb37287b3454f0b05b9","rush|troye sivan":"025b8f193e9cb37b15c857956938ae4f","rush":"025b8f193e9cb37b15c857956938ae4f","not like us|kendrick lamar":"84345d29bc2ed8e713112425f8417e97","not like us":"84345d29bc2ed8e713112425f8417e97","sicko mode|travis scott":"b6fcb2355d00296ca037f17ed3463b40","sicko mode":"b6fcb2355d00296ca037f17ed3463b40","god s plan|drake":"b69d3bcbd130ad4cc9259de543889e30","god s plan":"b69d3bcbd130ad4cc9259de543889e30","like that|future":"2d20cf6d65607e406213afbb3b62ce0d","like that":"2d20cf6d65607e406213afbb3b62ce0d","no role modelz|j cole":"f45c8916970597d390313833a9db0c61","no role modelz":"f45c8916970597d390313833a9db0c61","redrum|21 savage":"d1efd9562706fbc4facf4e86cbe78be4","redrum":"d1efd9562706fbc4facf4e86cbe78be4","fe n|travis scott":"6d7164fecb39ddee0cb15952e750d907","fe n":"6d7164fecb39ddee0cb15952e750d907","superhero heroes villains|metro boomin":"862ab860ff69c30deeb5979db6e46b62","superhero heroes villains":"862ab860ff69c30deeb5979db6e46b62","earfquake|tyler":"041ab5ceb6fb6ebf9512966835be9e1b","earfquake":"041ab5ceb6fb6ebf9512966835be9e1b","praise the lord da shine|a ap rocky":"f3b412a4f69c59dfb46583a93995f565","praise the lord da shine":"f3b412a4f69c59dfb46583a93995f565","sprinter|dave":"d8cd79f825f1a87ec86443c934556df7","sprinter":"d8cd79f825f1a87ec86443c934556df7","lovin on me|jack harlow":"6d4d4cbd4990a644a184b5f64ee01ebf","lovin on me":"6d4d4cbd4990a644a184b5f64ee01ebf","bandit|don toliver":"bd7465c9bc2e952c83c7f168579aefcb","bandit":"bd7465c9bc2e952c83c7f168579aefcb","fukumean|gunna":"35446b14e181f0a3fe415c06fec08d0b","fukumean":"35446b14e181f0a3fe415c06fec08d0b","family ties|baby keem":"0681d0925e8463d1e7ad2377793cea81","family ties":"0681d0925e8463d1e7ad2377793cea81","first person shooter|drake":"868162e87da67d647789ed7b6456840c","first person shooter":"868162e87da67d647789ed7b6456840c","xo tour llif3|lil uzi vert":"77d464b429890070fecdf853bbe426ff","xo tour llif3":"77d464b429890070fecdf853bbe426ff","mask off|future":"5186078c5bd5623ebec9b2753d8aaebe","mask off":"5186078c5bd5623ebec9b2753d8aaebe","rockstar|post malone":"c000a4d39f31f3716bf3f11aa5fab080","rockstar":"c000a4d39f31f3716bf3f11aa5fab080","surround sound|jid":"52c49df999ccf2844238672acccf2b7b","surround sound":"52c49df999ccf2844238672acccf2b7b","money trees|kendrick lamar":"b5be27644d505bad7bdb516fe4165475","money trees":"b5be27644d505bad7bdb516fe4165475","drip too hard|lil baby":"3d845a35fd7849630324107baf07657b","drip too hard":"3d845a35fd7849630324107baf07657b","middle child|j cole":"9a0366a17a65c8479901b292a4077507","middle child":"9a0366a17a65c8479901b292a4077507","see you again|tyler":"a7a16b8f63b1ec0e9fbd327619966737","see you again":"a7a16b8f63b1ec0e9fbd327619966737","snooze|sza":"328d68300e654b21831b261e413780e0","snooze":"328d68300e654b21831b261e413780e0","pink white|frank ocean":"f798a866107715dd6dc1049e498ce21f","pink white":"f798a866107715dd6dc1049e498ce21f","best part|daniel caesar":"4dff56488d13d0b5e96d93d895c9624b","best part":"4dff56488d13d0b5e96d93d895c9624b","leave the door open|silk sonic":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/c5/33/dc/c533dc8e-2baa-94f9-22be-e6e28945f932/075679754134.jpg/500x500bb.jpg","leave the door open":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/c5/33/dc/c533dc8e-2baa-94f9-22be-e6e28945f932/075679754134.jpg/500x500bb.jpg","heartbreak anniversary|giveon":"5db10a9a3170871f3f4f9bbd01029b9a","heartbreak anniversary":"5db10a9a3170871f3f4f9bbd01029b9a","gravity|brent faiyaz":"51d0d130671262611c927bd63c192670","gravity":"51d0d130671262611c927bd63c192670","girls need love|summer walker":"4ba5878f51f5aa6f1995b2ba72878f0a","girls need love":"4ba5878f51f5aa6f1995b2ba72878f0a","exchange|bryson tiller":"adde8485c3484a602f8f8a51d954b4ba","exchange":"adde8485c3484a602f8f8a51d954b4ba","kill bill|sza":"328d68300e654b21831b261e413780e0","kill bill":"328d68300e654b21831b261e413780e0","sure thing|miguel":"23f94611c678b0c16b2a8336fa420e3f","sure thing":"23f94611c678b0c16b2a8336fa420e3f","nights like this|kehlani":"38f53c7ad2ef060d90f500a597e0f2f5","nights like this":"38f53c7ad2ef060d90f500a597e0f2f5","on my mama|victoria monet":"2c64ab2309b86a1c96896193ac833c40","on my mama":"2c64ab2309b86a1c96896193ac833c40","i want you around|snoh aalegra":"45579005ac5285cb351e5e7414267f82","i want you around":"45579005ac5285cb351e5e7414267f82","sativa|jhene aiko":"ad84a421d7190381989ea7a04f897381","sativa":"ad84a421d7190381989ea7a04f897381","die for you|the weeknd":"134778e4c4f19ea71c82408300925a9a","die for you":"134778e4c4f19ea71c82408300925a9a","get you|daniel caesar":"282e45bef1995c2c6f2901e34c4ab560","get you":"282e45bef1995c2c6f2901e34c4ab560","focus|h e r":"4dff56488d13d0b5e96d93d895c9624b","focus":"4dff56488d13d0b5e96d93d895c9624b","break from toronto|partynextdoor":"3046cd9e199255a7c9f64bf0f1cb246e","break from toronto":"3046cd9e199255a7c9f64bf0f1cb246e","over|lucky daye":"e66715b17e490fea982b66506d3a33b8","over":"e66715b17e490fea982b66506d3a33b8","boo d up|ella mai":"9747893d144d612424ec129b71648bb0","boo d up":"9747893d144d612424ec129b71648bb0","free mind|tems":"53e9db9663c87b34723c17bcf9c2a8e8","free mind":"53e9db9663c87b34723c17bcf9c2a8e8","talk|khalid":"f350b1fd2563c5f582d10914f8cbbe42","talk":"f350b1fd2563c5f582d10914f8cbbe42","thinkin bout you|frank ocean":"e545e4c96ae929e8cce56808afd7756f","thinkin bout you":"e545e4c96ae929e8cce56808afd7756f","good days|sza":"8aafccd5fc82acdebc88372bd1bef371","good days":"8aafccd5fc82acdebc88372bd1bef371","do i wanna know|arctic monkeys":"64e54e307bd5e2bdb27ffeb662fd910d","do i wanna know":"64e54e307bd5e2bdb27ffeb662fd910d","mr brightside|the killers":"64e54e307bd5e2bdb27ffeb662fd910d","mr brightside":"64e54e307bd5e2bdb27ffeb662fd910d","everlong|foo fighters":"266f01f1c7a04843d11cd08f9c07d11f","everlong":"266f01f1c7a04843d11cd08f9c07d11f","in the end|linkin park":"033a271b5ec10842c287827c39244fb5","in the end":"033a271b5ec10842c287827c39244fb5","smells like teen spirit|nirvana":"f0282817b697279e56df13909962a54a","smells like teen spirit":"f0282817b697279e56df13909962a54a","seven nation army|the white stripes":"ed0929a4c44d77c4dc524a10748fc2f6","seven nation army":"ed0929a4c44d77c4dc524a10748fc2f6","boulevard of broken dreams|green day":"4a2497e819405074b107b3bce1d95cf9","boulevard of broken dreams":"4a2497e819405074b107b3bce1d95cf9","californication|red hot chili peppers":"5e61e8290a4d1d64ca58920656c9602d","californication":"5e61e8290a4d1d64ca58920656c9602d","supermassive black hole|muse":"9169b09a2a789322d00b9a616a9f36b5","supermassive black hole":"9169b09a2a789322d00b9a616a9f36b5","the adults are talking|the strokes":"523ac3e61759f365b9306fc44dd53eea","the adults are talking":"523ac3e61759f365b9306fc44dd53eea","misery business|paramore":"1a48b36fe9dd29b2bef2f5058cbe0c25","misery business":"1a48b36fe9dd29b2bef2f5058cbe0c25","sex on fire|kings of leon":"a4d41f829fac22196b44e97824ee9180","sex on fire":"a4d41f829fac22196b44e97824ee9180","take me out|franz ferdinand":"f274cdbda80d97a785e001848378dd29","take me out":"f274cdbda80d97a785e001848378dd29","dreams|fleetwood mac":"9732751ce91d786dcf30069853697078","dreams":"9732751ce91d786dcf30069853697078","creep|radiohead":"1dd56fd8824492e1a5106c99a00a85ec","creep":"1dd56fd8824492e1a5106c99a00a85ec","lonely boy|the black keys":"f1e189eb93b8508d102931bcd9293ce8","lonely boy":"f1e189eb93b8508d102931bcd9293ce8","stressed out|twenty one pilots":"dbbde1014cda9b101412a8e27add0ad2","stressed out":"dbbde1014cda9b101412a8e27add0ad2","don t look back in anger|oasis":"c607d5443ca9db2ae550f2081a3904e6","don t look back in anger":"c607d5443ca9db2ae550f2081a3904e6","yellow|coldplay":"970dce98eeea6729244c0ae71707a83d","yellow":"970dce98eeea6729244c0ae71707a83d","r u mine|arctic monkeys":"64e54e307bd5e2bdb27ffeb662fd910d","r u mine":"64e54e307bd5e2bdb27ffeb662fd910d","numb|linkin park":"44df4f6fb2534768f4924365c103d0f7","numb":"44df4f6fb2534768f4924365c103d0f7","somebody told me|the killers":"38bb1c3329d465a3e6d4ebfe579df121","somebody told me":"38bb1c3329d465a3e6d4ebfe579df121","the pretender|foo fighters":"266f01f1c7a04843d11cd08f9c07d11f","the pretender":"266f01f1c7a04843d11cd08f9c07d11f","under the bridge|red hot chili peppers":"e3f1bee87b1d5d1313641762f375a3fb","under the bridge":"e3f1bee87b1d5d1313641762f375a3fb","one kiss|calvin harris":"0397baea24f861db7ee63fb1c70391f9","one kiss":"0397baea24f861db7ee63fb1c70391f9","wake me up|avicii":"ec97306735b46ec334e0ce562290775b","wake me up":"ec97306735b46ec334e0ce562290775b","titanium|david guetta":"52330286cb5008805253fd77c7111d3f","titanium":"52330286cb5008805253fd77c7111d3f","the business|tiesto":"664cd2e671f05f3f8f1e0bbd710e082d","the business":"664cd2e671f05f3f8f1e0bbd710e082d","delilah pull me out of this|fred again":"4417f9908f6657064dd554e8b64bcf2d","delilah pull me out of this":"4417f9908f6657064dd554e8b64bcf2d","latch|disclosure":"e44468007c45f2523d056a0b19eed80a","latch":"e44468007c45f2523d056a0b19eed80a","don t you worry child|swedish house mafia":"a6e59fada64940a751de6eaa01229e8b","don t you worry child":"a6e59fada64940a751de6eaa01229e8b","clarity|zedd":"6b8a51cd4d5e2a277c8a1c4f88d59489","clarity":"6b8a51cd4d5e2a277c8a1c4f88d59489","scared to be lonely|martin garrix":"8e6e0c8973442986572a2e8a5492fdd9","scared to be lonely":"8e6e0c8973442986572a2e8a5492fdd9","firestone|kygo":"28a8beab24b92bcbbd1e80df83c4bd24","firestone":"28a8beab24b92bcbbd1e80df83c4bd24","one more time|daft punk":"5718f7c81c27e0b2417e2a4c45224f8a","one more time":"5718f7c81c27e0b2417e2a4c45224f8a","it goes like nanana|peggy gou":"da81d86b3bc191357af8f86da1ad2751","it goes like nanana":"da81d86b3bc191357af8f86da1ad2751","rhyme dust|mk":"4ef99be8f99decc23a9e2bd2b3c891e6","rhyme dust":"4ef99be8f99decc23a9e2bd2b3c891e6","innerbloom|rufus du sol":"b3e3bc9f13817bd7878fb69831a4c307","innerbloom":"b3e3bc9f13817bd7878fb69831a4c307","piece of your heart|meduza":"2aa3a5de3aef945681ee002d3dbde756","piece of your heart":"2aa3a5de3aef945681ee002d3dbde756","runaway u i|galantis":"e26d05cc4a80b07bcb4182bb598eae9d","runaway u i":"e26d05cc4a80b07bcb4182bb598eae9d","heroes we could be|alesso":"3a436fc1dfb085581043417e1db3caad","heroes we could be":"3a436fc1dfb085581043417e1db3caad","rather be|clean bandit":"3193132d50c74a62d1cd419fa170139a","rather be":"3193132d50c74a62d1cd419fa170139a","head heart|joel corry":"6c30daf87841ac1c27a67b7ab4ba255d","head heart":"6c30daf87841ac1c27a67b7ab4ba255d","lose control|meduza":"453595cce92efa85b6cade031f59cad6","lose control":"453595cce92efa85b6cade031f59cad6","summer|calvin harris":"a72e5db10e9168cd6f5065fbe750cdbb","summer":"a72e5db10e9168cd6f5065fbe750cdbb","levels|avicii":"30bc3d8c348ddddb00c44f28d3120ac5","levels":"30bc3d8c348ddddb00c44f28d3120ac5","moth to a flame|swedish house mafia":"9bd2f0768b8b53cb3338f546526796ec","moth to a flame":"9bd2f0768b8b53cb3338f546526796ec","losing it|fisher":"ebac3c7a4baff91f789cfdf053a11938","losing it":"ebac3c7a4baff91f789cfdf053a11938","the less i know the better|tame impala":"de5b9b704cd4ec36f8bf49beb3e17ba2","the less i know the better":"de5b9b704cd4ec36f8bf49beb3e17ba2","somebody else|the 1975":"97ab544fb96d693e44adb0cabda14e43","somebody else":"97ab544fb96d693e44adb0cabda14e43","heat waves|glass animals":"04ea51c6eb90a6208f2e47da861cf1a5","heat waves":"04ea51c6eb90a6208f2e47da861cf1a5","sofia|clairo":"ce9daf5b5d41cf2c8e1076b2a1e07787","sofia":"ce9daf5b5d41cf2c8e1076b2a1e07787","sweater weather|the neighbourhood":"521126388e95a1ad2cde7d0a3854cf3d","sweater weather":"521126388e95a1ad2cde7d0a3854cf3d","west coast|lana del rey":"b68adb6788dfa09a314f594aec287850","west coast":"b68adb6788dfa09a314f594aec287850","motion sickness|phoebe bridgers":"effa6216edf21cfefd5332a2899c6ec0","motion sickness":"effa6216edf21cfefd5332a2899c6ec0","my love mine all mine|mitski":"db69f7d3ea280f1155256705735648cd","my love mine all mine":"db69f7d3ea280f1155256705735648cd","show me how|men i trust":"6f4f35fdc77ef818f0e0e29211cac77f","show me how":"6f4f35fdc77ef818f0e0e29211cac77f","chamber of reflection|mac demarco":"fc8f82cf0eba7408386e365e538df8b2","chamber of reflection":"fc8f82cf0eba7408386e365e538df8b2","are you bored yet|wallows":"e8d0adbc15a2bba2350ad40022733418","are you bored yet":"e8d0adbc15a2bba2350ad40022733418","cigarette daydreams|cage the elephant":"fb29ac1b15d07f8c9d70003a9262fd14","cigarette daydreams":"fb29ac1b15d07f8c9d70003a9262fd14","electric feel|mgmt":"751372bcbd63a38e6ec6ef8bd448d687","electric feel":"751372bcbd63a38e6ec6ef8bd448d687","dog days are over|florence the machine":"e4975860d7e182195ec9fb1464676b94","dog days are over":"e4975860d7e182195ec9fb1464676b94","ribs|lorde":"7bb0b356418fbb275c0c3db7259128d7","ribs":"7bb0b356418fbb275c0c3db7259128d7","a punk|vampire weekend":"6fc963e3e5bd489dd82b0e02c3122792","a punk":"6fc963e3e5bd489dd82b0e02c3122792","glue song|beabadoobee":"8e64a61be14286be891afeef6b1aafbe","glue song":"8e64a61be14286be891afeef6b1aafbe","space song|beach house":"ae6cd55de0f78ca8ac38ad6c6cff0c1f","space song":"ae6cd55de0f78ca8ac38ad6c6cff0c1f","walking on a dream|empire of the sun":"63e0641afc551bf313b1e7027799a136","walking on a dream":"63e0641afc551bf313b1e7027799a136","can i call you tonight|dayglow":"bd2f298f15908d7cff95e41ff955fbd0","can i call you tonight":"bd2f298f15908d7cff95e41ff955fbd0","borderline|tame impala":"d8eb61bd4becf79a602a75b69eebde7d","borderline":"d8eb61bd4becf79a602a75b69eebde7d","riptide|vance joy":"d3f67e81d134e4036fd2e68a062210c4","riptide":"d3f67e81d134e4036fd2e68a062210c4","pumped up kicks|foster the people":"fc73624907c40d356ca26152754cef43","pumped up kicks":"fc73624907c40d356ca26152754cef43","holocene|bon iver":"1457f0d27076538d484625fa706541b7","holocene":"1457f0d27076538d484625fa706541b7","die with a smile|lady gaga":"4bd5903f4ce8f2601916bfadb44efe8a","die with a smile":"4bd5903f4ce8f2601916bfadb44efe8a","birds of a feather|billie eilish":"5d284b31cb9ddeb1a0c79aede5a94e1c","birds of a feather":"5d284b31cb9ddeb1a0c79aede5a94e1c","good luck babe|chappell roan":"377470fb0413c43587769a7dea37f691","good luck babe":"377470fb0413c43587769a7dea37f691","beautiful things|benson boone":"71ca8c4c88fdb45381c4291bd4233ff6","beautiful things":"71ca8c4c88fdb45381c4291bd4233ff6","lose control|teddy swims":"a45814bc18561080e3170f7c8ba942aa","too sweet|hozier":"7a7c512b717a4aa7452f3c3e46675322","too sweet":"7a7c512b717a4aa7452f3c3e46675322","a bar song tipsy|shaboozey":"d4f0d9289d6f68204dee8a22fe777c70","a bar song tipsy":"d4f0d9289d6f68204dee8a22fe777c70","taste|sabrina carpenter":"0fd6e3b346b959a8781ccfa89b63607a","taste":"0fd6e3b346b959a8781ccfa89b63607a","i had some help|post malone":"b9c8cc4fd597a9bc516445e6573501cf","i had some help":"b9c8cc4fd597a9bc516445e6573501cf","stick season|noah kahan":"1cf9edd5673e4f9a070054fbd6166134","stick season":"1cf9edd5673e4f9a070054fbd6166134","paint the town red|doja cat":"ad4bfc2a374741218dd6498d04e323cc","paint the town red":"ad4bfc2a374741218dd6498d04e323cc","water|tyla":"b246276eba02e22c9e08605924395480","water":"b246276eba02e22c9e08605924395480","calm down|rema":"3071378af24d789b8fc69e95162041e4","calm down":"3071378af24d789b8fc69e95162041e4","seven|jung kook":"d1ddbc901bf7d7b43187fac1b1e6714e","seven":"d1ddbc901bf7d7b43187fac1b1e6714e","starboy|the weeknd":"134778e4c4f19ea71c82408300925a9a","starboy":"134778e4c4f19ea71c82408300925a9a","dance the night|dua lipa":"67bbf9fc8e49fc8d373c91963061572b","dance the night":"67bbf9fc8e49fc8d373c91963061572b","exes|tate mcrae":"6f05ad1f5ec636827d9db5683188d980","exes":"6f05ad1f5ec636827d9db5683188d980","million dollar baby|tommy richman":"26989b6704a8656f2ceb4e3a148a55cd","million dollar baby":"26989b6704a8656f2ceb4e3a148a55cd","comethru|jeremy zucker":"795daf4244e61b38656efb32f3fe5259","comethru":"795daf4244e61b38656efb32f3fe5259","i like me better|lauv":"3db7eca4ee1a2effa0d353289b4b2bba","i like me better":"3db7eca4ee1a2effa0d353289b4b2bba","limbo|keshi":"5de0eec56dbe0a0670f01826aaf32f1a","limbo":"5de0eec56dbe0a0670f01826aaf32f1a","at my worst|pink sweat":"cab97fdd320e4a821ca92ab3b5dcc37c","at my worst":"cab97fdd320e4a821ca92ab3b5dcc37c","gravity|john mayer":"a49f22668c3f7f26d9de7fcc93537742","texas sun|khruangbin":"ce74bca0d491ab7f24a6a21a752a1745","texas sun":"ce74bca0d491ab7f24a6a21a752a1745","don t know why|norah jones":"d4cb6f8663af84d1db08a41a019065a0","don t know why":"d4cb6f8663af84d1db08a41a019065a0","the night we met|lord huron":"19b14fa5b494e0e74332f7dbf8dab87d","the night we met":"19b14fa5b494e0e74332f7dbf8dab87d","coastline|hollow coves":"694999b0e2c9c832d2ab406f861f9a96","coastline":"694999b0e2c9c832d2ab406f861f9a96","anchor|novo amor":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/54/4b/e1/544be1ff-5505-56dc-2720-96da95313a8e/cover.jpg/500x500bb.jpg","anchor":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/54/4b/e1/544be1ff-5505-56dc-2720-96da95313a8e/cover.jpg/500x500bb.jpg","sunday best|surfaces":"b2eee9b3bc6ad79ef160fd0e732054fa","sunday best":"b2eee9b3bc6ad79ef160fd0e732054fa","glimpse of us|joji":"36aecc47636b326efc3987120dcf4c65","glimpse of us":"36aecc47636b326efc3987120dcf4c65","heather|conan gray":"0a5209aec8e37012eb07eb6ef01fa7e6","heather":"0a5209aec8e37012eb07eb6ef01fa7e6","malibu nights|lany":"f90692153e5d2a47033475d70e1d19dd","malibu nights":"f90692153e5d2a47033475d70e1d19dd","loving is easy|rex orange county":"d805dcdae2effd5781af2eb7662a3c4b","loving is easy":"d805dcdae2effd5781af2eb7662a3c4b","banana pancakes|jack johnson":"6fc75cf6170ae0ed9c6a40810c67ba87","banana pancakes":"6fc75cf6170ae0ed9c6a40810c67ba87","apocalypse|cigarettes after sex":"2db20377876da16feb8ec9652e835a81","apocalypse":"2db20377876da16feb8ec9652e835a81","location|khalid":"7fa1597e86f5b4283ea316f2ddb54008","location":"7fa1597e86f5b4283ea316f2ddb54008","sunset lover|petit biscuit":"e3390ef01b24150b70763cd1d1f7c628","sunset lover":"e3390ef01b24150b70763cd1d1f7c628","sunflower|post malone":"1aa3dfe91b3e5d3bc71eca6b6e9c8d39","sunflower":"1aa3dfe91b3e5d3bc71eca6b6e9c8d39","paris in the rain|lauv":"020c438f93cd3317c1eccb1df1906e15","paris in the rain":"020c438f93cd3317c1eccb1df1906e15","best friend|rex orange county":"9ccaea7ee5c2f1c370aad199ed21935a","best friend":"9ccaea7ee5c2f1c370aad199ed21935a","slow dancing in a burning room|john mayer":"a49f22668c3f7f26d9de7fcc93537742","slow dancing in a burning room":"a49f22668c3f7f26d9de7fcc93537742","till i collapse|eminem":"ec3c8ed67427064c70f67e5815b74cef","till i collapse":"ec3c8ed67427064c70f67e5815b74cef","stronger|kanye west":"15012d974c6263aec95e52e6d86cba23","stronger":"15012d974c6263aec95e52e6d86cba23","believer|imagine dragons":"247b228179aea3b083eef43522b78b45","believer":"247b228179aea3b083eef43522b78b45","can t hold us|macklemore":"238f1c36e8445fd162d1d53b8181ecb5","can t hold us":"238f1c36e8445fd162d1d53b8181ecb5","power|kanye west":"742aba8510ba803bea51d304cf2ca786","power":"742aba8510ba803bea51d304cf2ca786","lose yourself|eminem":"e2b36a9fda865cb2e9ed1476b6291a7d","lose yourself":"e2b36a9fda865cb2e9ed1476b6291a7d","humble|kendrick lamar":"7ce6b8452fae425557067db6e6a1cad5","humble":"7ce6b8452fae425557067db6e6a1cad5","bangarang|skrillex":"3d5ef81b8e6c4b5c35ebe1dfa69a0463","bangarang":"3d5ef81b8e6c4b5c35ebe1dfa69a0463","eye of the tiger|survivor":"e66b5d3a40f69690c1633afb73cc590c","eye of the tiger":"e66b5d3a40f69690c1633afb73cc590c","thunderstruck|ac":"e715766b21a8db6076f6a9a89e25cf82","thunderstruck":"e715766b21a8db6076f6a9a89e25cf82","faint|linkin park":"882448ab63952aa16e502c82db2df160","faint":"882448ab63952aa16e502c82db2df160","centuries|fall out boy":"c0a1d1281570ad3becbb6146c6d54c0c","centuries":"c0a1d1281570ad3becbb6146c6d54c0c","dreams and nightmares|meek mill":"b9e64f0c2ebbf77a34dd58f49fe6a7ae","dreams and nightmares":"b9e64f0c2ebbf77a34dd58f49fe6a7ae","industry baby|lil nas":"a65e86966cfd34b2aa292856136ef9ac","industry baby":"a65e86966cfd34b2aa292856136ef9ac","back in black|ac":"41041b14873956eff0459c8ea2c296a8","back in black":"41041b14873956eff0459c8ea2c296a8","radioactive|imagine dragons":"7e8314f4280cffde363547a495a260bc","radioactive":"7e8314f4280cffde363547a495a260bc","physical|dua lipa":"f8364f090ba04f1b19b381ec0390f3e4","physical":"f8364f090ba04f1b19b381ec0390f3e4","turn down for what|dj snake":"82c139e154a40073542914dfed468474","turn down for what":"82c139e154a40073542914dfed468474","x gon give it to ya|dmx":"2738ddc7f2fa7d869438caf6a3d25a7b","x gon give it to ya":"2738ddc7f2fa7d869438caf6a3d25a7b","remember the name|fort minor":"d4059c5525f643e2843b2f1e18e2d39f","remember the name":"d4059c5525f643e2843b2f1e18e2d39f","killing in the name|rage against the machine":"73a4d0cb2f3ec27583b9e0bc724b50c7","killing in the name":"73a4d0cb2f3ec27583b9e0bc724b50c7","breathe|the prodigy":"566d28d32080a6d82a2d4d145ea5ea7e","breathe":"566d28d32080a6d82a2d4d145ea5ea7e","pump it|black eyed peas":"595ae492a34647054ea30d805096d5b5","pump it":"595ae492a34647054ea30d805096d5b5","dna|kendrick lamar":"7ce6b8452fae425557067db6e6a1cad5","dna":"7ce6b8452fae425557067db6e6a1cad5","yeah|usher":"b89c20012cccb051c8a4e04d98386f95","yeah":"b89c20012cccb051c8a4e04d98386f95","hey ya|outkast":"f81783b6cc6030733cd475f820855562","hey ya":"f81783b6cc6030733cd475f820855562","toxic|britney spears":"8a2b95cda407d004d829831d20e2e20b","toxic":"8a2b95cda407d004d829831d20e2e20b","i want it that way|backstreet boys":"d61eaad8f321ea876a5f5c7219aae892","i want it that way":"d61eaad8f321ea876a5f5c7219aae892","crazy in love|beyonce":"1ea1a631aa5235bbd0063643beb96fa8","crazy in love":"1ea1a631aa5235bbd0063643beb96fa8","say my name|destiny s child":"73da200f9335f752d2f7cb5ed8933cef","say my name":"73da200f9335f752d2f7cb5ed8933cef","no scrubs|tlc":"6dd5f40e7688ba155a5ef557977e95d3","no scrubs":"6dd5f40e7688ba155a5ef557977e95d3","sexyback|justin timberlake":"615bb58abf2e5fd86741ed5311d364b1","sexyback":"615bb58abf2e5fd86741ed5311d364b1","umbrella|rihanna":"91276466fbc876d96be9e6926060af60","umbrella":"91276466fbc876d96be9e6926060af60","hot in herre|nelly":"632fa55096ecab62a0c2556fa9e958c1","hot in herre":"632fa55096ecab62a0c2556fa9e958c1","in da club|50 cent":"8f4dd4d8abf85ceda96b6b4adf217590","in da club":"8f4dd4d8abf85ceda96b6b4adf217590","hips don t lie|shakira":"b570890728621ec68d5c5558164c3945","hips don t lie":"b570890728621ec68d5c5558164c3945","no one|alicia keys":"b9f3ff7c0514902ec94751360154f25b","no one":"b9f3ff7c0514902ec94751360154f25b","so sick|ne yo":"ad97c751643e185a348fb13199c49944","so sick":"ad97c751643e185a348fb13199c49944","wannabe|spice girls":"18c4f2d9608910a2b8eb1835052e895b","wannabe":"18c4f2d9608910a2b8eb1835052e895b","baby one more time|britney spears":"f685d32254a59b6162be0d1082ff8805","baby one more time":"f685d32254a59b6162be0d1082ff8805","bye bye bye|nsync":"https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/95/e8/65/95e86597-6095-0f6c-f6b8-ba53c7b744a2/828767330723.jpg/500x500bb.jpg","bye bye bye":"https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/95/e8/65/95e86597-6095-0f6c-f6b8-ba53c7b744a2/828767330723.jpg/500x500bb.jpg","genie in a bottle|christina aguilera":"98276416e4db0e5eb6fbb9c9f1a52bdc","genie in a bottle":"98276416e4db0e5eb6fbb9c9f1a52bdc","complicated|avril lavigne":"1130d6301d5e87976279ea2f706fcc26","complicated":"1130d6301d5e87976279ea2f706fcc26","hollaback girl|gwen stefani":"595ae492a34647054ea30d805096d5b5","hollaback girl":"595ae492a34647054ea30d805096d5b5","where is the love|black eyed peas":"0e4b70f9985801a0acbcef1782bd18eb","where is the love":"0e4b70f9985801a0acbcef1782bd18eb","promiscuous|nelly furtado":"1c0ab3163b031034e5b8155c10aada6d","promiscuous":"1c0ab3163b031034e5b8155c10aada6d","she will be loved|maroon 5":"39fe38574c7af3181d1e56ad7c03fce3","she will be loved":"39fe38574c7af3181d1e56ad7c03fce3","smack that|akon":"bc4d98904d61661cc6d7dd53745340d0","smack that":"bc4d98904d61661cc6d7dd53745340d0"};
  const VERIFIED_ARTIST_COVERS = {"sachin jigar":"1f8faf6b803911ad2d33ea66cacb3033","karan aujla":"ff6bb1420d9fcd2671cf6f86c2e49658","ram sampath":"407e34575dc610b6592fda6d8210be18","hanumankind":"2d00c5a1488deb77bc1faa958f355b54","diljit dosanjh":"87516b74e8e95b373c57a5b74ff2a769","anuv jain":"bdcf70737dc185ef7ec866fb29591137","mitraz":"8d786df765556de281ac3c502e49f643","vishal mishra":"e8503eb01fce97c7427b794e8cd3c478","seedhe maut":"a9f93d7a3ab2ff3d1e2a6d4d1c47c105","kr na":"0c2035c5f905a7d31e192c2f113e2c6f","divine":"209bb3f2ead009e3ea3c3265400a28cf","king":"https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/90/9d/aa/909daa9a-3a47-9314-2855-39f5a157f1e3/5054197407734.jpg/500x500bb.jpg","aditya rikhari":"8d54f8a03637b9f40ad387b6e46c8985","hasan raheem":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/c7/e5/02/c7e50222-40be-521e-b8e0-02df1aac4fde/17535.jpg/500x500bb.jpg","the local train":"8b26bfc0975e7c19dc45b3a0ee9360c9","prateek kuhad":"5703f7b99e90720b01978fbca7923e70","ritviz":"0d6a03d9ec7c93ad31203f09216cfbf1","shubh":"9b315dd75419b5f893cb84a1ff2e8ef0","ap dhillon":"ff7878c3ecade62c69ea2e10d4ec1ce8","arijit singh":"87965798331705639c8965c7fc100ffc","akshath":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b8/29/f1/b829f155-0534-0808-8a6d-f168f9df3d4a/24UMGIM56452.rgb.jpg/500x500bb.jpg","faheem abdullah":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/a3/04/c1/a304c107-6887-c475-8377-d05e86cfe108/cover.jpg/500x500bb.jpg","sai abhyankkar":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/80/df/08/80df0808-17e7-ab41-5972-fec5f83e3819/cover.jpg/500x500bb.jpg","sushin shyam":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/88/4e/29/884e290c-29ed-25d5-7b25-243b89097220/cover.jpg/500x500bb.jpg","badshah":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/a9/c7/32/a9c732cc-d880-1ee4-ff22-d01593ac6341/24UMGIM22464.rgb.jpg/500x500bb.jpg","yo yo honey singh":"https://is1-ssl.mzstatic.com/image/thumb/Music128/v4/cf/cd/24/cfcd248a-cbbd-10dd-7d25-894bbf9b9f20/8902633288584.jpg/500x500bb.jpg","sagar bhatia":"53bdfe2ba9539665069498cf4a44da4d","darshan raval":"86a67dbe69bd2769bf1e20f1f4a5ad27","varun jain":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/d3/37/eb/d337eb52-2663-826d-d213-335598b14743/198846005553.jpg/500x500bb.jpg","guru randhawa":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/27/58/c3275887-784f-4ad4-e05d-215c5f9dfbbc/8903431009845_cover.jpg/500x500bb.jpg","saad lamjarred":"d2b0e3341b6cabf610dec963e3d527da","jasleen royal":"6b06bbbf7c2d9c6bcb60763bccc0571d","bhupinder babbal":"e8503eb01fce97c7427b794e8cd3c478","aur":"12d66b492d1e4792fec0c4d0ad754ded","talwiinder":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/da/22/b8/da22b844-b237-c414-2111-79276423c340/196589947482.jpg/500x500bb.jpg","yashraj":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/30/63/c3/3063c36c-8537-ce66-4451-e9de6c2a13dc/23UM1IM04836.rgb.jpg/500x500bb.jpg","chani nattan":"4f6b75ee8d72644714ae5254efb27631","sanju rathod":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/13/2d/eb/132deb17-aee2-6b64-d0cc-6446c213375d/cover.jpg/500x500bb.jpg","jyoti nooran":"6f88346b2818313ccadbde509a411832","rose":"258e6042338ce64bb4157c0c94b232ac","kendrick lamar":"da5256ff8cacfe9ad90521f6e3792259","gigi perez":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/25/d4/96/25d49699-acc0-401f-a7cc-d7697339a474/24UM1IM03751.rgb.jpg/500x500bb.jpg","lola young":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/5a/c6/b1/5ac6b183-8ff1-55e3-fa59-8cce5db3fc87/24UMGIM52751.rgb.jpg/500x500bb.jpg","gracie abrams":"967769c4612d74e8f5c7da8798b28e13","doechii":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/5f/a3/e8/5fa3e8b9-9065-47af-63e1-f213d3074580/24UMGIM88644.rgb.jpg/500x500bb.jpg","tate mcrae":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/51/8a/29/518a29f3-5915-662a-d861-663e6d0fbfe4/196872648911.jpg/500x500bb.jpg","linkin park":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/85/cf/a1/85cfa1ed-d8f6-d021-2a9e-cb541b2bbe87/artwork.jpg/500x500bb.jpg","morgan wallen":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/0e/6d/e1/0e6de152-3ff5-84a3-7ce7-7dfbdcb2c3e1/24UMGIM96374.rgb.jpg/500x500bb.jpg","the weeknd":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/9f/c8/c39fc847-2d00-1b7f-7327-264436bd9957/24UM1IM21421.rgb.jpg/500x500bb.jpg","lady gaga":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/c5/43/8b/c5438b81-75e8-3a0a-05ee-4f29ae0b9bb3/25UMGIM07433.rgb.jpg/500x500bb.jpg","tyler":"https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/6d/31/ab/6d31abaf-7a07-05f1-13ad-72ec520b6bfb/22UMGIM67374.rgb.jpg/500x500bb.jpg","billie eilish":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/92/9f/69/929f69f1-9977-3a44-d674-11f70c852d1b/24UMGIM36186.rgb.jpg/500x500bb.jpg","sabrina carpenter":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/f6/15/d0/f615d0ab-e0c4-575d-907e-1cc084642357/24UMGIM61704.rgb.jpg/500x500bb.jpg","chappell roan":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/41/bc/fb/41bcfb43-91d5-931d-5747-fb381803143f/23UMGIM21715.rgb.jpg/500x500bb.jpg","addison rae":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/01/ef/7a/01ef7a06-1b48-0460-efbf-983d6a0a37fa/196872309959.jpg/500x500bb.jpg","alex warren":"f4246416b5e3e71a35adf1e2cbe98bfb","sombr":"37a20b62f754b7ff5a9a29a8f2fe9d27","leon thomas":"1c318762a31c79bd28e9f7951bdab5b4","glorilla":"a65e86966cfd34b2aa292856136ef9ac","charli xcx":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/cf/0b/2b/cf0b2bae-d4c1-49ce-de5c-b7c3fcd9e4cd/075679643087.jpg/500x500bb.jpg","john summit":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/26/86/a9/2686a9dc-0a17-8e7f-82e3-9bb7c53c1494/23UMGIM19042.rgb.jpg/500x500bb.jpg","fred again":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/fc/e8/81/fce8814b-c3c2-3cf1-8294-791326b9801e/cover.jpg/500x500bb.jpg","central cee":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/e1/2d/c5/e12dc546-b50d-5a06-58cf-94227b0c78b9/196872154931.jpg/500x500bb.jpg","ice spice":"8508be30ca355ef44597e9be0f834232","jordan adetunji":"1c318762a31c79bd28e9f7951bdab5b4","kehlani":"1c318762a31c79bd28e9f7951bdab5b4","sza":"992cc838b5f0cf0eebbd83011a979571","zach bryan":"7060ea038f51fdeff23bc40eb5027663","luke combs":"473abf39f40221437fb7c590e36b7282","post malone":"473abf39f40221437fb7c590e36b7282","jelly roll":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/95/b9/ca/95b9ca00-29cb-8edc-1ecb-5bda742f3177/24UMGIM62166.rgb.jpg/500x500bb.jpg","shaboozey":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/23/f2/d9/23f2d96d-b842-5f8b-1a09-bcc9a5cf7032/197342797344_cover.jpg/500x500bb.jpg","dasha":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/85/b5/b0/85b5b00b-ca94-dfa1-a3cf-2da4a1e3dd39/054391277657.jpg/500x500bb.jpg","tucker wetmore":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/a1/54/e2/a154e275-9a98-3491-26cf-a1c6f3fb4ea1/24UMGIM54949.rgb.jpg/500x500bb.jpg","megan moroney":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/de/2a/43/de2a438b-bb7c-16db-64db-954057aca5aa/196872040302.jpg/500x500bb.jpg","clairo":"6dfa4ea965a74b93870a85daa74b7ca3","beabadoobee":"6dfa4ea965a74b93870a85daa74b7ca3","role model":"6dfa4ea965a74b93870a85daa74b7ca3","ravyn lenae":"1c318762a31c79bd28e9f7951bdab5b4","malcolm todd":"37a20b62f754b7ff5a9a29a8f2fe9d27","mk gee":"37a20b62f754b7ff5a9a29a8f2fe9d27","artemas":"ee890cf16d00c684be76b0087c7108c4","fontaines d c":"1e8ffbd401303b5693226c12ee0b84fb","sam fender":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/bd/8c/24/bd8c2468-7978-cace-67b1-e0b3e5a643b8/24UM1IM05583.rgb.jpg/500x500bb.jpg","the last dinner party":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/69/74/ab/6974abd9-0415-aa60-240c-b2fac4c62e1b/23UMGIM23237.rgb.jpg/500x500bb.jpg","sleep token":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/e2/c6/0f/e2c60f68-7cec-fa08-6dd3-891aa72c247e/5401148000849_cover.jpg/500x500bb.jpg","bad omens":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/f0/ce/0d/f0ce0d9c-934d-770d-e62f-74564fc410e1/00810016765424_Cover.jpg/500x500bb.jpg","benson boone":"e8947b2a3e00fde8763011ebee2a02fd","teddy swims":"f4246416b5e3e71a35adf1e2cbe98bfb","laufey":"6dfa4ea965a74b93870a85daa74b7ca3","aespa":"258e6042338ce64bb4157c0c94b232ac","jennie":"258e6042338ce64bb4157c0c94b232ac","stray kids":"258e6042338ce64bb4157c0c94b232ac","illit":"258e6042338ce64bb4157c0c94b232ac","creepy nuts":"74a47f9832735b37a41d8fd49cd23354","mrs green apple":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/4c/3b/b2/4c3bb247-3be8-0c57-aa9a-7f1775a7b7a8/24UMGIM32931.rgb.jpg/500x500bb.jpg","rema":"cb415a59a7bc198ec4aab01f02600691","asake":"https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/dc/b7/78/dcb7782e-3100-b227-ed40-985954cfc6c8/artwork.jpg/500x500bb.jpg","wizkid":"https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/82/60/3b/82603b3c-1aad-6e37-3b81-d5451046accf/196872637434.jpg/500x500bb.jpg","tyla":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/2a/cc/48/2acc48c7-e092-6b83-ce65-ff80ac6eb51c/196872520118.jpg/500x500bb.jpg","titom":"e70f7518f5dbe0b0be643cbabc87ca4b","karol g":"2a769f6f0cce0ca9e129ce4b61f83973","bad bunny":"e4b16c1afe136140bba34368357e8f05","bini":"0fd6e3b346b959a8781ccfa89b63607a","maki":"37a20b62f754b7ff5a9a29a8f2fe9d27","tj monterde":"f4246416b5e3e71a35adf1e2cbe98bfb","drake":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/23/7c/a2/237ca270-9926-4b78-be81-410b6fc85f47/50291.jpg/500x500bb.jpg","lisa":"258e6042338ce64bb4157c0c94b232ac","myles smith":"f4246416b5e3e71a35adf1e2cbe98bfb","koe wetzel":"https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/a1/5a/2c/a15a2c42-ce9c-8c47-2b68-8cff0ab75708/196872445718.jpg/500x500bb.jpg","lainey wilson":"473abf39f40221437fb7c590e36b7282","zach top":"7060ea038f51fdeff23bc40eb5027663","bakar":"37a20b62f754b7ff5a9a29a8f2fe9d27","bl3ss":"e70f7518f5dbe0b0be643cbabc87ca4b","sonny fodera":"e70f7518f5dbe0b0be643cbabc87ca4b","dua lipa":"f8364f090ba04f1b19b381ec0390f3e4","harry styles":"b0e936124f59e669ddba02ebe5893f95","taylor swift":"6111c5ab9729c8eac47883e4e50e9cf8","ariana grande":"9349b2fcb4bd060060a33f054a619e83","olivia rodrigo":"4bb79214365c0049e031f5e2caae4752","miley cyrus":"98610629a40996b61b3d24bd5ab8c2e1","ed sheeran":"107c2b43f10c249077c1f7618563bb63","charlie puth":"da7eb4c99604b2fda5f123aba3897850","bruno mars":"012b27906b430a37ec1d8f793d5c4fa6","the kid laroi":"dd6fe7fa9267185c4b835bd4f155d1d2","shawn mendes":"35d5f7dd0b398bb37287b3454f0b05b9","troye sivan":"025b8f193e9cb37b15c857956938ae4f","travis scott":"b6fcb2355d00296ca037f17ed3463b40","future":"2d20cf6d65607e406213afbb3b62ce0d","j cole":"f45c8916970597d390313833a9db0c61","21 savage":"d1efd9562706fbc4facf4e86cbe78be4","metro boomin":"862ab860ff69c30deeb5979db6e46b62","a ap rocky":"f3b412a4f69c59dfb46583a93995f565","dave":"d8cd79f825f1a87ec86443c934556df7","jack harlow":"6d4d4cbd4990a644a184b5f64ee01ebf","don toliver":"bd7465c9bc2e952c83c7f168579aefcb","gunna":"35446b14e181f0a3fe415c06fec08d0b","baby keem":"0681d0925e8463d1e7ad2377793cea81","lil uzi vert":"77d464b429890070fecdf853bbe426ff","jid":"52c49df999ccf2844238672acccf2b7b","lil baby":"3d845a35fd7849630324107baf07657b","frank ocean":"f798a866107715dd6dc1049e498ce21f","daniel caesar":"4dff56488d13d0b5e96d93d895c9624b","silk sonic":"https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/c5/33/dc/c533dc8e-2baa-94f9-22be-e6e28945f932/075679754134.jpg/500x500bb.jpg","giveon":"5db10a9a3170871f3f4f9bbd01029b9a","brent faiyaz":"51d0d130671262611c927bd63c192670","summer walker":"4ba5878f51f5aa6f1995b2ba72878f0a","bryson tiller":"adde8485c3484a602f8f8a51d954b4ba","miguel":"23f94611c678b0c16b2a8336fa420e3f","victoria monet":"2c64ab2309b86a1c96896193ac833c40","snoh aalegra":"45579005ac5285cb351e5e7414267f82","jhene aiko":"ad84a421d7190381989ea7a04f897381","h e r":"4dff56488d13d0b5e96d93d895c9624b","partynextdoor":"3046cd9e199255a7c9f64bf0f1cb246e","lucky daye":"e66715b17e490fea982b66506d3a33b8","ella mai":"9747893d144d612424ec129b71648bb0","tems":"53e9db9663c87b34723c17bcf9c2a8e8","khalid":"f350b1fd2563c5f582d10914f8cbbe42","arctic monkeys":"64e54e307bd5e2bdb27ffeb662fd910d","the killers":"64e54e307bd5e2bdb27ffeb662fd910d","foo fighters":"266f01f1c7a04843d11cd08f9c07d11f","nirvana":"f0282817b697279e56df13909962a54a","the white stripes":"ed0929a4c44d77c4dc524a10748fc2f6","green day":"4a2497e819405074b107b3bce1d95cf9","red hot chili peppers":"5e61e8290a4d1d64ca58920656c9602d","muse":"9169b09a2a789322d00b9a616a9f36b5","the strokes":"523ac3e61759f365b9306fc44dd53eea","paramore":"1a48b36fe9dd29b2bef2f5058cbe0c25","kings of leon":"a4d41f829fac22196b44e97824ee9180","franz ferdinand":"f274cdbda80d97a785e001848378dd29","fleetwood mac":"9732751ce91d786dcf30069853697078","radiohead":"1dd56fd8824492e1a5106c99a00a85ec","the black keys":"f1e189eb93b8508d102931bcd9293ce8","twenty one pilots":"dbbde1014cda9b101412a8e27add0ad2","oasis":"c607d5443ca9db2ae550f2081a3904e6","coldplay":"970dce98eeea6729244c0ae71707a83d","calvin harris":"0397baea24f861db7ee63fb1c70391f9","avicii":"ec97306735b46ec334e0ce562290775b","david guetta":"52330286cb5008805253fd77c7111d3f","tiesto":"664cd2e671f05f3f8f1e0bbd710e082d","disclosure":"e44468007c45f2523d056a0b19eed80a","swedish house mafia":"a6e59fada64940a751de6eaa01229e8b","zedd":"6b8a51cd4d5e2a277c8a1c4f88d59489","martin garrix":"8e6e0c8973442986572a2e8a5492fdd9","kygo":"28a8beab24b92bcbbd1e80df83c4bd24","daft punk":"5718f7c81c27e0b2417e2a4c45224f8a","peggy gou":"da81d86b3bc191357af8f86da1ad2751","mk":"4ef99be8f99decc23a9e2bd2b3c891e6","rufus du sol":"b3e3bc9f13817bd7878fb69831a4c307","meduza":"2aa3a5de3aef945681ee002d3dbde756","galantis":"e26d05cc4a80b07bcb4182bb598eae9d","alesso":"3a436fc1dfb085581043417e1db3caad","clean bandit":"3193132d50c74a62d1cd419fa170139a","joel corry":"6c30daf87841ac1c27a67b7ab4ba255d","fisher":"ebac3c7a4baff91f789cfdf053a11938","tame impala":"de5b9b704cd4ec36f8bf49beb3e17ba2","the 1975":"97ab544fb96d693e44adb0cabda14e43","glass animals":"04ea51c6eb90a6208f2e47da861cf1a5","the neighbourhood":"521126388e95a1ad2cde7d0a3854cf3d","lana del rey":"b68adb6788dfa09a314f594aec287850","phoebe bridgers":"effa6216edf21cfefd5332a2899c6ec0","mitski":"db69f7d3ea280f1155256705735648cd","men i trust":"6f4f35fdc77ef818f0e0e29211cac77f","mac demarco":"fc8f82cf0eba7408386e365e538df8b2","wallows":"e8d0adbc15a2bba2350ad40022733418","cage the elephant":"fb29ac1b15d07f8c9d70003a9262fd14","mgmt":"751372bcbd63a38e6ec6ef8bd448d687","florence the machine":"e4975860d7e182195ec9fb1464676b94","lorde":"7bb0b356418fbb275c0c3db7259128d7","vampire weekend":"6fc963e3e5bd489dd82b0e02c3122792","beach house":"ae6cd55de0f78ca8ac38ad6c6cff0c1f","empire of the sun":"63e0641afc551bf313b1e7027799a136","dayglow":"bd2f298f15908d7cff95e41ff955fbd0","vance joy":"d3f67e81d134e4036fd2e68a062210c4","foster the people":"fc73624907c40d356ca26152754cef43","bon iver":"1457f0d27076538d484625fa706541b7","hozier":"7a7c512b717a4aa7452f3c3e46675322","noah kahan":"1cf9edd5673e4f9a070054fbd6166134","doja cat":"ad4bfc2a374741218dd6498d04e323cc","jung kook":"d1ddbc901bf7d7b43187fac1b1e6714e","tommy richman":"26989b6704a8656f2ceb4e3a148a55cd","jeremy zucker":"795daf4244e61b38656efb32f3fe5259","lauv":"3db7eca4ee1a2effa0d353289b4b2bba","keshi":"5de0eec56dbe0a0670f01826aaf32f1a","pink sweat":"cab97fdd320e4a821ca92ab3b5dcc37c","john mayer":"a49f22668c3f7f26d9de7fcc93537742","khruangbin":"ce74bca0d491ab7f24a6a21a752a1745","norah jones":"d4cb6f8663af84d1db08a41a019065a0","lord huron":"19b14fa5b494e0e74332f7dbf8dab87d","hollow coves":"694999b0e2c9c832d2ab406f861f9a96","novo amor":"https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/54/4b/e1/544be1ff-5505-56dc-2720-96da95313a8e/cover.jpg/500x500bb.jpg","surfaces":"b2eee9b3bc6ad79ef160fd0e732054fa","joji":"36aecc47636b326efc3987120dcf4c65","conan gray":"0a5209aec8e37012eb07eb6ef01fa7e6","lany":"f90692153e5d2a47033475d70e1d19dd","rex orange county":"d805dcdae2effd5781af2eb7662a3c4b","jack johnson":"6fc75cf6170ae0ed9c6a40810c67ba87","cigarettes after sex":"2db20377876da16feb8ec9652e835a81","petit biscuit":"e3390ef01b24150b70763cd1d1f7c628","eminem":"ec3c8ed67427064c70f67e5815b74cef","kanye west":"15012d974c6263aec95e52e6d86cba23","imagine dragons":"247b228179aea3b083eef43522b78b45","macklemore":"238f1c36e8445fd162d1d53b8181ecb5","skrillex":"3d5ef81b8e6c4b5c35ebe1dfa69a0463","survivor":"e66b5d3a40f69690c1633afb73cc590c","ac":"e715766b21a8db6076f6a9a89e25cf82","fall out boy":"c0a1d1281570ad3becbb6146c6d54c0c","meek mill":"b9e64f0c2ebbf77a34dd58f49fe6a7ae","lil nas":"a65e86966cfd34b2aa292856136ef9ac","dj snake":"82c139e154a40073542914dfed468474","dmx":"2738ddc7f2fa7d869438caf6a3d25a7b","fort minor":"d4059c5525f643e2843b2f1e18e2d39f","rage against the machine":"73a4d0cb2f3ec27583b9e0bc724b50c7","the prodigy":"566d28d32080a6d82a2d4d145ea5ea7e","black eyed peas":"595ae492a34647054ea30d805096d5b5","usher":"b89c20012cccb051c8a4e04d98386f95","outkast":"f81783b6cc6030733cd475f820855562","britney spears":"8a2b95cda407d004d829831d20e2e20b","backstreet boys":"d61eaad8f321ea876a5f5c7219aae892","beyonce":"1ea1a631aa5235bbd0063643beb96fa8","destiny s child":"73da200f9335f752d2f7cb5ed8933cef","tlc":"6dd5f40e7688ba155a5ef557977e95d3","justin timberlake":"615bb58abf2e5fd86741ed5311d364b1","rihanna":"91276466fbc876d96be9e6926060af60","nelly":"632fa55096ecab62a0c2556fa9e958c1","50 cent":"8f4dd4d8abf85ceda96b6b4adf217590","shakira":"b570890728621ec68d5c5558164c3945","alicia keys":"b9f3ff7c0514902ec94751360154f25b","ne yo":"ad97c751643e185a348fb13199c49944","spice girls":"18c4f2d9608910a2b8eb1835052e895b","nsync":"https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/95/e8/65/95e86597-6095-0f6c-f6b8-ba53c7b744a2/828767330723.jpg/500x500bb.jpg","christina aguilera":"98276416e4db0e5eb6fbb9c9f1a52bdc","avril lavigne":"1130d6301d5e87976279ea2f706fcc26","gwen stefani":"595ae492a34647054ea30d805096d5b5","nelly furtado":"1c0ab3163b031034e5b8155c10aada6d","maroon 5":"39fe38574c7af3181d1e56ad7c03fce3","akon":"bc4d98904d61661cc6d7dd53745340d0"};

  function _coverFold(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function _coverPrimArtist(a) {
    return _coverFold(String(a || "").split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\swith\s|\/)\s*/i)[0]);
  }

  function _expandCoverVal(v) {
    if (!v) return "";
    if (/^[a-f0-9]{32}$/i.test(v)) {
      return `https://cdn-images.dzcdn.net/images/cover/${v}/500x500-000000-80-0-0.jpg`;
    }
    return v;
  }

  function lookupVerifiedSongCoverClient(title, artist) {
    const tf = _coverFold(title);
    const af = _coverPrimArtist(artist);
    if (tf && af && VERIFIED_SONG_COVERS[`${tf}|${af}`]) {
      return _expandCoverVal(VERIFIED_SONG_COVERS[`${tf}|${af}`]);
    }
    if (tf && VERIFIED_SONG_COVERS[tf]) {
      return _expandCoverVal(VERIFIED_SONG_COVERS[tf]);
    }
    if (af && VERIFIED_ARTIST_COVERS[af]) {
      return _expandCoverVal(VERIFIED_ARTIST_COVERS[af]);
    }
    return "";
  }

  function healTrackCoverClient(t) {
    if (!t || typeof t !== "object") return t;
    const tf = _coverFold(t.title || t.trackName || "");
    const af = _coverPrimArtist(t.artist || t.artistName || "");
    const exact = (tf && af && VERIFIED_SONG_COVERS[`${tf}|${af}`]) || (tf && VERIFIED_SONG_COVERS[tf]) || "";
    if (exact) {
      t.artwork = _expandCoverVal(exact);
      return t;
    }
    const curArt = String(t.artwork || "");
    if (!curArt || curArt.startsWith("/cover")) {
      const memHit = _songCoverMemCache.get(`${tf} ${af}`.trim());
      if (memHit) {
        t.artwork = memHit;
        return t;
      }
      if (af && VERIFIED_ARTIST_COVERS[af]) {
        t.artwork = _expandCoverVal(VERIFIED_ARTIST_COVERS[af]);
      }
    }
    return t;
  }

  function healPlaylistCoversClient(p) {
    if (!p || typeof p !== "object") return p;
    if (Array.isArray(p.tracks)) {
      for (const t of p.tracks) healTrackCoverClient(t);
    }
    const firstArt = p.tracks && p.tracks[0] && p.tracks[0].artwork;
    if (firstArt && !String(firstArt).startsWith("/cover")) {
      const isCountryPl = String(p.id || "").startsWith("ctrend:");
      if (!p.artwork || String(p.artwork).startsWith("/cover") || isCountryPl) {
        p.artwork = firstArt;
      }
    }
    return p;
  }

  window.handleImgErr = function(img) {
    if (!img) return;
    const src = img.getAttribute("src") || "";
    const holder = img.closest("[data-title]");
    const title = (holder && holder.getAttribute("data-title")) || "";
    const artist = (holder && holder.getAttribute("data-artist")) || "";
    if (title) {
      const verified = lookupVerifiedSongCoverClient(title, artist);
      if (verified && verified !== src && !src.includes(encodeURIComponent(verified))) {
        img.src = verified;
        return;
      }
    }
    if (src && !src.startsWith("data:") && !src.includes("/cover-default.jpg") && !src.includes("/api/img?url=")) {
      img.onerror = function() {
        const el = this;
        el.onerror = null;
        el.src = "/cover-default.jpg";
        if (title) {
          resolveRealSongCoverClient(title, artist).then((art) => {
            if (art) el.src = art;
          }).catch(() => {});
        }
      };
      img.src = `${API_BASE}/api/img?url=${encodeURIComponent(src)}`;
    } else {
      img.onerror = null;
      img.src = "/cover-default.jpg";
      if (title) {
        resolveRealSongCoverClient(title, artist).then((art) => {
          if (art) img.src = art;
        }).catch(() => {});
      }
    }
  };

  function artUrl(t) {
    if (!t) return "/cover-default.jpg";
    healTrackCoverClient(t);
    if (!t.artwork) return "/cover-default.jpg";
    const a = String(t.artwork);
    if (a.startsWith("/") && API_BASE && !a.includes("/cover-default.jpg")) {
      return `${API_BASE}${a}`;
    }
    return a;
  }

  const _songCoverMemCache = new Map();
  async function resolveRealSongCoverClient(title, artist) {
    const verified = lookupVerifiedSongCoverClient(title, artist);
    if (verified) return verified;
    const cleanTitle = String(title || "").trim();
    const cleanArtist = String(artist || "").split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i)[0].trim();
    const q = `${cleanTitle} ${cleanArtist}`.trim();
    if (!q) return "";
    const key = `${_coverFold(cleanTitle)} ${_coverFold(cleanArtist)}`.trim() || q.toLowerCase();
    if (_songCoverMemCache.has(key)) return _songCoverMemCache.get(key);
    let art = "";
    try {
      const itRes = await itFetch(`/search?term=${encodeURIComponent(q)}&entity=song&limit=2`, 4500).catch(() => null);
      const hit = itRes && itRes.results && itRes.results[0];
      if (hit && (hit.artwork || hit.artworkUrl100)) {
        art = String(hit.artwork || hit.artworkUrl100).replace("100x100bb", "500x500bb");
      }
    } catch {}
    if (!art) {
      try {
        const d = await api(`/api/deezer/search?q=${encodeURIComponent(q)}&limit=2`, 4500);
        const rows = (d && (d.songs || d.data)) || [];
        const hit = rows[0];
        if (hit) {
          art = hit.artwork || (hit.album && (hit.album.cover_big || hit.album.cover_medium)) || "";
        }
      } catch {}
    }
    if (art && /^https?:\/\//i.test(art)) {
      _songCoverMemCache.set(key, art);
      return art;
    }
    return "";
  }

  async function hydrateMissingTrackCovers(tracks, onUpdated) {
    if (!Array.isArray(tracks) || !tracks.length) return;
    let changed = false;
    for (const t of tracks) {
      if (!t) continue;
      const before = t.artwork;
      healTrackCoverClient(t);
      if (t.artwork !== before) changed = true;
    }
    const targets = tracks.filter((t) => t && t.title && (!t.artwork || String(t.artwork).startsWith("/cover")));
    if (targets.length) {
      await Promise.all(targets.slice(0, 20).map(async (t) => {
        const art = await resolveRealSongCoverClient(t.title, artistName(t) || t.artist);
        if (art) {
          t.artwork = art;
          changed = true;
        }
      }));
    }
    if (changed && typeof onUpdated === "function") onUpdated();
  }

  function cardHTML(t) {
    const liked = isLiked(t);
    const saved = isSaved(t);
    return `
      <div class="card-wrap">
      <div class="card">
        <button type="button" class="card-hit" data-open-detail="${escapeAttr(t.id)}" title="Details">
          <div class="art">
            <img src="${escapeAttr(artUrl(t))}" alt="" loading="lazy" onerror="handleImgErr(this)"/>
            ${sourceBadge(t.source)}
            ${liked ? `<span class="liked-dot"><span class="material-symbols-outlined filled">favorite</span></span>` : ""}
          </div>
          <h3>${escapeHTML(t.title)}</h3>
          <p>${escapeHTML(t.artist)}</p>
        </button>
        <button type="button" class="play-fab" data-play="${escapeAttr(t.id)}" data-source="${escapeAttr(t.source || "")}" data-title="${escapeAttr(t.title || "")}" data-artist="${escapeAttr(t.artist || "")}" title="Play">
          <span class="material-symbols-outlined filled">play_arrow</span>
        </button>
      </div>
      ${(t.trackId || t.videoId || t.source === "apple" || t.source === "itunes" || t.source === "deezer") ? `<button type="button" class="card-dl ${saved ? "on" : ""}" data-dl="${escapeAttr(t.id)}" title="${saved ? "Saved offline" : "Save offline"}"><span class="material-symbols-outlined">${saved ? "download_done" : "download"}</span></button>` : ""}
      </div>`;
  }

  function rowHTML(t, i, extra = "") {
    return `
      <button class="track-row ${current() && current().id === t.id ? "active" : ""}" data-play="${escapeAttr(t.id)}" data-idx="${i}" data-source="${escapeAttr(t.source || "")}" data-title="${escapeAttr(t.title || "")}" data-artist="${escapeAttr(t.artist || "")}">
        <img src="${escapeAttr(artUrl(t))}" alt="" loading="lazy" onerror="handleImgErr(this)"/>
        <div>
          <div class="t-title">${escapeHTML(t.title)}</div>
          <div class="t-sub">${escapeHTML(t.artist)}${t.source ? ` · ${t.source === "apple" ? "iTunes" : escapeHTML(t.source)}` : ""}</div>
        </div>
        <span class="t-dur">${t.source === "radio" ? "LIVE" : fmt(t.duration)}</span>
        ${extra}
      </button>`;
  }

  function libTrackHTML(t, i, opt = {}) {
    const isDl = Boolean(opt.isDownload || opt.where === "downloads" || state.activePlaylist === "downloads" || (state.view === "library" && state.libFilter === "downloaded") || isSaved(t));
    const hasLyr = isDl && hasOfflineSyncedLyrics(t);
    return `
      <div class="track-row lib-track ${current() && current().id === t.id ? "active" : ""}">
        <button type="button" class="lib-track-main" data-play="${escapeAttr(t.id)}" data-idx="${i}" data-source="${escapeAttr(t.source || "")}" data-title="${escapeAttr(t.title || "")}" data-artist="${escapeAttr(t.artist || "")}">
          <img src="${escapeAttr(artUrl(t))}" alt="" loading="lazy" onerror="handleImgErr(this)"/>
          <div>
            <div class="t-title">${escapeHTML(t.title)}</div>
            <div class="t-sub">${escapeHTML(t.artist)}${hasLyr ? ` · <span class="dl-lyr-pill" title="Synced lyrics saved for offline access">Synced lyrics</span>` : ""}</div>
          </div>
        </button>
        <div class="lib-track-actions">
          ${isDl ? `
            <button type="button" class="icon-btn del-btn" data-del-dl="${escapeAttr(t.id)}" title="Delete download" aria-label="Delete downloaded song">
              <span class="material-symbols-outlined">delete</span>
            </button>
          ` : ""}
          <button type="button" class="icon-btn more-btn" data-more="${escapeAttr(t.id)}" data-idx="${i}" title="More" aria-label="More options">
            <span class="material-symbols-outlined">more_vert</span>
          </button>
        </div>
      </div>`;
  }

  function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(s) { return escapeHTML(s); }

  function homeTrackPool() {
    const h = state.home;
    if (!h) return [];
    const shelves = (h.shelves || []).flatMap((s) => s.tracks || []);
    const plTracks = []
      .concat(h.globalPlaylists || [], h.countryPlaylists || [], h.forYouPlaylists || [], h.viralPlaylists || [])
      .flatMap((p) => (p && p.tracks) || []);
    return [].concat(
      shelves,
      h.youtubeCharts || [],
      h.youtubeLocal || [],
      h.youtubeIndia || [],
      h.audius || [],
      h.underground || [],
      h.radio || [],
      plTracks,
      state.forYou || [],
      state.recents || []
    );
  }

  function findTrack(id, fallbackMeta = null) {
    try {
      const pools = [
        state.queue,
        state.liked,
        (state.ytLiked && state.ytLiked.tracks) || [],
        (state.ytOpen && state.ytOpen.tracks) || [],
        state.recents,
        state.radio,
        ...(state.playlists.map((p) => p.tracks)),
        state.downloads,
        homeTrackPool(),
        (state.catalogPlaylist && state.catalogPlaylist.tracks) || [],
        (state.discovery && state.discovery.tracks) || [],
        state.queueRecs || [],
        state.search ? [].concat(
          state.search.youtube || [],
          state.search.deezer || [],
          state.search.apple || [],
          state.search.itunes || [],
          state.search.audius || [],
          state.search.radio || [],
          state.search.offline || []
        ) : [],
        (state.artistPage && state.artistPage.popular) || [],
        (state.artistPage && state.artistPage.songs) || [],
      ];
      for (const arr of pools) {
        const hit = (arr || []).find((t) => t && t.id === id);
        if (hit) return hit;
      }
      if (fallbackMeta && fallbackMeta.title) {
        const wantT = String(fallbackMeta.title || "").toLowerCase().trim();
        const wantA = String(fallbackMeta.artist || "").toLowerCase().trim();
        for (const arr of pools) {
          const hit = (arr || []).find((t) =>
            t &&
            String(t.title || "").toLowerCase().trim() === wantT &&
            (!wantA || String(t.artist || "").toLowerCase().trim() === wantA)
          );
          if (hit) return hit;
        }
      }
    } catch {}
    return null;
  }

  function playFromList(list, index) {
    hapticFeedback("light");
    const next = list && list[index];
    const cur = current();
    const same = !!(next && cur && cur.id === next.id);
    let src = Array.isArray(list) ? list.slice() : [];
    let idx = Number.isInteger(index) ? index : 0;
    const wanted = src[idx];
    // Queue hygiene: keep mixes/compilations/podcasts out of the queue so it
    // lists real songs (Spotify-style) and strip any accidental consecutive duplicate
    // songs so the same song never plays twice in a row.
    if (src.length > 0) {
      const clean = [];
      for (let i = 0; i < src.length; i++) {
        const item = src[i];
        if (!item) continue;
        if (i !== idx && !looksLikeSong(item)) continue;
        // Never allow the exact same song twice in a row in the queue
        if (clean.length > 0 && isSameSongClient(clean[clean.length - 1], item) && i !== idx) {
          continue;
        }
        if (clean.length > 0 && isSameSongClient(clean[clean.length - 1], item) && i === idx) {
          clean[clean.length - 1] = item;
          continue;
        }
        clean.push(item);
      }
      if (clean.length) {
        src = clean;
        idx = wanted ? Math.max(0, src.findIndex((t) => t && (t === wanted || t.id === wanted.id))) : 0;
      }
    }
    _shuffleVisitedKeys.clear();
    if (wanted) _shuffleVisitedKeys.add(canonicalSongKey(wanted));
    state.queue = src.slice();
    state.index = idx;
    state.playerReady = true;
    // If the user played a single track or the last track of a list, immediately
    // line up Spotify-style similar songs after it so Up Next is ready.
    if (wanted && wanted.source !== "radio" && state.index + 1 >= state.queue.length) {
      fillRelatedQueue(wanted);
    }
    if (same) {
      const hasResolvedMedia = Boolean(
        cur.videoId || cur.streamUrl || cur.url || cur.source === "audius" || cur.source === "radio"
      );
      const ytState = (state.yt && typeof state.yt.getPlayerState === "function") ? state.yt.getPlayerState() : -1;
      const ytActivelyLoaded = Boolean(cur.videoId && !cur._playingViaAudio && (ytState === 1 || ytState === 2 || ytState === 3));
      const audioActivelyLoaded = Boolean((cur._playingViaAudio || !cur.videoId) && audio.src && audio.networkState !== HTMLMediaElement.NETWORK_EMPTY && !audio.error);
      if (hasResolvedMedia && (ytActivelyLoaded || audioActivelyLoaded || npActive)) {
        if (!state.playing) togglePlay();
        renderQueue();
        syncPlayerVisibility();
        return;
      }
    }
    playCurrent(true);
    renderQueue();
    syncPlayerVisibility();
  }

  let relatedGen = 0;
  let artistGen = 0;

  // ── Browser-side artist catalogue (Deezer, METADATA ONLY) ──────────────
  // The profile must show the artist's REAL discography — all songs, their
  // most popular tracks and every album — for every artist. The worker's
  // /api/artist is the primary source; when it comes back thin or fails
  // (old deployment, cold start), we complete the catalogue straight from
  // the Deezer public API in the browser: artist search → top tracks
  // (Deezer's own popularity ranking) → full album list → newest albums'
  // track lists. No audio is ever fetched from Deezer — no preview URLs
  // are read or played. Every track carries a playQuery that resolves
  // through MUCHI's existing playback pipeline for the FULL track.
  const DZ_BASE = "https://api.deezer.com";

  function normalizeClientDeezerTrack(t, fallbackArtist = "", fallbackArt = "") {
    if (!t) return null;
    const title = String(t.title || t.title_short || t.trackName || "").trim();
    if (!title) return null;
    const cleanId = String(t.id || t.trackId || t.rawId || t.videoId || "").replace(/^(deezer:|apple:|itunes:|yt:)/, "");
    const artist = String((t.artist && (t.artist.name || t.artist)) || t.artistName || fallbackArtist || "Artist").trim();
    const album = String((t.album && (t.album.title || t.album)) || t.collectionName || t.albumTitle || "").trim();
    const duration = Number(t.duration || 0) || Math.round(Number(t.trackTimeMillis || 0) / 1000) || 180;
    const artwork = String(
      (t.album && (t.album.cover_xl || t.album.cover_big || t.album.cover_medium || t.album.cover)) ||
      (t.artist && (t.artist.picture_xl || t.artist.picture_big || t.artist.picture_medium)) ||
      (t.artworkUrl100 ? String(t.artworkUrl100).replace("100x100bb", "400x400bb") : "") ||
      t.artwork ||
      fallbackArt ||
      "/cover-default.jpg"
    ).trim();
    const slug = `${title.toLowerCase().replace(/[^a-z0-9]/g, "")}_${artist.toLowerCase().replace(/[^a-z0-9]/g, "")}` || "track";
    const inferredVideoId = t.videoId || (/^yt:/i.test(String(t.id || "")) && /^[A-Za-z0-9_-]{11}$/.test(cleanId) ? cleanId : "");
    return {
      id: cleanId ? `deezer:${cleanId}` : `deezer:${slug}`,
      rawId: cleanId || slug,
      source: "deezer",
      title,
      artist,
      album,
      duration,
      artwork,
      streamUrl: t.streamUrl || "",
      previewUrl: "",
      preview: "",
      playQuery: t.playQuery || `${title} ${artist} official audio`.trim(),
      videoId: inferredVideoId,
    };
  }

  function dzJsonp(cleanPath, ms = 4500) {
    return new Promise((resolve, reject) => {
      if (typeof document === "undefined") return reject(new Error("no document"));
      const cbName = `__muchi_dz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const sep = cleanPath.includes("?") ? "&" : "?";
      const src = `${DZ_BASE}${cleanPath}${sep}output=jsonp&callback=${cbName}`;
      let script = null;
      let done = false;
      const cleanup = () => {
        done = true;
        try { delete window[cbName]; } catch { window[cbName] = undefined; }
        if (script && script.parentNode) script.parentNode.removeChild(script);
      };
      const timer = setTimeout(() => {
        if (done) return;
        cleanup();
        reject(new Error("deezer jsonp timeout"));
      }, ms);
      window[cbName] = (data) => {
        if (done) return;
        clearTimeout(timer);
        cleanup();
        if (data && !data.error) resolve(data);
        else reject(new Error((data && data.error && data.error.message) || "deezer jsonp error"));
      };
      script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onerror = () => {
        if (done) return;
        clearTimeout(timer);
        cleanup();
        reject(new Error("deezer jsonp script error"));
      };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  async function dzFetch(path, ms = 12000) {
    const cleanPath = path.startsWith("http") ? (new URL(path).pathname + new URL(path).search) : (path.startsWith("/") ? path : `/${path}`);
    let q = "";
    try {
      const u = new URL(path.startsWith("http") ? path : `https://api.deezer.com${cleanPath}`);
      q = u.searchParams.get("q") || u.searchParams.get("term") || "";
    } catch {}

    const hasValidPayload = (obj) => {
      if (!obj || typeof obj !== "object" || obj.error) return false;
      if (obj.id || (obj.tracks && Array.isArray(obj.tracks.data))) return true;
      const arr = Array.isArray(obj.data) ? obj.data : (Array.isArray(obj.results) ? obj.results : obj.deezer);
      return Array.isArray(arr) && arr.length > 0;
    };

    // 1. Primary channel: First-party generic catalog proxy (bypasses all ad blockers & track blockers)
    try {
      const catRes = await api(`/api/catalog/proxy?provider=deezer&path=${encodeURIComponent(cleanPath)}&${glq()}`, Math.min(ms, 8000));
      if (hasValidPayload(catRes)) {
        if (!Array.isArray(catRes.data) && (Array.isArray(catRes.results) || Array.isArray(catRes.deezer))) {
          catRes.data = catRes.results || catRes.deezer;
        }
        return catRes;
      }
    } catch {}

    // 2. Secondary channel: First-party Worker proxy (/api/deezer/proxy)
    try {
      const proxyRes = await api(`/api/deezer/proxy?path=${encodeURIComponent(cleanPath)}&${glq()}`, Math.min(ms, 8000));
      if (hasValidPayload(proxyRes)) {
        if (!Array.isArray(proxyRes.data) && (Array.isArray(proxyRes.results) || Array.isArray(proxyRes.deezer))) {
          proxyRes.data = proxyRes.results || proxyRes.deezer;
        }
        return proxyRes;
      }
    } catch {}

    // 3. Tertiary channel: Neutral catalog query search
    if (q) {
      try {
        const catSr = await api(`/api/catalog/search?provider=deezer&q=${encodeURIComponent(q)}&${glq()}`, Math.min(ms, 7000));
        const list = (catSr && (catSr.deezer || catSr.data || catSr.results)) || [];
        if (Array.isArray(list) && list.length) {
          return { data: list, results: list, deezer: list };
        }
      } catch {}

      try {
        const sr = await api(`/api/search?source=deezer&q=${encodeURIComponent(q)}&refresh=1&${glq()}`, Math.min(ms, 7000));
        if (sr && Array.isArray(sr.deezer) && sr.deezer.length) {
          return { data: sr.deezer, results: sr.deezer, deezer: sr.deezer };
        }
      } catch {}
    }

    // 4. Native browser JSONP to api.deezer.com (bypasses CORS & datacenter IP rate limits using client residential IP)
    try {
      const jp = await dzJsonp(cleanPath, Math.min(ms, 4500));
      if (hasValidPayload(jp)) return jp;
    } catch {}

    // 5. Direct fetch fallback with safe timeout (silently catch adblock / CORS rejections)
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.min(ms, 3500));
    try {
      const r = await fetch(DZ_BASE + cleanPath, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (r.ok) {
        const j = await r.json();
        if (hasValidPayload(j)) return j;
      }
    } catch {
      // Ignored: adblock or CORS prevented direct third-party fetch
    } finally {
      clearTimeout(t);
    }

    // 6. Studio catalog synthesis when searching tracks so Deezer search never fails empty
    if (q && !cleanPath.startsWith("/search/artist") && !cleanPath.startsWith("/search/album")) {
      try {
        const itFallback = await itFetch(`/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=50`);
        const itRows = (itFallback && (itFallback.results || itFallback.apple || itFallback.itunes)) || [];
        if (Array.isArray(itRows) && itRows.length) {
          const mapped = itRows.map((item) => normalizeClientDeezerTrack(item)).filter(Boolean);
          if (mapped.length) return { data: mapped, results: mapped, deezer: mapped };
        }
      } catch {}
    }

    throw new Error("deezer search request failed across all channels");
  }
  const dzFold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  async function deezerBrowserCatalog(name) {
    const want = dzFold(name);
    if (!want) return null;
    const sj = await dzFetch(`/search/artist?q=${encodeURIComponent(String(name).slice(0, 80))}&limit=10`);
    const rows = (sj && sj.data) || [];

    const exact = rows.filter((r) => dzFold(r.name) === want);
    let a = exact.length
      ? exact.sort((x, y) => Number(y.nb_fan || 0) - Number(x.nb_fan || 0))[0]
      : null;
    if (!a) {
      const cands = rows.filter((r) => dzFold(r.name).startsWith(want));
      if (cands.length) {
        a = cands.sort((x, y) => (dzFold(x.name).length - dzFold(y.name).length) || (Number(y.nb_fan || 0) - Number(x.nb_fan || 0)))[0];
      }
    }
    if (!a || !a.id) return null;
    const artist = { name: a.name || name, artwork: a.picture_medium || "" };
    const dzSong = (t, srcArt) => {
      if (!t || (!t.title && !t.trackName)) return null;
      return normalizeClientDeezerTrack(t, artist.name, srcArt || artist.artwork);
    };
    // 1) Most popular tracks
    const top = [];
    try {
      const tj = await dzFetch(`/artist/${a.id}/top?limit=50`);
      for (const t of (tj && tj.data) || []) { const s = dzSong(t, artist.artwork); if (s) top.push(s); }
    } catch {}
    // 2) Complete discography
    const albums = [];
    let index = 0;
    for (let page = 0; page < 3; page++) {
      let aj;
      try { aj = await dzFetch(`/artist/${a.id}/albums?limit=100&index=${index}`); } catch { break; }
      const list = (aj && aj.data) || [];
      if (!list.length) break;
      for (const al of list) {
        if (!al || !al.id) continue;
        const rt = String(al.record_type || "").toLowerCase();
        const cleanAlbId = String(al.id).replace(/^deezer-album:/, "");
        albums.push({
          id: `deezer-album:${cleanAlbId}`,
          kind: "playlist",
          title: al.title || "Album",
          artist: artist.name,
          artwork: al.cover_medium || al.cover_big || "",
          source: "deezer",
          query: `${al.title || ""} ${artist.name}`.trim(),
          year: al.release_date ? String(al.release_date).slice(0, 4) : "",
          recordType: rt === "single" ? "Single" : rt === "ep" ? "EP" : "Album",
        });
      }
      index += list.length;
      if (index >= Number(aj.total || 0) || index >= 100) break;
    }
    // 3) Newest 8 albums → full track lists
    const all = [...top];
    const seen = new Set(all.map((t) => dzFold(t.title) + "|" + dzFold(t.artist)));
    const expand = albums.slice(0, 8);
    for (let i = 0; i < expand.length; i += 4) {
      const chunk = expand.slice(i, i + 4);
      const res = await Promise.all(chunk.map((al) => dzFetch(`/album/${String(al.id).replace("deezer-album:", "")}`).catch(() => null)));
      for (const r of res) {
        const rows2 = (r && ((r.tracks && r.tracks.data) || (r.data && r.data.tracks && r.data.tracks.data) || (Array.isArray(r.data) ? r.data : null))) || [];
        const albArt = (r && (r.cover_medium || (r.data && r.data.cover_medium))) || artist.artwork;
        for (const t of rows2) {
          const s = dzSong(t, albArt);
          if (!s) continue;
          const k = dzFold(s.title) + "|" + dzFold(s.artist);
          if (seen.has(k)) continue;
          seen.add(k);
          all.push(s);
        }
      }
    }
    return { artist, popular: top, songs: all, albums };
  }

  // ── iTunes Search (worldwide catalogue, first-party proxied, adblock-immune) ────
  const ITUNES_BASE = "https://itunes.apple.com";

  function normalizeItunesItem(item) {
    if (!item) return null;
    const cleanId = String(item.trackId || item.id || item.collectionId || "").replace(/^apple:|^itunes:/, "");
    const title = item.trackName || item.title || "Song";
    const artist = item.artistName || item.artist || "Artist";
    const album = item.collectionName || item.album || "";
    const duration = Math.round((item.trackTimeMillis || 0) / 1000) || Number(item.duration) || 0;
    const artwork = String(item.artworkUrl100 || item.artwork || "").replace("100x100bb", "400x400bb") || "/cover-default.jpg";
    return {
      ...item,
      id: cleanId ? `apple:${cleanId}` : `apple:${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      source: "apple",
      title,
      artist,
      album,
      duration,
      artwork,
      previewUrl: "",
      playQuery: `${title} ${artist} official audio`.trim(),
      trackId: cleanId || item.trackId,
      trackName: title,
      artistName: artist,
      collectionName: album,
      trackTimeMillis: duration * 1000,
      artworkUrl100: artwork,
    };
  }

  async function itFetch(path, ms = 12000) {
    const cleanPath = path.startsWith("http") ? (new URL(path).pathname + new URL(path).search) : (path.startsWith("/") ? path : `/${path}`);

    let term = "";
    let country = (state.prefs && state.prefs.country) || "";
    try {
      const u = new URL(path.startsWith("http") ? path : `https://itunes.apple.com${cleanPath}`);
      term = u.searchParams.get("term") || u.searchParams.get("q") || "";
      country = u.searchParams.get("country") || country;
    } catch {}

    // 0. On Native App (or when Worker edge IP is rate-limited by Apple), try direct residential IP fetch first
    if (IS_NATIVE) {
      const ctrl0 = new AbortController();
      const t0 = setTimeout(() => ctrl0.abort(), Math.min(ms, 3800));
      try {
        const r0 = await fetch(ITUNES_BASE + cleanPath, { signal: ctrl0.signal });
        if (r0.ok) {
          const j0 = await r0.json();
          if (j0 && Array.isArray(j0.results) && j0.results.length) {
            return {
              results: j0.results.map(normalizeItunesItem).filter(Boolean),
            };
          }
        }
      } catch {} finally {
        clearTimeout(t0);
      }
    }

    // 1. Primary channel: First-party generic catalog proxy (bypasses all ad blockers)
    try {
      const catRes = await api(`/api/catalog/proxy?provider=apple&path=${encodeURIComponent(cleanPath)}&${glq()}`, Math.min(ms, 12000));
      const list = (catRes && (Array.isArray(catRes.results) ? catRes.results : (Array.isArray(catRes.apple) ? catRes.apple : catRes.itunes))) || [];
      if (Array.isArray(list) && list.length) {
        return {
          results: list.map(normalizeItunesItem).filter(Boolean),
        };
      }
    } catch {}

    // 2. Secondary channel: Dedicated worker proxy (/api/itunes/proxy)
    try {
      const proxyRes = await api(`/api/itunes/proxy?path=${encodeURIComponent(cleanPath)}&${glq()}`, Math.min(ms, 12000));
      const list = (proxyRes && (Array.isArray(proxyRes.results) ? proxyRes.results : (Array.isArray(proxyRes.apple) ? proxyRes.apple : proxyRes.itunes))) || [];
      if (Array.isArray(list) && list.length) {
        return {
          results: list.map(normalizeItunesItem).filter(Boolean),
        };
      }
    } catch {}

    // 3. Tertiary channel: First-party search fallback (/api/catalog/search or /api/itunes/search)
    if (term) {
      try {
        const catSr = await api(`/api/catalog/search?provider=apple&term=${encodeURIComponent(term)}&country=${encodeURIComponent(country)}&${glq()}`, Math.min(ms, 10000));
        const list = (catSr && (catSr.results || catSr.apple || catSr.itunes)) || [];
        if (Array.isArray(list) && list.length) {
          return {
            results: list.map(normalizeItunesItem).filter(Boolean),
          };
        }
      } catch {}

      try {
        const pr = await api(`/api/itunes/search?term=${encodeURIComponent(term)}&country=${encodeURIComponent(country)}&${glq()}`, Math.min(ms, 10000));
        const list = (pr && (pr.results || pr.apple || pr.itunes)) || [];
        if (Array.isArray(list) && list.length) {
          return {
            results: list.map(normalizeItunesItem).filter(Boolean),
          };
        }
      } catch {}

      try {
        const sr = await api(`/api/search?source=apple&q=${encodeURIComponent(term)}&country=${encodeURIComponent(country)}&refresh=1&${glq()}`, Math.min(ms, 10000));
        const list = (sr && (sr.apple || sr.itunes)) || [];
        if (Array.isArray(list) && list.length) {
          return {
            results: list.map(normalizeItunesItem).filter(Boolean),
          };
        }
      } catch {}
    }

    // 4. Quaternary direct fetch fallback with safe timeout (silently catch adblock / CORS rejections)
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.min(ms, 4000));
    try {
      const r = await fetch(ITUNES_BASE + cleanPath, { signal: ctrl.signal });
      if (r.ok) {
        const j = await r.json();
        if (j && Array.isArray(j.results)) {
          return {
            results: j.results.map(normalizeItunesItem).filter(Boolean),
          };
        }
      }
    } catch {
      // Ignored: adblock or CORS prevented direct third-party fetch
    } finally {
      clearTimeout(t);
    }

    throw new Error("itunes search request failed across all channels");
  }
  async function itunesBrowserCatalog(name) {
    const want = dzFold(name);
    if (!want) return null;
    const country = String((state.prefs && state.prefs.country) || "IN");
    const ssj = await itFetch(`/search?term=${encodeURIComponent(String(name).slice(0, 80))}&entity=song&limit=200&country=${country}`);
    const rows = (ssj && ssj.results) || [];
    const related = rows.filter((t) => {
      const na = dzFold(t.artistName || t.artist || "");
      if (!na) return false;
      if (na === want) return true;
      if (want.length >= 3 && (na.includes(want) || (na.length >= 3 && want.includes(na)))) return true;
      return false;
    });
    if (!related.length) return null;
    const exactRows = related.filter((t) => dzFold(t.artistName || t.artist || "") === want);
    let an = want;
    if (!exactRows.length) {
      const freq = new Map();
      for (const t of related.slice(0, 50)) {
        const na = dzFold(t.artistName || t.artist || "");
        freq.set(na, (freq.get(na) || 0) + 1);
      }
      an = "";
      let best = 0;
      for (const [k, v] of freq) if (v > best || (v === best && k.length > an.length)) { an = k; best = v; }
    }
    const orig = related.find((t) => dzFold(t.artistName || t.artist || "") === an) || related[0];
    const artistName = orig.artistName || orig.artist || name;
    const art = String(orig.artworkUrl100 || orig.artwork || "").replace("100x100bb", "500x500bb");
    const itSong = (t) => {
      if (!t || (!t.trackName && !t.title)) return null;
      const cleanId = String(t.trackId || t.id || "").replace(/^apple:|^itunes:/, "");
      const title = t.trackName || t.title;
      const artName = t.artistName || t.artist || artistName;
      const albName = t.collectionName || t.album || "";
      const duration = Math.round(Number(t.trackTimeMillis || 0) / 1000) || Number(t.duration) || 0;
      const artwork = String(t.artworkUrl100 || t.artwork || "").replace("100x100bb", "300x300bb") || "/cover-default.jpg";
      return {
        id: `itunes:${cleanId}`,
        source: "itunes",
        title,
        artist: artName,
        album: albName,
        duration,
        artwork,
        playQuery: `${title} ${artName} official audio`.trim(),
      };
    };
    const byArtist = (na) => na === an || na.includes(an);
    const songs = [];
    for (const t of rows) if (byArtist(dzFold(t.artistName || t.artist || ""))) { const s = itSong(t); if (s) songs.push(s); }
    const sj2 = await itFetch(`/search?term=${encodeURIComponent(artistName.slice(0, 80))}&entity=album&limit=200&country=${country}`).catch(() => null);
    const albums = [];
    for (const t of (sj2 && sj2.results) || []) {
      if (!t || (!t.collectionName && !t.title)) continue;
      if (!byArtist(dzFold(t.artistName || t.artist || ""))) continue;
      const albCol = t.collectionName || t.title;
      const albArt = t.artistName || t.artist || artistName;
      const cleanAlbId = String(t.collectionId || t.id || "").replace(/^itunes-album:/, "");
      albums.push({
        id: `itunes-album:${cleanAlbId}`,
        kind: "playlist",
        title: albCol,
        artist: albArt,
        artwork: String(t.artworkUrl100 || t.artwork || "").replace("100x100bb", "300x300bb") || "/cover-default.jpg",
        source: "itunes",
        query: `${albCol} ${albArt}`.trim(),
        year: t.releaseDate ? String(t.releaseDate).slice(0, 4) : "",
        recordType: "Album",
      });
    }
    return { artist: { name: artistName, artwork: art }, popular: null, songs, albums };
  }

  // ── Worker search merge + YouTube playlists ────────────────────────────
  // The worker's /api/search returns the best YouTube/Apple/Audius rows
  // for the name plus the artist's YouTube playlists (kind:"playlist").
  // Rows pass the same strict looksLikeSong filter as everywhere else.
  async function artistSearchCatalog(name) {
    const want = dzFold(String(name || ""));
    if (!want) return { songs: [], playlists: [] };
    const s = await api(`/api/search?q=${encodeURIComponent(String(name).slice(0, 80))}&${glq()}`, 25000);
    const qwords = want.split(/\s+/).filter((w) => w.length > 2);
    const songs = [];
    for (const t of [].concat(s.youtube || [], s.apple || [], s.audius || [])) {
      if (!t || !looksLikeSong(t)) continue; // strict: real songs only
      const hay = `${dzFold(t.title)} ${dzFold(t.artist)}`;
      if (!hay.includes(want) && !qwords.some((w) => hay.includes(w))) continue;
      songs.push(t);
      if (songs.length >= 150) break;
    }
    const playlists = [];
    for (const p of [].concat(s.playlists || [])) {
      if (!p || !p.title) continue;
      const hay = dzFold(p.title);
      if (!hay.includes(want) && !qwords.some((w) => hay.includes(w))) continue;
      playlists.push({
        id: `ytpl:${p.playlistId || p.id || ""}`,
        kind: "playlist",
        title: p.title,
        artist: p.artist && p.artist !== "YouTube" ? p.artist : name,
        artwork: p.artwork || "",
        source: "youtube",
        playlistId: p.playlistId || "",
        query: p.title,
      });
      if (playlists.length >= 12) break;
    }
    return { songs, playlists };
  }

  let plRecs = { key: "", tracks: [], loading: false };

  function relatedSkip(seed) {
    return [seed && seed.id, seed && seed.videoId].filter(Boolean).join(",");
  }

  function looksLikeSong(t) {
    if (!t) return false;
    const dur = Number(t.duration) || 0;
    // Verified official catalogs from iTunes and Deezer are studio music
    if (t.source === "apple" || t.source === "itunes" || t.source === "deezer") {
      return dur <= 3600;
    }
    if (t.source === "audius" || t.source === "radio") return true;
    if (dur > 1200) return false;
    if (dur > 0 && dur < 20) return false;
    if (t.artist && typeof t.artist === "string" && /\s*-\s*topic$/i.test(t.artist)) {
      t.artist = t.artist.replace(/\s*-\s*topic$/i, "").trim();
    }
    const artist = String(t.artist || "").toLowerCase().trim();
    const title = String(t.title || "").toLowerCase().trim();
    const text = `${title} ${artist}`;
    if (/\b(gameplay|walkthrough|playthrough|let'?s play|gaming|fortnite|minecraft|roblox|gta\s*[5v]?|valorant|call of duty|apex legends|genshin|game review|movie review|film review|movie recap|trailer|teaser|official trailer|full movie|episode|season \d+|vlog|reaction|reacting to|unboxing|tech review|speedrun|stream highlight|news|breaking news|imran khan|nato|modi|biden|trump|putin|ukraine|parliament|election|documentary|tutorial|how to|webinar|ted talk|interview|standup|stand-up|comedy skit|#shorts?)\b/i.test(text)) {
      return false;
    }
    if (/^(episode|podcast|clip|news|trailer|gaming|movie)$/i.test(artist)) return false;
    if (/\b(non[- ]?stop|full album|album mix|megamix|compilation|dj set|live set|billboard|1 ?hour|one hour|hour mix|karaoke)\b/i.test(text)) return false;
    return true;
  }

  // ── Spotify-Style Vibe, Language/Culture, Genre, Mood, Tempo & Style Engine (Client) ──
  const CLIENT_GENRE_CLUSTERS = {
    pop: ["pop", "dance pop", "synthpop", "electropop", "indie pop", "teen pop", "disco", "funk", "new wave"],
    hiphop: ["hip-hop", "hip hop", "rap", "trap", "drill", "melodic rap", "boom bap", "r&b", "rnb", "contemporary r&b"],
    rnb: ["r&b", "rnb", "soul", "neo-soul", "funk", "contemporary r&b", "afrobeats", "alt r&b", "pop"],
    electronic: ["electronic", "edm", "house", "tech house", "deep house", "techno", "trance", "drum and bass", "dnb", "dubstep", "future bass", "synthwave", "dance", "phonk"],
    rock: ["rock", "alt rock", "alternative", "indie rock", "classic rock", "hard rock", "punk", "pop punk", "grunge", "metal", "post-punk", "emo"],
    indie: ["indie", "indie pop", "indie rock", "bedroom pop", "dream pop", "shoegaze", "lo-fi", "folk", "singer-songwriter", "alternative"],
    latin: ["latin", "reggaeton", "urbano", "bachata", "salsa", "corridos", "latin pop", "afrobeats", "dancehall"],
    afro: ["afrobeats", "amapiano", "afropop", "dancehall", "reggae", "r&b"],
    kpop: ["k-pop", "kpop", "j-pop", "jpop", "dance pop", "pop"],
    desi: ["bollywood", "hindi", "punjabi", "desi", "indian pop", "sufi", "tamil", "telugu", "indie_in", "pak_pop", "desi_hiphop", "south_indian"],
    chill: ["lo-fi", "lofi", "ambient", "chill", "chillhop", "downtempo", "acoustic", "jazz", "classical", "instrumental", "indie"],
    country: ["country", "americana", "folk", "bluegrass", "singer-songwriter", "soft rock"],
  };

  const CLIENT_ARTIST_PEERS = {
    "arijit singh": ["Pritam", "Vishal Mishra", "Atif Aslam", "Shreya Ghoshal", "Jubin Nautiyal", "Sachin-Jigar", "Darshan Raval", "KK", "Amit Trivedi"],
    "pritam": ["Arijit Singh", "KK", "Vishal-Shekhar", "Amit Trivedi", "Atif Aslam", "Mohit Chauhan", "Shreya Ghoshal", "Sachin-Jigar"],
    "vishal mishra": ["Arijit Singh", "Sachin-Jigar", "Pritam", "Jubin Nautiyal", "Darshan Raval", "Atif Aslam", "Mithoon", "Shreya Ghoshal"],
    "sachin jigar": ["Arijit Singh", "Vishal Mishra", "Pritam", "Amit Trivedi", "Shilpa Rao", "Badshah", "Shreya Ghoshal", "Varun Jain"],
    "shreya ghoshal": ["Arijit Singh", "Pritam", "Sonu Nigam", "A.R. Rahman", "Atif Aslam", "Vishal Mishra", "Shilpa Rao"],
    "darshan raval": ["Arijit Singh", "Jubin Nautiyal", "Armaan Malik", "Vishal Mishra", "Anuv Jain", "Aditya Rikhari", "Jasleen Royal", "King"],
    "jubin nautiyal": ["Arijit Singh", "Vishal Mishra", "Atif Aslam", "Darshan Raval", "B Praak", "Mithoon", "Pritam"],
    "badshah": ["Diljit Dosanjh", "Yo Yo Honey Singh", "Guru Randhawa", "Karan Aujla", "Sachin-Jigar", "King", "Arijit Singh"],
    "diljit dosanjh": ["Karan Aujla", "AP Dhillon", "Shubh", "Sidhu Moose Wala", "Gurinder Gill", "Badshah", "Guru Randhawa"],
    "karan aujla": ["Diljit Dosanjh", "AP Dhillon", "Shubh", "Sidhu Moose Wala", "Gurinder Gill", "DIVINE", "Ikky"],
    "ap dhillon": ["Gurinder Gill", "Shubh", "Karan Aujla", "Diljit Dosanjh", "Talwiinder"],
    "shubh": ["Karan Aujla", "AP Dhillon", "Diljit Dosanjh", "Sidhu Moose Wala", "Gurinder Gill", "Talwiinder"],
    "anuv jain": ["Prateek Kuhad", "Aditya Rikhari", "The Local Train", "Mitraz", "Akshath", "Faheem Abdullah", "AUR", "Hasan Raheem"],
    "prateek kuhad": ["Anuv Jain", "The Local Train", "Aditya Rikhari", "Ritviz", "Zaeden", "When Chai Met Toast"],
    "aditya rikhari": ["Anuv Jain", "Prateek Kuhad", "Mitraz", "Akshath", "Talwiinder", "Hasan Raheem", "AUR", "Faheem Abdullah"],
    "the local train": ["Anuv Jain", "Prateek Kuhad", "Aditya Rikhari", "Kaavish", "Bayaan"],
    "mitraz": ["Aditya Rikhari", "Anuv Jain", "Akshath", "Darshan Raval", "King", "Talwiinder"],
    "talwiinder": ["Hasan Raheem", "Aditya Rikhari", "AP Dhillon", "Yashraj", "King", "Shubh", "Mitraz"],
    "hasan raheem": ["Talwiinder", "Abdul Hannan", "AUR", "Aditya Rikhari", "Anuv Jain", "Atif Aslam"],
    "aur": ["Anuv Jain", "Aditya Rikhari", "Hasan Raheem", "Abdul Hannan", "Faheem Abdullah", "Atif Aslam"],
    "atif aslam": ["Arijit Singh", "KK", "Pritam", "Rahat Fateh Ali Khan", "Vishal Mishra", "Mohit Chauhan"],
    "divine": ["KR$NA", "Seedhe Maut", "Karan Aujla", "Raftaar", "Hanumankind", "Badshah"],
    "kr na": ["Seedhe Maut", "DIVINE", "Raftaar", "Yashraj", "Hanumankind"],
    "krsna": ["Seedhe Maut", "DIVINE", "Raftaar", "Yashraj", "Hanumankind"],
    "seedhe maut": ["KR$NA", "DIVINE", "Yashraj", "Prabh Deep", "Raftaar", "Hanumankind"],
    "hanumankind": ["DIVINE", "Seedhe Maut", "KR$NA", "Sushin Shyam", "Karan Aujla"],
    "king": ["Darshan Raval", "Mitraz", "Badshah", "Aditya Rikhari", "Talwiinder", "Arijit Singh"],
    "the weeknd": ["SZA", "Drake", "Post Malone", "Ariana Grande", "Dua Lipa", "Travis Scott", "Frank Ocean"],
    "taylor swift": ["Sabrina Carpenter", "Olivia Rodrigo", "Gracie Abrams", "Chappell Roan", "Billie Eilish", "Lorde"],
    "sabrina carpenter": ["Chappell Roan", "Olivia Rodrigo", "Taylor Swift", "Ariana Grande", "Dua Lipa", "Gracie Abrams", "Tate McRae"],
    "billie eilish": ["Lana Del Rey", "Olivia Rodrigo", "Lorde", "Clairo", "The Neighbourhood", "SZA", "Gracie Abrams"],
    "sza": ["The Weeknd", "Kendrick Lamar", "Frank Ocean", "Summer Walker", "Daniel Caesar", "Kehlani", "Bryson Tiller"],
    "kendrick lamar": ["SZA", "Drake", "J. Cole", "Travis Scott", "Future", "Tyler, The Creator", "Doechii"],
    "drake": ["Kendrick Lamar", "Future", "21 Savage", "Travis Scott", "The Weeknd", "J. Cole"],
    "post malone": ["Morgan Wallen", "The Weeknd", "Noah Kahan", "Shaboozey", "Luke Combs", "Khalid"],
    "morgan wallen": ["Luke Combs", "Zach Bryan", "Post Malone", "Shaboozey", "Jelly Roll", "Tucker Wetmore"],
    "chappell roan": ["Sabrina Carpenter", "Olivia Rodrigo", "Gracie Abrams", "Charli xcx", "Lola Young", "Billie Eilish"],
    "gracie abrams": ["Sabrina Carpenter", "Olivia Rodrigo", "Taylor Swift", "Chappell Roan", "Clairo", "Role Model"],
    "clairo": ["beabadoobee", "Men I Trust", "Wallows", "Laufey", "Phoebe Bridgers", "Mitski", "Role Model"],
    "linkin park": ["Bring Me The Horizon", "Green Day", "Foo Fighters", "Sleep Token", "Bad Omens", "Muse"],
    "rose": ["Bruno Mars", "JENNIE", "LISA", "aespa", "NewJeans", "BLACKPINK"],
    "aespa": ["LE SSERAFIM", "NewJeans", "ILLIT", "BLACKPINK", "JENNIE", "LISA", "TWICE"],
    "bad bunny": ["KAROL G", "Feid", "Rauw Alejandro", "Peso Pluma", "J Balvin", "Maluma"],
    "rema": ["Burna Boy", "Asake", "Wizkid", "Ayra Starr", "Tems", "Tyla", "Omah Lay"],
  };

  function inferTrackVibeClient(t = {}) {
    const rawTitleStr = String(t.title || "");
    const rawArtistStr = String(artistName(t) || t.artist || "");
    const rawAlbumStr = String(t.album || "");
    const rawScriptBlob = `${rawTitleStr} ${rawArtistStr} ${rawAlbumStr}`;
    const rawGenre = String(t.genre || (t._vibeMeta && t._vibeMeta.genre) || "").toLowerCase().trim();
    const rawTitle = rawTitleStr.toLowerCase().trim();
    const rawArtist = rawArtistStr.toLowerCase().trim();
    const blob = `${rawTitle} ${rawArtist} ${rawGenre} ${rawAlbumStr.toLowerCase()}`;
    const primArt = canonicalPrimaryArtistClient(t);

    let cluster = "pop";
    let genre = rawGenre || "pop";
    let langCulture = (t._vibeMeta && t._vibeMeta.langCulture) || "western";
    let subCulture = (t._vibeMeta && t._vibeMeta.subCulture) || "english_pop";

    if (/[\u0A00-\u0A7F]|\b(punjabi|bhangra|diljit|karan aujla|ap dhillon|shubh|sidhu moose|gurinder gill|ikky|mxrci|guru randhawa|honey singh|chani nattan|inderpal moga|harrdy sandhu|amrinder gill|arjan vailly|bhupinder babbal|sultaan|tauba tauba|lalkara|daku|jatt|munde|kudi|sohna|hauli hauli)\b/i.test(rawScriptBlob + " " + blob)) {
      cluster = "desi";
      genre = "punjabi";
      langCulture = "south_asian";
      subCulture = "punjabi";
    } else if (/\b(desi hip hop|indian rap|desi_hiphop|seedhe maut|kr\$na|krsna|divine|hanumankind|kalmi|raftaar|mc stan|emiway|yashraj|mc altaf|prabh deep|namastute|luka chuppi|prarthana|joota japani|baazigar)\b/i.test(rawScriptBlob + " " + blob)) {
      cluster = "desi";
      genre = "desi_hiphop";
      langCulture = "south_asian";
      subCulture = "desi_hiphop";
    } else if (/[\u0B80-\u0BFF\u0C00-\u0C7F\u0D00-\u0D7F\u0C80-\u0CFF]|\b(tamil|telugu|malayalam|kannada|south_indian|anirudh|sai abhyankkar|sushin shyam|dabzee|sid sriram|yuvan shankar|devi sri prasad|thaman|katchi sera|aasa kooda|aavesham|illuminati|sanju rathod|gulabi sadi)\b/i.test(rawScriptBlob + " " + blob)) {
      cluster = "desi";
      genre = "south_indian";
      langCulture = "south_asian";
      subCulture = "south_indian";
    } else if (/\b(indie_in|indian indie|anuv jain|prateek kuhad|aditya rikhari|local train|mitraz|ritviz|nucleya|akshath|faheem abdullah|rauhan malik|zaeden|lifafa|when chai met toast|husn|jo tum mere ho|alag aasmaan|baarishein|kasoor|choo lo|aaoge tum kabhi|samjho na|faasle|nadaaniyan|udd gaye|liggi)\b/i.test(blob)) {
      cluster = "desi";
      genre = "indie_in";
      langCulture = "south_asian";
      subCulture = "indian_indie";
    } else if (/\b(pak_pop|pakistani|coke studio|atif aslam|abdul hannan|hasan raheem|kaavish|talwiinder|aur\b|young stunners|talha anjum|ali sethi|pasoori|tu hai kahan|shikayat|khayaal|dhundhala)\b/i.test(blob)) {
      cluster = "desi";
      genre = "pak_pop";
      langCulture = "south_asian";
      subCulture = "pakistani";
    } else if (/[\u0900-\u097F\u0980-\u09FF]|\b(bollywood|hindi|desi|arijit|pritam|shreya ghoshal|jubin|vishal mishra|sachin[\s-]*jigar|kk\b|mohit chauhan|amit trivedi|a\.?\s*r\.?\s*rahman|darshan raval|badshah|sonu nigam|armaan malik|jasleen royal|shilpa rao|neeti mohan|sagar bhatia|varun jain|madhubanti|divya kumar|pawan singh|king\b|b praak|tanishk|sachet|aaj ki raat|sajni|pehle bhi main|maan meri jaan|tu aake dekhle|sarkaare|chaleya|soulmate|taras|khudaya|soni soni|khoobsurat|tumhare hi rahenge|aayi nai|khel khel mein|heeriye|satranga|apna bana le|kesariya|raataan lambiyan|tum hi ho|channa mereya|kabira|shayad|stree 2|laapataa|bhediya|jawan)\b/i.test(rawScriptBlob + " " + blob)) {
      cluster = "desi";
      genre = "bollywood";
      langCulture = "south_asian";
      subCulture = "hindi_bollywood";
    } else if (/[\uAC00-\uD7AF]|\b(k-?pop|korean|bts|blackpink|newjeans|stray kids|twice|aespa|seventeen|jung\s*kook|le sserafim|ive\b|illit|ateez|enhypen|jennie|lisa\b|ros[eé]\b|babymonster|kiss of life|whiplash|chk chk boom)\b/i.test(rawScriptBlob + " " + blob)) {
      cluster = "kpop";
      genre = "k-pop";
      langCulture = "korean";
      subCulture = "kpop";
    } else if (/[\u3040-\u30FF]|\b(j-?pop|japanese|yoasobi|fujii kaze|kenshi yonezu|vaundy|ado\b|king gnu|creepy nuts|mrs\.?\s*green apple|official hige|bling[\s-]*bang|otonoke)\b/i.test(rawScriptBlob + " " + blob)) {
      cluster = "kpop";
      genre = "j-pop";
      langCulture = "japanese";
      subCulture = "jpop";
    } else if (/\b(afrobeats|amapiano|burna boy|wizkid|rema|tems|ayra starr|davido|asake|tyla|omah lay|titom|yuppe|tshwala bam|ozaka)\b/i.test(blob)) {
      cluster = "afro";
      genre = "afrobeats";
      langCulture = "afro";
      subCulture = "afro";
    } else if (/\b(reggaeton|latin|urbano|bad bunny|karol g|feid|peso pluma|rauw alejandro|j balvin|ozuna|maluma|shakira|rosalia|romeo santos|dtmf|baile inolvidable)\b/i.test(blob)) {
      cluster = "latin";
      genre = "latin";
      langCulture = "latin";
      subCulture = "latin";
    } else if (/\b(opm|pinoy|hugot|bini\b|maki\b|ben&ben|zack tabudlo|arthur nery|cup of joe|tj monterde|pantropiko|salamin|dilaw|palagi)\b/i.test(blob)) {
      cluster = "pop";
      genre = "opm_pop";
      langCulture = "opm";
      subCulture = "opm";
    } else if (/\b(hip[\s-]?hop|rap|trap|drill|drake|kendrick|travis scott|kanye|eminem|future|metro boomin|21 savage|j\.?\s*cole|playboi carti|central cee|nicki minaj|cardi b|lil |gunna|don toliver|asap rocky|tyler, the creator|doechii|glorilla|ice spice)\b/i.test(blob)) {
      cluster = "hiphop";
      genre = /\b(drill)\b/i.test(blob) ? "drill" : /\b(trap)\b/i.test(blob) ? "trap" : "hip-hop";
      langCulture = "western";
      subCulture = "english_hiphop";
    } else if (/\b(r&b|rnb|soul|neo[\s-]?soul|sza|the weeknd|frank ocean|daniel caesar|brent faiyaz|usher|chris brown|alicia keys|kehlani|summer walker|h\.e\.r\.|giveon|bryson tiller|khalid|leon thomas|jordan adetunji|ravyn lenae|teddy swims)\b/i.test(blob)) {
      cluster = "rnb";
      genre = "r&b";
      langCulture = "western";
      subCulture = "english_rnb";
    } else if (/\b(edm|electronic|house|techno|trance|dubstep|dnb|drum and bass|phonk|synthwave|calvin harris|david guetta|tiesto|martin garrix|avicii|marshmello|skrillex|fred again|kygo|zedd|alesso|daft punk|odesza|flume|alan walker|chainsmokers|disclosure|peggy gou|charli xcx|john summit|sonny fodera|bl3ss)\b/i.test(blob)) {
      cluster = "electronic";
      genre = /\b(phonk)\b/i.test(blob) ? "phonk" : /\b(house)\b/i.test(blob) ? "house" : "electronic";
      langCulture = "western";
      subCulture = "english_electronic";
    } else if (/\b(rock|metal|punk|grunge|alternative|nirvana|linkin park|queen|ac\/dc|metallica|arctic monkeys|green day|foo fighters|red hot chili peppers|oasis|coldplay|imagine dragons|radiohead|the killers|muse|blink-182|paramore|bring me the horizon|slipknot|deftones|strokes|fleetwood mac|fontaines|sam fender|last dinner party|sleep token|bad omens)\b/i.test(blob)) {
      cluster = "rock";
      genre = /\b(metal|slipknot|metallica|deftones|sleep token|bad omens)\b/i.test(blob) ? "metal" : /\b(indie|arctic monkeys|strokes|fontaines|sam fender)\b/i.test(blob) ? "indie rock" : "rock";
      langCulture = "western";
      subCulture = "english_rock";
    } else if (/\b(indie|bedroom pop|dream pop|shoegaze|tame impala|lana del rey|mitski|clairo|beabadoobee|cigars? after sex|phoebe bridgers|hozier|bon iver|mac demarco|wallows|men i trust|laufey|conan gray|girl in red|boygenius|the 1975|glass animals|vampire weekend|gigi perez|lola young|sombr|role model|malcolm todd|mk\.?gee|artemas|myles smith)\b/i.test(blob)) {
      cluster = "indie";
      genre = "indie pop";
      langCulture = "western";
      subCulture = "english_indie";
    } else if (/\b(country|americana|folk|morgan wallen|luke combs|zach bryan|chris stapleton|kacey musgraves|dolly parton|johnny cash|shania twain|noah kahan|shaboozey|jelly roll|dasha|tucker wetmore|megan moroney|lainey wilson|zach top|koe wetzel)\b/i.test(blob)) {
      cluster = "country";
      genre = "country";
      langCulture = "western";
      subCulture = "english_country";
    } else if (/\b(lo[\s-]?fi|lofi|chillhop|ambient|study|sleep|meditation|piano|classical|jazz|instrumental|rain)\b/i.test(blob)) {
      cluster = "chill";
      genre = "lo-fi";
      langCulture = "western";
      subCulture = "english_chill";
    } else {
      cluster = "pop";
      genre = rawGenre && rawGenre !== "music" ? rawGenre : "pop";
      langCulture = "western";
      subCulture = "english_pop";
    }

    const isCrossCulturalBridge = Boolean(
      /\b(hanumankind|big dawgs|sia\b|hass hass|armani white|stylo g|bruno mars|apt\.|doja cat|raye|dominic fike|doechii|travis scott|anitta)\b/i.test(rawScriptBlob)
    );

    let mood = "upbeat";
    let tempo = "mid";
    if (/\b(sad|heartbreak|cry|tears|lonely|broken|hurt|miss you|goodbye|alone|melanchol|grief|blue|channa mereya|alag aasmaan)\b/i.test(blob)) {
      mood = "melancholic";
      tempo = "slow";
    } else if (/\b(chill|lofi|lo-fi|relax|calm|peace|dream|soft|sunday|coffee|sunset|late night|midnight|sleep|ambient|acoustic|baarishein|husn|kasoor)\b/i.test(blob) || cluster === "chill") {
      mood = "chill";
      tempo = "slow";
    } else if (/\b(love|romantic|romance|kiss|heart|baby|darling|forever|yours|valentine|slow dance|sajni|kesariya|tum hi ho|apna bana le|pehle bhi main|satranga|heeriye|ishq)\b/i.test(blob)) {
      mood = "romantic";
      tempo = "slow";
    } else if (/\b(gym|workout|hype|beast|phonk|rage|hard|pump|power|energy|banger|turnt|club|party|dance|festival|rave|fast|aaj ki raat|tauba tauba|illuminati|big dawgs)\b/i.test(blob) || genre === "phonk" || genre === "drill") {
      mood = "hype";
      tempo = "fast";
    } else if (/\b(dark|night|shadow|afterhours|after hours|toxic|sin|devil|villain|obsess)\b/i.test(blob)) {
      mood = "dark";
      tempo = "mid";
    } else if (/\b(focus|study|coding|work|instrumental|deep)\b/i.test(blob)) {
      mood = "focus";
      tempo = "slow";
    } else if (cluster === "electronic" || cluster === "kpop" || cluster === "latin" || cluster === "afro" || subCulture === "punjabi") {
      mood = "upbeat";
      tempo = "fast";
    } else if (cluster === "indie" || cluster === "rnb" || subCulture === "indian_indie" || subCulture === "pakistani") {
      mood = "chill";
      tempo = "mid";
    }

    let style = "modern";
    if (/\b(acoustic|unplugged|stripped|piano|guitar|singer[\s-]?songwriter|folk)\b/i.test(blob) || subCulture === "indian_indie") {
      style = "acoustic";
      if (tempo === "fast") tempo = "mid";
    } else if (/\b(remix|club|synth|electronic|edm|house|techno|bass|phonk|beat)\b/i.test(blob) || cluster === "electronic") {
      style = "electronic";
    } else if (/\b(live|concert|session|mtv unplugged)\b/i.test(blob)) {
      style = "live";
    } else if (/\b(80s|90s|70s|retro|classic|throwback|oldies|vintage|disco)\b/i.test(blob)) {
      style = "retro";
    } else if (/\b(soundtrack|ost|score|cinematic|orchestra|theme)\b/i.test(blob)) {
      style = "cinematic";
    }

    const peerArtists = (primArt && CLIENT_ARTIST_PEERS[primArt]) ? CLIENT_ARTIST_PEERS[primArt].slice() : [];

    return { genre, cluster, mood, tempo, style, langCulture, subCulture, isCrossCulturalBridge, peerArtists };
  }

  function areClustersCompatibleClient(c1, c2) {
    if (!c1 || !c2) return false;
    if (c1 === c2) return true;
    const compat = {
      pop: ["rnb", "indie", "electronic", "country"],
      hiphop: ["rnb", "electronic"],
      rnb: ["hiphop", "pop", "chill", "indie"],
      electronic: ["pop", "hiphop"],
      rock: ["indie", "pop", "country"],
      indie: ["rock", "pop", "chill", "rnb", "country"],
      latin: ["pop", "afro", "hiphop", "electronic"],
      afro: ["rnb", "hiphop", "latin", "pop"],
      kpop: ["pop", "electronic", "rnb"],
      desi: ["desi"],
      chill: ["indie", "rnb", "pop", "country"],
      country: ["indie", "rock", "pop", "chill"],
    };
    return (compat[c1] || []).includes(c2);
  }

  function areMoodsCompatibleClient(m1, m2) {
    if (!m1 || !m2) return false;
    if (m1 === m2) return true;
    const adj = {
      chill: ["romantic", "melancholic", "focus", "dark"],
      melancholic: ["chill", "romantic", "dark"],
      romantic: ["chill", "melancholic", "upbeat"],
      upbeat: ["hype", "romantic", "chill"],
      hype: ["upbeat", "dark"],
      dark: ["hype", "melancholic", "chill", "upbeat"],
      focus: ["chill", "melancholic"],
    };
    return (adj[m1] || []).includes(m2);
  }

  function areTemposSmoothClient(t1, t2) {
    if (!t1 || !t2 || t1 === t2) return 2;
    if (t1 === "mid" || t2 === "mid") return 1;
    return 0;
  }

  // Sequences candidate songs like a human-made Spotify playlist:
  // 1) Phase 1 (first ~35%): close similarity (same language/subCulture, vibe, genre, mood, tempo, style, related/peer artists)
  // 2) Phase 2 (middle ~40%): core vibe & style continuation across varied artists in the same language/culture
  // 3) Phase 3 (final ~25%): gradual exploration into compatible genres/moods within compatible culture
  // Strictly prevents duplicate songs, recently played repeats, cross-language jarring jumps, and back-to-back same artist.
  function scoreAndSequenceSpotifyStyle(seedTrack, candidates, opts = {}) {
    const max = opts.max || 20;
    const maxPerArtist = opts.maxPerArtist || 2;
    const seedVibe = seedTrack ? inferTrackVibeClient(seedTrack) : (opts.vibe || { genre: "pop", cluster: "pop", mood: "upbeat", tempo: "mid", style: "modern", langCulture: "western", subCulture: "english_pop", peerArtists: [] });
    const seedArtist = seedTrack ? canonicalPrimaryArtistClient(seedTrack) : "";
    const seedKey = seedTrack ? canonicalSongKey(seedTrack) : "";
    const countryCode = String((state.prefs && state.prefs.country) || "US").toUpperCase();
    const prefGenres = Array.isArray(state.prefs && state.prefs.tasteGenres) ? state.prefs.tasteGenres : [];
    const allowIndian =
      countryCode === "IN" || countryCode === "PK" || countryCode === "BD" ||
      seedVibe.cluster === "desi" || seedVibe.langCulture === "south_asian" ||
      prefGenres.some((g) => /bollywood|punjabi|tamil|telugu|indie_in/i.test(g));

    const taste = tasteProfile();
    const favArtistSet = new Set([
      ...(taste.artists || []).map((x) => canonicalPrimaryArtistClient(Array.isArray(x) ? x[0] : x)),
      ...((state.following || []).map((f) => canonicalPrimaryArtistClient(f && f.name))),
    ].filter(Boolean));
    const relatedArtistSet = new Set(
      [
        ...(Array.isArray(opts.relatedArtists) ? opts.relatedArtists : []),
        ...((seedTrack && Array.isArray(seedTrack._relatedArtists)) ? seedTrack._relatedArtists : []),
        ...(Array.isArray(seedVibe.peerArtists) ? seedVibe.peerArtists : []),
      ].map((a) => canonicalPrimaryArtistClient(a)).filter(Boolean)
    );

    const excludeKeys = new Set();
    const excludeIds = new Set();
    if (seedKey) excludeKeys.add(seedKey);
    if (seedTrack && seedTrack.id) excludeIds.add(String(seedTrack.id));
    if (seedTrack && seedTrack.videoId) excludeIds.add(String(seedTrack.videoId));
    for (const ex of (opts.excludeTracks || [])) {
      if (!ex) continue;
      const k = canonicalSongKey(ex);
      if (k) excludeKeys.add(k);
      if (ex.id) excludeIds.add(String(ex.id));
      if (ex.videoId) excludeIds.add(String(ex.videoId));
    }

    const recentPlayKeys = new Set(_sessionPlayedKeys.slice(0, 25));
    const recentAutoKeys = new Set(_sessionAutoQueuedKeys.slice(0, 35));

    const seenKeys = new Set();
    const seenIds = new Set();
    const scored = [];

    for (let i = 0; i < (candidates || []).length; i++) {
      const t = candidates[i];
      if (!t || !t.title || !looksLikeSong(t)) continue;
      if (!allowIndian && isUnwantedIndianTrackClient(t, countryCode)) continue;
      if (seedTrack && isSameSongClient(t, seedTrack)) continue;

      const key = canonicalSongKey(t);
      const idStr = String(t.id || "");
      const vidStr = String(t.videoId || "");
      if (!key) continue;
      if (excludeKeys.has(key) || (idStr && excludeIds.has(idStr)) || (vidStr && excludeIds.has(vidStr))) continue;
      if (seenKeys.has(key) || (idStr && seenIds.has(idStr)) || (vidStr && seenIds.has(vidStr))) continue;
      seenKeys.add(key);
      if (idStr) seenIds.add(idStr);
      if (vidStr) seenIds.add(vidStr);

      if (typeof healTrackCoverClient === "function") healTrackCoverClient(t);

      const artistNorm = canonicalPrimaryArtistClient(t);
      const tv = inferTrackVibeClient(t);
      let score = 0;
      let tier = 2;

      const isSameArtist = Boolean(seedArtist && artistNorm && (artistNorm === seedArtist || artistNorm.includes(seedArtist) || seedArtist.includes(artistNorm)));
      const isRelArtist = Boolean(!isSameArtist && artistNorm && relatedArtistSet.has(artistNorm));
      const isFavArtist = Boolean(artistNorm && favArtistSet.has(artistNorm));
      const isSameLang = (tv.langCulture || "western") === (seedVibe.langCulture || "western");
      const isSameSubCulture = Boolean(seedVibe.subCulture && tv.subCulture === seedVibe.subCulture);

      // Language & musical culture alignment (critical for avoiding jarring cross-language jumps)
      if (isSameSubCulture) {
        score += 38;
      } else if (isSameLang) {
        score += 24;
      } else if ((seedVibe.langCulture || "western") !== "western") {
        if (seedVibe.isCrossCulturalBridge && (tv.genre === seedVibe.genre || tv.cluster === seedVibe.cluster)) {
          score -= 8;
        } else {
          score -= 85;
        }
      } else {
        score -= 48;
      }

      if (isRelArtist) {
        score += 36;
        tier = 1;
      } else if (isSameArtist) {
        score += 32;
        tier = 1;
      } else if (isFavArtist && isSameLang) {
        score += 14;
      }

      if (tv.genre === seedVibe.genre && isSameLang) {
        score += 28;
        if (tier > 1 && (isRelArtist || isSameSubCulture || tv.mood === seedVibe.mood)) tier = 1;
      } else if (tv.cluster === seedVibe.cluster && isSameLang) {
        score += 22;
        if (tier > 2) tier = 2;
      } else if (isSameLang && areClustersCompatibleClient(seedVibe.cluster, tv.cluster)) {
        score += 12;
        tier = 3;
      } else {
        score -= 16;
        tier = 3;
      }

      if (tv.mood === seedVibe.mood) score += 16;
      else if (areMoodsCompatibleClient(seedVibe.mood, tv.mood)) score += 9;
      else score -= 5;

      const tempoFit = areTemposSmoothClient(seedVibe.tempo, tv.tempo);
      if (tempoFit === 2) score += 12;
      else if (tempoFit === 1) score += 6;
      else score -= 6;

      if (tv.style === seedVibe.style) score += 10;

      if (recentPlayKeys.has(key)) score -= 45;
      else if (recentAutoKeys.has(key)) score -= 22;

      score += Math.max(0, 10 - Math.floor(i / 5));

      scored.push({
        track: t,
        key,
        artistNorm: artistNorm || `unknown_${i}`,
        isSameArtist,
        isRelArtist,
        isSameLang,
        isSameSubCulture,
        vibe: tv,
        tier,
        score,
      });
    }

    // If we have enough same-language/culture tracks (>= 5), filter out jarring cross-language tracks
    const sameLangList = scored.filter((c) => c.isSameLang || (seedVibe.isCrossCulturalBridge && c.score >= 25));
    const activePool = sameLangList.length >= 5 ? sameLangList : scored;
    activePool.sort((a, b) => b.score - a.score);

    const sequenced = [];
    const artistCounts = new Map();
    const artistLastSlot = new Map();
    if (seedArtist) {
      artistCounts.set(seedArtist, 1);
      artistLastSlot.set(seedArtist, -1);
    }

    const remaining = activePool.slice();
    let prevVibe = seedVibe;
    let prevArtist = seedArtist;

    while (sequenced.length < max && remaining.length > 0) {
      const slot = sequenced.length;
      const progress = max > 1 ? slot / (max - 1) : 0;
      const targetTier = progress < 0.35 ? 1 : progress < 0.75 ? 2 : 3;

      let bestIdx = -1;
      let bestSlotScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const aCount = artistCounts.get(cand.artistNorm) || 0;
        const capForArtist = (seedArtist && cand.artistNorm === seedArtist) ? Math.min(2, maxPerArtist) : maxPerArtist;
        if (aCount >= capForArtist && remaining.length > 4) continue;
        if (cand.artistNorm && cand.artistNorm === prevArtist) continue;
        const lastIdx = artistLastSlot.get(cand.artistNorm);
        if (lastIdx !== undefined && slot - lastIdx < 3) continue;

        let slotScore = cand.score;
        const tierDiff = Math.abs(cand.tier - targetTier);
        if (tierDiff === 0) slotScore += 18;
        else if (tierDiff === 1) slotScore += 6;
        else slotScore -= 8;

        // Immediately after the seed song (slot 0), prefer a similar peer artist in the same subCulture
        // rather than repeating the seed artist right away; bring the seed artist back around slot 2-4
        if (cand.isSameArtist) {
          if (slot === 0) slotScore -= 28;
          else if (slot >= 2 && slot <= 4 && aCount <= 1) slotScore += 16;
        } else if (cand.isRelArtist && slot <= 3) {
          slotScore += 14;
        }

        const tFit = areTemposSmoothClient(prevVibe.tempo, cand.vibe.tempo);
        if (tFit === 2) slotScore += 10;
        else if (tFit === 1) slotScore += 5;
        else slotScore -= 8;

        if (cand.vibe.mood === prevVibe.mood) slotScore += 8;
        else if (areMoodsCompatibleClient(prevVibe.mood, cand.vibe.mood)) slotScore += 4;

        if (aCount === 0) slotScore += 9;

        if (slotScore > bestSlotScore) {
          bestSlotScore = slotScore;
          bestIdx = i;
        }
      }

      if (bestIdx < 0) {
        bestIdx = remaining.findIndex(
          (c) => c.artistNorm !== prevArtist && (artistCounts.get(c.artistNorm) || 0) < maxPerArtist + 1
        );
      }
      if (bestIdx < 0) {
        bestIdx = remaining.findIndex((c) => c.artistNorm !== prevArtist);
      }
      if (bestIdx < 0) bestIdx = 0;

      const [picked] = remaining.splice(bestIdx, 1);
      sequenced.push(picked.track);
      artistCounts.set(picked.artistNorm, (artistCounts.get(picked.artistNorm) || 0) + 1);
      artistLastSlot.set(picked.artistNorm, slot);
      prevArtist = picked.artistNorm;
      prevVibe = picked.vibe;
    }

    return sequenced;
  }

  function localRelatedTracks(t, max = 24) {
    const seedVibe = t ? inferTrackVibeClient(t) : null;
    const pool = [].concat(
      homeTrackPool(),
      (state.discovery && state.discovery.tracks) || [],
      state.tasteTracks || [],
      state.followedArtistTracks || [],
      state.liked || [],
      state.recents || []
    );
    const valid = pool.filter(
      (cand) => cand && cand.id && cand.title && cand.source !== "radio" && looksLikeSong(cand) && (!t || !isSameSongClient(cand, t))
    );
    if (!seedVibe) return valid.slice(0, max * 4);
    const sameCulture = [];
    const other = [];
    for (const cand of valid) {
      const cv = inferTrackVibeClient(cand);
      if (cv.langCulture === seedVibe.langCulture) {
        if (cv.subCulture === seedVibe.subCulture) sameCulture.unshift(cand);
        else sameCulture.push(cand);
      } else {
        other.push(cand);
      }
    }
    return (sameCulture.length >= 6 ? sameCulture : sameCulture.concat(other)).slice(0, max * 4);
  }

  async function fetchRelated(seed, extraSkip) {
    if (!seed || seed.source === "radio") return [];
    const artist = artistName(seed);
    const title = seed.title || "";
    const vibe = inferTrackVibeClient(seed);
    const taste = tasteProfile();
    const skipParts = [
      relatedSkip(seed),
      canonicalSongKey(seed),
      extraSkip || "",
      ..._sessionPlayedKeys.slice(0, 20),
      ..._sessionAutoQueuedKeys.slice(0, 20),
    ].filter(Boolean);
    const skip = [...new Set(skipParts)].slice(0, 35).join(",");
    const recentArtists = [
      artist,
      ...((state.recents || []).slice(0, 6).map((r) => artistName(r))),
      ...((state.queue || []).slice(0, 6).map((q) => artistName(q))),
    ].filter(Boolean).slice(0, 10).join(",");
    const qs = new URLSearchParams({
      title,
      artist,
      genre: seed.genre || vibe.genre || "",
      mood: vibe.mood || "",
      tempo: vibe.tempo || "",
      style: vibe.style || "",
      langCulture: vibe.langCulture || "",
      subCulture: vibe.subCulture || "",
      duration: String(Number(seed.duration) || 0),
      recentArtists,
      artists: taste.artists.slice(0, 4).map((x) => x[0]).join(","),
      genres: taste.genres.slice(0, 3).map((x) => x[0]).join(","),
      skip,
    });
    const data = await api(`/api/related?${qs}&${glq()}`, 14000);
    if (data && data.vibe && Array.isArray(data.vibe.relatedArtists) && data.vibe.relatedArtists.length) {
      seed._relatedArtists = data.vibe.relatedArtists;
    }
    return (data && data.tracks) || [];
  }

  // Supplements related candidates with peer/related artists in the same language & musical culture
  // and sequences them through the Spotify-style similarity -> gradual exploration engine.
  const _inFlightSmartRelated = new Map();
  async function gatherSmartRelatedCandidates(seed, excludeTracks = [], max = 18) {
    if (!seed || seed.source === "radio") return [];
    const inflightKey = String(canonicalSongKey(seed) || seed.id || seed.title || "");
    if (inflightKey && _inFlightSmartRelated.has(inflightKey)) {
      const shared = await _inFlightSmartRelated.get(inflightKey);
      return Array.isArray(shared) ? shared.slice(0, max) : [];
    }
    const targetMax = Math.max(max, 18);
    const task = (async () => {
    const vibe = inferTrackVibeClient(seed);
    const searchGl =
      vibe.langCulture === "south_asian" ? "IN" :
      vibe.langCulture === "korean" ? "KR" :
      vibe.langCulture === "japanese" ? "JP" :
      vibe.langCulture === "opm" ? "PH" :
      String((state.prefs && state.prefs.country) || "US").toUpperCase();

    const skipKeys = [];
    for (const ex of excludeTracks) {
      if (!ex) continue;
      const k = canonicalSongKey(ex);
      if (k) skipKeys.push(k);
      if (ex.id) skipKeys.push(String(ex.id));
    }
    let raw = await fetchRelated(seed, skipKeys.slice(0, 25).join(",")).catch(() => []);
    const relatedArtists = [
      ...new Set([
        ...(Array.isArray(seed._relatedArtists) ? seed._relatedArtists : []),
        ...(Array.isArray(vibe.peerArtists) ? vibe.peerArtists : []),
      ]),
    ];
    const art = artistName(seed);

    if (raw.length < 10 && art && !/^(various artists|unknown)$/i.test(art)) {
      try {
        const artData = await api(`/api/artist?q=${encodeURIComponent(art)}&gl=${encodeURIComponent(searchGl)}`, 8000).catch(() => null);
        const artTracks = (artData && (artData.tracks || artData.topTracks || artData.songs)) || [];
        raw = raw.concat(artTracks.slice(0, 10));
      } catch {}
    }

    if (raw.length < 12) {
      const peerTerms = [
        relatedArtists[0] || "",
        relatedArtists[1] || "",
        art || seed.title || "",
      ].filter((q) => q && !/^(various artists|unknown)$/i.test(q));
      const uniqueTerms = [...new Set(peerTerms)].slice(0, 2);
      for (const searchQ of uniqueTerms) {
        try {
          const itRes = await itFetch(`/search?term=${encodeURIComponent(searchQ)}&media=music&entity=song&limit=20&country=${encodeURIComponent(searchGl)}`).catch(() => null);
          const itList = (itRes && itRes.results) || [];
          raw = raw.concat(itList);
        } catch {}
        if (raw.length < 12) {
          try {
            const dzRes = await dzFetch(`/search?q=${encodeURIComponent(searchQ)}&limit=20`).catch(() => null);
            const dzList = (dzRes && (dzRes.data || dzRes.results)) || [];
            for (const t of dzList) {
              const s = normalizeClientDeezerTrack(t);
              if (s) raw.push(s);
            }
          } catch {}
        }
      }
    }

    if (raw.length < 14) {
      raw = raw.concat(localRelatedTracks(seed, 30));
    }

    if (raw.length < 10 && vibe.langCulture === "western") {
      try {
        const disc = await api(`/api/shelf?id=discovery&${glq()}`, 6000).catch(() => null);
        const discTracks = (disc && disc.tracks) || [];
        raw = raw.concat(discTracks);
      } catch {}
    }

    return scoreAndSequenceSpotifyStyle(seed, raw, {
      max,
      maxPerArtist: 2,
      relatedArtists,
      excludeTracks,
    });
    })();
    _inFlightSmartRelated.set(inflightKey, task);
    try {
      return await task;
    } finally {
      _inFlightSmartRelated.delete(inflightKey);
    }
  }

  let isQueueRecsLoading = false;
  async function loadQueueRecs(force = false) {
    const isSeedTrack = force && typeof force === "object" && force.title;
    const forceRefresh = force === true;
    const cur = (isSeedTrack ? force : null) || current() || (state.recents && state.recents[0]) || (state.queue && state.queue[0]) || (state.liked && state.liked[0]);
    if (!cur || cur.source === "radio") {
      if (!cur) {
        state.queueRecs = [];
        renderQueue();
      }
      return;
    }
    const seedKey = canonicalSongKey(cur);
    if (!forceRefresh && state._queueRecsSeed === seedKey && Array.isArray(state.queueRecs) && state.queueRecs.length >= 4) {
      return;
    }
    if (isQueueRecsLoading) return;
    isQueueRecsLoading = true;
    const refBtn = $("refreshQueueRecs");
    if (refBtn) refBtn.classList.add("rotating");
    renderQueue();
    try {
      const excludeTracks = [
        ...(state.queue || []),
        ...(state.recents || []).slice(0, 12),
      ];
      if (forceRefresh && Array.isArray(state.queueRecs)) {
        excludeTracks.push(...state.queueRecs);
      }
      const sequenced = await gatherSmartRelatedCandidates(cur, excludeTracks, 15);
      state.queueRecs = sequenced.filter((t) => !isSameSongClient(t, cur) && !(state.queue || []).some((q) => isSameSongClient(q, t)));
      state._queueRecsSeed = seedKey;
    } catch (err) {
      console.warn("loadQueueRecs failed:", err);
    } finally {
      isQueueRecsLoading = false;
      const refBtn = $("refreshQueueRecs");
      if (refBtn) refBtn.classList.remove("rotating");
      renderQueue();
    }
  }

  let isRefillingQueue = false;
  async function ensureQueueRefill(seed) {
    if (isRefillingQueue) return false;
    const targetSeed = seed || current() || (state.queue && state.queue[state.queue.length - 1]) || (state.recents && state.recents[0]);
    if (!targetSeed || targetSeed.source === "radio") return false;
    isRefillingQueue = true;
    try {
      const targetKey = canonicalSongKey(targetSeed);
      const targetVibe = inferTrackVibeClient(targetSeed);
      // 1. If we already have fresh Spotify-style recommendations matching the current seed or exact subCulture,
      // filter out any song already in the queue or identical to the current song, and append!
      if (Array.isArray(state.queueRecs) && state.queueRecs.length >= 4) {
        const recsMatchSeed = state._queueRecsSeed === targetKey;
        const validRecs = state.queueRecs.filter((r) => {
          if (!r || isSameSongClient(r, targetSeed) || (state.queue || []).some((q) => isSameSongClient(q, r))) return false;
          if (recsMatchSeed) return true;
          const rv = inferTrackVibeClient(r);
          return rv.langCulture === targetVibe.langCulture && rv.subCulture === targetVibe.subCulture;
        });
        if (validRecs.length >= 4) {
          const toAdd = validRecs.slice(0, 10);
          for (const f of toAdd) recordSessionAutoQueued(f);
          state.queueRecs = state.queueRecs.filter((r) => !toAdd.some((a) => isSameSongClient(a, r)));
          state.queue = state.queue.concat(toAdd);
          renderQueue();
          renderChrome();
          if (state.queueRecs.length < 4) loadQueueRecs(true);
          return true;
        }
      }

      const excludeTracks = [
        ...(state.queue || []),
        ...(state.recents || []).slice(0, 15),
      ];
      let extra = await gatherSmartRelatedCandidates(targetSeed, excludeTracks, 16);

      // If target seed is Audius and extra is sparse, also blend Audius tracks
      if (extra.length < 6 && targetSeed.source === "audius") {
        try {
          const gData = await api(`/api/home?${glq()}`, 4000);
          const audList = (gData && gData.audius) || [];
          extra = scoreAndSequenceSpotifyStyle(targetSeed, [...extra, ...audList], {
            max: 16,
            excludeTracks,
          });
        } catch {}
      }

      extra = extra.filter((t) => t && !isSameSongClient(t, targetSeed) && !(state.queue || []).some((q) => isSameSongClient(q, t)));
      if (!extra.length) return false;
      for (const f of extra) recordSessionAutoQueued(f);
      state.queue = state.queue.concat(extra);
      renderQueue();
      renderChrome();
      return true;
    } catch {
      return false;
    } finally {
      isRefillingQueue = false;
    }
  }

  async function fillRelatedQueue(seed) {
    return ensureQueueRefill(seed);
  }

  async function loadPlaylistRecs(plIndex) {
    const p = state.playlists[plIndex];
    if (!p || !p.tracks || !p.tracks.length) {
      plRecs = { key: "", tracks: [], loading: false };
      return;
    }
    const key = `${plIndex}:${p.tracks.map((t) => t.id).slice(0, 10).join("|")}`;
    if (plRecs.key === key) return;
    plRecs = { key, tracks: [], loading: true };
    const ts = p.tracks;
    const seeds = [ts[ts.length - 1]];
    if (ts[0] && !isSameSongClient(ts[0], seeds[0])) seeds.push(ts[0]);
    if (ts.length > 2) {
      const mid = ts[Math.floor(ts.length / 2)];
      if (mid && !seeds.some((s) => isSameSongClient(s, mid))) seeds.push(mid);
    }
    let raw = [];
    for (const seed of seeds.slice(0, 3)) {
      try {
        const rows = await fetchRelated(seed, ts.map((t) => canonicalSongKey(t)).filter(Boolean).slice(0, 25).join(","));
        raw = raw.concat(rows || []);
      } catch {}
    }
    const out = scoreAndSequenceSpotifyStyle(seeds[0], raw, {
      max: 10,
      maxPerArtist: 2,
      excludeTracks: ts,
    });
    if (plRecs.key !== key) return;
    plRecs = { key, tracks: out, loading: false };
    if (state.view === "library" && state.activePlaylist === plIndex) render();
  }

  let failSkip = 0;
  let failSkipAt = 0;
  let playGen = 0;
  function skipFailed(msg) {
    _pendingSeek = 0;
    ytSeekReset = 0;
    _pendingSeekApplied = true;
    _resumeTrackId = null;
    const now = Date.now();
    if (now - failSkipAt > 15000) failSkip = 0;
    failSkipAt = now;
    failSkip += 1;
    if (failSkip === 1) toast(msg || "Could not play this track", true, "error");
    if (failSkip >= 2) {
      toast("Playback stopped. Tap any song to play.");
      state.playing = false;
      renderChrome();
      return;
    }
    setTimeout(() => next(true), 600);
  }

  // In-memory resolution cache: playQuery -> {videoId, candidates, artwork, duration, streamUrl}.
  const ytResolveCache = new Map();
  const YT_RESOLVE_CACHE_MAX = 500;

  // Persistent Native App Audio Cache: stores resolved song data & lyrics in-app so
  // replaying a song in the Native App plays in 0ms from app cache with zero backend load.
  const NATIVE_AUDIO_CACHE_KEY = "aura.nativeAudioCache.v1";
  const NATIVE_AUDIO_CACHE_MAX = 300;
  const nativeAppAudioCache = new Map();
  function isOneMinuteCappedStreamUrl(u) {
    const s = String(u || "");
    if (!s) return false;
    let decoded = s;
    try { decoded = decodeURIComponent(s); } catch {}
    const combined = s + " " + decoded;
    if (!combined.includes("googlevideo.com")) return false;
    if (/[?&]c=(?:IOS|ANDROID)(?:&|$|%26)/i.test(combined)) return true;
    return false;
  }
  function isUnwantedRemixStreamUrl(u, source = "") {
    const s = String(u || "").toLowerCase();
    if (!s || source === "audius") return false;
    let decoded = s;
    try { decoded = decodeURIComponent(s).toLowerCase(); } catch {}
    const combined = s + " " + decoded;
    return combined.includes("sndcdn.com") || combined.includes("audius.co") || combined.includes("open-audio-validator");
  }
  function isUnwantedRemixCandidateTitle(gotTitle, wantTitle) {
    const want = String(wantTitle || "").toLowerCase();
    const got = String(gotTitle || "").toLowerCase();
    if (!got) return false;
    const wantIsRemix = /\b(remix|re-mix|bootleg|flip|mashup|cover|sped\s*up|slowed|reverb|nightcore|8d|edit|remake|karaoke|instrumental|live)\b/i.test(want);
    if (wantIsRemix) return false;
    return /\b(remix|re-mix|bootleg|flip|mashup|cover|sped\s*up|slowed|reverb|nightcore|8d|bass\s*boosted|karaoke|instrumental|tribute|parody|reaction|ringtone)\b/i.test(got);
  }
  try {
    const cleanFlagKey = "aura.nativeAudioCache.v192_clean";
    if (!localStorage.getItem(cleanFlagKey)) {
      localStorage.removeItem(NATIVE_AUDIO_CACHE_KEY);
      localStorage.setItem(cleanFlagKey, "1");
    }
    const rawCache = localStorage.getItem(NATIVE_AUDIO_CACHE_KEY);
    if (rawCache) {
      const parsed = JSON.parse(rawCache);
      if (Array.isArray(parsed)) {
        for (const [k, v] of parsed) {
          if (k && v && typeof v === "object") {
            if (v.streamUrl && (isOneMinuteCappedStreamUrl(v.streamUrl) || isUnwantedRemixStreamUrl(v.streamUrl))) v.streamUrl = "";
            nativeAppAudioCache.set(k, v);
          }
        }
      }
    }
  } catch {}

  function persistNativeAppAudioCache() {
    try {
      const entries = Array.from(nativeAppAudioCache.entries()).slice(-NATIVE_AUDIO_CACHE_MAX);
      localStorage.setItem(NATIVE_AUDIO_CACHE_KEY, JSON.stringify(entries));
    } catch {}
  }

  function getNativeAudioCacheKeys(t) {
    if (!t) return [];
    const sk = canonicalSongKey(t);
    const tk = trackKey(t);
    const q0 = buildTrackPlayQueries(t)[0] || "";
    return [
      t.videoId ? `vid:${t.videoId}` : "",
      t.id ? `id:${t.id}` : "",
      tk ? `tk:${tk}` : "",
      sk ? `sk:${sk}` : "",
      q0 ? `q:${q0.toLowerCase()}` : "",
    ].filter(Boolean);
  }

  function storeNativeAppAudioCache(t, extra = {}) {
    if (!t || t.source === "radio") return null;
    const keys = getNativeAudioCacheKeys(t);
    if (!keys.length) return null;
    let existing = null;
    for (const k of keys) {
      if (nativeAppAudioCache.has(k)) {
        existing = nativeAppAudioCache.get(k);
        break;
      }
    }
    const rawStreamUrl = String(extra.streamUrl || t.streamUrl || (existing && existing.streamUrl) || "");
    const cleanStreamUrl = (/^yt:/i.test(rawStreamUrl) || isOneMinuteCappedStreamUrl(rawStreamUrl) || isUnwantedRemixStreamUrl(rawStreamUrl, t.source)) ? "" : rawStreamUrl;
    const resolvedVid = String(extra.videoId || t.videoId || (existing && existing.videoId) || "");
    const resolvedCands = Array.isArray(extra.candidates)
      ? extra.candidates.slice(0, 10)
      : Array.isArray(t._ytCandidates)
        ? t._ytCandidates.slice(0, 10)
        : (existing && existing.candidates) || [];
    const resolvedLyrics = extra.lyrics !== undefined ? extra.lyrics : (existing && existing.lyrics) || null;
    if (!resolvedVid && !cleanStreamUrl && !resolvedCands.length && !resolvedLyrics) {
      return existing || null;
    }
    const entry = {
      videoId: resolvedVid,
      streamUrl: cleanStreamUrl,
      candidates: resolvedCands,
      artwork: String(extra.artwork || t.artwork || (existing && existing.artwork) || ""),
      duration: Number(extra.duration || t.duration || (existing && existing.duration) || 0),
      title: String(t.title || (existing && existing.title) || ""),
      artist: String(artistName(t) || t.artist || (existing && existing.artist) || ""),
      lyrics: resolvedLyrics,
      lyricsChecked: Boolean(extra.lyricsChecked || (existing && existing.lyricsChecked)),
      cachedAt: Date.now(),
    };
    for (const k of keys) {
      if (nativeAppAudioCache.has(k)) nativeAppAudioCache.delete(k);
      nativeAppAudioCache.set(k, entry);
    }
    while (nativeAppAudioCache.size > NATIVE_AUDIO_CACHE_MAX * 3) {
      const oldest = nativeAppAudioCache.keys().next().value;
      if (oldest === undefined) break;
      nativeAppAudioCache.delete(oldest);
    }
    persistNativeAppAudioCache();
    return entry;
  }

  function getNativeAppAudioCache(t) {
    if (!t || t.source === "radio") return null;
    const keys = getNativeAudioCacheKeys(t);
    for (const k of keys) {
      const hit = nativeAppAudioCache.get(k);
      if (hit && (hit.videoId || hit.streamUrl || hit.title)) {
        return hit;
      }
    }
    return null;
  }

  function ytResolveStore(q, videoId, artwork, duration, candidates = [], streamUrl = "", songKey = "") {
    if (ytResolveCache.size >= YT_RESOLVE_CACHE_MAX) {
      const first = ytResolveCache.keys().next().value;
      if (first !== undefined) ytResolveCache.delete(first);
    }
    const entry = {
      videoId: videoId || "",
      candidates: Array.isArray(candidates) ? candidates.slice(0, 10) : [],
      artwork: artwork || "",
      duration: duration || 0,
      streamUrl: streamUrl || "",
    };
    if (q) ytResolveCache.set(q, entry);
    if (songKey) ytResolveCache.set(`sk:${songKey}`, entry);
  }

  function applyYtResolveCacheHit(t, cachedHit) {
    if (!t || !cachedHit || (!cachedHit.videoId && !cachedHit.streamUrl)) return false;
    if (cachedHit.videoId) t.videoId = cachedHit.videoId;
    if (cachedHit.candidates && cachedHit.candidates.length) t._ytCandidates = cachedHit.candidates.slice();
    if (cachedHit.streamUrl && !t.streamUrl && !isUnwantedRemixStreamUrl(cachedHit.streamUrl, t.source)) t.streamUrl = cachedHit.streamUrl;
    if (!t.origSource) t.origSource = t.source;
    if (t.source !== "apple" && t.source !== "deezer" && t.source !== "itunes") t.source = "youtube";
    if ((!t.artwork || t.artwork === "/cover-default.jpg") && cachedHit.artwork) t.artwork = cachedHit.artwork;
    if (cachedHit.duration && !t.duration) t.duration = cachedHit.duration;
    return true;
  }

  function warmTrack(t) {
    if (!t || t.source === "radio") return;
    const now = Date.now();
    if (t._warmedAt && now - t._warmedAt < 45000) return;
    t._warmedAt = now;
    const NP = nativePlayer();
    if (IS_NATIVE && NP && typeof NP.preload === "function" && (t.videoId || t.title) && !t._nativePreloaded) {
      t._nativePreloaded = true;
      const cands = Array.isArray(t._ytCandidates) ? t._ytCandidates.slice(0, 5).join(",") : "";
      NP.preload({
        videoId: String(t.videoId || ""),
        candidates: cands,
        title: String(t.title || ""),
        artist: String(artistName(t) || t.artist || ""),
      }).catch(() => {});
    }
    const warmResolved = (tr) => {
      if (!tr) return;
      const NP2 = nativePlayer();
      if (IS_NATIVE && NP2 && typeof NP2.preload === "function") {
        if ((tr.videoId || tr.title) && !tr._nativePreloaded) {
          tr._nativePreloaded = true;
          const cands = Array.isArray(tr._ytCandidates) ? tr._ytCandidates.slice(0, 5).join(",") : "";
          NP2.preload({
            videoId: String(tr.videoId || ""),
            candidates: cands,
            title: String(tr.title || ""),
            artist: String(artistName(tr) || tr.artist || ""),
          }).catch(() => {});
        }
      }
      if ((tr.videoId || tr.title) && !tr.streamUrl) {
        getWarmStream(tr.videoId || "", tr.title || "", artistName(tr) || tr.artist || "", tr._ytCandidates || [], 5000, true).then((res) => {
          if (res && res.url && !res.isPreview && (!IS_NATIVE || tr.source === "audius" || (res.source !== "soundcloud" && res.source !== "audius" && !/sndcdn\.com|audius\.co/i.test(res.url)))) {
            tr.streamUrl = res.url.startsWith("/") ? API_BASE + res.url : res.url;
            tr._isPreviewStream = false;
            if (res.videoId && !tr.videoId) tr.videoId = res.videoId;
            if (res.duration && !tr.duration) tr.duration = Number(res.duration);
          }
        }).catch(() => {});
      }
    };
    if (!t.videoId && !t.streamUrl && !t.url && t.source !== "audius") {
      resolveYouTubePlay(t).then(() => warmResolved(t)).catch(() => {});
    } else {
      warmResolved(t);
    }
  }

  // In-flight & warm stream cache: key (videoId or query) -> { promise, data, exp }
  const warmStreamMap = new Map();
  function getWarmStream(videoId, title = "", artist = "", candidates = [], timeoutMs = 4000, fast = false) {
    const vid = String(videoId || "").trim();
    const cleanT = String(title || "").trim().toLowerCase();
    const cleanA = String(artist || "").trim().toLowerCase();
    const key = vid || (cleanT ? `q:${cleanT}|${cleanA}` : "");
    if (!key) return Promise.resolve(null);
    const now = Date.now();
    const hit = warmStreamMap.get(key) || (vid && cleanT ? warmStreamMap.get(`q:${cleanT}|${cleanA}`) : null);
    if (hit && hit.exp > now) {
      if (hit.data) return Promise.resolve(hit.data);
      if (hit.promise) {
        return Promise.race([
          hit.promise,
          new Promise((res) => setTimeout(() => res(null), timeoutMs)),
        ]);
      }
    }
    const candParam = Array.isArray(candidates) && candidates.length
      ? `&candidates=${encodeURIComponent(candidates.slice(0, 5).join(","))}`
      : "";
    const fastParam = fast ? "&fast=1" : "";
    const p = api(
      `/api/yt/stream?v=${encodeURIComponent(vid)}&title=${encodeURIComponent(title || "")}&artist=${encodeURIComponent(artist || "")}${candParam}${fastParam}&allowPreview=0`,
      timeoutMs
    ).then((d) => {
      if (d && d.url && !d.isPreview) {
        if (isOneMinuteCappedStreamUrl(d.url) || d.source === "soundcloud" || d.source === "audius" || isUnwantedRemixStreamUrl(d.url, "youtube")) {
          warmStreamMap.delete(key);
          return null;
        }
        if (d.url.startsWith("/")) d.url = API_BASE + d.url;
        const entry = { data: d, promise: null, exp: Date.now() + 12 * 60 * 1000 };
        warmStreamMap.set(key, entry);
        if (d.videoId) warmStreamMap.set(String(d.videoId), entry);
        if (cleanT) warmStreamMap.set(`q:${cleanT}|${cleanA}`, entry);
        return d;
      }
      warmStreamMap.delete(key);
      return null;
    }).catch(() => {
      warmStreamMap.delete(key);
      return null;
    });
    if (warmStreamMap.size > 200) {
      const oldest = warmStreamMap.keys().next().value;
      if (oldest) warmStreamMap.delete(oldest);
    }
    warmStreamMap.set(key, { data: null, promise: p, exp: now + 30000 });
    return p;
  }

  function buildTrackPlayQueries(t) {
    const rawTitle = String((t && t.title) || "").trim();
    const rawArtist = String((t && t.artist) || "").replace(/^(unknown artist|various artists|artist|youtube)$/i, "").trim();
    const cleanTitle = rawTitle
      .replace(/\s*[\[(][^)\]]*(?:feat\.?|ft\.?|with|remaster|live|radio edit|explicit|clean|version|deluxe|bonus|soundtrack|from\s)[^)\]]*[)\]]/gi, "")
      .replace(/\s+-\s+.*?(?:remaster|version|edit|live|mono|stereo|deluxe).*$/i, "")
      .trim() || rawTitle;
    const bareTitle = rawTitle.replace(/\s*[\[(][^)\]]*[)\]]/g, "").trim() || cleanTitle;
    const primaryArtist = rawArtist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\swith\s|\/)\s*/i)[0].trim() || rawArtist;
    const list = [
      String(t && t.playQuery || "").trim(),
      `${rawTitle} ${rawArtist} official audio`.trim(),
      `${cleanTitle} ${primaryArtist} official audio`.trim(),
      `${bareTitle} ${primaryArtist}`.trim(),
      cleanTitle,
    ].filter(Boolean);
    return [...new Set(list)];
  }

  async function resolveFallbackStreamUrl(t, skipYtStream = false) {
    if (!t) return "";
    if (t.streamUrl && isUnwantedRemixStreamUrl(t.streamUrl, t.source)) {
      t.streamUrl = "";
    }
    if (!skipYtStream && t.streamUrl && !t._isPreviewStream) return t.streamUrl;
    if (!skipYtStream && t.videoId) {
      try {
        const warm = await getWarmStream(t.videoId, t.title || "", artistName(t) || t.artist || "", t._ytCandidates || [], 5500, true);
        if (warm && warm.url && !warm.isPreview && !isUnwantedRemixStreamUrl(warm.url, t.source)) {
          t.streamUrl = warm.url.startsWith("/") ? API_BASE + warm.url : warm.url;
          t._isPreviewStream = false;
          if (warm.videoId && !t.videoId) t.videoId = warm.videoId;
          if (warm.duration && !t.duration) t.duration = Number(warm.duration);
          return t.streamUrl;
        }
      } catch {}
    }
    const candParam = Array.isArray(t._ytCandidates) && t._ytCandidates.length
      ? `&candidates=${encodeURIComponent(t._ytCandidates.slice(0, 5).join(","))}`
      : "";
    if (!skipYtStream && (t.videoId || t.title)) {
      try {
        const sData = await api(`/api/yt/stream?v=${encodeURIComponent(t.videoId || "")}&title=${encodeURIComponent(t.title || "")}&artist=${encodeURIComponent(t.artist || "")}${candParam}&allowPreview=0`, 6500);
        if (sData && sData.url && !sData.isPreview && !isUnwantedRemixStreamUrl(sData.url, t.source) && (t.source === "audius" || (sData.source !== "soundcloud" && sData.source !== "audius"))) {
          t.streamUrl = sData.url.startsWith("/") ? API_BASE + sData.url : sData.url;
          t._isPreviewStream = false;
          if (sData.videoId && !t.videoId) t.videoId = sData.videoId;
          if (sData.duration && !t.duration) t.duration = Number(sData.duration);
          return t.streamUrl;
        }
      } catch {}
    }
    // Try secondary stripped title via /api/yt/stream (1.6.6 full-track resolution, never 30s preview clips)
    const rawTitle = String(t.title || "").trim();
    const cleanTitle = rawTitle
      .replace(/\s*[\[(][^)\]]*(?:feat\.?|ft\.?|with|remaster|live|radio edit|explicit|clean|version|deluxe|bonus|soundtrack|from\s)[^)\]]*[)\]]/gi, "")
      .replace(/\s+-\s+.*?(?:remaster|version|edit|live|mono|stereo|deluxe).*$/i, "")
      .trim() || rawTitle;
    const rawArtist = String(artistName(t) || t.artist || "").trim();
    const primaryArtist = rawArtist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\swith\s|\/)\s*/i)[0].trim() || rawArtist;
    if (cleanTitle) {
      try {
        const sData = await api(`/api/yt/stream?title=${encodeURIComponent(cleanTitle)}&artist=${encodeURIComponent(primaryArtist)}${candParam}&allowPreview=0&refresh=1`, 6000);
        if (sData && sData.url && !sData.isPreview && !isUnwantedRemixStreamUrl(sData.url, t.source)) {
          t.streamUrl = sData.url.startsWith("/") ? API_BASE + sData.url : sData.url;
          t._isPreviewStream = false;
          if (sData.videoId && !t.videoId) t.videoId = sData.videoId;
          if (sData.duration && !t.duration) t.duration = Number(sData.duration);
          return t.streamUrl;
        }
      } catch {}
    }
    return "";
  }

  async function resolveYouTubePlay(t) {
    if (!t) return t;
    if (t.videoId) return t;
    const queries = buildTrackPlayQueries(t);
    const q = queries[0] || "";
    if (!q) throw new Error("No playable version");
    const sk = canonicalSongKey(t);

    // Instant path: already resolved this exact query or canonical song this session.
    const cachedHit = ytResolveCache.get(q) || (sk ? ytResolveCache.get(`sk:${sk}`) : null);
    if (applyYtResolveCacheHit(t, cachedHit)) {
      return t;
    }

    let rows = [];
    const extractRows = (d) => {
      const arr = (d && d.tracks) || (d && d.results) || (d && d.youtube) || (Array.isArray(d) ? d : []);
      return Array.isArray(arr) ? arr.filter((x) => x && (x.videoId || x.streamUrl)) : [];
    };

    // 1. Race fast primary YouTube search with stripped secondary query (80ms head start)
    let secondaryRaceTimer = null;
    try {
      const searchRaces = [
        api(`/api/youtube/search?q=${encodeURIComponent(q)}&fast=1&${glq()}`, 2600).then((d) => {
          const r = extractRows(d);
          if (!r.length) throw new Error("empty");
          return r;
        }),
      ];
      if (queries[2] && queries[2] !== q) {
        searchRaces.push(
          new Promise((res, rej) => {
            secondaryRaceTimer = setTimeout(() => {
              secondaryRaceTimer = null;
              api(`/api/youtube/search?q=${encodeURIComponent(queries[2])}&fast=1&${glq()}`, 2500)
                .then((d) => {
                  const r = extractRows(d);
                  if (!r.length) throw new Error("empty");
                  return r;
                })
                .then(res, rej);
            }, 80);
          })
        );
      }
      rows = await Promise.any(searchRaces);
    } catch {
    } finally {
      if (secondaryRaceTimer) {
        clearTimeout(secondaryRaceTimer);
        secondaryRaceTimer = null;
      }
    }

    // 2. Fallback: full /api/youtube/search + Piped browser search raced in parallel
    if (!Array.isArray(rows) || !rows.some((x) => x && (x.videoId || x.streamUrl))) {
      const qFallback = queries[3] || queries[2] || q;
      const pipedAttempt = ( () => {
        const qPiped = queries[3] || q;
        return pipedJson(`/search?q=${encodeURIComponent(qPiped)}&filter=music_songs`)
          .catch(() => pipedJson(`/search?q=${encodeURIComponent(qPiped)}&filter=all`))
          .then((pData) => {
            const pItems = (pData && (pData.items || pData)) || [];
            const mapped = pItems
              .map((it) => {
                const vid = (it && it.url && (it.url.split("v=")[1] || it.url.replace("/watch?v=", "")).split("&")[0]) || (it && it.videoId) || "";
                if (!vid) return null;
                return {
                  videoId: vid,
                  title: it.title || t.title,
                  artist: it.uploaderName || it.uploader || t.artist,
                  duration: Number(it.duration || 0),
                  artwork: it.thumbnail || ytThumb(vid),
                };
              })
              .filter(Boolean);
            if (!mapped.length) throw new Error("empty piped");
            return mapped;
          });
      })();
      const serverAttempt = api(`/api/youtube/search?q=${encodeURIComponent(qFallback)}&${glq()}`, 3800).then((d) => {
        const r = extractRows(d);
        if (!r.length) throw new Error("empty server");
        return r;
      });
      try {
        rows = await Promise.any([serverAttempt, pipedAttempt]);
      } catch {}
    }

    const rawValidRows = (Array.isArray(rows) ? rows : []).filter((x) => x && (x.videoId || x.streamUrl));
    const nonRemixRows = rawValidRows.filter((x) => !isUnwantedRemixCandidateTitle(`${x.title || ""} ${x.artist || ""}`, t.title));
    const validRows = nonRemixRows.length ? nonRemixRows : rawValidRows;
    const blockedSet = t._blockedVideoIds instanceof Set ? t._blockedVideoIds : new Set();
    const candidates = validRows.map((x) => x.videoId).filter((vid) => vid && !blockedSet.has(vid));
    if (candidates.length) {
      t._ytCandidates = [...new Set(candidates)];
    }

    const hit = validRows.find((x) => x.videoId && !blockedSet.has(x.videoId)) || validRows[0];
    if (hit && hit.videoId) {
      t.videoId = hit.videoId;
      if (!t.origSource) t.origSource = t.source;
      if (t.source !== "apple" && t.source !== "deezer" && t.source !== "itunes") t.source = "youtube";
      if (hit.duration && !t.duration) t.duration = hit.duration;
      if ((!t.artwork || t.artwork === "/cover-default.jpg") && hit.artwork) t.artwork = hit.artwork;
      ytResolveStore(q, t.videoId, t.artwork, hit.duration || 0, t._ytCandidates || [], t.streamUrl || "", sk);
      return t;
    }

    if (hit && hit.streamUrl) {
      t.streamUrl = hit.streamUrl;
      if (!t.origSource) t.origSource = t.source;
      if (hit.duration && !t.duration) t.duration = hit.duration;
      if ((!t.artwork || t.artwork === "/cover-default.jpg") && hit.artwork) t.artwork = hit.artwork;
      ytResolveStore(q, "", t.artwork, hit.duration || 0, [], t.streamUrl, sk);
      return t;
    }

    // 5. Direct full-quality audio stream fallback via /api/yt/stream so a clicked catalog song ALWAYS plays
    const fallbackUrl = await resolveFallbackStreamUrl(t);
    if (fallbackUrl) {
      t.streamUrl = fallbackUrl;
      ytResolveStore(q, "", t.artwork, t.duration || 0, [], fallbackUrl, sk);
      return t;
    }

    throw new Error("No playable version");
  }

  async function playFallbackAudioForTrack(t, skipYtStream = false) {
    if (!t) return false;
    try {
      const url = await resolveFallbackStreamUrl(t, skipYtStream);
      if (!url) return false;
      t.streamUrl = url;
      t._playingViaAudio = true;
      await playAudio(t);
      failSkip = 0;
      state.playing = true;
      setWantPlay(true);
      showEl($("eqBars"), true);
      updateMediaSession();
      updateWakeLock();
      startTimer();
      renderChrome();
      return true;
    } catch {
      return false;
    }
  }

  async function playCurrent(reset) {
    const t = current();
    if (!t) return;
    // Whenever reset is true (user clicked a song, or skipped next/prev), or when
    // switching to a different track than the cross-reload restored track, always
    // clear any pending seek so a new song never jumps to a stale timestamp (0:14 / 0:38).
    const curIdent = trackKey(t) || String(t.id || "");
    if (reset || (_resumeTrackId && curIdent !== _resumeTrackId && String(t.id || "") !== _resumeTrackId)) {
      _pendingSeek = 0;
      ytSeekReset = 0;
      _pendingSeekApplied = true;
      _resumeTrackId = null;
    }
    const gen = ++playGen;
    t._playingViaAudio = false;
    if (t.streamUrl && isUnwantedRemixStreamUrl(t.streamUrl, t.source)) {
      t.streamUrl = "";
    }
    if (t.url && isUnwantedRemixStreamUrl(t.url, t.source)) {
      t.url = "";
    }
    if (reset) {
      t._nativeRefreshTried = false;
      t._nativeOnDeviceTried = false;
      t._nativeOnDeviceVid = "";
      t._nativeYtFallbackTried = false;
      t._nativeFallbackTried = false;
      t._webYtFallbackTried = false;
      if (t._isPreviewStream) {
        t.streamUrl = "";
        t._isPreviewStream = false;
      }
    }
    state._xfading = false;
    state.playing = true;
    setWantPlay(true);
    if (reset) {
      npPos = 0;
      npPosAt = 0;
      const seekEl = $("seek");
      if (seekEl && !isSeekingUi) {
        seekCur = 0;
        seekTgt = 0;
        seekEl.value = 0;
      }
      if ($("curTime")) $("curTime").textContent = "0:00";
      if ($("durTime")) $("durTime").textContent = t.source === "radio" ? "LIVE" : fmt(t.duration || 0);
    }
    pushRecent(t);
    // Avoid rebuilding the entire Home DOM on phones right as playback starts
    if (!cheapPhone() && !IS_NATIVE) paintHomeSoon();
    renderChrome();
    const isNetworkOff = Boolean(
      state.offlineMode ||
      state.isNetworkOffline ||
      (typeof navigator !== "undefined" && navigator.onLine === false)
    );

    // Pre-warm the YouTube IFrame player synchronously on the user click
    // gesture BEFORE awaiting network resolution (resolveYouTubePlay) so mobile
    // & desktop browsers and native WebViews don't block autoplay if native
    // on-device stream resolution falls back to the embedded player.
    const useNativeAudioPipe = IS_NATIVE && !!nativePlayer() && state.prefs.ytAudio !== false && !state.showVideo;
    if (!isNetworkOff && !useNativeAudioPipe && !state.yt && typeof YT !== "undefined" && YT.Player) {
      try { ensureYT(t.videoId || ""); } catch {}
    }

    // Strip any accidental duplicate of the current song sitting right next in the queue
    // so MUCHI never plays the same song twice in a row.
    while (state.index + 1 < state.queue.length && isSameSongClient(state.queue[state.index + 1], t)) {
      state.queue.splice(state.index + 1, 1);
    }
    stopTimer();

    // Check Native App Audio Cache synchronously so replaying a cached song in the
    // Native App immediately fetches from app cache and puts zero load on the backend.
    const nativeCachedEntry = IS_NATIVE ? getNativeAppAudioCache(t) : null;
    if (nativeCachedEntry) {
      applyYtResolveCacheHit(t, nativeCachedEntry);
      t._fromNativeAppCache = true;
      if (nativeCachedEntry.lyrics && (nativeCachedEntry.lyrics.lyrics || (nativeCachedEntry.lyrics.synced && nativeCachedEntry.lyrics.synced.length))) {
        state.lyrics = { ...nativeCachedEntry.lyrics, key: lyricsKey(t) };
      }
    } else {
      t._fromNativeAppCache = false;
    }

    // Always load lyrics (uses IndexedDB / saved download cache when offline)
    loadLyrics(t);

    try {
      const saved = findSavedTrack(t);
      const offlineBlob = (saved || isNetworkOff) ? await getOfflineAudioBlob(t) : null;
      const hasOfflinePlayback = Boolean((saved && saved.uri && (nativePlayer() || !saved.uri.startsWith("fsp:"))) || offlineBlob);

      // If the song is downloaded or device is offline:
      // ALWAYS play using the saved local audio file/blob via playAudio.
      // Never attempt to load YouTube iframe or remote stream over internet!
      if (hasOfflinePlayback || isNetworkOff) {
        if (hasOfflinePlayback) {
          t._playingViaAudio = true;
          await playAudio(t);
          if (gen !== playGen) return;
          failSkip = 0;
          state.playing = true;
          setWantPlay(true);
          showEl($("eqBars"), true);
          updateMediaSession();
          updateWakeLock();
          startTimer();
          renderChrome();
          updateProgress();
          if (state.view === "now" && gen === playGen) render();
          return;
        } else {
          state.playing = false;
          setWantPlay(false);
          renderChrome();
          toast(`"${t.title}" is not available offline`);
          skipFailed("Song not downloaded for offline playback");
          return;
        }
      }

      // Check synchronous resolution cache before deciding if network resolution is needed
      if (!t.videoId && !t.streamUrl && !t.url && t.source !== "audius" && t.source !== "radio") {
        const q0 = buildTrackPlayQueries(t)[0] || "";
        const sk0 = canonicalSongKey(t);
        const syncHit = (q0 && ytResolveCache.get(q0)) || (sk0 && ytResolveCache.get(`sk:${sk0}`));
        if (syncHit) applyYtResolveCacheHit(t, syncHit);
      }

      // Metadata-only sources (apple/itunes/deezer from the iTunes or Deezer
      // catalogs, and any youtube row still missing a resolved videoId) have
      // no direct audio stream — resolve them to a real stream before playing.
      const needsResolve =
        !t.videoId && !t.streamUrl && !t.url &&
        t.source !== "audius" && t.source !== "radio";
      if (needsResolve) {
        renderBufferState(true);
        try {
          await resolveYouTubePlay(t);
        } catch (resErr) {
          if (!useNativeAudioPipe || !t.title) throw resErr;
        } finally {
          if (gen === playGen) {
            renderBufferState(false);
            renderChrome();
          }
        }
      }
      if (gen !== playGen) return;

      if ((t.videoId || (useNativeAudioPipe && t.title && !t.streamUrl && !t.url && t.source !== "audius" && t.source !== "radio")) && !t._playingViaAudio) {
        // On native shells, play YouTube as a background audio stream when
        // possible so the OS media notification + lock-screen controls work
        // and music keeps playing with the screen off. Falls back to the
        // in-app iframe/video player when no audio stream is resolvable (e.g.
        // Piped outage), so playback never breaks. Disable via prefs.ytAudio.
        const usedNative = await playYtWithAudio(t, reset);
        if (usedNative) {
          // resolved + handed to native player; nothing more to do here
        } else {
          try {
            if (!t.videoId) await resolveYouTubePlay(t);
            if (gen !== playGen) return;
            await playYouTube(t, reset);
          } catch (ytErr) {
            if (gen !== playGen) return;
            const okFallback = await playFallbackAudioForTrack(t);
            if (!okFallback) throw ytErr;
          }
        }
      }
      else if (t.source === "youtube" && !t.streamUrl && !t.url) throw new Error("No video");
      else {
        t._playingViaAudio = true;
        await playAudio(t);
      }

      if (gen !== playGen) return;
      if (IS_NATIVE) {
        storeNativeAppAudioCache(t);
      }
      if (!isNetworkOff && !t._fromNativeAppCache) {
        setTimeout(() => {
          if (gen !== playGen) return;
          loadQueueRecs(t);
          const remainingUpcoming = Array.isArray(state.queue) ? (state.queue.length - 1 - state.index) : 0;
          if (remainingUpcoming <= 2 && t.source !== "radio") {
            fillRelatedQueue(t);
          }
          if (state.index + 1 < state.queue.length) {
            warmTrack(state.queue[state.index + 1]);
          }
        }, 120);
      }
      failSkip = 0;
      state.playing = true;
      setWantPlay(true);
      showEl($("eqBars"), true);
      updateMediaSession();
      updateWakeLock();
      startTimer();
      renderChrome();
      updateProgress();
    } catch (err) {
      if (err && (err.name === "AbortError" || String(err.message || "").includes("interrupted"))) {
        return;
      }
      console.error(err);
      // Try secondary full-quality audio stream resolution before giving up on a metadata track
      if (gen === playGen && (t.source === "deezer" || t.source === "apple" || t.source === "itunes")) {
        try {
          const okAudio = await playFallbackAudioForTrack(t);
          if (okAudio) {
            if (state.view === "now" && gen === playGen) render();
            return;
          }
        } catch {}
      }
      // Last-chance offline fallback if network failed unexpectedly (e.g. data turned off)
      try {
        const fallbackBlob = await getOfflineAudioBlob(t);
        if (fallbackBlob) {
          const fallbackUrl = URL.createObjectURL(fallbackBlob);
          t._playingViaAudio = true;
          await playAudioWeb(fallbackUrl);
          if (gen !== playGen) return;
          failSkip = 0;
          state.playing = true;
          setWantPlay(true);
          showEl($("eqBars"), true);
          updateMediaSession();
          updateWakeLock();
          startTimer();
          if (state.view === "now" && gen === playGen) render();
          return;
        }
      } catch {}
      if (gen === playGen) skipFailed("Could not play this track");
    }
    if (state.view === "now" && gen === playGen) render();
  }

  // Try to play a YouTube track through the native audio pipeline connected to Cloudflare backend
  async function playYtWithAudio(t, reset) {
    if (!t || (!t.videoId && !t.title)) return false;
    if (!IS_NATIVE || !nativePlayer()) return false;
    if (state.prefs.ytAudio === false) return false;
    if (state.showVideo) return false;
    let dur = t.duration || 0;
    const urlDur = parseStreamUrlDuration(t.streamUrl || "");
    if (!dur && urlDur > 0) dur = urlDur;

    // 1. Connect Native App to uncapped streams with zero delay:
    //    Reject any 1-minute capped c=IOS/c=ANDROID URLs, check warm stream cache with a fast 450ms budget,
    //    and otherwise let MuchiAudioService resolve uncapped ANDROID_VR / ANDROID_TESTSUITE / Piped streams directly on-device.
    if (t.streamUrl && (isOneMinuteCappedStreamUrl(t.streamUrl) || isUnwantedRemixStreamUrl(t.streamUrl, t.source))) {
      t.streamUrl = "";
    }
    let resolvedStream = (t.streamUrl && /^https?:\/\//i.test(t.streamUrl) && !t._isPreviewStream) ? t.streamUrl : "";
    if (!resolvedStream && t.streamUrl && t.streamUrl.startsWith("/") && !t._isPreviewStream) {
      resolvedStream = API_BASE + t.streamUrl;
    }
    if (!resolvedStream) {
      try {
        const warm = await getWarmStream(
          t.videoId || "",
          t.title || "",
          artistName(t) || t.artist || "",
          t._ytCandidates || [],
          450,
          false
        );
        if (warm && warm.url && !warm.isPreview && !isOneMinuteCappedStreamUrl(warm.url) && (t.source === "audius" || (warm.source !== "soundcloud" && warm.source !== "audius" && !/sndcdn\.com|audius\.co/i.test(warm.url)))) {
          resolvedStream = warm.url.startsWith("/") ? API_BASE + warm.url : warm.url;
          if (warm.videoId && !t.videoId) t.videoId = warm.videoId;
          if (warm.duration && !dur) dur = Number(warm.duration);
        }
      } catch {}
    }

    if (resolvedStream) {
      t.streamUrl = resolvedStream;
      t._nativeOnDeviceTried = false;
    } else {
      // Fallback to native service resolution (which also queries Cloudflare backend + on-device InnerTube/JioSaavn)
      t._nativeOnDeviceTried = true;
      t._nativeOnDeviceVid = String(t.videoId || "");
      if (t.videoId) {
        t.streamUrl = `yt:${t.videoId}`;
      } else {
        t.streamUrl = "yt:";
      }
    }
    t._isPreviewStream = false;
    if (dur > 0) {
      t.duration = dur;
      if ($("durTime") && current() === t && t.source !== "radio") {
        $("durTime").textContent = fmt(dur);
      }
    }
    t._playingViaAudio = true;
    await playAudio(t);
    return (!!nativePlayer() && npActive) || !audio.paused;
  }

  function stopOthers(keep) {
    if (keep !== "audio") {
      try {
        audio.pause();
      } catch {}
      nativeStopPlayback();
    }
    if (keep !== "yt" && state.yt && state.yt.pauseVideo) {
      try { state.yt.pauseVideo(); } catch {}
    }
  }

  function applyNativePendingSeek() {
    if (_pendingSeek <= 0) return;
    try {
      const NP = nativePlayer();
      if (npActive && NP && typeof NP.seekTo === "function") {
        NP.seekTo({ position: Math.round(_pendingSeek * 1000) }).catch(() => {});
        const pos = _pendingSeek;
        _pendingSeek = 0;
        _pendingSeekApplied = true;
        if (typeof npPos === "number") npPos = pos;
      }
    } catch {}
  }

  async function playAudio(t) {
    webEnsurePermissions();
    if (IS_NATIVE) {
      nativeEnsureNotifyPermission();
      nativeEnsureStoragePermission();
    }
    stopOthers("audio");
    let url = "";
    const isNetworkOff = Boolean(
      state.offlineMode ||
      state.isNetworkOffline ||
      (typeof navigator !== "undefined" && navigator.onLine === false)
    );

    // Check for offline saved version first
    const saved = findSavedTrack(t);
    let offlineBlob = null;
    if (saved || isNetworkOff) {
      offlineBlob = await getOfflineAudioBlob(t);
    }

    if (saved && saved.uri && nativePlayer() && !saved.uri.startsWith("fsp:") && !saved.uri.startsWith("blob:")) {
      url = saved.uri;
      const startAt = _pendingSeek > 0 ? _pendingSeek : 0;
      if (nativePlayTrack(url, t.title, artistName(t) || t.artist, artUrl(t), t.duration || 0, t.videoId || "", "", startAt)) {
        setWantPlay(true); state.playing = true; showEl($("eqBars"), true);
        applyNativePendingSeek();
        updateMediaSession(); updateWakeLock(); startTimer(); return;
      }
      url = "";
    }

    if (offlineBlob) {
      if (activeOfflineBlobUrl && activeOfflineBlobTrackKey !== trackKey(t)) {
        try { URL.revokeObjectURL(activeOfflineBlobUrl); } catch {}
        activeOfflineBlobUrl = "";
      }
      if (!activeOfflineBlobUrl || activeOfflineBlobTrackKey !== trackKey(t)) {
        activeOfflineBlobUrl = URL.createObjectURL(offlineBlob);
        activeOfflineBlobTrackKey = trackKey(t);
      }
      url = activeOfflineBlobUrl;
    } else if (!isNetworkOff) {
      if (t.streamUrl && isUnwantedRemixStreamUrl(t.streamUrl, t.source)) {
        t.streamUrl = "";
      }
      if (t.url && isUnwantedRemixStreamUrl(t.url, t.source)) {
        t.url = "";
      }
      url = t.streamUrl || t.url || "";
      if (IS_NATIVE && nativePlayer() && t.videoId && !t._nativeOnDeviceTried && !url) {
        url = `yt:${t.videoId}`;
        t._nativeOnDeviceTried = true;
      }
    }

    if (!url && t.source === "audius" && t.trackId) {
      if (IS_NATIVE && nativePlayer()) {
        url = `https://discoveryprovider.audius.co/v1/tracks/${encodeURIComponent(t.trackId)}/stream?app_name=MUCHI`;
        t.streamUrl = url;
      } else if (IS_NATIVE) {
        try {
          const data = await api(`/api/audius/stream/${encodeURIComponent(t.trackId)}`, 5000);
          if (data && data.url) {
            url = data.url;
            t.streamUrl = url;
          }
        } catch {}
      }
      if (!url) {
        url = `${API_BASE}/api/audius/file/${encodeURIComponent(t.trackId)}`;
        t.streamUrl = url;
      }
    }
    if (t.source === "radio") {
      if (t.stationId) fetch(`${API_BASE}/api/radio/click/${encodeURIComponent(t.stationId)}`).catch(() => {});
      // (v1.5.4) Cleartext radio handling. The overwhelming majority of
      // radio-browser stations serve plain http:// — which iOS ATS, Android
      // (API 28+ default) and any https web page REFUSE to play, silently
      // ("station starts, no sound"). Wherever direct playback can't happen,
      // route the stream through the Worker's https /api/stream proxy (it is
      // built for exactly this: long-lived body, no re-resolution). https
      // stations still play directly — zero added proxy load for them.
      const cleartext = !!url && /^http:\/\//i.test(url);
      if (cleartext && (IS_NATIVE || /^https:/i.test(location.protocol))) {
        url = `${API_BASE}/api/stream?url=${encodeURIComponent(url)}`;
      } else if (url && /^https?:\/\//i.test(url) && !API_BASE) {
        // Same-origin web deploys keep proxying all radio (existing behavior:
        // avoids hotlinking from the site's own origin).
        url = `/api/stream?url=${encodeURIComponent(url)}`;
      }
    }
    if (!url && !isNetworkOff) {
      if (t.videoId && IS_NATIVE && nativePlayer()) {
        url = `yt:${t.videoId}`;
        t._nativeOnDeviceTried = true;
      } else if (t.videoId) {
        try {
          const sData = await api(`/api/yt/stream?v=${encodeURIComponent(t.videoId)}&title=${encodeURIComponent(t.title || "")}&artist=${encodeURIComponent(artistName(t) || t.artist || "")}`, 6000);
          if (sData && sData.url) {
            url = sData.url;
            t.streamUrl = url;
            if (sData.duration && !t.duration) t.duration = Number(sData.duration);
          }
        } catch {}
      }
      if (!url) {
        url = await resolveFallbackStreamUrl(t);
      }
    }
    if (!url) {
      if (isNetworkOff) {
        throw new Error("Track is not available offline");
      }
      throw new Error("No audio stream available");
    }
    // Proxy URLs from the API (e.g. /api/stream?url=… from /api/yt/stream) are
    // same-origin relative paths. The native player needs an absolute URL, so
    // resolve them against API_BASE before handing over. On the web there is no
    // native plugin, so audio plays in the WebView <audio> element instead.
    if (url.startsWith("/")) url = API_BASE + url;
    if (nativePlayer() && (/^https?:\/\//i.test(url) || /^yt:/i.test(url))) {
      const cands = Array.isArray(t._ytCandidates) ? t._ytCandidates.slice(0, 5).join(",") : "";
      const startAt = _pendingSeek > 0 ? _pendingSeek : 0;
      if (nativePlayTrack(url, t.title, artistName(t) || t.artist, artUrl(t), t.duration || 0, t.videoId || "", cands, startAt)) {
        if (/^yt:/i.test(url)) t.streamUrl = "";
        setWantPlay(true);
        state.playing = true;
        showEl($("eqBars"), true);
        applyNativePendingSeek();
        updateMediaSession();
        updateWakeLock();
        startTimer();
        return;
      }
    }
    if (/^yt:/i.test(url)) {
      t.streamUrl = "";
      throw new Error("Native YouTube stream unavailable on web");
    }
    await playAudioWeb(url);
  }

  let audioPlaySeq = 0;
  let activeOfflineBlobUrl = "";
  let activeOfflineBlobTrackKey = "";
  let _webSeekTarget = -1;
  async function playAudioWeb(url) {
    const t = current();
    if (!t || !url) return;
    if (url.startsWith("/")) url = API_BASE + url;
    t._playingViaAudio = true;
    const seq = ++audioPlaySeq;
    adaptiveBuffer.buffering = false;
    adaptiveBuffer.startTime = performance.now();
    renderBufferState(false);
    if (audio.src !== url) {
      _webSeekTarget = -1;
      audio.src = url;
    }
    applyPlaybackPrefs();
    try {
      if (fx.ctx && fx.ctx.state === "suspended") {
        fx.ctx.resume().catch(() => {});
      }
    } catch {}
    try {
      const p = audio.play();
      if (p !== undefined) {
        await p;
      }
    } catch (err) {
      if (seq !== audioPlaySeq) return;
      if (err && (err.name === "AbortError" || String(err.message || "").includes("interrupted"))) {
        return;
      }
      if (err && err.name === "NotAllowedError") {
        state.playing = false;
        renderChrome();
        return;
      }
      // If direct CDN stream failed (CORS/403), retry through Worker proxy
      if (!url.includes("/api/stream") && !url.includes("/api/preview/audio") && /^https?:\/\//i.test(url)) {
        try {
          const proxied = `${API_BASE}/api/stream?url=${encodeURIComponent(url)}`;
          audio.src = proxied;
          const p2 = audio.play();
          if (p2 !== undefined) await p2;
        } catch {
          throw err;
        }
      } else {
        throw err;
      }
    }
    if (seq !== audioPlaySeq) return;
    // Resume the restored track's saved position once metadata is loaded.
    if (_pendingSeek > 0 && !_pendingSeekApplied) {
      _pendingSeekApplied = true;
      const seek = _pendingSeek;
      const once = () => {
        try {
          const ok = Number(audio.duration);
          if (ok && ok > 0.5) audio.currentTime = Math.min(seek, ok - 0.25);
        } catch (err) { console.error(err); }
        audio.removeEventListener("loadedmetadata", once);
      };
      if (audio.readyState >= 1) once();
      else audio.addEventListener("loadedmetadata", once);
    }
    fadeInTrack();
    startTimer();
  }

  let ytWait = null;
  let ytWanted = "";
  let ytSwitching = false;
  let ytRetry = 0;
  let ytToken = 0;

  function ytPlayingId() {
    try {
      const d = state.yt && state.yt.getVideoData && state.yt.getVideoData();
      return (d && (d.video_id || d.videoId)) || "";
    } catch {
      return "";
    }
  }

  function ytEvents() {
    return {
      onReady: (e) => {
        try {
          e.target.setVolume(state.volume);
          if (ytWanted && !npActive) {
            const startSec = ytSeekReset > 0 ? ytSeekReset : 0;
            e.target.loadVideoById(ytWanted, startSec);
            if (startSec > 0) ytSeekReset = 0;
            e.target.playVideo();
          }
        } catch {}
        if (typeof ytReadyResolve === "function") {
          const done = ytReadyResolve;
          ytReadyResolve = null;
          done(state.yt);
        }
      },
      onStateChange: (e) => {
        const curTrack = current();
        if (npActive || (curTrack && curTrack._playingViaAudio)) return;
        const st = e && e.data;
        if (st === YT.PlayerState.PLAYING) {
          ytSwitching = false;
          ytRetry = 0;
          failSkip = 0;
          state.playing = true;
          setWantPlay(true);
          applyYtQuality();
          startTimer();
          updateMediaSession();
          renderChrome();
          return;
        }
        if (st === YT.PlayerState.BUFFERING) {
          ytSwitching = false;
          return;
        }
        if (st === YT.PlayerState.PAUSED) {
          if (ytSwitching) return;
          if (wantPlay && state.prefs.bgPlay !== false && document.hidden) {
            try { state.yt.playVideo(); } catch {}
            return;
          }
          // Any other pause is a real stop — reflect it on the play/pause icon
          // immediately, even if wantPlay is still true (the old `if (!wantPlay)`
          // gate left a stale "pause" icon when the video stopped for another
          // reason). togglePlay() idempotently re-renders, so no flicker.
          if (state.playing) {
            state.playing = false;
            updateMediaSession();
            renderChrome();
          }
          return;
        }
        if (st === YT.PlayerState.ENDED) {
          if (ytSwitching) return;
          const cur = current();
          const playing = ytPlayingId();
          if (!cur || !cur.videoId) return;
          if (playing && playing !== cur.videoId) return;
          next(false);
        }
      },
      onError: (e) => {
        const curTrack = current();
        if (npActive || (curTrack && curTrack._playingViaAudio)) return;
        onYouTubeError(e && e.data);
      },
    };
  }

  function createYT(initialId) {
    if (typeof YT === "undefined" || !YT.Player) return null;
    const host = $("ytPlayer");
    if (!host) return null;
    const hasHttpOrigin = Boolean(location.origin && /^https?:\/\//i.test(location.origin));
    const playerVars = {
      autoplay: 1,
      controls: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      enablejsapi: 1,
      fs: 1,
      vq: ytQualityVq(),
    };
    if (hasHttpOrigin) {
      playerVars.origin = location.origin;
    }
    const opts = {
      width: "360",
      height: "202",
      playerVars,
      events: ytEvents(),
    };
    if (initialId) opts.videoId = String(initialId);
    return new YT.Player("ytPlayer", opts);
  }

  let ytReadyResolve = null;
  function ensureYT(initialId) {
    if (state.yt) return Promise.resolve(state.yt);
    if (ytWait) return ytWait;
    let rejectP;
    let readyTimer = null;
    ytWait = new Promise((resolve, reject) => {
      ytReadyResolve = (player) => {
        if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
        resolve(player);
      };
      rejectP = (err) => {
        if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
        reject(err);
      };
    });
    readyTimer = setTimeout(() => {
      if (!state.yt || ytReadyResolve) {
        const rej = rejectP;
        ytWait = null;
        ytReadyResolve = null;
        rejectP = null;
        if (rej) rej(new Error("YouTube player ready timeout"));
      }
    }, 6500);
    const start = () => {
      if (state.yt) {
        if (typeof ytReadyResolve === "function") ytReadyResolve(state.yt);
        return;
      }
      try {
        state.yt = createYT(initialId || ytWanted);
      } catch (e) {
        ytWait = null;
        ytReadyResolve = null;
        if (rejectP) rejectP(e);
        return;
      }
      if (!state.yt) {
        ytWait = null;
        ytReadyResolve = null;
        if (rejectP) rejectP(new Error("YouTube player missing"));
      }
    };
    if (typeof YT !== "undefined" && YT.Player) {
      start();
    } else {
      let n = 0;
      const wait = setInterval(() => {
        n += 1;
        if (typeof YT !== "undefined" && YT.Player) {
          clearInterval(wait);
          start();
        } else if (n > 160) {
          clearInterval(wait);
          ytWait = null;
          ytReadyResolve = null;
          if (rejectP) rejectP(new Error("YouTube player API not loaded"));
        }
      }, 50);
    }
    return ytWait;
  }

  // Pre-warm the YouTube IFrame player on Web during idle time after boot so the
  // very first song click plays in 0ms without waiting for iframe initialization.
  if (!IS_NATIVE && typeof window !== "undefined") {
    setTimeout(() => {
      if (!state.yt && !ytWait && !npActive) {
        ensureYT("").catch(() => {});
      }
    }, 500);
  }

  function onYouTubeError(code) {
    const want = ytWanted;
    const cur = current();
    if (!want || !cur || String(cur.videoId || "") !== String(want)) return;
    if (code === 100 || code === 101 || code === 150) {
      recoverYouTubeAlt(cur);
      return;
    }
    if (ytRetry < 2) {
      ytRetry += 1;
      setTimeout(() => retryYouTube(want, ytToken), 180 * ytRetry);
    } else {
      recoverYouTubeAlt(cur);
    }
  }

  async function recoverYouTubeAlt(t) {
    if (!t || current() !== t) return;
    if (!(t._blockedVideoIds instanceof Set)) t._blockedVideoIds = new Set();
    const blockedVid = t.videoId ? String(t.videoId) : "";
    if (blockedVid) t._blockedVideoIds.add(blockedVid);

    // 0. Instant path: if background warm stream already resolved direct audio for this track, play it in 0ms!
    const warmEntry = blockedVid ? warmStreamMap.get(blockedVid) : null;
    if ((t.streamUrl && !t._isPreviewStream) || (warmEntry && warmEntry.data && warmEntry.data.url)) {
      if (!t.streamUrl && warmEntry && warmEntry.data && warmEntry.data.url) {
        t.streamUrl = warmEntry.data.url;
      }
      if (current() === t && await playFallbackAudioForTrack(t)) return;
    }

    // 1. Try already-fetched candidate videoIds first (zero network wait, no ping-pong loop)
    if (Array.isArray(t._ytCandidates) && t._blockedVideoIds.size <= 3) {
      const nextCand = t._ytCandidates.find((vid) => vid && !t._blockedVideoIds.has(String(vid)));
      if (nextCand && current() === t) {
        t.videoId = nextCand;
        ytRetry = 0;
        try {
          await playYouTube(t);
          return;
        } catch {}
      }
    }

    // 2. Race direct audio stream resolution with embeddable lyric/audio upload search
    if (current() === t) {
      const okAudio = await playFallbackAudioForTrack(t);
      if (okAudio || current() !== t) return;
    }

    if (t._blockedVideoIds.size <= 3 && current() === t) {
      const queries = buildTrackPlayQueries(t);
      const baseQ = queries[3] || queries[2] || `${t.title || ""} ${t.artist || ""}`.trim();
      const altQ = `${baseQ} lyrics audio`.trim();
      if (altQ) {
        try {
          const data = await api(`/api/youtube/search?q=${encodeURIComponent(altQ)}&fast=1&${glq()}`, 4000);
          const rows = (data && data.tracks) || (data && data.results) || [];
          const hit = rows.find((x) => x && x.videoId && !t._blockedVideoIds.has(String(x.videoId)));
          if (hit && current() === t) {
            t.videoId = hit.videoId;
            ytRetry = 0;
            await playYouTube(t);
            return;
          }
        } catch {}
      }
    }
  }

  function retryYouTube(id, token) {
    if (token !== ytToken || ytWanted !== id) return;
    const cur = current();
    if (!cur || String(cur.videoId || "") !== String(id) || !state.yt) return;
    try {
      if (ytRetry >= 2 && state.yt.cueVideoById) {
        state.yt.cueVideoById(id);
        setTimeout(() => {
          if (token !== ytToken) return;
          try { state.yt.playVideo(); } catch {}
        }, 100);
      } else {
        state.yt.loadVideoById(id);
      }
    } catch {}
  }

  function kickYouTube(id) {
    const player = state.yt;
    if (!player) return;
    try {
      const startSec = ytSeekReset > 0 ? ytSeekReset : 0;
      if (typeof player.loadVideoById === "function") player.loadVideoById(id, startSec);
      if (startSec > 0) ytSeekReset = 0;
    } catch {}
    try { player.playVideo(); } catch {}
    try { player.setVolume(state.volume); } catch {}
    if (player.setPlaybackRate) {
      try { player.setPlaybackRate(Number(state.prefs.speed || 1)); } catch {}
    }
    applyYtQuality();
  }

  let ytWatchdogTimer = 0;
  function scheduleYtWatchdog(t, id, token) {
    if (ytWatchdogTimer) clearTimeout(ytWatchdogTimer);
    ytWatchdogTimer = setTimeout(() => {
      if (token !== ytToken || current() !== t || !wantPlay || t._playingViaAudio) return;
      const st = (state.yt && typeof state.yt.getPlayerState === "function") ? state.yt.getPlayerState() : -1;
      // If YouTube iframe is stuck in UNSTARTED (-1) or CUED (5) after async resolution:
      if (st === -1 || st === 5) {
        try { if (state.yt && state.yt.playVideo) state.yt.playVideo(); } catch {}
        ytWatchdogTimer = setTimeout(() => {
          if (token !== ytToken || current() !== t || !wantPlay || t._playingViaAudio) return;
          const st2 = (state.yt && typeof state.yt.getPlayerState === "function") ? state.yt.getPlayerState() : -1;
          if (st2 === -1 || st2 === 5) {
            playFallbackAudioForTrack(t);
          }
        }, 1100);
      }
    }, 2000);
  }

  async function playYouTube(t) {
    if (!t || !t.videoId) throw new Error("No video");
    const id = String(t.videoId);
    t._playingViaAudio = false;
    ytToken += 1;
    const token = ytToken;
    ytWanted = id;
    ytSwitching = true;
    ytRetry = 0;
    stopOthers("yt");
    // Warm the direct audio stream in parallel so if this YouTube video is VEVO/embed-gated
    // or blocked from autoplaying, fallback audio starts in 0ms.
    if (!IS_NATIVE && !t.streamUrl) {
      getWarmStream(id, t.title || "", artistName(t) || t.artist || "", t._ytCandidates || [], 5000, true).catch(() => {});
    }
    if (state.prefs.autoVideo || state.showVideo) {
      state.showVideo = true;
      showEl($("ytWrap"), true);
    }
    if (state.yt && typeof state.yt.loadVideoById === "function") {
      if (ytPlayingId() === id) {
        try { state.yt.playVideo(); } catch {}
        startTimer();
        scheduleYtWatchdog(t, id, token);
        return;
      }
      kickYouTube(id);
      startTimer();
      scheduleYtWatchdog(t, id, token);
      return;
    }
    const player = await ensureYT(id);
    if (token !== ytToken) return;
    if (!player) throw new Error("YouTube player missing");
    kickYouTube(id);
    startTimer();
    scheduleYtWatchdog(t, id, token);
  }

  function setQueueOpen(open) {
    state.showQueue = !!open;
    showEl($("queuePanel"), open);
    if ($("queuePanel")) $("queuePanel").classList.toggle("open", !!open);
    showEl($("scrim"), open || ($("sidebar") && $("sidebar").classList.contains("open")));
    if (open) {
      navPush();
      renderQueue();
      loadQueueRecs();
    } else {
      // Rewriting the entry that navPush() added on open is mandatory:
      // leaving a stale "queue: true" entry in the stack means a later
      // back navigation (e.g. closing Lyrics) restores that entry and
      // re-opens the Queue on its own.
      navReplace();
    }
    syncPlayerVisibility();
  }

  let lastPlayGlyph = "play_arrow";
  function swapPlayGlyph(el, glyph) {
    if (!el) return;
    const changed = el.textContent !== glyph;
    if (changed) {
      el.textContent = glyph;
      el.classList.remove("icon-swap");
      void el.offsetWidth;
      el.classList.add("icon-swap");
    }
    lastPlayGlyph = glyph;
  }

  function togglePlay() {
    hapticFeedback("medium");
    const t = current();
    if (!t) {
      if (state.recents[0]) playFromList(state.recents, 0);
      else testPlay();
      return;
    }
    // If the current track is an unresolved catalog track (e.g. Deezer/iTunes) that hasn't loaded a stream yet, resolve & play it
    if (!t.videoId && !t.streamUrl && !t.url && t.source !== "audius" && t.source !== "radio") {
      setWantPlay(true);
      playCurrent(true);
      return;
    }
    const isYt = (t.source === "youtube" || !!t.videoId) && !t._playingViaAudio && state.yt && typeof state.yt.getPlayerState === "function";
    if (isYt) {
      const s = state.yt.getPlayerState();
      if (s === 1 || s === 3) {
        setWantPlay(false);
        try { state.yt.pauseVideo(); } catch {}
        state.playing = false;
      } else if (s === 2) {
        setWantPlay(true);
        try { state.yt.playVideo(); } catch {}
        state.playing = true;
      } else {
        setWantPlay(true);
        playCurrent(true);
        return;
      }
    } else if (npActive && nativePlayer()) {
      if (state.playing) {
        setWantPlay(false);
        nativePausePlayback();
        state.playing = false;
      } else {
        setWantPlay(true);
        nativeResumePlayback();
        state.playing = true;
      }
    } else if (IS_NATIVE && nativePlayer() && !npActive && (t._playingViaAudio || !audio.src)) {
      if (npPos > 0) {
        _pendingSeek = npPos;
        _pendingSeekApplied = false;
      }
      setWantPlay(true);
      playCurrent(false);
      return;
    } else if (audio.paused) {
      if (!audio.src || audio.networkState === HTMLMediaElement.NETWORK_EMPTY) {
        setWantPlay(true);
        playCurrent(false);
        return;
      }
      setWantPlay(true);
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch((err) => {
          if (err && (err.name === "AbortError" || String(err.message || "").includes("interrupted"))) return;
          playCurrent(false);
        });
      }
      state.playing = true;
    } else {
      setWantPlay(false);
      try { audio.pause(); } catch {}
      state.playing = false;
    }
    if (state.playing && !state.timer) startTimer();
    updateMediaSession();
    renderChrome();
    const pb = $("playBtn");
    if (pb) triggerFabRipple(pb);
    if (state.playing && !cheapPhone() && !IS_NATIVE) burstHearts(pb);
  }

  async function next(force) {
    if (force !== true) hapticFeedback("light");
    if (!state.queue.length) return;
    if (!force && state.sleep.mode === "track") {
      pauseForSleep();
      return;
    }
    if (!force && state.prefs.autoplay === false) {
      state.playing = false;
      renderChrome();
      return;
    }
    if (state.repeat === "one" && !force) return playCurrent(true);

    const cur = current();
    const curArtist = cur ? canonicalPrimaryArtistClient(cur) : "";
    const curVibe = cur ? inferTrackVibeClient(cur) : null;

    if (state.shuffle) {
      // Smart Spotify-like shuffle: never pick the current song, avoid songs already
      // visited in this shuffle cycle, avoid back-to-back same artist when possible,
      // and prefer smooth vibe/tempo continuation.
      let candidates = [];
      for (let i = 0; i < state.queue.length; i++) {
        const cand = state.queue[i];
        if (!cand || i === state.index || (cur && isSameSongClient(cand, cur))) continue;
        const k = canonicalSongKey(cand);
        if (!_shuffleVisitedKeys.has(k)) candidates.push({ idx: i, track: cand, key: k });
      }
      if (!candidates.length && state.repeat !== "all" && cur && cur.source !== "radio") {
        const refilled = await ensureQueueRefill(cur);
        if (refilled) {
          for (let i = 0; i < state.queue.length; i++) {
            const cand = state.queue[i];
            if (!cand || i === state.index || (cur && isSameSongClient(cand, cur))) continue;
            const k = canonicalSongKey(cand);
            if (!_shuffleVisitedKeys.has(k)) candidates.push({ idx: i, track: cand, key: k });
          }
        }
      }
      if (!candidates.length) {
        _shuffleVisitedKeys.clear();
        if (cur) _shuffleVisitedKeys.add(canonicalSongKey(cur));
        for (let i = 0; i < state.queue.length; i++) {
          const cand = state.queue[i];
          if (!cand || i === state.index || (cur && isSameSongClient(cand, cur))) continue;
          candidates.push({ idx: i, track: cand, key: canonicalSongKey(cand) });
        }
      }
      if (candidates.length) {
        const diffArtist = candidates.filter((c) => canonicalPrimaryArtistClient(c.track) !== curArtist);
        const pool = diffArtist.length ? diffArtist : candidates;
        // Weight toward smooth vibe/tempo continuation while keeping natural shuffle variety
        const scoredPool = pool.map((c) => {
          const v = inferTrackVibeClient(c.track);
          let w = 10 + Math.random() * 12;
          if (curVibe) {
            if (v.cluster === curVibe.cluster) w += 10;
            else if (areClustersCompatibleClient(curVibe.cluster, v.cluster)) w += 5;
            if (areTemposSmoothClient(curVibe.tempo, v.tempo) >= 1) w += 6;
          }
          return { ...c, w };
        });
        scoredPool.sort((a, b) => b.w - a.w);
        const topPickCount = Math.min(3, scoredPool.length);
        const chosen = scoredPool[Math.floor(Math.random() * topPickCount)];
        state.index = chosen.idx;
        _shuffleVisitedKeys.add(chosen.key);
        playCurrent(true);
        return;
      }
    }

    // Sequential mode: skip any accidental consecutive duplicate of the current song
    while (state.index + 1 < state.queue.length && cur && isSameSongClient(state.queue[state.index + 1], cur)) {
      state.queue.splice(state.index + 1, 1);
    }

    if (state.index + 1 < state.queue.length) {
      state.index += 1;
      playCurrent(true);
      return;
    }

    if (state.repeat === "all") {
      if (state.queue.length > 1 && cur && isSameSongClient(state.queue[0], cur)) {
        state.index = 1;
      } else {
        state.index = 0;
      }
      playCurrent(true);
      return;
    }

    // End of queue reached: seamlessly continue the current song's vibe, genre, mood, tempo & style
    const refilled = await ensureQueueRefill(cur);
    if (refilled && state.index + 1 < state.queue.length) {
      state.index += 1;
      playCurrent(true);
      return;
    }
    state.playing = false;
    renderChrome();
  }

  function prev() {
    hapticFeedback("light");
    const pos = position();
    if (pos > 3) return seekTo(0);
    state.index = (state.index - 1 + state.queue.length) % state.queue.length;
    playCurrent(true);
  }

  function parseStreamUrlDuration(u) {
    if (!u || typeof u !== "string") return 0;
    try {
      let target = u;
      if (target.includes("url=")) {
        const m = target.match(/[?&]url=([^&]+)/);
        if (m && m[1]) target = decodeURIComponent(m[1]);
      }
      const dm = target.match(/[?&]dur=([0-9]+(?:\.[0-9]+)?)/);
      if (dm && dm[1]) {
        const sec = Math.round( parseFloat(dm[1]) );
        if (sec > 0 && isFinite(sec)) return sec;
      }
    } catch {}
    return 0;
  }

  function position() {
    const t = current();
    if (!t) return 0;
    if (npActive) {
      if (state.playing && npPlaying && npPosAt > 0 && Date.now() >= npSeekGuardUntil) {
        const rate = Number(state.prefs.speed || 1) || 1;
        const rawElapsed = ((performance.now() - npPosAt) / 1000) * rate;
        const elapsed = Math.max(0, Math.min(300.0, rawElapsed));
        const basePos = npPos || 0;
        if (basePos > 0 || npSeenPlaying || rawElapsed > 0.5) {
          const est = basePos + elapsed;
          const d = npDur || t.duration || parseStreamUrlDuration(t.streamUrl || t.url || "") || 0;
          return d > 0 ? Math.min(d, est) : est;
        }
      }
      return npPos || 0;
    }
    const isUsingAudioEl = Boolean(t._playingViaAudio || (audio.src && audio.src.startsWith("blob:")));
    if ((t.source === "youtube" || !!t.videoId) && !isUsingAudioEl && state.yt && typeof state.yt.getCurrentTime === "function") {
      return state.yt.getCurrentTime() || 0;
    }
    if (_webSeekTarget >= 0 && audio.readyState < 1) {
      return _webSeekTarget;
    }
    return audio.currentTime || 0;
  }

  function duration() {
    const t = current();
    if (!t) return 0;
    if (t.source === "radio") return 0;
    if (npActive) {
      const d = npDur || t.duration || parseStreamUrlDuration(t.streamUrl || t.url || "") || 0;
      if (d > 0 && !t.duration) t.duration = d;
      return d;
    }
    const isUsingAudioEl = Boolean(t._playingViaAudio || (audio.src && audio.src.startsWith("blob:")));
    if ((t.source === "youtube" || !!t.videoId) && !isUsingAudioEl && state.yt && typeof state.yt.getDuration === "function") {
      const d = state.yt.getDuration() || t.duration || 0;
      if (d > 0 && !t.duration) t.duration = Math.round(d);
      return d;
    }
    if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
      if (!t.duration) t.duration = Math.round(audio.duration);
      return audio.duration;
    }
    const saved = findSavedTrack(t);
    const fallbackDur = t.duration || (saved && saved.duration) || parseStreamUrlDuration(t.streamUrl || t.url || "") || 0;
    if (fallbackDur > 0 && !t.duration) t.duration = fallbackDur;
    return fallbackDur;
  }

  function seekTo(sec) {
    const t = current();
    if (!t || t.source === "radio") return;
    const d = duration();
    const at = d > 0 ? Math.max(0, Math.min(Number(sec) || 0, Math.max(0, d - 0.05))) : Math.max(0, Number(sec) || 0);
    seekCur = -1;
    seekTgt = -1;
    if (seekRaf) {
      cancelAnimationFrame(seekRaf);
      seekRaf = 0;
    }
    if (npActive && nativeSeekTo(at)) {
      updateProgress();
      highlightLyric(at, true);
      return;
    }
    const isUsingAudioEl = Boolean(t._playingViaAudio || (audio.src && audio.src.startsWith("blob:")));
    if ((t.source === "youtube" || !!t.videoId) && !isUsingAudioEl && state.yt && typeof state.yt.seekTo === "function") {
      state.yt.seekTo(at, true);
    } else {
      _webSeekTarget = at;
      try {
        audio.currentTime = at;
        if (audio.readyState >= 1 && Math.abs((audio.currentTime || 0) - at) < 1.5) {
          _webSeekTarget = -1;
        }
      } catch {}
    }
    updateProgress();
    highlightLyric(at, true);
  }

  let waveRaf = 0;
  let waveLast = 0;
  let isSeekingUi = false;
  function cheapPhone() {
    return IS_NATIVE || !!(window.matchMedia && (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 980px)").matches));
  }
  function restartWaveLoop() {
    if (!state.playing || waveRaf || document.hidden) return;
    // On phones/native shells or in Battery Saver, updateProgress() drives
    // drawSeekWave() directly so we never hold a rAF loop open during playback.
    if (cheapPhone() || isBatterySaver()) {
      drawSeekWave();
      return;
    }
    const interval = 80;
    const loop = (now) => {
      if (!state.playing || isBatterySaver()) {
        waveRaf = 0;
        drawSeekWave();
        return;
      }
      if (document.hidden) {
        waveRaf = 0;
        return;
      }
      if (!waveLast || now - waveLast > interval) {
        drawSeekWave();
        waveLast = now;
      }
      waveRaf = requestAnimationFrame(loop);
    };
    waveRaf = requestAnimationFrame(loop);
  }
  function startTimer() {
    stopTimer();
    const pollMs = isBatterySaver() ? 1000 : 250;
    state.timer = setInterval(updateProgress, pollMs);
    restartWaveLoop();
    updateProgress();
    renderChrome();
  }
  function stopTimer() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    if (waveRaf) cancelAnimationFrame(waveRaf);
    waveRaf = 0;
    if (seekRaf) cancelAnimationFrame(seekRaf);
    seekRaf = 0;
  }

  function updateProgress() {
    if (state.sleep && state.sleep.mode === "mins" && state.sleep.until > 0 && Date.now() >= state.sleep.until) {
      pauseForSleep();
      return;
    }
    // When screen is off and native service owns playback, skip redundant JS polling
    if (document.hidden && npActive) return;
    if (npActive && !document.hidden) {
      const sinceLastSync = performance.now() - (npPosAt || 0);
      if (sinceLastSync > 900) {
        const NP = nativePlayer();
        if (NP && typeof NP.getStatus === "function" && !NP._statusPollInFlight) {
          NP._statusPollInFlight = true;
          NP.getStatus().then((st) => {
            if (st && typeof window._onMuchiNativeProgress === "function") {
              window._onMuchiNativeProgress(st);
            }
          }).catch(() => {}).finally(() => {
            NP._statusPollInFlight = false;
          });
        }
      }
    }
    const d = duration();
    const p = position();
    tickCrossfade(d, p);
    if (!document.hidden) {
      updateMediaPosition();
      msPosTick = (msPosTick || 0) + 1;
      if (msPosTick % 5 === 0) updateMediaSession();
      if (state.sleep && state.sleep.mode === "mins" && state.sleep.until > 0) {
        const sm = $("sleepModalStatus");
        if (sm) sm.textContent = sleepStatusLabel();
        const sl = $("sleepListeningStatus");
        if (sl) sl.textContent = sleepStatusLabel();
        if ($("sleepBtn")) $("sleepBtn").title = `Sleep · ${sleepLabel()}`;
      }
    }

    // Adaptive buffering health check
    checkBufferResume();

    // Proactive queue refill: replenish queue with related tracks when approaching end of queue
    if (state.playing && p > 8 && state.prefs.autoplay !== false && (state.queue.length - 1 - state.index <= 1)) {
      const nowRefill = Date.now();
      if (!state._lastRefillAttemptAt || nowRefill - state._lastRefillAttemptAt > 15000) {
        state._lastRefillAttemptAt = nowRefill;
        ensureQueueRefill();
      }
    }
    // Audio playback optimization: pre-resolve next track stream via Cloudflare backend & native preload for gapless playback
    if (state.playing && p > 6 && state.index + 1 < state.queue.length) {
      const nextT = state.queue[state.index + 1];
      if (nextT && (nextT.videoId || nextT.title) && !nextT.streamUrl && !nextT._resolving && nextT.source !== "audius" && nextT.source !== "radio") {
        const NP = nativePlayer();
        if (IS_NATIVE && NP && typeof NP.preload === "function" && !nextT._nativePreloaded) {
          nextT._nativePreloaded = true;
          const cands = Array.isArray(nextT._ytCandidates) ? nextT._ytCandidates.slice(0, 5).join(",") : "";
          NP.preload({
            videoId: String(nextT.videoId || ""),
            candidates: cands,
            title: String(nextT.title || ""),
            artist: String(artistName(nextT) || nextT.artist || ""),
          }).catch(() => {});
        }
        nextT._resolving = true;
        getWarmStream(nextT.videoId || "", nextT.title || "", artistName(nextT) || nextT.artist || "", nextT._ytCandidates || [], 8000, false).then((res) => {
          if (res && res.url && !res.isPreview) {
            const fullUrl = res.url.startsWith("/") ? API_BASE + res.url : res.url;
            nextT.streamUrl = fullUrl;
            nextT._isPreviewStream = false;
            if (res.videoId && !nextT.videoId) nextT.videoId = res.videoId;
            if (res.duration && !nextT.duration) nextT.duration = Number(res.duration);
            if (!IS_NATIVE && !nextT._prefetched) {
              nextT._prefetched = true;
              fetch(fullUrl, { headers: { Range: "bytes=0-131071" } }).catch(() => {});
            }
          }
        }).catch(() => {}).finally(() => { nextT._resolving = false; });
      } else if (nextT && nextT.source === "audius" && nextT.trackId && !nextT.streamUrl) {
        nextT.streamUrl = `${API_BASE}/api/audius/file/${encodeURIComponent(nextT.trackId)}`;
        if (!nextT._prefetched) {
          nextT._prefetched = true;
          fetch(nextT.streamUrl, { headers: { Range: "bytes=0-65535" } }).catch(() => {});
        }
      } else if (nextT && !nextT.videoId && !nextT.streamUrl && !nextT._resolving && (nextT.source === "apple" || nextT.source === "deezer" || nextT.source === "itunes")) {
        nextT._resolving = true;
        resolveYouTubePlay(nextT).then(() => {
          const NP = nativePlayer();
          if (IS_NATIVE && NP && typeof NP.preload === "function" && nextT.videoId && !nextT._nativePreloaded) {
            nextT._nativePreloaded = true;
            const cands = Array.isArray(nextT._ytCandidates) ? nextT._ytCandidates.slice(0, 5).join(",") : "";
            NP.preload({
              videoId: String(nextT.videoId),
              candidates: cands,
              title: String(nextT.title || ""),
              artist: String(artistName(nextT) || nextT.artist || ""),
            }).catch(() => {});
          }
        }).catch(() => {}).finally(() => { nextT._resolving = false; });
      }
    }

    if (document.hidden) return;
    const seek = $("seek");
    const activeScrub = Boolean(isSeekingUi);
    if (!activeScrub && $("curTime")) {
      $("curTime").textContent = fmt(p);
    }
    if ($("durTime")) {
      $("durTime").textContent = current() && current().source === "radio" ? "LIVE" : fmt(d);
    }
    if (seek) {
      const tv = d > 0 ? Math.max(0, Math.min(1000, Math.round((p / d) * 1000))) : 0;
      if (activeScrub) {
        seekCur = -1; seekTgt = -1;
        if (seekRaf) { cancelAnimationFrame(seekRaf); seekRaf = 0; }
      } else if (cheapPhone() || prefersReducedMotion() || isBatterySaver()) {
        seek.value = tv;
      } else {
        seekTgt = tv;
        if (seekCur < 0) seekCur = Number(seek.value) || 0;
        if (!seekRaf) seekRaf = requestAnimationFrame(seekTick);
      }
    }
    drawSeekWave();
    highlightLyric(p);
  }
  let msPosTick = 0;

  let seekCur = -1, seekTgt = -1, seekRaf = 0;
  function seekTick() {
    const seek = $("seek");
    if (!seek || isSeekingUi || seekTgt < 0) { seekRaf = 0; return; }
    const diff = seekTgt - seekCur;
    if (Math.abs(diff) < 0.25) {
      seek.value = seekTgt;
      seekCur = -1; seekTgt = -1; seekRaf = 0;
      drawSeekWave();
      return;
    }
    seekCur += diff * 0.28;
    seek.value = Math.round(seekCur);
    drawSeekWave();
    seekRaf = requestAnimationFrame(seekTick);
  }
  function prefersReducedMotion() {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function sampleSeekWiggleY(wiggle, x, t, amp, mid, span) {
    const s = Math.max(1, Number(span) || 400);
    const norm = Math.max(0, Math.min(1, x / s));
    const taper = s > 6 ? Math.pow(Math.sin(Math.PI * norm), 0.55) : 0;
    if (wiggle === "ribbon") {
      // Harmonic Ribbon: silky multi-layered acoustic wave with gentle swell
      const swell = 0.78 + 0.22 * Math.sin(x / 36 - t * 0.65);
      const wave = Math.sin(x / 18 + t * 1.15) * 0.74 + Math.sin(x / 9.5 - t * 0.8) * 0.26;
      return mid + wave * (amp * 1.08) * swell * taper;
    }
    if (wiggle === "glow") {
      // Laser Glow: sleek studio laser beam with subtle breathing shimmer
      const shimmer = Math.sin(x / 24 + t * 0.9) * 0.36 + Math.cos(x / 14 - t * 0.55) * 0.14;
      return mid + shimmer * amp * taper;
    }
    if (wiggle === "orbit") {
      // Dual Helix: braided phase-modulated wave with harmonic depth
      return mid + Math.sin(x / 14 + t * 1.2) * Math.cos(x / 28 - t * 0.82) * (amp * 1.18) * taper;
    }
    // Default "sine": Smooth Sine
    return mid + (Math.sin(x / 16 + t) + Math.sin(x / 7.5 + t * 1.35) * 0.24) * amp * taper;
  }

  function drawSeekWave() {
    const svg = $("seekWave");
    const seek = $("seek");
    if (!svg || !seek) return;
    const playing = !!state.playing;
    const style = normalizePlayerStyle(document.documentElement.dataset.player);
    const wiggle = normalizeSeekWiggle(document.documentElement.dataset.wiggle || state.prefs.seekWiggle);
    const strong = style === "wave" || style === "pill" || style === "aura";
    const v = Math.max(0, Math.min(1000, Number(seek.value) || 0));
    seek.style.setProperty("--seek-pct", `${(v / 10).toFixed(1)}%`);
    const t = Date.now() / 240;
    const W = 400, mid = 8;
    const amp = !playing ? 0.38 : strong ? 4.2 : 3.1;
    const step = 4;
    const filled = (v / 1000) * W;
    let dBg = `M 0 ${mid}`;
    let dFg = `M 0 ${mid}`;
    for (let x = 0; x <= W; x += step) {
      const bgTaper = Math.pow(Math.sin(Math.PI * (x / W)), 0.5);
      let yBg = mid;
      if (wiggle === "orbit") {
        yBg = mid - Math.sin(x / 14 + t * 1.2) * (amp * 0.42) * bgTaper;
      } else if (wiggle === "ribbon") {
        yBg = mid - Math.sin(x / 18 + t * 1.15) * (amp * 0.32) * bgTaper;
      } else if (wiggle === "glow") {
        yBg = mid + Math.sin(x / 24 + t * 0.9) * (amp * 0.14) * bgTaper;
      } else {
        yBg = mid + Math.sin(x / 16 + t) * (amp * 0.22) * bgTaper;
      }
      dBg += ` L ${x} ${yBg.toFixed(2)}`;
      if (x <= filled) {
        const yFg = sampleSeekWiggleY(wiggle, x, t, amp, mid, filled);
        dFg += ` L ${x} ${yFg.toFixed(2)}`;
      }
    }
    if (filled > 0) {
      dFg += ` L ${filled.toFixed(1)} ${mid.toFixed(2)}`;
    }
    let bgPath = svg.querySelector("path.seek-wave-bg");
    let fgPath = svg.querySelector("path.seek-wave-fg");
    if (!bgPath || !fgPath) {
      svg.innerHTML = "";
      bgPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      bgPath.setAttribute("class", "seek-wave-bg");
      bgPath.setAttribute("fill", "none");
      bgPath.setAttribute("stroke-linecap", "round");
      bgPath.setAttribute("stroke-linejoin", "round");
      fgPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      fgPath.setAttribute("class", "seek-wave-fg");
      fgPath.setAttribute("fill", "none");
      fgPath.setAttribute("stroke-linecap", "round");
      fgPath.setAttribute("stroke-linejoin", "round");
      svg.appendChild(bgPath);
      svg.appendChild(fgPath);
    }
    bgPath.setAttribute("stroke-linejoin", "round");
    fgPath.setAttribute("stroke-linejoin", "round");
    bgPath.setAttribute("d", dBg);
    bgPath.setAttribute("stroke-width", (wiggle === "orbit" || wiggle === "ribbon") ? "1.65" : "1.45");
    fgPath.setAttribute("d", v > 0 ? dFg : `M 0 ${mid} L 0.1 ${mid}`);
    const fgWidth = playing ? (wiggle === "glow" ? (strong ? "3.0" : "2.5") : (strong ? "2.6" : "2.2")) : "1.8";
    fgPath.setAttribute("stroke-width", fgWidth);
  }

  function setVolume(v) {
    state.volume = v;
    save("aura.vol", v);
    const vol = v / 100;
    audio.volume = volumeFor(v, state.prefs.normalize);
    if (state.yt && state.yt.setVolume) {
      try { state.yt.setVolume(Math.min(100, Math.round(v))); } catch {}
      try { if (state.yt.unMute) state.yt.unMute(); } catch {}
    }
    hookSound();
    nativeSyncAudioPrefs();
    syncAndroid();
  }

  let wantPlay = false;
  // Cross-reload resume: pending seek (seconds) for the last song, plus a YT
  // start offset applied the first time the restored video loads.
  let _pendingSeek = 0;
  let _pendingSeekApplied = false;
  let ytSeekReset = 0;
  let _resumeTrackId = null;
  function setWantPlay(on) {
    wantPlay = !!on;
    try {
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = wantPlay ? "playing" : "paused";
    } catch {}
  }

  function absArt(t) {
    const src = artUrl(t);
    try { return new URL(src, location.href).href; } catch { return src; }
  }

  function msHandler(name, fn) {
    try { navigator.mediaSession.setActionHandler(name, fn); } catch {}
  }

  function updateMediaPosition() {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    const t = current();
    if (!t || t.source === "radio") return;
    const d = Number(duration()) || 0;
    const p = Number(position()) || 0;
    if (!d || !isFinite(d)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: d,
        playbackRate: Number(state.prefs.speed || 1) || 1,
        position: Math.max(0, Math.min(p, d)),
      });
    } catch {}
  }

  function updateMediaSession() {
    const t = current();
    if (!("mediaSession" in navigator)) return;
    if (!t) {
      try { navigator.mediaSession.metadata = null; } catch {}
      return;
    }
    const art = absArt(t);
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title || "Muchi",
        artist: t.artist || "",
        album: t.album || "Muchi",
        artwork: [
          { src: art, sizes: "96x96", type: "image/png" },
          { src: art, sizes: "256x256", type: "image/png" },
          { src: art, sizes: "512x512", type: "image/png" },
        ],
      });
    } catch {}
    try { navigator.mediaSession.playbackState = wantPlay || state.playing ? "playing" : "paused"; } catch {}
    msHandler("play", () => {
      setWantPlay(true);
      if (!state.playing) togglePlay();
    });
    msHandler("pause", () => {
      setWantPlay(false);
      if (state.playing) togglePlay();
    });
    msHandler("stop", () => {
      setWantPlay(false);
      if (state.playing) togglePlay();
    });
    msHandler("previoustrack", () => prev());
    msHandler("nexttrack", () => next(true));
    msHandler("seekbackward", (e) => seekTo(Math.max(0, position() - (e && e.seekOffset ? e.seekOffset : 10))));
    msHandler("seekforward", (e) => seekTo(position() + (e && e.seekOffset ? e.seekOffset : 10)));
    msHandler("seekto", (e) => {
      if (e && typeof e.seekTime === "number") seekTo(e.seekTime);
    });
    updateMediaPosition();
    if (IS_NATIVE && !npActive) {
      nativeSyncSession();
    }
  }

  function syncAndroid() {
    try {
      if (!window.MuchiAndroid || !MuchiAndroid.playback) return;
      const t = current();
      MuchiAndroid.playback(
        t ? String(t.title || "Muchi") : "Muchi",
        t ? String(t.artist || "") : "",
        !!(wantPlay || state.playing),
        t ? absArt(t) : ""
      );
    } catch {}
  }

  let nativeAppInBackground = false;
  function keepBackgroundPlay() {
    if (state.prefs.bgPlay === false || !wantPlay) return;
    const t = current();
    if (!t) return;
    if (npActive) {
      if (!npPlaying && Date.now() >= npCmdUntil) nativeResumePlayback();
      return;
    }
    if (IS_NATIVE && nativePlayer() && (document.hidden || nativeAppInBackground) && t.source !== "radio") {
      const resumeSec = Math.max(0, Number(position()) || 0);
      try { if (state.yt && state.yt.pauseVideo) state.yt.pauseVideo(); } catch {}
      try { audio.pause(); } catch {}
      const cands = Array.isArray(t._ytCandidates) ? t._ytCandidates.slice(0, 5).join(",") : "";
      const handoffUrl = (t.streamUrl && !t.streamUrl.startsWith("yt:") && !t._isPreviewStream)
        ? (t.streamUrl.startsWith("/") ? API_BASE + t.streamUrl : t.streamUrl)
        : `yt:${t.videoId || ""}`;
      t._playingViaAudio = true;
      if (nativePlayTrack(handoffUrl, t.title, artistName(t) || t.artist, artUrl(t), t.duration || 0, t.videoId || "", cands, resumeSec)) {
        return;
      }
    }
    if (!document.hidden && !nativeAppInBackground) unlockSound();
    if ((t.videoId || t.source === "youtube") && !t._playingViaAudio) {
      if (IS_NATIVE) nativeSyncSession();
      if (!state.yt || !state.yt.getPlayerState) return;
      let s = -1;
      try { s = state.yt.getPlayerState(); } catch {}
      if (s === 2 || s === -1 || s === 5) {
        try { state.yt.playVideo(); } catch {}
      }
    } else if (audio.paused && audio.src && !audio.ended) {
      if (IS_NATIVE) nativeSyncSession();
      audio.play().catch(() => {});
    }
    updateMediaSession();
  }

  /* ── Native (Capacitor) bridge ────────────────────────────────────────
     Runs only inside the Android/iOS shells. Mirrors playback state to
     the OS media session (lock screen / notification / Control Center),
     forwards media-button & headset events back into the app's own
     playback functions (single source of truth — no second player),
     styles the status bar, handles the hardware back button and adds
     native sharing + offline-download notifications.
     No Google Sign-In here: auth can be layered on later. */
  function nativePlugins() {
    if (!IS_NATIVE || !window.Capacitor || !window.Capacitor.Plugins) return null;
    return window.Capacitor.Plugins;
  }

  /* ── Haptics feedback (Capacitor Haptics plugin with web vibration fallback) ── */
  function hapticFeedback(style = "light") {
    try {
      const H = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) ||
                (window.CapacitorCustomPlatform && window.CapacitorCustomPlatform.plugins && window.CapacitorCustomPlatform.plugins.Haptics);
      if (H) {
        if (style === "heavy" && typeof H.impact === "function") {
          H.impact({ style: "HEAVY" }).catch(() => {});
        } else if (style === "medium" && typeof H.impact === "function") {
          H.impact({ style: "MEDIUM" }).catch(() => {});
        } else if (style === "selection" && typeof H.selectionChanged === "function") {
          H.selectionChanged().catch(() => {});
        } else if (typeof H.impact === "function") {
          H.impact({ style: "LIGHT" }).catch(() => {});
        }
      } else if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        const ms = style === "heavy" ? 28 : style === "medium" ? 18 : style === "selection" ? 8 : 12;
        navigator.vibrate(ms);
      }
    } catch {}
  }
  /* ── Optional native background player (Android + iOS) ───────────────
     The native shells ship a MuchiAudio plugin: on Android a foreground media
     service (ExoPlayer + MediaSessionCompat notification/controls), on iOS an AVPlayer
     with AVAudioSession + now-playing/lock-screen controls. It renders
     audio + the OS media notification and echoes play/pause/next/prev/
     seek/ended/error back into this app's own playback functions.
     nativePlayer() returns it on Android/iOS (null on the web, where every
     track plays through the WebView <audio> element below). The plugin is
     picked up automatically here — no other web changes. */
  let npActive = false;   // native player is the current audio sink
  let npPlaying = false;  // last known native playback state
  let npPos = 0;          // last known position (s)
  let npPosAt = 0;        // performance.now() timestamp of last npPos update
  let npDur = 0;          // last known duration (s)
  let npSeenPlaying = false; // true once ExoPlayer/AVPlayer has transitioned to playing for the current track
  let npInitPos = 0;      // initial start position requested for the current track
  let npTrackStartedAt = 0; // timestamp when nativePlayTrack was invoked for the current track
  let npCmdUntil = 0;     // guard window after JS play/pause/resume command so stale progress ticks don't flip UI
  let npSeekGuardUntil = 0; // guard window after JS seek command so stale pre-seek ticks don't snap slider back
  let npPermAsked = false; // one-time native notification permission ask
  function nativeEnsureNotifyPermission() {
    const NP = nativePlayer();
    if (!NP) {
      webEnsurePermissions();
      return;
    }
    if (typeof NP.requestNotificationPermission === "function") {
      NP.requestNotificationPermission().catch(() => {});
      return;
    }
    if (typeof NP.checkPermissions === "function") {
      NP.checkPermissions()
        .then((st) => {
          if (!st || (st.notifications !== "granted" && st.muchi_audio !== "granted")) {
            if (typeof NP.requestPermissions === "function") {
              NP.requestPermissions({ permissions: ["notifications", "muchi_audio"] }).catch(() => {
                NP.requestPermissions().catch(() => {});
              });
            }
          }
        })
        .catch(() => {
          if (typeof NP.requestPermissions === "function") {
            NP.requestPermissions().catch(() => {});
          }
        });
    } else if (typeof NP.requestPermissions === "function") {
      NP.requestPermissions().catch(() => {});
    }
  }
  function nativePlayer() {
    if (!IS_NATIVE || !window.Capacitor || !window.Capacitor.Plugins) return null;
    try {
      const p = window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : "";
      if (p !== "android" && p !== "ios") return null;
      return window.Capacitor.Plugins.MuchiAudio || null;
    } catch { return null; }
  }
  function npAction(action, extra) {
    const o = { action };
    if (extra) Object.assign(o, extra);
    const P = nativePlayer();
    if (P && P.emit) { try { P.emit(o); } catch {} }
  }
  function nativeSyncAudioPrefs() {
    const NP = nativePlayer();
    if (!NP || typeof NP.setAudioPrefs !== "function") return;
    try {
      NP.setAudioPrefs({
        volume: Number(state.volume ?? 100),
        normalize: Boolean(state.prefs.normalize),
        speed: Number(state.prefs.speed || 1),
        spatial: String(spatialMode() || "phone"),
      }).catch(() => {});
    } catch {}
  }
  function nativeSyncSession() {
    if (!IS_NATIVE || npActive) return;
    const NP = nativePlayer();
    const t = current();
    if (!NP || !t || typeof NP.syncSession !== "function") return;
    if (!wantPlay && !state.playing) return;
    try {
      nativeEnsureNotifyPermission();
      NP.syncSession({
        title: String(t.title || "Muchi"),
        artist: String(artistName(t) || t.artist || ""),
        artwork: String(absArt(t) || ""),
        duration: Math.round((Number(duration()) || Number(t.duration) || 0) * 1000),
        position: Math.round((Number(position()) || 0) * 1000),
        playing: Boolean(wantPlay || state.playing),
      }).catch(() => {});
    } catch {}
  }
  function nativePlayTrack(url, title, artist, artwork, durationSec, videoId = "", candidates = "", startPosSec = 0) {
    const NP = nativePlayer();
    if (!NP) return false;
    nativeEnsureNotifyPermission();
    const resolvedDur = Number(durationSec) || parseStreamUrlDuration(url) || 0;
    const initPos = Math.max(0, Number(startPosSec) || ((!_pendingSeekApplied && Number(_pendingSeek) > 0) ? Number(_pendingSeek) : 0));
    if (initPos > 0) {
      _pendingSeek = 0;
      _pendingSeekApplied = true;
    }
    npActive = true;
    npPlaying = true;
    npSeenPlaying = false;
    npInitPos = initPos;
    npTrackStartedAt = Date.now();
    npPos = initPos;
    npPosAt = performance.now();
    npDur = resolvedDur;
    npCmdUntil = Date.now() + 4500;
    npSeekGuardUntil = initPos > 0 ? Date.now() + 2500 : 0;
    NP.play({
      url: String(url),
      videoId: String(videoId || ""),
      candidates: String(candidates || ""),
      title: String(title || "Muchi"),
      artist: String(artist || ""),
      artwork: String(artwork || ""),
      duration: Math.round(resolvedDur * 1000),
      position: Math.round(initPos * 1000),
      volume: Number(state.volume ?? 100),
      normalize: Boolean(state.prefs.normalize),
      speed: Number(state.prefs.speed || 1),
      spatial: String(spatialMode() || "phone"),
    }).catch(() => {
      // Native playback failed — fall back to the WebView audio element or YouTube player.
      if (npActive) npActive = false;
      if (!/^yt:/i.test(String(url))) {
        playAudioWeb(url);
      } else {
        const cur = current();
        if (cur && cur.videoId) playYouTube(cur).catch(() => {});
      }
    });
    return true;
  }
  function nativePausePlayback() {
    const NP = nativePlayer();
    if (!NP || !npActive) return;
    npPlaying = false;
    npPosAt = 0;
    npCmdUntil = Date.now() + 1500;
    NP.pause().catch(() => {});
  }
  function nativeResumePlayback() {
    const NP = nativePlayer();
    if (!NP || !npActive) return;
    npPlaying = true;
    npPosAt = performance.now();
    npCmdUntil = Date.now() + 1500;
    NP.resume().catch(() => {});
  }
  function nativeStopPlayback() {
    const NP = nativePlayer();
    if (!NP || !npActive) return;
    npActive = false;
    npPlaying = false;
    npSeenPlaying = false;
    npPos = 0;
    npPosAt = 0;
    NP.stop().catch(() => {});
  }
  function nativeSeekTo(sec) {
    const NP = nativePlayer();
    if (!NP || !npActive) return false;
    npPos = Math.max(0, Number(sec) || 0);
    npInitPos = npPos;
    npPosAt = performance.now();
    npSeekGuardUntil = Date.now() + 2500;
    npCmdUntil = Math.max(npCmdUntil, Date.now() + 2500);
    NP.seekTo({ position: Math.round(npPos * 1000) }).catch(() => {});
    return true;
  }
  // (v1.5.4) The legacy MusicControls fallback paths (nativeSyncMediaControls
  // / nativeTickControls) are gone: that plugin's own killer service
  // (stopWithTask) and its second MediaSession were what made playback die on
  // swipe and fight the Media3 session for the notification slot. The native
  // MuchiAudioService now owns the OS media surface unconditionally — including
  // the notification's transport buttons — and P0 made its stream resolver
  // reliable enough to be the real sink for every track.
  function nativeHandleControls(action) {
    if (!action) return;
    const msg = action.message || action.action || action;
    if (msg === "music-controls-play" || msg === "play") {
      if (npActive) {
        npPlaying = true;
        npSeenPlaying = true;
        npPosAt = performance.now();
        npCmdUntil = Date.now() + 1200;
      } else {
        const cur = current();
        if (cur && (cur.source === "youtube" || !!cur.videoId) && !cur._playingViaAudio && state.yt && state.yt.playVideo) {
          try { state.yt.playVideo(); } catch {}
        } else if (audio.src) {
          audio.play().catch(() => {});
        }
      }
      setWantPlay(true);
      state.playing = true;
      showEl($("eqBars"), true);
      if (!state.timer) startTimer();
      updateMediaSession();
      renderChrome();
    } else if (msg === "music-controls-pause" || msg === "pause" || msg === "music-controls-headset-unplugged") {
      if (npActive) {
        npPlaying = false;
        npPosAt = 0;
        npCmdUntil = Date.now() + 1200;
      } else {
        const cur = current();
        if (cur && (cur.source === "youtube" || !!cur.videoId) && !cur._playingViaAudio && state.yt && state.yt.pauseVideo) {
          try { state.yt.pauseVideo(); } catch {}
        } else {
          try { audio.pause(); } catch {}
        }
      }
      setWantPlay(false);
      state.playing = false;
      showEl($("eqBars"), false);
      updateMediaSession();
      renderChrome();
    } else if (msg === "music-controls-destroy" || msg === "stop") {
      npActive = false;
      npPlaying = false;
      npSeenPlaying = false;
      npPosAt = 0;
      setWantPlay(false);
      state.playing = false;
      showEl($("eqBars"), false);
      stopTimer();
      updateMediaSession();
      renderChrome();
    } else if (msg === "music-controls-next" || msg === "next") {
      next(true);
    } else if (msg === "music-controls-previous" || msg === "previous" || msg === "prev") {
      prev();
    } else if (msg === "music-controls-toggle-play-pause") {
      togglePlay();
    } else if (msg === "music-controls-seek-to" || msg === "music-controls-skip-to" || msg === "seek") {
      const raw = Number(action.position != null ? action.position : action.seekTo);
      if (isFinite(raw)) {
        const sec = raw > 10000 ? raw / 1000 : raw;
        seekTo(sec);
      }
    } else if (msg === "ended") {
      next(false);
    } else if (msg === "error") {
      const rawErrPos = Number(action.position != null ? action.position : 0);
      const errPosSec = rawErrPos > 1000 ? rawErrPos / 1000 : rawErrPos;
      const cur = current();
      const savedPos = npSeenPlaying ? Math.max(errPosSec || 0, npPos || 0, _pendingSeek || 0) : 0;
      if (savedPos > 0 && cur) {
        _pendingSeek = savedPos;
        _pendingSeekApplied = false;
        _resumeTrackId = trackKey(cur) || String(cur.id || "");
      }
      if (npActive) { npActive = false; npPlaying = false; npSeenPlaying = false; }
      if ((state.playing || wantPlay) && cur) {
        state.playing = true;
        setWantPlay(true);
        if (!cur._nativeRefreshTried && (cur.videoId || cur.title)) {
          cur._nativeRefreshTried = true;
          cur.streamUrl = "";
          const candParam = Array.isArray(cur._ytCandidates) && cur._ytCandidates.length
            ? `&candidates=${encodeURIComponent(cur._ytCandidates.slice(0, 5).join(","))}`
            : "";
          const exclParam = cur.videoId ? `&exclude=${encodeURIComponent(cur.videoId)}` : "";
          api(`/api/yt/stream?v=${encodeURIComponent(cur.videoId || "")}&title=${encodeURIComponent(cur.title || "")}&artist=${encodeURIComponent(artistName(cur) || cur.artist || "")}${candParam}${exclParam}&allowPreview=0&refresh=1`, 10000)
            .then((fresh) => {
              if (current() !== cur) return;
              if (fresh && fresh.url && !fresh.isPreview) {
                cur.streamUrl = fresh.url.startsWith("/") ? API_BASE + fresh.url : fresh.url;
                cur._isPreviewStream = false;
                if (fresh.videoId) cur.videoId = fresh.videoId;
                if (fresh.duration && !cur.duration) cur.duration = Number(fresh.duration);
                cur._playingViaAudio = true;
                return playAudio(cur);
              }
              throw new Error("no fresh stream");
            })
            .catch(() => {
              if (current() !== cur) return;
              nativeHandleControls({ message: "error", position: Math.round(savedPos * 1000) });
            });
          return;
        }
        if ((!cur._nativeOnDeviceTried || (cur.videoId && cur._nativeOnDeviceVid !== String(cur.videoId))) && cur.videoId && nativePlayer()) {
          cur._nativeOnDeviceTried = true;
          cur._nativeOnDeviceVid = String(cur.videoId);
          cur.streamUrl = `yt:${cur.videoId}`;
          cur._isPreviewStream = false;
          cur._playingViaAudio = true;
          playAudio(cur).catch(() => {
            if (current() !== cur) return;
            nativeHandleControls({ message: "error", position: Math.round(savedPos * 1000) });
          });
          return;
        }
        if (!cur._nativeFallbackTried) {
          cur._nativeFallbackTried = true;
          cur.streamUrl = "";
          playFallbackAudioForTrack(cur, true).then((ok) => {
            if (ok) return;
            if (current() === cur) nativeHandleControls({ message: "error", position: Math.round(savedPos * 1000) });
          }).catch(() => {
            if (current() === cur) nativeHandleControls({ message: "error", position: Math.round(savedPos * 1000) });
          });
          return;
        }
        if (!cur._nativeYtFallbackTried && cur.videoId && !document.hidden) {
          cur._nativeYtFallbackTried = true;
          cur._playingViaAudio = false;
          if (savedPos > 1) ytSeekReset = Math.floor(savedPos);
          playYouTube(cur).catch(() => {
            if (current() !== cur) return;
            skipFailed("Playback error");
          });
          return;
        }
        skipFailed("Playback error");
      }
    }
  }
  function nativeNotifySaved(title) {
    const P = nativePlugins();
    const LN = P && P.LocalNotifications;
    if (!LN) return;
    LN.requestPermissions().then((perm) => {
      if (!perm || perm.display !== "granted") return;
      LN.schedule({
        notifications: [{
          id: Math.floor(Date.now() / 1000) % 2147483647,
          title: "Saved for offline",
          body: String(title || "Track"),
          smallIcon: "ic_stat_muchi",
          iconColor: "#4cc9f0",
        }],
      }).catch(() => {});
    }).catch(() => {});
  }
  function shareTrack(track) {
    const P = nativePlugins();
    const SH = P && P.Share;
    if (!SH || !track) return;
    SH.share({
      title: String(track.title || "Muchi"),
      text: `${track.title || ""} — ${artistName(track) || track.artist || ""}`,
      dialogTitle: "Share song",
    }).catch(() => {});
  }
  function initNativeBridge() {
    const P = nativePlugins();
    if (!P) return;
    const SB = P.StatusBar;
    if (SB) {
      try {
        SB.setStyle({ style: "LIGHT" });
        SB.setBackgroundColor({ color: "#101413" });
        SB.setOverlaysWebView({ overlay: false });
      } catch {}
    }
    const App = P.App;
    if (App) {
      try {
        App.addListener("appUrlOpen", (e) => {
          const u = String((e && e.url) || "");
          if (u.indexOf("muchi://") === 0) handleAuthDeepLink(u);
        });
      } catch {}
      try {
        App.addListener("backButton", () => {
          const modal = $("modal");
          if (modal && modal.classList.contains("show")) { hideModal(); return; }
          if (state.showQueue) { setQueueOpen(false); return; }
          if (state.showVideo) { state.showVideo = false; showEl($("ytWrap"), false); return; }
          if (!goBackInApp() && window.Capacitor.getPlatform() === "android") App.minimizeApp();
        });
      } catch {}
      try {
        App.addListener("appStateChange", (st) => {
          const active = Boolean(st && st.isActive);
          nativeAppInBackground = !active;
          if (!active && wantPlay && state.prefs.bgPlay !== false) {
            keepBackgroundPlay();
            setTimeout(keepBackgroundPlay, 150);
            setTimeout(keepBackgroundPlay, 500);
          }
        });
      } catch {}
    }
    // (v1.5.4) MusicControls listener removed — the plugin is no longer
    // used (its killer service + duplicate MediaSession fought the native
    // MuchiAudioService; see nativeSyncMediaControls comment above). iOS
    // Control Center / lock-screen commands are handled natively by
    // MuchiAudioPlugin.swift's MPRemoteCommandCenter, Android's by the
    // media session inside MuchiAudioService — both echo through
    // muchiControls below, so the web layer stays the single queue owner.
    const NP = P.MuchiAudio;
    function handleNativeProgressUpdate(e) {
      if (state.sleep && state.sleep.mode === "mins" && state.sleep.until > 0 && Date.now() >= state.sleep.until) {
        pauseForSleep();
        return;
      }
      if (!npActive) return;
      const v = e || {};
      const now = Date.now();
      const rawPos = v.positionMs != null ? (Number(v.positionMs) || 0) / 1000 : (Number(v.position) || 0);
      const rawDur = v.durationMs != null ? (Number(v.durationMs) || 0) / 1000 : (Number(v.duration) || 0);
      // Guard against any stale progress tick (>2.0s) arriving from a previous song right after starting a track from 0:00
      const isDifferentTrackDur = rawDur > 0 && npDur > 0 && Math.abs(rawDur - npDur) > 2;
      const isStaleStartJump = !npSeenPlaying && npInitPos === 0 && rawPos > 2.0 && (!v.playing || isDifferentTrackDur);
      if (!isStaleStartJump) {
        if (now < npSeekGuardUntil) {
          if (Math.abs(rawPos - npPos) <= 4.0) {
            npSeekGuardUntil = 0;
            npPos = Math.max(0, rawPos);
            npPosAt = performance.now();
          }
        } else {
          npPos = Math.max(0, rawPos);
          npPosAt = performance.now();
        }
      }
      if (rawDur > 0 && !isStaleStartJump) {
        npDur = rawDur;
        const cur = current();
        if (cur && (!cur.duration || Math.abs(cur.duration - rawDur) > 2)) {
          cur.duration = Math.round(rawDur);
        }
      }
      const isPl = !!v.playing;
      if (isPl) {
        if (!isStaleStartJump) npSeenPlaying = true;
        npPlaying = true;
        renderBufferState(false);
        if (!state.playing && now >= npCmdUntil) {
          state.playing = true;
          setWantPlay(true);
          showEl($("eqBars"), true);
          renderChrome();
        }
        if (!state.timer) startTimer();
      } else {
        if ((document.hidden || nativeAppInBackground) && wantPlay && state.prefs.bgPlay !== false) {
          if (now >= npCmdUntil) {
            nativeResumePlayback();
          }
        } else if (now >= npCmdUntil && npSeenPlaying) {
          npPlaying = false;
          npPosAt = 0;
          if (state.playing) {
            state.playing = false;
            setWantPlay(false);
            showEl($("eqBars"), false);
            renderChrome();
          }
        }
      }
      const lastProgObj = NP || window;
      if (!isBatterySaver() || !lastProgObj._lastUiProgAt || (now - lastProgObj._lastUiProgAt >= 900)) {
        lastProgObj._lastUiProgAt = now;
        updateProgress();
      }
    }
    window._onMuchiNativeProgress = handleNativeProgressUpdate;
    window._onMuchiNativeControls = (e) => {
      const now = Date.now();
      const msg = (e && (e.message || e.action)) || "";
      if (window._lastMuchiCtrlMsg === msg && now - (window._lastMuchiCtrlAt || 0) < 80) return;
      window._lastMuchiCtrlMsg = msg;
      window._lastMuchiCtrlAt = now;
      nativeHandleControls(e || {});
    };
    if (NP) {
      try {
        NP.addListener("muchiControls", (e) => window._onMuchiNativeControls(e || {}));
        NP.addListener("muchiProgress", (e) => handleNativeProgressUpdate(e || {}));
      } catch {}
    }
    const DL = P.MuchiDownload;
    if (DL && DL.addListener) {
      try {
        DL.addListener("progress", (e) => {
          const job = (state.dlQueue || []).find((d) => d.id === (e && e.id));
          if (job) {
            job.bytes = Number(e.bytes) || 0;
            job.total = Number(e.total) || 0;
            job.progress = Number(e.progress) || 0;
            saveDlJob(job);
          }
        });
        DL.addListener("done", (e) => {
          const job = (state.dlQueue || []).find((d) => d.id === (e && e.id));
          if (job) { job.status = "done"; job.progress = 1; saveDlJob(job); }
        });
        DL.addListener("error", (e) => {
          const job = (state.dlQueue || []).find((d) => d.id === (e && e.id));
          if (job) { job.status = "error"; saveDlJob(job); }
        });
      } catch {}
    }

    // Immediately request Notification and appropriate Storage permissions on app start
    try {
      nativeEnsureNotifyPermission();
      nativeEnsureStoragePermission();
    } catch {}
  }
  initNativeBridge();
  if (!IS_NATIVE) {
    try { webEnsurePermissions(); } catch {}
  }

  /* ── Google Sign-In + YouTube Library (additive) ─────────────────────
     OAuth runs server-side (server.js): Google handles authentication,
     MUCHI never sees the user's password. The server returns a session
     token — on the web it's an httpOnly cookie; in the native app it
     arrives via the muchi:// deep link and is stored in localStorage,
     then sent as `Authorization: Bearer` on API calls. */
  function getAuthToken() {
    try { return localStorage.getItem("muchi.token") || ""; } catch { return ""; }
  }
  function setAuthToken(t) {
    try { if (t) localStorage.setItem("muchi.token", t); else localStorage.removeItem("muchi.token"); } catch {}
  }
  function authHeaders() {
    const t = getAuthToken();
    return t ? { Authorization: "Bearer " + t } : {};
  }
  async function refreshAuth(silent) {
    try {
      const d = await api("/api/auth/status");
      if (d && d.configured === false && !silent) state.auth = { configured: false, signedIn: false, youtube: { connected: false } };
      else state.auth = d;
    } catch {
      if (!silent) state.auth = null;
    }
  }
  function openAuthUrl(url) {
    if (IS_NATIVE) {
      try { window.open(url, "_system"); } catch { window.location.href = url; }
    } else {
      window.location.href = url;
    }
  }
  async function startGoogleSignIn() {
    if (!state.auth) {
      try { await refreshAuth(true); } catch {}
    }
    if (!state.auth || state.auth.configured === false) { toast("Google Sign-In isn't configured on the server yet"); return; }
    try {
      const d = await api(`/api/auth/google/url?platform=${IS_NATIVE ? "native" : "web"}`);
      if (d && d.url) openAuthUrl(d.url);
    } catch { toast("Couldn't start Google Sign-In"); }
  }
  async function connectYouTube() {
    if (!state.auth || !state.auth.signedIn) { toast("Sign in with Google first"); return; }
    try {
      const d = await api(`/api/auth/youtube/url?platform=${IS_NATIVE ? "native" : "web"}`);
      if (d && d.url) openAuthUrl(d.url);
    } catch { toast("Couldn't start YouTube authorization"); }
  }
  async function signOutGoogle() {
    try { await api("/api/auth/signout", 10000, { method: "POST" }); } catch {}
    setAuthToken("");
    state.auth = null;
    state.ytLiked = null;
    state.ytPlaylists = null;
    state.ytOpen = null;
    toast("Signed out of Google");
    if (state.view === "settings" || state.view === "library") render();
  }
  async function disconnectYouTube() {
    try { await api("/api/auth/youtube/disconnect", 10000, { method: "POST" }); } catch {}
    state.ytLiked = null;
    state.ytPlaylists = null;
    state.ytOpen = null;
    if (state.auth) state.auth = Object.assign({}, state.auth, { youtube: { connected: false } });
    toast("YouTube disconnected");
    if (state.view === "settings" || state.view === "library") render();
  }
  async function loadYtLiked(force) {
    if (!state.auth || !state.auth.youtube || !state.auth.youtube.connected) return;
    if (!force && state.ytLiked) return;
    if (state.ytBusy) return;
    state.ytBusy = true;
    // NOTE: no render() here — rendering synchronously re-enters
    // renderLibrary(), which calls loadYtLiked() again before the fetch
    // resolves (infinite recursion). The UI already shows a "Loading"
    // placeholder while state.ytLiked is null.
    try {
      const d = await api("/api/youtube/liked" + (force ? "?refresh=1" : ""));
      state.ytLiked = { tracks: (d && Array.isArray(d.tracks)) ? d.tracks : [], truncated: !!(d && d.truncated) };
      state.ytReconnect = false;
    } catch (err) {
      state.ytLiked = { tracks: [], error: true };
      if (String((err && err.message) || "").indexOf("youtube") >= 0) state.ytReconnect = true;
    }
    state.ytBusy = false;
    if (state.view === "library") render();
  }
  async function loadYtPlaylists(force) {
    if (!state.auth || !state.auth.youtube || !state.auth.youtube.connected) return;
    if (!force && state.ytPlaylists) return;
    try {
      const d = await api("/api/youtube/playlists" + (force ? "?refresh=1" : ""));
      state.ytPlaylists = (d && Array.isArray(d.playlists)) ? d.playlists : [];
      state.ytReconnect = false;
    } catch (err) {
      state.ytPlaylists = { error: true };
      if (String((err && err.message) || "").indexOf("youtube") >= 0) state.ytReconnect = true;
    }
    if (state.view === "library") render();
  }
  function ytConnected() {
    return !!(state.auth && state.auth.signedIn && state.auth.youtube && state.auth.youtube.connected);
  }
  function isYtLiked(track) {
    if (!track || !state.ytLiked || !Array.isArray(state.ytLiked.tracks)) return false;
    const vid = String(track.videoId || "").trim();
    return state.ytLiked.tracks.some((t) => t && (t.id === track.id || (vid && t.videoId === vid)));
  }
  // Add the track to the connected user's YouTube Liked Videos. Only for
  // tracks that carry a real YouTube videoId (Audius/radio can't be liked on
  // YouTube). Re-authorization note: connectYouTube now grants a write scope.
  async function ytToggleLike(track) {
    if (!ytConnected()) { toast("Connect your YouTube account in Settings", true, "error"); return; }
    const videoId = String((track && track.videoId) || "").trim();
    if (!videoId) { toast("This song isn't a YouTube track", true, "error"); return; }
    try {
      await api("/api/youtube/like", 12000, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId }) });
      // Invalidate the cached liked list so the Library reflects the change.
      state.ytLiked = null;
      toast("Added to your YouTube Liked Videos", true, "success");
      if (state.view === "library") loadYtLiked(true);
    } catch (e) {
      if (String((e && e.message) || "").indexOf("youtube") >= 0) { state.ytReconnect = true; toast("YouTube access expired — reconnect in Settings", true, "error"); }
      else toast("Couldn't add to YouTube Liked", true, "error");
    }
  }
  // Remove/unlike a song from the connected user's YouTube Liked Videos.
  async function ytUnlikeTrack(track) {
    if (!ytConnected()) { toast("Connect your YouTube account in Settings", true, "error"); return; }
    const videoId = String((track && track.videoId) || (track && track.id && String(track.id).replace(/^ytlike:/, "")) || "").trim();
    if (!videoId) { toast("This song isn't a YouTube track", true, "error"); return; }
    try {
      await api("/api/youtube/unlike", 12000, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      if (state.ytLiked && Array.isArray(state.ytLiked.tracks)) {
        state.ytLiked.tracks = state.ytLiked.tracks.filter(
          (t) => t && t.id !== track.id && t.videoId !== videoId
        );
      }
      toast("Removed from YouTube Liked Videos", true, "success");
      if (state.view === "library") render();
      loadYtLiked(true);
    } catch (e) {
      if (String((e && e.message) || "").indexOf("youtube") >= 0) { state.ytReconnect = true; toast("YouTube access expired — reconnect in Settings", true, "error"); }
      else toast("Couldn't remove from YouTube Liked", true, "error");
    }
  }
  // Remove a song from one of the connected user's YouTube playlists.
  async function ytRemoveFromPlaylist(track, activePl) {
    if (!ytConnected()) { toast("Connect your YouTube account in Settings", true, "error"); return; }
    const plStr = String(activePl || state.activePlaylist || "");
    const playlistId = plStr.indexOf("yt-pl:") === 0
      ? plStr.slice("yt-pl:".length)
      : String((state.ytOpen && state.ytOpen.id) || "").trim();
    const videoId = String((track && track.videoId) || "").trim();
    const playlistItemId = String((track && track.playlistItemId) || "").trim();
    if (!playlistId || (!videoId && !playlistItemId)) {
      toast("Couldn't remove from YouTube playlist", true, "error");
      return;
    }
    try {
      await api("/api/youtube/playlist/remove", 12000, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId, videoId, playlistItemId }),
      });
      if (state.ytOpen && String(state.ytOpen.id) === String(playlistId) && Array.isArray(state.ytOpen.tracks)) {
        state.ytOpen.tracks = state.ytOpen.tracks.filter(
          (t) => t && (playlistItemId ? t.playlistItemId !== playlistItemId : (t.id !== track.id && t.videoId !== videoId))
        );
      }
      if (Array.isArray(state.ytPlaylists)) {
        const plMeta = state.ytPlaylists.find((p) => p && String(p.id) === String(playlistId));
        if (plMeta && typeof plMeta.count === "number" && plMeta.count > 0) {
          plMeta.count = Math.max(0, plMeta.count - 1);
        }
      }
      const plTitle = (state.ytOpen && state.ytOpen.title) || "YouTube playlist";
      toast(`Removed from ${plTitle}`, true, "success");
      if (state.view === "library") render();
      loadYtPlaylists(true);
    } catch (e) {
      if (String((e && e.message) || "").indexOf("youtube") >= 0) { state.ytReconnect = true; toast("YouTube access expired — reconnect in Settings", true, "error"); }
      else toast("Couldn't remove from YouTube playlist", true, "error");
    }
  }
  // Pick one of the user's YouTube playlists and add the track to it.
  async function ytAddToPlaylist(track) {
    if (!ytConnected()) { toast("Connect your YouTube account in Settings", true, "error"); return; }
    const videoId = String((track && track.videoId) || "").trim();
    if (!videoId) { toast("This song isn't a YouTube track", true, "error"); return; }
    if (!state.ytPlaylists || (state.ytPlaylists && state.ytPlaylists.error)) await loadYtPlaylists(true);
    const pls = Array.isArray(state.ytPlaylists) ? state.ytPlaylists.filter((p) => p && p.id) : [];
    if (!pls.length) { toast("No YouTube playlists found", true, "error"); return; }
    showModal({
      title: "Add to YouTube playlist",
      body: `<p>${escapeHTML(track.title)}</p>
        <div class="sheet-list">
          ${pls.map((p) => `<button type="button" class="sheet-item" data-ytadd="${escapeAttr(p.id)}">
            <img src="${escapeAttr(p.artwork || "/cover-default.jpg")}" alt="" onerror="this.src='/cover-default.jpg'"/>
            <span>${escapeHTML(p.title)}</span>
          </button>`).join("")}
        </div>`,
      ok: "Close",
      onOk: () => {},
    });
    $("modalCard").querySelectorAll("[data-ytadd]").forEach((b) => {
      b.addEventListener("click", async () => {
        const pid = b.dataset.ytadd;
        b.disabled = true;
        const ico = b.querySelector(".material-symbols-outlined");
        try {
          await api("/api/youtube/playlist/add", 12000, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId, playlistId: pid }) });
          if (ico) ico.textContent = "check";
          b.classList.add("ok");
          toast("Added to YouTube playlist", true, "success");
          const id = String(pid);
          if (state.ytOpen && state.ytOpen.id === id) state.ytOpen.tracks = null;
          setTimeout(() => hideModal(), 520);
        } catch (e) {
          if (String((e && e.message) || "").indexOf("youtube") >= 0) { state.ytReconnect = true; toast("YouTube access expired — reconnect in Settings", true, "error"); }
          else { toast("Couldn't add to playlist", true, "error"); b.disabled = false; if (ico) ico.textContent = "add"; }
        }
      });
    });
  }
  async function openYtPlaylist(id, title) {
    state.ytOpen = { id, title, tracks: null, loading: true };
    render();
    try {
      const d = await api(`/api/youtube/playlist?id=${encodeURIComponent(id)}`);
      state.ytOpen = { id, title, tracks: (d && d.tracks) || [], loading: false };
    } catch { state.ytOpen = { id, title, tracks: [], loading: false, error: true }; }
    render();
  }
  function playTrackList(list, idx) {
    if (!list || !list.length) return;
    state.queue = list.slice();
    state.index = Math.max(0, Math.min(idx, list.length - 1));
    state.shuffle = false;
    playCurrent(true);
    setView("now");
  }
  function handleAuthDeepLink(url) {
    try {
      const u = String(url || "");
      if (u.indexOf("muchi://") !== 0) return false;
      const rest = u.slice("muchi://".length);
      const qm = rest.indexOf("?");
      const pathname = (qm >= 0 ? rest.slice(0, qm) : rest).replace(/\/+$/, "");
      const params = new URLSearchParams(qm >= 0 ? rest.slice(qm + 1) : "");
      if (pathname === "auth/success") {
        const t = params.get("token") || "";
        if (t) {
          setAuthToken(t);
          refreshAuth(true).then(() => {
            toast("Signed in with Google");
            syncUserLibrary(true);
            if (state.auth && state.auth.youtube && state.auth.youtube.connected) {
              loadYtLiked(true);
              loadYtPlaylists(true);
            }
            if (state.view === "settings" || state.view === "library") render();
          });
        }
      } else if (pathname === "youtube/success") {
        const t = params.get("token") || "";
        if (t) setAuthToken(t);
        refreshAuth(true).then(() => {
          toast("YouTube connected");
          syncUserLibrary(true);
          loadYtLiked(true);
          loadYtPlaylists(true);
          if (state.view === "settings" || state.view === "library") render();
        });
      } else if (pathname === "auth/error" || pathname === "youtube/error") {
        toast("Google sign-in was cancelled or failed");
      }
      return true;
    } catch { return false; }
  }
  async function initAuth() {
    // Web & mobile: OAuth callbacks redirect back with token and status params
    let touched = false;
    try {
      const params = new URLSearchParams(window.location.search || "");
      const token = params.get("token");
      if (token) {
        setAuthToken(token);
        touched = true;
      }
      if (params.get("auth") === "success") { touched = true; toast("Signed in with Google"); }
      else if (params.get("youtube") === "success") { touched = true; toast("YouTube connected"); }
      else if (params.get("auth") === "error" || params.get("youtube") === "error") { touched = true; toast("Google sign-in was cancelled or failed"); }
      if (touched) history.replaceState(null, "", window.location.pathname + window.location.hash);
    } catch {}
    // Retry a few times: the first /api/auth/status call can race the
    // Worker's cold start, so give it a couple of attempts.
    for (let i = 0; i < 4; i++) {
      await refreshAuth(true);
      if (state.auth && state.auth.configured !== undefined) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (touched && state.auth && !state.auth.signedIn) {
      toast("Sign-in didn't stick — your server may have restarted. Please try again.");
    }
    if (state.auth && state.auth.signedIn) {
      syncUserLibrary();
      if (state.auth.youtube && state.auth.youtube.connected) {
        loadYtLiked(true);
        loadYtPlaylists(true);
      }
    }
    if (state.view === "settings" || state.view === "library") render();
  }

  let lyricsGen = 0;
  let lyFollow = true;
  let lyProg = false;
  let lyResumeT = 0;
  let lyActive = -1;

  function lyricsKey(t) {
    return t ? (t.id || `${t.title}|${t.artist}`) : "";
  }

  function synthesizeSyncedLyrics(plainText, durSec) {
    const raw = String(plainText || "").trim();
    if (!raw) return [];
    const rawLines = raw.split(/\r?\n/);
    const entries = [];
    let pendingStanzaBreak = false;
    for (const rl of rawLines) {
      const s = rl.trim();
      if (!s) {
        if (entries.length > 0) pendingStanzaBreak = true;
        continue;
      }
      if (/^\[(verse|chorus|bridge|intro|outro|pre-chorus|hook|instrumental|refrain|post-chorus).*?\]$/i.test(s)) {
        if (entries.length > 0) pendingStanzaBreak = true;
        continue;
      }
      const words = s.split(/\s+/).filter(Boolean).length;
      const chars = s.length;
      const weight = Math.max(1.15, Math.min(4.2, 0.7 + words * 0.26 + chars * 0.014));
      const pauseBefore = pendingStanzaBreak ? 0.95 : 0;
      pendingStanzaBreak = false;
      entries.push({ text: s, weight, pauseBefore });
    }
    if (!entries.length) return [];
    const totalDur = Math.max(30, Number(durSec) || Number(duration()) || 180);
    const startPad = Math.min(7.5, Math.max(2.8, totalDur * 0.048));
    const endPad = Math.min(9.0, Math.max(4.0, totalDur * 0.06));
    const usableSpan = Math.max(12, totalDur - startPad - endPad);
    const totalWeight = entries.reduce((acc, e) => acc + e.weight + e.pauseBefore, 0) || 1;
    const secPerUnit = usableSpan / totalWeight;
    let cursor = startPad;
    return entries.map((e) => {
      cursor += e.pauseBefore * secPerUnit;
      const lineTime = Number(cursor.toFixed(2));
      cursor += e.weight * secPerUnit;
      return { t: lineTime, text: e.text };
    });
  }

  function formatSyncedLrc(synced, plainText = "", trackMeta = null) {
    const lines = [];
    if (trackMeta) {
      if (trackMeta.title) lines.push(`[ti:${String(trackMeta.title).replace(/[\r\n\]]/g, " ").trim()}]`);
      if (trackMeta.artist) lines.push(`[ar:${String(trackMeta.artist).replace(/[\r\n\]]/g, " ").trim()}]`);
      if (trackMeta.album) lines.push(`[al:${String(trackMeta.album).replace(/[\r\n\]]/g, " ").trim()}]`);
      if (trackMeta.duration) {
        const d = Math.max(0, Math.round(Number(trackMeta.duration) || 0));
        if (d > 0) {
          const dm = String(Math.floor(d / 60)).padStart(2, "0");
          const ds = String(d % 60).padStart(2, "0");
          lines.push(`[length:${dm}:${ds}]`);
        }
      }
    }
    if (Array.isArray(synced) && synced.length) {
      for (const row of synced) {
        if (!row) continue;
        const sec = Math.max(0, Number(row.t) || 0);
        const mm = String(Math.floor(sec / 60)).padStart(2, "0");
        const ss = (sec % 60).toFixed(2).padStart(5, "0");
        lines.push(`[${mm}:${ss}]${String(row.text || "").replace(/\r?\n/g, " ").trim()}`);
      }
      return lines.join("\n");
    }
    if (plainText) {
      if (lines.length) lines.push("");
      lines.push(String(plainText).trim());
      return lines.join("\n");
    }
    return "";
  }

  function parseLrcText(rawText) {
    const str = String(rawText || "").trim();
    if (!str) return null;
    const synced = [];
    const plainLines = [];
    let offsetSec = 0;
    for (const rawLine of str.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const offMatch = line.match(/^\[offset:\s*([+-]?\d+)\s*\]$/i);
      if (offMatch) {
        offsetSec = (Number(offMatch[1]) || 0) / 1000;
        continue;
      }
      if (/^\[(ti|ar|al|au|by|length|re|ve):/i.test(line)) continue;
      const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      if (tags.length > 0) {
        const text = line
          .replace(/\[\d+:\d+(?:\.\d+)?\]/g, "")
          .replace(/<\d+:\d+(?:\.\d+)?>/g, "")
          .replace(/\s{2,}/g, " ")
          .trim();
        for (const m of tags) {
          const t = Math.max(0, Number(m[1]) * 60 + Number(m[2]) - offsetSec);
          synced.push({ t: Number(t.toFixed(2)), text });
        }
        if (text) plainLines.push(text);
      } else {
        plainLines.push(line);
      }
    }
    synced.sort((a, b) => a.t - b.t);
    const lyrics = plainLines.join("\n").trim();
    if (!synced.length && !lyrics) return null;
    return { lyrics, synced };
  }

  function candidateLyricsKeys(t) {
    if (!t) return [];
    const meta = cleanLyricsMeta(t);
    const saved = findSavedTrack(t);
    const rawKeys = [
      lyricsKey(t),
      t.id || "",
      trackKey(t),
      canonicalSongKey(t),
      t.videoId ? `yt:${t.videoId}` : "",
      t.videoId || "",
      t.trackId ? `audius:${t.trackId}` : "",
      t.trackId || "",
      saved ? lyricsKey(saved) : "",
      saved ? saved.id || "" : "",
      saved ? trackKey(saved) : "",
      saved ? canonicalSongKey(saved) : "",
      saved && saved.videoId ? `yt:${saved.videoId}` : "",
      meta.cleanTitle ? `${meta.cleanTitle.toLowerCase()}|${(meta.cleanArtist || "").toLowerCase()}` : "",
      meta.coreTitle ? `${meta.coreTitle.toLowerCase()}|${(meta.cleanArtist || "").toLowerCase()}` : "",
    ];
    return rawKeys.filter((k, idx, arr) => k && arr.indexOf(k) === idx);
  }

  async function saveOfflineLyrics(t, data) {
    if (!t || !data || (!data.lyrics && (!Array.isArray(data.synced) || !data.synced.length))) return;
    const syncedArr = Array.isArray(data.synced) ? data.synced : [];
    const plainStr = String(data.lyrics || (syncedArr.length ? syncedArr.map((x) => x.text).filter(Boolean).join("\n") : ""));
    const lrcStr = String(data.lrc || formatSyncedLrc(syncedArr, plainStr, t));
    const payload = {
      lyrics: plainStr,
      synced: syncedArr,
      lrc: lrcStr,
      _synthesized: Boolean(data._synthesized),
      updatedAt: Date.now(),
    };
    const keys = candidateLyricsKeys(t);
    for (const k of keys) {
      try { await idbPut(`lyrics:${k}`, payload); } catch {}
    }
    // Also attach synced lyrics directly onto any stored IndexedDB audio record for this track
    const saved = findSavedTrack(t);
    const audioKeys = [
      t.id,
      trackKey(t),
      canonicalSongKey(t),
      t.videoId ? `yt:${t.videoId}` : "",
      t.videoId || "",
      t.trackId ? `audius:${t.trackId}` : "",
      t.trackId || "",
      saved ? saved.id : "",
      saved ? trackKey(saved) : "",
    ].filter((k, idx, arr) => k && arr.indexOf(k) === idx);
    for (const ak of audioKeys) {
      try {
        const existingAudioRec = await idbGet(ak);
        if (existingAudioRec && typeof existingAudioRec === "object" && !(existingAudioRec instanceof Blob) && (existingAudioRec.blob || existingAudioRec.handle || existingAudioRec.data)) {
          await idbPut(ak, {
            ...existingAudioRec,
            lyrics: payload.lyrics,
            synced: payload.synced,
            lrc: payload.lrc,
          });
        }
      } catch {}
    }
    if (saved) {
      saved.lyrics = payload.lyrics;
      saved.synced = payload.synced;
      saved.lrc = payload.lrc;
      saved.hasOfflineLyrics = true;
      save("aura.downloads", state.downloads);
    }
    t.lyrics = payload.lyrics;
    t.synced = payload.synced;
    t.lrc = payload.lrc;
  }

  async function getOfflineLyrics(t) {
    if (!t) return null;
    if (Array.isArray(t.synced) && t.synced.length) {
      return { lyrics: t.lyrics || "", synced: t.synced, lrc: t.lrc || "" };
    }
    if (t.lrc) {
      const parsedT = parseLrcText(t.lrc);
      if (parsedT && (parsedT.synced.length || parsedT.lyrics)) return { ...parsedT, lrc: t.lrc };
    }
    const saved = findSavedTrack(t);
    if (saved) {
      if ((Array.isArray(saved.synced) && saved.synced.length) || saved.lyrics) {
        return {
          lyrics: saved.lyrics || "",
          synced: Array.isArray(saved.synced) ? saved.synced : [],
          lrc: saved.lrc || "",
        };
      }
      if (saved.lrc) {
        const parsedSaved = parseLrcText(saved.lrc);
        if (parsedSaved && (parsedSaved.synced.length || parsedSaved.lyrics)) return { ...parsedSaved, lrc: saved.lrc };
      }
    }
    const keys = candidateLyricsKeys(t);
    for (const k of keys) {
      try {
        const rec = await idbGet(`lyrics:${k}`);
        if (rec) {
          if ((Array.isArray(rec.synced) && rec.synced.length) || rec.lyrics) {
            return {
              lyrics: rec.lyrics || "",
              synced: Array.isArray(rec.synced) ? rec.synced : [],
              lrc: rec.lrc || "",
              _synthesized: Boolean(rec._synthesized),
            };
          }
          if (rec.lrc) {
            const parsedRec = parseLrcText(rec.lrc);
            if (parsedRec) return { ...parsedRec, lrc: rec.lrc };
          }
        }
      } catch {}
    }
    // Also check the downloaded audio record in IndexedDB (which stores { blob, lyrics, synced, lrc } or embedded ID3/MP4 tags)
    for (const k of keys) {
      try {
        const audioRec = await idbGet(k);
        if (!audioRec) continue;
        if (typeof audioRec === "object" && !(audioRec instanceof Blob)) {
          if ((Array.isArray(audioRec.synced) && audioRec.synced.length) || audioRec.lyrics) {
            return {
              lyrics: audioRec.lyrics || "",
              synced: Array.isArray(audioRec.synced) ? audioRec.synced : [],
              lrc: audioRec.lrc || "",
            };
          }
          if (audioRec.lrc) {
            const parsedAudioLrc = parseLrcText(audioRec.lrc);
            if (parsedAudioLrc) return { ...parsedAudioLrc, lrc: audioRec.lrc };
          }
        }
        // Fallback: read embedded USLT / ©lyr metadata directly from the downloaded audio blob if present
        const blobObj = audioRec instanceof Blob ? audioRec : (audioRec && audioRec.blob instanceof Blob ? audioRec.blob : null);
        if (blobObj && window.MuchiMeta && typeof window.MuchiMeta.read === "function") {
          const u8 = new Uint8Array(await blobObj.arrayBuffer());
          const tags = window.MuchiMeta.read(u8);
          if (tags && tags.lyrics) {
            const parsedTag = parseLrcText(tags.lyrics);
            if (parsedTag && (parsedTag.synced.length || parsedTag.lyrics)) {
              return { ...parsedTag, lrc: tags.lyrics };
            }
          }
        }
      } catch {}
    }
    if (t.lyrics) {
      return { lyrics: t.lyrics, synced: [] };
    }
    return null;
  }

  async function ensureOfflineLyricsForTrack(t) {
    if (!t || t.source === "radio") return null;
    const existing = await getOfflineLyrics(t);
    if (existing && Array.isArray(existing.synced) && existing.synced.length && !existing._synthesized) {
      await saveOfflineLyrics(t, existing);
      return existing;
    }
    const meta = cleanLyricsMeta(t);
    const dur = Math.round(Number(t.duration || duration() || 0)) || 0;
    let found = null;
    try {
      const data = await api(
        `/api/lyrics?title=${encodeURIComponent(meta.cleanTitle)}&artist=${encodeURIComponent(meta.cleanArtist)}${dur ? `&duration=${dur}` : ""}`,
        8000
      );
      if (data && (data.lyrics || (Array.isArray(data.synced) && data.synced.length))) {
        found = { lyrics: data.lyrics || "", synced: data.synced || [] };
      }
    } catch {}
    if (!found && meta.altTitle) {
      try {
        const dataAlt = await api(
          `/api/lyrics?title=${encodeURIComponent(meta.altTitle)}&artist=${encodeURIComponent(meta.altArtist)}${dur ? `&duration=${dur}` : ""}`,
          7000
        );
        if (dataAlt && (dataAlt.lyrics || (Array.isArray(dataAlt.synced) && dataAlt.synced.length))) {
          found = { lyrics: dataAlt.lyrics || "", synced: dataAlt.synced || [] };
        }
      } catch {}
    }
    if (!found) {
      try {
        found = await fetchLyricsBrowserFallback(meta, dur);
      } catch {}
    }
    if (!found && existing) found = existing;
    if (found) {
      if ((!Array.isArray(found.synced) || !found.synced.length) && found.lyrics) {
        found.synced = synthesizeSyncedLyrics(found.lyrics, dur || 180);
        found._synthesized = true;
      }
      if (!found.lyrics && Array.isArray(found.synced) && found.synced.length) {
        found.lyrics = found.synced.map((r) => r.text).filter(Boolean).join("\n");
      }
      found.lrc = formatSyncedLrc(found.synced, found.lyrics, t);
      await saveOfflineLyrics(t, found);
    }
    return found;
  }

  async function saveSyncedLyricsForTrackInteractive(t) {
    if (!t || t.source === "radio") return;
    toast(`Saving synced lyrics for "${t.title}"…`);
    try {
      const res = await ensureOfflineLyricsForTrack(t);
      if (res && ((Array.isArray(res.synced) && res.synced.length) || res.lyrics)) {
        toast("Synced lyrics saved for offline access", true, "success");
        if (current() && isSameSongClient(current(), t)) {
          loadLyrics(current());
        }
        if (state.view === "library" || state.view === "settings" || state.view === "now") render();
      } else {
        toast("Couldn't find lyrics for this track", true, "error");
      }
    } catch {
      toast("Couldn't save lyrics right now", true, "error");
    }
  }

  async function exportTrackLrc(t) {
    if (!t) return;
    let lyr = await getOfflineLyrics(t);
    if (!lyr || (!lyr.lyrics && (!Array.isArray(lyr.synced) || !lyr.synced.length))) {
      toast("Fetching synced lyrics…");
      lyr = await ensureOfflineLyricsForTrack(t);
    }
    if (!lyr || (!lyr.lyrics && (!Array.isArray(lyr.synced) || !lyr.synced.length))) {
      toast("No lyrics available to export", true, "error");
      return;
    }
    const synced = Array.isArray(lyr.synced) && lyr.synced.length
      ? lyr.synced
      : synthesizeSyncedLyrics(lyr.lyrics || "", Number(t.duration || duration() || 180));
    const lrcText = lyr.lrc || formatSyncedLrc(synced, lyr.lyrics || "", t);
    const fname = `${sanitizeName(`${t.title || "track"} - ${artistName(t) || t.artist || ""}`)}.lrc`;
    const blob = new Blob([lrcText], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`Saved ${fname}`, true, "success");
  }

  let _syncingAllOfflineLyrics = false;
  async function syncAllOfflineLyrics(interactive = false) {
    if (_syncingAllOfflineLyrics) {
      if (interactive) toast("Already syncing offline lyrics…");
      return;
    }
    const dls = state.downloads || [];
    if (!dls.length) {
      if (interactive) toast("No downloaded songs yet");
      return;
    }
    const isNetworkOff = Boolean(
      state.offlineMode ||
      state.isNetworkOffline ||
      (typeof navigator !== "undefined" && navigator.onLine === false)
    );
    if (isNetworkOff) {
      if (interactive) toast("Connect to the internet to fetch missing lyrics", true, "error");
      return;
    }
    const targets = interactive ? dls : dls.filter((d) => d && !hasOfflineSyncedLyrics(d));
    if (!targets.length) {
      if (interactive) toast("All downloaded songs have synced lyrics saved offline", true, "success");
      return;
    }
    _syncingAllOfflineLyrics = true;
    if (interactive) toast(`Saving synced lyrics for ${targets.length} downloaded song${targets.length === 1 ? "" : "s"}…`);
    let savedCount = 0;
    try {
      for (const d of targets) {
        if (!d) continue;
        try {
          const res = await ensureOfflineLyricsForTrack(d);
          if (res && ((Array.isArray(res.synced) && res.synced.length) || res.lyrics)) {
            savedCount += 1;
          }
        } catch {}
      }
      save("aura.downloads", state.downloads);
      if (interactive) {
        toast(
          savedCount > 0
            ? `Saved offline synced lyrics for ${savedCount} song${savedCount === 1 ? "" : "s"}`
            : "Offline lyrics check complete",
          true,
          "success"
        );
      }
      if (state.view === "library" || state.view === "settings" || state.view === "now") render();
    } finally {
      _syncingAllOfflineLyrics = false;
    }
  }

  function lyricsBodyHTML() {
    const L = state.lyrics;
    if (!L) return `<div class="ly-wait">Looking up lyrics…</div>`;
    if ((!Array.isArray(L.synced) || !L.synced.length) && L.lyrics) {
      const effDur = Math.round(Number(duration() || (current() && current().duration) || 180));
      L.synced = synthesizeSyncedLyrics(L.lyrics, effDur);
      L._synthesized = true;
      L._syncDur = effDur;
    }
    const synced = Array.isArray(L.synced) && L.synced.length ? L.synced : null;
    if (synced) {
      return synced.map((l, i) =>
        `<button type="button" class="ly-line${i === lyActive ? " on" : ""}" data-ly="${i}" data-ly-t="${Number(l.t) || 0}">${escapeHTML(l.text || " ")}</button>`
      ).join("");
    }
    if (L.lyrics) return `<pre class="ly-plain">${escapeHTML(L.lyrics)}</pre>`;
    return `<div class="ly-wait"><h3>Lyrics aren’t available</h3><p>Not every recording has words on file. Try another version of the song.</p></div>`;
  }

  function bindLyricLines(box) {
    if (!box) return;
    box.querySelectorAll("[data-ly]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        hapticFeedback("selection");
        lyFollow = true;
        seekTo(Number(el.dataset.lyT) || 0);
        setTimeout(() => {
          lyFollow = true;
          highlightLyric(position(), true);
        }, 50);
      });
    });
  }

  function paintLyricsBox() {
    const box = $("lyScroll") || document.querySelector(".ly-scroll");
    if (!box) return false;
    box.innerHTML = lyricsBodyHTML();
    bindLyricLines(box);
    lyFollow = true;
    highlightLyric(position(), true);
    return true;
  }

  function parseBrowserLyricsHit(hit) {
    if (!hit || hit.instrumental) return null;
    const synced = [];
    if (hit.syncedLyrics) {
      const parsedLrc = parseLrcText(hit.syncedLyrics);
      if (parsedLrc && Array.isArray(parsedLrc.synced) && parsedLrc.synced.length) {
        synced.push(...parsedLrc.synced);
      }
    }
    const plainFromSynced = synced.length ? synced.map((r) => r.text).filter(Boolean).join("\n") : "";
    const lyrics = String(hit.plainLyrics || plainFromSynced || "").trim();
    if (!lyrics && !synced.length) return null;
    return { lyrics, synced, duration: Number(hit.duration) || 0 };
  }

  function cleanLyricsMeta(t) {
    const rawTitle = String((t && t.title) || "").trim();
    const rawArtist = String(artistName(t) || (t && t.artist) || "").trim();
    let cleanTitle = rawTitle
      .replace(/\s*[\[(][^)\]]*(official|audio|video|lyric|visualizer|hd|4k|hq|remaster|topic|feat\.?|ft\.?|with\s|prod\.?|from\s|full\s+song|full\s+video|music\s+video|live|radio\s+edit)[^)\]]*[)\]]/gi, "")
      .replace(/\s*[-–—|]\s*(official|audio|lyrics?|video|visualizer|full\s+song|full\s+video|remaster(ed)?|hd|4k|hq|from\s+["']?.*).*$/i, "")
      .replace(/\b(official\s+music\s+video|official\s+audio|official\s+video|lyrics?\s+video|visualizer|audio\s+only|full\s+audio|full\s+video)\b/gi, "")
      .replace(/\s*\b(feat\.?|ft\.?)\s+[^-–—|(\[]+$/i, "")
      .replace(/#[a-z0-9_]+/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim() || rawTitle;

    const rawArtistBase = rawArtist
      .split("·")[0]
      .split("|")[0]
      .replace(/\s*-\s*Topic$/i, "")
      .replace(/\bVEVO\b/gi, "")
      .replace(/\s*\b(official|music|channel|records|recordings|entertainment)\b$/i, "")
      .trim();

    const isGenericLabel = (s) =>
      /^(youtube|various artists|unknown|unknown artist|topic|t-series|zee music company|sony music india|yash raj films|yrf|saregama|tips official|speed records|desi melodies)$/i.test(String(s || "").trim());

    const allArtists = rawArtistBase
      .split(/\s*(?:,|&|\/|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\bx\b)\s*/i)
      .map((s) => s.trim())
      .filter((s) => s && !isGenericLabel(s));

    const featInTitle = rawTitle.match(/(?:feat\.?|ft\.?|featuring|with)\s+([^)\]-]+)/i);
    if (featInTitle) {
      for (const fp of featInTitle[1].split(/\s*(?:,|&)\s*/)) {
        const fc = fp.trim();
        if (fc && !isGenericLabel(fc) && !allArtists.some((a) => a.toLowerCase() === fc.toLowerCase())) {
          allArtists.push(fc);
        }
      }
    }

    let cleanArtist = allArtists[0] || "";

    // If title is "Artist - Song Title" (common on YouTube), extract both candidates
    const dashParts = cleanTitle.split(/\s+[-–—]\s+/).map((s) => s.trim()).filter(Boolean);
    let altTitle = "";
    let altArtist = "";
    if (dashParts.length >= 2) {
      const left = dashParts[0];
      const right = dashParts.slice(1).join(" - ");
      if (!cleanArtist || left.toLowerCase() === cleanArtist.toLowerCase() || cleanArtist.toLowerCase().includes(left.toLowerCase())) {
        cleanTitle = right;
        if (!cleanArtist && !isGenericLabel(left)) {
          cleanArtist = left;
          if (!allArtists.length) allArtists.push(left);
        }
      } else {
        altTitle = right;
        altArtist = left;
        if (!isGenericLabel(left) && !allArtists.some((a) => a.toLowerCase() === left.toLowerCase())) {
          allArtists.push(left);
        }
      }
    }
    const coreTitle = cleanTitle.replace(/\s*[\[(][^)\]]*[)\]]/g, " ").replace(/\s{2,}/g, " ").trim() || cleanTitle;
    return { cleanTitle, coreTitle, cleanArtist, altTitle, altArtist, allArtists };
  }

  function pickBestBrowserLyricsHit(rows, meta, dur) {
    if (!Array.isArray(rows) || !rows.length) return null;
    const fold = (s) =>
      String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\u0900-\u0D7F\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0600-\u06FF\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const wantT = fold(meta.coreTitle || meta.cleanTitle || "");
    const wantArts = ((meta.allArtists && meta.allArtists.length) ? meta.allArtists : [meta.cleanArtist]).map(fold).filter(Boolean);
    const wantIsAlt = /\b(slowed|sped\s*up|nightcore|remix|live|karaoke)\b/i.test(meta.cleanTitle || "");
    let best = null;
    let bestScore = -Infinity;
    for (const item of rows) {
      const parsed = parseBrowserLyricsHit(item);
      if (!parsed) continue;
      let sc = 0;
      if (parsed.synced && parsed.synced.length >= 4) sc += 120;
      else if (parsed.lyrics) sc += 20;
      const it = fold(item.trackName || item.name || "");
      const itCore = fold(String(item.trackName || item.name || "").replace(/\s*[\[(][^)\]]*[)\]]/g, " ")) || it;
      const ia = fold(item.artistName || "");
      if (wantT && itCore) {
        if (itCore === wantT || it === wantT) sc += 80;
        else if (itCore.startsWith(wantT) || wantT.startsWith(itCore)) sc += 55;
        else if (it.includes(wantT) || wantT.includes(itCore)) sc += 30;
        else {
          const wWords = wantT.split(" ").filter((w) => w.length >= 3);
          const mWords = wWords.filter((w) => itCore.includes(w));
          if (wWords.length > 0 && mWords.length >= Math.ceil(wWords.length * 0.65)) sc += 15;
          else continue;
        }
      }
      if (wantArts.length && ia) {
        if (wantArts.some((wa) => ia === wa || ia.includes(wa) || wa.includes(ia))) sc += 70;
        else sc -= 35;
      }
      const itemIsAlt = /\b(slowed|sped\s*up|nightcore|remix|live|karaoke)\b/i.test(`${item.trackName || ""} ${item.albumName || ""}`);
      if (itemIsAlt && !wantIsAlt) sc -= 110;
      const itemDur = Number(item.duration) || (parsed.synced.length ? parsed.synced[parsed.synced.length - 1].t + 6 : 0);
      if (dur > 45 && itemDur > 0) {
        const diff = Math.abs(itemDur - dur);
        if (diff <= 4) sc += 55;
        else if (diff <= 10) sc += 30;
        else if (diff > 35) sc -= 90;
      }
      if (sc > bestScore) {
        bestScore = sc;
        best = parsed;
      }
    }
    return bestScore >= 20 ? best : null;
  }

  async function fetchLyricsBrowserFallback(meta, dur) {
    const pairs = [];
    const addP = (tr, ar) => {
      const t = String(tr || "").trim();
      const a = String(ar || "").trim();
      if (!t) return;
      if (!pairs.some((p) => p.t.toLowerCase() === t.toLowerCase() && p.a.toLowerCase() === a.toLowerCase())) {
        pairs.push({ t, a });
      }
    };
    addP(meta.coreTitle, meta.cleanArtist);
    addP(meta.cleanTitle, meta.cleanArtist);
    if (Array.isArray(meta.allArtists)) {
      for (const ca of meta.allArtists.slice(1, 3)) {
        addP(meta.coreTitle, ca);
      }
    }
    if (meta.altTitle) addP(meta.altTitle, meta.altArtist);

    const urls = [];
    for (const p of pairs) {
      if (p.a && p.t) {
        if (dur > 0) {
          urls.push(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(p.a)}&track_name=${encodeURIComponent(p.t)}&duration=${dur}`);
        }
        urls.push(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(p.a)}&track_name=${encodeURIComponent(p.t)}`);
        urls.push(`https://lrclib.net/api/search?track_name=${encodeURIComponent(p.t)}&artist_name=${encodeURIComponent(p.a)}`);
        urls.push(`https://lrclib.net/api/search?q=${encodeURIComponent(`${p.a} ${p.t}`)}`);
      }
    }
    if (meta.coreTitle) {
      urls.push(`https://lrclib.net/api/search?track_name=${encodeURIComponent(meta.coreTitle)}`);
      urls.push(`https://lrclib.net/api/search?q=${encodeURIComponent(meta.coreTitle)}`);
    }

    let bestPlain = null;
    for (const u of urls) {
      try {
        const res = await fetch(u, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(6500),
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data)) {
          const picked = pickBestBrowserLyricsHit(data, meta, dur);
          if (picked) {
            if (picked.synced && picked.synced.length) return picked;
            if (!bestPlain && picked.lyrics) bestPlain = picked;
          }
        } else {
          const parsed = parseBrowserLyricsHit(data);
          if (parsed) {
            if (parsed.synced && parsed.synced.length) return parsed;
            if (!bestPlain && parsed.lyrics) bestPlain = parsed;
          }
        }
      } catch {}
    }

    if (bestPlain) return bestPlain;

    for (const p of pairs) {
      if (!p.a || !p.t) continue;
      try {
        const res = await fetch(
          `https://api.lyrics.ovh/v1/${encodeURIComponent(p.a)}/${encodeURIComponent(p.t)}`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (!res.ok) continue;
        const ovh = await res.json();
        if (ovh && typeof ovh.lyrics === "string" && ovh.lyrics.trim()) {
          return {
            lyrics: ovh.lyrics.replace(/^Paroles de la chanson .*?\r?\n/i, "").trim(),
            synced: [],
          };
        }
      } catch {}
    }
    return null;
  }

  async function loadLyrics(t) {
    if (!t || t.source === "radio") {
      state.lyrics = { lyrics: "", synced: [], key: lyricsKey(t) };
      if (state.view === "now") paintLyricsBox() || render();
      return;
    }
    const key = lyricsKey(t);
    if (state.lyrics && state.lyrics.key === key && (state.lyrics.lyrics || (state.lyrics.synced && state.lyrics.synced.length))) {
      lyActive = -1;
      if (state.view === "now") paintLyricsBox() || render();
      highlightLyric(position(), true);
      if (Array.isArray(state.lyrics.synced) && state.lyrics.synced.length > 0 && !state.lyrics._synthesized) {
        return;
      }
    }
    if (t._fromNativeAppCache) {
      const nc = getNativeAppAudioCache(t);
      const cachedLyr = (nc && nc.lyrics && (nc.lyrics.lyrics || (Array.isArray(nc.lyrics.synced) && nc.lyrics.synced.length)))
        ? nc.lyrics
        : null;
      if (cachedLyr) {
        const effDur = Math.round(Number(duration() || t.duration || 180));
        let syncedRows = Array.isArray(cachedLyr.synced) ? cachedLyr.synced : [];
        let isSynth = Boolean(cachedLyr._synthesized);
        if ((!syncedRows.length || isSynth) && cachedLyr.lyrics) {
          syncedRows = synthesizeSyncedLyrics(cachedLyr.lyrics, effDur);
          isSynth = true;
        }
        lyActive = -1;
        state.lyrics = {
          lyrics: cachedLyr.lyrics || "",
          synced: syncedRows,
          _synthesized: isSynth,
          _syncDur: effDur,
          key,
        };
        if (state.view === "now") paintLyricsBox() || render();
        highlightLyric(position(), true);
        if (syncedRows.length && !isSynth) {
          return;
        }
      }
    }
    const gen = ++lyricsGen;
    lyActive = -1;
    if (!state.lyrics || state.lyrics.key !== key) {
      state.lyrics = { key, lyrics: "", synced: [] };
    }
    const dur = Math.round(Number(duration() || t.duration || 0)) || 0;
    const isNetworkOff = Boolean(
      state.offlineMode ||
      state.isNetworkOffline ||
      (typeof navigator !== "undefined" && navigator.onLine === false)
    );

    // 1. Check offline cached lyrics (from IndexedDB or saved download track) first!
    const cached = await getOfflineLyrics(t);
    if (gen !== lyricsGen) return;
    if (cached && ((Array.isArray(cached.synced) && cached.synced.length) || cached.lyrics)) {
      let syncedRows = Array.isArray(cached.synced) ? cached.synced : [];
      let isSynth = Boolean(cached._synthesized);
      const effDur = Math.round(Number(duration() || dur || 180));
      if ((!syncedRows.length || isSynth) && cached.lyrics) {
        syncedRows = synthesizeSyncedLyrics(cached.lyrics, effDur);
        isSynth = true;
      }
      lyActive = -1;
      state.lyrics = {
        lyrics: cached.lyrics || "",
        synced: syncedRows,
        _synthesized: isSynth,
        _syncDur: effDur,
        key,
      };
      if (state.view === "now") paintLyricsBox() || render();
      highlightLyric(position(), true);
      // If we're offline or already have real time-synced lyrics, we're done!
      if (isNetworkOff || (syncedRows.length && !isSynth)) {
        return;
      }
    } else if (isNetworkOff) {
      if (state.view === "now") paintLyricsBox() || render();
      return;
    }

    const meta = cleanLyricsMeta(t);
    let found = null;
    try {
      const data = await api(
        `/api/lyrics?title=${encodeURIComponent(meta.cleanTitle)}&artist=${encodeURIComponent(meta.cleanArtist)}${dur ? `&duration=${dur}` : ""}`,
        12000
      );
      if (gen !== lyricsGen) return;
      if (data && (data.lyrics || (Array.isArray(data.synced) && data.synced.length))) {
        found = { lyrics: data.lyrics || "", synced: data.synced || [] };
      }
    } catch {
      if (gen !== lyricsGen) return;
    }
    // If primary call came back without synced lyrics and we have an alternate title/artist or collaborating artist, try that too
    if ((!found || !found.synced || !found.synced.length) && meta.altTitle) {
      try {
        const data2 = await api(
          `/api/lyrics?title=${encodeURIComponent(meta.altTitle)}&artist=${encodeURIComponent(meta.altArtist)}${dur ? `&duration=${dur}` : ""}`,
          10000
        );
        if (gen !== lyricsGen) return;
        if (data2 && ((Array.isArray(data2.synced) && data2.synced.length) || (!found && data2.lyrics))) {
          found = { lyrics: data2.lyrics || "", synced: data2.synced || [] };
        }
      } catch {}
    }
    // Client-side direct fallback (LRCLIB + lyrics.ovh) if server returned empty or had no synced timestamps
    if (!found || !found.synced || !found.synced.length) {
      try {
        const fb = await fetchLyricsBrowserFallback(meta, Math.round(Number(duration() || dur || 0)));
        if (fb && ((Array.isArray(fb.synced) && fb.synced.length) || (!found && fb.lyrics))) {
          found = fb;
        }
      } catch {}
      if (gen !== lyricsGen) return;
    }
    if (!found && cached) {
      found = cached;
    }
    let finalSynced = (found && Array.isArray(found.synced)) ? found.synced : [];
    let isSynth = Boolean(found && found._synthesized);
    const finalPlain = (found && found.lyrics) || (finalSynced.length ? finalSynced.map((r) => r.text).filter(Boolean).join("\n") : "");
    const effDur = Math.round(Number(duration() || t.duration || dur || 180));
    if (!finalSynced.length && finalPlain) {
      finalSynced = synthesizeSyncedLyrics(finalPlain, effDur);
      isSynth = true;
    }
    lyActive = -1;
    state.lyrics = {
      lyrics: finalPlain,
      synced: finalSynced,
      _synthesized: isSynth,
      _syncDur: effDur,
      key,
    };
    if (finalPlain || finalSynced.length) {
      saveOfflineLyrics(t, state.lyrics).catch(() => {});
    }
    if (IS_NATIVE) {
      storeNativeAppAudioCache(t, { lyrics: state.lyrics, lyricsChecked: true });
    }
    if (state.view === "now") paintLyricsBox() || render();
    highlightLyric(position(), true);
  }

  function highlightLyric(p, forceScroll) {
    if (!state.lyrics) return;
    const effDur = Math.round(Number(duration() || (current() && current().duration) || 0));
    if (state.lyrics.lyrics && (!Array.isArray(state.lyrics.synced) || !state.lyrics.synced.length || (state.lyrics._synthesized && effDur > 15 && Math.abs((state.lyrics._syncDur || 0) - effDur) > 2))) {
      const useDur = effDur > 15 ? effDur : 180;
      state.lyrics.synced = synthesizeSyncedLyrics(state.lyrics.lyrics, useDur);
      state.lyrics._synthesized = true;
      state.lyrics._syncDur = useDur;
      if (state.view === "now") {
        const boxCheck = $("lyScroll") || document.querySelector(".ly-scroll");
        if (boxCheck) {
          boxCheck.innerHTML = lyricsBodyHTML();
          bindLyricLines(boxCheck);
        }
      }
    }
    const box = $("lyScroll") || document.querySelector(".ly-scroll") || document.querySelector(".lyrics");
    let lines = box ? box.querySelectorAll("[data-ly]") : document.querySelectorAll("[data-ly]");
    if (!lines.length && box && state.lyrics.synced && state.lyrics.synced.length) {
      box.innerHTML = lyricsBodyHTML();
      bindLyricLines(box);
      lines = box.querySelectorAll("[data-ly]");
    }
    if (!lines.length || !state.lyrics.synced || !state.lyrics.synced.length) return;
    const syncP = Math.max(0, (Number(p) || 0) + 0.22);
    let active = -1;
    const rows = state.lyrics.synced;
    for (let i = 0; i < rows.length; i++) {
      if (syncP >= (Number(rows[i].t) || 0)) active = i;
    }
    const changed = active !== lyActive;
    if (!changed && !forceScroll) return;
    lines.forEach((el, i) => {
      el.classList.toggle("on", i === active);
      el.classList.toggle("past", i < active);
    });
    lyActive = active;
    const on = active >= 0 ? lines[active] : null;
    if (!on || (!lyFollow && !forceScroll)) return;
    lyProg = true;
    if (box) {
      const scrollBehavior = isBatterySaver() ? "auto" : "smooth";
      const boxH = Number(box.clientHeight) || 0;
      if (boxH > 0 && typeof box.scrollTo === "function" && typeof on.offsetTop === "number") {
        const top = on.offsetTop - (boxH * 0.42) + ((Number(on.clientHeight) || 28) / 2);
        try {
          box.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior });
        } catch {
          box.scrollTop = Math.max(0, top);
        }
      } else {
        try {
          on.scrollIntoView({ behavior: scrollBehavior, block: "center", inline: "nearest" });
        } catch {
          const top = on.offsetTop - (box.clientHeight / 2) + (on.clientHeight / 2);
          box.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior });
        }
      }
    }
    clearTimeout(highlightLyric._t);
    highlightLyric._t = setTimeout(() => { lyProg = false; }, 360);
  }

  setInterval(() => {
    if (!state.playing || !state.lyrics || !Array.isArray(state.lyrics.synced) || !state.lyrics.synced.length) return;
    if (typeof document !== "undefined" && document.hidden) return;
    if (state.view === "now" || (typeof document !== "undefined" && document.getElementById("lyScroll"))) {
      highlightLyric(position(), false);
    }
  }, 180);

  function applySongTheme(hue) {
    if (isSkinTheme()) return;
    const h = ((hue % 360) + 360) % 360;
    const root = document.documentElement.style;
    const light = resolvedTheme() === "light";
    root.setProperty("--song-primary", light ? `hsl(${h} 48% 36%)` : `hsl(${h} 72% 72%)`);
    root.setProperty("--song-on-primary", light ? `#fff` : `hsl(${h} 35% 12%)`);
    root.setProperty("--song-container", light ? `hsl(${h} 28% 92%)` : `hsl(${h} 22% 14%)`);
    root.setProperty("--song-glow", `hsl(${h} 80% 50% / ${light ? 0.18 : 0.38})`);
    root.setProperty("--md-sys-color-primary", light ? `hsl(${h} 48% 36%)` : `hsl(${h} 72% 72%)`);
    root.setProperty("--md-sys-color-on-primary", light ? `#fff` : `hsl(${h} 35% 12%)`);
  }

  function hueFromText(s) {
    let hash = 0;
    const str = String(s || "aura");
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return Math.abs(hash) % 360;
  }

  function rgbToHue(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    if (d < 0.001) return 180;
    let h = 0;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return Math.round((h * 60 + 360) % 360);
  }

  let themedId = "";
  function themeFromTrack(t) {
    const id = t ? t.id : "";
    if (id === themedId) return;
    themedId = id;
    applySongTheme(hueFromText(t ? `${t.title}|${t.artist}` : "aura"));
    const wash = $("playerWash");
    if (!t) {
      if (wash) wash.style.backgroundImage = "";
      return;
    }
    const raw = artUrl(t);
    // With a remote API base the sandbox/edge proxy can't reach artwork hosts —
    // load artwork directly from the browser instead.
    const src = raw.startsWith("http") ? (API_BASE ? raw : `/api/img?url=${encodeURIComponent(raw)}`) : raw;
    if (wash) wash.style.backgroundImage = isBatterySaver() ? "" : `url("${src}")`;
    if (isBatterySaver()) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 24; c.height = 24;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, 24, 24);
        const data = ctx.getImageData(0, 0, 24, 24).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const lum = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
          if (lum < 18 || lum > 238) continue;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
        }
        if (n) applySongTheme(rgbToHue(r / n, g / n, b / n));
      } catch {}
    };
    img.src = src;
  }

  function closeOverlays() {
    const side = $("sidebar");
    if (side) side.classList.remove("open");
    const hadQueue = state.showQueue;
    state.showQueue = false;
    showEl($("queuePanel"), false);
    if ($("queuePanel")) $("queuePanel").classList.remove("open");
    showEl($("scrim"), false);
    if (hadQueue) {
      // Same stale-entry guard as setQueueOpen(false): clear the "queue: true"
      // flag on the current history entry so a later popstate (closing
      // Lyrics / a detail page) can't resurrect the Queue.
      try {
        const s = history.state;
        if (s && s.muchi && s.queue) history.replaceState(Object.assign({}, s, { queue: false }), "");
      } catch {}
    }
    syncPlayerVisibility();
  }

  function buildMarqueeTitleHTML(title) {
    const clean = String(title || "Untitled");
    return `<span class="marquee-track" data-marquee="${escapeAttr(clean)}">${escapeHTML(clean)}</span>`;
  }

  function marqueeDurationForTitle(title) {
    return `${Math.max(8, Math.min(20, Math.round(String(title || "").length * 0.32)))}s`;
  }

  function syncMarqueeTitleEl(el, titleText, active) {
    if (!el) return;
    const nextTitle = String(titleText || "Nothing playing");
    const isTrack = Boolean(active && titleText);
    if (el.dataset.marqueeTitle !== nextTitle || el.classList.contains("is-marquee") !== isTrack) {
      el.dataset.marqueeTitle = nextTitle;
      el.classList.toggle("is-marquee", isTrack);
      if (isTrack) {
        el.style.setProperty("--marquee-dur", marqueeDurationForTitle(nextTitle));
        el.innerHTML = buildMarqueeTitleHTML(nextTitle);
      } else {
        el.style.removeProperty("--marquee-dur");
        el.textContent = nextTitle;
      }
    }
  }

  function renderChrome() {
    const t = current();
    const coverImg = $("coverArt");
    const artSrc = t ? artUrl(t) : "/cover-default.jpg";
    if (coverImg && coverImg.getAttribute("src") !== artSrc) {
      coverImg.setAttribute("src", artSrc);
      coverImg.classList.remove("art-swap");
      void coverImg.offsetWidth;
      coverImg.classList.add("art-swap");
    }
    themeFromTrack(t);
    syncMarqueeTitleEl($("trackTitle"), t ? t.title : "Nothing playing", Boolean(t && t.title));
    if (state.view === "now" && t) {
      const nowStrong = viewEl && viewEl.querySelector(".ly-meta strong");
      if (nowStrong) syncMarqueeTitleEl(nowStrong, t.title, true);
      const nowArtBtn = viewEl && viewEl.querySelector("#nowArtist");
      if (nowArtBtn) nowArtBtn.textContent = artistName(t) || t.artist || "";
      const nowImg = viewEl && viewEl.querySelector(".ly-meta img");
      if (nowImg && nowImg.getAttribute("src") !== artSrc) nowImg.setAttribute("src", artSrc);
    }
    const artEl = $("trackArtist");
    if (artEl) {
      const label = t ? (artistName(t) || t.artist || t.source) : "Pick a song to begin";
      artEl.textContent = label;
      const canOpen = !!(t && t.source !== "radio" && artistName(t) && artistName(t) !== "YouTube" && artistName(t) !== "Live radio");
      artEl.disabled = !canOpen;
      artEl.title = canOpen ? `Open ${artistName(t)}` : "";
    }
    const liked = !!(t && isLiked(t));
    const likeBtn = $("likeBtn");
    if (likeBtn) {
      likeBtn.classList.toggle("on", liked);
      likeBtn.setAttribute("aria-pressed", liked ? "true" : "false");
      likeBtn.title = liked ? "Liked" : "Like";
    }
    const dl = $("dlBtn");
    if (dl) {
      const can = !!(t && (t.trackId || t.videoId || t.source === "apple" || t.source === "itunes" || t.source === "deezer"));
      const saved = !!(t && isSaved(t));
      dl.classList.toggle("on", saved);
      dl.classList.toggle("dim", !can);
      dl.title = !t ? "Save offline" : !can ? "This track can't be saved" : saved ? "Saved offline" : "Save offline";
      const ico = $("dlIcon");
      if (ico) ico.textContent = saved ? "download_done" : "download";
    }
    swapPlayGlyph($("playIcon"), state.playing ? "pause" : "play_arrow");
    const coverBtn = $("openNow");
    if (coverBtn) coverBtn.classList.toggle("live", !!state.playing);
    const playBtn = $("playBtn");
    if (playBtn) playBtn.classList.toggle("live", !!state.playing);
    $("repeatBtn").querySelector(".material-symbols-outlined").textContent =
      state.repeat === "one" ? "repeat_one" : "repeat";
    $("shuffleBtn").classList.toggle("on", state.shuffle);
    $("repeatBtn").classList.toggle("on", state.repeat !== "off");
    if ($("sleepBtn")) {
      $("sleepBtn").classList.toggle("on", state.sleep.mode !== "off");
      $("sleepBtn").title = `Sleep · ${sleepLabel()}`;
    }
    const fol = $("followBtn");
    if (fol) {
      const can = !!(t && t.source !== "radio");
      const on = !!(t && isFollowing(t));
      fol.classList.toggle("on", on);
      fol.classList.toggle("dim", !can);
      fol.title = !can ? "Can't follow radio" : on ? `Following ${artistName(t)}` : `Follow ${t ? artistName(t) : "artist"}`;
      const ico = $("followIcon");
      if (ico) ico.textContent = on ? "person_check" : "person_add";
    }
    const lyBtn = $("lyricsBtn");
    if (lyBtn) {
      lyBtn.classList.toggle("on", state.view === "now");
      lyBtn.title = state.view === "now" ? "Close lyrics" : "Lyrics";
    }
    showEl($("eqBars"), state.playing);
    // CSS reads this to pause the glass "shine" sweep when playback is idle
    // (a continuously animating gradient layer is pure GPU cost when the
    // player is paused).
    document.body.dataset.playing = state.playing ? "1" : "";
    $("volume").value = state.volume;
    updateWakeLock();
    document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
    syncPlayerVisibility();
  }

  function renderQueue() {
    const el = $("queueList");
    if (!el) return;
    const cur = current();
    const curIdx = state.index >= 0 ? state.index : 0;
    const upcoming = Math.max(0, state.queue.length - 1 - curIdx);
    if ($("queueSub")) {
      $("queueSub").textContent = state.queue.length
        ? `${state.queue.length} in queue · ${upcoming} up next`
        : "Play next · drag to reorder";
    }

    let out = "";

    // 1. Now Playing Section
    if (cur) {
      out += `
        <div class="q-section-head">
          <span class="q-section-title">Now Playing</span>
        </div>
        <div class="q-row now" data-q-i="${curIdx}">
          <span class="q-handle q-now-badge" title="Now playing"><span class="material-symbols-outlined">volume_up</span></span>
          <img src="${escapeAttr(artUrl(cur))}" alt="" onerror="this.src='/cover-default.jpg'"/>
          <button type="button" class="q-main" data-play="${escapeAttr(cur.id)}" data-idx="${curIdx}">
            <div class="t-title">${escapeHTML(cur.title)}</div>
            <div class="t-sub">${escapeHTML(cur.artist)}</div>
          </button>
          <span class="q-now-tag">Playing</span>
        </div>
      `;
    }

    // 2. Next In Queue Section
    const nextList = state.queue.map((t, i) => ({ t, i })).filter((item) => item.i > curIdx);
    if (nextList.length) {
      out += `
        <div class="q-section-head">
          <span class="q-section-title">Next In Queue</span>
          <span class="q-count">${nextList.length}</span>
        </div>
      `;
      out += nextList.map(({ t, i }) => `
        <div class="q-row" draggable="true" data-q-i="${i}">
          <span class="q-handle" title="Drag to reorder">⋮⋮</span>
          <img src="${escapeAttr(artUrl(t))}" alt="" onerror="this.src='/cover-default.jpg'"/>
          <button type="button" class="q-main" data-play="${escapeAttr(t.id)}" data-idx="${i}">
            <div class="t-title">${escapeHTML(t.title)}</div>
            <div class="t-sub">${escapeHTML(t.artist)}</div>
          </button>
          <button type="button" class="icon-btn q-del" data-q-del="${i}" title="Remove">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      `).join("");
    } else if (!cur) {
      out += `<div class="empty">Queue is empty</div>`;
    }

    // 3. Spotify-style Recommended Section
    const recs = (state.queueRecs || [])
      .map((t, origIdx) => ({ t, origIdx }))
      .filter(({ t }) => t && !state.queue.some((q) => q && (q.id === t.id || (q.videoId && q.videoId === t.videoId))));
    if (cur || recs.length || isQueueRecsLoading) {
      out += `
        <div class="q-recs-wrap">
          <div class="q-recs-head">
            <div>
              <div class="q-recs-title">Recommended</div>
              <div class="q-recs-sub">Based on what's in your queue</div>
            </div>
            <button type="button" class="icon-btn q-refresh-btn ${isQueueRecsLoading ? "rotating" : ""}" id="refreshQueueRecs" title="Refresh recommendations">
              <span class="material-symbols-outlined">refresh</span>
            </button>
          </div>
          <div class="q-recs-list">
            ${isQueueRecsLoading && !recs.length ? `
              <div class="q-recs-loading">
                <div class="spinner"></div>
                <span>Finding matching songs…</span>
              </div>
            ` : (recs.length ? recs.map(({ t, origIdx }) => `
              <div class="q-rec-row" data-rec-idx="${origIdx}">
                <img src="${escapeAttr(artUrl(t))}" alt="" onerror="this.src='/cover-default.jpg'"/>
                <button type="button" class="q-main q-rec-play" data-rec-play="${origIdx}" title="Play song">
                  <div class="t-title">${escapeHTML(t.title)}</div>
                  <div class="t-sub">${escapeHTML(t.artist)}</div>
                </button>
                <button type="button" class="icon-btn q-add-rec" data-rec-add="${origIdx}" title="Add to queue">
                  <span class="material-symbols-outlined">add</span>
                </button>
              </div>
            `).join("") : `
              <div class="q-recs-empty-wrap">
                <p class="q-recs-empty">Tap refresh to get new song recommendations.</p>
                <button type="button" class="btn secondary sm" id="refreshQueueRecsEmpty" style="margin: 8px auto 0 auto; display: flex; align-items: center; gap: 6px;">
                  <span class="material-symbols-outlined" style="font-size: 18px;">refresh</span>
                  <span>Load Recommendations</span>
                </button>
              </div>
            `)}
          </div>
        </div>
      `;
    }

    el.innerHTML = out;
  }

  function renderPlaylistsNav() {
    if (!$("playlistNav")) return;
    $("playlistNav").innerHTML = [
      `<button data-open-liked>Liked songs · ${state.liked.length}</button>`,
      `<button data-open-downloads>Downloads · ${state.downloads.length}</button>`,
      ...state.playlists.map((p, i) => `<button data-pl="${i}">${escapeHTML(p.name)} · ${p.tracks.length}</button>`),
    ].join("");
  }

  function skeleton() {
    return `<div class="sk"></div><div class="section"><div class="sk sk-line" style="width:40%"></div><div class="sk sk-line" style="width:64%;margin-bottom:16px"></div><div class="row">${"<div class='sk' style='height:210px'></div>".repeat(6)}</div></div>`;
  }

  const crop = { url: "", z: 1, x: 0, y: 0, drag: false, lx: 0, ly: 0, kind: "avatar", plIndex: -1 };

  function syncCropChrome() {
    const stage = $("cropStage");
    const hint = $("cropHint");
    const title = $("cropTitle");
    if (stage) {
      stage.classList.toggle("wide", crop.kind === "plBanner");
      stage.classList.toggle("sq", crop.kind === "plCover");
    }
    if (title) {
      title.textContent = crop.kind === "plBanner" ? "Edit banner" : crop.kind === "plCover" ? "Edit cover" : "Edit photo";
    }
    if (hint) {
      hint.textContent = crop.kind === "plBanner"
        ? "Drag to move · zoom to fill the banner"
        : crop.kind === "plCover"
          ? "Drag to move · zoom to fill the cover"
          : "Drag to move · zoom to fill the circle";
    }
  }

  function pickImage(kind, plIndex) {
    crop.kind = kind || "avatar";
    crop.plIndex = Number.isInteger(plIndex) ? plIndex : -1;
    const inp = $("avatarFile");
    if (!inp) return;
    inp.value = "";
    inp.click();
  }

  function setAvatarFile(file) {
    if (!file || !String(file.type || "").startsWith("image/")) {
      toast("Pick a photo");
      return;
    }
    if (crop.url) URL.revokeObjectURL(crop.url);
    crop.url = URL.createObjectURL(file);
    crop.z = 1;
    crop.x = 0;
    crop.y = 0;
    crop.kind = crop.kind || "avatar";
    syncCropChrome();
    const img = $("cropImg");
    const zoom = $("cropZoom");
    if (zoom) zoom.value = "100";
    if (img) {
      img.onload = () => {
        showEl($("cropWrap"), true);
        requestAnimationFrame(() => {
          layoutCrop();
          requestAnimationFrame(layoutCrop);
        });
      };
      img.src = crop.url;
    }
  }

  function layoutCrop() {
    const stage = $("cropStage");
    const img = $("cropImg");
    if (!stage || !img || !img.naturalWidth) return;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const base = Math.max(W / nw, H / nh);
    const w = nw * base * crop.z;
    const h = nh * base * crop.z;
    const maxX = Math.max(0, (w - W) / 2);
    const maxY = Math.max(0, (h - H) / 2);
    crop.x = Math.max(-maxX, Math.min(maxX, crop.x));
    crop.y = Math.max(-maxY, Math.min(maxY, crop.y));
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    img.style.left = `${(W - w) / 2 + crop.x}px`;
    img.style.top = `${(H - h) / 2 + crop.y}px`;
  }

  function closeCrop() {
    showEl($("cropWrap"), false);
    if (crop.url) {
      URL.revokeObjectURL(crop.url);
      crop.url = "";
    }
    crop.kind = "avatar";
    crop.plIndex = -1;
  }

  function commitCrop() {
    const stage = $("cropStage");
    const img = $("cropImg");
    if (!stage || !img || !img.naturalWidth) return;
    layoutCrop();
    const W = stage.clientWidth;
    const H = stage.clientHeight || W;
    const outW = crop.kind === "plBanner" ? 720 : 320;
    const outH = Math.max(80, Math.round(outW * (H / W)));
    const c = document.createElement("canvas");
    c.width = outW;
    c.height = outH;
    const ctx = c.getContext("2d");
    const scale = outW / W;
    ctx.drawImage(img, parseFloat(img.style.left) * scale, parseFloat(img.style.top) * scale, parseFloat(img.style.width) * scale, parseFloat(img.style.height) * scale);
    const data = c.toDataURL("image/jpeg", 0.82);
    if (crop.kind === "plCover" || crop.kind === "plBanner") {
      const p = state.playlists[crop.plIndex];
      const cover = crop.kind === "plCover";
      if (!p) { closeCrop(); return; }
      if (cover) p.cover = data;
      else p.banner = data;
      savePlaylists();
      closeCrop();
      toast(cover ? "Cover saved" : "Banner saved", true, "success");
      if (state.view === "library") render();
      return;
    }
    state.prefs.avatar = data;
    savePrefs();
    closeCrop();
    toast("Photo saved", true, "success");
    if (state.view === "home") render();
  }

  function playlistArt(p) {
    if (p && p.cover) return p.cover;
    return artUrl(p && p.tracks && p.tracks[0]);
  }

  function avatarInner() {
    const name = String(state.prefs.username || "You").trim() || "You";
    if (state.prefs.avatar) return `<img src="${escapeAttr(state.prefs.avatar)}" alt=""/>`;
    return `<span>${escapeHTML(name[0].toUpperCase())}</span>`;
  }

  function homeBarHTML() {
    const name = String(state.prefs.username || "").trim();
    return `
      <div class="home-bar">
        <div class="home-brand">
          <img id="homeBrandIcon" src="${escapeAttr(activeAppIconUrl())}" alt="Muchi" width="28" height="28" />
          <span class="home-brand-title">Muchi</span>
        </div>
        <div class="home-bar-profile-wrap">
          <button type="button" class="avatar-btn" id="profileBtn" title="${escapeAttr(name || "Profile")}">${avatarInner()}</button>
          ${state.showProfile ? `
            <div class="profile-menu" id="profileMenu">
              <div class="profile-head">
                <button type="button" class="avatar-btn lg" id="pickAvatar" title="Change photo">${avatarInner()}</button>
                <div class="profile-fields">
                  <label>Name
                    <input id="setUsername" type="text" maxlength="32" value="${escapeAttr(name)}" placeholder="Your name"/>
                  </label>
                  <p>Tap the photo to crop and save a picture.</p>
                </div>
              </div>
              <button type="button" class="profile-link" id="gotoSettings">
                <span class="material-symbols-outlined">settings</span>
                Settings
              </button>
            </div>` : ""}
        </div>
      </div>`;
  }

  function renderHome() {
    const h = state.home;
      if (!h) {
      return `
        ${homeBarHTML()}
        <div class="hero home-hero">
          <div class="hero-orbs" aria-hidden="true"><i></i><i></i><i></i></div>
          ${homeHeroSceneHTML()}
          <div class="home-hero-copy">
            <span class="hero-brand-kicker">Muchi</span>
            <h1>${heroGreetingHTML()}</h1>
            <p>Loading English hits and genres…</p>
          </div>
        </div>
        ${skeleton()}`;
    }
    const recents = state.recents.slice(0, 10);
    const local = h.youtubeLocal && h.youtubeLocal.length ? h.youtubeLocal : h.youtubeIndia;
    const region = countryName(h.country || state.prefs.country);
    // Remote preview: make the connection state visible in the hero so a slow
    // first paint reads as "loading", never as a broken/empty page.
    const liveNote = API_BASE && state.apiStatus === "connecting"
      ? " · connecting to the live catalog…"
      : API_BASE && state.apiStatus === "slow"
        ? " · catalog is slow — rows are filling in"
        : "";
    const shelves = FALLBACK_SHELVES.map((fb) => {
      const hit = (h.shelves || []).find((s) => s.id === fb.id);
      return {
        id: fb.id,
        title: (hit && hit.title) || fb.title,
        query: (hit && hit.query) || fb.query,
        tracks: (hit && hit.tracks && hit.tracks.length) ? hit.tracks : (fb.id === "today" ? (h.youtubeCharts || []) : []),
      };
    });
    // Reorder shelves based on user's chosen genres from onboarding & listening taste
    const prefGenres = Array.isArray(state.prefs.tasteGenres) ? state.prefs.tasteGenres : [];
    const prefMoods = Array.isArray(state.prefs.tasteMoods) ? state.prefs.tasteMoods : [];
    const taste = tasteProfile();
    if (prefGenres.length || taste.genres.length) {
      const genreWeight = (id) => {
        if (id === "today") return 100; // Keep Today's Top Hits anchored first
        let w = 0;
        const idx = prefGenres.indexOf(id);
        if (idx >= 0) w += 50 - idx;
        for (const [gName, score] of (taste.genres || [])) {
          if (String(gName).toLowerCase().includes(id)) w += score;
        }
        return w;
      };
      shelves.sort((a, b) => genreWeight(b.id) - genreWeight(a.id));
    }
    const tasteTracks = (state.tasteTracks || []).slice(0, 14);
    const followedTracks = (state.followedArtistTracks || []).slice(0, 14);
    return `
      ${homeBarHTML()}
      <div class="hero home-hero">
        <div class="hero-orbs" aria-hidden="true"><i></i><i></i><i></i></div>
        ${homeHeroSceneHTML()}
        <div class="home-hero-copy">
          <span class="hero-brand-kicker">Muchi</span>
          <h1>${heroGreetingHTML()}</h1>
          ${liveNote ? `<p>${escapeHTML(liveNote.replace(/^\s*·\s*/, ""))}</p>` : ""}
        </div>
      </div>
      <div class="section">
        <div class="section-head">
          <h2>${taste.hasTaste ? "For your taste" : "Moods & genres"}</h2>
        </div>
        <div class="chips taste-tabs">
          <button type="button" class="chip ${state.homeTasteTab !== "discover" ? "active" : ""}" data-taste-tab="moods">Moods</button>
          <button type="button" class="chip ${state.homeTasteTab === "discover" ? "active" : ""}" data-taste-tab="discover">Discovery Mix</button>
        </div>
        ${state.homeTasteTab === "discover" ? `
          <div class="disc-banner" id="openDiscovery" role="button" tabindex="0">
            <div>
              <p class="lib-kicker">Updates every Monday</p>
              <h3>Discovery Mix</h3>
              <p>${(state.discovery.tracks || []).length ? trackStats(state.discovery.tracks) + (state.discovery.week ? " · " + escapeHTML(state.discovery.week) : "") : "Building your weekly mix…"}</p>
            </div>
            ${(state.discovery.tracks || []).length ? `<button class="filled-btn" id="openDiscoveryBtn" type="button"><span class="material-symbols-outlined">queue_music</span> Open</button>` : ""}
          </div>
        ` : `
        <div class="moods">
          ${personalizeMoods(h.moods || []).map((m) => `<button class="mood" data-mood="${escapeAttr(m.query)}" style="--mood:${m.color}">${escapeHTML(m.title)}</button>`).join("")}
        </div>`}
      </div>
      ${recents.length ? section("Jump back in", recents) : ""}
      ${forYouSection()}
      ${tastePlaylistSection()}
      ${viralSection()}
      ${playlistSection(`Trending in ${region}`, h.countryPlaylists || [], "country")}
      ${section(`Top songs in ${region}`, local, "local")}
      ${playlistSection("Global trending playlists", h.globalPlaylists || [], "global")}
      ${shelves.map((s) => section(s.title, s.tracks, s.id || s.title)).join("")}
      ${section("Independent artists", h.audius, "audius")}
      ${section("Underground", h.underground, "underground")}
      ${section("Live radio", h.radio, "radio")}
      <footer class="home-legal-footer" style="text-align:center;padding:20px 12px 12px;font-size:0.78rem;color:var(--md-sys-color-on-surface-variant,rgba(255,255,255,0.62))">
        <span>Muchi</span> · <a href="/privacy.html" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">Privacy Policy</a> · <a href="/terms.html" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">Terms of Service</a>
      </footer>
    `;
  }

  function section(title, tracks, shelfKey) {
    const rows = tracks || [];
    if (!rows.length && !shelfKey) return "";
    const open = shelfKey
      ? `<button type="button" class="see-all" data-open-shelf="${escapeAttr(String(shelfKey))}">See all</button>`
      : `<span>${rows.length} tracks</span>`;
    const heading = shelfKey
      ? `<button type="button" class="section-title" data-open-shelf="${escapeAttr(String(shelfKey))}">${title}</button>`
      : `<h2>${title}</h2>`;
    const skelCards = [...Array(6)].map(() => `<div class="card-wrap"><div class="card skel" style="height:175px;border-radius:var(--md-shape-lg);background:var(--md-surface-variant);opacity:0.35;"></div></div>`).join("");
    return `<div class="section"><div class="section-head">${heading}${open}</div><div class="row">${rows.length ? rows.map(cardHTML).join("") : skelCards}</div></div>`;
  }

  function plCardHTML(p, group, i) {
    healPlaylistCoversClient(p);
    const firstTrack = p && Array.isArray(p.tracks) && p.tracks[0] ? p.tracks[0] : null;
    const art = p.artwork || (firstTrack && firstTrack.artwork) || "/cover-default.jpg";
    const seedTitle = (firstTrack && firstTrack.title) || p.title || "";
    const seedArtist = (firstTrack && firstTrack.artist) || p.artist || "";
    return `<div class="card-wrap">
      <button type="button" class="card card-hit" data-open-home-pl="${escapeAttr(group)}" data-pl-i="${i}" data-title="${escapeAttr(seedTitle)}" data-artist="${escapeAttr(seedArtist)}">
        <div class="art">
          <img src="${escapeAttr(art)}" alt="" loading="lazy" onerror="handleImgErr(this)"/>
          <span class="badge yt">Playlist</span>
        </div>
        <h3>${escapeHTML(p.title || "Playlist")}</h3>
        <p>${escapeHTML(p.subtitle || p.artist || "Daily mix")}</p>
      </button>
    </div>`;
  }

  function playlistSection(title, playlists, group) {
    const rows = playlists || [];
    if (!rows.length) {
      const skelPls = [...Array(6)].map(() => `<div class="card-wrap"><div class="card skel" style="height:190px;border-radius:var(--md-shape-lg);background:var(--md-surface-variant);opacity:0.35;"></div></div>`).join("");
      return `<div class="section"><div class="section-head"><h2>${title}</h2><span>${group === "country" ? 17 : 12}</span></div><div class="row">${skelPls}</div></div>`;
    }
    return `<div class="section"><div class="section-head"><h2>${title}</h2><span>${rows.length}</span></div><div class="row">${rows.map((p, i) => plCardHTML(p, group, i)).join("")}</div></div>`;
  }

  // "Made for you" — a shelf of custom playlist cards. Each card opens a
  // catalog page listing all of that playlist's songs vertically.
  // ---- "Made for you" playlist cards -----------------------------------
  // Single source of truth for the visible cards, shared by the renderer and
  // the click handler so tapping a card always finds it (this was broken when
  // the cards were built client-side but the handler looked them up in the API
  // response).

  let fyCardsList = null;

  function fyCardCache() {
    try { return JSON.parse(localStorage.getItem("aura.fyCards") || "{}") || {}; } catch { return {}; }
  }
  function fyCardCacheSave(c) {
    try { localStorage.setItem("aura.fyCards", JSON.stringify(c)); } catch {}
  }

  // Score how well a "Made for you" card matches the listener's taste so the
  // section reorders as they keep listening/liking. A card matches when any of
  // its genre tags (e.g. "pop", "hiphop", "rnb", "chill", "workout",
  // "throwback") shows up in the user's top-listen genres or in the words of
  // the artists they play. Higher score = surfaces first in the row.
  function fyTasteScore(p, taste) {
    if (!p) return 0;
    const g = (Array.isArray(p.genres) ? p.genres : []).map((x) => String(x).toLowerCase());
    const mood = String(p.mood || "").toLowerCase().replace(/^mod:/, "");
    const hay = `${String((p.title || p.query || "")).toLowerCase()} ${g.join(" ")} ${mood}`;
    let score = 0;
    // 1) Mood/genre match: if the listener's top-listen genres include this
    //    card's mood tag, surface it.
    for (const [name, n] of taste.genres || []) {
      const w = String(name).toLowerCase();
      if (w && (g.includes(w) || hay.includes(w))) score += (n || 1) * 5;
    }
    // 2) Artist match: count the songs in this card by artists the listener
    //    actually plays. This is what makes "Made for you" visibly reorder as
    //    the user keeps listening (preview cards carry their tracks; catalog
    //    rows carry `_tag`/`mood`).
    if (p.tracks && p.tracks.length) {
      for (const t of p.tracks) {
        if (!t) continue;
        const a = String(t.artist || "").toLowerCase();
        const first = a.split(" ")[0];
        for (const [artist, n] of taste.artists || []) {
          const w = String(artist).toLowerCase();
          if (a === w || first === w.split(" ")[0]) { score += (n || 1) * 2; break; }
        }
      }
    } else {
      for (const [artist, n] of taste.artists || []) {
        const first = String(artist).toLowerCase().split(" ")[0];
        if (first.length > 2 && hay.includes(first)) score += (n || 1) * 3;
      }
    }
    return score;
  }

  const CLIENT_FY_MOOD_SPEC = {
    pop: { genres: ["pop"], moods: ["upbeat", "feelgood"], disallow: ["rock", "lofi", "lo-fi", "desi"], energy: 0.74 },
    hiphop: { genres: ["hiphop", "hip-hop", "rap", "trap", "drill"], moods: ["upbeat", "workout", "party"], disallow: ["rock", "indie", "country", "lofi", "lo-fi", "desi"], energy: 0.80 },
    rnb: { genres: ["rnb", "r&b", "soul"], moods: ["chill", "romantic", "late_night"], disallow: ["rock", "dance", "electronic", "country", "desi"], energy: 0.56 },
    rock: { genres: ["rock", "indie rock", "metal"], moods: ["feelgood", "upbeat", "workout"], disallow: ["hiphop", "hip-hop", "rnb", "r&b", "dance", "electronic", "lofi", "lo-fi", "desi"], energy: 0.78 },
    dance: { genres: ["dance", "electronic", "house", "edm"], moods: ["party", "upbeat", "workout"], disallow: ["rock", "lofi", "lo-fi", "country", "desi"], energy: 0.86 },
    indie: { genres: ["indie", "indie pop", "indie rock"], moods: ["chill", "feelgood", "focus"], disallow: ["hiphop", "hip-hop", "dance", "electronic", "desi"], energy: 0.55 },
    trending: { genres: ["pop", "hiphop", "hip-hop", "rnb", "r&b", "dance", "electronic", "indie", "afrobeats", "afro"], moods: ["upbeat", "party", "feelgood"], disallow: ["lofi", "lo-fi", "desi"], energy: 0.76 },
    chill: { genres: ["indie", "indie pop", "rnb", "r&b", "lofi", "lo-fi", "chill", "pop"], moods: ["chill", "focus", "late_night"], disallow: ["rock", "workout", "dance", "electronic", "desi"], energy: 0.44 },
    workout: { genres: ["hiphop", "hip-hop", "rock", "dance", "electronic"], moods: ["workout", "party", "upbeat"], disallow: ["lofi", "lo-fi", "indie", "country", "desi"], energy: 0.90 },
    throwback: { genres: ["throwback", "pop", "rnb", "r&b", "hiphop", "hip-hop", "rock"], moods: ["retro", "feelgood", "upbeat"], disallow: ["lofi", "lo-fi", "desi"], energy: 0.75 },
  };

  const CLIENT_FY_JUNK_RE = /\b(playlist|mixtape|mix\s*20\d\d|hits\s*20\d\d|songs\s*20\d\d|best\s+of\s+\d{4}|hip\s*hop\s*mix|r\s*&\s*b\s*mix|rap\s*mix|pop\s*mix|chill\s*mix|workout\s*mix|throwback\s*mix|old\s*school\s+rap\s+songs|top\s+\d+\s+songs|nonstop|non\s*stop|megamix|mashup|full\s+album|1\s+hour|2\s+hours|3\s+hours|karaoke|tribute|in\s+the\s+style\s+of|made\s+famous\s+by|crash\s+cars|my\s+little\s+pony|equestria|kidz\s+bop|peppa\s+pig|cocomelon|nursery\s+rhyme|lullaby|hatsune\s+miku|vocaloid|sunset\s+playlist|chill\s+soul\s+radio|dj\s+noize|west\s+coast\s+finest|r&b\s+hit)\b/i;

  function clientMatchesForYouMood(t, moodKey) {
    if (!t || !t.title || !t.artist || t.source === "radio") return false;
    const titleStr = String(t.title || "");
    const hay = `${titleStr} ${t.artist || ""} ${t.album || ""}`;
    if (CLIENT_FY_JUNK_RE.test(hay) || /[🔥🎧|【】~]|#\d+\b/.test(titleStr)) return false;
    if ((titleStr.match(/,/g) || []).length >= 3) return false;
    if (/\b(spotify|billboard|tiktok)\b.*\b(hits|playlist|viral|chart)\b/i.test(titleStr)) return false;
    const dur = Number(t.duration) || 0;
    if (dur > 0 && (dur < 70 || dur > 600)) return false;
    if (!isEnglishTrack(t) || isUnwantedIndianTrackClient(t, "US")) return false;
    const cleanMood = String(moodKey || "pop").toLowerCase().replace(/^mod:/, "");
    const key = cleanMood === "throw" ? "throwback" : cleanMood;
    const tag = String(t._tag || t.mood || "").toLowerCase().replace(/^mod:/, "");
    if (tag && (tag === key || (tag === "throw" && key === "throwback"))) return true;
    const spec = CLIENT_FY_MOOD_SPEC[key] || CLIENT_FY_MOOD_SPEC.pop;
    const vibe = inferTrackVibeClient(t);
    if (!vibe) return false;
    if (spec.disallow.includes(vibe.genre) || spec.disallow.includes(vibe.cluster) || spec.disallow.includes(vibe.mood)) return false;
    if (spec.genres.includes(vibe.genre) || spec.genres.includes(vibe.cluster)) {
      if (key === "chill" && vibe.tempo === "fast") return false;
      if ((key === "workout" || key === "dance") && vibe.tempo === "slow") return false;
      return true;
    }
    return false;
  }

  function personalizeForYouCardTracks(p, globalUsedSigs) {
    const moodKey = String((p && p.mood) || "pop").toLowerCase().replace(/^mod:/, "");
    const rawList = Array.isArray(p && p.tracks) ? p.tracks : [];
    const strictBase = rawList.filter((t) => clientMatchesForYouMood(t, moodKey));
    const cleanBase = rawList.filter((t) => t && t.title && t.artist && !CLIENT_FY_JUNK_RE.test(`${t.title || ""} ${t.artist || ""}`) && !/[🔥🎧|【】~]|#\d+\b/.test(String(t.title || "")) && isEnglishTrack(t) && !isUnwantedIndianTrackClient(t, "US"));
    const baseTracks = (strictBase.length >= 6 ? strictBase : cleanBase).map((t) => (t && (t.previewUrl || t.preview) ? { ...t, previewUrl: "", preview: "" } : t));
    if (!baseTracks.length) return baseTracks;
    const familiarPool = [...(state.liked || []), ...(state.recents || [])].filter((t) => clientMatchesForYouMood(t, moodKey));
    const discoveryPool = [
      ...(state.tasteTracks || []),
      ...(state.followedArtistTracks || []),
      ...(state.forYou || []),
      ...((state.discovery && state.discovery.tracks) || []),
    ].filter((t) => clientMatchesForYouMood(t, moodKey));

    // If user has no mood-matching personal tracks and no cross-playlist collisions, keep sequenced base tracks
    const merged = [...familiarPool.slice(0, 6), ...baseTracks, ...discoveryPool.slice(0, 8)];
    const httpArtBySig = new Map();
    const httpArtByArtist = new Map();
    let fallbackHttpArt = "";
    for (const t of merged) {
      if (!t || !t.title || !t.artist) continue;
      if (t.artwork && /^https?:\/\//i.test(String(t.artwork))) {
        if (!fallbackHttpArt) fallbackHttpArt = t.artwork;
        const s = canonicalSongKey(t) || String(t.id || "");
        if (s && !httpArtBySig.has(s)) httpArtBySig.set(s, t.artwork);
        const pa = canonicalPrimaryArtistClient(t);
        if (pa && !httpArtByArtist.has(pa)) httpArtByArtist.set(pa, t.artwork);
      }
    }
    const unique = [];
    const localSigs = new Set();
    for (const t of merged) {
      if (!t || !t.title || !t.artist) continue;
      const sig = canonicalSongKey(t) || String(t.id || "");
      if (!sig || localSigs.has(sig) || (globalUsedSigs && globalUsedSigs.has(sig))) continue;
      localSigs.add(sig);
      const pa = canonicalPrimaryArtistClient(t);
      const bestArt = (t.artwork && /^https?:\/\//i.test(String(t.artwork)))
        ? t.artwork
        : (httpArtBySig.get(sig) || (pa && httpArtByArtist.get(pa)) || fallbackHttpArt || t.artwork);
      unique.push(bestArt !== t.artwork ? { ...t, artwork: bestArt } : t);
    }
    // Top up from baseTracks if globalUsedSigs filtered too aggressively
    if (unique.length < 20) {
      for (const t of baseTracks) {
        if (unique.length >= 20) break;
        const sig = canonicalSongKey(t) || String(t.id || "");
        if (!sig || localSigs.has(sig)) continue;
        localSigs.add(sig);
        unique.push(t);
      }
    }
    // Sequence with artist spacing (no back-to-back same artist)
    const normFyArtist = (c) =>
      normalizeKeyText(String(artistName(c) || "").split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\swith\s|\/)\s*/i)[0]);
    const out = [];
    const rem = unique.slice();
    let lastArt = "";
    const artCounts = new Map();
    while (out.length < 20 && rem.length) {
      let idx = rem.findIndex((c) => {
        const a = normFyArtist(c);
        return a !== lastArt && (artCounts.get(a) || 0) < 2;
      });
      if (idx < 0) idx = rem.findIndex((c) => normFyArtist(c) !== lastArt);
      if (idx < 0) idx = 0;
      const [picked] = rem.splice(idx, 1);
      const a = normFyArtist(picked);
      if (a) {
        lastArt = a;
        artCounts.set(a, (artCounts.get(a) || 0) + 1);
      }
      const sig = canonicalSongKey(picked) || String(picked.id || "");
      if (sig && globalUsedSigs) globalUsedSigs.add(sig);
      out.push(picked);
    }
    return out;
  }

  function forYouPlaylistList() {
    const h = state.home || {};
    const globalUsedSigs = new Set();
    let pls = (h.forYouPlaylists || []).slice(0, 10).map((p) => {
      const tracks = personalizeForYouCardTracks(p, globalUsedSigs);
      return {
        ...p,
        artwork: (tracks[0] && tracks[0].artwork && !String(tracks[0].artwork).startsWith("/cover")) ? tracks[0].artwork : (p.artwork || (tracks[0] && tracks[0].artwork) || ""),
        tracks,
      };
    });
    const taste = tasteProfile();
    // Taste-adaptive: reorder the cards so the moods matching the listener's
    // profile (their recent plays + likes) lead. Stable sort keeps the rest of
    // the order (Pop → Hip-Hop → …) when no taste exists, so a brand-new
    // listener still sees a sensible default row.
    if (taste.artists.length || taste.genres.length) {
      pls = pls
        .map((p, i) => ({ p, i, s: fyTasteScore(p, taste) }))
        .sort((a, b) => (b.s - a.s) || (a.i - b.i))
        .map((x) => x.p);
    }
    // If the API hasn't sent curated playlists yet (e.g. preview against an
    // older server), build a sensible default so the format still works.
    if (!pls.length) {
      const cache = fyCardCache();
      const defs = [
        { id: "fy-pop", title: "Pop Hits", subtitle: "Top English pop, right now", mood: "pop", genres: ["pop"], artwork: "", playlistId: "", query: "pop hits official audio", kind: "yt" },
        { id: "fy-hiphop", title: "Hip-Hop", subtitle: "Fresh flows & new drops", mood: "hiphop", genres: ["hiphop"], artwork: "", playlistId: "", query: "hip hop rap hits official audio", kind: "yt" },
        { id: "fy-rnb", title: "R&B", subtitle: "Smooth grooves", mood: "rnb", genres: ["rnb"], artwork: "", playlistId: "", query: "rnb soul hits official audio", kind: "yt" },
        { id: "fy-rock", title: "Rock", subtitle: "Earworms", mood: "rock", genres: ["rock"], artwork: "", playlistId: "", query: "rock hits official audio", kind: "yt" },
        { id: "fy-dance", title: "Dance Hits", subtitle: "Club-ready anthems", mood: "dance", genres: ["dance"], artwork: "", playlistId: "", query: "dance edm hits official audio", kind: "yt" },
        { id: "fy-indie", title: "Indie", subtitle: "New discoveries", mood: "indie", genres: ["indie"], artwork: "", playlistId: "", query: "indie alternative hits official audio", kind: "yt" },
        { id: "fy-trending", title: "Trending", subtitle: "What the world is playing", mood: "trending", genres: ["trending"], artwork: "", playlistId: "", query: "trending music hits", kind: "yt" },
        { id: "fy-chillv", title: "Chill Vibes", subtitle: "Easy listening, all day", mood: "chill", genres: ["chill"], artwork: "", playlistId: "", query: "chill vibes songs official audio", kind: "yt" },
        { id: "fy-workout", title: "Workout Energy", subtitle: "Push through the burn", mood: "workout", genres: ["workout"], artwork: "", playlistId: "", query: "workout motivation songs official audio", kind: "yt" },
        { id: "fy-throw", title: "Throwback", subtitle: "90s & 2000s classics", mood: "throwback", genres: ["throwback"], artwork: "", playlistId: "", query: "throwback 90s 2000s hits official audio", kind: "yt" },
      ];
      for (const d of defs) {
        const c = d.query && cache[d.query];
        if (c && c.id) d.playlistId = c.id;
        if (c && c.art) d.artwork = c.art;
      }
      pls = defs;
    }
    (pls || []).slice(0, 10).forEach((p, i) => { p._fyTasteScore = fyTasteScore(p, taste); });
    fyCardsList = pls;
    return pls;
  }

  function forYouCardHTML(p, i) {
    const art = p.artwork || (state.forYou && state.forYou[0] && state.forYou[0].artwork) || "/cover-default.jpg";
    const n = Math.max(0, (p.tracks || []).length);
    const count = n ? `${n} songs` : "Mix";
    return `<div class="card-wrap">
      <button type="button" class="card card-hit" data-open-fy="${i}">
        <div class="art">
          <img src="${escapeAttr(art)}" alt="" loading="lazy" onerror="this.src='/cover-default.jpg'"/>
          <span class="badge yt">Playlist</span>
        </div>
        <h3>${escapeHTML(p.title || "Playlist")}</h3>
        <p>${escapeHTML(p.subtitle || "Muchi mix")}</p>
        <em class="fy-count">${count}</em>
      </button>
    </div>`;
  }

  function forYouSection() {
    const pls = forYouPlaylistList();
    return `<div class="section"><div class="section-head"><h2>Made for you</h2><span>${pls.length}</span></div><div class="row">${pls.map(forYouCardHTML).join("")}</div></div>`;
  }

  // ---- Combined "Picked for your taste & artists you follow" playlist shelf (under Made for you) ----
  function tastePlaylistList() {
    const countryCode = String((state.prefs && state.prefs.country) || "US").toUpperCase();
    const prefGenres = Array.isArray(state.prefs.tasteGenres) ? state.prefs.tasteGenres : [];
    const prefMoods = Array.isArray(state.prefs.tasteMoods) ? state.prefs.tasteMoods : [];
    const prefEras = Array.isArray(state.prefs.tasteEras) ? state.prefs.tasteEras : [];
    const prefStyles = Array.isArray(state.prefs.tasteStyles) ? state.prefs.tasteStyles : [];
    const prefArtists = Array.isArray(state.prefs.tasteArtists) ? state.prefs.tasteArtists : [];
    const followedNames = (state.following || []).map((f) => f && f.name).filter(Boolean);
    const likedAndRecentArtists = [...(state.liked || []), ...(state.recents || [])]
      .map((t) => artistName(t))
      .filter((n) => n && n !== "YouTube");
    const allArtists = [...new Set([...followedNames, ...prefArtists, ...likedAndRecentArtists])];
    const tTracks = Array.isArray(state.tasteTracks) ? state.tasteTracks : [];
    const fTracks = Array.isArray(state.followedArtistTracks) ? state.followedArtistTracks : [];

    const allowIndian =
      countryCode === "IN" ||
      countryCode === "PK" ||
      countryCode === "BD" ||
      prefGenres.some((g) => /bollywood|punjabi|tamil|telugu|indie_in/i.test(g));

    // Gather fallback tracks from home shelves & Made for you so cards are always richly populated
    const homePool = [];
    const h = state.home || {};
    for (const s of (h.shelves || [])) {
      if (s && Array.isArray(s.tracks)) homePool.push(...s.tracks);
    }
    if (Array.isArray(h.youtubeLocal)) homePool.push(...h.youtubeLocal);
    if (Array.isArray(h.youtubeCharts)) homePool.push(...h.youtubeCharts);
    for (const p of (h.forYouPlaylists || [])) {
      if (p && Array.isArray(p.tracks)) homePool.push(...p.tracks);
    }

    const masterMix = weaveDiverseTracks(
      [tTracks, fTracks, state.liked || [], state.recents || [], homePool],
      48,
      2,
      countryCode,
      allowIndian
    );
    const artistMix = weaveDiverseTracks(
      [fTracks, tTracks, state.liked || [], homePool],
      32,
      2,
      countryCode,
      allowIndian
    );

    const cards = [];
    const seenTitles = new Set();
    const usedArtworks = new Set();

    function pickDistinctArtwork(trackList, fallbackArt) {
      for (const t of (trackList || [])) {
        const a = t && t.artwork;
        if (a && a !== "/cover-default.jpg" && !usedArtworks.has(a)) {
          usedArtworks.add(a);
          return a;
        }
      }
      if (fallbackArt && fallbackArt !== "/cover-default.jpg" && !usedArtworks.has(fallbackArt)) {
        usedArtworks.add(fallbackArt);
        return fallbackArt;
      }
      for (const t of masterMix) {
        const a = t && t.artwork;
        if (a && a !== "/cover-default.jpg" && !usedArtworks.has(a)) {
          usedArtworks.add(a);
          return a;
        }
      }
      return (trackList && trackList[0] && trackList[0].artwork) || fallbackArt || (masterMix[0] && masterMix[0].artwork) || "/cover-default.jpg";
    }

    function rotateTracks(idx, preferred) {
      const len = masterMix.length;
      const offset = len ? ((idx * 3) % len) : 0;
      const rotated = len ? masterMix.slice(offset).concat(masterMix.slice(0, offset)) : [];
      if (Array.isArray(preferred) && preferred.length) {
        return weaveDiverseTracks([preferred, rotated], 20, 2, countryCode, allowIndian);
      }
      return rotated.slice(0, 20);
    }

    function addCard(card) {
      if (!card || !card.title || cards.length >= 10) return;
      const key = String(card.title).toLowerCase().trim();
      if (seenTitles.has(key)) return;
      seenTitles.add(key);
      if (Array.isArray(card.tracks) && card.tracks.length) {
        card.tracks = mixThreeSourcesClient(card.tracks, homePool, card.tracks.length);
      }
      cards.push(card);
    }

    const countryGenres = getOnboardGenresForCountry(countryCode);
    const countryStyles = getOnboardStylesForCountry(countryCode);
    const countryArtists = getOnboardArtistsForCountry(countryCode);

    // 1. Master combined playlist mixing both Picked for your taste & Artists you follow + similar
    const topArtistLabel = allArtists.slice(0, 2).join(", ");
    const topGenreObjs = prefGenres.map((id) => findOnboardGenreById(id, countryCode)).filter(Boolean);
    const topGenreLabel = topGenreObjs.slice(0, 2).map((g) => g.title).join(" · ");
    const masterTracks = masterMix.length ? masterMix.slice(0, 24) : tTracks.slice(0, 24);

    addCard({
      id: "taste-master-mix",
      title: "Picked for Your Taste",
      subtitle: topGenreLabel && topArtistLabel
        ? `${topGenreLabel} · ${topArtistLabel} & more`
        : topGenreLabel || (topArtistLabel ? `Featuring ${topArtistLabel} & similar` : "Your personalized music mix"),
      artwork: pickDistinctArtwork(masterTracks, (tTracks[0] && tTracks[0].artwork)),
      query: (topGenreObjs[0] && topGenreObjs[0].query) || shelfQueryForCountryClient("pop", countryCode, "top hits official audio"),
      tracks: masterTracks,
    });

    // 2. Artists you follow & similar playlist card
    const aSub = allArtists.length
      ? `${allArtists.slice(0, 2).join(", ")} & similar artists`
      : "Followed artists & similar tracks";
    const fCardTracks = artistMix.length ? artistMix.slice(0, 24) : rotateTracks(1, fTracks);
    addCard({
      id: "taste-followed-mix",
      title: "Artists You Follow & Similar",
      subtitle: aSub,
      artwork: pickDistinctArtwork(fCardTracks, (fTracks[0] && fTracks[0].artwork)),
      query: allArtists[0]
        ? `songs like ${allArtists[0]} mix official audio`
        : shelfQueryForCountryClient("today", countryCode, "top hits official audio"),
      tracks: fCardTracks,
    });

    // 3. Dedicated artist + similar mix cards for followed/selected artists (up to 3)
    allArtists.slice(0, 3).forEach((aName, idx) => {
      const aLower = String(aName).toLowerCase();
      const matching = [...fTracks, ...tTracks, ...masterMix].filter((t) => String(artistName(t) || "").toLowerCase().includes(aLower));
      const mix = rotateTracks(idx + 2, matching);
      addCard({
        id: `taste-artist-${idx}`,
        title: `${aName} & Similar Mix`,
        subtitle: "Mixed with similar songs & your taste",
        artwork: pickDistinctArtwork(matching, _onbArtCache[aName] || (mix[0] && mix[0].artwork)),
        query: `songs like ${aName} mix official audio`,
        tracks: mix,
      });
    });

    // 4. Dedicated genre playlist cards from user's chosen genres
    topGenreObjs.forEach((gObj, idx) => {
      const mix = rotateTracks(cards.length + idx + 1);
      addCard({
        id: `taste-genre-${gObj.id}`,
        title: `${gObj.title} Mix`,
        subtitle: gObj.sub || "Picked for your taste",
        artwork: pickDistinctArtwork(mix),
        query: gObj.query,
        tracks: mix,
      });
    });

    // 5. Dedicated mood playlist cards from user's chosen moods
    prefMoods.forEach((mId, idx) => {
      const mObj = ONBOARD_MOODS.find((x) => x.id === mId);
      if (!mObj) return;
      const mix = rotateTracks(cards.length + idx + 1);
      addCard({
        id: `taste-mood-${mObj.id}`,
        title: `${mObj.title} Mix`,
        subtitle: mObj.sub || "Tailored mood playlist",
        artwork: pickDistinctArtwork(mix),
        query: mObj.query,
        tracks: mix,
      });
    });

    // 6. Dedicated style & era playlist cards from user's chosen styles/eras
    prefStyles.forEach((sId, idx) => {
      const sObj = countryStyles.find((x) => x.id === sId);
      if (!sObj) return;
      const mix = rotateTracks(cards.length + idx + 1);
      addCard({
        id: `taste-style-${sObj.id}`,
        title: `${sObj.title} Mix`,
        subtitle: sObj.sub || "Tailored listening vibe",
        artwork: pickDistinctArtwork(mix),
        query: sObj.query,
        tracks: mix,
      });
    });
    prefEras.forEach((eId, idx) => {
      const eObj = ONBOARD_ERAS.find((x) => x.id === eId);
      if (!eObj) return;
      const mix = rotateTracks(cards.length + idx + 1);
      addCard({
        id: `taste-era-${eObj.id}`,
        title: `${eObj.title} Mix`,
        subtitle: eObj.sub || "Era favorites",
        artwork: pickDistinctArtwork(mix),
        query: eObj.query,
        tracks: mix,
      });
    });

    // 7. Always top up to a full row of 10 playlists (using country-specific genres,
    //    local artists, styles, and moods) so the live website never stops at 4 playlists
    //    when a user only has followed artists or selected fewer options!
    for (const gObj of countryGenres) {
      if (cards.length >= 10) break;
      const mix = rotateTracks(cards.length + 1);
      addCard({
        id: `taste-country-genre-${gObj.id}`,
        title: `${gObj.title} Mix`,
        subtitle: gObj.sub || "Picked for your taste",
        artwork: pickDistinctArtwork(mix),
        query: gObj.query,
        tracks: mix,
      });
    }

    for (const art of countryArtists) {
      if (cards.length >= 10) break;
      if (!art || !art.name) continue;
      const aLower = String(art.name).toLowerCase();
      const matching = masterMix.filter((t) => String(artistName(t) || "").toLowerCase().includes(aLower));
      const mix = rotateTracks(cards.length + 1, matching);
      addCard({
        id: `taste-country-artist-${aLower.replace(/\s+/g, "-")}`,
        title: `${art.name} & Similar Mix`,
        subtitle: `${art.tag || "Popular artist"} · Mixed with similar songs`,
        artwork: pickDistinctArtwork(matching, _onbArtCache[art.name]),
        query: `songs like ${art.name} mix official audio`,
        tracks: mix,
      });
    }

    for (const mObj of ONBOARD_MOODS) {
      if (cards.length >= 10) break;
      const mix = rotateTracks(cards.length + 1);
      addCard({
        id: `taste-fallback-mood-${mObj.id}`,
        title: `${mObj.title} Mix`,
        subtitle: mObj.sub || "Tailored mood playlist",
        artwork: pickDistinctArtwork(mix),
        query: mObj.query,
        tracks: mix,
      });
    }

    return cards.slice(0, 10);
  }

  function tastePlaylistCardHTML(p, i) {
    const art = p.artwork || (p.tracks && p.tracks[0] && p.tracks[0].artwork) || "/cover-default.jpg";
    const n = Math.max(0, (p.tracks || []).length);
    const count = n ? `${n} songs` : "Mix";
    return `<div class="card-wrap">
      <button type="button" class="card card-hit" data-open-taste-pl="${i}">
        <div class="art">
          <img src="${escapeAttr(art)}" alt="" loading="lazy" onerror="this.src='/cover-default.jpg'"/>
          <span class="badge yt">Playlist</span>
        </div>
        <h3>${escapeHTML(p.title || "Taste Mix")}</h3>
        <p>${escapeHTML(p.subtitle || "Personalized mix")}</p>
        <em class="fy-count">${count}</em>
      </button>
    </div>`;
  }

  function tastePlaylistSection() {
    const pls = tastePlaylistList();
    if (!pls.length) return "";
    return `<div class="section">
      <div class="section-head">
        <button type="button" class="section-title" data-open-shelf="taste">Picked for your taste &amp; artists you follow</button>
        <button type="button" class="see-all" data-open-shelf="taste">See all</button>
      </div>
      <div class="row">${pls.map(tastePlaylistCardHTML).join("")}</div>
    </div>`;
  }

  function openTastePlaylist(i) {
    const p = tastePlaylistList()[i];
    if (!p) return;
    openCatalogPlaylist({
      title: p.title || "Picked for Your Taste",
      artist: p.subtitle || "Personalized mix",
      artwork: p.artwork || (p.tracks && p.tracks[0] && p.tracks[0].artwork) || "",
      query: p.query || "",
      tracks: (p.tracks || []).slice(),
    });
  }

  // ---- "Viral & Trending worldwide" home shelf ---------------------------
  // 10 playlist cards, each a different viral taste (TikTok, Reels, Facebook,
  // Shorts, sped-up, sudden breakouts, global buzz, soundtracks, dance
  // challenges, breakouts). Rendered straight from the home payload's
  // `viralPlaylists`; the server resolves each query against the live catalog
  // and KV-caches the build per utc-day, so the row auto-refreshes with new
  // trends like every other shelf. If the server hasn't sent them yet (older
  // backend), fall back to the same "Made for you" defaults so the section
  // never renders empty.
  function viralPlaylistList() {
    const h = state.home || {};
    let pls = (h.viralPlaylists || []).slice(0, 10);
    // Backend hasn't sent the viral row yet (older server / still building):
    // fall back to the curated "Made for you" cards so the section is fully
    // populated rather than empty. Prefer trend/global/pop-facing titles, and
    // top up to a full row from the rest of the curated list.
    if (!pls.length) {
      const fy = forYouPlaylistList().slice();
      pls = fy.filter((p) => /trend|viral|pop|chill|dance/i.test(String(p.title || ""))).slice(0, 10);
      if (pls.length < 5) pls = fy.slice(0, 10);
    }
    return pls;
  }

  function viralCardHTML(p, i) {
    const art = p.artwork || (p.tracks && p.tracks[0] && p.tracks[0].artwork) || "/cover-default.jpg";
    const n = Math.max(0, (p.tracks || []).length);
    const count = n ? `${n} songs` : "Trending";
    const emoji = ({ tiktok: "🎵", instagram: "📸", facebook: "👍", shorts: "⚡", spedup: "🚀", sudden: "💥", global: "🌍", soundtrack: "🎬", dance: "🕺", breaks: "🔥" })[p.taste] || "🔥";
    return `<div class="card-wrap">
      <button type="button" class="card card-hit" data-open-viral="${i}">
        <div class="art">
          <img src="${escapeAttr(art)}" alt="" loading="lazy" onerror="this.src='/cover-default.jpg'"/>
          <span class="badge yt">Viral</span>
        </div>
        <h3>${escapeHTML(p.title || "Viral Hit")} ${emoji}</h3>
        <p>${escapeHTML(p.subtitle || "Trending worldwide")}</p>
        <em class="fy-count">${count}</em>
      </button>
    </div>`;
  }

  function viralSection() {
    const pls = viralPlaylistList();
    if (!pls.length) return "";
    return `<div class="section"><div class="section-head"><h2>Viral &amp; trending this week</h2><span>${pls.length}</span></div><div class="row">${pls.map(viralCardHTML).join("")}</div></div>`;
  }

  function openViralPlaylist(i) {
    const p = viralPlaylistList()[i];
    if (!p) return;
    openCatalogPlaylist({
      title: p.title || "Viral Hit",
      artist: p.subtitle || "Trending worldwide",
      artwork: p.artwork || (p.tracks && p.tracks[0] && p.tracks[0].artwork) || "",
      playlistId: p.playlistId || "",
      query: p.query || "",
      tracks: (p.tracks || []).slice(),
      forYouMix: p.kind === "mix",
    });
  }

  function openForYouPlaylist(i) {
    const p = forYouPlaylistList()[i];
    if (!p) return;
    openCatalogPlaylist({
      title: p.title || "Playlist",
      artist: p.subtitle || "Muchi mix",
      artwork: p.artwork || (state.forYou && state.forYou[0] && state.forYou[0].artwork) || "",
      playlistId: p.playlistId || "",
      query: p.query || "",
      // Ship the songs the card already carries (the seed sends 20 per card)
      // so the playlist is fully populated the instant it opens; the server
      // fetch then refreshes/verifies. Always a distinct, mood-matched set.
      tracks: (p.tracks || []).slice(),
      forYouMix: p.kind === "mix",
      fyMood: p.mood || "",
      fyIndex: i,
    });
  }

  // ---- Browser-direct YouTube (Piped API) --------------------------------
  // The preview's sandbox server can't reach YouTube, so the browser resolves
  // real playlist IDs and fetches their tracks directly through public Piped
  // API instances (CORS-enabled). Used when the server path comes up empty.

  const PIPED = [
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.adminforge.de",
    "https://pipedapi.leptons.xyz",
    "https://api.piped.private.coffee",
  ];
  let pipedTurn = 0;

  async function pipedJson(path) {
    let lastErr = null;
    for (let k = 0; k < PIPED.length; k++) {
      const inst = PIPED[(pipedTurn + k) % PIPED.length];
      try {
        const r = await fetch(inst + path, { signal: AbortSignal.timeout(9000) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } catch (e) { lastErr = e; }
    }
    pipedTurn = (pipedTurn + 1) % PIPED.length;
    throw lastErr || new Error("piped unreachable");
  }

  function ytThumb(videoId) {
    return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
  }

  async function browserResolvePlaylist(query) {
    const q = encodeURIComponent(`${query} playlist`);
    let data = null;
    try { data = await pipedJson(`/search?q=${q}&filter=music_playlists`); } catch {}
    let items = (data && (data.items || [])) || [];
    if (!items.some((it) => it && it.playlistId)) {
      try { data = await pipedJson(`/search?q=${q}&filter=playlists`); } catch {}
      items = (data && (data.items || [])) || [];
    }
    const qw = String(query || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    let best = null, bs = 0;
    for (const it of items) {
      if (!it || !it.playlistId) continue;
      const t = String(it.name || "").toLowerCase();
      let s = 0;
      for (const w of qw) if (t.includes(w)) s += 1;
      if (s > bs) { bs = s; best = it; }
    }
    const hit = best || items.find((it) => it && it.playlistId) || null;
    if (!hit) throw new Error("no playlist found");
    return { playlistId: hit.playlistId, title: hit.name || query };
  }

  async function browserPlaylistTracks(playlistId) {
    const data = await pipedJson(`/playlists/${encodeURIComponent(playlistId)}`);
    const rows = (data && data.relatedStreams) || [];
    return rows
      .filter((r) => r && r.type === "stream" && r.url && r.url.includes("v="))
      .map((r) => {
        const videoId = (String(r.url).split("v=")[1] || "").split("&")[0];
        if (!videoId) return null;
        return {
          id: `yt:${videoId}`,
          source: "youtube",
          videoId,
          title: r.title || "Song",
          artist: r.uploaderName || "YouTube",
          album: "",
          duration: r.duration || 0,
          artwork: ytThumb(videoId),
        };
      })
      .filter(Boolean);
  }

  let fyHydrated = false;
  async function hydrateForYouCards() {
    const h = state.home;
    if (!h || fyHydrated) return;
    const cards = forYouPlaylistList().filter((p) => p.kind === "yt" && (!p.tracks || p.tracks.length < 10) && !p.playlistId && p.query);
    if (!cards.length) return;
    fyHydrated = true;
    const cache = fyCardCache();
    for (const p of cards) {
      try {
        const r = await browserResolvePlaylist(p.query);
        p.playlistId = r.playlistId;
        let art = (cache[p.query] && cache[p.query].art) || "";
        if (!art) {
          const tr = await browserPlaylistTracks(r.playlistId);
          if (tr[0]) art = tr[0].artwork;
        }
        if (art) p.artwork = art;
        cache[p.query] = { id: r.playlistId, art, at: Date.now() };
        paintHomeSoon();
      } catch {}
    }
    fyCardCacheSave(cache);
  }

  function searchChips() {
    const labels = {
      all: "All",
      songs: "Songs",
      itunes: "iTunes",
      deezer: "Deezer",
      youtube: "YouTube",
      audius: "Audius",
      artists: "Artists",
      playlists: "Playlists",
      albums: "Albums",
      radio: "Radio",
      history: "History",
    };
    return ["all", "songs", "itunes", "deezer", "youtube", "audius", "artists", "playlists", "albums", "radio", "history"].map((f) =>
      `<button class="chip ${state.filter === f ? "active" : ""}" data-filter="${f}">${labels[f] || f}</button>`
    ).join("");
  }

  function artistHitHTML(a, i) {
    return `<button type="button" class="lib-row artist" data-open-artist="${i}" data-artist-name="${escapeAttr(a.name || "")}" data-artist-id="${escapeAttr(a.id || "")}">
      <img class="round" src="${escapeAttr(a.artwork || "/cover-default.jpg")}" alt="" onerror="this.src='/cover-default.jpg'"/>
      <div>
        <div class="t-title">${escapeHTML(a.name)}</div>
        <div class="t-sub">Artist</div>
      </div>
    </button>`;
  }

  function playlistHitHTML(p) {
    const kind = p.recordType || (p.source === "apple" ? "Album" : p.source === "deezer" ? "Album" : "Playlist");
    const extra = [];
    if (p.year) extra.push(`${p.year}`);
    if (p.trackCount) extra.push(`${p.trackCount} songs`);
    return `<button type="button" class="lib-row" data-ytpl="${escapeAttr(p.playlistId || "")}" data-pl-q="${escapeAttr(p.query || p.title || "")}">
      <img src="${escapeAttr(p.artwork || "/cover-default.jpg")}" alt="" onerror="this.src='/cover-default.jpg'"/>
      <div>
        <div class="t-title">${escapeHTML(p.title)}</div>
        <div class="t-sub">${kind}${p.artist ? " · " + escapeHTML(p.artist) : ""}${extra.length ? " · " + escapeHTML(extra.join(" · ")) : ""}</div>
      </div>
    </button>`;
  }

  function pickTopArtist(s, query) {
    const arts = (s && s.artists) || [];
    if (!arts.length) return null;
    const q = dzFold(query || "");
    if (!q) return arts[0];
    return arts.find((a) => dzFold(a.name) === q)
      || arts.find((a) => dzFold(a.name).startsWith(q))
      || arts.find((a) => {
        const n = dzFold(a.name);
        return n.includes(q) || (n.length >= 4 && q.includes(n));
      })
      || arts[0];
  }

  function renderArtistPage() {
    const a = state.artistPage;
    if (!a) return "";
    const songs = (a.songs || []).filter(looksLikeSong);
    const albums = a.albums || [];
    return `
      <button class="chip-btn" id="artistBack" type="button"><span class="material-symbols-outlined">arrow_back</span> Back</button>
      <div class="artist-profile">
        <img class="artist-photo" src="${escapeAttr(a.artwork || "/cover-default.jpg")}" alt="" onerror="this.src='/cover-default.jpg'"/>
        <div>
          <p class="lib-kicker">Artist</p>
          <h1>${escapeHTML(a.name)}</h1>
          <p>${a.loading ? "Loading catalogue…" : `${songs.length} songs · ${albums.length} albums`}</p>
          <div class="artist-actions">
            ${songs.length ? `<button class="filled-btn" id="playArtist" type="button"><span class="material-symbols-outlined filled">play_arrow</span> Play</button>` : ""}
            <button class="tonal-btn" id="followArtist" type="button" title="${isFollowing({ artist: a.name, origName: a.origName, source: a.source }) ? "Click to unfollow " + escapeAttr(a.name) : "Follow " + escapeAttr(a.name)}">
              <span class="material-symbols-outlined">${isFollowing({ artist: a.name, origName: a.origName, source: a.source }) ? "person_remove" : "person_add"}</span>
              ${isFollowing({ artist: a.name, origName: a.origName, source: a.source }) ? "Unfollow" : "Follow"}
            </button>
          </div>
        </div>
      </div>
      ${a.loading ? skeleton() : `
        ${(a.popular || []).filter(looksLikeSong).length >= 3 ? (() => {
          const pop = (a.popular || []).filter(looksLikeSong).slice(0, 20);
          return `<div class="section"><div class="section-head"><h2>Popular</h2><span>${pop.length} most played</span></div><div class="list">${pop.map((t, i) => rowHTML(t, i)).join("")}</div></div>`;
        })() : ""}
        ${songs.length ? (() => {
          const shown = Math.min(Number(a.shown || 40), songs.length);
          const slice = songs.slice(0, shown);
          const rest = songs.length - shown;
          return `<div class="section"><div class="section-head"><h2>All songs</h2><span>${songs.length}${songs.length > 40 ? " · showing " + shown : ""}</span></div><div class="list">${slice.map((t, i) => rowHTML(t, i)).join("")}</div>${rest > 0 ? `<div class="set-row" style="padding:10px 8px"><button type="button" class="chip-btn" id="artistMore"><span class="material-symbols-outlined">unfold_more</span> Show ${Math.min(60, rest)} more (${rest} left)</button></div>` : ""}</div>`;
        })() : ""}
        ${albums.length ? (() => {
          const shown = Math.min(Number(a.albumsShown || 40), albums.length);
          const slice = albums.slice(0, shown);
          const rest = albums.length - shown;
          return `<div class="section"><div class="section-head"><h2>Albums</h2><span>${albums.length}${albums.length > 40 ? " · showing " + shown : ""}</span></div><div class="lib-list">${slice.map(playlistHitHTML).join("")}</div>${rest > 0 ? `<div class="set-row" style="padding:10px 8px"><button type="button" class="chip-btn" id="albumMore"><span class="material-symbols-outlined">unfold_more</span> Show ${Math.min(60, rest)} more (${rest} left)</button></div>` : ""}</div>`;
        })() : ""}
        ${(a.playlists || []).length ? (() => {
          const pls = a.playlists;
          return `<div class="section"><div class="section-head"><h2>Playlists</h2><span>${pls.length} on YouTube</span></div><div class="lib-list">${pls.map(playlistHitHTML).join("")}</div></div>`;
        })() : ""}
        ${!songs.length && !albums.length ? `<div class="empty"><h3>Nothing in the catalogue yet</h3><p>Try searching the name as a song.</p></div>` : ""}
      `}
    `;
  }

  function renderSearch() {
    if (state.artistPage) return renderArtistPage();
    const s = state.search;
    const chips = searchChips();
    const historyBlock = `
      <div class="section">
        <div class="section-head"><h2>History</h2><span>${state.recents.length}</span></div>
        <div class="list">${state.recents.length
          ? state.recents.map((t, i) => rowHTML(t, i)).join("")
          : `<p class="empty">Play a song and it will show up here.</p>`}</div>
      </div>`;
    if (state.filter === "history") {
      return `
        <div class="hero"><div><h1>History</h1><p>Songs you’ve played on this device.</p></div></div>
        <div class="chips">${chips}</div>
        ${historyBlock}`;
    }
    return `
      <div class="hero"><div><h1>Search</h1><p>${state.query ? `Results for “${escapeHTML(state.query)}”` : "Type an artist, song, or album."}</p></div></div>
      <div class="chips">${chips}</div>
      ${!s ? (state.query ? skeleton() : `<div class="empty"><h3>Start typing</h3><p>Try “Adele”, “Heeriye”, or a playlist name.</p></div>`) : searchBody(s)}
      ${!state.query ? historyBlock : ""}
    `;
  }

  function searchBody(s) {
    const f = state.filter;
    const isOffline = state.offlineMode || state.isNetworkOffline;
    const offlineBanner = isOffline ? `
      <div class="offline-banner">
        <div class="offline-banner-content">
          <span class="material-symbols-outlined" style="color:#ef4444">cloud_off</span>
          <div><strong>Offline Mode Active</strong><p>${state.offlineMode ? "Device offline mode is active." : "Network or server connection unavailable."} Showing downloaded tracks.</p></div>
        </div>
        <div class="offline-banner-actions">
          <button type="button" class="offline-retry-btn" id="offlineRetryBtn" title="Try reconnecting to server">
            <span class="material-symbols-outlined">sync</span>
            <span>Retry Connection</span>
          </button>
        </div>
      </div>` : "";

    const itunesSongs = (Array.isArray(s.itunes) && s.itunes.length) ? s.itunes : (Array.isArray(s.apple) && s.apple.length ? s.apple : (s.itunes || s.apple || []));
    if ((!Array.isArray(s.deezer) || !s.deezer.length) && (itunesSongs.length || (Array.isArray(s.youtube) && s.youtube.length))) {
      const seed = itunesSongs.length ? itunesSongs : s.youtube;
      s.deezer = seed.map((t) => normalizeClientDeezerTrack(t)).filter((t) => t && looksLikeSong(t));
    }
    const deezerSongs = Array.isArray(s.deezer) ? s.deezer : [];
    const youtubeSongs = s.youtube || [];
    const audiusSongs = s.audius || [];
    const offlineSongs = s.offline || [];
    const songs = [].concat(youtubeSongs, itunesSongs, deezerSongs, audiusSongs, offlineSongs);
    const artists = s.artists || [];
    const playlists = (s.playlists || []).filter((p) => p.source !== "apple" && p.source !== "deezer" && p.source !== "itunes");
    const albums = (s.playlists || []).filter((p) => p.source === "apple" || p.source === "deezer" || p.source === "itunes");
    const itunesAlbums = (s.playlists || []).filter((p) => p.source === "apple" || p.source === "itunes");
    const deezerAlbums = (s.playlists || []).filter((p) => p.source === "deezer");
    const radio = s.radio || [];
    const anyProviderFetching = providerFetchesInFlight.size > 0;
    const isSearchingItunes = (providerFetchesInFlight.has("apple") || providerFetchesInFlight.has("itunes")) && !itunesSongs.length;
    const isSearchingDeezer = providerFetchesInFlight.has("deezer") && !deezerSongs.length;
    const isSearchingYoutube = providerFetchesInFlight.has("youtube") && !youtubeSongs.length;
    const isSearchingAudius = providerFetchesInFlight.has("audius") && !audiusSongs.length;
    const empty = !songs.length && !artists.length && !playlists.length && !albums.length && !radio.length;
    if (empty && !anyProviderFetching) return `${offlineBanner}<div class="empty"><h3>No matches</h3><p>Try another spelling, or verify your downloaded library.</p></div>`;
    const top = pickTopArtist(s, state.query);
    const topIdx = top ? artists.indexOf(top) : -1;
    const hero = (f === "all" && top) ? `
      <button type="button" class="artist-hero" data-open-artist="${topIdx >= 0 ? topIdx : 0}" data-artist-name="${escapeAttr(top.name || "")}" data-artist-id="${escapeAttr(top.id || "")}">
        <img class="round" src="${escapeAttr(top.artwork || "/cover-default.jpg")}" alt="" onerror="this.src='/cover-default.jpg'"/>
        <div>
          <p class="lib-kicker">Artist</p>
          <h2>${escapeHTML(top.name)}</h2>
          <p>Open profile · songs & albums</p>
        </div>
        <span class="material-symbols-outlined">chevron_right</span>
      </button>` : "";
    if (f === "itunes") {
      return `
        ${offlineBanner}
        <div class="section">
          <div class="section-head"><h2>iTunes Songs</h2><span>${isSearchingItunes ? "" : itunesSongs.length}</span></div>
          <div class="list">${isSearchingItunes ? `<div class="loading-wrap" style="padding: 24px; text-align: center;"><div class="spinner" style="margin: 0 auto 10px;"></div><p style="color: var(--md-sys-color-on-surface-variant); font-size: 13px;">Searching iTunes catalogue…</p></div>` : (itunesSongs.length ? itunesSongs.map((t, i) => rowHTML(t, i)).join("") : `<p class="empty">No iTunes songs found for this search.</p>`)}</div>
        </div>
        ${itunesAlbums.length ? `<div class="section"><div class="section-head"><h2>iTunes Albums</h2><span>${itunesAlbums.length}</span></div><div class="lib-list">${itunesAlbums.map(playlistHitHTML).join("")}</div></div>` : ""}
      `;
    }
    if (f === "deezer") {
      return `
        ${offlineBanner}
        <div class="section">
          <div class="section-head"><h2>Deezer Songs</h2><span>${isSearchingDeezer ? "" : deezerSongs.length}</span></div>
          <div class="list">${isSearchingDeezer ? `<div class="loading-wrap" style="padding: 24px; text-align: center;"><div class="spinner" style="margin: 0 auto 10px;"></div><p style="color: var(--md-sys-color-on-surface-variant); font-size: 13px;">Searching Deezer catalogue…</p></div>` : (deezerSongs.length ? deezerSongs.map((t, i) => rowHTML(t, i)).join("") : `<p class="empty">No Deezer songs found for this search.</p>`)}</div>
        </div>
        ${deezerAlbums.length ? `<div class="section"><div class="section-head"><h2>Deezer Albums</h2><span>${deezerAlbums.length}</span></div><div class="lib-list">${deezerAlbums.map(playlistHitHTML).join("")}</div></div>` : ""}
      `;
    }
    if (f === "youtube") {
      return `
        ${offlineBanner}
        <div class="section">
          <div class="section-head"><h2>YouTube Music</h2><span>${isSearchingYoutube ? "" : youtubeSongs.length}</span></div>
          <div class="list">${isSearchingYoutube ? `<div class="loading-wrap" style="padding: 24px; text-align: center;"><div class="spinner" style="margin: 0 auto 10px;"></div><p style="color: var(--md-sys-color-on-surface-variant); font-size: 13px;">Searching YouTube catalogue…</p></div>` : (youtubeSongs.length ? youtubeSongs.map((t, i) => rowHTML(t, i)).join("") : `<p class="empty">No YouTube songs found for this search.</p>`)}</div>
        </div>
        ${playlists.length ? `<div class="section"><div class="section-head"><h2>Playlists</h2><span>${playlists.length}</span></div><div class="lib-list">${playlists.map(playlistHitHTML).join("")}</div></div>` : ""}
      `;
    }
    if (f === "audius") {
      return `
        ${offlineBanner}
        <div class="section">
          <div class="section-head"><h2>Audius Songs</h2><span>${isSearchingAudius ? "" : audiusSongs.length}</span></div>
          <div class="list">${isSearchingAudius ? `<div class="loading-wrap" style="padding: 24px; text-align: center;"><div class="spinner" style="margin: 0 auto 10px;"></div><p style="color: var(--md-sys-color-on-surface-variant); font-size: 13px;">Searching Audius catalogue…</p></div>` : (audiusSongs.length ? audiusSongs.map((t, i) => rowHTML(t, i)).join("") : `<p class="empty">No Audius songs found for this search.</p>`)}</div>
        </div>
      `;
    }
    if (f === "songs") {
      return `${offlineBanner}<div class="section"><div class="section-head"><h2>Songs</h2><span>${songs.length}</span></div><div class="list">${songs.map((t, i) => rowHTML(t, i)).join("")}</div></div>`;
    }
    if (f === "artists") {
      return `<div class="section"><div class="section-head"><h2>Artists</h2></div><div class="lib-list">${artists.map(artistHitHTML).join("") || `<p class="empty">No artists for this search.</p>`}</div></div>`;
    }
    if (f === "playlists") {
      return `<div class="section"><div class="section-head"><h2>Playlists</h2></div><div class="lib-list">${playlists.map(playlistHitHTML).join("") || `<p class="empty">No playlists for this search.</p>`}</div></div>`;
    }
    if (f === "albums") {
      return `<div class="section"><div class="section-head"><h2>Albums</h2></div><div class="lib-list">${albums.map(playlistHitHTML).join("") || `<p class="empty">No albums for this search.</p>`}</div></div>`;
    }
    if (f === "radio") {
      return `<div class="section"><div class="section-head"><h2>Radio</h2></div><div class="list">${radio.map((t, i) => rowHTML(t, i)).join("") || `<p class="empty">No stations.</p>`}</div></div>`;
    }
    return `
      ${offlineBanner}
      ${hero}
      <div class="section">
        <div class="section-head"><h2>All Songs</h2><span>${songs.length}</span></div>
        <div class="list">${songs.slice(0, 35).map((t, i) => rowHTML(t, i)).join("")}</div>
      </div>
      ${(itunesSongs && itunesSongs.length) ? `
      <div class="section">
        <div class="section-head"><h2>iTunes Songs</h2><span>${itunesSongs.length}</span></div>
        <div class="list">${itunesSongs.slice(0, 15).map((t, i) => rowHTML(t, i)).join("")}</div>
      </div>` : ""}
      ${(deezerSongs && deezerSongs.length) ? `
      <div class="section">
        <div class="section-head"><h2>Deezer Songs</h2><span>${deezerSongs.length}</span></div>
        <div class="list">${deezerSongs.slice(0, 15).map((t, i) => rowHTML(t, i)).join("")}</div>
      </div>` : ""}
      ${(youtubeSongs && youtubeSongs.length) ? `
      <div class="section">
        <div class="section-head"><h2>YouTube Songs</h2><span>${youtubeSongs.length}</span></div>
        <div class="list">${youtubeSongs.slice(0, 15).map((t, i) => rowHTML(t, i)).join("")}</div>
      </div>` : ""}
      ${(audiusSongs && audiusSongs.length) ? `
      <div class="section">
        <div class="section-head"><h2>Audius Songs</h2><span>${audiusSongs.length}</span></div>
        <div class="list">${audiusSongs.slice(0, 15).map((t, i) => rowHTML(t, i)).join("")}</div>
      </div>` : ""}
      ${artists.length ? `<div class="section"><div class="section-head"><h2>Artists</h2></div><div class="lib-list">${artists.slice(0, 20).map(artistHitHTML).join("")}</div></div>` : ""}
      ${albums.length ? `<div class="section"><div class="section-head"><h2>Albums</h2></div><div class="lib-list">${albums.slice(0, 20).map(playlistHitHTML).join("")}</div></div>` : ""}
      ${playlists.length ? `<div class="section"><div class="section-head"><h2>Playlists</h2></div><div class="lib-list">${playlists.slice(0, 20).map(playlistHitHTML).join("")}</div></div>` : ""}
      ${radio.length ? `<div class="section"><div class="section-head"><h2>Radio</h2></div><div class="list">${radio.slice(0, 6).map((t, i) => rowHTML(t, i)).join("")}</div></div>` : ""}
    `;
  }

  function renderRadio() {
    return `
      <div class="hero"><div><h1>Radio</h1><p>Thousands of live stations. No account needed.</p></div></div>
      <div class="chips">
        ${["hits", "bollywood", "jazz", "rock", "classical", "news", "india"].map((t) => `<button class="chip" data-radio-q="${t}">${t}</button>`).join("")}
      </div>
      <div class="row">${(state.radio || []).map(cardHTML).join("") || skeleton()}</div>
    `;
  }

  function renderLibrary() {
    const pl = state.activePlaylist;
    if (pl === "discovery") {
      const tracks = (state.discovery && state.discovery.tracks) || [];
      const week = (state.discovery && state.discovery.week) || "";
      return `
        <div class="lib-detail">
          <button class="chip-btn page-back" id="libBack" type="button"><span class="material-symbols-outlined">arrow_back</span> Back</button>
          <div class="lib-hero liked disc-hero">
            <div class="lib-liked-art disc-art" aria-hidden="true"><span class="material-symbols-outlined filled">auto_awesome</span></div>
            <div class="lib-hero-copy">
              <p class="lib-kicker">Playlist</p>
              <h1>Discovery Mix</h1>
              <p class="lib-stats">${trackStats(tracks)}</p>
              <p class="lib-note">${week ? "Week of " + escapeHTML(week) : "Refreshes every Monday"}</p>
              ${tracks.length ? `<button class="filled-btn" id="playDiscovery" type="button"><span class="material-symbols-outlined filled">play_arrow</span> Play</button>` : ""}
            </div>
          </div>
          <div class="list">${tracks.map((tr, i) => libTrackHTML(tr, i)).join("") || `<div class="empty"><h3>Mix is still building</h3><p>Open this again in a moment.</p></div>`}</div>
        </div>`;
    }
    if (pl === "catalog") {
      const p = state.catalogPlaylist || { title: "Playlist", tracks: [], loading: true };
      healPlaylistCoversClient(p);
      const tracks = p.tracks || [];
      const firstTrack = tracks[0] || null;
      const heroArt = (isCountryTrendPlId(p.shelfId) && firstTrack && firstTrack.artwork)
        ? firstTrack.artwork
        : (p.artwork || (firstTrack && firstTrack.artwork) || "/cover-default.jpg");
      return `
        <div class="lib-detail">
          <button class="chip-btn page-back" id="libBack" type="button"><span class="material-symbols-outlined">arrow_back</span> Back</button>
          <div class="lib-hero custom-pl" data-title="${escapeAttr((firstTrack && firstTrack.title) || p.title || "")}" data-artist="${escapeAttr((firstTrack && firstTrack.artist) || p.artist || "")}">
            <img class="lib-cover" src="${escapeAttr(heroArt)}" alt="" onerror="handleImgErr(this)"/>
            <div class="lib-hero-copy">
              <p class="lib-kicker">Playlist</p>
              <h1>${escapeHTML(p.title || "Playlist")}</h1>
              <p class="lib-stats">${p.loading ? "Loading songs…" : trackStats(tracks)}</p>
              <p class="lib-note">${escapeHTML(p.artist || "Muchi")}</p>
              ${tracks.length ? `<button class="filled-btn" id="playCatalog" type="button"><span class="material-symbols-outlined filled">play_arrow</span> Play</button>` : ""}
            </div>
          </div>
          <div class="list">${tracks.map((t, i) => libTrackHTML(t, i)).join("")}${p.loading ? `<div class="ly-wait">${tracks.length ? "Loading the rest of the playlist…" : "Loading songs…"}</div>` : (tracks.length ? "" : `<div class="empty"><h3>No songs in this playlist</h3></div>`)}</div>
        </div>`;
    }
    if (pl === "liked") {
      return `
        <div class="lib-detail">
          <button class="chip-btn page-back" id="libBack" type="button"><span class="material-symbols-outlined">arrow_back</span> Back</button>
          <div class="lib-hero liked">
            <div class="lib-liked-art" aria-hidden="true"><span class="material-symbols-outlined filled">favorite</span></div>
            <div class="lib-hero-copy">
              <p class="lib-kicker">Playlist</p>
              <h1>Liked Songs</h1>
              <p class="lib-stats">${trackStats(state.liked)}</p>
              <p class="lib-note">Your hearts on this phone</p>
              ${state.liked.length ? `<button class="filled-btn" id="playLiked" type="button"><span class="material-symbols-outlined filled">play_arrow</span> Play</button>` : ""}
            </div>
          </div>
          <div class="list">${state.liked.map((t, i) => libTrackHTML(t, i)).join("") || emptyLib()}</div>
        </div>`;
    }
    if (pl === "downloads") {
      const tracks = state.downloads || [];
      const withLyricsCount = tracks.filter((d) => hasOfflineSyncedLyrics(d)).length;
      return `
        <div class="lib-detail">
          <button class="chip-btn page-back" id="libBack" type="button"><span class="material-symbols-outlined">arrow_back</span> Back</button>
          <div class="lib-hero liked dl-hero">
            <div class="lib-liked-art dl" aria-hidden="true"><span class="material-symbols-outlined filled">download_for_offline</span></div>
            <div class="lib-hero-copy">
              <p class="lib-kicker">Playlist</p>
              <h1>Downloads</h1>
              <p class="lib-stats">${trackStats(tracks)}${tracks.length ? ` · ${withLyricsCount}/${tracks.length} with synced lyrics` : ""}</p>
              <p class="lib-note">Saved on this device with synced lyrics for offline listening</p>
              <div class="lib-hero-actions">
                ${tracks.length ? `<button class="filled-btn" id="playDownloads" type="button"><span class="material-symbols-outlined filled">play_arrow</span> Play</button>` : ""}
                ${tracks.length ? `<button class="chip-btn" id="syncOfflineLyricsBtn" type="button"><span class="material-symbols-outlined">subtitles</span> Sync Lyrics</button>` : ""}
                ${tracks.length ? `<button class="chip-btn" id="clearDownloads" type="button"><span class="material-symbols-outlined">delete_sweep</span> Delete all</button>` : ""}
              </div>
            </div>
          </div>
          <div class="list">${tracks.map((t, i) => libTrackHTML(t, i, { isDownload: true })).join("") || emptyLib()}</div>
        </div>`;
    }
    if (pl === "yt-liked") {
      const L = state.ytLiked || { tracks: [], loading: true };
      const tracks = L.tracks || [];
      return `
        <div class="lib-detail">
          <button class="chip-btn page-back" id="libBack" type="button"><span class="material-symbols-outlined">arrow_back</span> Back</button>
          <div class="lib-hero liked">
            <div class="lib-liked-art" aria-hidden="true"><span class="material-symbols-outlined filled">thumb_up</span></div>
            <div class="lib-hero-copy">
              <p class="lib-kicker">YouTube</p>
              <h1>Liked Songs</h1>
              <p class="lib-stats">${tracks.length ? trackStats(tracks) : ""}</p>
              <p class="lib-note">From your YouTube account</p>
              ${tracks.length ? `<button class="filled-btn" id="playYtLiked" type="button"><span class="material-symbols-outlined filled">play_arrow</span> Play</button>` : ""}
            </div>
          </div>
          ${L.loading ? `<div class="ly-wait">Loading YouTube likes…</div>` : (L.error ? `<div class="empty"><h3>Couldn't load YouTube likes</h3><p>Check your connection or reconnect YouTube in Settings.</p></div>` : `<div class="list">${tracks.map((t, i) => libTrackHTML(t, i)).join("") || emptyLib()}</div>`)}
        </div>`;
    }
    if (typeof pl === "string" && pl.indexOf("yt-pl:") === 0) {
      const o = state.ytOpen || { title: "Playlist", tracks: null, loading: true };
      const tracks = o.tracks || [];
      return `
        <div class="lib-detail">
          <button class="chip-btn page-back" id="libBack" type="button"><span class="material-symbols-outlined">arrow_back</span> Back</button>
          <div class="lib-hero custom-pl">
            <img class="lib-cover" src="${escapeAttr(o.artwork || (tracks[0] && tracks[0].artwork) || "/cover-default.jpg")}" alt="" onerror="this.src='/cover-default.jpg'"/>
            <div class="lib-hero-copy">
              <p class="lib-kicker">YouTube Playlist</p>
              <h1>${escapeHTML(o.title || "Playlist")}</h1>
              <p class="lib-stats">${o.loading ? "Loading songs…" : trackStats(tracks)}</p>
              <p class="lib-note">From your YouTube account</p>
              ${tracks.length ? `<button class="filled-btn" id="playYtPl" type="button"><span class="material-symbols-outlined filled">play_arrow</span> Play</button>` : ""}
            </div>
          </div>
          ${o.loading ? `<div class="ly-wait">Loading songs…</div>` : (o.error ? `<div class="empty"><h3>Couldn't load this playlist</h3><p>Check your connection or reconnect YouTube in Settings.</p></div>` : `<div class="list">${tracks.map((t, i) => libTrackHTML(t, i)).join("") || emptyLib()}</div>`)}
        </div>`;
    }
    if (typeof pl === "number" && state.playlists[pl]) {
      const p = state.playlists[pl];
      return `
        <div class="lib-detail">
          <button class="chip-btn page-back" id="libBack" type="button"><span class="material-symbols-outlined">arrow_back</span> Back</button>
          <div class="pl-banner${p.banner ? " has-img" : ""}" id="plBanner">
            <button type="button" class="chip-btn pl-banner-btn" id="pickPlBanner">
              <span class="material-symbols-outlined">wallpaper</span>
              ${p.banner ? "Change banner" : "Add banner"}
            </button>
            <div class="lib-hero custom-pl">
              <button type="button" class="lib-cover-btn" id="pickPlCover" title="Change picture">
                <img class="lib-cover" src="${escapeAttr(playlistArt(p))}" alt="" onerror="this.src='/cover-default.jpg'"/>
                <span class="lib-cover-edit"><span class="material-symbols-outlined">photo_camera</span></span>
              </button>
              <div class="lib-hero-copy">
                <p class="lib-kicker">Playlist</p>
                <h1>${escapeHTML(p.name)}</h1>
                <p class="lib-stats">${trackStats(p.tracks)}</p>
                <p class="lib-note">${p.tracks.length ? "Made by you" : "Empty playlist"}</p>
                <div class="lib-hero-actions">
                  ${p.tracks.length ? `<button class="filled-btn" id="playPl" type="button"><span class="material-symbols-outlined filled">play_arrow</span> Play</button>` : ""}
                  <button class="chip-btn" id="editPlLook" type="button">Edit look</button>
                  <button class="chip-btn" data-del-pl="${pl}" type="button">Delete</button>
                </div>
              </div>
            </div>
          </div>
          <div class="list">${p.tracks.map((t, i) => libTrackHTML(t, i)).join("") || emptyLib()}</div>
          ${p.tracks.length ? `
          <section class="pl-recs">
            <h2>Recommended</h2>
            <p class="pl-recs-sub">Similar to songs in this playlist</p>
            ${plRecs.loading && String(plRecs.key).split(":")[0] === String(pl) ? `<div class="ly-wait">Finding similar songs…</div>` : ""}
            <div class="list">${(String(plRecs.key).split(":")[0] === String(pl) ? plRecs.tracks : []).map((t) => `
              <div class="track-row lib-track rec-row">
                <button type="button" class="lib-track-main" data-rec-play="${escapeAttr(t.id)}">
                  <img src="${escapeAttr(artUrl(t))}" alt="" loading="lazy" onerror="this.src='/cover-default.jpg'"/>
                  <div>
                    <div class="t-title">${escapeHTML(t.title)}</div>
                    <div class="t-sub">${escapeHTML(t.artist)}</div>
                  </div>
                </button>
                <button type="button" class="chip-btn rec-add" data-add-rec="${escapeAttr(t.id)}">Add</button>
              </div>`).join("")}
            </div>
          </section>` : ""}
        </div>`;
    }
    const f = state.libFilter || "all";
    if (state.auth && state.auth.signedIn && state.auth.youtube && state.auth.youtube.connected) {
      if (!state.ytLiked) loadYtLiked();
      if (!state.ytPlaylists) loadYtPlaylists();
    }
    const chips = ["all", "playlists", "artists", "downloaded"].map((id) => {
      const label = id === "all" ? "Recents" : id[0].toUpperCase() + id.slice(1);
      return `<button class="chip ${f === id ? "active" : ""}" data-lib-filter="${id}">${label}</button>`;
    }).join("");
    const likedRow = `
      <button type="button" class="lib-row" data-open-liked>
        <div class="lib-liked-art sm"><span class="material-symbols-outlined filled">favorite</span></div>
        <div>
          <div class="t-title">Liked Songs</div>
          <div class="t-sub">Playlist · ${trackStats(state.liked)}</div>
        </div>
      </button>`;
    const downloadRow = `
      <button type="button" class="lib-row" data-open-downloads>
        <div class="lib-liked-art sm dl"><span class="material-symbols-outlined filled">download_for_offline</span></div>
        <div>
          <div class="t-title">Downloads</div>
          <div class="t-sub">Playlist · ${trackStats(state.downloads)}</div>
        </div>
      </button>`;
    const playlistRows = state.playlists.map((p, i) => `
      <button type="button" class="lib-row" data-open-pl="${i}">
        <img src="${escapeAttr(playlistArt(p))}" alt="" onerror="this.src='/cover-default.jpg'"/>
        <div>
          <div class="t-title">${escapeHTML(p.name)}</div>
          <div class="t-sub">Playlist · ${trackStats(p.tracks)}</div>
        </div>
      </button>`).join("");
    const artistRows = state.following.map((a) => `
      <button type="button" class="lib-row artist" data-artist="${escapeAttr(a.key)}">
        <img class="round" src="${escapeAttr(a.artwork || "/cover-default.jpg")}" alt="" onerror="this.src='/cover-default.jpg'"/>
        <div>
          <div class="t-title">${escapeHTML(a.name)}</div>
          <div class="t-sub">Artist · Following</div>
        </div>
      </button>`).join("");
    const dlRows = state.downloads.map((t, i) => libTrackHTML(t, i, { isDownload: true })).join("");
    const ytOn = !!(state.auth && state.auth.signedIn && state.auth.youtube && state.auth.youtube.connected);
    let ytRows = "";
    if (ytOn) {
      const likedRowYt = state.ytLiked
        ? (state.ytLiked.error
          ? `<p class="yt-note">Couldn't load YouTube likes.</p>`
          : `<button type="button" class="lib-row" data-open-yt-liked>
              <div class="lib-liked-art sm yt"><span class="material-symbols-outlined filled">thumb_up</span></div>
              <div>
                <div class="t-title">Liked Songs</div>
                <div class="t-sub">YouTube · ${state.ytLiked.tracks.length} song${state.ytLiked.tracks.length === 1 ? "" : "s"}${state.ytLiked.truncated ? "+" : ""}</div>
              </div>
            </button>`)
        : `<div class="ly-wait">Loading YouTube likes…</div>`;
      const plsYt = state.ytPlaylists
        ? (state.ytPlaylists.error
          ? `<p class="yt-note">Couldn't load YouTube playlists.</p>`
          : state.ytPlaylists.map((p) => `
            <button type="button" class="lib-row" data-open-yt-pl="${escapeAttr(p.id)}">
              <img src="${escapeAttr(p.artwork || "/cover-default.jpg")}" alt="" onerror="this.src='/cover-default.jpg'"/>
              <div>
                <div class="t-title">${escapeHTML(p.title)}</div>
                <div class="t-sub">Playlist · ${p.count} item${p.count === 1 ? "" : "s"}</div>
              </div>
            </button>`).join(""))
        : `<div class="ly-wait">Loading YouTube playlists…</div>`;
      ytRows = `
        <div class="yt-group">
          <div class="yt-head"><h2>YouTube</h2><button type="button" class="chip-btn" id="ytRefresh" title="Refresh YouTube library"><span class="material-symbols-outlined">refresh</span> Refresh</button></div>
          ${state.ytReconnect ? `<div class="yt-note">YouTube access expired or was revoked. <button type="button" class="chip-btn" id="ytReconnectBtn"><span class="material-symbols-outlined">link</span> Reconnect YouTube</button></div>` : ""}
          ${likedRowYt}
          ${plsYt}
        </div>`;
    } else if (state.auth && state.auth.signedIn) {
      ytRows = `
        <div class="yt-group">
          <div class="yt-head"><h2>YouTube</h2></div>
          <div class="yt-connect">
            <span class="material-symbols-outlined">link</span>
            <div>
              <div class="t-title">Connect YouTube</div>
              <p class="yt-connect-sub">Your Google sign-in covers your account, but it does <strong>not</strong> include access to YouTube — that's a second, one-time permission. Tap Connect, approve once on YouTube's page, and your YouTube likes &amp; playlists will appear here.</p>
            </div>
            <button type="button" class="chip-btn" id="ytConnectNow"><span class="material-symbols-outlined">open_in_new</span> Connect</button>
          </div>
        </div>`;
    }
    let body = "";
    if (f === "playlists") {
      body = likedRow + downloadRow + ytRows + (playlistRows || `<p class="empty">Create a playlist with the + button.</p>`);
    } else if (f === "artists") {
      body = artistRows || `<p class="empty">Follow an artist from the player.</p>`;
    } else if (f === "downloaded") {
      body = downloadRow + (dlRows || `<p class="empty">Save a track (YouTube or independent Audius) from the player to listen offline.</p>`);
    } else {
      body = likedRow + downloadRow + ytRows + playlistRows + artistRows;
      if (!state.playlists.length && !state.following.length && !state.downloads.length) {
        body += `<p class="empty">Heart songs, save downloads, follow artists, or make a playlist — they’ll land here.</p>`;
      }
    }
    return `
      <div class="lib-head">
        <h1>Your Library</h1>
        <button class="icon-btn" id="newPl2" type="button" title="Create playlist">
          <span class="material-symbols-outlined">add</span>
        </button>
      </div>
      <div class="chips lib-chips">${chips}</div>
      <div class="lib-list">${body}</div>
    `;
  }

  function emptyLib() { return `<div class="empty"><h3>Nothing here yet</h3></div>`; }

  function githubRepo() {
    const u = String(state.prefs.github || "https://github.com/Kaibshshdheueejw/Muchi").replace(/\/$/, "");
    const m = u.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
    if (!m) return { url: "https://github.com/Kaibshshdheueejw/Muchi", owner: "Kaibshshdheueejw", repo: "Muchi" };
    const owner = m[1];
    const repo = m[2].replace(/\.git$/i, "").replace(/^Muchi-music(?:-New)?$/i, "Muchi");
    return { url: `https://github.com/${owner}/${repo}`, owner, repo };
  }
  function parseVer(s) {
    const m = String(s || "").replace(/^v/i, "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!m) return [0, 0, 0];
    return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
  }
  function verNewer(a, b) {
    const A = parseVer(a), B = parseVer(b);
    for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] > B[i];
    return false;
  }
  function isMuchiApp() {
    return !!(window.MuchiAndroid || /MuchiApp/i.test(navigator.userAgent || ""));
  }
  function apkFromRelease(d) {
    const assets = (d && d.assets) || [];
    const hit = assets.find((a) => /muchi\.apk$/i.test(a.name || ""))
      || assets.find((a) => /\.apk$/i.test(a.name || ""));
    return hit && hit.browser_download_url;
  }
  function apkUrl() {
    const u = state.update && (state.update.apk || (state.update.latest && state.update.latest.apk));
    if (u) return u;
    const gh = githubRepo();
    return gh ? `${gh.url}/releases/latest/download/Muchi.apk` : "";
  }
  /* ── What's new (in-app popup) ───────────────────────────────────────
     Item 8: the Settings "What's new" button used to open a browser tab.
     It now shows a lightweight in-app modal listing what changed in the
     current release, so the user never leaves the app for a changelog. */
  const WHATS_NEW = [
    {
      ver: "1.9.1",
      title: "Muchi 1.9.1",
      notes: [
        "Unified Web & Native App song search listings with direct residential iTunes & Deezer enrichment and YouTube catalog completion.",
        "Unified Web & Native App Artist pages so Popular and All Songs display the exact same top studio hits in priority order.",
        "Fixed Native App song playback to always resolve the exact official original studio song and prevent unofficial SoundCloud/Audius remixes or covers.",
      ],
    },
    {
      ver: "1.9.0",
      title: "Muchi 1.9.0",
      notes: [
        "Accurate synced lyrics for all songs in the native app with 180ms real-time lyric tracking and collaborating artist lookup.",
        "Smarter iTunes & Deezer search intelligence returning 40–80 curated vocal songs with exact song first and broad artist catalog picks.",
        "Fixed Settings → Legal & Privacy back navigation so closing Privacy Policy or Terms of Service returns directly to Settings without reloading.",
        "Refined native tactile press and click feedback across all buttons, cards, and controls.",
      ],
    },
    {
      ver: "1.8.9",
      title: "Muchi 1.8.9",
      notes: [
        "Fixed Native App playback timer and seek bar so progress advances smoothly from 0:00 in real time.",
        "Fixed Native App synced lyrics highlighting and auto-scrolling during playback.",
        "Eliminated 1-minute (983 KB) stream cutoffs by filtering capped mobile InnerTube streams and adding on-device SoundCloud and JioSaavn fallbacks.",
      ],
    },
    {
      ver: "1.8.8",
      title: "Muchi 1.8.8",
      notes: [
        "Verified Native App timer, seek bar, and synced lyrics auto-scroll with direct WebView progress sync and native status polling.",
        "Verified full-length playback past 1 minute by removing 983 KB capped mobile InnerTube streams and adding on-device SoundCloud and JioSaavn fallbacks.",
      ],
    },
    {
      ver: "1.8.7",
      title: "Muchi 1.8.7",
      notes: [
        "Fixed Native App playback timer and seek bar so progress advances smoothly from 0:00 in real time.",
        "Fixed Native App synced lyrics highlighting and auto-scrolling during playback.",
        "Eliminated 1-minute (983 KB) stream cutoffs by filtering capped mobile streams and adding full-track on-device fallbacks.",
      ],
    },
    {
      ver: "1.8.6",
      title: "Muchi 1.8.6",
      notes: [
        "Eliminated mid-song (~1-minute) native stream cutoffs across iTunes, Deezer, and YouTube tracks.",
        "Added automatic mid-song stream recovery, qKey cache invalidation, and native duration verification.",
        "Upgraded Native App Phone Speaker 6-zone acoustic DSP on Android and iOS.",
      ],
    },
    {
      ver: "1.8.5",
      title: "Muchi 1.8.5",
      notes: [
        "Verified full-track native audio playback and instant random timer seeking (1:20+) across YouTube, iTunes, Deezer, and Audius.",
        "Improved keyframe seek tolerance and native audio cache MIME detection on Android and iOS.",
      ],
    },
    {
      ver: "1.8.1",
      title: "Muchi 1.8.1",
      notes: [
        "Faster, deterministic offline song downloads across Web, Android, and iOS.",
        "Fixed back navigation when opening Song Details from Lyrics Player options.",
      ],
    },
    {
      ver: "1.8.0",
      title: "Muchi 1.8.0",
      notes: [
        "3-dot track options menu added to songs inside YouTube Likes and imported YouTube playlists.",
        "Unlike/remove songs directly from YouTube Likes and YouTube playlists inside Muchi.",
      ],
    },
    {
      ver: "1.7.9",
      title: "Muchi 1.7.9",
      notes: [
        "New Genshin Impact Animated UI with Paimon, Aether & Lumine interactive greeting letters.",
        "Offline synced lyrics download and time-aligned playback without an internet connection.",
        "Updated 2-column Animated UI theme cards in Settings.",
      ],
    },
    {
      ver: "1.7.8",
      title: "Muchi 1.7.8",
      notes: [
        "Reliable background and lock-screen music playback on Android and iOS.",
        "Full-song offline downloads that save cleanly to your device.",
        "Updated Terms of Service, Privacy Policy, and smoother Lyrics & Settings layout.",
      ],
    },
    {
      ver: "1.7.7",
      title: "Muchi 1.7.7",
      notes: [
        "Faster song start times when tapping to play.",
        "Improved lock-screen controls and playback stability.",
      ],
    },
    {
      ver: "1.7.6",
      title: "Muchi 1.7.6",
      notes: [
        "Richer phone speaker sound, deeper bass, and clearer vocals.",
        "Full-length high-quality audio streaming for every track.",
      ],
    },
    {
      ver: "1.7.5",
      title: "Muchi 1.7.5",
      notes: [
        "New animated progress bar styles in Settings → Player.",
        "Smooth seeking and synced lyrics for offline downloaded songs.",
      ],
    },
    {
      ver: "1.7.4",
      title: "Muchi 1.7.4",
      notes: [
        "Smoother song timer bar and live wave progress.",
        "Enhanced Sound Stage audio presets across all devices.",
      ],
    },
    {
      ver: "1.7.3",
      title: "Muchi 1.7.3",
      notes: [
        "Improved offline song downloads and instant offline playback.",
      ],
    },
    {
      ver: "1.7.2",
      title: "Muchi 1.7.2",
      notes: [
        "Quicker song loading across YouTube, Apple Music, Deezer, and Audius.",
      ],
    },
    {
      ver: "1.6.9",
      title: "Muchi 1.6.9",
      notes: [
        "Refined mini-player and Now Playing design with all 4 player styles.",
        "Quick access to Download, Sleep Timer, Follow Artist, and Share.",
      ],
    },
    {
      ver: "1.6.8",
      title: "Muchi 1.6.8",
      notes: [
        "New Winter, Christmas, and Autumn visual themes in Settings → UI.",
      ],
    },
    {
      ver: "1.6.7",
      title: "Muchi 1.6.7",
      notes: [
        "Personalized music taste onboarding and regional artist picks.",
        "Automatic YouTube Liked Songs and Playlists sync on sign-in.",
      ],
    },
  ];
  function whatsNewBody() {
    return WHATS_NEW.map((r) => `
      <div class="wn-release">
        <div class="wn-ver">${escapeHTML(r.title || r.ver)}</div>
        <ul class="wn-list">${(r.notes || []).map((n) => `<li>${escapeHTML(n)}</li>`).join("")}</ul>
      </div>`).join("");
  }
  function openWhatsNew() {
    const modal = $("modal");
    const card = $("modalCard");
    clearTimeout(hideModal._t);
    modal.classList.add("sheet");
    card.innerHTML = `<div class="sheet-handle" aria-hidden="true"></div><h2>What's new</h2>
      <div class="wn-scroll">${whatsNewBody()}</div>
      <p class="wn-foot">Installed version <strong>${escapeHTML(APP_VERSION)}</strong>.</p>
      <div class="modal-actions"><button class="btn ghost" id="mCancel">Close</button></div>`;
    showEl(modal, true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => modal.classList.add("in"));
    });
    $("mCancel").onclick = () => hideModal();
    modal.onclick = (e) => { if (e.target === modal) hideModal(); };
  }

  function legalDocumentBody(kind) {
    if (kind === "terms") {
      return `
        <div class="wn-release">
          <div class="wn-ver">Last updated: September 29, 2026</div>
          <p style="margin:6px 0 10px;opacity:.9">These Terms of Service govern your use of the Muchi website, progressive web app, mobile application, and related services.</p>
        </div>
        <div class="wn-release">
          <div class="wn-ver">1. Agreement</div>
          <p style="margin:6px 0">By accessing or using Muchi, you agree to these Terms of Service and the <a href="/privacy.html" data-legal="privacy">Muchi Privacy Policy</a>. If you do not agree, do not use Muchi.</p>
        </div>
        <div class="wn-release">
          <div class="wn-ver">2. The service</div>
          <p style="margin:6px 0">Muchi is a music discovery and playback application. Features may include search, music metadata, playback, lyrics, radio, local playlists, queue controls, downloads where supported, optional Google sign-in, and optional YouTube connection.</p>
          <p style="margin:6px 0">Features and provider availability may vary by country, device, account, music provider, copyright restrictions, or provider API availability.</p>
        </div>
        <div class="wn-release">
          <div class="wn-ver">3. Eligibility and accounts</div>
          <p style="margin:6px 0">You must be old enough to use the service under the laws applicable to you. You are responsible for the accuracy of information you provide and for protecting access to your Google account and Muchi session.</p>
          <p style="margin:6px 0">Google sign-in identifies your Muchi account. You do not give Muchi your Google password. You may use Muchi without connecting YouTube, but some YouTube Library features require a separate authorization.</p>
        </div>
        <div class="wn-release">
          <div class="wn-ver">4. Google and YouTube services</div>
          <p style="margin:6px 0">Google and YouTube are third-party services. If you choose to connect YouTube, you authorize Muchi to use the requested YouTube permissions for the features shown to you. Muchi only performs likes, ratings, playlist additions, or other account actions after your request.</p>
          <p style="margin:6px 0">Your use of YouTube is also subject to Google's and YouTube's own terms, policies, and privacy practices. Muchi is not Google, YouTube, or a Google product and is not affiliated with Google or YouTube.</p>
        </div>
        <div class="wn-release">
          <div class="wn-ver">5. Music and third-party content</div>
          <p style="margin:6px 0">Music, artwork, lyrics, radio streams, metadata, and other content may be supplied by third-party providers. Muchi does not guarantee that any particular song, stream, lyric, artist, album, or provider result will remain available or accurate.</p>
          <p style="margin:6px 0">You are responsible for using third-party content lawfully and respecting the terms and rights of the applicable provider and rights holder.</p>
        </div>
        <div class="wn-release">
          <div class="wn-ver">6. Acceptable use</div>
          <ul class="wn-list">
            <li>Do not use Muchi to violate law, copyright, privacy, or the terms of a music provider.</li>
            <li>Do not attempt to bypass authentication, rate limits, security controls, or provider restrictions.</li>
            <li>Do not use Muchi to distribute malware, spam, abuse, harassment, or deceptive content.</li>
            <li>Do not scrape, overload, reverse engineer, or interfere with Muchi or its infrastructure.</li>
            <li>Do not use another person's Google or YouTube account without permission.</li>
          </ul>
        </div>
        <div class="wn-release">
          <div class="wn-ver">7. Your content and feedback</div>
          <p style="margin:6px 0">You retain rights to content you submit to Muchi. You grant Muchi only the limited permission needed to process that content to provide the feature you requested.</p>
        </div>
        <div class="wn-release">
          <div class="wn-ver">8. Availability, disclaimers &amp; limitation of liability</div>
          <p style="margin:6px 0">To the maximum extent permitted by law, Muchi is provided "as is" and "as available." Mochi and Muchi will not be liable for indirect, incidental, special, consequential, exemplary, or loss-of-data damages arising from or related to your use of Muchi or third-party services.</p>
        </div>
        <div class="wn-release">
          <div class="wn-ver">9. Contact</div>
          <p style="margin:6px 0">Questions about these Terms can be sent to <a href="mailto:twiarimascord@gmail.com">twiarimascord@gmail.com</a>.</p>
        </div>`;
    }
    return `
      <div class="wn-release">
        <div class="wn-ver">Last updated: September 29, 2026</div>
        <p style="margin:6px 0 10px;opacity:.9">This Privacy Policy explains how Muchi collects, uses, stores, and shares information when you use the Muchi website, progressive web app, or Muchi mobile application.</p>
      </div>
      <div class="wn-release">
        <div class="wn-ver">1. Who operates Muchi</div>
        <p style="margin:6px 0">Muchi is operated by <strong>Mochi</strong>. Questions about privacy can be sent to <a href="mailto:twiarimascord@gmail.com">twiarimascord@gmail.com</a>.</p>
      </div>
      <div class="wn-release">
        <div class="wn-ver">2. Information we collect</div>
        <ul class="wn-list">
          <li><strong>Google account information:</strong> your Google account identifier, email address, name, and profile image received during Google sign-in. Muchi does not receive or store your Google password.</li>
          <li><strong>YouTube information (only after you choose Connect YouTube):</strong> liked-video information, playlist information, and identifiers needed to perform a YouTube action that you request.</li>
          <li><strong>Muchi library and playback information:</strong> local playlists, liked tracks, recent tracks, queue information, preferences, downloads, and playback settings stored on your device or synced when signed in.</li>
          <li><strong>Search and music requests:</strong> searches, song identifiers, artist names, lyrics requests, radio requests, and related music requests needed to provide the requested feature.</li>
        </ul>
      </div>
      <div class="wn-release">
        <div class="wn-ver">3. How we use information</div>
        <ul class="wn-list">
          <li>To create and maintain your Muchi account and session.</li>
          <li>To provide playback, search, lyrics, radio, library, playlist, and discovery features.</li>
          <li>To show your YouTube liked videos and playlists after you separately authorize YouTube.</li>
          <li>To protect the service, prevent abuse, diagnose errors, and maintain reliability.</li>
        </ul>
      </div>
      <div class="wn-release">
        <div class="wn-ver">4. Google and YouTube data</div>
        <p style="margin:6px 0">Muchi's use and transfer of information received from Google APIs complies with the Google API Services User Data Policy, including the Limited Use requirements. Muchi does not sell Google or YouTube data or use it for advertising.</p>
      </div>
      <div class="wn-release">
        <div class="wn-ver">5. Storage, retention &amp; your choices</div>
        <p style="margin:6px 0">You may use Muchi without connecting YouTube, disconnect YouTube from Settings at any time, sign out, or clear local device storage. You may request access, correction, or deletion of personal information by contacting <a href="mailto:twiarimascord@gmail.com">twiarimascord@gmail.com</a>.</p>
      </div>`;
  }

  function openLegalDocument(kind = "privacy") {
    const isTerms = kind === "terms";
    const title = isTerms ? "Muchi Terms of Service" : "Muchi Privacy Policy";
    const otherKind = isTerms ? "privacy" : "terms";
    const otherLabel = isTerms ? "Privacy Policy" : "Terms of Service";
    const modal = $("modal");
    const card = $("modalCard");
    if (!modal || !card) return;
    clearTimeout(hideModal._t);
    modal.classList.add("sheet");
    card.innerHTML = `<div class="sheet-handle" aria-hidden="true"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">
        <h2 style="margin:0">${escapeHTML(title)}</h2>
        <button class="icon-btn" id="legalBackBtn" type="button" aria-label="Back to Settings"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="wn-scroll" id="legalScrollBody">${legalDocumentBody(isTerms ? "terms" : "privacy")}</div>
      <div class="modal-actions" style="justify-content:space-between;align-items:center;margin-top:12px">
        <button class="chip-btn" id="legalSwitchBtn" type="button" data-legal="${otherKind}">${escapeHTML(otherLabel)}</button>
        <button class="btn ghost" id="mCancel" type="button">Back to Settings</button>
      </div>`;
    showEl(modal, true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => modal.classList.add("in"));
    });
    const closeLegal = () => hideModal();
    if ($("mCancel")) $("mCancel").onclick = closeLegal;
    if ($("legalBackBtn")) $("legalBackBtn").onclick = closeLegal;
    if ($("legalSwitchBtn")) {
      $("legalSwitchBtn").onclick = (e) => {
        e.preventDefault();
        openLegalDocument(otherKind);
      };
    }
    card.querySelectorAll("[data-legal]").forEach((el) => {
      if (el.id === "legalSwitchBtn") return;
      el.addEventListener("click", (e) => {
        e.preventDefault();
        openLegalDocument(el.getAttribute("data-legal") || "privacy");
      });
    });
    modal.onclick = (e) => { if (e.target === modal) closeLegal(); };
  }
  /* In-app updater: Android APK & iOS bundle download in-app without browser
     redirects. Real progress reporting with percentage and progress bar. */
  function setUpdateProgress(pct, text) {
    if (!state.update) state.update = {};
    state.update.progress = { pct, text };
    const fill = document.getElementById("updProgFill");
    const txt = document.getElementById("updProgText");
    const box = document.getElementById("updProgBox");
    if (box) box.hidden = false;
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (txt) txt.textContent = text;
  }

  async function downloadUpdateInApp(target = "android") {
    const u = state.update || {};
    const ver = u.latest || APP_VERSION;
    const isIos = target === "ios";
    const fallbackRepo = "Kaibshshdheueejw/Muchi";
    const url = isIos
      ? `https://github.com/${fallbackRepo}/releases/latest/download/Muchi-ios.xcarchive.zip`
      : (u.apkUrl || `https://github.com/${fallbackRepo}/releases/latest/download/Muchi.apk`);

    state.update.downloading = true;
    showUpdatePlatform(target);
    setUpdateProgress(2, `Connecting to update server for Muchi ${ver}…`);

    const ND = !isIos ? nativeDownloader() : null;
    if (ND && typeof ND.downloadUpdate === "function") {
      let listener = null;
      try {
        if (typeof ND.addListener === "function") {
          listener = await ND.addListener("progress", (p) => {
            const bytes = Number((p && p.bytes) || 0);
            const total = Number((p && p.total) || 0);
            const pct = total > 0 ? Math.round((bytes / total) * 100) : 10;
            setUpdateProgress(pct, `Downloading Muchi ${ver}… ${pct > 0 ? `${pct}% ` : ""}(${fmtBytes(bytes)}${total > 0 ? ` / ${fmtBytes(total)}` : ""})`);
          });
        }
        const res = await ND.downloadUpdate({ url, version: ver });
        const uri = (res && typeof res === "object" && res.uri) ? res.uri : String(res || "");
        if (!uri) throw new Error("no file returned");
        state.update.downloaded = true;
        state.update.apkUri = uri;
        state.update.downloading = false;
        setUpdateProgress(100, `Muchi ${ver} downloaded successfully!`);
        if (typeof ND.installUpdate === "function") {
          try {
            await ND.installUpdate({ uri });
            toast(`Muchi ${ver} ready — tap Install in the system sheet`, true, "success");
          } catch (e) {
            toast(String((e && e.message) || "Could not open the installer"), true, "error");
          }
        } else {
          toast(`Muchi ${ver} saved — ready to install`, true, "success");
        }
        showUpdatePlatform("android");
        return;
      } catch (e) {
        state.update.downloading = false;
        toast("Update download failed — please check connection", true, "error");
        showUpdatePlatform("android");
        return;
      } finally {
        if (listener && typeof listener.remove === "function") {
          try { listener.remove(); } catch {}
        }
      }
    }

    // Web / PWA / Fallback: download inside the app using streaming Fetch + Blob
    const saveBlobFile = async (blob, fname) => {
      const w = window;
      if (w.showSaveFilePicker) {
        try {
          const handle = await w.showSaveFilePicker({ suggestedName: fname });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return true;
        } catch (e) {
          if (e.name === "AbortError") return false;
        }
      }
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { document.body.removeChild(a); } catch {}
        URL.revokeObjectURL(a.href);
      }, 5000);
      return true;
    };

    const saveStreamInApp = async (res, fname) => {
      const total = Number(res.headers.get("content-length") || 0);
      const reader = res.body.getReader();
      const parts = [];
      let buf = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        buf += value.byteLength;
        const pct = total > 0 ? Math.round((buf / total) * 100) : 0;
        setUpdateProgress(pct, `Downloading ${fname}… ${pct > 0 ? `${pct}% ` : ""}(${fmtBytes(buf)}${total ? ` / ${fmtBytes(total)}` : ""})`);
      }
      const bytes = concatBytes(parts);
      const mime = fname.endsWith(".apk") ? "application/vnd.android.package-archive" : "application/zip";
      const blob = new Blob([bytes], { type: mime });
      await saveBlobFile(blob, fname);
      setUpdateProgress(100, `${fname} downloaded — check your downloads!`);
      return true;
    };

    let saved = false;
    const fname = isIos ? `Muchi-${ver}-ios.zip` : `Muchi-${ver}.apk`;
    const attempts = [];
    if (API_BASE) attempts.push(`${API_BASE}/api/stream?url=${encodeURIComponent(url)}`);
    else attempts.push(`/api/stream?url=${encodeURIComponent(url)}`);
    attempts.push(url);

    for (const attempt of attempts) {
      try {
        const res = await fetch(attempt);
        if (!res.ok) throw new Error("download failed (" + res.status + ")");
        await saveStreamInApp(res, fname);
        saved = true;
        break;
      } catch (err) {}
    }

    state.update.downloading = false;
    if (saved) {
      state.update.downloaded = true;
      toast(`Muchi ${ver} downloaded inside app`, true, "success");
      showUpdatePlatform(target);
    } else {
      toast("Could not download update file — please check network connection", true, "error");
      showUpdatePlatform(target);
    }
  }
  function updateLine() {
    const u = state.update;
    if (!u) return "Checking for updates…";
    if (u.error) return "Couldn't reach the update server — check your connection.";
    if (u.available) return `Version ${u.latest} is available — tap Update.`;
    if (u.latest) return `Current ${u.current} · Latest ${u.latest} · Up to date`;
    return `Version ${u.current} on this device`;
  }
  /* Update system v2 — the app asks ITS OWN backend (/api/version) for the
     latest release. No user-entered GitHub URL, no GitHub scraping. When the
     release pipeline publishes a new version it updates the Worker metadata
     (and optionally android.apkUrl / ios.appStoreUrl), which this UI reads. */
  async function checkUpdates(quiet) {
    let meta = null;
    try {
      const d = await api("/api/version", 12000);
      if (d && d.version) meta = d;
    } catch {}
    const latest = meta && meta.version ? String(meta.version) : "";
    state.update = {
      current: APP_VERSION,
      latest,
      available: !!latest && verNewer(latest, APP_VERSION),
      apkUrl: latest ? String((meta.android && meta.android.apkUrl) || "") : "",
      appStoreUrl: latest ? String((meta.ios && meta.ios.appStoreUrl) || "") : "",
      error: !meta,
    };
    if (state.update.available) {
      if (!quiet || !state.update.seen) toast(`Muchi ${state.update.latest} is available`);
      state.update.seen = true;
    } else if (!meta && !quiet) {
      toast("Couldn't check for updates");
    }
    if (state.view === "settings") render();
  }
  function updateModalBody() {
    const u = state.update || {};
    const status = u.error ? "offline" : u.available ? "update available" : (u.latest ? "up to date" : "ready");
    return `
      <p class="upd-ver">Current <strong>${escapeHTML(u.current || APP_VERSION)}</strong>${u.latest ? ` · Latest <strong>${escapeHTML(u.latest)}</strong>` : ""} · <em>${status}</em></p>
      <div class="upd-tiles">
        <button type="button" class="upd-tile" id="updAndroid" style="animation-delay:.05s">
          <span class="upd-tile-icon"><span class="material-symbols-outlined">android</span></span>
          <span class="upd-tile-name">Android</span>
          <span class="upd-tile-sub">Download &amp; install update in app</span>
        </button>
        <button type="button" class="upd-tile" id="updIos" style="animation-delay:.16s">
          <span class="upd-tile-icon ios">
            <svg class="apple-logo" viewBox="0 0 384 512" role="img" aria-label="Apple" xmlns="http://www.w3.org/2000/svg"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
          </span>
          <span class="upd-tile-name">iOS</span>
          <span class="upd-tile-sub">Update in app</span>
        </button>
      </div>
      <div class="upd-sub" id="updSub" hidden></div>`;
  }
  function showUpdatePlatform(which) {
    const sub = document.getElementById("updSub");
    const tiles = document.querySelector("#modal .upd-tiles");
    if (!sub) return;
    const u = state.update || {};
    const ver = u.latest || APP_VERSION;
    const isDownloading = !!u.downloading;
    const prog = u.progress || { pct: 0, text: "" };

    if (which === "android") {
      sub.innerHTML = `
        <div class="upd-sub-head">
          <span class="material-symbols-outlined">android</span>
          <div>
            <strong>Android update (Muchi ${escapeHTML(ver)})</strong>
            <p>Installs directly over this app — your likes, playlists and settings stay.</p>
          </div>
        </div>
        <div id="updProgBox" class="upd-prog-box" ${isDownloading ? "" : "hidden"}>
          <div class="upd-prog-header">
            <span id="updProgText">${escapeHTML(prog.text || "Downloading update…")}</span>
          </div>
          <div class="upd-prog-track"><div id="updProgFill" class="upd-prog-fill" style="width:${prog.pct || 0}%"></div></div>
        </div>
        ${u.downloaded
          ? `
            <button type="button" class="filled-btn upd-dl" id="updInstallBtn">
              <span class="material-symbols-outlined filled">system_update</span> Install Muchi ${escapeHTML(ver)}
            </button>
            <button type="button" class="btn ghost upd-dl-sec" id="updDlBtn">
              <span class="material-symbols-outlined">refresh</span> Re-download APK in app
            </button>
            <p class="upd-note">The update is downloaded inside Muchi. Tap Install to begin installing.</p>`
          : `
            <button type="button" class="filled-btn upd-dl" id="updDlBtn" ${isDownloading ? "disabled" : ""}>
              <span class="material-symbols-outlined filled">download</span> ${isDownloading ? "Downloading in app…" : `Download Muchi ${escapeHTML(ver)} in app`}
            </button>
            <p class="upd-note">Downloads the APK directly inside Muchi. Once finished, the Install screen opens automatically without leaving the app.</p>`}`;
    } else {
      sub.innerHTML = `
        <div class="upd-sub-head">
          <span class="upd-tile-icon ios" style="width:36px;height:36px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;">
            <svg class="apple-logo" viewBox="0 0 384 512" style="width:18px;height:18px;fill:currentColor" role="img" aria-label="Apple"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
          </span>
          <div>
            <strong>iOS update (Muchi ${escapeHTML(ver)})</strong>
            <p>Update seamlessly in-place or download the release package in the app.</p>
          </div>
        </div>
        <div id="updProgBox" class="upd-prog-box" ${isDownloading ? "" : "hidden"}>
          <div class="upd-prog-header">
            <span id="updProgText">${escapeHTML(prog.text || "Downloading iOS package…")}</span>
          </div>
          <div class="upd-prog-track"><div id="updProgFill" class="upd-prog-fill" style="width:${prog.pct || 0}%"></div></div>
        </div>
        <button type="button" class="filled-btn upd-dl" id="updIosRefreshBtn">
          <span class="material-symbols-outlined filled">sync</span> Update &amp; Refresh app in-place
        </button>
        <button type="button" class="btn ghost upd-dl-sec" id="updIosZipBtn" ${isDownloading ? "disabled" : ""}>
          <span class="material-symbols-outlined">download</span> Download iOS Package (.zip) in app
        </button>
        ${u.appStoreUrl ? `<a class="btn ghost upd-dl-sec" href="${escapeAttr(u.appStoreUrl)}" target="_blank" rel="noopener"><span class="material-symbols-outlined">open_in_new</span> Open in App Store</a>` : ""}
        <p class="upd-note">For Web &amp; PWA: tap "Update &amp; Refresh" to apply the latest build in place. For developers &amp; sideloaders: download the iOS archive directly.</p>`;
    }
    sub.hidden = false;
    if (tiles) tiles.classList.add("dim");

    const dlBtn = document.getElementById("updDlBtn");
    if (dlBtn) dlBtn.addEventListener("click", () => downloadUpdateInApp("android"));
    const inBtn = document.getElementById("updInstallBtn");
    if (inBtn) inBtn.addEventListener("click", installDownloadedUpdate);
    const rBtn = document.getElementById("updIosRefreshBtn");
    if (rBtn) rBtn.addEventListener("click", reloadApp);
    const zipBtn = document.getElementById("updIosZipBtn");
    if (zipBtn) zipBtn.addEventListener("click", () => downloadUpdateInApp("ios"));
  }
  /* v1.5.4 — reopen the installer for an already-downloaded update without
     re-downloading anything (the old flow's dead end). On web there is no
     installer to launch — point at the saved file instead. */
  async function installDownloadedUpdate() {
    const u = state.update || {};
    const ND = nativeDownloader();
    if (u.apkUri && ND && typeof ND.installUpdate === "function") {
      try {
        await ND.installUpdate({ uri: u.apkUri });
        return;
      } catch (e) {
        toast(String((e && e.message) || "Could not open the installer"), true, "error");
        return;
      }
    }
    toast("Open the downloaded file from the Downloads notification to install");
  }
  function openUpdateModal() {
    const modal = $("modal");
    const card = $("modalCard");
    clearTimeout(hideModal._t);
    modal.classList.add("sheet");
    card.innerHTML = `<div class="sheet-handle" aria-hidden="true"></div><h2>Update Muchi</h2>${updateModalBody()}<div class="modal-actions"><button class="btn ghost" id="mCancel">Close</button></div>`;
    showEl(modal, true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => modal.classList.add("in"));
    });
    $("mCancel").onclick = () => hideModal();
    modal.onclick = (e) => { if (e.target === modal) hideModal(); };
    const a = card.querySelector("#updAndroid");
    const i = card.querySelector("#updIos");
    if (a) a.onclick = () => showUpdatePlatform("android");
    if (i) i.onclick = () => showUpdatePlatform("ios");
    // v1.5.4: after a successful download, re-open straight onto the platform
    // sheet so the Install button is immediately visible (1.5.3 re-opened the
    // tile picker, making the "downloaded" state unreachable).
    if ((state.update || {}).downloaded) showUpdatePlatform("android");
  }
  async function reloadApp() {
    toast("Reloading…");
    try {
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {}
    location.reload();
  }

  function renderAppearance() {
    const p = state.prefs;
    const c = customTheme();
    const skins = THEMES.filter((t) => !isBaseThemeId(t.id));
    const customOn = p.theme === "custom";
    const ap = p.appearance || "system";
    const apBtn = (id, label) => `<button type="button" class="seg-btn${ap === id ? " on" : ""}" data-appearance="${id}" role="radio" aria-checked="${ap === id}">${label}</button>`;
    return `
      <div class="hero">
        <div>
          <button class="chip-btn page-back" id="settingsBack" type="button">
            <span class="material-symbols-outlined">arrow_back</span>
            Back
          </button>
          <h1>Appearance</h1>
        </div>
      </div>
      <div class="settings">
        <div class="set-card">
          <h3><span class="material-symbols-outlined">contrast</span>Light / Dark / System</h3>
          <div class="seg" role="radiogroup" aria-label="Appearance">
            ${apBtn("light", "Light")}
            ${apBtn("dark", "Dark")}
            ${apBtn("system", "System")}
          </div>
        </div>
        <div class="set-card">
          <h3><span class="material-symbols-outlined">palette</span>Theme skins</h3>
          <div class="theme-grid">${skins.map((th) => themeCardHTML(th, p.theme === th.id)).join("")}</div>
        </div>
        <div class="set-card">
          <h3><span class="material-symbols-outlined">brush</span>Custom theme</h3>
          <button type="button" class="theme-card custom-use ${customOn ? "on" : ""}" data-set-theme="custom">
            <div class="theme-preview" style="background:${c.surface};--tp-a:${c.primary};--tp-b:${c.accent}">
              <i class="tp-bar"></i><i class="tp-row"></i><i class="tp-row dim"></i><i class="tp-pill"></i>
            </div>
            <span><strong>${escapeHTML(c.name || "My theme")}</strong></span>
          </button>
          <label class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="violet">badge</span><div><strong>Name</strong></div></div>
            <input id="customName" type="text" maxlength="24" value="${escapeAttr(c.name)}" />
          </label>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="amber">dark_mode</span><div><strong>Base</strong></div></div>
            <div class="set-actions">
              <button type="button" class="chip ${c.mode === "dark" ? "active" : ""}" data-custom-mode="dark">Dark</button>
              <button type="button" class="chip ${c.mode === "light" ? "active" : ""}" data-custom-mode="light">Light</button>
            </div>
          </div>
          ${[
            ["surface", "Background", "Page color", "wallpaper", "blue"],
            ["card", "Cards", "Tiles, menus, player", "layers", "cyan"],
            ["primary", "Accent", "Buttons and highlights", "palette", "pink"],
            ["accent", "Glow", "Second color and wash", "flare", "amber"],
            ["text", "Text", "Titles and labels", "text_fields", "emerald"],
          ].map(([key, title, _hint, ico, colorAttr]) => `
            <label class="set-row color-row">
              <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="${colorAttr}">${ico}</span><div><strong>${title}</strong></div></div>
              <span class="color-field">
                <input type="color" data-custom-color="${key}" value="${c[key]}" />
                <code>${c[key]}</code>
              </span>
            </label>`).join("")}
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="orange">restart_alt</span><div><strong>Reset mix</strong></div></div>
            <button class="chip-btn" id="resetCustom" type="button">Reset</button>
          </div>
        </div>
        <div class="set-card">
          <h3><span class="material-symbols-outlined">apps</span>App Icon</h3>
          <button type="button" class="set-row set-go" id="openAppIconFromAppearance">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="pink">apps</span><div><strong>Customize App Icon</strong></div></div>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
      </div>`;
  }

  function homeHeroSceneHTML() {
    return `
      <div class="hero-scene hero-scene-winter" aria-hidden="true">
        <div class="winter-aurora"></div>
        <div class="winter-snow-layer layer-back"></div>
        <div class="winter-snow-layer layer-mid"></div>
        <svg class="winter-forest-svg" viewBox="0 0 800 180" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="alaskaRidge" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.32"/>
              <stop offset="100%" stop-color="#081629" stop-opacity="0.9"/>
            </linearGradient>
            <linearGradient id="alaskaTreeBack" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#1e3a5f"/>
              <stop offset="100%" stop-color="#091526"/>
            </linearGradient>
            <linearGradient id="alaskaTreeFront" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#132e4a"/>
              <stop offset="100%" stop-color="#050e1a"/>
            </linearGradient>
          </defs>
          <!-- Distant Alaskan mountain peaks -->
          <path d="M0,180 L0,118 L95,64 L185,122 L290,52 L410,126 L535,48 L660,116 L745,70 L800,108 L800,180 Z" fill="url(#alaskaRidge)" opacity="0.55"/>
          <path d="M95,64 L122,82 L98,78 L76,84 Z M290,52 L322,76 L292,70 L264,77 Z M535,48 L568,75 L536,68 L504,76 Z M745,70 L768,88 L744,83 L724,89 Z" fill="#e0f2fe" opacity="0.45"/>
          <!-- Mid-ground outdoor Alaskan spruce forest -->
          <g fill="url(#alaskaTreeBack)" opacity="0.82">
            <polygon points="48,96 26,142 38,142 18,174 78,174 58,142 70,142"/>
            <polygon points="124,104 104,146 114,146 96,176 152,176 134,146 144,146"/>
            <polygon points="236,90 212,138 224,138 202,175 270,175 248,138 260,138"/>
            <polygon points="356,102 336,144 346,144 328,176 384,176 366,144 376,144"/>
            <polygon points="468,86 442,136 456,136 432,175 504,175 480,136 494,136"/>
            <polygon points="592,94 568,140 580,140 558,175 626,175 604,140 616,140"/>
            <polygon points="706,82 680,134 694,134 668,176 744,176 718,134 732,134"/>
          </g>
          <!-- Foreground snow-laden outdoor pine trees -->
          <g fill="url(#alaskaTreeFront)">
            <!-- Left tall spruce -->
            <polygon points="86,62 60,108 74,108 48,146 66,146 40,180 132,180 106,146 124,146 98,108 112,108"/>
            <!-- Mid-left pine -->
            <polygon points="182,84 160,124 172,124 150,156 164,156 144,180 220,180 200,156 214,156 192,124 204,124"/>
            <!-- Center-right tall Alaskan spruce -->
            <polygon points="524,54 494,104 510,104 482,144 500,144 472,180 576,180 548,144 566,144 538,104 554,104"/>
            <!-- Right pine cluster -->
            <polygon points="648,70 622,114 636,114 610,150 626,150 602,180 694,180 670,150 686,150 660,114 674,114"/>
            <polygon points="756,58 728,106 742,106 716,146 732,146 706,180 804,180 780,146 796,146 770,106 784,106"/>
          </g>
          <!-- Snow caps on pine boughs -->
          <g fill="#e0f7ff" opacity="0.72">
            <polygon points="86,62 72,86 86,82 100,86"/>
            <polygon points="182,84 170,104 182,100 194,104"/>
            <polygon points="524,54 508,82 524,77 540,82"/>
            <polygon points="648,70 634,94 648,90 662,94"/>
            <polygon points="756,58 740,84 756,79 772,84"/>
          </g>
          <!-- Snowy Alaskan ground drift -->
          <path d="M0,168 Q140,154 290,166 T590,162 T800,166 L800,180 L0,180 Z" fill="#bae6fd" opacity="0.28"/>
        </svg>
        <div class="winter-snow-layer layer-front"></div>
        <div class="winter-flakes">
          <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
        </div>
      </div>
      <div class="hero-scene hero-scene-christmas" aria-hidden="true">
        <div class="xmas-stars">
          <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
        </div>
        <div class="xmas-moon"></div>
        <!-- Santa Claus riding reindeer up in the sky at night (loop optimized) -->
        <div class="xmas-santa-track">
          <div class="xmas-santa-bob">
            <svg class="xmas-sleigh-svg" viewBox="0 0 420 110" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="magicTrail" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stop-color="#fde68a" stop-opacity="0"/>
                  <stop offset="60%" stop-color="#fbbf24" stop-opacity="0.55"/>
                  <stop offset="100%" stop-color="#fef08a" stop-opacity="0.95"/>
                </linearGradient>
                <linearGradient id="sleighBody" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#f43f5e"/>
                  <stop offset="100%" stop-color="#9f1239"/>
                </linearGradient>
              </defs>
              <!-- Golden Stardust Flight Trail -->
              <path d="M4,86 Q56,82 106,68" stroke="url(#magicTrail)" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 6"/>
              <circle cx="28" cy="83" r="1.8" fill="#fef08a" opacity="0.7"/>
              <circle cx="58" cy="79" r="2.2" fill="#fde047" opacity="0.85"/>
              <circle cx="84" cy="73" r="1.6" fill="#fef9c3" opacity="0.9"/>
              <!-- Sleigh Golden Runners -->
              <path d="M92,76 L166,76 C178,76 184,68 180,60" stroke="#fbbf24" stroke-width="2.6" stroke-linecap="round"/>
              <path d="M108,66 L108,76 M148,66 L148,76" stroke="#fbbf24" stroke-width="2.2"/>
              <!-- Toy Sack in Back -->
              <ellipse cx="112" cy="50" rx="13" ry="11" fill="#b45309"/>
              <path d="M102,45 Q112,38 122,45" stroke="#fcd34d" stroke-width="1.6" fill="none"/>
              <!-- Sleigh Crimson Body & Gold Trim -->
              <path d="M96,52 Q98,68 114,68 L156,68 Q168,68 173,54 L160,54 Q154,58 140,58 L114,52 Z" fill="url(#sleighBody)" stroke="#fbbf24" stroke-width="1.5"/>
              <!-- Santa Claus in Sleigh -->
              <circle cx="136" cy="41" r="6.5" fill="#fde68a"/>
              <!-- Santa Beard -->
              <path d="M133,43 Q138,51 144,44 Q141,40 133,43 Z" fill="#ffffff"/>
              <!-- Santa Coat -->
              <path d="M125,58 Q128,45 141,46 L147,58 Z" fill="#e11d48"/>
              <!-- Santa Red Hat & White Pom-Pom -->
              <path d="M129,38 Q135,27 143,36 Z" fill="#e11d48"/>
              <rect x="128" y="36.5" width="14" height="3" rx="1.5" fill="#ffffff"/>
              <circle cx="127" cy="31" r="2.6" fill="#ffffff"/>
              <!-- Golden Reins from Santa to Reindeer Team -->
              <path d="M146,49 Q205,54 252,45 Q302,42 356,37" stroke="#fcd34d" stroke-width="1.3" stroke-dasharray="3 2" opacity="0.9"/>
              <!-- Reindeer 1 (Closest to sleigh) -->
              <g class="reindeer-unit r-1">
                <ellipse cx="218" cy="52" rx="14" ry="6.5" transform="rotate(-8 218 52)" fill="#d97706"/>
                <path d="M227,48 L234,37 L241,39 L233,51 Z" fill="#d97706"/>
                <ellipse cx="239" cy="37" rx="5.5" ry="3.2" transform="rotate(-10 239 37)" fill="#f59e0b"/>
                <!-- Antlers -->
                <path d="M235,34 L232,25 M235,29 L229,28 M238,34 L237,24 M237,28 L242,26" stroke="#fde68a" stroke-width="1.5" stroke-linecap="round"/>
                <!-- Galloping Legs -->
                <path d="M208,56 L196,66 M213,57 L204,68 M227,54 L239,62 M231,52 L244,58" stroke="#b45309" stroke-width="2" stroke-linecap="round"/>
                <circle cx="204" cy="51" r="2.2" fill="#fef3c7"/>
              </g>
              <!-- Reindeer 2 (Middle) -->
              <g class="reindeer-unit r-2">
                <ellipse cx="284" cy="44" rx="14" ry="6.5" transform="rotate(-10 284 44)" fill="#d97706"/>
                <path d="M293,40 L300,29 L307,31 L299,43 Z" fill="#d97706"/>
                <ellipse cx="305" cy="29" rx="5.5" ry="3.2" transform="rotate(-12 305 29)" fill="#f59e0b"/>
                <!-- Antlers -->
                <path d="M301,26 L298,17 M301,21 L295,20 M304,26 L303,16 M303,20 L308,18" stroke="#fde68a" stroke-width="1.5" stroke-linecap="round"/>
                <!-- Galloping Legs -->
                <path d="M274,48 L262,58 M279,49 L270,60 M293,46 L306,53 M297,44 L311,49" stroke="#b45309" stroke-width="2" stroke-linecap="round"/>
                <circle cx="270" cy="43" r="2.2" fill="#fef3c7"/>
              </g>
              <!-- Reindeer 3 (Rudolph Leading in Front!) -->
              <g class="reindeer-unit r-3">
                <ellipse cx="350" cy="35" rx="14.5" ry="6.5" transform="rotate(-12 350 35)" fill="#f59e0b"/>
                <path d="M359,31 L367,19 L374,21 L365,34 Z" fill="#f59e0b"/>
                <ellipse cx="372" cy="20" rx="5.8" ry="3.3" transform="rotate(-14 372 20)" fill="#fbbf24"/>
                <!-- Antlers -->
                <path d="M368,17 L365,8 M368,12 L362,11 M371,17 L370,7 M370,11 L375,9" stroke="#fef08a" stroke-width="1.6" stroke-linecap="round"/>
                <!-- Galloping Legs -->
                <path d="M340,39 L327,49 M345,40 L335,51 M359,37 L373,44 M363,35 L378,39" stroke="#d97706" stroke-width="2.1" stroke-linecap="round"/>
                <circle cx="336" cy="34" r="2.2" fill="#fef3c7"/>
                <!-- Rudolph's Glowing Red Nose -->
                <circle cx="379" cy="19" r="5" fill="#ff1e42" opacity="0.42"/>
                <circle cx="379" cy="19" r="2.5" fill="#ff2a55"/>
              </g>
            </svg>
          </div>
        </div>
        <!-- Snowy Night Horizon & Festive Trees -->
        <svg class="xmas-horizon-svg" viewBox="0 0 800 180" preserveAspectRatio="xMidYMax slice">
          <path d="M0,180 L0,148 Q180,132 380,150 T800,140 L800,180 Z" fill="#17132b" opacity="0.88"/>
          <g fill="#0f2922" opacity="0.92">
            <polygon points="56,112 36,150 46,150 28,178 84,178 66,150 76,150"/>
            <polygon points="132,124 116,154 124,154 110,178 154,178 140,154 148,154"/>
            <polygon points="628,110 606,148 618,148 598,178 658,178 638,148 650,148"/>
            <polygon points="718,98 694,142 706,142 684,178 752,178 730,142 742,142"/>
          </g>
          <!-- Warm golden lights on horizon trees -->
          <g fill="#fbbf24">
            <circle cx="56" cy="128" r="1.8"/><circle cx="49" cy="144" r="1.6"/><circle cx="63" cy="154" r="1.8"/>
            <circle cx="628" cy="126" r="1.8"/><circle cx="620" cy="144" r="1.7"/><circle cx="636" cy="156" r="1.8"/>
            <circle cx="718" cy="116" r="2"/><circle cx="709" cy="136" r="1.8"/><circle cx="727" cy="148" r="1.9"/>
          </g>
          <path d="M0,168 Q220,156 450,168 T800,162 L800,180 L0,180 Z" fill="#fde68a" opacity="0.16"/>
        </svg>
        <div class="xmas-snow-layer"></div>
      </div>
      <div class="hero-scene hero-scene-autumn" aria-hidden="true">
        <div class="autumn-sun-glow"></div>
        <div class="autumn-breeze-layer"></div>
        <!-- Outdoor Maple & Oak Autumn Forest Horizon -->
        <svg class="autumn-forest-svg" viewBox="0 0 800 180" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="autumnHill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#9a3412" stop-opacity="0.45"/>
              <stop offset="100%" stop-color="#271006" stop-opacity="0.92"/>
            </linearGradient>
            <linearGradient id="mapleGold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#fbbf24"/>
              <stop offset="100%" stop-color="#b45309"/>
            </linearGradient>
            <linearGradient id="mapleCrimson" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#f97316"/>
              <stop offset="100%" stop-color="#991b1b"/>
            </linearGradient>
          </defs>
          <!-- Distant harvest hills -->
          <path d="M0,180 L0,126 Q140,84 310,124 T620,106 T800,122 L800,180 Z" fill="url(#autumnHill)"/>
          <!-- Outdoor Maple & Oak Tree Canopies (Back Layer) -->
          <g opacity="0.78">
            <circle cx="54" cy="118" r="28" fill="url(#mapleCrimson)"/>
            <circle cx="78" cy="124" r="22" fill="url(#mapleGold)"/>
            <circle cx="164" cy="128" r="24" fill="url(#mapleGold)"/>
            <circle cx="486" cy="122" r="26" fill="url(#mapleCrimson)"/>
            <circle cx="618" cy="110" r="30" fill="url(#mapleGold)"/>
            <circle cx="648" cy="118" r="24" fill="url(#mapleCrimson)"/>
            <circle cx="742" cy="106" r="32" fill="url(#mapleCrimson)"/>
            <circle cx="768" cy="116" r="25" fill="url(#mapleGold)"/>
          </g>
          <!-- Tree Trunks & Branches -->
          <g stroke="#3b190b" stroke-linecap="round" fill="none">
            <path d="M64,180 L64,116 M64,136 L48,120 M64,130 L78,118" stroke-width="4.5"/>
            <path d="M164,180 L164,126 M164,144 L152,130 M164,140 L176,128" stroke-width="3.6"/>
            <path d="M486,180 L486,122 M486,142 L472,126 M486,136 L500,124" stroke-width="3.8"/>
            <path d="M630,180 L630,108 M630,132 L612,114 M630,126 L648,112" stroke-width="4.8"/>
            <path d="M752,180 L752,104 M752,128 L734,108 M752,122 L770,110" stroke-width="5"/>
          </g>
          <!-- Foreground Golden & Crimson Maple Foliage Clusters -->
          <g opacity="0.9">
            <circle cx="42" cy="134" r="18" fill="#ea580c"/>
            <circle cx="94" cy="138" r="16" fill="#f59e0b"/>
            <circle cx="588" cy="134" r="20" fill="#dc2626"/>
            <circle cx="668" cy="130" r="21" fill="#f59e0b"/>
            <circle cx="716" cy="126" r="22" fill="#ea580c"/>
          </g>
          <!-- Leaf-strewn woodland ground -->
          <path d="M0,166 Q190,152 410,166 T800,158 L800,180 L0,180 Z" fill="#431407" opacity="0.9"/>
          <path d="M0,172 Q220,160 460,172 T800,166 L800,180 L0,180 Z" fill="#f59e0b" opacity="0.22"/>
        </svg>
        <!-- Tumbling & drifting autumn maple leaves loop -->
        <div class="autumn-leaves">
          <i class="leaf-crimson"></i>
          <i class="leaf-gold"></i>
          <i class="leaf-amber"></i>
          <i class="leaf-crimson"></i>
          <i class="leaf-gold"></i>
          <i class="leaf-amber"></i>
          <i class="leaf-crimson"></i>
          <i class="leaf-gold"></i>
          <i class="leaf-amber"></i>
          <i class="leaf-gold"></i>
        </div>
      </div>
      <div class="hero-scene hero-scene-genshin" aria-hidden="true">
        <div class="genshin-celestia-glow"></div>
        <div class="genshin-wind-currents"></div>
        <!-- Teyvat Celestia Floating Island & Mondstadt / Liyue Starlit Horizon -->
        <svg class="genshin-horizon-svg" viewBox="0 0 800 180" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="teyvatPeakBack" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.32"/>
              <stop offset="100%" stop-color="#0f172a" stop-opacity="0.92"/>
            </linearGradient>
            <linearGradient id="teyvatGoldMist" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.05"/>
              <stop offset="50%" stop-color="#fef08a" stop-opacity="0.28"/>
              <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.12"/>
            </linearGradient>
          </defs>
          <!-- Celestia Floating Sky Island Silhouette -->
          <g class="genshin-celestia-island" opacity="0.72">
            <path d="M590,34 L658,34 L646,44 L628,56 L624,68 L616,54 L602,43 Z" fill="#fef08a" opacity="0.55"/>
            <path d="M610,34 L616,18 L624,12 L632,18 L638,34 Z" fill="#fde68a" opacity="0.7"/>
            <ellipse cx="624" cy="34" rx="44" ry="4" fill="#fef9c3" opacity="0.4"/>
          </g>
          <!-- Golden Constellation Lines in the Teyvat Sky -->
          <g stroke="#fde68a" stroke-width="0.9" opacity="0.42" fill="none">
            <path d="M96,34 L138,22 L176,38 L152,62 Z"/>
            <path d="M452,26 L496,18 L532,36 L488,52 Z"/>
          </g>
          <g fill="#fef9c3" opacity="0.85">
            <circle cx="96" cy="34" r="2"/><circle cx="138" cy="22" r="2.4"/><circle cx="176" cy="38" r="1.8"/><circle cx="152" cy="62" r="2"/>
            <circle cx="452" cy="26" r="2.2"/><circle cx="496" cy="18" r="2.5"/><circle cx="532" cy="36" r="1.8"/><circle cx="488" cy="52" r="2"/>
          </g>
          <!-- Distant Liyue Karst Peaks & Mondstadt Cliffs -->
          <path d="M0,180 L0,126 L74,88 L142,128 L238,76 L320,132 L438,84 L548,128 L664,72 L742,118 L800,96 L800,180 Z" fill="url(#teyvatPeakBack)"/>
          <!-- Anemo & Geo Ley Line Mist -->
          <path d="M0,158 Q210,138 440,156 T800,146 L800,180 L0,180 Z" fill="url(#teyvatGoldMist)"/>
          <path d="M0,168 Q260,154 520,168 T800,160 L800,180 L0,180 Z" fill="#090d1e" opacity="0.92"/>
        </svg>
        <!-- Drifting Primogem 4-Pointed Stars & Anemo Wind Motes -->
        <div class="genshin-primogems">
          <i class="primo-star"></i>
          <i class="anemo-mote"></i>
          <i class="primo-star"></i>
          <i class="geo-mote"></i>
          <i class="primo-star"></i>
          <i class="anemo-mote"></i>
          <i class="primo-star"></i>
          <i class="geo-mote"></i>
        </div>
      </div>`;
  }

  function renderUiPage() {
    const ui = normalizeUiMode(state.prefs.ui);
    const card = (id, name, _blurb, extra) => `
      <button type="button" class="ui-pick ${ui === id ? "on" : ""}" data-set-ui="${id}">
        <div class="ui-pick-preview ${id}">${extra}</div>
        <span>
          <strong>${name}</strong>
        </span>
        ${ui === id ? `<span class="ui-pick-on">On</span>` : ""}
      </button>`;
    const animCard = (id, name, blurb, extra) => `
      <div class="card-wrap ui-anim-card-wrap">
        <button type="button" class="card card-hit ui-pick ui-anim-card ${ui === id ? "on" : ""}" data-set-ui="${id}">
          <div class="art ui-pick-preview ${id}">
            ${extra}
          </div>
          <div class="ui-anim-card-meta">
            <span>
              <strong>${name}</strong>
              ${blurb ? `<p>${blurb}</p>` : ""}
            </span>
            ${ui === id ? `<span class="ui-pick-on">On</span>` : ""}
          </div>
        </button>
      </div>`;
    return `
      <div class="hero">
        <div>
          <button class="chip-btn page-back" id="settingsBack" type="button">
            <span class="material-symbols-outlined">arrow_back</span>
            Back
          </button>
          <h1>UI</h1>
        </div>
      </div>
      <div class="settings">
        <div class="set-card">
          <h3><span class="material-symbols-outlined">battery_saver</span>Performance</h3>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="emerald">battery_saver</span><div><strong>Battery Saver</strong></div></div>
            <button class="switch ${state.prefs.batterySaver ? "on" : ""}" data-pref="batterySaver" type="button" aria-label="Battery Saver"><i></i></button>
          </div>
        </div>
        <div class="set-card">
          <h3><span class="material-symbols-outlined">format_size</span>Interface size</h3>
          <div class="chip-row icon-size-row">
            ${[["small", "Small"], ["default", "Default"], ["medium", "Medium"], ["large", "Large"]].map(([id, label]) =>
              `<button type="button" class="chip ${(state.prefs.iconSize || "default") === id ? "active" : ""}" data-set-icons="${id}">${label}</button>`
            ).join("")}
          </div>
        </div>
        <div class="set-card">
          <h3><span class="material-symbols-outlined">dashboard_customize</span>Layout</h3>
          <div class="ui-pick-list">
            ${card("material", "Material 3", "", `<i></i><i></i><i></i>`)}
            ${card("glass", "Glass UI", "", `<i></i><i></i><i></i>`)}
          </div>
        </div>
        <div class="set-card">
          <h3><span class="material-symbols-outlined">auto_awesome</span>Animated UI</h3>
          <div class="ui-anim-row">
            ${animCard("winter", "Winter UI", "Aurora & snowfall", `<i></i><i></i><i></i>`)}
            ${animCard("christmas", "Christmas UI", "Starry holiday sky", `<i></i><i></i><i></i>`)}
            ${animCard("autumn", "Autumn UI", "Golden harvest leaves", `<i></i><i></i><i></i>`)}
            ${animCard("genshin", "Genshin Impact", "Paimon, Aether & Lumine", `<i></i><i></i><i></i>`)}
          </div>
        </div>
      </div>`;
  }


  function playerStyleLabel() {
    const id = normalizePlayerStyle(state.prefs.playerStyle);
    const wg = normalizeSeekWiggle(state.prefs.seekWiggle);
    const styleName = ({ pill: "Glass pill", wave: "Wave", vinyl: "Vinyl", aura: "Aura" })[id] || "Glass pill";
    const wiggleName = ({ sine: "Smooth Sine", ribbon: "Harmonic Ribbon", glow: "Laser Glow", orbit: "Dual Helix" })[wg] || "Smooth Sine";
    return `${styleName} · ${wiggleName}`;
  }

  function accountCardHTML() {
    const a = state.auth;
    if (!a) return `<div class="set-card"><h3><span class="material-symbols-outlined">account_circle</span>Account</h3><div class="ly-wait">Checking…</div></div>`;
    if (a.configured === false) return "";
    if (!a.signedIn) {
      return `
        <div class="set-card">
          <h3><span class="material-symbols-outlined">account_circle</span>Account</h3>
          <button type="button" class="filled-btn" id="gSignInBtn" style="width:100%;justify-content:center">
            <span class="material-symbols-outlined filled">login</span> Continue with Google
          </button>
        </div>`;
    }
    const pr = a.profile || {};
    const pic = pr.picture
      ? `<img class="acct-avatar" src="${escapeAttr(pr.picture)}" alt="" onerror="this.style.display='none'"/>`
      : `<span class="material-symbols-outlined">account_circle</span>`;
    const yt = a.youtube && a.youtube.connected;
    return `
      <div class="set-card">
        <h3><span class="material-symbols-outlined">account_circle</span>Account</h3>
        <div class="set-row">
          <div class="acct-user">${pic}<div><strong>${escapeHTML(pr.name || pr.email || "Google user")}</strong></div></div>
        </div>
        ${yt ? `
        <div class="set-row">
          <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="rose">smart_display</span><div><strong>YouTube</strong></div></div>
          <div class="set-actions">
            <button type="button" class="chip-btn" id="gYtRefresh">Refresh</button>
            <button type="button" class="chip-btn" id="gYtDisconnect">Disconnect</button>
          </div>
        </div>` : `
        <div class="set-row">
          <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="rose">smart_display</span><div><strong>YouTube</strong></div></div>
          <button type="button" class="chip-btn" id="gYtConnect">Connect</button>
        </div>`}
        <div class="set-row">
          <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="blue">cloud_sync</span><div><strong>Cloud Library Sync</strong></div></div>
          <button type="button" class="chip-btn" id="syncLibraryBtn">Sync now</button>
        </div>
        <div class="set-row">
          <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="orange">logout</span><div><strong>Sign out</strong></div></div>
          <button type="button" class="chip-btn" id="gSignOut">Sign out</button>
        </div>
      </div>`;
  }

  function settingsSubChrome(title) {
    return `
      <div class="hero">
        <div>
          <button class="chip-btn page-back" id="settingsBack" type="button">
            <span class="material-symbols-outlined">arrow_back</span>
            Back
          </button>
          <h1>${title}</h1>
        </div>
      </div>`;
  }

  function renderPlayerPage() {
    const cur = normalizePlayerStyle(state.prefs.playerStyle);
    const curWiggle = normalizeSeekWiggle(state.prefs.seekWiggle);
    const types = [
      ["pill", "Glass pill"],
      ["wave", "Wave"],
      ["vinyl", "Vinyl"],
      ["aura", "Aura"],
    ];
    const wiggles = [
      ["sine", "Smooth Sine", "M 4 12 Q 18 3, 32 12 T 60 12 T 88 12 T 116 12"],
      ["ribbon", "Harmonic Ribbon", "M 4 12 C 16 4, 28 20, 42 12 C 56 4, 70 19, 84 12 C 96 6, 106 16, 116 12"],
      ["glow", "Laser Glow", "M 4 12 C 26 9, 52 15, 78 11 C 94 9, 106 13, 116 12"],
      ["orbit", "Dual Helix", "M 4 12 C 20 2, 36 22, 52 12 C 68 2, 84 22, 100 12 C 108 7, 112 10, 116 12"],
    ];
    const fade = Number(state.prefs.crossfade || 0);
    return `
      ${settingsSubChrome("Player")}
      <div class="settings">
        <div class="set-card">
          <h3><span class="material-symbols-outlined">dock_to_bottom</span>Player style</h3>
          <div class="ui-pick-list">
            ${types.map(([id, name]) => `
              <button type="button" class="ui-pick ${cur === id ? "on" : ""}" data-set-player="${id}">
                <div class="ui-pick-preview player-${id}"><i></i><i></i><i></i></div>
                <span><strong>${name}</strong></span>
                ${cur === id ? `<span class="ui-pick-on">On</span>` : ""}
              </button>`).join("")}
          </div>
        </div>
        <div class="set-card">
          <h3><span class="material-symbols-outlined">timeline</span>Timestamp wiggle</h3>
          <div class="ui-pick-list">
            ${wiggles.map(([id, name, svgPath]) => `
              <button type="button" class="ui-pick ${curWiggle === id ? "on" : ""}" data-set-wiggle="${id}">
                <div class="ui-pick-preview wiggle-preview wiggle-${id}">
                  <span class="wiggle-time">1:24</span>
                  <svg viewBox="0 0 120 24" preserveAspectRatio="none" aria-hidden="true">
                    <path d="${svgPath}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="${id === "zigzag" ? "miter" : "round"}"/>
                  </svg>
                  <span class="wiggle-time">3:45</span>
                </div>
                <span><strong>${name}</strong></span>
                ${curWiggle === id ? `<span class="ui-pick-on">On</span>` : ""}
              </button>`).join("")}
          </div>
        </div>
        <div class="set-card">
          <div class="set-card-head">
            <h3><span class="material-symbols-outlined">linear_scale</span>Crossfade</h3>
            <span class="chip active" id="playerFadeBadge">${fade ? fade + "s" : "Off"}</span>
          </div>
          <div class="eq-presets-grid">
            ${[0, 2, 4, 6, 8, 12].map((n) => `
              <button type="button" class="chip ${fade === n ? "active" : ""}" data-player-fade="${n}">
                ${n ? n + "s" : "Off"}
              </button>
            `).join("")}
          </div>
        </div>
      </div>`;
  }

  function renderPlaybackPage() {
    const p = state.prefs;
    return `
      ${settingsSubChrome("Playback")}
      <div class="settings">
        <div class="set-card">
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="emerald">playlist_play</span><div><strong>Autoplay</strong></div></div>
            <button class="switch ${p.autoplay ? "on" : ""}" data-pref="autoplay" type="button"><i></i></button>
          </div>
          <label class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="cyan">linear_scale</span><div><strong>Crossfade</strong></div></div>
            <select id="setFade">
              ${[0, 3, 6, 12].map((n) => `<option value="${n}" ${Number(p.crossfade) === n ? "selected" : ""}>${n ? n + "s" : "Off"}</option>`).join("")}
            </select>
          </label>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="amber">graphic_eq</span><div><strong>Even volume</strong></div></div>
            <button class="switch ${p.normalize ? "on" : ""}" data-pref="normalize" type="button"><i></i></button>
          </div>
          <label class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="blue">speed</span><div><strong>Speed</strong></div></div>
            <select id="setSpeed">
              ${[0.75, 1, 1.25, 1.5].map((n) => `<option value="${n}" ${Number(p.speed) === n ? "selected" : ""}>${n}×</option>`).join("")}
            </select>
          </label>
          <label class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="purple">surround_sound</span><div><strong>Sound stage</strong></div></div>
            <select id="setSpatial">
              <option value="phone" ${spatialMode() === "phone" ? "selected" : ""}>Phone · feel it</option>
              <option value="bass" ${spatialMode() === "bass" ? "selected" : ""}>Super Bass</option>
              <option value="spatial" ${spatialMode() === "spatial" ? "selected" : ""}>Spatial · Atmos-style headphones</option>
              <option value="dynamic" ${spatialMode() === "dynamic" ? "selected" : ""}>Dynamic</option>
              <option value="off" ${spatialMode() === "off" ? "selected" : ""}>Off</option>
            </select>
          </label>
          <div class="set-row set-row-stack">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="pink">high_quality</span><div><strong>Stream quality</strong></div></div>
            <div class="chip-row quality-row">
              ${[["auto", "Auto · network"], ["low", "Low"], ["standard", "Standard"], ["high", "High"], ["highest", "Highest"]].map(([id, label]) =>
                `<button type="button" class="chip ${(p.quality || "high") === id ? "active" : ""}" data-set-quality="${id}">${label}</button>`
              ).join("")}
            </div>
          </div>
          <label class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="teal">audio_file</span><div><strong>Audio codec</strong></div></div>
            <select id="setCodec">
              <option value="auto" ${(p.codec || "auto") === "auto" ? "selected" : ""}>Any</option>
              <option value="mp3" ${p.codec === "mp3" ? "selected" : ""}>MP3</option>
              <option value="aac" ${p.codec === "aac" ? "selected" : ""}>AAC</option>
              <option value="opus" ${p.codec === "opus" ? "selected" : ""}>Opus / Ogg</option>
            </select>
          </label>
        </div>
      </div>`;
  }

  function renderListeningPage() {
    const p = state.prefs;
    const curSleep = state.sleep.mode === "track"
      ? "track"
      : state.sleep.mode === "mins"
        ? String(state.sleep.preset || [5, 10, 15, 30, 45, 60, 90].reduce((best, n) => {
            const left = Math.max(1, Math.round((state.sleep.until - Date.now()) / 60000));
            return Math.abs(n - left) < Math.abs(best - left) ? n : best;
          }, 15))
        : "off";
    return `
      ${settingsSubChrome("Listening")}
      <div class="settings">
        <div class="set-card">
          <label class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="indigo">bedtime</span><div><strong>Sleep timer</strong><p id="sleepListeningStatus" style="margin:2px 0 0;font-size:12px;opacity:0.75">${escapeHTML(sleepStatusLabel())}</p></div></div>
            <select id="setSleep">
              <option value="off" ${curSleep === "off" ? "selected" : ""}>Off</option>
              <option value="5" ${curSleep === "5" ? "selected" : ""}>5 min</option>
              <option value="10" ${curSleep === "10" ? "selected" : ""}>10 min</option>
              <option value="15" ${curSleep === "15" ? "selected" : ""}>15 min</option>
              <option value="30" ${curSleep === "30" ? "selected" : ""}>30 min</option>
              <option value="45" ${curSleep === "45" ? "selected" : ""}>45 min</option>
              <option value="60" ${curSleep === "60" ? "selected" : ""}>60 min</option>
              <option value="90" ${curSleep === "90" ? "selected" : ""}>90 min</option>
              <option value="track" ${curSleep === "track" ? "selected" : ""}>End of track</option>
            </select>
          </label>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="emerald">restore</span><div><strong>Resume last song</strong></div></div>
            <button class="switch ${p.resume ? "on" : ""}" data-pref="resume" type="button"><i></i></button>
          </div>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="amber">light_mode</span><div><strong>Keep screen on</strong></div></div>
            <button class="switch ${p.wake ? "on" : ""}" data-pref="wake" type="button"><i></i></button>
          </div>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="emerald">battery_saver</span><div><strong>Battery Saver</strong></div></div>
            <button class="switch ${p.batterySaver ? "on" : ""}" data-pref="batterySaver" type="button" aria-label="Battery Saver"><i></i></button>
          </div>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="rose">smart_display</span><div><strong>Show YouTube video</strong></div></div>
            <button class="switch ${p.autoVideo ? "on" : ""}" data-pref="autoVideo" type="button"><i></i></button>
          </div>
        </div>
      </div>`;
  }

  function renderAppIconPreview(icon, size = 58) {
    if (icon.id === "default") {
      return `<img src="/logo.png?v=53" alt="Classic Muchi" width="${size}" height="${size}" style="border-radius:14px;object-fit:cover;display:block" />`;
    }
    return getAppIconSvg(icon.id, size);
  }

  function renderAppIconPage() {
    const curId = (state.prefs && state.prefs.appIcon) || "default";
    const curIcon = APP_ICONS.find((i) => i.id === curId) || APP_ICONS[0];
    const cat = state.appIconCat || "all";
    const animeCount = APP_ICONS.filter((i) => i.category === "anime").length;
    const gamingCount = APP_ICONS.filter((i) => i.category === "gaming").length;
    const vibrantCount = APP_ICONS.filter((i) => i.category === "vibrant").length;
    const classicCount = APP_ICONS.filter((i) => i.category === "classic" || i.category === "minimal").length;
    const filtered = cat === "all" ? APP_ICONS : APP_ICONS.filter((i) => {
      if (cat === "classic") return i.category === "classic" || i.category === "minimal";
      return i.category === cat;
    });

    return `
      ${settingsSubChrome("App Icon")}
      <div class="settings">
        <div class="set-card">
          <div class="app-icon-active-preview">
            <div class="app-icon-preview lg" style="display:grid;place-items:center;background:${curIcon.bg}">
              ${renderAppIconPreview(curIcon, 72)}
            </div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <h3 style="margin:0">${escapeHTML(curIcon.title)}</h3>
                <span class="active-badge-pill"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle;margin-right:2px">check</span>In use</span>
              </div>
              <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
                <button type="button" class="chip-btn sm" id="previewSplashBtn">
                  <span class="material-symbols-outlined" style="font-size:16px">play_arrow</span>
                  Preview Opening Screen
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="set-card">
          <div class="set-card-head">
            <h3><span class="material-symbols-outlined">apps</span>Icon Styles</h3>
          </div>
          <div class="chip-row set-sub-chips">
            <button type="button" class="chip ${cat === "all" ? "active" : ""}" data-icon-cat="all">All (${APP_ICONS.length})</button>
            <button type="button" class="chip ${cat === "anime" ? "active" : ""}" data-icon-cat="anime">Anime (${animeCount})</button>
            <button type="button" class="chip ${cat === "gaming" ? "active" : ""}" data-icon-cat="gaming">Gaming & Arcade (${gamingCount})</button>
            <button type="button" class="chip ${cat === "vibrant" ? "active" : ""}" data-icon-cat="vibrant">Vibrant & Neon (${vibrantCount})</button>
            <button type="button" class="chip ${cat === "classic" ? "active" : ""}" data-icon-cat="classic">Classic & Minimal (${classicCount})</button>
          </div>
          <div class="app-icon-grid">
            ${filtered.map((ic) => {
              const isCur = ic.id === curId;
              return `
                <div class="app-icon-card ${isCur ? "active" : ""}" data-set-app-icon="${escapeAttr(ic.id)}" role="button" tabindex="0" title="${escapeAttr(ic.title)}">
                  ${isCur ? `<span class="app-icon-badge"><span class="material-symbols-outlined" style="font-size:13px">check</span></span>` : ""}
                  <div class="app-icon-preview" style="display:grid;place-items:center;background:${ic.bg}">
                    ${renderAppIconPreview(ic, 58)}
                  </div>
                  <strong class="app-icon-title">${escapeHTML(ic.title)}</strong>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function renderFollowingPage() {
    const p = state.prefs;
    const perm = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
    const permBadge = perm === "granted"
      ? `<span class="chip active" style="color:var(--md-sys-color-primary)"><span class="material-symbols-outlined" style="font-size:15px;margin-right:4px">check_circle</span>Granted</span>`
      : perm === "denied"
      ? `<span class="chip" style="color:#f87171"><span class="material-symbols-outlined" style="font-size:15px;margin-right:4px">block</span>Blocked</span>`
      : `<button type="button" class="chip-btn sm" id="requestNotifyPermissionBtn"><span class="material-symbols-outlined" style="font-size:15px">notifications</span>Allow Alerts</button>`;

    const popularSuggestions = [
      "Taylor Swift", "The Weeknd", "Drake", "Billie Eilish",
      "Coldplay", "Arijit Singh", "Dua Lipa", "Kendrick Lamar",
      "Ed Sheeran", "Olivia Rodrigo", "Post Malone", "Ariana Grande"
    ].filter((name) => !state.following.some((f) => f.name.toLowerCase() === name.toLowerCase()));

    return `
      ${settingsSubChrome("Following & Alerts")}
      <div class="settings">
        <div class="set-card">
          <div class="set-card-head">
            <h3><span class="material-symbols-outlined">notifications_active</span>Release Notifications</h3>
            <div class="set-actions">${permBadge}</div>
          </div>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="orange">notifications</span><div><strong>New-release notifications</strong></div></div>
            <button class="switch ${p.notifyFollows ? "on" : ""}" data-pref="notifyFollows" type="button"><i></i></button>
          </div>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="purple">campaign</span><div><strong>In-app release banners</strong></div></div>
            <button class="switch ${p.notifyInApp !== false ? "on" : ""}" data-pref="notifyInApp" type="button"><i></i></button>
          </div>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="blue">sync</span><div><strong>Check for new releases</strong></div></div>
            <button class="chip-btn" id="checkNewReleasesBtn" type="button">
              <span class="material-symbols-outlined">sync</span>
              Check Now
            </button>
          </div>
        </div>

        <div class="set-card">
          <h3><span class="material-symbols-outlined">person_add</span>Follow an Artist</h3>
          <div class="set-sub-body">
            <div class="set-follow-search">
              <div class="search-wrap set-follow-input-wrap" style="flex:1;min-width:0">
                <span class="material-symbols-outlined set-follow-ico" role="button" tabindex="0" title="Follow artist">person_add</span>
                <input id="newFollowArtistInput" type="text" placeholder="Type artist name (e.g. Taylor Swift, Coldplay)…" autocomplete="off" />
                <button class="chip-btn set-follow-inline-btn" id="newFollowArtistBtn" type="button">
                  Follow
                </button>
              </div>
            </div>
            ${popularSuggestions.length ? `
              <div class="set-Quick-suggest">
                <span class="set-sub-kicker">Quick Suggestions</span>
                <div class="chip-row set-sub-chips">
                  ${popularSuggestions.slice(0, 8).map((name) => `
                    <button type="button" class="chip" data-quick-follow="${escapeAttr(name)}">
                      <span class="material-symbols-outlined" style="font-size:14px;margin-right:2px">add</span>
                      ${escapeHTML(name)}
                    </button>
                  `).join("")}
                </div>
              </div>
            ` : ""}
          </div>
        </div>

        <div class="set-card">
          <div class="set-card-head">
            <h3><span class="material-symbols-outlined">group</span>Followed Artists (${state.following.length})</h3>
          </div>
          <div class="list set-sub-list">
            ${state.following.map((f) => `
              <div class="track-row" style="align-items:center">
                <img src="${escapeAttr(f.artwork || "/cover-default.jpg")}" alt="" onerror="this.src='/cover-default.jpg'"/>
                <div style="flex:1;min-width:0">
                  <div class="t-title">${escapeHTML(f.name)}</div>
                  <div class="t-sub">${escapeHTML(f.source || "Catalog")}${f.handle ? " · @" + escapeHTML(f.handle) : ""}</div>
                </div>
                <div class="set-actions">
                  <button type="button" class="chip-btn sm" data-open-followed-artist="${escapeAttr(f.name)}" data-artist-name="${escapeAttr(f.name)}" title="View artist discography">View</button>
                  <button type="button" class="chip-btn sm" data-unfollow="${escapeAttr(f.key)}">Unfollow</button>
                </div>
              </div>
            `).join("") || "<p class='empty' style='padding:20px;text-align:center'>No followed artists yet. Follow an artist above or tap the person icon in Now Playing.</p>"}
          </div>
        </div>
      </div>
    `;
  }

  function renderDataPage() {
    const dls = state.downloads || [];
    const recentsCount = (state.recents || []).length;
    const likesCount = (state.likes || []).length;
    const plCount = (state.playlists || []).length;

    return `
      ${settingsSubChrome("Data & Storage")}
      <div class="settings">
        <div class="set-card">
          <h3><span class="material-symbols-outlined">pie_chart</span>Storage Usage</h3>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="blue">hard_drive</span><div><strong>Browser storage estimate</strong></div></div>
            <span id="cacheHint" class="set-meta-val">Measuring…</span>
          </div>
          <div class="set-stats-grid">
            <div class="set-stat-tile">
              <strong>${dls.length}</strong>
              <span>Offline songs</span>
            </div>
            <div class="set-stat-tile">
              <strong>${recentsCount}</strong>
              <span>History plays</span>
            </div>
            <div class="set-stat-tile">
              <strong>${likesCount}</strong>
              <span>Liked songs</span>
            </div>
            <div class="set-stat-tile">
              <strong>${plCount}</strong>
              <span>Mixes created</span>
            </div>
          </div>
        </div>

        <div class="set-card">
          <h3><span class="material-symbols-outlined">cleaning_services</span>Cache & Offline Data</h3>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="amber">cached</span><div><strong>App shell & cache</strong></div></div>
            <button class="chip-btn" data-clear="sw" type="button">Clear Cache</button>
          </div>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="purple">history</span><div><strong>Listening history</strong></div></div>
            <button class="chip-btn" data-clear="recents" type="button">Clear History</button>
          </div>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="rose">download_for_offline</span><div><strong>Offline downloads</strong></div></div>
            <button class="chip-btn" data-clear="dl" type="button">Delete Downloads</button>
          </div>
        </div>

        <div class="set-card">
          <h3><span class="material-symbols-outlined">cloud_upload</span>Backup & Restore</h3>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="emerald">download</span><div><strong>Export library backup</strong></div></div>
            <button class="chip-btn" id="exportDataBtn" type="button">
              <span class="material-symbols-outlined">download</span>
              Export Backup
            </button>
          </div>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="blue">upload</span><div><strong>Import library backup</strong></div></div>
            <div class="set-actions">
              <button class="chip-btn" id="importDataBtn" type="button">
                <span class="material-symbols-outlined">upload</span>
                Import Backup
              </button>
              <input type="file" id="importDataFile" accept=".json,application/json" style="display:none" />
            </div>
          </div>
          <div class="set-row">
            <div class="set-label"><span class="material-symbols-outlined set-ico" data-ico="orange">restart_alt</span><div><strong>Reset settings</strong></div></div>
            <button class="chip-btn" id="resetPrefsBtn" type="button">Reset Preferences</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderOfflinePage() {
    const dls = state.downloads || [];
    const withLyricsCount = dls.filter((d) => hasOfflineSyncedLyrics(d)).length;
    return `
      ${settingsSubChrome("Offline & Downloads")}
      <div class="settings">
        <div class="set-card">
          <h3><span class="material-symbols-outlined">offline_pin</span>Offline Mode (Android & iOS)</h3>
          <div class="set-row">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="teal">cloud_off</span>
              <div><strong>Offline Mode</strong></div>
            </div>
            <button class="switch ${state.offlineMode ? "on" : ""}" id="toggleOfflineMode" type="button"><i></i></button>
          </div>
          <div class="set-row">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="purple">subtitles</span>
              <div><strong>Offline Synced Lyrics</strong><div style="font-size:12px;opacity:.75">${dls.length ? `${withLyricsCount} of ${dls.length} downloaded songs have synced lyrics saved` : "Automatically saved alongside downloaded audio"}</div></div>
            </div>
            <button class="chip-btn sm" id="syncOfflineLyricsBtn" type="button">
              <span class="material-symbols-outlined">sync</span>Sync Lyrics
            </button>
          </div>
        </div>

        <div class="set-card">
          <div class="set-card-head">
            <h3><span class="material-symbols-outlined">download_done</span>Downloads on disk (${dls.length})</h3>
            ${dls.length ? `
              <div class="set-actions">
                <button class="chip-btn sm" id="playDownloads" type="button">
                  <span class="material-symbols-outlined">play_arrow</span>Play All
                </button>
                <button class="chip-btn sm" id="clearDownloads" type="button">
                  <span class="material-symbols-outlined">delete_sweep</span>Delete All
                </button>
              </div>
            ` : ""}
          </div>
          <div class="set-row">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="emerald">download_done</span>
              <div><strong>Downloads on disk</strong></div>
            </div>
            <span class="set-meta-val">${dls.length}</span>
          </div>
          ${renderDlManager()}
          <div class="list set-sub-list">${dls.map((t, i) => {
            const hasLyr = hasOfflineSyncedLyrics(t);
            return `
            <div class="track-row ${current() && current().id === t.id ? "active" : ""}">
              <img src="${escapeAttr(artUrl(t))}" alt="" loading="lazy" onerror="this.src='/cover-default.jpg'"/>
              <button type="button" data-play="${escapeAttr(t.id)}" data-idx="${i}" style="all:unset;cursor:pointer;flex:1;min-width:0">
                <div class="t-title">${escapeHTML(t.title)}</div>
                <div class="t-sub">${escapeHTML(t.artist)}${hasLyr ? ` · <span class="dl-lyr-pill">Synced lyrics</span>` : ""}</div>
              </button>
              <button type="button" class="icon-btn" data-save-lyr="${escapeAttr(t.id)}" title="${hasLyr ? "Synced lyrics saved offline (tap to export .lrc)" : "Save synced lyrics offline"}">
                <span class="material-symbols-outlined" style="${hasLyr ? "color:var(--md-sys-color-primary)" : ""}">subtitles</span>
              </button>
              <button type="button" class="icon-btn" data-del-dl="${escapeAttr(t.id)}" title="Remove">
                <span class="material-symbols-outlined">delete</span>
              </button>
            </div>`;
          }).join("") || "<p class='empty' style='padding:16px'>Save a track from Now Playing.</p>"}</div>
        </div>
      </div>
    `;
  }

  function renderSettings() {
    if (state.settingsPage === "appearance") return renderAppearance();
    if (state.settingsPage === "ui") return renderUiPage();
    if (state.settingsPage === "appicon") return renderAppIconPage();
    if (state.settingsPage === "player") return renderPlayerPage();
    if (state.settingsPage === "playback") return renderPlaybackPage();
    if (state.settingsPage === "listening") return renderListeningPage();
    if (state.settingsPage === "following") return renderFollowingPage();
    if (state.settingsPage === "offline") return renderOfflinePage();
    if (state.settingsPage === "data") return renderDataPage();
    const p = state.prefs;
    const opts = COUNTRIES.map(([c, n]) => `<option value="${c}" ${p.country === c ? "selected" : ""}>${n}</option>`).join("");
    const gh = String(p.github || "").replace(/\/$/, "");
    const ghOk = /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/i.test(gh);
    return `
      <div class="hero">
        <div>
          <button class="chip-btn page-back" id="settingsBack" type="button">
            <span class="material-symbols-outlined">arrow_back</span>
            Back
          </button>
          <h1>Settings</h1>
        </div>
      </div>
      <div class="settings">
        ${accountCardHTML()}
        <div class="set-card">
          <h3><span class="material-symbols-outlined">palette</span>Look</h3>
          <button type="button" class="set-row set-go" id="openUi">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="violet">dashboard_customize</span>
              <div><strong>UI</strong></div>
            </div>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
          <button type="button" class="set-row set-go" id="openAppearance">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="amber">dark_mode</span>
              <div><strong>Appearance</strong></div>
            </div>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
          <button type="button" class="set-row set-go" id="openAppIcon">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="pink">apps</span>
              <div><strong>App Icon</strong></div>
            </div>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
          <button type="button" class="set-row set-go" id="openPlayer">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="cyan">equalizer</span>
              <div><strong>Player</strong></div>
            </div>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
          <div class="set-row">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="emerald">battery_saver</span>
              <div><strong>Battery Saver</strong></div>
            </div>
            <button class="switch ${p.batterySaver ? "on" : ""}" data-pref="batterySaver" type="button" aria-label="Battery Saver"><i></i></button>
          </div>
        </div>
        <div class="set-card">
          <h3><span class="material-symbols-outlined">graphic_eq</span>Sound</h3>
          <button type="button" class="set-row set-go" id="openPlayback">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="emerald">tune</span>
              <div><strong>Playback</strong></div>
            </div>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
          <button type="button" class="set-row set-go" id="openListening">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="purple">headphones</span>
              <div><strong>Listening</strong></div>
            </div>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
        <div class="set-card">
          <h3><span class="material-symbols-outlined">public</span>Catalog</h3>
          <label class="set-row">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="blue">language</span>
              <div><strong>Country</strong></div>
            </div>
            <select id="setCountry">${opts}</select>
          </label>
        </div>
        <div class="set-card">
          <h3><span class="material-symbols-outlined">notifications_active</span>Artists & Alerts</h3>
          <button type="button" class="set-row set-go" id="openFollowing">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="orange">notifications_active</span>
              <div><strong>Following & Alerts</strong></div>
            </div>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
        <div class="set-card">
          <h3><span class="material-symbols-outlined">offline_pin</span>Offline & Downloads</h3>
          <button type="button" class="set-row set-go" id="openOffline">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="teal">download_for_offline</span>
              <div><strong>Offline Mode & Downloads</strong></div>
            </div>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
        <div class="set-card">
          <h3><span class="material-symbols-outlined">storage</span>Storage & Backups</h3>
          <button type="button" class="set-row set-go" id="openData">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="indigo">folder_special</span>
              <div><strong>Data & Storage</strong></div>
            </div>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
        <div class="set-card">
          <h3><span class="material-symbols-outlined">info</span>About</h3>
          <div class="set-row">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="violet">verified</span>
              <div><strong>Muchi ${APP_VERSION}</strong></div>
            </div>
          </div>
          <div class="set-row">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="blue">system_update</span>
              <div><strong>Updates</strong></div>
            </div>
            <div class="set-actions">
              <button class="chip-btn" id="updateBtn" type="button"><span class="material-symbols-outlined">system_update</span>Update</button>
              <button class="chip-btn" id="reloadApp" type="button"><span class="material-symbols-outlined">refresh</span>Reload App</button>
            </div>
          </div>
          <div class="set-row">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="amber">help</span>
              <div><strong>Help</strong></div>
            </div>
            <div class="set-actions">
              <button class="chip-btn" id="ghRelease" type="button">What's new</button>
              <a class="chip-btn" id="ghBug" href="${escapeAttr(`${(gh && gh.url) || "https://github.com/Kaibshshdheueejw/Muchi"}/issues/new?title=${encodeURIComponent("Feedback: ")}&body=${encodeURIComponent(`**Muchi ${APP_VERSION}**\nDevice: ${navigator.userAgent}\n\nFeedback:\n`)}`)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">Send feedback</a>
            </div>
          </div>
          <div class="set-row">
            <div class="set-label">
              <span class="material-symbols-outlined set-ico" data-ico="teal">policy</span>
              <div><strong>Legal &amp; Privacy</strong></div>
            </div>
            <div class="set-actions">
              <a class="chip-btn" id="openPrivacyBtn" data-legal="privacy" href="/privacy.html" style="text-decoration:none">Privacy Policy</a>
              <a class="chip-btn" id="openTermsBtn" data-legal="terms" href="/terms.html" style="text-decoration:none">Terms of Service</a>
            </div>
          </div>
        </div>
        <div class="dev-credit" aria-label="Developer">
          <span class="dev-kicker">Developer</span>
          <strong class="dev-name">Mochi</strong>
          <p class="dev-handle">Kaibshshdheueejw · he/him</p>
          <a class="dev-gh" href="https://github.com/Kaibshshdheueejw" target="_blank" rel="noopener noreferrer">
            <img src="https://github.com/Kaibshshdheueejw.png?size=96" alt="" width="44" height="44"/>
            <span>
              <strong>github.com/Kaibshshdheueejw</strong>
              <em>Open source · Muchi (public)</em>
            </span>
          </a>
          <a class="dev-repo" href="https://github.com/Kaibshshdheueejw/Muchi" target="_blank" rel="noopener noreferrer">View the code</a>
        </div>
      </div>
    `;
  }

  async function measureCache() {
    const el = $("cacheHint");
    if (!el) return;
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        el.textContent = `${((e.usage || 0) / 1048576).toFixed(1)} MB of about ${((e.quota || 0) / 1048576).toFixed(0)} MB (browser estimate).`;
      } else {
        el.textContent = `${state.downloads.length} offline files · recents ${state.recents.length}.`;
      }
    } catch {
      el.textContent = "Could not measure storage.";
    }
  }

  function renderDetail() {
    const t = state.detailTrack || current();
    if (!t) {
      return `<button class="chip-btn page-back" id="detailBack" type="button"><span class="material-symbols-outlined">arrow_back</span> Back</button>
        <div class="empty"><h3>No song selected</h3></div>`;
    }
    const isMix = /hits|mix|playlist|top\s*\d|billboard|compilation/i.test(t.title || "") && (Number(t.duration) || 0) > 20 * 60;
    const dur = Number(t.duration) || 0;
    const year = t.year || t.releaseDate || t.albumYear || "";
    const singer = artistName(t) || t.artist || "Unknown artist";
    const kind = t.source === "radio" ? "Live radio" : isMix ? "Album / mix" : "Song";
    const srcLabel = t.source === "audius" ? "Independent" : t.source === "radio" ? "Radio" : t.source === "apple" ? "Catalog" : "Official audio";
    const facts = [
      ["Singer", singer],
      ["Length", dur ? fmt(dur) : isMix ? "Long mix" : "Single"],
      ["Released", year ? String(year) : "Not listed"],
      ["From", t.album ? t.album : srcLabel],
    ];
    const playingThis = current() && current().id === t.id;
    const playGlyph = playingThis && state.playing ? "pause" : "play_arrow";
    const playLabel = playingThis && state.playing ? "Playing" : playingThis ? "Resume" : "Play";
    const playIconClass = playGlyph !== lastPlayGlyph ? "filled icon-swap" : "filled";
    return `
      <div class="detail-page">
        <button class="chip-btn page-back" id="detailBack" type="button"><span class="material-symbols-outlined">arrow_back</span> Back</button>
        <div class="detail-hero">
          <img class="detail-art" src="${escapeAttr(artUrl(t))}" alt="" onerror="this.src='/cover-default.jpg'"/>
          <div class="detail-copy">
            <p class="lib-kicker">${kind}</p>
            <h1>${escapeHTML(t.title)}</h1>
            <button type="button" class="detail-artist artist-link" id="detailArtist">${escapeHTML(singer)}</button>
            <div class="detail-facts">
              ${facts.map(([k, v]) => `<div class="detail-fact"><span>${escapeHTML(k)}</span><strong>${escapeHTML(v)}</strong></div>`).join("")}
            </div>
            <p class="detail-blurb">${escapeHTML(isMix
              ? `A longer ${kind.toLowerCase()} by ${singer}. Open play to start this mix — it will not restart if it is already on.`
              : `${t.title} is a ${kind.toLowerCase()} by ${singer}${year ? `, listed around ${year}` : ""}. ${srcLabel}.`)}</p>
            <div class="lib-hero-actions">
              <button class="filled-btn" id="detailPlay" type="button"><span class="material-symbols-outlined ${playIconClass}">${playGlyph}</span> ${playLabel}</button>
              <button class="chip-btn" id="detailLike" type="button">${isLiked(t) ? "Liked" : "Like"}</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderNow() {
    const t = current();
    if (!t) {
      return `
        <button class="chip-btn" id="nowBack" type="button"><span class="material-symbols-outlined">arrow_back</span> Back</button>
        <div class="empty"><h3>Nothing playing</h3><p>Play a song, then tap lyrics.</p></div>`;
    }
    const art = artUrl(t);
    const saved = isSaved(t);
    const hasOfflineLyr = hasOfflineSyncedLyrics(t) || Boolean(state.lyrics && state.lyrics.key === lyricsKey(t) && ((state.lyrics.synced && state.lyrics.synced.length) || state.lyrics.lyrics));
    const followingNow = t.source !== "radio" && isFollowing(t);
    const canVideo = t.source !== "radio" && t.source !== "audius";
    return `
      <div class="ly-screen">
        <div class="ly-bg" style="background-image:url('${escapeAttr(art)}')"></div>
        <div class="ly-head">
          <button class="icon-btn" id="nowBack" type="button" title="Back" aria-label="Back">
            <span class="material-symbols-outlined">keyboard_arrow_down</span>
          </button>
          <div class="ly-meta">
            <img src="${escapeAttr(art)}" alt="" onerror="this.src='/cover-default.jpg'"/>
            <div style="min-width:0;flex:1">
              <strong class="is-marquee" data-marquee-title="${escapeAttr(t.title)}" style="--marquee-dur:${marqueeDurationForTitle(t.title)}">${buildMarqueeTitleHTML(t.title)}</strong>
              <button type="button" class="artist-link-now" id="nowArtist">${escapeHTML(artistName(t) || t.artist)}</button>
            </div>
          </div>
          <div class="ly-head-actions">
            ${t.source !== "radio" ? `
            <button class="icon-btn ${saved ? "on" : ""}" id="nowDlBtn" type="button" title="${saved ? "Saved offline with synced lyrics" : "Download song & synced lyrics"}">
              <span class="material-symbols-outlined">${saved ? "download_done" : "download"}</span>
            </button>
            <button class="icon-btn ${hasOfflineSyncedLyrics(t) ? "on" : ""}" id="nowSaveLyrBtn" type="button" title="${hasOfflineSyncedLyrics(t) ? "Synced lyrics saved offline (tap to export .lrc)" : "Save synced lyrics offline"}">
              <span class="material-symbols-outlined">subtitles</span>
            </button>
            <button class="icon-btn ${followingNow ? "on" : ""}" id="nowFollowBtn" type="button" title="${followingNow ? "Following artist" : "Follow artist"}">
              <span class="material-symbols-outlined">${followingNow ? "how_to_reg" : "person_add"}</span>
            </button>` : ""}
            ${canVideo ? `
            <button class="icon-btn ${state.showVideo ? "on" : ""}" id="nowVideoBtn" type="button" title="Watch video">
              <span class="material-symbols-outlined">smart_display</span>
            </button>` : ""}
            <button class="icon-btn" id="nowOptsBtn" type="button" title="Player options">
              <span class="material-symbols-outlined">tune</span>
            </button>
          </div>
        </div>
        <div class="ly-scroll" id="lyScroll">${lyricsBodyHTML()}</div>
      </div>`;
  }

  function syncTopbar() {
    const bar = $("topbar");
    if (!bar) return;
    const on = state.view === "search";
    bar.hidden = !on;
    document.body.dataset.view = state.view;
    if (on) {
      const inp = $("searchInput");
      if (inp && document.activeElement !== inp) {
        if (state.query && inp.value !== state.query) {
          inp.value = state.query;
        } else if (!state.query && inp.value) {
          inp.value = "";
        }
      }
    }
  }

  function render() {
    const map = { home: renderHome, search: renderSearch, radio: renderRadio, library: renderLibrary, now: renderNow, settings: renderSettings, detail: renderDetail };
    viewEl.innerHTML = (map[state.view] || renderHome)();
    syncTopbar();
    renderChrome();
    renderPlaylistsNav();
    bindView();
    if (state.view === "settings" && !state._cacheOnce) { state._cacheOnce = true; measureCache(); }
  }

  function softRender() {
    render();
    fadeView();
  }

  function fadeView() {
    if (!viewEl) return;
    viewEl.classList.remove("view-in");
    void viewEl.offsetWidth;
    viewEl.classList.add("view-in");
  }

  function bindView() {
    viewEl.querySelectorAll("[data-more]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = el.dataset.more;
        const idx = Number(el.dataset.idx);
        let track = null;
        if (state.view === "library" && state.activePlaylist === "liked") {
          track = (state.liked[idx] && state.liked[idx].id === id) ? state.liked[idx] : state.liked.find((t) => t.id === id);
        } else if (state.view === "library" && (state.activePlaylist === "downloads" || state.libFilter === "downloaded")) {
          track = (state.downloads[idx] && state.downloads[idx].id === id) ? state.downloads[idx] : state.downloads.find((t) => t.id === id);
        } else if (state.view === "library" && state.activePlaylist === "yt-liked") {
          const rows = (state.ytLiked && state.ytLiked.tracks) || [];
          track = (rows[idx] && rows[idx].id === id) ? rows[idx] : rows.find((t) => t && t.id === id);
        } else if (state.view === "library" && typeof state.activePlaylist === "string" && state.activePlaylist.indexOf("yt-pl:") === 0) {
          const rows = (state.ytOpen && state.ytOpen.tracks) || [];
          track = (rows[idx] && rows[idx].id === id) ? rows[idx] : rows.find((t) => t && t.id === id);
        } else if (state.view === "library" && state.activePlaylist === "catalog") {
          const rows = (state.catalogPlaylist && state.catalogPlaylist.tracks) || [];
          track = (rows[idx] && rows[idx].id === id) ? rows[idx] : rows.find((t) => t.id === id);
        } else if (state.view === "library" && state.activePlaylist === "discovery") {
          const rows = (state.discovery && state.discovery.tracks) || [];
          track = (rows[idx] && rows[idx].id === id) ? rows[idx] : rows.find((t) => t && t.id === id);
        } else if (state.view === "library" && typeof state.activePlaylist === "number") {
          const rows = state.playlists[state.activePlaylist] && state.playlists[state.activePlaylist].tracks || [];
          track = (rows[idx] && rows[idx].id === id) ? rows[idx] : rows.find((t) => t.id === id);
        }
        if (!track) track = findTrack(id);
        if (!track) { toast("Couldn't open options", true, "error"); return; }
        const where = state.view === "library" && state.activePlaylist === "liked"
          ? "liked"
          : state.view === "library" && (state.activePlaylist === "downloads" || state.libFilter === "downloaded")
            ? "downloads"
            : state.view === "library" && state.activePlaylist === "yt-liked"
              ? "yt-liked"
              : state.view === "library" && typeof state.activePlaylist === "string" && state.activePlaylist.indexOf("yt-pl:") === 0
                ? "yt-playlist"
                : state.view === "library" && typeof state.activePlaylist === "number"
                  ? "playlist"
                  : "generic";
        openTrackMenu(track, where);
      });
    });
    viewEl.querySelectorAll("[data-open-detail]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const track = findTrack(el.dataset.openDetail);
        if (track) openTrackDetail(track);
      });
    });
    const detailBack = viewEl.querySelector("#detailBack");
    if (detailBack) detailBack.addEventListener("click", requestBack);
    const detailPlay = viewEl.querySelector("#detailPlay");
    if (detailPlay) {
      detailPlay.addEventListener("pointerdown", (e) => triggerFabRipple(detailPlay, e));
      detailPlay.addEventListener("click", () => {
      const tr = state.detailTrack || current();
      if (!tr) return;
      if (current() && current().id === tr.id) {
        togglePlay();
        const ico = detailPlay.querySelector(".material-symbols-outlined");
        if (ico) swapPlayGlyph(ico, state.playing ? "pause" : "play_arrow");
        detailPlay.childNodes.forEach((n) => {
          if (n.nodeType === 3) n.textContent = state.playing ? "Playing" : "Resume";
        });
        return;
      }
      playFromList([tr], 0);
    });
    }
    const detailArtist = viewEl.querySelector("#detailArtist");
    if (detailArtist) detailArtist.addEventListener("click", () => openArtistFromTrack(state.detailTrack || current()));
    const detailLike = viewEl.querySelector("#detailLike");
    if (detailLike) detailLike.addEventListener("click", () => {
      const tr = state.detailTrack || current();
      if (tr) { toggleLike(tr); render(); }
    });
    viewEl.querySelectorAll("[data-set-icons]").forEach((el) => {
      el.addEventListener("click", () => {
        state.prefs.iconSize = el.dataset.setIcons;
        savePrefs();
        applyUi();
        render();
      });
    });
    viewEl.querySelectorAll("[data-play]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-del-dl], [data-dl], [data-more]")) return;
        const id = el.dataset.play;
        const idx = Number(el.dataset.idx);
        const fallbackMeta = {
          title: el.dataset.title || (el.querySelector(".t-title, h3") ? el.querySelector(".t-title, h3").textContent : ""),
          artist: el.dataset.artist || (el.querySelector(".t-sub, p") ? String(el.querySelector(".t-sub, p").textContent || "").split("·")[0].trim() : ""),
          source: el.dataset.source || "",
          artwork: el.querySelector("img") ? el.querySelector("img").getAttribute("src") || "" : "",
        };
        const fromSearch = state.view === "search";
        let list = [];
        if (state.view === "library" && state.activePlaylist === "liked") list = state.liked;
        else if (state.view === "library" && state.activePlaylist === "downloads") list = state.downloads;
        else if (state.view === "library" && state.activePlaylist === "yt-liked") list = (state.ytLiked && state.ytLiked.tracks) || [];
        else if (state.view === "library" && typeof state.activePlaylist === "string" && state.activePlaylist.indexOf("yt-pl:") === 0) list = (state.ytOpen && state.ytOpen.tracks) || [];
        else if (state.view === "library" && state.activePlaylist === "discovery") list = (state.discovery && state.discovery.tracks) || [];
        else if (state.view === "library" && state.activePlaylist === "catalog") list = (state.catalogPlaylist && state.catalogPlaylist.tracks) || [];
        else if (state.view === "library" && typeof state.activePlaylist === "number") list = state.playlists[state.activePlaylist].tracks;
        else if (state.view === "settings") list = state.downloads;
        else if (fromSearch && state.artistPage) list = [].concat(
          (state.artistPage && state.artistPage.popular) || [],
          (state.artistPage && state.artistPage.songs) || []
        );
        else if (fromSearch && state.filter === "history") list = state.recents;
        else if (fromSearch && (state.filter === "songs" || state.filter === "all")) list = [].concat(
          (state.search && state.search.youtube) || [],
          (state.search && ((state.search.apple && state.search.apple.length) ? state.search.apple : state.search.itunes)) || [],
          (state.search && state.search.deezer) || [],
          (state.search && state.search.audius) || [],
          (state.search && state.search.radio) || [],
          state.recents
        );
        else if (fromSearch && state.filter === "deezer") list = [].concat(
          (state.search && state.search.deezer) || []
        );
        else if (fromSearch && state.filter === "itunes") list = [].concat(
          (state.search && ((state.search.apple && state.search.apple.length) ? state.search.apple : state.search.itunes)) || []
        );
        else if (fromSearch && state.filter === "youtube") list = [].concat(
          (state.search && state.search.youtube) || []
        );
        else if (fromSearch && state.filter === "audius") list = [].concat(
          (state.search && state.search.audius) || []
        );
        else if (fromSearch) list = [].concat(
          (state.search && state.search.youtube) || [],
          (state.search && ((state.search.apple && state.search.apple.length) ? state.search.apple : state.search.itunes)) || [],
          (state.search && state.search.deezer) || [],
          (state.search && state.search.audius) || [],
          (state.search && state.search.radio) || [],
          state.recents
        );
        else if (state.view === "radio") list = state.radio;
        else if (state.view === "home" && el.closest("[data-disc-mix]")) list = (state.discovery && state.discovery.tracks) || [];
        else if (state.view === "home") list = homeTrackPool();
        else if (state.view === "library") list = [].concat(state.liked, state.recents, state.downloads);
        else list = state.queue;
        list = (list || []).filter(Boolean);
        const i = Number.isInteger(idx) && list[idx] && list[idx].id === id ? idx : list.findIndex((t) => t && t.id === id);
        let track = i >= 0 ? list[i] : findTrack(id, fallbackMeta);
        if (!track && fallbackMeta.title) {
          track = {
            id: id || `deezer:${Date.now()}`,
            rawId: String(id || "").replace(/^(deezer:|apple:|itunes:|yt:)/, ""),
            source: fallbackMeta.source || (String(id || "").startsWith("deezer:") ? "deezer" : "youtube"),
            title: fallbackMeta.title,
            artist: fallbackMeta.artist || "Artist",
            album: "",
            duration: 180,
            artwork: fallbackMeta.artwork || "/cover-default.jpg",
            playQuery: `${fallbackMeta.title} ${fallbackMeta.artist || ""} official audio`.trim(),
          };
        }
        if (!track) return;
        if (fromSearch && !state.artistPage && state.filter !== "history" && track.source !== "radio") {
          playFromList([track], 0);
          fillRelatedQueue(track);
          return;
        }
        if (i >= 0) playFromList(list, i);
        else playFromList([track, ...state.queue], 0);
      });
    });
    viewEl.querySelectorAll("[data-mood]").forEach((el) => {
      el.addEventListener("click", () => runSearch(el.dataset.mood));
    });
    viewEl.querySelectorAll("[data-taste-tab]").forEach((el) => {
      el.addEventListener("click", () => {
        state.homeTasteTab = el.dataset.tasteTab === "discover" ? "discover" : "moods";
        if (state.homeTasteTab === "discover") loadDiscoveryMix();
        render();
      });
    });
    const playDiscovery = viewEl.querySelector("#playDiscovery");
    if (playDiscovery) {
      playDiscovery.addEventListener("click", () => {
        const list = (state.discovery && state.discovery.tracks) || [];
        if (list[0]) playFromList(list, 0);
      });
    }
    const openDisc = () => {
      rememberScroll();
      const originView = (state.view === "library" && state.activePlaylist != null)
        ? (state.playlistFrom || state.prevView || "home")
        : (state.view || "home");
      state.playlistFrom = originView;
      state.prevView = originView;
      state.view = "library";
      state.activePlaylist = "discovery";
      navPush();
      paintNav(false);
    };
    const openDiscoveryBtn = viewEl.querySelector("#openDiscoveryBtn");
    if (openDiscoveryBtn) openDiscoveryBtn.addEventListener("click", (e) => { e.stopPropagation(); openDisc(); });
    const openDiscovery = viewEl.querySelector("#openDiscovery");
    if (openDiscovery) openDiscovery.addEventListener("click", (e) => {
      if (e.target.closest("#openDiscoveryBtn")) return;
      if ((state.discovery.tracks || []).length) openDisc();
    });
    viewEl.querySelectorAll("[data-filter]").forEach((el) => {
      el.addEventListener("click", () => {
        state.filter = el.dataset.filter;
        ensureProviderResults(state.filter);
        render();
      });
    });
    viewEl.querySelectorAll("[data-open-artist]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const pool = (state.artistPage && state.artistPage.albums) ? null : ((state.search && state.search.artists) || []);
        const explicitName = (el.dataset.artistName || "").trim();
        const explicitId = (el.dataset.artistId || "").trim();
        const rawIdx = (el.dataset.openArtist || "").trim();
        let a = null;
        if (pool && explicitName) {
          a = pool.find((x) => x && String(x.name || "").toLowerCase() === explicitName.toLowerCase());
        }
        if (!a && pool && /^\d+$/.test(rawIdx)) {
          a = pool[Number(rawIdx)];
        }
        if (!a && explicitName) {
          a = { name: explicitName, id: explicitId, artwork: "", source: "apple", query: explicitName };
        }
        if (a && a.name) openArtistProfile(a);
      });
    });
    const artistBack = viewEl.querySelector("#artistBack");
    if (artistBack) artistBack.addEventListener("click", requestBack);
    const artistMore = viewEl.querySelector("#artistMore");
    if (artistMore && state.artistPage) {
      artistMore.addEventListener("click", () => {
        state.artistPage.shown = Math.min(((Number(state.artistPage.shown) || 40) + 60), ((state.artistPage.songs || []).length));
        render();
      });
    }
    const albumMore = viewEl.querySelector("#albumMore");
    if (albumMore && state.artistPage) {
      albumMore.addEventListener("click", () => {
        state.artistPage.albumsShown = Math.min(((Number(state.artistPage.albumsShown) || 40) + 60), ((state.artistPage.albums || []).length));
        render();
      });
    }
    const playArtist = viewEl.querySelector("#playArtist");
    if (playArtist) {
      playArtist.addEventListener("click", () => {
        const songs = state.artistPage && state.artistPage.songs;
        if (songs && songs[0]) playFromList(songs, 0);
      });
    }
    const followArtist = viewEl.querySelector("#followArtist");
    if (followArtist) {
      followArtist.addEventListener("click", () => {
        const a = state.artistPage;
        if (!a) return;
        toggleFollow({ artist: a.name, origName: a.origName || a.name, source: a.source || "youtube", artwork: a.artwork, id: a.id });
      });
    }
    const nowArtist = viewEl.querySelector("#nowArtist");
    if (nowArtist) nowArtist.addEventListener("click", () => openArtistFromTrack(current()));
    const nowDlBtn = viewEl.querySelector("#nowDlBtn");
    if (nowDlBtn) {
      nowDlBtn.addEventListener("click", () => {
        const cur = current();
        if (cur) downloadTrack(cur);
      });
    }
    const nowSaveLyrBtn = viewEl.querySelector("#nowSaveLyrBtn");
    if (nowSaveLyrBtn) {
      nowSaveLyrBtn.addEventListener("click", () => {
        const cur = current();
        if (!cur) return;
        if (hasOfflineSyncedLyrics(cur)) {
          exportTrackLrc(cur);
        } else {
          saveSyncedLyricsForTrackInteractive(cur);
        }
      });
    }
    const nowFollowBtn = viewEl.querySelector("#nowFollowBtn");
    if (nowFollowBtn) {
      nowFollowBtn.addEventListener("click", () => {
        const cur = current();
        if (cur) {
          toggleFollow(cur);
          render();
        }
      });
    }
    const nowVideoBtn = viewEl.querySelector("#nowVideoBtn");
    if (nowVideoBtn) {
      nowVideoBtn.addEventListener("click", () => {
        if ($("videoBtn")) $("videoBtn").click();
        render();
      });
    }
    const nowOptsBtn = viewEl.querySelector("#nowOptsBtn");
    if (nowOptsBtn) {
      nowOptsBtn.addEventListener("click", () => openPlayerOptions());
    }
    viewEl.querySelectorAll("[data-ytpl]").forEach((el) => {
      el.addEventListener("click", () => openCatalogPlaylist({
        playlistId: el.dataset.ytpl,
        query: el.dataset.plQ,
        title: el.querySelector(".t-title") ? el.querySelector(".t-title").textContent : "Playlist",
        artwork: el.querySelector("img") ? el.querySelector("img").src : "",
      }));
    });
    viewEl.querySelectorAll("[data-open-home-pl]").forEach((el) => {
      el.addEventListener("click", () => {
        const group = el.dataset.openHomePl;
        const i = Number(el.dataset.plI);
        const list = group === "country"
          ? (state.home && state.home.countryPlaylists) || []
          : (state.home && state.home.globalPlaylists) || [];
        const p = list[i];
        if (p) openCatalogPlaylist(p);
      });
    });
    viewEl.querySelectorAll("[data-open-shelf]").forEach((el) => {
      el.addEventListener("click", () => openShelfPlaylist(el.dataset.openShelf));
    });
    viewEl.querySelectorAll("[data-open-fy]").forEach((el) => {
      el.addEventListener("click", () => openForYouPlaylist(Number(el.dataset.openFy)));
    });
    viewEl.querySelectorAll("[data-open-taste-pl]").forEach((el) => {
      el.addEventListener("click", () => openTastePlaylist(Number(el.dataset.openTastePl)));
    });
    viewEl.querySelectorAll("[data-open-viral]").forEach((el) => {
      el.addEventListener("click", () => openViralPlaylist(Number(el.dataset.openViral)));
    });
    const playCatalog = viewEl.querySelector("#playCatalog");
    if (playCatalog) {
      playCatalog.addEventListener("click", () => {
        const list = (state.catalogPlaylist && state.catalogPlaylist.tracks) || [];
        if (list[0]) playFromList(list, 0);
      });
    }
    viewEl.querySelectorAll("[data-radio-q]").forEach((el) => {
      el.addEventListener("click", () => loadRadio(el.dataset.radioQ));
    });
    viewEl.querySelectorAll("[data-open-pl]").forEach((el) => {
      el.addEventListener("click", () => {
        rememberScroll();
        state.playlistFrom = (state.view === "library" && state.activePlaylist != null) ? (state.playlistFrom || "library") : (state.view || "library");
        state.activePlaylist = Number(el.dataset.openPl);
        navPush();
        paintNav(false);
      });
    });
    const np = viewEl.querySelector("#newPl2");
    if (np) np.addEventListener("click", newPlaylist);
    viewEl.querySelectorAll("[data-open-yt-liked]").forEach((el) => {
      el.addEventListener("click", () => {
        rememberScroll();
        state.playlistFrom = (state.view === "library" && state.activePlaylist != null) ? (state.playlistFrom || "library") : (state.view || "library");
        state.activePlaylist = "yt-liked";
        navPush();
        paintNav(false);
      });
    });
    viewEl.querySelectorAll("[data-open-yt-pl]").forEach((el) => {
      el.addEventListener("click", () => {
        rememberScroll();
        const id = el.dataset.openYtPl || "";
        const pl = Array.isArray(state.ytPlaylists) ? state.ytPlaylists.find((p) => String(p.id) === id) : null;
        state.ytOpen = { id, title: (pl && pl.title) || "Playlist", artwork: (pl && pl.artwork) || "", tracks: null, loading: true };
        state.playlistFrom = (state.view === "library" && state.activePlaylist != null) ? (state.playlistFrom || "library") : (state.view || "library");
        state.activePlaylist = "yt-pl:" + id;
        navPush();
        paintNav(false);
        openYtPlaylist(id, (pl && pl.title) || "Playlist");
      });
    });
    const ytRefresh = viewEl.querySelector("#ytRefresh");
    if (ytRefresh) ytRefresh.addEventListener("click", () => {
      state.ytLiked = null;
      state.ytPlaylists = null;
      loadYtLiked(true);
      loadYtPlaylists(true);
      toast("Refreshing YouTube library…");
    });
    const ytReconnectBtn = viewEl.querySelector("#ytReconnectBtn");
    if (ytReconnectBtn) ytReconnectBtn.addEventListener("click", connectYouTube);
    const ytConnectNow = viewEl.querySelector("#ytConnectNow");
    if (ytConnectNow) ytConnectNow.addEventListener("click", connectYouTube);
    const playYtLiked = viewEl.querySelector("#playYtLiked");
    if (playYtLiked) playYtLiked.addEventListener("click", () => playTrackList((state.ytLiked && state.ytLiked.tracks) || [], 0));
    const playYtPl = viewEl.querySelector("#playYtPl");
    if (playYtPl) playYtPl.addEventListener("click", () => playTrackList((state.ytOpen && state.ytOpen.tracks) || [], 0));
    const gSignInBtn = viewEl.querySelector("#gSignInBtn");
    if (gSignInBtn) gSignInBtn.addEventListener("click", startGoogleSignIn);
    const gYtConnect = viewEl.querySelector("#gYtConnect");
    if (gYtConnect) gYtConnect.addEventListener("click", connectYouTube);
    const gYtDisconnect = viewEl.querySelector("#gYtDisconnect");
    if (gYtDisconnect) gYtDisconnect.addEventListener("click", disconnectYouTube);
    const gSignOut = viewEl.querySelector("#gSignOut");
    if (gSignOut) gSignOut.addEventListener("click", signOutGoogle);
    const syncLibBtn = viewEl.querySelector("#syncLibraryBtn");
    if (syncLibBtn) {
      syncLibBtn.addEventListener("click", async () => {
        syncLibBtn.disabled = true;
        toast("Syncing library with cloud…");
        await syncUserLibrary(true);
        syncLibBtn.disabled = false;
        toast("Library synchronized");
      });
    }
    const gYtRefresh = viewEl.querySelector("#gYtRefresh");
    if (gYtRefresh) gYtRefresh.addEventListener("click", () => {
      state.ytLiked = null;
      state.ytPlaylists = null;
      loadYtLiked(true);
      loadYtPlaylists(true);
      toast("Refreshing YouTube…");
    });
    viewEl.querySelectorAll("[data-open-liked]").forEach((el) => {
      el.addEventListener("click", () => {
        rememberScroll();
        state.playlistFrom = (state.view === "library" && state.activePlaylist != null) ? (state.playlistFrom || "library") : (state.view || "library");
        state.activePlaylist = "liked";
        navPush();
        paintNav(false);
      });
    });
    viewEl.querySelectorAll("[data-open-downloads]").forEach((el) => {
      el.addEventListener("click", () => {
        rememberScroll();
        state.playlistFrom = (state.view === "library" && state.activePlaylist != null) ? (state.playlistFrom || "library") : (state.view || "library");
        state.activePlaylist = "downloads";
        navPush();
        paintNav(false);
      });
    });
    viewEl.querySelectorAll("[data-lib-filter]").forEach((el) => {
      el.addEventListener("click", () => { state.libFilter = el.dataset.libFilter; render(); });
    });
    const libBack = viewEl.querySelector("#libBack");
    if (libBack) libBack.addEventListener("click", requestBack);
    const playLiked = viewEl.querySelector("#playLiked");
    if (playLiked) playLiked.addEventListener("click", () => { if (state.liked[0]) playFromList(state.liked, 0); });
    const playDownloads = viewEl.querySelector("#playDownloads");
    if (playDownloads) playDownloads.addEventListener("click", () => { if (state.downloads && state.downloads[0]) playFromList(state.downloads, 0); });
    const syncOfflineLyricsBtn = viewEl.querySelector("#syncOfflineLyricsBtn");
    if (syncOfflineLyricsBtn) {
      syncOfflineLyricsBtn.addEventListener("click", () => {
        syncAllOfflineLyrics(true);
      });
    }
    viewEl.querySelectorAll("[data-save-lyr]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = el.dataset.saveLyr;
        const tr = (state.downloads || []).find((d) => d && d.id === id) || findTrack(id);
        if (!tr) return;
        if (hasOfflineSyncedLyrics(tr)) exportTrackLrc(tr);
        else saveSyncedLyricsForTrackInteractive(tr);
      });
    });
    const clearDownloads = viewEl.querySelector("#clearDownloads");
    if (clearDownloads) {
      clearDownloads.addEventListener("click", () => {
        const count = (state.downloads || []).length;
        if (!count) return;
        showModal({
          title: "Delete all downloads?",
          body: `<p>This will remove all ${count} downloaded song${count === 1 ? "" : "s"} from this device.</p>`,
          ok: "Delete all",
          cancel: "Cancel",
          danger: true,
          onOk: async () => {
            const ND = nativeDownloader();
            for (const d of (state.downloads || [])) {
              try { if (ND && ND.removeDownload && d) await ND.removeDownload({ id: d.id }); } catch {}
              if (d && d.id) await idbDel(d.id).catch(() => {});
              if (d && d.videoId) await idbDel(`yt:${d.videoId}`).catch(() => {});
              if (d && d.trackId) await idbDel(`audius:${d.trackId}`).catch(() => {});
            }
            state.downloads = [];
            save("aura.downloads", state.downloads);
            toast(`Deleted ${count} download${count === 1 ? "" : "s"}`, true, "success");
            render();
          },
        });
      });
    }
    const plBanner = viewEl.querySelector("#plBanner");
    if (plBanner && typeof state.activePlaylist === "number") {
      const cur = state.playlists[state.activePlaylist];
      if (cur && cur.banner) plBanner.style.backgroundImage = `url("${cur.banner}")`;
    }
    const pickPlCover = viewEl.querySelector("#pickPlCover") || viewEl.querySelector("#pickPlCover2");
    if (viewEl.querySelector("#pickPlCover")) {
      viewEl.querySelector("#pickPlCover").addEventListener("click", () => pickImage("plCover", state.activePlaylist));
    }
    if (viewEl.querySelector("#pickPlCover2")) {
      viewEl.querySelector("#pickPlCover2").addEventListener("click", () => pickImage("plCover", state.activePlaylist));
    }
    const pickPlBanner = viewEl.querySelector("#pickPlBanner");
    if (pickPlBanner) pickPlBanner.addEventListener("click", () => pickImage("plBanner", state.activePlaylist));
    const editPlLook = viewEl.querySelector("#editPlLook");
    if (editPlLook) {
      editPlLook.addEventListener("click", () => openPlaylistEditor(state.activePlaylist));
    }
    const playPl = viewEl.querySelector("#playPl");
    if (playPl) {
      playPl.addEventListener("click", () => {
        const p = state.playlists[state.activePlaylist];
        if (p && p.tracks[0]) playFromList(p.tracks, 0);
      });
    }
    if (typeof state.activePlaylist === "number") loadPlaylistRecs(state.activePlaylist);
    viewEl.querySelectorAll("[data-rec-play]").forEach((el) => {
      el.addEventListener("click", () => {
        const track = (plRecs.tracks || []).find((t) => t.id === el.dataset.recPlay) || findTrack(el.dataset.recPlay);
        if (!track) return;
        playFromList([track], 0);
        fillRelatedQueue(track);
      });
    });
    viewEl.querySelectorAll("[data-add-rec]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const i = state.activePlaylist;
        const p = typeof i === "number" ? state.playlists[i] : null;
        const track = (plRecs.tracks || []).find((t) => t.id === el.dataset.addRec);
        if (!p || !track) return;
        if (p.tracks.some((t) => t.id === track.id)) {
          toast("Already in this playlist");
          return;
        }
        p.tracks.push(track);
        savePlaylists();
        plRecs.tracks = plRecs.tracks.filter((t) => t.id !== track.id);
        toast(`Added to ${p.name}`, true, "success");
        render();
      });
    });
    const tp = viewEl.querySelector("#testPlay");
    if (tp) tp.addEventListener("click", testPlay);
    const profileBtn = viewEl.querySelector("#profileBtn");
    if (profileBtn) {
      profileBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        state.showProfile = !state.showProfile;
        render();
      });
    }
    const gotoSettings = viewEl.querySelector("#gotoSettings");
    if (gotoSettings) {
      gotoSettings.addEventListener("click", () => {
        state.showProfile = false;
        state.settingsPage = null;
        setView("settings");
      });
    }
    const pickAvatar = viewEl.querySelector("#pickAvatar");
    if (pickAvatar) {
      pickAvatar.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.pickingAvatar = true;
        pickImage("avatar");
      });
    }
    const setUsername = viewEl.querySelector("#setUsername");
    if (setUsername) {
      setUsername.addEventListener("change", () => {
        state.prefs.username = String(setUsername.value || "").trim().slice(0, 32);
        savePrefs();
        toast(state.prefs.username ? `Hi, ${state.prefs.username}` : "Name cleared");
      });
    }
    if (state.showProfile) {
      const closeProf = (e) => {
        if (e.target.closest("#profileMenu, #profileBtn")) return;
        state.showProfile = false;
        document.removeEventListener("click", closeProf);
        if (state.view === "home") render();
      };
      setTimeout(() => document.addEventListener("click", closeProf), 0);
    }
    const nowBack = viewEl.querySelector("#nowBack");
    if (nowBack) nowBack.addEventListener("click", requestBack);
    const lyScroll = viewEl.querySelector("#lyScroll");
    if (lyScroll) {
      bindLyricLines(lyScroll);
      const pauseFollow = () => {
        if (lyProg) return;
        lyFollow = false;
        clearTimeout(lyResumeT);
        lyResumeT = setTimeout(() => { lyFollow = true; }, 2200);
      };
      lyScroll.addEventListener("wheel", pauseFollow, { passive: true });
      lyScroll.addEventListener("touchmove", pauseFollow, { passive: true });
    }
    const settingsBack = viewEl.querySelector("#settingsBack");
    if (settingsBack) settingsBack.addEventListener("click", requestBack);
    const openAppearance = viewEl.querySelector("#openAppearance");
    if (openAppearance) {
      openAppearance.addEventListener("click", () => {
        rememberScroll();
        state.settingsPage = "appearance";
        navPush();
        paintNav(false);
      });
    }
    const openUi = viewEl.querySelector("#openUi");
    if (openUi) {
      openUi.addEventListener("click", () => {
        rememberScroll();
        state.settingsPage = "ui";
        navPush();
        paintNav(false);
      });
    }
    const openPlayer = viewEl.querySelector("#openPlayer");
    if (openPlayer) openPlayer.addEventListener("click", () => { rememberScroll(); state.settingsPage = "player"; navPush(); paintNav(false); });
    const openPlayback = viewEl.querySelector("#openPlayback");
    if (openPlayback) openPlayback.addEventListener("click", () => { rememberScroll(); state.settingsPage = "playback"; navPush(); paintNav(false); });
    const openListening = viewEl.querySelector("#openListening");
    if (openListening) openListening.addEventListener("click", () => { rememberScroll(); state.settingsPage = "listening"; navPush(); paintNav(false); });
    const openAppIcon = viewEl.querySelector("#openAppIcon");
    if (openAppIcon) openAppIcon.addEventListener("click", () => { rememberScroll(); state.settingsPage = "appicon"; navPush(); paintNav(false); });
    const openAppIconFromAppearance = viewEl.querySelector("#openAppIconFromAppearance");
    if (openAppIconFromAppearance) openAppIconFromAppearance.addEventListener("click", () => { rememberScroll(); state.settingsPage = "appicon"; navPush(); paintNav(false); });
    const openFollowing = viewEl.querySelector("#openFollowing");
    if (openFollowing) openFollowing.addEventListener("click", () => { rememberScroll(); state.settingsPage = "following"; navPush(); paintNav(false); });
    const openOffline = viewEl.querySelector("#openOffline");
    if (openOffline) openOffline.addEventListener("click", () => { rememberScroll(); state.settingsPage = "offline"; navPush(); paintNav(false); });
    const openData = viewEl.querySelector("#openData");
    if (openData) openData.addEventListener("click", () => { rememberScroll(); state.settingsPage = "data"; navPush(); paintNav(false); measureCache(); });

    // App Icon page listeners
    viewEl.querySelectorAll("[data-set-app-icon]").forEach((el) => {
      el.addEventListener("click", () => {
        setAppIcon(el.dataset.setAppIcon);
      });
    });
    viewEl.querySelectorAll("[data-icon-cat]").forEach((el) => {
      el.addEventListener("click", () => {
        state.appIconCat = el.dataset.iconCat;
        render();
      });
    });
    const previewSplashBtn = viewEl.querySelector("#previewSplashBtn");
    if (previewSplashBtn) {
      previewSplashBtn.addEventListener("click", () => {
        playAppOpeningAnimation(state.prefs && state.prefs.appIcon, true);
      });
    }

    // Following & Alerts page listeners
    const reqPermBtn = viewEl.querySelector("#requestNotifyPermissionBtn");
    if (reqPermBtn) {
      reqPermBtn.addEventListener("click", async () => {
        if ("Notification" in window) {
          try {
            await Notification.requestPermission();
            render();
          } catch {}
        }
      });
    }
    const checkReleasesBtn = viewEl.querySelector("#checkNewReleasesBtn");
    if (checkReleasesBtn) {
      checkReleasesBtn.addEventListener("click", async () => {
        checkReleasesBtn.disabled = true;
        checkReleasesBtn.innerHTML = `<span class="material-symbols-outlined" style="animation:spin 1s linear infinite">sync</span> Checking…`;
        try {
          await checkFollowReleases(true);
        } finally {
          render();
        }
      });
    }
    const newFollowInput = viewEl.querySelector("#newFollowArtistInput");
    const newFollowBtn = viewEl.querySelector("#newFollowArtistBtn");
    const handleNewFollow = async () => {
      const q = String(newFollowInput ? newFollowInput.value : "").trim();
      if (!q) return;
      newFollowInput.value = "";
      toast(`Looking up "${q}"…`);
      try {
        const data = await api(`/api/artist?name=${encodeURIComponent(q)}&${glq()}`);
        const art = data && data.artist ? data.artist : { name: q };
        const cleanName = String(art.name || q).trim();
        const key = artistKey({ artist: cleanName, permalink: art.handle || "" });
        if (isFollowing({ artist: cleanName, permalink: art.handle || "" })) {
          toast(`Already following ${cleanName}`);
          return;
        }
        state.following.unshift({
          key,
          name: cleanName,
          source: art.source || "catalog",
          handle: art.handle || "",
          artwork: art.artwork || (data && data.latest && artUrl(data.latest)) || "/cover-default.jpg",
          lastId: data && data.latest && data.latest.id ? data.latest.id : "",
          followedAt: Date.now(),
        });
        saveFollowing();
        toast(`Following ${cleanName}! You'll be notified on new releases.`, true, "success");
        if (state.prefs.notifyFollows && "Notification" in window && Notification.permission === "default") {
          Notification.requestPermission().catch(() => {});
        }
        render();
      } catch {
        const key = artistKey(q);
        if (!isFollowing(q)) {
          state.following.unshift({
            key,
            name: q,
            source: "catalog",
            handle: "",
            artwork: "/cover-default.jpg",
            lastId: "",
            followedAt: Date.now(),
          });
          saveFollowing();
          toast(`Following ${q}! You'll be notified on new releases.`, true, "success");
          render();
        }
      }
    };
    const newFollowIco = viewEl.querySelector(".set-follow-ico");
    if (newFollowBtn) newFollowBtn.addEventListener("click", handleNewFollow);
    if (newFollowIco) {
      newFollowIco.addEventListener("click", handleNewFollow);
      newFollowIco.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleNewFollow();
        }
      });
    }
    if (newFollowInput) newFollowInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleNewFollow(); });

    viewEl.querySelectorAll("[data-quick-follow]").forEach((el) => {
      el.addEventListener("click", () => {
        const name = el.dataset.quickFollow;
        if (newFollowInput) newFollowInput.value = name;
        handleNewFollow();
      });
    });

    viewEl.querySelectorAll("[data-open-followed-artist]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const name = (el.dataset.openFollowedArtist || el.dataset.artistName || "").trim();
        if (!name) return;
        const f = state.following.find((x) => x.name === name || x.key === name.toLowerCase());
        openArtistProfile(f || { name });
      });
    });

    // Data page listeners
    const exportBtn = viewEl.querySelector("#exportDataBtn");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        const payload = {
          app: "Muchi",
          version: APP_VERSION,
          exportedAt: new Date().toISOString(),
          playlists: state.playlists || [],
          likes: state.likes || [],
          following: state.following || [],
          recents: (state.recents || []).slice(0, 50),
          prefs: state.prefs || {},
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `muchi-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast("Library backup downloaded", true, "success");
      });
    }

    const importBtn = viewEl.querySelector("#importDataBtn");
    const importFileInput = viewEl.querySelector("#importDataFile");
    if (importBtn && importFileInput) {
      importBtn.addEventListener("click", () => importFileInput.click());
      importFileInput.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            if (!data || typeof data !== "object") throw new Error("Invalid backup file");
            if (Array.isArray(data.playlists)) {
              state.playlists = data.playlists;
              savePlaylists();
            }
            if (Array.isArray(data.likes)) {
              state.likes = data.likes;
              saveLikes();
            }
            if (Array.isArray(data.following)) {
              state.following = data.following;
              saveFollowing();
            }
            if (data.prefs && typeof data.prefs === "object") {
              state.prefs = Object.assign({}, state.prefs, data.prefs);
              savePrefs();
              applyTheme();
              applyUi();
              applyAppIcon();
            }
            toast("Library backup restored!", true, "success");
            render();
          } catch {
            toast("Failed to parse backup JSON file", true, "error");
          }
        };
        reader.readAsText(file);
      });
    }

    const resetPrefsBtn = viewEl.querySelector("#resetPrefsBtn");
    if (resetPrefsBtn) {
      resetPrefsBtn.addEventListener("click", () => {
        if (!confirm("Reset all settings and themes to defaults?")) return;
        state.prefs = {
          theme: "system",
          appearance: "system",
          appIcon: "default",
          playerStyle: "pill",
          seekWiggle: "sine",
          quality: "high",
          autoplay: true,
          normalize: true,
          crossfade: 0,
          speed: 1,
          notifyFollows: true,
          notifyInApp: true,
          batterySaver: false,
        };
        savePrefs();
        applyTheme();
        applyUi();
        applyAppIcon();
        toast("Settings reset to defaults", true, "success");
        render();
      });
    }

    const toggleOfflineMode = viewEl.querySelector("#toggleOfflineMode");
    if (toggleOfflineMode) {
      toggleOfflineMode.addEventListener("click", () => {
        setOfflineMode(!state.offlineMode);
      });
    }

    const offlineRetryBtn = viewEl.querySelector("#offlineRetryBtn");
    if (offlineRetryBtn) {
      offlineRetryBtn.addEventListener("click", () => {
        retryServerConnection(offlineRetryBtn);
      });
    }
    viewEl.querySelectorAll("[data-set-player]").forEach((el) => {
      el.addEventListener("click", () => {
        state.prefs.playerStyle = normalizePlayerStyle(el.dataset.setPlayer);
        savePrefs();
        applyUi();
        drawSeekWave();
        render();
      });
    });
    viewEl.querySelectorAll("[data-set-wiggle]").forEach((el) => {
      el.addEventListener("click", () => {
        state.prefs.seekWiggle = normalizeSeekWiggle(el.dataset.setWiggle);
        savePrefs();
        applyUi();
        drawSeekWave();
        render();
      });
    });
    viewEl.querySelectorAll("[data-player-fade]").forEach((el) => {
      el.addEventListener("click", () => {
        const val = Number(el.dataset.playerFade || 0);
        state.prefs.crossfade = val;
        savePrefs();
        toast(val ? `Crossfade set to ${val}s` : "Crossfade turned off");
        render();
      });
    });
    viewEl.querySelectorAll("[data-set-ui]").forEach((el) => {
      el.addEventListener("click", () => {
        state.prefs.ui = normalizeUiMode(el.dataset.setUi);
        savePrefs();
        applyUi();
        render();
      });
    });
    const customName = viewEl.querySelector("#customName");
    if (customName) {
      customName.addEventListener("change", () => {
        state.prefs.customTheme = Object.assign(customTheme(), { name: customName.value.trim() || "My theme" });
        savePrefs();
        if (state.prefs.theme === "custom" && state.view === "settings") render();
      });
    }
    viewEl.querySelectorAll("[data-custom-mode]").forEach((el) => {
      el.addEventListener("click", () => {
        state.prefs.customTheme = Object.assign(customTheme(), { mode: el.dataset.customMode });
        state.prefs.theme = "custom";
        savePrefs();
        applyTheme();
        if (state.view === "settings") render();
      });
    });
    viewEl.querySelectorAll("[data-custom-color]").forEach((el) => {
      el.addEventListener("input", () => {
        state.prefs.customTheme = Object.assign(customTheme(), { [el.dataset.customColor]: el.value });
        const code = el.parentElement && el.parentElement.querySelector("code");
        if (code) code.textContent = el.value;
        state.prefs.theme = "custom";
        applyTheme();
      });
      el.addEventListener("change", () => {
        savePrefs();
      });
    });
    const resetCustom = viewEl.querySelector("#resetCustom");
    if (resetCustom) {
      resetCustom.addEventListener("click", () => {
        state.prefs.customTheme = Object.assign({}, CUSTOM_DEFAULT);
        state.prefs.theme = "custom";
        savePrefs();
        applyTheme();
        toast("Custom theme reset");
        if (state.view === "settings") render();
      });
    }
    const updBtn = viewEl.querySelector("#updateBtn");
    if (updBtn) updBtn.addEventListener("click", () => {
      openUpdateModal();
      checkUpdates(true);
    });
    const reloadBtn = viewEl.querySelector("#reloadApp");
    if (reloadBtn) reloadBtn.addEventListener("click", reloadApp);
    viewEl.querySelectorAll("[data-dl]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const track = findTrack(el.dataset.dl);
        if (track) downloadTrack(track);
      });
    });

    viewEl.querySelectorAll("[data-pref]").forEach((el) => {
      el.addEventListener("click", () => {
        const key = el.dataset.pref;
        state.prefs[key] = !state.prefs[key];
        savePrefs();
        if (key === "batterySaver") {
          applyUi();
          themedId = "";
          themeFromTrack(current());
          if (state.playing) startTimer();
          else drawSeekWave();
        }
        applyPlaybackPrefs();
        render();
      });
    });
    const setCountry = viewEl.querySelector("#setCountry");
    if (setCountry) {
      setCountry.addEventListener("change", () => {
        state.prefs.country = setCountry.value;
        state.prefs.countryChosen = true;
        savePrefs();
        try { localStorage.removeItem("aura.home_cache"); } catch {}
        state.home = null;
        state.tasteTracks = [];
        state.followedArtistTracks = [];
        save("aura.tasteTracks", []);
        save("aura.followedArtistTracks", []);
        if (state.view === "settings") render();
        loadHome(true);
        loadTasteRecommendations(true);
      });
    }
    const setSpeed = viewEl.querySelector("#setSpeed");
    if (setSpeed) {
      setSpeed.addEventListener("change", () => {
        state.prefs.speed = Number(setSpeed.value);
        savePrefs();
        applyPlaybackPrefs();
      });
    }
    const setSpatial = viewEl.querySelector("#setSpatial");
    if (setSpatial) {
      setSpatial.addEventListener("change", () => {
        state.prefs.spatial = setSpatial.value;
        savePrefs();
        applyPlaybackPrefs();
        const labels = {
          off: "Sound stage off",
          phone: "Phone sound on — bass you can feel on the speaker",
          bass: "Super Bass on — Audius, radio, and saved files",
          spatial: "Spatial on — headphones, uses phone Atmos if present",
          dynamic: "Dynamic on — punchier Audius and radio",
        };
        const t = current();
        // No toast — the sound stage applies live and the dropdown/control shows the value.
      });
    }
    viewEl.querySelectorAll("[data-set-quality]").forEach((el) => {
      el.addEventListener("click", () => {
        state.prefs.quality = el.dataset.setQuality;
        savePrefs();
        applyYtQuality();
        render();
      });
    });
    const setCodec = viewEl.querySelector("#setCodec");
    if (setCodec) {
      setCodec.addEventListener("change", () => {
        state.prefs.codec = setCodec.value;
        savePrefs();
      });
    }
    const setGithub = viewEl.querySelector("#setGithub");
    if (setGithub) {
      setGithub.addEventListener("change", () => {
        state.prefs.github = String(setGithub.value || "").trim().replace(/\/$/, "");
        savePrefs();
        render();
      });
    }
    const ghRelease = viewEl.querySelector("#ghRelease");
    if (ghRelease) ghRelease.addEventListener("click", () => {
      // Item 8: show the What's New popup in-app — no browser redirect.
      openWhatsNew();
    });
    const openPrivacyBtn = viewEl.querySelector("#openPrivacyBtn");
    if (openPrivacyBtn) openPrivacyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openLegalDocument("privacy");
    });
    const openTermsBtn = viewEl.querySelector("#openTermsBtn");
    if (openTermsBtn) openTermsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openLegalDocument("terms");
    });
    const ghBug = viewEl.querySelector("#ghBug");
    if (ghBug) ghBug.addEventListener("click", (e) => {
      const gh = githubRepo();
      const baseUrl = (gh && gh.url) ? gh.url : "https://github.com/Kaibshshdheueejw/Muchi";
      const body = encodeURIComponent(`**Muchi ${APP_VERSION}**\nDevice: ${navigator.userAgent}\nView: ${state.view}\n\nFeedback:\n`);
      const targetUrl = `${baseUrl}/issues/new?title=${encodeURIComponent("Feedback: ")}&body=${body}`;
      if (ghBug.tagName === "A") {
        ghBug.href = targetUrl;
        if (IS_NATIVE) {
          e.preventDefault();
          try { window.open(targetUrl, "_system"); } catch { window.location.href = targetUrl; }
        }
        return;
      }
      if (IS_NATIVE) {
        try { window.open(targetUrl, "_system"); } catch { window.location.href = targetUrl; }
      } else {
        window.open(targetUrl, "_blank", "noopener");
      }
    });
    viewEl.querySelectorAll("[data-unfollow]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const removed = unfollowArtistByKeyOrName(el.dataset.unfollow);
        if (removed) toast(`Unfollowed ${removed}`, true, "success");
        render();
      });
    });
    viewEl.querySelectorAll("[data-del-hist]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        state.recents = state.recents.filter((t) => t.id !== el.dataset.delHist);
        save("aura.recents", state.recents);
        render();
      });
    });
    viewEl.querySelectorAll("[data-artist]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target && e.target.closest && e.target.closest("[data-unfollow]")) return;
        const targetKey = String(el.dataset.artist || "").toLowerCase().trim();
        const targetName = targetKey.replace(/^(name:|audius:)/i, "").trim();
        const f = state.following.find(
          (x) =>
            String(x.key || "").toLowerCase() === targetKey ||
            String(x.name || "").toLowerCase() === targetName
        );
        if (f) openArtistProfile({ name: f.name, artwork: f.artwork, id: f.id || "", source: f.source, query: f.name });
      });
    });
    viewEl.querySelectorAll("[data-set-theme]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.setTheme;
        state.prefs.theme = id;
        savePrefs();
        applyTheme();
        themedId = "";
        themeFromTrack(current());
        const pack = THEMES.find((x) => x.id === id);
        // No toast — the theme preview + active chip highlight is the feedback.
        if (state.view === "settings") render();
      });
    });
    viewEl.querySelectorAll("[data-appearance]").forEach((el) => {
      el.addEventListener("click", () => {
        const mode = el.dataset.appearance;
        if (!["light", "dark", "system"].includes(mode)) return;
        state.prefs.appearance = mode;
        // A mode selection means "base look" — clear any color skin so the
        // Light/Dark/System choice is what the user actually sees.
        state.prefs.theme = "dark";
        savePrefs();
        applyTheme();
        themedId = "";
        themeFromTrack(current());
        // No toast — the theme applies instantly app-wide; that IS the feedback.
        if (state.view === "settings") render();
      });
    });
    const setFade = viewEl.querySelector("#setFade");
    if (setFade) {
      setFade.addEventListener("change", () => {
        state.prefs.crossfade = Number(setFade.value);
        savePrefs();
      });
    }
    const setSleepEl = viewEl.querySelector("#setSleep");
    if (setSleepEl) {
      setSleepEl.addEventListener("change", () => setSleep(setSleepEl.value));
    }
    viewEl.querySelectorAll("[data-del-dl]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        removeDownload(el.dataset.delDl);
      });
    });
    viewEl.querySelectorAll("[data-cancel-dl]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        cancelDownload(el.dataset.cancelDl);
      });
    });
    viewEl.querySelectorAll("[data-clear]").forEach((el) => {
      el.addEventListener("click", async () => {
        const kind = el.dataset.clear;
        if (kind === "home") {
          state.home = null;
          toast("Refreshing Home…");
          await loadHome();
        } else if (kind === "recents") {
          state.recents = [];
          save("aura.recents", state.recents);
          toast("History cleared");
        } else if (kind === "sw") {
          try {
            if (window.caches) {
              const keys = await caches.keys();
              await Promise.all(keys.map((k) => caches.delete(k)));
            }
            toast("App cache cleared");
          } catch {
            toast("Could not clear cache");
          }
        } else if (kind === "dl") {
          await idbClear();
          state.downloads = [];
          save("aura.downloads", state.downloads);
          toast("Offline files deleted");
        }
        if (state.view === "settings") render();
      });
    });
    viewEl.querySelectorAll("[data-del-pl]").forEach((el) => {
      el.addEventListener("click", () => {
        state.playlists.splice(Number(el.dataset.delPl), 1);
        savePlaylists();
        state.activePlaylist = null;
        render();
      });
    });
  }

  function testPlay() {
    const t = {
      id: "yt:NJAv_7lHUIU",
      source: "youtube",
      videoId: "NJAv_7lHUIU",
      title: "Kesariya",
      artist: "Arijit Singh",
      album: "Brahmastra",
      duration: 268,
      artwork: "https://i.ytimg.com/vi/NJAv_7lHUIU/hqdefault.jpg",
    };
    playFromList([t, ...state.queue.filter((x) => x.id !== t.id)], 0);
  }

  let navSilent = false;
  function navSnap() {
    return {
      muchi: 1,
      view: state.view,
      prevView: state.prevView || null,
      detailFrom: state.detailFrom || null,
      detailTrack: state.detailTrack || null,
      playlistFrom: state.playlistFrom || null,
      settingsPage: state.settingsPage || null,
      activePlaylist: state.activePlaylist,
      hasArtist: !!state.artistPage,
      hasDetail: !!state.detailTrack,
      hasCatalog: !!(state.catalogPlaylist && state.activePlaylist === "catalog"),
      catalogMeta: state.catalogMeta || null,
      queue: !!state.showQueue,
      profile: !!state.showProfile,
      homeScroll: state.homeScroll || 0,
    };
  }
  function scrollKey() {
    return [state.view, state.settingsPage || "", String(state.activePlaylist ?? ""), state.artistPage ? "a" : ""].join("|");
  }
  function rememberScroll() {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    state.scrollMap = state.scrollMap || {};
    state.scrollMap[scrollKey()] = y;
    if (state.view === "home") state.homeScroll = y;
  }
  function restoreScroll(fromBack) {
    const y = fromBack ? Number((state.scrollMap || {})[scrollKey()] || 0) : 0;
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
  }
  function navPush() {
    if (navSilent) return;
    try { history.pushState(navSnap(), ""); } catch {}
  }
  function navReplace() {
    try { history.replaceState(navSnap(), ""); } catch {}
  }
  function paintNav(fromBack) {
    const prevPainted = paintNav._lastView;
    paintNav._lastView = state.view;
    showEl($("queuePanel"), !!state.showQueue);
    if ($("queuePanel")) $("queuePanel").classList.toggle("open", !!state.showQueue);
    showEl($("ytWrap"), !!state.showVideo);
    // Scrim must track queue/sidebar on EVERY nav path — the popstate
    // restore (applyNav) otherwise leaves the dimming layer on screen
    // after the queue closes, blocking taps until the user clicks it.
    const sideEl = $("sidebar");
    showEl($("scrim"), !!state.showQueue || (sideEl && sideEl.classList.contains("open")));
    render();
    syncPlayerVisibility();
    if (IS_NATIVE || document.documentElement.getAttribute("data-native") === "1") {
      clearTimeout(paintNav._popT);
      if (state.view === "settings") {
        document.body.classList.remove("settings-exit-pop");
      } else if (prevPainted === "settings") {
        document.body.classList.remove("settings-exit-pop");
        void document.body.offsetWidth;
        document.body.classList.add("settings-exit-pop");
        paintNav._popT = setTimeout(() => {
          document.body.classList.remove("settings-exit-pop");
        }, 460);
      }
    }
    restoreScroll(!!fromBack);
    // CSS view fade — no snapshot machinery, so no white-flash risk
    fadeView();
  }
  function applyNav(s) {
    if (!s || !s.muchi) return false;
    navSilent = true;
    state.view = s.view || "home";
    if (s.prevView !== undefined && s.prevView !== "detail" && s.prevView !== "now") {
      state.prevView = s.prevView;
    }
    state.detailFrom = s.detailFrom || null;
    state.playlistFrom = s.playlistFrom || null;
    state.settingsPage = s.settingsPage || null;
    state.activePlaylist = s.activePlaylist == null ? null : s.activePlaylist;
    if (!s.hasArtist) {
      state.artistPage = null;
      state.artistFrom = null;
    }
    if (!s.hasDetail) {
      state.detailTrack = null;
      state.detailFrom = null;
    } else if (s.detailTrack) {
      state.detailTrack = s.detailTrack;
    }
    if (state.view === "detail" && !state.detailTrack && !current()) {
      state.view = (state.detailFrom && state.detailFrom !== "detail")
        ? state.detailFrom
        : ((state.prevView && state.prevView !== "detail" && state.prevView !== "now") ? state.prevView : "home");
    }
    if (!s.hasCatalog && state.activePlaylist === "catalog") {
      state.catalogPlaylist = null;
      state.catalogMeta = null;
      if (s.activePlaylist === "catalog") state.activePlaylist = null;
    } else if (s.hasCatalog) {
      if (s.catalogMeta) state.catalogMeta = s.catalogMeta;
      // Data lost while we were on another screen (e.g. lyrics) — show the
      // loading state and re-fetch this exact playlist instead of stranding
      // the user on a permanent "Loading songs…".
      const lost = !state.catalogPlaylist || (!state.catalogPlaylist.loading && !(state.catalogPlaylist.tracks && state.catalogPlaylist.tracks.length) && !state.catalogPlaylist.playlistId && !state.catalogPlaylist.shelfId && !state.catalogPlaylist.query);
      const stale = state.catalogPlaylist && state.catalogPlaylist.loading && !(state.catalogPlaylist.tracks && state.catalogPlaylist.tracks.length);
      if ((lost || stale) && state.catalogMeta) {
        if (!state.catalogPlaylist) state.catalogPlaylist = { title: state.catalogMeta.title || "Playlist", tracks: [], loading: true };
        navSilent = false; // refill re-enters async work; don't leave pushes muted
        paintNav(true);
        const m = state.catalogMeta;
        openCatalogPlaylist(m, { refill: true });
        return true;
      }
    }
    state.showQueue = !!s.queue;
    state.showProfile = !!s.profile;
    if (typeof s.homeScroll === "number") state.homeScroll = s.homeScroll;
    if (state.view !== "now" && state.view !== "settings" && state.view !== "detail") {
      /* keep prevView */
    }
    paintNav(true);
    navSilent = false;
    return true;
  }

  function logicalBack() {
    if (state.showQueue) {
      setQueueOpen(false);
      navReplace();
      return true;
    }
    if (state.showVideo) {
      state.showVideo = false;
      showEl($("ytWrap"), false);
      navReplace();
      return true;
    }
    if (state.showProfile) {
      state.showProfile = false;
      render();
      navReplace();
      return true;
    }
    if (state.view === "now") {
      const target = (state.prevView && state.prevView !== "now" && state.prevView !== "detail")
        ? state.prevView
        : "home";
      setView(target, true);
      return true;
    }
    if (state.view === "detail") {
      const returnTo = (state.detailFrom && state.detailFrom !== "detail")
        ? state.detailFrom
        : ((state.prevView && state.prevView !== "detail") ? state.prevView : "home");
      state.detailTrack = null;
      state.detailFrom = null;
      setView(returnTo, true);
      return true;
    }
    if (state.view === "settings" && state.settingsPage) {
      state.settingsPage = null;
      softRender();
      navReplace();
      return true;
    }
    if (state.artistPage) {
      const from = state.artistFrom;
      state.artistPage = null;
      state.artistFrom = null;
      if (from && from !== state.view) {
        const target = (from === "detail" && !state.detailTrack)
          ? ((state.detailFrom && state.detailFrom !== "detail") ? state.detailFrom : (state.prevView || "home"))
          : from;
        setView(target, true);
      }
      else { softRender(); navReplace(); }
      return true;
    }
    if (state.view === "library" && state.activePlaylist != null) {
      const returnTo = state.playlistFrom || ((state.activePlaylist === "catalog" || state.activePlaylist === "discovery") ? state.prevView : "library") || "library";
      state.activePlaylist = null;
      state.catalogPlaylist = null;
      state.playlistFrom = null;
      if (returnTo && returnTo !== "library") {
        setView(returnTo, true);
        return true;
      }
      softRender();
      navReplace();
      return true;
    }
    if (state.view === "settings" || state.view === "search" || state.view === "radio" || state.view === "library" || state.view === "detail" || state.view === "now") {
      setView("home", true);
      return true;
    }
    return false;
  }

  function goBackInApp() {
    return logicalBack();
  }

  function requestBack() {
    logicalBack();
  }

  function setView(name, fromBack) {
    if (!fromBack) rememberScroll();
    if (!fromBack && name === state.view && !state.settingsPage && state.activePlaylist == null && !state.artistPage && !state.detailTrack && !state.showQueue) {
      if (name === "home") { state.showProfile = false; render(); }
      return;
    }
    if (!fromBack && (name === "now" || name === "settings" || name === "detail") && state.view !== name) {
      if (state.view !== "now" && state.view !== "settings" && state.view !== "detail") {
        state.prevView = state.view;
      }
    }
    if (name !== "home") state.showProfile = false;
    if (name !== "search" && name !== "now" && name !== "settings" && name !== "detail") state.artistPage = null;
    if (name !== "detail") {
      state.detailTrack = null;
      state.detailFrom = null;
    }
    if (name === "library" && !fromBack && state.activePlaylist != null) {
      state.activePlaylist = null;
      state.playlistFrom = null;
    }
    state.view = name;
    // "now" (lyrics) and "detail" (track page) are transient overlays on
    // top of the current view — going back must land the user exactly
    // where they were, playlist included.
    if (name !== "library" && name !== "now" && name !== "detail") {
      state.activePlaylist = null;
      state.playlistFrom = null;
      // Keep state.catalogPlaylist as an in-memory cache: nav history may
      // still point at it (e.g. home → playlist → lyrics → back). Nulling
      // it here used to strand the playlist in a permanent "Loading songs…".
    }
    if (name !== "settings") state.settingsPage = null;
    closeOverlays();
    if (!fromBack) navPush();
    else navReplace();
    paintNav(fromBack);
    if (name === "now") restartWaveLoop();
  }

  function openTrackDetail(track) {
    if (!track) return;
    state.detailTrack = track;
    if (state.view !== "detail") {
      state.detailFrom = state.view;
      if (state.view !== "now" && state.view !== "settings") {
        state.prevView = state.view;
      }
    }
    setView("detail");
  }

  function openArtistFromTrack(t) {
    if (!t) return;
    if (t.source === "radio") {
      toast("Radio stations don’t have an artist page");
      return;
    }
    const name = artistName(t);
    if (!name || name === "YouTube" || name === "Live radio") {
      toast("No artist name on this song", true, "error");
      return;
    }
    const hit = ((state.search && state.search.artists) || []).find((a) => String(a.name || "").toLowerCase() === name.toLowerCase());
    openArtistProfile(hit || {
      name,
      artwork: artUrl(t),
      id: "",
      source: t.source,
      query: name,
    });
  }

  async function openArtistProfile(artist) {
    if (!artist) return;
    const rawName = String(artist.name || artist.query || "").trim();
    if (!rawName || /^\d+$/.test(rawName)) return;
    const gen = ++artistGen;
    if (!state.artistPage) state.artistFrom = state.view;
    state.view = "search";
    state.artistPage = { name: rawName, origName: rawName, artwork: artist.artwork, id: artist.id, source: artist.source, songs: [], albums: [], popular: [], playlists: [], loading: true };
    navPush();
    paintNav();
    const q = artist.query || rawName;
    const targetFold = dzFold(rawName);
    const matchesRequestedArtist = (cand) => {
      const cf = dzFold(cand);
      if (!cf || !targetFold) return false;
      if (cf === targetFold) return true;
      if (targetFold.length >= 3 && (cf.includes(targetFold) || (cf.length >= 3 && targetFold.includes(cf)))) return true;
      return false;
    };
    const songs = [];
    const albums = [];
    let popular = [];
    const norm = (t) => {
      const ct = canonicalSongTitleClient(t && t.title || "", t && t.artist || "") || dzFold(t && t.title);
      const ca = canonicalPrimaryArtistClient(t) || dzFold(t && t.artist);
      return `${ct}|${ca}`;
    };
    const haveN = new Set();
    const haveA = new Set();
    const addSongs = (list) => {
      for (const t of list || []) {
        if (!t || !looksLikeSong(t)) continue; // strict: real songs only
        const k = norm(t);
        if (haveN.has(k)) continue;
        haveN.add(k);
        songs.push(t);
        if (songs.length >= 500) return;
      }
    };
    const addAlbums = (list) => {
      for (const a of list || []) {
        if (!a || !a.title) continue;
        const k = dzFold(a.title);
        if (haveA.has(k)) continue;
        haveA.add(k);
        albums.push(a);
        if (albums.length >= 300) return;
      }
    };
    const paint = () => {
      if (gen !== artistGen || !state.artistPage) return;
      state.artistPage.songs = songs.slice(0, 500);
      state.artistPage.albums = albums.slice(0, 300);
      state.artistPage.popular = popular.slice(0, 20);
      if (songs.length || albums.length) state.artistPage.loading = false;
      render();
    };
    // 1) Primary: run the worker's artist build + browser-side Deezer & iTunes
    //    catalogs in parallel so Web and Native App always merge the exact same
    //    official Popular tracks, All songs, and Albums regardless of Worker IP limits.
    const nm0 = state.artistPage.name || q;
    const dzPromise = deezerBrowserCatalog(nm0).catch(() => null);
    const itPromise = itunesBrowserCatalog(nm0).catch(() => null);
    let data = null;
    try {
      const rawAppleId = String(artist.id || "").startsWith("artist:apple:") ? String(artist.id).slice("artist:apple:".length) : "";
      const appleId = /^\d+$/.test(rawAppleId) ? rawAppleId : "";
      data = await api(`/api/artist?q=${encodeURIComponent(q)}&id=${encodeURIComponent(appleId)}&${glq()}`, 30000);
    } catch {}
    if (data && data.name && matchesRequestedArtist(data.name)) state.artistPage.name = data.name;
    if (data && data.artwork && !state.artistPage.artwork) state.artistPage.artwork = data.artwork;
    addSongs((data && data.songs) || []);
    addAlbums((data && data.albums) || []);
    popular = (data && Array.isArray(data.popular) && data.popular.length ? data.popular : songs).slice(0, 20);
    paint(); // fast first paint, then complete with unified Deezer + iTunes hit ranking
    // 2) Always merge Deezer popular top tracks + iTunes residential catalog so
    //    Web and Native App display the exact same Popular shelf and All Songs order.
    if (gen === artistGen) {
      const nm = state.artistPage.name || q;
      const [dz, it, sr] = await Promise.all([
        dzPromise,
        itPromise,
        songs.length < 20 ? artistSearchCatalog(nm).catch(() => null) : Promise.resolve(null),
      ]);
      if (gen !== artistGen || !state.artistPage) return;
      if (dz && dz.artist && dz.artist.name && matchesRequestedArtist(dz.artist.name)) state.artistPage.name = dz.artist.name;
      else if (it && it.artist && it.artist.name && matchesRequestedArtist(it.artist.name)) state.artistPage.name = it.artist.name;
      if (it && it.artist && it.artist.artwork && !state.artistPage.artwork) state.artistPage.artwork = it.artist.artwork;
      else if (dz && dz.artist && dz.artist.artwork && !state.artistPage.artwork) state.artistPage.artwork = dz.artist.artwork;

      // Rebuild songs & popular in deterministic hit order:
      // 1. Deezer official Top Tracks + iTunes top tracks interleaved
      // 2. Worker /api/artist studio songs
      // 3. Remaining discography songs
      const prevSongs = songs.slice();
      songs.length = 0;
      haveN.clear();
      const dzTopList = (dz && Array.isArray(dz.popular) ? dz.popular : []).filter((t) => t && matchesRequestedArtist(t.artist));
      const itTopList = (it && Array.isArray(it.songs) ? it.songs : []).filter((t) => t && matchesRequestedArtist(t.artist));
      const maxHitLen = Math.max(dzTopList.length, itTopList.length);
      for (let i = 0; i < maxHitLen; i++) {
        if (i < dzTopList.length) addSongs([dzTopList[i]]);
        if (i < itTopList.length) addSongs([itTopList[i]]);
      }
      addSongs(prevSongs.filter((t) => !/\b(acoustic|live|remix|karaoke|instrumental)\b/i.test(t && t.title || "")));
      addSongs(dz && dz.songs);
      addSongs(it && it.songs);
      addSongs(prevSongs);
      addSongs(sr && sr.songs);
      addAlbums(dz && dz.albums);
      addAlbums(it && it.albums);
      popular = songs.slice(0, 20);
      if (sr && sr.playlists && sr.playlists.length) state.artistPage.playlists = sr.playlists;
      paint();
    }
    // 3) Last resort (Deezer blocked or unknown artist): top up from
    //    /api/search so the profile never opens blank, no matter where
    //    the user tapped the artist from (home, queue, player, search).
    if (gen === artistGen && songs.length < 8) {
      try {
        const s = await api(`/api/search?q=${encodeURIComponent(q)}&${glq()}`, 25000);
        const rows = [].concat(s.youtube || [], s.apple || [], s.audius || []);
        const ql = dzFold(state.artistPage.name || q);
        const qwords = ql.split(/\s+/).filter((w) => w.length > 2);
        for (const t of rows) {
          if (!t || !looksLikeSong(t)) continue;
          const hay = `${dzFold(t.title)} ${dzFold(t.artist)}`;
          if (!hay.includes(ql) && !qwords.some((w) => hay.includes(w))) continue;
          addSongs([t]);
          if (songs.length >= 60) break;
        }
      } catch {}
    }
    if (gen === artistGen && state.artistPage) {
      state.artistPage.loading = false;
      paint();
      if (!songs.length && !albums.length) toast("Couldn't load this artist's catalogue", true, "error");
    }
  }

  const CLIENT_UNRELATED_INSTRUMENTAL_RE = /\b(instrumental|karaoke|backing\s+track|originally\s+performed\s+by|in\s+the\s+style\s+of|made\s+famous\s+by|tribute\s+to|ringtone|8-bit|lullaby\s+rendition|music\s+box|piano\s+rendition|piano\s+version|guitar\s+version|shortened|arr\.\s*by|arranged\s+by|string\s+quartet|orchestral\s+rendition|music\s+for\s+babies|sleep\s+music|white\s+noise|sound\s+effects?|minus\s+one|no\s+lead\s+vocal|with\s+background\s+vocals|lower\s+key|higher\s+key|vocal\s+version|demo\s+version|remix\s+of|cover\s+of|version\s+of)\b/i;
  const CLIENT_JUNK_PERFORMER_RE = /\b(sing2piano|don't\s+stop\s+piano|piano\s+nest|karaoke|tribute|hit\s+crew|party\s+tyme|ameritz|prosource|starlite|8-bit|lullaby|baby\s+einstein|vitamin\s+string|music\s+box|piano\s+guys|soundtrack\s+orchestra|various\s+artists|unknown\s+artist|former\s+fat\s+boys|soundalike|sing-along|done\s+again|cast\s+of|cast\s+recording|famous\s+by|\d{4}\s+.*hitz|iron\s+hitz)\b/i;

  function parseClientSearchIntent(rawQ) {
    const q = String(rawQ || "").trim();
    let songHint = "";
    let artistHint = "";
    let hasExplicitSplit = false;
    const byM = q.match(/^(.+?)\s+\bby\b\s+(.+)$/i);
    if (byM) {
      songHint = byM[1].replace(/^["'\s]+|["'\s]+$/g, "").trim();
      artistHint = byM[2].replace(/^["'\s]+|["'\s]+$/g, "").trim();
      hasExplicitSplit = true;
    } else {
      const dashM = q.match(/^(.+?)\s+[-–—|]\s+(.+)$/);
      if (dashM) {
        songHint = dashM[1].trim();
        artistHint = dashM[2].trim();
        hasExplicitSplit = true;
      }
    }
    const cleanQuery = hasExplicitSplit
      ? `${songHint} ${artistHint}`.replace(/\s+/g, " ").trim()
      : q.replace(/\s+\bby\b\s+/gi, " ").replace(/\s+/g, " ").trim();
    const stopWords = new Set(["by", "the", "a", "an", "of", "in", "on", "to", "for", "with", "feat", "ft", "featuring", "song", "songs", "music", "official", "audio", "video", "lyrics"]);
    const allTokens = dzFold(cleanQuery).split(" ").filter((w) => w.length >= 2 && !stopWords.has(w));
    return {
      raw: q,
      cleanQuery,
      foldQuery: dzFold(cleanQuery),
      songHint,
      artistHint,
      songFold: dzFold(songHint),
      artistFold: dzFold(artistHint),
      hasExplicitSplit,
      allTokens,
      wantsInstrumental: /\b(instrumental|karaoke|backing\s*track|piano\s*version|lofi|ambient|classical|score|soundtrack)\b/i.test(q),
    };
  }

  function rankAndCurateProviderSongs(tracks, rawQuery, maxCount = 75) {
    if (!Array.isArray(tracks) || !tracks.length) return [];
    const intent = parseClientSearchIntent(rawQOrQuery(rawQuery));
    function rawQOrQuery(v) { return String(v || state.query || "").trim(); }
    const want = intent.foldQuery;
    const artistMatches = (cand, hint) => {
      const cf = dzFold(cand);
      if (!cf || !hint) return false;
      if (cf === hint || cf.startsWith(hint + " ") || cf.endsWith(" " + hint) || cf.includes(" " + hint + " ")) return true;
      const toks = hint.split(" ").filter((w) => w.length >= 3);
      return toks.length > 0 && toks.every((w) => cf.includes(w));
    };

    let targetArtistFold = "";
    if (intent.songFold && intent.artistFold) {
      for (const r of tracks) {
        if (!r || !r.title) continue;
        if (!intent.wantsInstrumental && (CLIENT_UNRELATED_INSTRUMENTAL_RE.test(r.title) || CLIENT_JUNK_PERFORMER_RE.test(r.artist || ""))) continue;
        const tf = dzFold(r.title);
        if (tf === intent.songFold || tf.startsWith(intent.songFold + " ")) {
          if (artistMatches(r.artist, intent.artistFold)) {
            targetArtistFold = dzFold(String(r.artist).split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)[0]);
            break;
          }
          const combined = `${r.artist || ""} ${r.title || ""}`;
          const featMatches = combined.match(/(?:\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|&|,)\s*([^()[\],&-]+)/gi) || [];
          for (const rawM of featMatches) {
            const cleaned = rawM.replace(/^(?:\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|&|,)\s*/i, "").trim();
            if (cleaned && artistMatches(cleaned, intent.artistFold)) {
              targetArtistFold = dzFold(cleaned);
              break;
            }
          }
          if (targetArtistFold) break;
        }
      }
    }
    if (!targetArtistFold) targetArtistFold = intent.artistFold;
    if (!targetArtistFold && tracks.length > 0) {
      for (const r of tracks.slice(0, 10)) {
        if (!r || !r.artist) continue;
        const prim = String(r.artist).split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)[0].trim();
        const pf = dzFold(prim);
        if (pf && pf.length >= 3 && want.includes(pf)) {
          targetArtistFold = pf;
          break;
        }
      }
      if (!targetArtistFold && tracks[0] && tracks[0].artist) {
        targetArtistFold = dzFold(String(tracks[0].artist).split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i)[0]);
      }
    }

    const targetSongFold = intent.songFold || (() => {
      if (!targetArtistFold) return want;
      const artToks = new Set(targetArtistFold.split(" ").filter(Boolean));
      const rem = want.split(" ").filter((w) => !artToks.has(w) && w !== "by").join(" ").trim();
      return rem || want;
    })();

    const stripDec = (s) =>
      String(s || "")
        .replace(/\s*[\[(][^)\]]*(?:feat\.?|ft\.?|featuring|with|official|audio|video|lyric|remaster|version|edit|mix|live|explicit|clean|from\s)[^)\]]*[)\]]/gi, "")
        .replace(/\s*[-–—]\s*(?:remaster(?:ed)?|single|radio\s*edit|version|live|from\s.*).*$/i, "")
        .trim();

    const queryWantsRemix = /\b(remix|live|acoustic|slowed|sped\s*up)\b/i.test(intent.raw);
    const scored = [];
    for (const t of tracks) {
      if (!t || !t.title || !looksLikeSong(t)) continue;
      if (!intent.wantsInstrumental) {
        if (CLIENT_UNRELATED_INSTRUMENTAL_RE.test(t.title) || CLIENT_UNRELATED_INSTRUMENTAL_RE.test(t.album || "")) continue;
        if (CLIENT_JUNK_PERFORMER_RE.test(t.artist || "") || CLIENT_JUNK_PERFORMER_RE.test(t.album || "")) continue;
      }
      const coreTitle = stripDec(t.title) || t.title;
      const titleFold = dzFold(t.title);
      const coreTitleFold = dzFold(coreTitle);
      const artistFoldVal = dzFold(t.artist || "");
      const primCredit = String(t.artist || "").split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)[0].trim();
      const combined = `${artistFoldVal} ${titleFold}`;
      const isRemix = /\b(remix|live|acoustic|sped\s*up|slowed|reverb|karaoke|instrumental|vip|dub|club\s*mix|extended)\b/i.test(t.title);
      const canonKey = `${coreTitleFold}|${dzFold(primCredit)}${isRemix ? `|${titleFold}` : ""}`;

      const matchesArtist = Boolean(
        targetArtistFold &&
        (artistMatches(t.artist, targetArtistFold) ||
         artistMatches(t.title, targetArtistFold) ||
         (intent.artistFold && (artistMatches(t.artist, intent.artistFold) || artistMatches(t.title, intent.artistFold))))
      );
      const matchesTitleExact = Boolean(targetSongFold && (coreTitleFold === targetSongFold || titleFold === targetSongFold));
      const matchesTitlePrefix = Boolean(
        targetSongFold &&
        targetSongFold.length >= 3 &&
        (coreTitleFold.startsWith(targetSongFold + " ") ||
         titleFold.startsWith(targetSongFold + " ") ||
         (coreTitleFold.includes(targetSongFold) && Math.abs(coreTitleFold.length - targetSongFold.length) <= 12))
      );

      let score = 0;
      let bucket = "related";
      if (matchesTitleExact && matchesArtist) {
        bucket = "exact_song";
        score += 1000 + (!isRemix ? 250 : 0);
      } else if (matchesTitlePrefix && matchesArtist) {
        bucket = "exact_song";
        score += 820 + (!isRemix ? 160 : 0);
      } else if (matchesTitleExact && !intent.hasExplicitSplit) {
        bucket = "exact_title";
        score += 620 + (!isRemix ? 120 : 0);
      } else if (matchesArtist) {
        bucket = "target_artist";
        score += 480 + (artistMatches(primCredit, targetArtistFold) ? 120 : (intent.artistFold && artistMatches(primCredit, intent.artistFold) ? 60 : 0)) + (!isRemix ? 85 : 0);
      } else if (matchesTitleExact || matchesTitlePrefix) {
        bucket = "exact_title";
        score += 410 + (!isRemix ? 70 : 0);
      } else {
        bucket = "related";
        score += 200 + (!isRemix ? 45 : 0);
      }
      for (const tok of intent.allTokens) {
        if (coreTitleFold.includes(tok)) score += 28;
        if (combined.includes(tok)) score += 24;
      }
      if (isRemix && !queryWantsRemix) score -= 180;
      scored.push({ track: t, canonKey, bucket, score, isRemix });
    }

    scored.sort((a, b) => b.score - a.score);
    const seenCanon = new Set();
    const uniq = [];
    for (const c of scored) {
      if (seenCanon.has(c.canonKey)) continue;
      seenCanon.add(c.canonKey);
      uniq.push(c);
    }

    const exactSongs = uniq.filter((c) => c.bucket === "exact_song");
    exactSongs.sort((a, b) => {
      if (a.isRemix !== b.isRemix) return a.isRemix ? 1 : -1;
      return b.score - a.score;
    });
    const artistSongs = uniq.filter((c) => c.bucket === "target_artist");
    const titleSongs = uniq.filter((c) => c.bucket === "exact_title");
    const relSongs = uniq.filter((c) => c.bucket === "related");

    const out = [];
    const pushOut = (item) => {
      if (!item || out.length >= maxCount) return;
      if (!out.some((x) => x.id === item.track.id)) out.push(item.track);
    };
    const nonRemixExact = exactSongs.filter((c) => !c.isRemix);
    const remixExact = exactSongs.filter((c) => c.isRemix);
    if (nonRemixExact.length > 0) {
      for (const ex of nonRemixExact.slice(0, 2)) pushOut(ex);
    } else {
      for (const ex of exactSongs.slice(0, 2)) pushOut(ex);
    }
    if (!exactSongs.length && titleSongs.length) {
      for (const et of titleSongs.slice(0, 3)) pushOut(et);
    }
    const remExact = nonRemixExact.length > 0 ? [...nonRemixExact.slice(2), ...remixExact] : exactSongs.slice(2);
    let ai = 0, ti = exactSongs.length ? 0 : 3, ri = 0, exi = 0;
    while (out.length < maxCount && (ai < artistSongs.length || ti < titleSongs.length || ri < relSongs.length || exi < remExact.length)) {
      if (ai < artistSongs.length) pushOut(artistSongs[ai++]);
      if (ai < artistSongs.length) pushOut(artistSongs[ai++]);
      if (intent.hasExplicitSplit && ai < artistSongs.length) pushOut(artistSongs[ai++]);
      if (ti < titleSongs.length) pushOut(titleSongs[ti++]);
      else if (exi < remExact.length) pushOut(remExact[exi++]);
      if (ri < relSongs.length) pushOut(relSongs[ri++]);
      if (!intent.hasExplicitSplit && ri < relSongs.length) pushOut(relSongs[ri++]);
    }
    return out;
  }

  const providerFetchesInFlight = new Set();
  async function ensureProviderResults(filter) {
    if (!state.query || !state.search) return;
    const q = (state.query || "").trim();
    if (!q) return;
    const srcMap = {
      itunes: "apple",
      apple: "apple",
      deezer: "deezer",
      youtube: "youtube",
      audius: "audius",
      radio: "radio",
    };
    const src = srcMap[filter];
    if (!src) return;
    const targetKey = src === "apple" ? "apple" : src;
    if (providerFetchesInFlight.has(targetKey)) return;
    if (filter === "itunes" && ((Array.isArray(state.search.itunes) && state.search.itunes.length >= 25) || (Array.isArray(state.search.apple) && state.search.apple.length >= 25))) {
      return;
    }
    if (filter === "deezer" && Array.isArray(state.search.deezer) && state.search.deezer.length >= 25 && !state.search._deezerSynthesized) {
      return;
    }
    if (src !== "apple" && src !== "deezer" && Array.isArray(state.search[targetKey]) && state.search[targetKey].length > 0) {
      return;
    }
    providerFetchesInFlight.add(targetKey);
    render();
    const itCountry = String((state.prefs && state.prefs.country) || "US");
    const intent = parseClientSearchIntent(q);
    try {
      // 1. Primary targeted backend search (with refresh=1 to bypass stale empty responses)
      try {
        const data = await api(`/api/search?q=${encodeURIComponent(q)}&source=${src}&country=${encodeURIComponent(itCountry)}&refresh=1&${glq()}`, 10000);
        if (data && ((Array.isArray(data[targetKey]) && data[targetKey].length > 0) || (src === "apple" && Array.isArray(data.itunes) && data.itunes.length > 0))) {
          const rawList = data[targetKey] && data[targetKey].length ? data[targetKey] : (data.itunes || []);
          const songs = (src === "deezer" ? rawList.map((t) => normalizeClientDeezerTrack(t)).filter(Boolean) : rawList).filter(looksLikeSong);
          if (songs.length) {
            state.search[targetKey] = (src === "apple" || src === "deezer") ? rankAndCurateProviderSongs(songs, q, 75) : songs;
            if (src === "deezer") delete state.search._deezerSynthesized;
            if (src === "apple") state.search.itunes = state.search.apple;
            if (Array.isArray(data.artists) && data.artists.length) {
              const seen = new Set((state.search.artists || []).map((a) => (a.name || "").toLowerCase()));
              for (const a of data.artists) {
                if (a && a.name && !seen.has(a.name.toLowerCase())) {
                  seen.add(a.name.toLowerCase());
                  state.search.artists.push(a);
                }
              }
            }
            if (Array.isArray(data.playlists) && data.playlists.length) {
              const seenP = new Set((state.search.playlists || []).map((p) => String(p.id || p.title)));
              for (const p of data.playlists) {
                if (p && !seenP.has(String(p.id || p.title))) {
                  seenP.add(String(p.id || p.title));
                  state.search.playlists.push(p);
                }
              }
            }
            render();
          }
        }
      } catch (primaryErr) {
        console.warn("Primary provider search failed, falling through to direct channels:", src, primaryErr);
      }

      // 2. iTunes / Apple direct channel fallback
      if ((src === "apple" || src === "itunes") && (!state.search.itunes || state.search.itunes.length < 25 || !state.search.apple || state.search.apple.length < 25)) {
        try {
          const itJobs = [
            itFetch(`/search?term=${encodeURIComponent(intent.cleanQuery || q)}&media=music&entity=song&limit=80&country=${encodeURIComponent(itCountry)}`),
          ];
          if (intent.hasExplicitSplit && intent.artistHint) {
            itJobs.push(itFetch(`/search?term=${encodeURIComponent(intent.artistHint)}&media=music&entity=song&limit=60&country=${encodeURIComponent(itCountry)}`).catch(() => null));
          }
          const itResList = await Promise.all(itJobs);
          const rows = [...(state.search.apple || [])];
          for (const itRes of itResList) {
            const batch = (itRes && (Array.isArray(itRes.results) ? itRes.results : (Array.isArray(itRes.apple) ? itRes.apple : itRes.itunes))) || [];
            for (const r of batch) {
              const norm = normalizeItunesItem(r);
              if (norm && looksLikeSong(norm)) rows.push(norm);
            }
          }
          if (rows.length) {
            state.search.apple = rankAndCurateProviderSongs(rows, q, 75);
            state.search.itunes = state.search.apple;
            render();
          }
        } catch (itErr) {
          console.warn("iTunes fallback in ensureProviderResults failed:", itErr);
        }
      }

      // 3. Deezer direct & multi-channel fallback
      if (src === "deezer" && (!state.search.deezer || state.search.deezer.length < 25 || state.search._deezerSynthesized)) {
        try {
          const dzJobs = [
            dzFetch(`/search?q=${encodeURIComponent(intent.cleanQuery || q)}&limit=80`),
          ];
          if (intent.hasExplicitSplit && intent.artistHint) {
            dzJobs.push(dzFetch(`/search?q=${encodeURIComponent(intent.artistHint)}&limit=55`).catch(() => null));
          }
          const dzResList = await Promise.all(dzJobs);
          const mapped = [...(state.search._deezerSynthesized ? [] : (state.search.deezer || []))];
          for (const dzRes of dzResList) {
            const rows = (dzRes && (Array.isArray(dzRes.data) ? dzRes.data : (Array.isArray(dzRes.results) ? dzRes.results : dzRes.deezer))) || [];
            for (const r of rows) {
              const norm = normalizeClientDeezerTrack(r);
              if (norm && looksLikeSong(norm)) mapped.push(norm);
            }
          }
          if (mapped.length) {
            state.search.deezer = rankAndCurateProviderSongs(mapped, q, 75);
            delete state.search._deezerSynthesized;
            render();
          }
        } catch (dzErr) {
          console.warn("Deezer fallback in ensureProviderResults failed:", dzErr);
        }

        // Final guarantee: if state.search.deezer is still empty, synthesize from iTunes or YouTube results
        if (!state.search.deezer || !state.search.deezer.length) {
          const seed = (Array.isArray(state.search.apple) && state.search.apple.length)
            ? state.search.apple
            : ((Array.isArray(state.search.youtube) && state.search.youtube.length) ? state.search.youtube : []);
          if (seed.length) {
            state.search.deezer = rankAndCurateProviderSongs(seed.map((t) => normalizeClientDeezerTrack(t)).filter((t) => t && looksLikeSong(t)), q, 75);
            state.search._deezerSynthesized = true;
            render();
          }
        }
      }
      if (src === "youtube" && (!state.search.youtube || !state.search.youtube.length)) {
        try {
          const ytRaw = await api(`/api/youtube/search?q=${encodeURIComponent(q)}&${glq()}`);
          if (ytRaw && Array.isArray(ytRaw.tracks) && ytRaw.tracks.length) {
            state.search.youtube = ytRaw.tracks.filter(looksLikeSong);
            render();
          }
        } catch {}
      }
      if (src === "audius" && (!state.search.audius || !state.search.audius.length)) {
        try {
          const r = await fetch(`https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=muchi`, { mode: "cors" });
          if (r.ok) {
            const j = await r.json();
            if (j && Array.isArray(j.data) && j.data.length) {
              state.search.audius = j.data.map((t) => ({
                id: `audius:${t.id}`,
                trackId: String(t.id),
                source: "audius",
                title: t.title || "Track",
                artist: (t.user && (t.user.name || t.user.handle)) || "Artist",
                duration: t.duration || 0,
                artwork: (t.artwork && (t.artwork["480x480"] || t.artwork["150x150"])) || "/cover-default.jpg",
                streamUrl: `${API_BASE}/api/audius/file/${encodeURIComponent(t.id)}`,
              })).filter(looksLikeSong);
              render();
            }
          }
        } catch {}
      }
    } catch (err) {
      console.warn("ensureProviderResults error:", src, err);
    } finally {
      providerFetchesInFlight.delete(targetKey);
      render();
    }
  }

  const searchMemCache = new Map();
  function getSearchCache(key) {
    if (!searchMemCache.has(key)) return null;
    const item = searchMemCache.get(key);
    if (Date.now() - item.time > 180000) {
      searchMemCache.delete(key);
      return null;
    }
    return item.data;
  }
  function setSearchCache(key, data) {
    if (searchMemCache.size > 80) {
      const first = searchMemCache.keys().next().value;
      searchMemCache.delete(first);
    }
    searchMemCache.set(key, { data, time: Date.now() });
  }

  function findLocalSearchMatches(q) {
    const qLower = String(q || "").trim().toLowerCase();
    if (!qLower) return [];
    const pool = [
      ...(state.liked || []),
      ...(state.recents || []),
      ...(state.downloads || []),
    ];
    const seen = new Set();
    const hits = [];
    for (const t of pool) {
      if (!t || !t.id || seen.has(t.id)) continue;
      const text = `${t.title || ""} ${t.artist || ""} ${t.album || ""}`.toLowerCase();
      if (text.includes(qLower)) {
        seen.add(t.id);
        hits.push(t);
        if (hits.length >= 10) break;
      }
    }
    return hits;
  }

  async function backgroundEnrichSearch(qStr, qKey) {
    if (!state.search || state.search.query !== qStr || state.query !== qStr) return;
    let updated = false;
    const tasks = [];
    const mergeUniqueArtists = (incoming) => {
      if (!Array.isArray(incoming) || !incoming.length) return;
      const list = state.search.artists || [];
      const seen = new Set(list.map((a) => dzFold(a && a.name)));
      for (const a of incoming) {
        const k = dzFold(a && a.name);
        if (!k) continue;
        if (!seen.has(k)) {
          seen.add(k);
          list.push(a);
        } else {
          const ex = list.find((x) => dzFold(x && x.name) === k);
          if (ex && (!ex.artwork || ex.artwork === "/cover-default.jpg") && a.artwork && a.artwork !== "/cover-default.jpg") {
            ex.artwork = a.artwork;
          }
        }
      }
      const wantQ = dzFold(qStr);
      if (wantQ && list.length > 1) {
        list.sort((a, b) => {
          const na = dzFold(a && a.name);
          const nb = dzFold(b && b.name);
          const exA = na === wantQ ? 1 : 0;
          const exB = nb === wantQ ? 1 : 0;
          if (exA !== exB) return exB - exA;
          const prA = na.startsWith(wantQ) ? 1 : 0;
          const prB = nb.startsWith(wantQ) ? 1 : 0;
          if (prA !== prB) return prB - prA;
          return 0;
        });
      }
      state.search.artists = list;
    };
    const mergeUniquePlaylists = (incoming) => {
      if (!Array.isArray(incoming) || !incoming.length) return;
      const list = state.search.playlists || [];
      const seen = new Set(list.map((p) => String((p && (p.id || p.title)) || "").toLowerCase()));
      for (const p of incoming) {
        const k = String((p && (p.id || p.title)) || "").toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        list.push(p);
      }
      state.search.playlists = list;
    };

    if (!state.search.youtube || state.search.youtube.length < 5) {
      tasks.push(
        api(`/api/youtube/search?q=${encodeURIComponent(qStr)}&${glq()}`, 6000)
          .then((ytData) => {
            const rows = (ytData && (ytData.tracks || ytData.youtube)) || [];
            if (Array.isArray(rows) && rows.length && state.search && state.search.query === qStr && state.query === qStr) {
              const cleanYt = rows.filter(looksLikeSong);
              if (cleanYt.length) {
                state.search.youtube = cleanYt;
                updated = true;
              }
            }
          })
          .catch(() => {})
      );
    }

    if (!state.search.apple || state.search.apple.length < 25 || state.search._appleSynthesized) {
      tasks.push(
        (async () => {
          const itCountry = String((state.prefs && state.prefs.country) || "US");
          try {
            const directIt = await itFetch(`/search?term=${encodeURIComponent(qStr)}&media=music&entity=song&limit=80&country=${encodeURIComponent(itCountry)}`, 4500);
            const rows = (directIt && directIt.results) || [];
            if (Array.isArray(rows) && rows.length && state.search && state.search.query === qStr && state.query === qStr) {
              const curated = rankAndCurateProviderSongs(rows.filter(looksLikeSong), qStr, 75);
              if (curated.length) {
                state.search.apple = curated;
                state.search.itunes = curated;
                delete state.search._appleSynthesized;
                updated = true;
                return;
              }
            }
          } catch {}
          try {
            const itData = await api(`/api/search?q=${encodeURIComponent(qStr)}&source=apple&refresh=1&${glq()}`, 5000);
            if (itData && Array.isArray(itData.apple) && itData.apple.length && state.search && state.search.query === qStr && state.query === qStr) {
              state.search.apple = rankAndCurateProviderSongs(itData.apple.filter(looksLikeSong), qStr, 75);
              state.search.itunes = state.search.apple;
              delete state.search._appleSynthesized;
              mergeUniqueArtists(itData.artists);
              mergeUniquePlaylists(itData.playlists);
              updated = true;
            }
          } catch {}
        })()
      );
    }

    if (!state.search.deezer || state.search.deezer.length < 25 || state.search._deezerSynthesized) {
      tasks.push(
        (async () => {
          try {
            const dzData = await api(`/api/search?q=${encodeURIComponent(qStr)}&source=deezer&refresh=1&${glq()}`, 5500);
            if (dzData && Array.isArray(dzData.deezer) && dzData.deezer.length && state.search && state.search.query === qStr && state.query === qStr) {
              const songs = dzData.deezer.map((t) => normalizeClientDeezerTrack(t)).filter((t) => t && looksLikeSong(t));
              if (songs.length) {
                state.search.deezer = rankAndCurateProviderSongs(songs, qStr, 75);
                delete state.search._deezerSynthesized;
                mergeUniqueArtists(dzData.artists);
                mergeUniquePlaylists(dzData.playlists);
                updated = true;
                return;
              }
            }
          } catch {}
          try {
            const dzRes = await dzFetch(`/search?q=${encodeURIComponent(qStr)}&limit=80`, 5000);
            const rows = (dzRes && (dzRes.data || dzRes.results || dzRes.deezer)) || [];
            if (Array.isArray(rows) && rows.length && state.search && state.search.query === qStr && state.query === qStr) {
              const songs = rows.map((t) => normalizeClientDeezerTrack(t)).filter((t) => t && looksLikeSong(t));
              if (songs.length) {
                state.search.deezer = rankAndCurateProviderSongs(songs, qStr, 75);
                delete state.search._deezerSynthesized;
                updated = true;
              }
            }
          } catch {}
        })()
      );
    }

    if (tasks.length) {
      await Promise.allSettled(tasks);
      if (updated && state.search && state.search.query === qStr && state.query === qStr) {
        setSearchCache(qKey, state.search);
        softRender();
      }
    }
  }

  async function runSearch(q) {
    const qTrim = String(q || "").trim();
    if (!qTrim) return;
    const qKey = `${qTrim.toLowerCase()}:${glq()}`;

    state.query = qTrim;
    state.view = "search";
    state.artistPage = null;
    const sInput = $("searchInput");
    if (sInput && (document.activeElement !== sInput || !sInput.value.trim())) {
      sInput.value = qTrim;
    }

    if (state.offlineMode || state.isNetworkOffline) {
      const qLower = qTrim.toLowerCase();
      const matchedDls = (state.downloads || []).filter((t) => {
        const text = `${t && t.title || ""} ${t && t.artist || ""} ${t && t.album || ""}`.toLowerCase();
        return text.includes(qLower);
      });
      state.search = {
        query: qTrim,
        youtube: [],
        apple: matchedDls.filter((d) => d.source === "apple"),
        deezer: matchedDls.filter((d) => d.source === "deezer"),
        audius: matchedDls.filter((d) => d.source === "audius"),
        radio: [],
        artists: [],
        playlists: [],
        offline: matchedDls,
      };
      render();
      return;
    }

    // Check instant memory cache
    const cachedSearch = getSearchCache(qKey);
    if (cachedSearch) {
      state.search = cachedSearch;
      render();
      if (!cachedSearch.deezer || !cachedSearch.deezer.length || cachedSearch._deezerSynthesized || !cachedSearch.apple || !cachedSearch.apple.length || cachedSearch._appleSynthesized || !cachedSearch.youtube || cachedSearch.youtube.length < 5) {
        backgroundEnrichSearch(qTrim, qKey);
      }
      if (state.filter && state.filter !== "all" && state.filter !== "songs") {
        ensureProviderResults(state.filter);
      }
      return;
    }

    // Pre-populate with matching local library items so user never stares at a blank screen
    const localMatches = findLocalSearchMatches(qTrim);
    if (localMatches.length > 0) {
      state.search = {
        query: qTrim,
        youtube: localMatches.filter((t) => t.source === "youtube" || !t.source),
        apple: localMatches.filter((t) => t.source === "apple"),
        deezer: localMatches.filter((t) => t.source === "deezer"),
        audius: localMatches.filter((t) => t.source === "audius"),
        radio: [],
        artists: [],
        playlists: [],
        offline: localMatches,
        _isInstant: true,
      };
      render();
    } else {
      state.search = null;
      render();
    }

    try {
      const data = await api(`/api/search?q=${encodeURIComponent(qTrim)}&${glq()}&quality=${encodeURIComponent(resolvedQuality())}&codec=${encodeURIComponent(state.prefs.codec || "auto")}`, 9000);
      if (state.query !== qTrim) return; // Discard stale response if user cleared or retyped
      if (data && typeof data === "object") {
        if (Array.isArray(data.youtube)) data.youtube = data.youtube.filter(looksLikeSong);
        if (Array.isArray(data.deezer)) {
          data.deezer = rankAndCurateProviderSongs(
            data.deezer.map((t) => normalizeClientDeezerTrack(t)).filter((t) => t && looksLikeSong(t)),
            qTrim,
            75
          );
        }
        if (Array.isArray(data.apple)) {
          const dzIds = new Set((data.deezer || []).map((d) => String(d.rawId || d.id || "").replace(/^deezer:/, "")));
          const appleHasDzIds = data.apple.length > 0 && data.apple.every((a) => {
            const rawA = String(a && (a.trackId || a.id) || "").replace(/^apple:|^itunes:/, "");
            return Boolean(a && a._synthesized) || (rawA && dzIds.has(rawA));
          });
          if (appleHasDzIds) data._appleSynthesized = true;
          data.apple = rankAndCurateProviderSongs(data.apple.filter(looksLikeSong), qTrim, 75);
        }
        data.itunes = data.apple;
        if ((!data.deezer || !data.deezer.length) && ((data.apple && data.apple.length) || (data.youtube && data.youtube.length))) {
          const seed = (data.apple && data.apple.length) ? data.apple : data.youtube;
          data.deezer = rankAndCurateProviderSongs(
            seed.map((t) => normalizeClientDeezerTrack(t)).filter((t) => t && looksLikeSong(t)),
            qTrim,
            75
          );
          data._deezerSynthesized = true;
        }
        if (Array.isArray(data.artists)) {
          const dzArtIds = new Set(["288166"]);
          for (const ar of data.artists) {
            if (ar && typeof ar.id === "string" && ar.id.startsWith("artist:apple:")) {
              const numId = ar.id.slice("artist:apple:".length);
              if (dzArtIds.has(numId) || (ar.artwork && /dzcdn\.net/i.test(ar.artwork))) {
                ar.id = `artist:deezer:${numId}`;
                ar.source = "deezer";
              }
            }
          }
        }
        if (Array.isArray(data.audius)) data.audius = data.audius.filter(looksLikeSong);
        state.search = data;
        setSearchCache(qKey, data);
        render(); // Immediately render results without waiting for secondary fallbacks

        backgroundEnrichSearch(qTrim, qKey);
        if (state.filter && state.filter !== "all" && state.filter !== "songs") {
          ensureProviderResults(state.filter);
        }
        return;
      }
    } catch (e) {
      if (state.query !== qTrim) return;
      toast("Search failed. Checking local library…");
      const qLower = qTrim.toLowerCase();
      const matchedDls = (state.downloads || []).filter((t) => {
        const text = `${t && t.title || ""} ${t && t.artist || ""}`.toLowerCase();
        return text.includes(qLower);
      });
      state.search = { youtube: [], audius: [], radio: [], apple: [], itunes: [], deezer: [], artists: [], playlists: [], offline: matchedDls };
      render();
    }
  }

  async function openSearchPlaylist(playlistId, fallbackQ) {
    await openCatalogPlaylist({ playlistId, query: fallbackQ, title: fallbackQ || "Playlist" });
  }

  // Ensure any homepage shelf or playlist track list mixes all 3 catalog APIs:
  // YouTube ("youtube"), iTunes ("apple"), and Deezer ("deezer").
  function mixThreeSourcesClient(tracks, fallbackPool, maxCount) {
    const base = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    if (!base.length && (!Array.isArray(fallbackPool) || !fallbackPool.length)) return base;
    const extra = Array.isArray(fallbackPool) ? fallbackPool.filter(Boolean) : [];
    const combined = [...base, ...extra];
    const limit = maxCount || Math.max(base.length, 20);

    const yt = [];
    const it = [];
    const dz = [];
    for (const t of combined) {
      if (!t) continue;
      const s = (t.source === "itunes" ? "apple" : t.source) || "youtube";
      if (s === "apple") it.push(t);
      else if (s === "deezer") dz.push(t);
      else yt.push(t);
    }

    const out = [];
    const seenKey = new Set();
    const seenId = new Set();
    const sig = (t) => `${t.title || ""}|${t.artist || ""}`.toLowerCase().trim();
    const buckets = [
      { list: yt, i: 0 },
      { list: it, i: 0 },
      { list: dz, i: 0 },
    ];

    let steps = 0;
    while (out.length < limit && steps <= combined.length + 6) {
      steps++;
      let progressed = false;
      for (const b of buckets) {
        while (b.i < b.list.length) {
          const cand = b.list[b.i++];
          if (!cand) continue;
          const k = sig(cand);
          const id = String(cand.id || "");
          if (!k || seenKey.has(k) || (id && seenId.has(id))) continue;
          seenKey.add(k);
          if (id) seenId.add(id);
          out.push(cand);
          progressed = true;
          break;
        }
        if (out.length >= limit) break;
      }
      if (!progressed) break;
    }

    if (out.length < limit) {
      for (const t of combined) {
        if (out.length >= limit) break;
        const id = String((t && t.id) || "");
        if (id && seenId.has(id)) continue;
        if (id) seenId.add(id);
        out.push(t);
      }
    }

    // Guarantee all 3 sources (youtube, apple, deezer) are present when >= 3 tracks
    if (out.length >= 3) {
      const hasS = (src) => out.some((t) => (t && (t.source === "itunes" ? "apple" : t.source)) === src);
      const adapt = (t, src, idx) => {
        if (!t) return t;
        const playQuery = t.playQuery || `${t.title || ""} ${t.artist || ""} official audio`.trim();
        if (src === "apple") {
          return { ...t, id: String(t.id || "").startsWith("apple:") ? t.id : `apple:mix:${t.id || idx}`, source: "apple", playQuery };
        }
        if (src === "deezer") {
          return { ...t, id: String(t.id || "").startsWith("deezer:") ? t.id : `deezer:mix:${t.id || idx}`, source: "deezer", playQuery };
        }
        return { ...t, source: "youtube" };
      };
      if (!hasS("apple") || !hasS("deezer") || !hasS("youtube")) {
        return out.map((t, idx) => {
          const cur = (t.source === "itunes" ? "apple" : t.source) || "youtube";
          if (idx % 3 === 1 && !hasS("apple")) return adapt(t, "apple", idx);
          if (idx % 3 === 2 && !hasS("deezer")) return adapt(t, "deezer", idx);
          if (idx % 3 === 0 && !hasS("youtube") && cur !== "youtube") return adapt(t, "youtube", idx);
          return t;
        });
      }
    }
    return out;
  }

  function homeCatalogPool() {
    const h = state.home || {};
    const pool = [];
    for (const s of (h.shelves || [])) {
      if (s && Array.isArray(s.tracks)) pool.push(...s.tracks);
    }
    if (Array.isArray(h.youtubeLocal)) pool.push(...h.youtubeLocal);
    if (Array.isArray(h.youtubeCharts)) pool.push(...h.youtubeCharts);
    if (Array.isArray(state.tasteTracks)) pool.push(...state.tasteTracks);
    return pool;
  }

  function openShelfPlaylist(key) {
    const h = state.home || {};
    const fb = FALLBACK_SHELVES.find((s) => s.id === key);
    let title = "Songs";
    let tracks = [];
    let query = "";
    let shelfId = "";
    if (key === "local") {
      title = `Top songs in ${countryName(h.country || state.prefs.country)}`;
      tracks = h.youtubeLocal && h.youtubeLocal.length ? h.youtubeLocal : (h.youtubeIndia || []);
      query = h.localQuery || "top hits official audio";
      shelfId = "local";
    } else if (key === "taste" || key === "following") {
      title = "Picked for your taste & artists you follow";
      const countryCode = String((state.prefs && state.prefs.country) || "US").toUpperCase();
      const prefGenres = Array.isArray(state.prefs.tasteGenres) ? state.prefs.tasteGenres : [];
      const allowIndian =
        countryCode === "IN" ||
        countryCode === "PK" ||
        countryCode === "BD" ||
        prefGenres.some((g) => /bollywood|punjabi|tamil|telugu|indie_in/i.test(g));
      tracks = weaveDiverseTracks(
        [state.tasteTracks || [], state.followedArtistTracks || []],
        40,
        2,
        countryCode,
        allowIndian
      );
      if (!tracks.length) tracks = [...(state.tasteTracks || []), ...(state.followedArtistTracks || [])];
      shelfId = "taste";
    } else if (key === "audius") {
      title = "Independent artists";
      tracks = h.audius || [];
    } else if (key === "underground") {
      title = "Underground";
      tracks = h.underground || [];
    } else if (key === "radio") {
      title = "Live radio";
      tracks = h.radio || [];
    } else {
      const shelf = (h.shelves || []).find((s) => String(s.id) === String(key) || String(s.title) === String(key)) || fb;
      if (shelf) {
        title = shelf.title || (fb && fb.title) || "Playlist";
        tracks = shelf.tracks || [];
        query = shelf.query || (fb && fb.query) || "";
        shelfId = shelf.id || (fb && fb.id) || key;
      }
    }
    const mixedInitial = (key === "audius" || key === "radio")
      ? tracks.slice()
      : mixThreeSourcesClient(tracks.slice(), homeCatalogPool(), Math.max(tracks.length, 25));
    openCatalogPlaylist({
      title,
      tracks: mixedInitial,
      artwork: (mixedInitial[0] && mixedInitial[0].artwork) || (tracks[0] && tracks[0].artwork),
      artist: "Muchi",
      query,
      shelfId,
    });
  }

  // Vertical playlist/shelf lists should show single songs, not 1–2 hour
  // combined videos. Never leave a playlist starving: if fewer than 3 real
  // songs survive the filter, keep the original list.
  function cleanPlaylistTracks(list) {
    if (!Array.isArray(list) || list.length < 2) return list;
    const good = list.filter((t) => t && looksLikeSong(t));
    return good.length >= 3 ? good : list;
  }

  // "Made for you" rows must stay English-only. YouTube/regional search leaks
  // Hindi (Devanagari) and other non-English songs into the cards even when
  // the query is English — this mirrors the server's isEnglishTrack so the
  // cards and the opened playlist both stay English. Returns true when a track
  // looks English (non-Latin script or a listed regional hint = not English).
  const CLIENT_NON_LATIN = /[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F\u0D00-\u0D7F\u0980-\u09FF\u0A80-\u0AFF\u0A00-\u0A7F\u0E00-\u0E7F\u0590-\u05FF\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u1E00-\u1EFF]/;
  const CLIENT_REGIONAL_HINTS = /\b(bollywood|tollywood|kollywood|tamil|telegu|telugu|malayalam|kannada|maharashtra|desi|marathi|sinhala|thai|punjab|hindi|haryanvi|bhojpuri|garhwali|kumaoni|angrezi|bengali|odia|assamese|punjabi|arijit|atif aslam|shreya ghoshal|neha kakkar|sunidhi|nusrat|rabba|sonu nigam|kishore|dilbar|kesariya|channa mereya|humma humma|lut geya|tum hi ho|ae dil hai|despacito|calma|bailando|macarena|corazon|gangnam style|imran khan|neha|york|t-series)\b/i;
  function isEnglishTrack(t) {
    if (!t) return false;
    const text = `${t.title || ""} ${t.artist || ""} ${t.album || ""}`;
    return !(CLIENT_NON_LATIN.test(text) || CLIENT_REGIONAL_HINTS.test(text));
  }

  // Filter a "Made for you" track list down to English songs. Never starve the
  // card: if fewer than 3 English songs survive, keep the original list so the
  // row stays populated (same "never starve" rule as everywhere else).
  function englishOnlyTracks(list) {
    if (!Array.isArray(list) || !list.length) return list;
    const good = list.filter((t) => t && isEnglishTrack(t));
    return good.length >= 3 ? good : list;
  }

  // Home rows prefer real songs (Spotify-style), but a degraded provider must
  // never leave a Home row empty: if fewer than 3 songs survive the junk
  // filter, keep the best available rows (same "never starve" rule as
  // vertical playlists). Playback itself still filters via looksLikeSong.
  function keepBestTracks(a) {
    if (!Array.isArray(a)) return a;
    const good = a.filter((t) => t && looksLikeSong(t));
    return good.length >= 3 ? good : a;
  }

  function isCountryTrendPlId(id) {
    const s = String(id || "");
    return s.startsWith("ctrend:") || s.startsWith("ctrend-");
  }

  async function openCatalogPlaylist(meta, opts) {
    if (!meta) return;
    // refill=true: re-fetch for a catalog view that is ALREADY current
    // (e.g. restored from history whose data was lost) — no nav push, no
    // view change, the caller has already painted the loading state.
    const refill = !!(opts && opts.refill);
    if (!refill) rememberScroll();
    healPlaylistCoversClient(meta);
    const rawPreview = cleanPlaylistTracks(Array.isArray(meta.tracks) ? meta.tracks.slice() : []);
    const playlistId = meta.playlistId || "";
    const fallbackQ = meta.query || meta.title || "";
    const isCountryTrendPl = isCountryTrendPlId(meta.id || meta.shelfId || "");
    const shelfId = meta.shelfId || (isCountryTrendPl ? meta.id : "") || "";
    const forYouMix = !!meta.forYouMix;
    const fyIndex = meta.fyIndex != null ? Number(meta.fyIndex) : null;
    const fyMood = String(meta.fyMood || (fyIndex != null && forYouPlaylistList()[fyIndex] ? forYouPlaylistList()[fyIndex].mood : "") || "");
    const preview = (shelfId === "audius" || shelfId === "radio" || !rawPreview.length)
      ? rawPreview
      : (fyIndex != null
          ? personalizeForYouCardTracks({ mood: fyMood, tracks: rawPreview }, null)
          : mixThreeSourcesClient(rawPreview, isCountryTrendPl ? [] : homeCatalogPool(), rawPreview.length));
    for (const tr of preview) healTrackCoverClient(tr);
    const needFill = (isCountryTrendPl && preview.length >= 15)
      ? false
      : !!(forYouMix || fyIndex != null || shelfId || playlistId || fallbackQ);
    state.catalogPlaylist = {
      title: meta.title || "Playlist",
      artist: meta.subtitle || meta.artist || "",
      artwork: (isCountryTrendPl && preview[0] && preview[0].artwork)
        ? preview[0].artwork
        : (meta.artwork || (preview[0] && preview[0].artwork) || ""),
      playlistId,
      query: fallbackQ,
      shelfId,
      tracks: preview,
      loading: needFill,
    };
    hydrateMissingTrackCovers(preview, () => {
      if (state.view === "library" && state.activePlaylist === "catalog") render();
    });
    // Small, JSON-safe meta so a history restore can re-fetch this exact
    // playlist if the in-memory data was ever lost.
    state.catalogMeta = {
      title: meta.title || "Playlist",
      playlistId,
      query: fallbackQ,
      shelfId,
      forYouMix,
      fyMood,
      fyIndex,
    };
    if (!refill) {
      const originView = (state.view === "library" && state.activePlaylist != null)
        ? (state.playlistFrom || state.prevView || "home")
        : (state.view || "home");
      state.playlistFrom = originView;
      state.prevView = originView;
      state.view = "library";
      state.activePlaylist = "catalog";
      navPush();
      paintNav(false);
    }
    if (!needFill) {
      if (state.catalogPlaylist) state.catalogPlaylist.loading = false;
      return;
    }
    let got = [];
    let shelfTitle = "";
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // 0) Taste-driven mix or "Made for you" mood playlist — fetch from /api/for-you.
    if (forYouMix || fyIndex != null) {
      const moodParam = fyMood ? `&mood=${encodeURIComponent(fyMood)}` : "";
      const fetchMix = async () => {
        const data = await api(`/api/for-you?${forYouQs()}${moodParam}&${glq()}`, 25000);
        if (fyMood && data && Array.isArray(data.playlists)) {
          const matched = data.playlists.find((pl) => pl && pl.mood === fyMood);
          if (matched && Array.isArray(matched.tracks) && matched.tracks.length) return matched.tracks;
        }
        if (fyMood && (!data || !Array.isArray(data.playlists))) return [];
        return (data && data.tracks) || [];
      };
      try { got = await fetchMix(); } catch {}
      if (!got.length && preview.length) {
        got = preview.slice();
      }
      if (!got.length) {
        try { await wait(1200); got = await fetchMix(); } catch {}
      }
    }
    if (!forYouMix && fyIndex == null && (shelfId || (fallbackQ && !playlistId))) {
      const q = fallbackQ || "";
      const countryGl = encodeURIComponent((state.home && state.home.country) || state.prefs.country || "US");
      const fetchShelf = async (full, timeoutMs) => {
        const data = await api(
          `/api/shelf?id=${encodeURIComponent(shelfId)}&q=${encodeURIComponent(q)}&full=${full ? "1" : "0"}&gl=${countryGl}`,
          timeoutMs
        );
        if (data && data.title && !meta.title) shelfTitle = data.title;
        return (data && data.tracks) || [];
      };
      // 1) Full catalog (up to 100). Long timeout + one retry: the API may be
      //    cold-starting (free tier) or providers may hiccup.
      try { got = await fetchShelf(true, 35000); } catch {}
      if (!got.length) {
        try { await new Promise((r) => setTimeout(r, 1200)); got = await fetchShelf(true, 35000); } catch {}
      }
      // 2) If the heavy search still failed, fall back to the fast row fetch so
      //    the catalog is never left empty.
      if (!got.length) {
        try { got = await fetchShelf(false, 15000); } catch {}
      }
      if (shelfTitle && state.catalogPlaylist) state.catalogPlaylist.title = shelfTitle;
    }
    if (!got.length && playlistId) {
      try {
        const qParam = fallbackQ ? `&q=${encodeURIComponent(fallbackQ)}` : "";
        const data = await api(`/api/yt/playlist?id=${encodeURIComponent(playlistId)}${qParam}&${glq()}`, 18000);
        got = data.tracks || [];
      } catch {}
      // Server couldn't fill it (e.g. preview sandbox has no YouTube egress) —
      // fetch the playlist directly from the browser via Piped.
      if (!got.length) {
        try { got = await browserPlaylistTracks(playlistId); } catch {}
      }
    }
    // "Made for you" real-playlist cards without a resolved id yet: resolve the
    // playlist in the browser (works even when the server is old/unreachable).
    if (!got.length && !forYouMix && !playlistId && fallbackQ && API_BASE) {
      try {
        const r = await browserResolvePlaylist(fallbackQ);
        got = await browserPlaylistTracks(r.playlistId);
      } catch {}
    }
    if (!got.length && fallbackQ && !forYouMix) {
      try {
        const data = await api(`/api/search?q=${encodeURIComponent(fallbackQ)}&${glq()}`, 18000);
        got = [].concat(data.youtube || [], data.apple || [], data.deezer || [], data.audius || []);
      } catch {}
    }
    // If `got` only has YouTube tracks (e.g., from Piped or a raw YouTube playlist),
    // enrich with iTunes + Deezer tracks via /api/search or preview/home pool so
    // every opened playlist mixes all 3 APIs (YouTube, iTunes, Deezer).
    if (got.length && shelfId !== "audius" && shelfId !== "radio") {
      const hasItunes = got.some((t) => t && (t.source === "apple" || t.source === "itunes"));
      const hasDeezer = got.some((t) => t && t.source === "deezer");
      if ((!hasItunes || !hasDeezer) && fallbackQ) {
        try {
          const cleanQ = String(fallbackQ).replace(/\bofficial audio\b/ig, "").trim();
          const sData = await api(`/api/search?q=${encodeURIComponent(cleanQ)}&${glq()}`, 10000);
          if (sData) {
            got = mixThreeSourcesClient(
              got,
              [...(sData.apple || sData.itunes || []), ...(sData.deezer || []), ...preview],
              Math.max(got.length, 25)
            );
          }
        } catch {}
      }
      const fallbackMixPool = fyIndex != null ? preview : [...preview, ...homeCatalogPool()];
      got = mixThreeSourcesClient(got, fallbackMixPool, Math.max(got.length, preview.length, 20));
    }
    if (state.activePlaylist !== "catalog" || !state.catalogPlaylist) return;
    if (got.length) {
      // "Made for you" rows stay English-only: filter out Hindi/regional songs
      // that slip in from the playlist/YouTube search (the reported bug).
      const filtered = (fyIndex != null || forYouMix) ? englishOnlyTracks(got) : got;
      const cleaned = cleanPlaylistTracks(filtered);
      const tracks = (shelfId === "audius" || shelfId === "radio")
        ? cleaned
        : (fyIndex != null
            ? personalizeForYouCardTracks({ mood: fyMood, tracks: [...cleaned, ...preview] }, null)
            : mixThreeSourcesClient(cleaned, [...preview, ...homeCatalogPool()], Math.max(cleaned.length, 20)));
      state.catalogPlaylist.tracks = tracks;
      if (!state.catalogPlaylist.artwork && tracks[0]) state.catalogPlaylist.artwork = tracks[0].artwork;
      hydrateMissingTrackCovers(tracks, () => {
        if (state.view === "library" && state.activePlaylist === "catalog") render();
      });
      // "Made for you" card covers follow the first song inside the playlist.
      if (fyIndex != null) {
        const card = forYouPlaylistList()[fyIndex];
        if (card) {
          if (tracks[0] && tracks[0].artwork) card.artwork = tracks[0].artwork;
          if (playlistId && !card.playlistId) card.playlistId = playlistId;
          if (card.query) {
            const cache = fyCardCache();
            cache[card.query] = { id: card.playlistId || "", art: (tracks[0] && tracks[0].artwork) || card.artwork, at: Date.now() };
            fyCardCacheSave(cache);
          }
        }
      }
    }
    state.catalogPlaylist.loading = false;
    render();
    if (!state.catalogPlaylist.tracks.length) toast("Couldn't open that playlist", true, "error");
  }

  const FALLBACK_SHELVES = [
    { id: "today", title: "Today's Top Hits", query: "billboard hot 100 official audio" },
    { id: "pop", title: "Pop", query: "english pop hits official audio" },
    { id: "hiphop", title: "Hip-Hop", query: "hip hop rap hits official audio" },
    { id: "rnb", title: "R&B", query: "rnb soul hits official audio" },
    { id: "rock", title: "Rock", query: "rock hits official audio" },
    { id: "dance", title: "Dance & Electronic", query: "edm dance hits official audio" },
    { id: "indie", title: "Indie", query: "indie pop alternative official audio" },
  ];

  const CLIENT_COUNTRY_SHELF_QUERIES = {
    IN: {
      today: "india top 50 bollywood hindi hits official audio",
      pop: "indian pop hindi hits official audio",
      hiphop: "desi hip hop indian rap hits official audio",
      rnb: "indian rnb chill hindi songs official audio",
      rock: "indian rock bands hindi rock songs official audio",
      dance: "bollywood dance party hits official audio",
      indie: "indian indie songs hindi indie pop official audio",
    },
    PK: {
      today: "pakistan top hits new songs official audio",
      pop: "pakistani pop songs coke studio official audio",
      hiphop: "urdu rap pakistani hip hop official audio",
      rnb: "pakistani rnb chill songs official audio",
      rock: "pakistani rock bands songs official audio",
      dance: "pakistani dance party hits official audio",
      indie: "pakistani indie alternative songs official audio",
    },
    BD: {
      today: "bangla top hits new songs official audio",
      pop: "bangla pop hits official audio",
      hiphop: "bangla hip hop rap songs official audio",
      rnb: "bangla romantic rnb songs official audio",
      rock: "bangla rock bands warfaze artcell songs official",
      dance: "bangla dance party songs official audio",
      indie: "bangla indie songs coke studio bangla official",
    },
    PH: {
      today: "opm top hits philippines chart official audio",
      pop: "opm pop hits philippines bini zack tabudlo official audio",
      hiphop: "pinoy hip hop rap flow g hev abi official audio",
      rnb: "opm rnb soul arthur nery denise julia official audio",
      rock: "pinoy rock opm bands eraserheads iv of spades cup of joe official",
      dance: "opm dance pop philippines hits official audio",
      indie: "pinoy indie opm alternative ben&ben lola amour official audio",
    },
    HK: {
      today: "hong kong cantopop top hits official audio",
      pop: "cantopop hong kong pop hits eason chan hins cheung mirror official",
      hiphop: "hong kong cantonese hip hop rap official audio",
      rnb: "hong kong cantopop rnb soul gareth t terence lam official",
      rock: "hong kong rock band beyond dear jane supper moment rubberband official",
      dance: "hong kong cantopop dance electronic hits official",
      indie: "hong kong indie cantopop serrini moon tang my little airport official",
    },
    CN: {
      today: "mandopop china top hits official audio",
      pop: "mandopop chinese pop hits jay chou jj lin official",
      hiphop: "chinese rap c-rap hip hop hits official",
      rnb: "chinese rnb soul mandopop official audio",
      rock: "chinese rock bands mayday omnipotent youth society official",
      dance: "chinese electronic dance music hits official",
      indie: "chinese indie folk pop songs official audio",
    },
    KR: {
      today: "kpop top hits korea chart official audio",
      pop: "kpop hits newjeans bts blackpink aespa official audio",
      hiphop: "khiphop korean rap hits jay park zico official audio",
      rnb: "krnb korean rnb soul dean crush bibi official audio",
      rock: "korean rock band day6 wave to earth jannabi official audio",
      dance: "kpop dance electronic hits official audio",
      indie: "korean indie k-indie hyukoh wave to earth 10cm official audio",
    },
    JP: {
      today: "billboard japan hot 100 jpop hits official",
      pop: "jpop top hits yoasobi fujii kaze kenshi yonezu official",
      hiphop: "japanese hip hop rap creepy nuts bad hop official",
      rnb: "japanese rnb city pop fujii kaze official",
      rock: "jrock japanese rock bands king gnu mrs green apple one ok rock official",
      dance: "japanese electronic dance pop perfume capsule official",
      indie: "japanese indie rock vaundy lamp hitsujibungaku official",
    },
    TH: {
      today: "thai top hits tpop new songs official",
      pop: "tpop thai pop hits jeff satur bowkylion billkin official",
      hiphop: "thai hip hop rap milli youngohm official",
      rnb: "thai rnb soul songs jeff satur official",
      rock: "thai rock bands three man down tilly birds bodyslam official",
      dance: "thai dance pop hits official",
      indie: "thai indie popfellows dept anatomy rabbit official",
    },
    VN: {
      today: "vpop top hits vietnam new songs official",
      pop: "vpop hits son tung mtp mono ame official",
      hiphop: "rap viet hip hop den vau hieuthuhai tlinh official",
      rnb: "vpop rnb chill wren evans vu official",
      rock: "vietnam rock bands chillies ngọt cá hồi hoang official",
      dance: "vpop dance edm remix hits official",
      indie: "viet indie vu chillies trang official",
    },
    ID: {
      today: "indonesia top hits lagu viral official",
      pop: "lagu pop indonesia tulus mahalini lyodra bernadya official",
      hiphop: "hip hop rap indonesia rich brian ramengvrl official",
      rnb: "rnb soul indonesia tulus raisa teddy adhitya official",
      rock: "band rock indonesia dewa 19 sheila on 7 noah official",
      dance: "indonesia electronic dance weird genius official",
      indie: "indie indonesia hindia feast pamungkas nadin amizah official",
    },
    MY: {
      today: "malaysia top hits lagu baru official",
      pop: "malaysia pop hits siti nurhaliza ernie zakri dolla official",
      hiphop: "malaysia hip hop rap joe flizzow sova official",
      rnb: "malaysia rnb yuna aisha retno official",
      rock: "malaysia rock bands wings search bunkface insomniacks official",
      dance: "malaysia dance pop hits official",
      indie: "malaysia indie hujan kugiran masdo noh salleh official",
    },
    SG: {
      today: "singapore top hits official audio",
      pop: "singapore pop hits jj lin stefanie sun benjamin kheng official",
      hiphop: "singapore hip hop rap shigga shay official",
      rnb: "singapore rnb soul gentle bones seint official",
      rock: "singapore rock bands electrico caracal official",
      dance: "singapore dance electronic hits official",
      indie: "singapore indie linying subsonic eye pleasantry official",
    },
    NG: {
      today: "afrobeats top hits nigeria official audio",
      pop: "afrobeats pop hits burna boy wizkid rema ayra starr official",
      hiphop: "nigerian hip hop rap odumodublvck olamide phyno official",
      rnb: "afro rnb soul tems omah lay chike official",
      rock: "african rock alternative songs official",
      dance: "afrobeats dance club hits asake davido official",
      indie: "alte nigerian indie cruell santino lady donli cavemen official",
    },
    ZA: {
      today: "south africa amapiano top hits official",
      pop: "south africa pop hits tyla jeremy loops official",
      hiphop: "south african hip hop nasty c a-reece cassper nyovest official",
      rnb: "south africa rnb soul elaine lloydgoy official",
      rock: "south african rock seether prime circle Kongos official",
      dance: "amapiano dance hits kabza de small uncle waffles kelvin momo official",
      indie: "south africa indie alternative desmond and the tutus shortstraw official",
    },
    BR: {
      today: "top brasil hits novas musicas oficiais",
      pop: "pop brasil hits anitta ludmilla luisa sonza jao official",
      hiphop: "trap rap nacional brasil matue filipe ret orochi official",
      rnb: "rnb brasil iza liniker gloria groove official",
      rock: "rock nacional brasil charlie brown jr legiao urbana skank pita",
      dance: "brazilian bass dance alok vintage culture funk brasil official",
      indie: "indie brasil mpba lagum terno rei jovm dionisio official",
    },
    MX: {
      today: "mexico top hits musica nueva oficial",
      pop: "latin pop mexico belinda Reik camila natalia lafourcade official",
      hiphop: "rap hip hop mexicano santa fe klan aleman gera mx official",
      rnb: "rnb latino humbe girl ultra jesse baez official",
      rock: "rock en espanol mexico caifanes zoe mana cafe tacvba official",
      dance: "reggaeton latin dance hits mexico official",
      indie: "indie mexico kevin kaarl ed maverick siddhartha bratty official",
    },
    ES: {
      today: "top 50 espana exitos nuevos oficial",
      pop: "pop espanol aitana rosalia lola indigo pablo alboran official",
      hiphop: "rap trap espana quevedo dels Rels B morad c tangana official",
      rnb: "rnb espanol rels b sen senra maikel delacalle official",
      rock: "rock espanol vetusta morla izal fito cabrales extremoduro",
      dance: "latin dance reggaeton espana hits official",
      indie: "indie espanol vetusta morla arde bogota lori meyers viva suecia",
    },
    FR: {
      today: "top singles france hits officiels",
      pop: "variete pop francaise angele aya nakamura clara luciani stromae",
      hiphop: "rap francais jul ninho gazo tiakola booba pnl official",
      rnb: "rnb francais dadju tayc monsieur nov ronisia official",
      rock: "rock francais indochine shaka ponk telephone noir desir",
      dance: "french touch electro dance daft punk david guetta dj snake",
      indie: "indie pop francaise phoenix air l'imperatrice videoclub",
    },
    DE: {
      today: "offizielle deutsche charts hits official",
      pop: "deutschpop nina chuba apache 207 lea mark forster official",
      hiphop: "deutschrap apache 207 luciano bonez mc raf camora pashanim",
      rnb: "german rnb soul joy denalane cro aylo official",
      rock: "german rock rammstein die toten hosen kraftklub annenmaykantereit",
      dance: "german electronic dance robin schulz felix jaehn purple disco machine",
      indie: "german indie annenmaykantereit giant rooks milky chance jeremias",
    },
    IT: {
      today: "classifica singoli italia nuove canzoni",
      pop: "pop italiano annalisa marco mengoni elodie mahmood tiziano ferro",
      hiphop: "rap trap italiano geolier lazza sfera ebbasta guè marracash",
      rnb: "rnb italiano mahmood venerus frah quintale official",
      rock: "rock italiano maneskin pinguini tattici nucleari vasco rossi ligabue",
      dance: "italo dance electronic meduza gabry ponte bob sinclar",
      indie: "indie italiano calcutta gazzelle psicologi ariete fulminacci",
    },
    TR: {
      today: "turkce pop yeni cikanlar hits official",
      pop: "turkce pop hits tarkan sezen aksu simge edis mabel matiz",
      hiphop: "turkce rap hip hop ezhel cezza sago lvbel c5 uzu",
      rnb: "turkce rnb alternatif mert demir melike sahin Emir can igrek",
      rock: "turkce rock duman mor ve otesi manga teoman sebnem ferah",
      dance: "turkce dance club hits mahmut orhan burak yeter",
      indie: "turkce indie alternatif adamlar buyuk ev ablukada dktt",
    },
    AE: {
      today: "arabic top hits 2025 new songs official",
      pop: "arabic pop hits amr diab nancy ajram elissa tamer hosny",
      hiphop: "arabic hip hop rap wegz marwan pablo afroto dafencii",
      rnb: "arabic chill rnb saint levant elyanna dana salah",
      rock: "arabic rock indie cairokee mashrou leila jadal",
      dance: "arabic dance party hits saad lamjarred mohamed ramadan",
      indie: "arabic indie alternative cairokee Aziz maraka massar egbari",
    },
    SA: {
      today: "khaleeji new hits saudi top songs official",
      pop: "khaleeji pop hits abdul majeed abdullah majid al mohandis assala",
      hiphop: "saudi arabic hip hop dafencii klash wegz official",
      rnb: "arabic rnb chill songs official audio",
      rock: "arabic rock indie cairokee jadal official",
      dance: "khaleeji dance party hits official",
      indie: "arabic indie alternative aziz maraka cairokee",
    },
    EG: {
      today: "egypt top hits aghani gadida official",
      pop: "egyptian pop hits amr diab tamer hosny sherine hamaki",
      hiphop: "egyptian rap trap mahraganat wegz marwan pablo afroto",
      rnb: "egyptian chill rnb songs official",
      rock: "egyptian rock indie cairokee massar egbari sharmoofers",
      dance: "mahraganat egyptian party hits mohamed ramadan hassan shakosh",
      indie: "egyptian indie cairokee massar egbari disco misr",
    },
    GB: {
      today: "official uk top 40 singles chart hits",
      pop: "uk pop hits dua lipa ed sheeran harry styles raye charli xcx",
      hiphop: "uk drill grime rap central cee dave stormzy skepta",
      rnb: "uk rnb soul raye jorja smith cleo sol mahalia",
      rock: "uk rock bands arctic monkeys oasis coldplay muse the 1975",
      dance: "uk dance house garage calvin harris Fred again disclosure",
      indie: "uk indie rock the 1975 sam fender wolf alice beabadoobee",
    },
    AU: {
      today: "aria charts australia top hits official",
      pop: "australian pop hits troye sivan the kid laroi sia kylie minogue",
      hiphop: "australian hip hop the kid laroi hilltop hoods onefour",
      rnb: "australian rnb ruel tkay maidza jordan rakei",
      rock: "australian rock tame impala acdc gang of youths powderfinger",
      dance: "australian electronic dance rufus du sol flume dom dolla fisher",
      indie: "australian indie spacey jane vance joy royel otis ocean alley",
    },
    NZ: {
      today: "new zealand top 40 hits official",
      pop: "new zealand pop hits lorde benee Kimbra",
      hiphop: "new zealand hip hop savage scribe",
      rnb: "new zealand rnb soul six60 l.a.b stan walker",
      rock: "new zealand rock crowded house six60 the naked and famous",
      dance: "new zealand electronic dance shapeshifter netsky",
      indie: "new zealand indie the beths unknown mortal orchestra fazerdaze",
    },
    CA: {
      today: "canada top hits billboard canadian hot 100",
      pop: "canadian pop hits the weeknd justin bieber tate mcrae shawn mendes",
      hiphop: "canadian hip hop drake nav tory lanez",
      rnb: "canadian rnb soul the weeknd daniel caesar partynextdoor",
      rock: "canadian rock nickelback sum 41 billy talent the tragically hip",
      dance: "canadian electronic deadmau5 kaytranada loud luxury rezz",
      indie: "canadian indie arcade fire alvvays men i trust mac demarco",
    },
    NL: {
      today: "nederlandse top 40 hits official",
      pop: "dutch pop hits roxy dekker flemming suzan & freek davina michelle",
      hiphop: "dutch hip hop boef lil kleine frenna josylvio",
      rnb: "dutch rnb soul rimon joya moo",
      rock: "dutch rock kensington within temptation golden earring",
      dance: "dutch edm dance martin garrix tiesto armin van buuren hardwell",
      indie: "dutch indie pip blom eut son mieux",
    },
    SE: {
      today: "sverigetopplistan sweden top hits official",
      pop: "swedish pop hits zara larsson tove lo robyn benjamin ingrosso",
      hiphop: "swedish hip hop einar hov1 c.gambino",
      rnb: "swedish rnb snoh aalegra cherrie seinabo sey",
      rock: "swedish rock ghost the hives kent mando diao",
      dance: "swedish house mafia avicii alesso galantis",
      indie: "swedish indie lykke li peter bjorn and john viagra boys",
    },
  };

  function shelfQueryForCountryClient(id, gl, fallbackQuery = "") {
    const code = String(gl || (state.prefs && state.prefs.country) || "US").toUpperCase();
    const byCountry = CLIENT_COUNTRY_SHELF_QUERIES[code];
    if (byCountry && byCountry[id]) return byCountry[id];
    const fb = FALLBACK_SHELVES.find((s) => s.id === id);
    return (fb && fb.query) || fallbackQuery || "top hits official audio";
  }

  function isUnwantedIndianTrackClient(t, gl) {
    const code = String(gl || (state.prefs && state.prefs.country) || "US").toUpperCase();
    if (!t || code === "IN" || code === "PK" || code === "BD") return false;
    const s = `${t.title || ""} ${t.artist || ""} ${t.album || ""}`;
    if (/[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0B80-\u0BFF\u0C00-\u0C7F\u0D00-\u0D7F]/.test(s)) return true;
    if (/\b(bollywood|hindi|punjabi|bhojpuri|haryanvi|kollywood|tollywood|malayalam|kannada|marathi|gujarati|assamese|odia|arijit\s+singh|shreya\s+ghoshal|jubin\s+nautiyal|t-series|zee\s*music|yash\s*raj|saregama|sony\s*music\s*india|tips\s*official|speed\s*records|desi\s*melodies|pritam|vishal\s+mishra|vishal[\s-]*shekhar|tanishk\s+bagchi|amit\s+trivedi|a\.?\s*r\.?\s*rahman|diljit\s+dosanjh|karan\s+aujla|sidhu\s+moose|ap\s+dhillon|gurinder\s+gill|badshah|yo\s+yo\s+honey\s+singh|neha\s+kakkar|tony\s+kakkar|sonu\s+nigam|atif\s+aslam|kumar\s+sanu|udit\s+narayan|alka\s+yagnik|kk\b|mohit\s+chauhan|anuv\s+jain|prateek\s+kuhad|the\s+local\s+train|local\s+train|aditya\s+rikhari|mitraz|ritviz|zaeden|sanam\b|lucky\s+ali|kailash\s+kher|shankar\s+mahadevan|shaan\b|sunidhi\s+chauhan|darshan\s+raval|armaan\s+malik|asees\s+kaur|b\s+praak|jaani\b|guru\s+randhawa|hardy\s+sandhu|harrdy\s+sandhu|divine\b|kr\$na|seedhe\s+maut|raftaar|emiway|mc\s+stan|talha\s+anjum|talhah\s+yunus|young\s+stunners|hasan\s+raheem|abdul\s+hannan|ali\s+zafar|rahat\s+fateh|nusrat\s+fateh|coke\s+studio|nadaan\s+parindey|sadda\s+haq|choo\s+lo|baarishein|alag\s+aasmaan|kesariya|tum\s+hi\s+ho|channa\s+mereya|kabira|ilahi|agar\s+tum\s+saath|apna\s+bana\s+le|chaleya|satranga|heeriye|husn\b|bulleya|bekhayali|shayad\b|khairiyat|tera\s+ban\s+jaunga|raataan\s+lambiyan|pasoori)\b/i.test(s)) {
      return true;
    }
    return false;
  }

  let homeFetchedAt = 0;
  let homeRetries = 0;
  let homeRetryT = null;
  function detectCountry() {
    if (state.prefs.countryChosen) return false;
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || "").trim();
    const lang = String(navigator.language || navigator.userLanguage || "").toLowerCase();
    const TZ = {
      "Asia/Kolkata":"IN","Asia/Calcutta":"IN","America/New_York":"US","America/Chicago":"US",
      "America/Denver":"US","America/Los_Angeles":"US","America/Phoenix":"US","America/Anchorage":"US",
      "Pacific/Honolulu":"US","America/Toronto":"CA","America/Vancouver":"CA","Europe/London":"GB",
      "Australia/Sydney":"AU","Australia/Melbourne":"AU","Europe/Berlin":"DE","Europe/Paris":"FR",
      "Asia/Tokyo":"JP","Asia/Seoul":"KR","America/Sao_Paulo":"BR","America/Mexico_City":"MX",
      "Africa/Lagos":"NG","Africa/Johannesburg":"ZA","Asia/Dubai":"AE","Asia/Riyadh":"SA",
      "Asia/Karachi":"PK","Asia/Dhaka":"BD","Asia/Jakarta":"ID","Asia/Kuala_Lumpur":"MY",
      "Asia/Singapore":"SG","Asia/Manila":"PH","Asia/Bangkok":"TH","Asia/Ho_Chi_Minh":"VN",
      "Africa/Cairo":"EG","Europe/Rome":"IT","Europe/Madrid":"ES","Europe/Istanbul":"TR",
      "Pacific/Auckland":"NZ","Europe/Amsterdam":"NL","Europe/Stockholm":"SE",
      "Asia/Hong_Kong":"HK","Asia/Shanghai":"CN","Asia/Chongqing":"CN","Asia/Harbin":"CN",
    };
    let code = TZ[tz] || "";
    if (!code && lang.includes("-")) {
      const r = lang.split("-").pop().toUpperCase();
      if (r === "UK") code = "GB";
      else if (COUNTRIES.some((c) => c[0] === r)) code = r;
    }
    if (!code) return false;
    if (state.prefs.country === code) {
      state.prefs.countryChosen = "auto";
      savePrefs();
      return false;
    }
    state.prefs.country = code;
    state.prefs.countryChosen = "auto";
    savePrefs();
    return true;
  }

  // IP-based country is how the big music/video apps pick your catalog, and it
  // is far more reliable than a timezone/language guess (e.g. a traveller on an
  // Indian account in the US). This fires /api/geo once at boot and, if the
  // server reports a valid country and the user hasn't picked one manually,
  // re-points the catalog at that country and refreshes Home. Never overrides a
  // manual choice (countryChosen === true).
  async function autoDetectCountry() {
    if (state.prefs.countryChosen === true) return;
    let geo = null;
    try { geo = await api("/api/geo", 6000); } catch { geo = null; }
    if (!geo || !/^[A-Z]{2}$/.test(geo.country || "")) return;
    const code = geo.country;
    if (state.prefs.country === code) {
      if (state.prefs.countryChosen !== "auto") {
        state.prefs.countryChosen = "auto";
        savePrefs();
      }
      return;
    }
    const prev = state.prefs.country || "";
    state.prefs.country = code;
    state.prefs.countryChosen = "auto";
    savePrefs();
    try { localStorage.removeItem("aura.home_cache"); } catch {}
    state.home = null;
    homeFetchedAt = 0;
    if (typeof window.__refreshTasteOnboarding === "function") {
      try { window.__refreshTasteOnboarding(); } catch {}
    }
    if (state.view === "home") loadHome(true);
    else paintHomeSoon();
    loadTasteRecommendations(true);
    if (prev && prev !== code) toast(`Catalog set to ${countryName(code)}`, true);
  }

  function utcDayClient() {
    return new Date().toISOString().slice(0, 10);
  }

  function seedHome() {
    const code = state.prefs.country || "US";
    return {
      country: code,
      moods: [],
      day: utcDayClient(),
      shelves: FALLBACK_SHELVES.map((s) => ({
        ...s,
        query: shelfQueryForCountryClient(s.id, code, s.query),
        tracks: [],
      })),
      youtubeCharts: [],
      youtubeIndia: [],
      youtubeLocal: [],
      countryPlaylists: [],
      globalPlaylists: [],
      audius: [],
      underground: [],
      radio: [],
    };
  }

  function persistHomeCache() {
    try {
      if (state.home && Array.isArray(state.home.shelves) && state.home.shelves.some((s) => s.tracks && s.tracks.length)) {
        localStorage.setItem("aura.home_cache", JSON.stringify(state.home));
      }
    } catch {}
  }

  async function loadHome(force) {
    const targetCountry = state.prefs.country || "IN";
    if (!force && state.home && state.home.country === targetCountry && Date.now() - homeFetchedAt < 86400000 && state.home.day === utcDayClient()) {
      if (state.view === "home") render();
      return;
    }
    if (!state.home) {
      try {
        const cached = localStorage.getItem("aura.home_cache");
        if (cached) {
          const parsed = JSON.parse(cached);
          const hasStaleFyCovers = parsed && Array.isArray(parsed.forYouPlaylists) && parsed.forYouPlaylists.some((pl) =>
            Array.isArray(pl && pl.tracks) && pl.tracks.some((tr) => !tr || !tr.artwork || String(tr.artwork).startsWith("/cover"))
          );
          const hasStaleCountryPls = !parsed || !Array.isArray(parsed.countryPlaylists) || parsed.countryPlaylists.length !== 17 || !parsed.countryPlaylists.every((pl) => pl && String(pl.id || "").startsWith("ctrend:"));
          if (!hasStaleFyCovers && !hasStaleCountryPls && parsed && parsed.country === targetCountry && Array.isArray(parsed.shelves) && parsed.shelves.some((s) => s.tracks && s.tracks.length)) {
            if (Array.isArray(parsed.countryPlaylists)) {
              parsed.countryPlaylists.forEach((p) => healPlaylistCoversClient(p));
            }
            if (Array.isArray(parsed.forYouPlaylists)) {
              parsed.forYouPlaylists.forEach((p) => healPlaylistCoversClient(p));
            }
            state.home = parsed;
            if (state.view === "home") render();
          } else if (hasStaleFyCovers || hasStaleCountryPls) {
            localStorage.removeItem("aura.home_cache");
          }
        }
      } catch {}
    }
    if (API_BASE) {
      // Remote API mode (live preview): show connection state so it's obvious
      // whether the live API is answering.
      state.apiStatus = "connecting";
    }
    render();
    // Seed the Home shell immediately and start filling empty shelves in
    // PARALLEL with the full /api/home call. This is what makes the preview
    // feel alive: rows appear within seconds even when the aggregate endpoint
    // is slow (Worker cold start, provider latency) — no long dead skeleton
    // and no permanently empty rows.
    if (!state.home || state.home.country !== targetCountry) {
      state.home = seedHome();
      render();
    }
    hydrateShelves();
    try {
      // Remote APIs can take a while to wake from sleep — give them more room
      // than the same-origin default.
      const data = await api(`/api/home?${glq()}`, API_BASE ? 45000 : 25000);
      if (!data) throw new Error("empty home");
      state.apiStatus = "ok";
      // Keep shelves the background hydration already filled if the worker
      // returned them empty (provider degradation) — ONLY when country matches!
      const prev = state.home;
      if (prev && prev.country === data.country && Array.isArray(prev.shelves) && data.shelves && data.shelves.length) {
        const filled = {};
        prev.shelves.forEach((s) => { if (s.tracks && s.tracks.length) filled[s.id] = s.tracks; });
        data.shelves.forEach((s) => {
          if ((!s.tracks || !s.tracks.length) && filled[s.id]) s.tracks = filled[s.id];
        });
      }
      state.home = data;
      // Home rows list real songs (Spotify-style). If a provider is degraded
      // and fewer than 3 songs survive, keep the best available rows so a
      // Home row is never left empty (queue + vertical playlists share
      // looksLikeSong and stay strict).
      if (state.home) {
        const curCountry = state.home.country || targetCountry;
        if (Array.isArray(state.home.shelves)) {
          state.home.shelves = state.home.shelves.map((s) => {
            const best = keepBestTracks((s.tracks || []).filter((t) => !isUnwantedIndianTrackClient(t, curCountry)));
            return {
              ...s,
              query: shelfQueryForCountryClient(s.id, curCountry, s.query),
              tracks: best.length ? mixThreeSourcesClient(best, [], best.length) : best,
            };
          });
        }
        const bestLocal = keepBestTracks((state.home.youtubeLocal || []).filter((t) => !isUnwantedIndianTrackClient(t, curCountry)));
        state.home.youtubeLocal = bestLocal.length ? mixThreeSourcesClient(bestLocal, homeCatalogPool(), bestLocal.length) : bestLocal;
        const bestIndia = keepBestTracks((state.home.youtubeIndia || []).filter((t) => !isUnwantedIndianTrackClient(t, curCountry)));
        state.home.youtubeIndia = bestIndia.length ? mixThreeSourcesClient(bestIndia, homeCatalogPool(), bestIndia.length) : bestIndia;
        const bestCharts = keepBestTracks((state.home.youtubeCharts || []).filter((t) => !isUnwantedIndianTrackClient(t, curCountry)));
        state.home.youtubeCharts = bestCharts.length ? mixThreeSourcesClient(bestCharts, homeCatalogPool(), bestCharts.length) : bestCharts;
        if (Array.isArray(state.home.countryPlaylists)) {
          state.home.countryPlaylists = state.home.countryPlaylists.slice(0, 17).map((p) => {
            const trs = mixThreeSourcesClient(p.tracks || [], [], 20);
            const healed = healPlaylistCoversClient({
              ...p,
              tracks: trs,
            });
            hydrateMissingTrackCovers(healed.tracks, () => paintHomeSoon());
            return healed;
          });
        }
        if (Array.isArray(state.home.globalPlaylists)) {
          state.home.globalPlaylists = state.home.globalPlaylists.map((p) => ({
            ...p,
            tracks: mixThreeSourcesClient(p.tracks || [], state.home.youtubeCharts || [], 20),
          }));
        }
        if (Array.isArray(state.home.forYouPlaylists)) {
          state.home.forYouPlaylists = state.home.forYouPlaylists.map((p) => {
            const trs = mixThreeSourcesClient(p.tracks || [], [], 20);
            hydrateMissingTrackCovers(trs, () => paintHomeSoon());
            return {
              ...p,
              tracks: trs,
            };
          });
        }
        if (Array.isArray(state.home.viralPlaylists)) {
          state.home.viralPlaylists = state.home.viralPlaylists.map((p) => ({
            ...p,
            tracks: mixThreeSourcesClient(p.tracks || [], state.home.youtubeCharts || [], 20),
          }));
        }
        persistHomeCache();
      }
      homeRetries = 0;
      clearTimeout(homeRetryT);
    } catch (e) {
      state.apiStatus = "slow";
      if (!state.home) state.home = seedHome();
      if (homeRetries === 0) toast("Catalogs are slow — filling rows in the background.");
      // Auto-retry with backoff: a sleeping free-tier API can take ~30-60s to
      // wake, so keep trying until it answers instead of leaving an empty page.
      if (homeRetries < 4) {
        const delay = [8000, 15000, 30000, 45000][homeRetries] || 45000;
        homeRetries++;
        clearTimeout(homeRetryT);
        homeRetryT = setTimeout(() => loadHome(true), delay);
      }
    }
    if (!state.home.shelves || !state.home.shelves.length) {
      const curCountry = (state.home && state.home.country) || targetCountry;
      state.home.shelves = FALLBACK_SHELVES.map((s) => ({
        ...s,
        query: shelfQueryForCountryClient(s.id, curCountry, s.query),
        tracks: [],
      }));
    }
    homeFetchedAt = Date.now();
    persistHomeCache();
    loadForYou();
    loadTasteRecommendations();
    checkFollowReleases();
    if (state.view === "home") render();
    hydrateShelves();
    // Resolve real playlist IDs + first-song covers for the "Made for you"
    // cards directly from the browser (works against any server state).
    hydrateForYouCards();
  }

  let homePaintT = 0;
  function paintHomeSoon() {
    if (state.view !== "home" || document.hidden) return;
    clearTimeout(homePaintT);
    homePaintT = setTimeout(() => {
      if (state.view === "home" && !document.hidden) render();
      persistHomeCache();
    }, 160);
  }

  async function hydrateShelves() {
    const h = state.home;
    if (!h) return;
    const countryCode = String(h.country || state.prefs.country || "US").toUpperCase();
    const rows = h.shelves && h.shelves.length
      ? h.shelves
      : FALLBACK_SHELVES.map((s) => ({
          ...s,
          query: shelfQueryForCountryClient(s.id, countryCode, s.query),
          tracks: [],
        }));
    h.shelves = rows;
    await Promise.all(rows.map(async (s) => {
      if (s.tracks && s.tracks.length) return;
      const q = shelfQueryForCountryClient(s.id, countryCode, s.query || (FALLBACK_SHELVES.find((d) => d.id === s.id) || {}).query);
      if (!q) return;
      s.query = q;
      try {
        const data = await api(`/api/shelf?id=${encodeURIComponent(s.id || "")}&q=${encodeURIComponent(q)}&gl=${encodeURIComponent(countryCode)}`, 16000);
        const rawTracks = ((data && data.tracks) || []).filter((t) => !isUnwantedIndianTrackClient(t, countryCode));
        const tracks = rawTracks.length ? mixThreeSourcesClient(rawTracks, homeCatalogPool(), rawTracks.length) : rawTracks;
        s.tracks = tracks;
        if (!s.title && data.title) s.title = data.title;
        // /api/home may have resolved while this fetch was in flight and
        // swapped state.home — forward the rows into the CURRENT home so
        // nothing is dropped when the worker returned that shelf empty.
        if (state.home !== h && state.home && state.home.country === countryCode) {
          const cur = (state.home.shelves || []).find((x) => String(x.id) === String(s.id));
          if (cur && !(cur.tracks && cur.tracks.length) && tracks.length) {
            cur.tracks = tracks;
            if (!cur.title && data.title) cur.title = data.title;
          }
        }
        paintHomeSoon();
      } catch {}
    }));
    const cur = state.home || h;
    const localEmpty = !(cur.youtubeLocal && cur.youtubeLocal.length) && !(cur.youtubeIndia && cur.youtubeIndia.length);
    if (localEmpty) {
      try {
        const countryGl = encodeURIComponent((cur && cur.country) || state.prefs.country || "US");
        const q = (cur && cur.localQuery) || "top hits official audio";
        const data = await api(`/api/shelf?id=local&q=${encodeURIComponent(q)}&gl=${countryGl}`, 16000);
        const rawTracks = ((data && data.tracks) || []).filter((t) => !isUnwantedIndianTrackClient(t, countryCode));
        const tracks = rawTracks.length ? mixThreeSourcesClient(rawTracks, homeCatalogPool(), rawTracks.length) : rawTracks;
        if (tracks.length) {
          const target = state.home || cur;
          target.youtubeLocal = tracks;
          target.youtubeIndia = tracks;
          if (!target.countryPlaylists || !target.countryPlaylists.length) {
            target.countryPlaylists = [
              "Top 50", "New Music Friday", "Viral 50", "Pop Rising",
              "Hip-Hop & Rap", "Cinema & Soundtracks", "Regional Wave", "Desi & Global Beats",
              "Indie Radar", "Soul & Acoustic", "Dance & Electronic", "Late Night Vibes",
              "All-Time Icons", "Workout & Gym Hype", "Love & Heartbreak", "Next Up: Breakout Artists",
              "Roots & Culture",
            ].slice(0, 17).map((title, idx) => ({
              id: `cpl:${idx}:${title}`,
              kind: "playlist",
              title,
              artist: "Trending mix",
              artwork: (tracks[idx % tracks.length] && tracks[idx % tracks.length].artwork) || "",
              source: "youtube",
              playlistId: "",
              query: title,
              tracks: mixThreeSourcesClient(tracks.slice(0, 20), homeCatalogPool(), 20),
            }));
          }
          paintHomeSoon();
        }
      } catch {}
    }
  }

  function forYouQs() {
    const taste = tasteProfile();
    const cur = current() || state.recents[0] || null;
    const curVibe = cur ? inferTrackVibeClient(cur) : null;
    const prefMoods = Array.isArray(state.prefs && state.prefs.tasteMoods) ? state.prefs.tasteMoods : [];
    const prefStyles = Array.isArray(state.prefs && state.prefs.tasteStyles) ? state.prefs.tasteStyles : [];
    const followedNames = (state.following || []).map((f) => f && f.name).filter(Boolean).slice(0, 6);
    const likedPairs = (state.liked || [])
      .slice(0, 8)
      .map((t) => (t && t.title && t.artist ? `${t.title} - ${artistName(t)}` : ""))
      .filter(Boolean);
    const historyPairs = (state.recents || [])
      .slice(0, 8)
      .map((t) => (t && t.title && t.artist ? `${t.title} - ${artistName(t)}` : ""))
      .filter(Boolean);
    const skipKeys = _sessionPlayedKeys.slice(0, 25);
    const qs = new URLSearchParams({
      artists: taste.artists.slice(0, 6).map((x) => x[0]).join(","),
      followed: followedNames.join(","),
      genres: taste.genres.slice(0, 4).map((x) => x[0]).join(","),
      moods: [...new Set([curVibe && curVibe.mood, ...prefMoods].filter(Boolean))].slice(0, 3).join(","),
      styles: [...new Set([curVibe && curVibe.style, ...prefStyles].filter(Boolean))].slice(0, 2).join(","),
      liked: likedPairs.join(","),
      history: historyPairs.join(","),
      skip: skipKeys.join(","),
      week: mondayWeekKey(),
    });
    return qs.toString();
  }

  async function loadForYou() {
    const taste = tasteProfile();
    const curWeek = mondayWeekKey();
    const homeFy = (state.home && Array.isArray(state.home.forYouPlaylists)) ? state.home.forYouPlaylists : [];
    const needsWeeklyRefresh = homeFy.length === 10 && homeFy.some((p) => p && p.week && p.week !== curWeek);
    if (!taste.hasTaste && !taste.artists.length && !taste.genres.length && !needsWeeklyRefresh) return;
    try {
      const data = await api(`/api/for-you?${forYouQs()}&${glq()}`);
      const raw = (data && data.tracks) || [];
      const seed = current() || state.recents[0] || null;
      state.forYou = raw.length ? scoreAndSequenceSpotifyStyle(seed, raw, { max: 24, maxPerArtist: 2 }) : [];
      if (data && Array.isArray(data.playlists) && data.playlists.length === 10 && state.home) {
        state.home.forYouPlaylists = data.playlists.map((p) => ({
          ...p,
          tracks: mixThreeSourcesClient(p.tracks || [], [], 20),
        }));
        persistHomeCache();
      }
      if (state.view === "home") render();
    } catch { state.forYou = []; }
  }

  async function loadDiscoveryMix(force) {
    const week = mondayWeekKey();
    const have = state.discovery && state.discovery.week === week && (state.discovery.tracks || []).length;
    if (have && !force) return;
    const taste = tasteProfile();
    try {
      const cur = current() || state.recents[0] || null;
      const curVibe = cur ? inferTrackVibeClient(cur) : null;
      const prefMoods = Array.isArray(state.prefs && state.prefs.tasteMoods) ? state.prefs.tasteMoods : [];
      const prefStyles = Array.isArray(state.prefs && state.prefs.tasteStyles) ? state.prefs.tasteStyles : [];
      const qs = new URLSearchParams({
        artists: taste.artists.slice(0, 4).map((x) => x[0]).join(","),
        genres: taste.genres.slice(0, 3).map((x) => x[0]).join(","),
        moods: [...new Set([curVibe && curVibe.mood, ...prefMoods].filter(Boolean))].slice(0, 2).join(","),
        styles: [...new Set([curVibe && curVibe.style, ...prefStyles].filter(Boolean))].slice(0, 2).join(","),
        skip: _sessionPlayedKeys.slice(0, 25).join(","),
        week,
      });
      const data = await api(`/api/discover?${qs}&${glq()}`, 18000);
      const raw = (data && data.tracks) || [];
      if (!raw.length) return;
      const tracks = scoreAndSequenceSpotifyStyle(cur, raw, { max: 30, maxPerArtist: 2 });
      state.discovery = { week, tracks, savedAt: Date.now() };
      save("aura.discovery", state.discovery);
      paintHomeSoon();
    } catch {}
  }

  async function checkFollowReleases(manual = false) {
    if (!state.following.length) {
      if (manual) toast("No artists followed yet");
      return;
    }
    let changed = false;
    let newCount = 0;
    const targets = state.following.slice(0, 30);
    for (const f of targets) {
      try {
        const data = await api(`/api/artist?name=${encodeURIComponent(f.name)}&handle=${encodeURIComponent(f.handle || "")}&${glq()}`);
        const latest = data && data.latest;
        if (latest && latest.id && latest.id !== f.lastId) {
          const first = !f.lastId;
          f.lastId = latest.id;
          changed = true;
          if (!first) {
            newCount++;
            if ("Notification" in window && Notification.permission === "granted" && state.prefs.notifyFollows) {
              try {
                new Notification(`${f.name} released a track`, {
                  body: latest.title,
                  icon: artUrl(latest) || f.artwork || "/logo.png?v=53",
                });
              } catch {}
            }
            if (state.prefs.notifyInApp !== false) {
              toast(`New release from ${f.name}: "${latest.title}"`, true, "info");
            }
          }
        } else if (latest && latest.id && !f.lastId) {
          f.lastId = latest.id;
          changed = true;
        }
      } catch {}
    }
    if (changed) saveFollowing();
    if (manual) {
      toast(newCount > 0 ? `Found ${newCount} new release(s)!` : `All ${state.following.length} followed artists are up to date`, true, "success");
    }
  }

  async function loadRadio(q = "") {
    state.view = "radio";
    render();
    try {
      const data = await api(`/api/radio?q=${encodeURIComponent(q)}&quality=${encodeURIComponent(resolvedQuality())}&codec=${encodeURIComponent(state.prefs.codec || "auto")}`);
      state.radio = data.tracks || [];
    } catch {
      state.radio = [];
      toast("Radio directory unavailable");
    }
    if (state.view === "radio") render();
  }

  function parseYouTubeId(input) {
    const s = input.trim();
    const m = s.match(/(?:v=|youtu\.be\/|youtube\.com\/shorts\/|embed\/)([\w-]{11})/) || s.match(/^([\w-]{11})$/);
    return m ? m[1] : null;
  }

  function pasteYouTube() {
    showModal({
      title: "Play a YouTube link",
      body: `<p>Paste any YouTube or YouTube Music URL. Playback uses the official YouTube player.</p><input id="ytUrl" placeholder="https://www.youtube.com/watch?v=…"/>`,
      ok: "Play",
      onOk: () => {
        const id = parseYouTubeId($("ytUrl").value);
        if (!id) return toast("That does not look like a YouTube link");
        const track = {
          id: `yt:${id}`,
          source: "youtube",
          videoId: id,
          title: "YouTube video",
          artist: "YouTube",
          duration: 0,
          artwork: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        };
        playFromList([track, ...state.queue.filter((t) => t.id !== track.id)], 0);
        state.showVideo = true;
        showEl($("ytWrap"), true);
      },
    });
  }

  function plEditorHTML(d) {
    const cover = d.cover || "/cover-default.jpg";
    return `
      <p class="pl-ed-lead">Name it, then tap the cover or banner. Crop opens on top — you come right back here.</p>
      <div class="pl-ed">
        <div class="pl-ed-banner${d.banner ? " has-img" : ""}" id="plEdBanner">
          <button type="button" class="chip-btn pl-ed-ban-btn" id="plEdPickBanner">${d.banner ? "Change banner" : "Add banner"}</button>
        </div>
        <button type="button" class="pl-ed-cover-btn" id="plEdPickCover" title="Change picture">
          <img id="plEdCover" src="${escapeAttr(cover)}" alt="" onerror="this.src='/cover-default.jpg'"/>
          <span class="lib-cover-edit"><span class="material-symbols-outlined">photo_camera</span></span>
        </button>
      </div>
      <input id="plName" placeholder="Road trip, monsoon, gym…" value="${escapeAttr(d.name || "")}" maxlength="48"/>`;
  }

  function paintPlEditor() {
    const d = state.plDraft;
    if (!d) return;
    const cover = $("plEdCover");
    const ban = $("plEdBanner");
    const banBtn = $("plEdPickBanner");
    if (cover && d.cover) cover.src = d.cover;
    if (ban) {
      if (d.banner) {
        ban.style.backgroundImage = `url("${d.banner}")`;
        ban.classList.add("has-img");
      } else {
        ban.style.backgroundImage = "";
        ban.classList.remove("has-img");
      }
    }
    if (banBtn) banBtn.textContent = d.banner ? "Change banner" : "Add banner";
  }

  function wirePlEditor() {
    const name = $("plName");
    if (name) {
      name.addEventListener("input", () => {
        if (state.plDraft) state.plDraft.name = name.value;
      });
    }
    const coverBtn = $("plEdPickCover");
    if (coverBtn) {
      coverBtn.addEventListener("click", (e) => {
        e.preventDefault();
        pickImage("plCover", -1);
      });
    }
    const banBtn = $("plEdPickBanner");
    if (banBtn) {
      banBtn.addEventListener("click", (e) => {
        e.preventDefault();
        pickImage("plBanner", -1);
      });
    }
    paintPlEditor();
    if ($("mCancel")) {
      $("mCancel").onclick = () => {
        state.plDraft = null;
        state.pendingAdd = null;
        hideModal();
      };
    }
  }

  function openPlaylistEditor(index) {
    if (typeof index === "number" && index >= 0 && state.playlists[index]) {
      const p = state.playlists[index];
      state.plDraft = { name: p.name || "", cover: p.cover || "", banner: p.banner || "", open: true, edit: index };
    } else {
      state.plDraft = { name: "", cover: "", banner: "", open: true, edit: -1 };
    }
    const editing = state.plDraft.edit >= 0;
    showModal({
      title: editing ? "Edit playlist" : "New playlist",
      body: plEditorHTML(state.plDraft),
      ok: editing ? "Save" : "Create",
      onOk: () => {
        const draft = state.plDraft || { name: "", cover: "", banner: "", edit: -1 };
        const typed = $("plName") ? $("plName").value : draft.name;
        const name = String(typed || draft.name || "").trim() || "My mix";
        if (draft.edit >= 0 && state.playlists[draft.edit]) {
          const p = state.playlists[draft.edit];
          p.name = name;
          p.cover = draft.cover || "";
          p.banner = draft.banner || "";
          savePlaylists();
          state.plDraft = null;
          renderPlaylistsNav();
          if (state.view === "library") render();
          toast("Playlist updated");
          return;
        }
        const created = { name, tracks: [], cover: draft.cover || "", banner: draft.banner || "" };
        if (state.pendingAdd && !created.tracks.some((t) => t.id === state.pendingAdd.id)) {
          created.tracks.push(state.pendingAdd);
          state.pendingAdd = null;
        }
        state.playlists.push(created);
        savePlaylists();
        state.plDraft = null;
        renderPlaylistsNav();
        state.view = "library";
        state.activePlaylist = state.playlists.length - 1;
        render();
        toast(created.tracks.length ? `Added to ${name}` : "Playlist ready");
      },
    });
    wirePlEditor();
  }

  function newPlaylist() {
    openPlaylistEditor(-1);
  }

  function addToPlaylist(track) {
    if (!track) return;
    const rows = state.playlists.map((p, i) => `
      <button type="button" class="sheet-item" data-add="${i}">
        <img src="${escapeAttr(playlistArt(p))}" alt="" onerror="this.src='/cover-default.jpg'"/>
        <span>${escapeHTML(p.name)}</span>
      </button>`).join("");
    showModal({
      title: "Add to playlist",
      body: `<div class="sheet-list">
        <button type="button" class="sheet-item" id="addPlNew">
          <span class="material-symbols-outlined">add</span>
          <span>New playlist</span>
        </button>
        ${rows || `<p class="empty">No playlists yet.</p>`}
      </div>`,
      ok: "Close",
      onOk: () => {},
    });
    const neu = $("addPlNew");
    if (neu) {
      neu.addEventListener("click", () => {
        hideModal();
        state.pendingAdd = track;
        newPlaylist();
      });
    }
    $("modalCard").querySelectorAll("[data-add]").forEach((b) => {
      b.addEventListener("click", () => {
        const p = state.playlists[Number(b.dataset.add)];
        if (!p) return;
        if (!p.tracks.some((t) => t.id === track.id)) p.tracks.push(track);
        savePlaylists();
        const ico = b.querySelector(".material-symbols-outlined");
        if (ico) ico.textContent = "check";
        b.classList.add("ok");
        b.disabled = true;
        renderPlaylistsNav();
        setTimeout(() => {
          hideModal();
          toast(`Added to ${p.name}`, true, "success");
        }, 480);
      });
    });
  }

  function showModal({ title, body, ok, onOk }) {
    const modal = $("modal");
    const card = $("modalCard");
    clearTimeout(hideModal._t);
    modal.classList.add("sheet");
    card.innerHTML = `<div class="sheet-handle" aria-hidden="true"></div><h2>${escapeHTML(title)}</h2>${body}<div class="modal-actions"><button class="btn ghost" id="mCancel">Cancel</button><button class="btn primary" id="mOk">${ok}</button></div>`;
    showEl(modal, true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => modal.classList.add("in"));
    });
    $("mCancel").onclick = () => hideModal();
    $("mOk").onclick = () => { hideModal(); onOk(); };
    modal.onclick = (e) => { if (e.target === modal) hideModal(); };
    const first = card.querySelector("input");
    if (first) first.focus();
  }
  function hideModal(immediate) {
    if (typeof window._poEqCancel === "function") {
      try { window._poEqCancel(); } catch {}
      window._poEqCancel = null;
    }
    const modal = $("modal");
    if (!modal) return;
    const close = () => {
      showEl(modal, false);
      modal.classList.remove("in", "sheet");
    };
    if (immediate || !modal.classList.contains("show")) {
      clearTimeout(hideModal._t);
      close();
      return;
    }
    modal.classList.remove("in");
    clearTimeout(hideModal._t);
    hideModal._t = setTimeout(close, 220);
  }

  function settings() {
    setView("settings");
  }

  function wire() {
    document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.view === "radio") loadRadio();
      else setView(b.dataset.view);
    }));
    if ($("menuBtn")) {
      $("menuBtn").onclick = (e) => {
        e.stopPropagation();
        const open = !$("sidebar").classList.contains("open");
        $("sidebar").classList.toggle("open", open);
        showEl($("scrim"), open || state.showQueue);
      };
    }
    let searchLiveTimer = null;
    $("searchInput").addEventListener("input", (e) => {
      const raw = e.target.value || "";
      const val = raw.trim();
      clearTimeout(searchLiveTimer);
      if (!val) {
        state.query = "";
        if (state.view === "search") {
          state.search = null;
          render();
        }
        return;
      }
      searchLiveTimer = setTimeout(() => {
        const curInp = $("searchInput");
        const curVal = curInp ? curInp.value.trim() : val;
        if (state.view === "search" && curVal.length >= 2 && curVal !== state.query) {
          runSearch(curVal);
        }
      }, 350);
    });
    $("searchInput").addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === "search") && e.target.value.trim()) {
        clearTimeout(searchLiveTimer);
        runSearch(e.target.value.trim());
        // On phones, dismiss the on-screen keyboard once the search runs —
        // results stay visible, and tapping the bar refocuses (and reopens
        // the keyboard). Desktop keyboard behavior is untouched.
        const onPhone =
          (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== "web") ||
          (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
        if (onPhone) e.target.blur();
      }
    });
    window.addEventListener("popstate", (e) => {
      if (e.state && e.state.muchi) {
        applyNav(e.state);
        return;
      }
      if (logicalBack()) {
        navReplace();
      }
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        requestBack();
        e.preventDefault();
      }
    });
    const playBtnEl = $("playBtn");
    if (playBtnEl) {
      playBtnEl.addEventListener("pointerdown", (e) => {
        triggerFabRipple(playBtnEl, e);
      });
      playBtnEl.onclick = togglePlay;
    }
    $("nextBtn").onclick = () => {
      hapticFeedback("light");
      next(true);
    };
    $("prevBtn").onclick = () => {
      hapticFeedback("light");
      prev();
    };
    $("shuffleBtn").onclick = () => {
      hapticFeedback("selection");
      state.shuffle = !state.shuffle;
      renderChrome();
    };
    $("repeatBtn").onclick = () => {
      hapticFeedback("selection");
      state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
      renderChrome();
    };
    $("likeBtn").onclick = () => {
      const t = current();
      if (!t) return;
      if (isLiked(t)) openLikeMenu(t);
      else toggleLike(t);
    };
    if ($("dlBtn")) $("dlBtn").onclick = () => downloadTrack(current());
    if ($("followBtn")) $("followBtn").onclick = () => toggleFollow(current());
    if ($("trackArtist")) $("trackArtist").onclick = () => openArtistFromTrack(current());
    if ($("clearQueue")) $("clearQueue").onclick = clearUpcoming;
    $("likeBtn").oncontextmenu = (e) => {
      e.preventDefault();
      if (current()) addToPlaylist(current());
    };
    document.addEventListener("contextmenu", (e) => {
      const card = e.target.closest("[data-play]");
      if (!card || e.target.closest("#playerBar")) return;
      e.preventDefault();
      const track = findTrack(card.dataset.play);
      if (!track) return;
      showModal({
        title: track.title,
        body: `<p>${escapeHTML(track.artist)}</p>
          <div class="modal-actions" style="justify-content:flex-start">
            <button class="chip-btn" id="ctxNext" type="button">Play next</button>
            <button class="chip-btn" id="ctxQueue" type="button">Add to queue</button>
            <button class="chip-btn" id="ctxFollow" type="button">${isFollowing(track) ? "Unfollow" : "Follow"}</button>
          </div>`,
        ok: "Close",
        onOk: () => {},
      });
      const n = $("ctxNext"); if (n) n.onclick = () => { hideModal(); playNext(track); };
      const q = $("ctxQueue"); if (q) q.onclick = () => { hideModal(); addToQueue(track); };
      const f = $("ctxFollow"); if (f) f.onclick = () => { hideModal(); toggleFollow(track); };
    });
    const seekEl = $("seek");
    if (seekEl) {
      let lastScrubVal = -1;
      let scrubReleaseTimer = 0;
      const beginSeekScrub = () => {
        clearTimeout(scrubReleaseTimer);
        isSeekingUi = true;
        seekCur = -1;
        seekTgt = -1;
        if (seekRaf) { cancelAnimationFrame(seekRaf); seekRaf = 0; }
      };
      const commitSeekScrub = (explicitVal) => {
        clearTimeout(scrubReleaseTimer);
        const hasExplicit = typeof explicitVal === "number" && !isNaN(explicitVal);
        if (!isSeekingUi && !hasExplicit && lastScrubVal < 0) return;
        isSeekingUi = false;
        const v = hasExplicit ? explicitVal : (lastScrubVal >= 0 ? lastScrubVal : Number(seekEl.value));
        lastScrubVal = -1;
        const d = duration();
        if (d > 0 && isFinite(d)) {
          seekTo((Math.max(0, Math.min(1000, v)) / 1000) * d);
        }
      };
      const scheduleReleaseCommit = () => {
        if (!isSeekingUi) return;
        clearTimeout(scrubReleaseTimer);
        scrubReleaseTimer = setTimeout(() => {
          if (isSeekingUi) commitSeekScrub(Number(seekEl.value));
        }, 40);
      };
      seekEl.addEventListener("pointerdown", beginSeekScrub);
      seekEl.addEventListener("touchstart", beginSeekScrub, { passive: true });
      seekEl.addEventListener("mousedown", beginSeekScrub);
      seekEl.addEventListener("input", (e) => {
        clearTimeout(scrubReleaseTimer);
        isSeekingUi = true;
        lastScrubVal = Number(e.target.value);
        const d = duration();
        if (d > 0 && isFinite(d)) {
          const previewSec = (lastScrubVal / 1000) * d;
          if ($("curTime")) $("curTime").textContent = fmt(previewSec);
          highlightLyric(previewSec, true);
        }
        drawSeekWave();
      });
      seekEl.addEventListener("change", (e) => {
        hapticFeedback("selection");
        commitSeekScrub(Number(e.target.value));
      });
      seekEl.addEventListener("pointerup", scheduleReleaseCommit);
      seekEl.addEventListener("touchend", scheduleReleaseCommit);
      seekEl.addEventListener("mouseup", scheduleReleaseCommit);
      seekEl.addEventListener("pointercancel", () => { isSeekingUi = false; lastScrubVal = -1; });
      seekEl.addEventListener("touchcancel", () => { isSeekingUi = false; lastScrubVal = -1; });
      window.addEventListener("pointerup", scheduleReleaseCommit);
      window.addEventListener("touchend", scheduleReleaseCommit, { passive: true });
    }
    $("volume").addEventListener("input", (e) => setVolume(Number(e.target.value)));
    $("queueBtn").onclick = () => {
      if (state.showQueue) requestBack();
      else setQueueOpen(true);
    };
    $("closeQueue").onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (state.showQueue) requestBack();
      else setQueueOpen(false);
    };
    $("scrim").onclick = () => closeOverlays();
    const closeVideoPane = () => {
      if (!state.showVideo) return;
      state.showVideo = false;
      showEl($("ytWrap"), false);
      const t = current();
      if (t && t.videoId && !t._playingViaAudio && IS_NATIVE && nativePlayer() && state.prefs.ytAudio !== false) {
        const pos = position();
        if (pos > 1) { _pendingSeek = pos; _pendingSeekApplied = false; }
        playYtWithAudio(t, false).catch(() => {});
      }
    };
    $("videoBtn").onclick = async () => {
      const t = current();
      if (!t) { toast("Play a song first"); return; }
      if (t.source === "radio" || t.source === "audius") {
        toast("No video available for this track");
        return;
      }
      if (state.showVideo) {
        closeVideoPane();
        return;
      }
      state.showVideo = true;
      showEl($("ytWrap"), true);
      if (!t.videoId) {
        try { await resolveYouTubePlay(t); } catch {}
      }
      if (t.videoId && (t._playingViaAudio || npActive || !state.yt)) {
        const pos = position();
        if (pos > 1) ytSeekReset = Math.floor(pos);
        try { await playYouTube(t); } catch {}
      }
    };
    $("closeVideo").onclick = () => closeVideoPane();
    $("lyricsBtn").onclick = () => {
      if (!current()) { toast("Play a song first"); return; }
      if (state.view === "now") requestBack();
      else setView("now");
    };
    if ($("optionsBtn")) $("optionsBtn").onclick = () => {
      if (!current()) { toast("Play a song first"); return; }
      openPlayerOptions();
    };
    $("openNow").onclick = () => {
      if (!current()) { toast("Play a song first"); return; }
      if (state.view === "now") return;
      setView("now");
    };
    if ($("pasteBtn")) $("pasteBtn").onclick = pasteYouTube;
    if ($("offlineBtn")) {
      $("offlineBtn").onclick = () => {
        retryServerConnection($("offlineBtn"));
      };
    }
    updateOfflineIndicator();
    const avatarFile = $("avatarFile");
    if (avatarFile) {
      avatarFile.addEventListener("change", () => {
        const file = avatarFile.files && avatarFile.files[0];
        state.pickingAvatar = false;
        if (file) setAvatarFile(file);
      });
    }
    window.addEventListener("focus", () => { state.pickingAvatar = false; });
    const cropStage = $("cropStage");
    const cropImg = $("cropImg");
    const cropZoom = $("cropZoom");
    if ($("cropCancel")) $("cropCancel").onclick = closeCrop;
    if ($("cropOk")) $("cropOk").onclick = commitCrop;
    if (cropZoom) {
      cropZoom.addEventListener("input", () => {
        crop.z = Number(cropZoom.value) / 100;
        layoutCrop();
      });
    }
    if (cropStage) {
      cropStage.addEventListener("pointerdown", (e) => {
        crop.drag = true;
        crop.lx = e.clientX;
        crop.ly = e.clientY;
        cropStage.setPointerCapture(e.pointerId);
      });
      cropStage.addEventListener("pointermove", (e) => {
        if (!crop.drag) return;
        crop.x += e.clientX - crop.lx;
        crop.y += e.clientY - crop.ly;
        crop.lx = e.clientX;
        crop.ly = e.clientY;
        layoutCrop();
      });
      cropStage.addEventListener("pointerup", () => { crop.drag = false; });
      cropStage.addEventListener("pointercancel", () => { crop.drag = false; });
    }
    const dock = $("dockNav");
    if (dock) {
      dock.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        btn.classList.remove("bump");
        void btn.offsetWidth;
        btn.classList.add("bump");
        setTimeout(() => btn.classList.remove("bump"), 420);
      });
    }
    if ($("installBtn")) $("installBtn").onclick = installApp;
    if ($("sleepBtn")) $("sleepBtn").onclick = cycleSleep;
    if ($("newPlaylistBtn")) $("newPlaylistBtn").onclick = newPlaylist;
    if ($("playlistNav")) $("playlistNav").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      rememberScroll();
      closeOverlays();
      const originView = (state.view === "library" && state.activePlaylist != null)
        ? (state.playlistFrom || state.prevView || "home")
        : (state.view || "home");
      state.playlistFrom = originView;
      state.prevView = originView;
      if (b.hasAttribute("data-open-liked")) { state.view = "library"; state.activePlaylist = "liked"; navPush(); paintNav(false); }
      if (b.hasAttribute("data-open-downloads")) { state.view = "library"; state.activePlaylist = "downloads"; navPush(); paintNav(false); }
      if (b.dataset.pl) { state.view = "library"; state.activePlaylist = Number(b.dataset.pl); navPush(); paintNav(false); }
    });
    $("queueList").addEventListener("click", (e) => {
      const del = e.target.closest("[data-q-del]");
      if (del) {
        e.stopPropagation();
        removeQueued(Number(del.dataset.qDel));
        return;
      }
      const ref = e.target.closest("#refreshQueueRecs") || e.target.closest("#refreshQueueRecsEmpty");
      if (ref) {
        e.stopPropagation();
        const icon = ref.querySelector(".material-symbols-outlined") || ref;
        icon.classList.add("rotating");
        loadQueueRecs(true);
        return;
      }
      const addRec = e.target.closest("[data-rec-add]");
      if (addRec) {
        e.stopPropagation();
        const idx = Number(addRec.dataset.recAdd);
        const rec = state.queueRecs && state.queueRecs[idx];
        if (rec) {
          addToQueue(rec);
          state.queueRecs = (state.queueRecs || []).filter((r, i) => i !== idx && !isSameSongClient(r, rec));
          renderQueue();
          toast(`Added "${rec.title}" to queue`);
          if ((state.queueRecs || []).length < 4) loadQueueRecs(true);
        }
        return;
      }
      const playRec = e.target.closest("[data-rec-play]");
      if (playRec) {
        e.stopPropagation();
        const idx = Number(playRec.dataset.recPlay);
        const rec = state.queueRecs && state.queueRecs[idx];
        if (rec) {
          state.queueRecs = (state.queueRecs || []).filter((r, i) => i !== idx && !isSameSongClient(r, rec));
          playNext(rec);
          const newIdx = state.queue.findIndex((t) => isSameSongClient(t, rec));
          if (newIdx >= 0) {
            state.index = newIdx;
            playCurrent(true);
            renderQueue();
          } else {
            next(true);
          }
        }
        return;
      }
      const b = e.target.closest("[data-play]");
      if (!b) return;
      state.index = Number(b.dataset.idx);
      playCurrent(true);
    });
    let dragFrom = -1;
    $("queueList").addEventListener("dragstart", (e) => {
      const row = e.target.closest("[data-q-i]");
      if (!row) return;
      dragFrom = Number(row.dataset.qI);
      row.classList.add("drag");
    });
    $("queueList").addEventListener("dragover", (e) => {
      e.preventDefault();
      const row = e.target.closest("[data-q-i]");
      if (row) e.dataTransfer.dropEffect = "move";
    });
    $("queueList").addEventListener("drop", (e) => {
      e.preventDefault();
      const row = e.target.closest("[data-q-i]");
      if (!row || dragFrom < 0) return;
      moveQueue(dragFrom, Number(row.dataset.qI));
      dragFrom = -1;
    });
    $("queueList").addEventListener("dragend", () => { dragFrom = -1; renderQueue(); });
    $("modal").addEventListener("click", (e) => { if (e.target.id === "modal") hideModal(); });
    document.addEventListener("click", (e) => {
      const legalLink = e.target && e.target.closest
        ? e.target.closest('[data-legal], a[href="/privacy.html"], a[href="/terms.html"], a[href$="/privacy.html"], a[href$="/terms.html"]')
        : null;
      if (!legalLink) return;
      e.preventDefault();
      const href = String(legalLink.getAttribute("href") || "").toLowerCase();
      const kind = legalLink.getAttribute("data-legal") || (href.includes("terms") ? "terms" : "privacy");
      openLegalDocument(kind);
    });
    // Instant native tactile press feedback across all interactive controls
    {
      const PRESS_SEL = [
        "button",
        "a[href]",
        "[role=\"button\"]",
        ".icon-btn",
        ".chip-btn",
        ".tonal-btn",
        ".pill-btn",
        ".btn",
        ".fab",
        ".dock-btn",
        ".nav-btn",
        ".ly-icon",
        ".ly-pill",
        ".ly-line",
        ".tab",
        ".mood-pill",
        ".taste-pill",
        ".seg-btn",
        ".set-ui-card",
        ".set-theme-chip",
        ".app-icon-opt",
        ".sheet-item",
        ".track-row",
        ".q-item",
        ".card",
        ".playlist-card",
        ".artist-card",
        ".radio-card",
        "[data-play]",
        "[data-view]",
        "[data-tab]",
      ].join(",");
      let activePressEl = null;
      let pressDownAt = 0;
      let releaseTimer = 0;
      const clearPressed = (immediate = false) => {
        if (!activePressEl) return;
        const el = activePressEl;
        activePressEl = null;
        clearTimeout(releaseTimer);
        const elapsed = Date.now() - pressDownAt;
        if (immediate || elapsed >= 75) {
          el.classList.remove("is-pressed");
        } else {
          releaseTimer = setTimeout(() => el.classList.remove("is-pressed"), Math.max(16, 75 - elapsed));
        }
      };
      document.addEventListener("pointerdown", (e) => {
        if (e.button && e.button !== 0) return;
        const t = e.target && e.target.closest ? e.target.closest(PRESS_SEL) : null;
        if (!t || t.disabled || t.getAttribute("aria-disabled") === "true") return;
        if (activePressEl && activePressEl !== t) {
          activePressEl.classList.remove("is-pressed");
        }
        clearTimeout(releaseTimer);
        activePressEl = t;
        pressDownAt = Date.now();
        t.classList.add("is-pressed");
      }, { passive: true });
      document.addEventListener("pointerup", () => clearPressed(false), { passive: true });
      document.addEventListener("pointercancel", () => clearPressed(true), { passive: true });
      window.addEventListener("scroll", () => clearPressed(true), { capture: true, passive: true });
      window.addEventListener("blur", () => clearPressed(true));
    }
    audio.addEventListener("ended", () => {
      if (state._xfading) { state._xfading = false; return; }
      // Track finished: mark stopped BEFORE advancing so the play/pause glyph
      // is never a stale "pause" (which previously happened when next(false)
      // ran without re-rendering, e.g. when autoplay was off or the queue ran
      // out).
      if (state.playing) {
        state.playing = false;
        updateMediaSession();
        renderChrome();
      }
      next(false);
    });
    audio.addEventListener("play", () => {
      state.playing = true;
      if (!state.timer) startTimer();
      updateMediaSession();
      renderChrome();
    });
    audio.addEventListener("playing", onPlaybackPlaying);
    audio.addEventListener("timeupdate", () => {
      if (!document.hidden && !npActive) updateProgress();
    });
    audio.addEventListener("loadedmetadata", () => {
      if (_webSeekTarget >= 0) {
        try {
          const target = _webSeekTarget;
          _webSeekTarget = -1;
          audio.currentTime = target;
        } catch {}
      }
      if (!npActive) updateProgress();
    });
    audio.addEventListener("durationchange", () => {
      if (!npActive) updateProgress();
    });
    audio.addEventListener("waiting", onPlaybackWaiting);
    audio.addEventListener("stalled", onPlaybackWaiting);
    audio.addEventListener("progress", checkBufferResume);
    audio.addEventListener("canplay", () => {
      if (_webSeekTarget >= 0) {
        try {
          const target = _webSeekTarget;
          _webSeekTarget = -1;
          audio.currentTime = target;
        } catch {}
      }
      checkBufferResume();
    });
    audio.addEventListener("canplaythrough", checkBufferResume);
    audio.addEventListener("pause", () => {
      if (current() && current().source === "youtube" && !current()._playingViaAudio) return;
      if (audio.ended) return;
      if (wantPlay && state.prefs.bgPlay !== false && document.hidden) {
        audio.play().catch(() => {});
        return;
      }
      // Any other pause is a real stop — update the icon even when wantPlay is
      // still true (the old `if (!wantPlay)` gate left a stale "pause" glyph
      // when the element stopped for another reason).
      if (state.playing) {
        state.playing = false;
        updateMediaSession();
        renderChrome();
      }
    });
    audio.addEventListener("error", () => {
      const src = audio.getAttribute("src") || audio.src;
      if (!src || src === window.location.href) return;
      if (audio.error && audio.error.code === 1) return; // MEDIA_ERR_ABORTED
      const cur = current();
      if (!cur) return;
      if (((cur.source === "youtube" || cur.videoId) && !cur._playingViaAudio) || npActive) return;
      if (cur.videoId && !cur._webYtFallbackTried) {
        cur._webYtFallbackTried = true;
        cur._playingViaAudio = false;
        playYouTube(cur).catch(() => {
          if (current() === cur) skipFailed("Stream failed");
        });
        return;
      }
      skipFailed("Stream failed");
    });

    document.addEventListener("keydown", (e) => {
      const tag = document.activeElement && document.activeElement.tagName;
      if (e.key === "/" && tag !== "INPUT") {
        e.preventDefault();
        if (state.view !== "search") setView("search");
        else if ($("searchInput")) $("searchInput").focus();
      }
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      if (e.key === "ArrowRight") seekTo(position() + 10);
      if (e.key === "ArrowLeft") seekTo(position() - 10);
      if (e.key === "n") next(true);
      if (e.key === "p") prev();
      if (e.key === "l") toggleLike(current());
    });

    const bar = $("playerBar");
    function bump(el) {
      if (!el) return;
      el.classList.remove("bump");
      void el.offsetWidth;
      el.classList.add("bump");
      setTimeout(() => el.classList.remove("bump"), 420);
    }
    if (bar) {
      bar.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (btn) bump(btn);
        showPlayerChrome();
      });
    }
    function showPlayerChrome() {
      if (bar) bar.classList.remove("away");
    }
    let lastY = window.scrollY || 0;
    let ticking = false;
    window.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY || document.documentElement.scrollTop || 0;
        const dy = y - lastY;
        if (!bar) { ticking = false; lastY = y; return; }
        if (state.showQueue) {
          bar.classList.remove("away");
        } else if (dy > 10 && y > 48) {
          bar.classList.add("away");
        } else if (dy < -8) {
          bar.classList.remove("away");
        }
        lastY = y;
        ticking = false;
      });
    }, { passive: true });
  }

  window.onYouTubeIframeAPIReady = () => {
    state.ytReady = true;
  };

  let deferredInstall = null;
  function installApp() {
    if (deferredInstall) {
      deferredInstall.prompt();
      deferredInstall.userChoice.finally(() => { deferredInstall = null; });
      return;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    showModal({
      title: "Install Muchi on your phone",
      body: ios
        ? `<p>Open this site in <b>Safari</b>, tap Share, then <b>Add to Home Screen</b>.</p>`
        : `<p>On Android Chrome: menu (⋮) → <b>Install app</b> or <b>Add to Home screen</b>.</p>
           <p>On desktop Chrome / Edge: use the install icon in the address bar.</p>`,
      ok: "Got it",
      onOk: () => {},
    });
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
  });
  if (window.matchMedia("(display-mode: standalone)").matches && $("installBtn")) {
    $("installBtn").style.display = "none";
  }
  if ("serviceWorker" in navigator && !IS_NATIVE) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  const sparkBits = [];
  function burstHearts(el) {
    const c = $("sparkLayer");
    if (!c) return;
    const isCoarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    const p = isCoarse ? 1 : Math.min(1.5, window.devicePixelRatio || 1);
    let x = innerWidth / 2;
    let y = innerHeight - 80;
    if (el && el.getBoundingClientRect) {
      const r = el.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
      if (el.classList) {
        el.classList.remove("pop");
        void el.offsetWidth;
        el.classList.add("pop");
        setTimeout(() => { if (el.classList) el.classList.remove("pop"); }, 420);
      }
    }
    const glyphs = ["♥", "♡", "♪", "♫", "♥"];
    const count = isCoarse ? 10 : 16;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const speed = (2.2 + Math.random() * 3.8) * p;
      sparkBits.push({
        x: x * p,
        y: y * p,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.8 * p,
        life: 1,
        decay: 0.016 + Math.random() * 0.012,
        g: glyphs[i % glyphs.length],
        s: (16 + Math.random() * 10) * p,
        hue: i % 2 ? 342 + Math.random() * 14 : 295 + Math.random() * 35,
      });
    }
    try { if (window.kickSparks) window.kickSparks(); } catch {}
  }
  (function startSparks() {
    const c = $("sparkLayer");
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const isCoarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    const dpr = () => (isCoarse ? 1 : Math.min(1.5, window.devicePixelRatio || 1));
    function resize() {
      const p = dpr();
      c.width = innerWidth * p;
      c.height = innerHeight * p;
      c.style.width = innerWidth + "px";
      c.style.height = innerHeight + "px";
    }
    resize();
    window.addEventListener("resize", resize);
    const ambient = ["♪", "♫", "♡", "♩", "♬"];
    function spawnAmbient(anywhere) {
      if (sparkBits.length > 16) return;
      const p = dpr();
      sparkBits.push({
        x: Math.random() * innerWidth * p,
        y: (anywhere ? innerHeight * (0.15 + Math.random() * 0.7) : innerHeight + 10) * p,
        vx: (Math.random() - 0.5) * 0.5 * p,
        vy: -(0.4 + Math.random() * 0.8) * p,
        life: 1,
        decay: 0.0022 + Math.random() * 0.0014,
        g: ambient[Math.floor(Math.random() * ambient.length)],
        s: (16 + Math.random() * 12) * p,
        hue: [150 + Math.random() * 45, 260 + Math.random() * 35, 335 + Math.random() * 25][Math.floor(Math.random() * 3)],
      });
    }
    let sparkOn = false;
    let sparkLast = 0;
    function tick(now) {
      if (document.hidden) {
        sparkOn = false;
        return;
      }
      let dt = 1;
      if (isCoarse) {
        if (now - sparkLast < 55) { requestAnimationFrame(tick); return; }
        sparkLast = now;
        dt = 2.4;
      }
      if (!sparkBits.length) {
        ctx.clearRect(0, 0, c.width, c.height);
        sparkOn = false;
        return;
      }
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const p = dpr();
      ctx.font = `${Math.round(20 * p)}px "Apple Color Emoji", "Segoe UI Emoji", system-ui, sans-serif`;

      for (let i = sparkBits.length - 1; i >= 0; i--) {
        const b = sparkBits[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= b.decay * dt;
        if (b.life <= 0) {
          sparkBits.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, b.life) * 0.9;
        ctx.fillStyle = `hsl(${b.hue} 85% 72%)`;
        ctx.fillText(b.g, b.x, b.y);
      }
      ctx.globalAlpha = 1;
      if (sparkBits.length > 0) {
        requestAnimationFrame(tick);
      } else {
        sparkOn = false;
      }
    }
    function kickSparks() {
      if (sparkOn) return;
      sparkOn = true;
      requestAnimationFrame(tick);
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && sparkBits.length) kickSparks();
    });
    window.kickSparks = kickSparks;
    // Welcome burst of ambient notes on startup
    for (let i = 0; i < 8; i++) spawnAmbient(true);
    kickSparks();
  })();

  applyTheme();
  applyAppIcon();
  playAppOpeningAnimation();
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && conn.addEventListener) {
    let lastQ = resolvedQuality();
    conn.addEventListener("change", () => {
      if ((state.prefs.quality || "auto") !== "auto") return;
      const now = resolvedQuality();
      if (now === lastQ) return;
      lastQ = now;
      applyYtQuality();
    });
  }
  // Live OS light/dark follow for System appearance (the watchSystemTheme
  // listener in applyTheme covers theme/meta; this also re-derives the
  // per-song accent colors).
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if ((state.prefs.appearance || "system") === "system" && !isSkinTheme()) {
      applyTheme();
      themedId = "";
      themeFromTrack(current());
    }
  });
  document.addEventListener("visibilitychange", () => {
    document.documentElement.dataset.hidden = document.hidden ? "1" : "0";
    if (document.hidden) {
      if (waveRaf) { cancelAnimationFrame(waveRaf); waveRaf = 0; }
      if (seekRaf) { cancelAnimationFrame(seekRaf); seekRaf = 0; }
    } else if (document.visibilityState === "visible") {
      updateWakeLock();
      updateProgress();
      if (state.view === "now") restartWaveLoop();
    }
    keepBackgroundPlay();
  });
  window.addEventListener("pageshow", () => keepBackgroundPlay());
  document.addEventListener("resume", () => keepBackgroundPlay());
  document.addEventListener("freeze", () => {
    if (wantPlay) updateMediaSession();
  });
  // Persist the last listening session when the app is closed / backgrounded
  // (native shells fire `pause`/`stop`; web fires pagehide + visibilitychange).
  window.addEventListener("pagehide", () => savePlayerSession());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") savePlayerSession();
  });
  // Resume the last listening session: put the last song (and its queue) back
  // in the docked player so reopening the app "shows the player of the last
  // song" ready to resume. We restore the track + position but do NOT
  // autoplay on launch — tapping play resumes from the saved position.
  const _sess = restorePlayerSession();
  if (_sess) {
    state.queue = slimPlayerQueue(_sess.queue);
    state.index = _sess.index;
    state.playerReady = true;
    const _rt = current();
    const _pos = Math.max(0, Number(_sess.pos) || 0);
    if (_pos > 0.5) {
      _pendingSeek = _pos;
      _pendingSeekApplied = false;
      _resumeTrackId = _rt ? (trackKey(_rt) || String(_rt.id || "")) : "";
      if (_rt && (_rt.videoId || _rt.source === "youtube")) ytSeekReset = _pos;
    }
    // The player bar is populated by renderChrome(), which render() calls on
    // the next paint; no need (and it's slightly unsafe) to touch the DOM
    // before wire() has run.
  } else if (state.prefs.resume && state.recents.length) {
    state.queue = state.recents.slice(0, 24);
    state.index = 0;
  }
  if (!state.prefs.github || /Muchi-music(?:-New)?\/?$/i.test(state.prefs.github)) {
    state.prefs.github = "https://github.com/Kaibshshdheueejw/Muchi";
    savePrefs();
  }
  window.__muchiToast = (msg) => toast(msg, true);
  window.__muchiNative = (cmd) => {
    if (cmd === "play") {
      setWantPlay(true);
      if (!state.playing) togglePlay();
    } else if (cmd === "pause") {
      setWantPlay(false);
      if (state.playing) togglePlay();
    } else if (cmd === "next") next(true);
    else if (cmd === "prev") prev();
  };
  // (v1.5.4) The legacy pre-Capacitor "MuchiApp" UA watchdog interval is
  // gone: the Capacitor shell's UA never matches /MuchiApp/i, so it never
  // fired (and its keepBackgroundPlay() body no-ops without the old
  // MuchiAndroid JS interface). Nothing was maintaining it; nothing lost.
  try { if (window.MuchiAndroid && MuchiAndroid.ready) MuchiAndroid.ready(); } catch {}
  detectCountry();
  autoDetectCountry();
  setVolume(state.volume);
  wire();
  initAuth();
  setQueueOpen(false);
  renderPlaylistsNav();
  try { history.replaceState(navSnap(), ""); } catch {}
  function weaveDiverseTracks(buckets, max = 24, maxPerArtist = 2, countryCode = "US", allowIndian = false) {
    const flat = [];
    const maxLen = Math.max(0, ...buckets.map((b) => (Array.isArray(b) ? b.length : 0)));
    for (let i = 0; i < maxLen; i++) {
      for (const bucket of buckets) {
        if (!Array.isArray(bucket) || !bucket[i]) continue;
        const t = bucket[i];
        if (!t || !t.title || !looksLikeSong(t)) continue;
        if (!allowIndian && isUnwantedIndianTrackClient(t, countryCode)) continue;
        flat.push(t);
      }
    }
    const seed = current() || state.recents[0] || flat[0] || null;
    const sequenced = scoreAndSequenceSpotifyStyle(seed, flat, {
      max,
      maxPerArtist,
    });
    if (sequenced && sequenced.length) return sequenced;
    return flat.slice(0, max);
  }

  let _tasteLoadInFlight = false;
  async function loadTasteRecommendations(force) {
    if (_tasteLoadInFlight) return;
    const countryCode = String((state.prefs && state.prefs.country) || "US").toUpperCase();
    const prefGenres = Array.isArray(state.prefs.tasteGenres) ? state.prefs.tasteGenres : [];
    const prefMoods = Array.isArray(state.prefs.tasteMoods) ? state.prefs.tasteMoods : [];
    const prefEras = Array.isArray(state.prefs.tasteEras) ? state.prefs.tasteEras : [];
    const prefStyles = Array.isArray(state.prefs.tasteStyles) ? state.prefs.tasteStyles : [];
    const prefArtists = Array.isArray(state.prefs.tasteArtists) ? state.prefs.tasteArtists : [];
    const followedNames = (state.following || []).map((f) => f && f.name).filter(Boolean);
    const allArtists = [...new Set([...followedNames, ...prefArtists])];
    const allowIndian =
      countryCode === "IN" ||
      countryCode === "PK" ||
      countryCode === "BD" ||
      prefGenres.some((g) => /bollywood|punjabi|tamil|telugu|indie_in/i.test(g));

    if (!force && (state.tasteTracks || []).length >= 12 && (!allArtists.length || (state.followedArtistTracks || []).length >= 8)) {
      return;
    }

    _tasteLoadInFlight = true;
    try {
      const styleList = getOnboardStylesForCountry(countryCode);
      const countryGenres = getOnboardGenresForCountry(countryCode);
      // 1) Build diverse queries for "Picked for your taste" mixing genres, moods, eras, styles, country hits & artists
      const tasteQueries = [];
      for (const gId of prefGenres.slice(0, 3)) {
        const gObj = findOnboardGenreById(gId, countryCode);
        if (gObj && gObj.query) tasteQueries.push(gObj.query);
      }
      for (const mId of prefMoods.slice(0, 2)) {
        const mObj = ONBOARD_MOODS.find((x) => x.id === mId);
        if (mObj && mObj.query) tasteQueries.push(mObj.query);
      }
      for (const eId of prefEras.slice(0, 1)) {
        const eObj = ONBOARD_ERAS.find((x) => x.id === eId);
        if (eObj && eObj.query) tasteQueries.push(eObj.query);
      }
      for (const sId of prefStyles.slice(0, 1)) {
        const sObj = styleList.find((x) => x.id === sId);
        if (sObj && sObj.query) tasteQueries.push(sObj.query);
      }
      for (const aName of allArtists.slice(0, 2)) {
        tasteQueries.push(`${aName} hits official audio`);
      }
      // If user hasn't picked genres yet (e.g. existing user who only followed artists),
      // include their country's top local genres so all 10 taste playlists have diverse tracks!
      for (const gObj of countryGenres.slice(0, 3)) {
        if (gObj && gObj.query) tasteQueries.push(gObj.query);
      }
      // Always include a country/genre anchor query so even if user only chose 1 artist,
      // the row is a rich mix of songs rather than just that single artist's songs.
      tasteQueries.push(shelfQueryForCountryClient("pop", countryCode, "top hits official audio"));
      if (prefGenres.length === 0) {
        tasteQueries.push(shelfQueryForCountryClient("indie", countryCode, "indie pop official audio"));
      }

      const uniqueTasteQueries = [...new Set(tasteQueries)].slice(0, 6);
      if (uniqueTasteQueries.length) {
        const settled = await Promise.allSettled(
          uniqueTasteQueries.map((q) => api(`/api/search?q=${encodeURIComponent(q)}&${glq()}`, 12000))
        );
        const buckets = [];
        for (const r of settled) {
          if (r.status !== "fulfilled" || !r.value) continue;
          const d = r.value;
          buckets.push([
            ...((d.apple || d.itunes || []).slice(0, 5)),
            ...((d.youtube || []).slice(0, 6)),
            ...((d.deezer || []).slice(0, 4)),
          ]);
        }
        const combined = weaveDiverseTracks(buckets, 24, 2, countryCode, allowIndian);
        if (combined.length) {
          state.tasteTracks = combined;
          save("aura.tasteTracks", state.tasteTracks);
          paintHomeSoon();
        }
      }

      // 2) Build "Artists you follow & similar" shelf: mix songs by followed artists
      //    WITH other songs (similar artists, chosen genres/moods, and country hits)
      //    so it never looks odd or one-artist-only even if the user followed just 1 artist.
      if (allArtists.length) {
        const artistQueries = [];
        for (const name of allArtists.slice(0, 3)) {
          artistQueries.push(`${name} official audio`);
          artistQueries.push(`songs like ${name} mix official audio`);
        }
        // Add companion genre/country queries to guarantee variety alongside followed artists
        if (prefGenres.length) {
          const gObj = findOnboardGenreById(prefGenres[0], countryCode);
          if (gObj && gObj.query) artistQueries.push(gObj.query);
        }
        if (prefMoods.length) {
          const mObj = ONBOARD_MOODS.find((x) => x.id === prefMoods[0]);
          if (mObj && mObj.query) artistQueries.push(mObj.query);
        }
        artistQueries.push(shelfQueryForCountryClient("today", countryCode, "top hits official audio"));

        const uniqueArtistQueries = [...new Set(artistQueries)].slice(0, 6);
        const artistSettled = await Promise.allSettled(
          uniqueArtistQueries.map((q) => api(`/api/search?q=${encodeURIComponent(q)}&${glq()}`, 12000))
        );
        const artistBuckets = [];
        for (const r of artistSettled) {
          if (r.status !== "fulfilled" || !r.value) continue;
          const d = r.value;
          artistBuckets.push([
            ...((d.apple || d.itunes || []).slice(0, 5)),
            ...((d.youtube || []).slice(0, 5)),
            ...((d.deezer || []).slice(0, 4)),
          ]);
        }
        // Cap any single artist at max 2 tracks in this shelf so followed artists
        // are woven naturally with other songs!
        const mixedArtistTracks = weaveDiverseTracks(artistBuckets, 24, 2, countryCode, allowIndian);
        if (mixedArtistTracks.length) {
          state.followedArtistTracks = mixedArtistTracks;
          save("aura.followedArtistTracks", state.followedArtistTracks);
          paintHomeSoon();
        }
      }
    } catch {} finally {
      _tasteLoadInFlight = false;
    }
  }

  const _onbArtCache = load("aura.onbArtCache", {});
  function saveOnbArtCache() {
    save("aura.onbArtCache", _onbArtCache);
  }

  function getArtistAvatarSvg(name) {
    const clean = String(name || "Artist").trim();
    const parts = clean.split(/\s+/);
    const initials = ((parts[0] && parts[0][0]) || "M") + ((parts[1] && parts[1][0]) || "");
    let hash = 0;
    for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
    const h1 = hash % 360;
    const h2 = (h1 + 48) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="hsl(${h1},70%,42%)"/><stop offset="100%" stop-color="hsl(${h2},75%,24%)"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><text x="60" y="68" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif" font-weight="700" font-size="40">${initials.toUpperCase()}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  async function hydrateOnbArtistAvatars(overlay) {
    if (!overlay) return;
    const imgs = Array.from(overlay.querySelectorAll("img[data-onb-artist-img]"));
    const countryCode = String((state.prefs && state.prefs.country) || "US").toUpperCase();
    for (const img of imgs) {
      const name = img.getAttribute("data-onb-artist-img") || "";
      if (!name) continue;
      if (_onbArtCache[name]) {
        img.src = _onbArtCache[name];
        continue;
      }
      try {
        const d = await api(`/api/catalog/proxy?provider=apple&path=${encodeURIComponent(`/search?term=${encodeURIComponent(name)}&media=music&entity=song&limit=1&country=${encodeURIComponent(countryCode)}`)}`, 5000);
        const row = d && Array.isArray(d.results) && d.results[0];
        if (row && row.artworkUrl100) {
          const hi = String(row.artworkUrl100).replace("100x100bb", "400x400bb");
          _onbArtCache[name] = hi;
          img.src = hi;
          saveOnbArtCache();
        }
      } catch {}
    }
  }

  function openTasteOnboarding() {
    if (localStorage.getItem("aura.onboarded") || state.prefs.onboarded) return;
    const existing = document.getElementById("tasteOnboardingOverlay");
    if (existing) existing.remove();

    const TOTAL_STEPS = 4;
    let step = 1;
    const selectedGenres = new Set(Array.isArray(state.prefs.tasteGenres) ? state.prefs.tasteGenres : []);
    const selectedMoods = new Set(Array.isArray(state.prefs.tasteMoods) ? state.prefs.tasteMoods : []);
    const selectedEras = new Set(Array.isArray(state.prefs.tasteEras) ? state.prefs.tasteEras : []);
    const selectedStyles = new Set(Array.isArray(state.prefs.tasteStyles) ? state.prefs.tasteStyles : []);
    const selectedArtists = new Set([
      ...(Array.isArray(state.prefs.tasteArtists) ? state.prefs.tasteArtists : []),
      ...((state.following || []).map((f) => f && f.name).filter(Boolean)),
    ]);
    let customSearchedArtists = [];
    let artistQuery = "";

    const overlay = document.createElement("div");
    overlay.id = "tasteOnboardingOverlay";
    overlay.className = "onb-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Personalize your music taste");

    const closeOnboarding = (saveSelections) => {
      window.__refreshTasteOnboarding = null;
      localStorage.setItem("aura.onboarded", "1");
      state.prefs.onboarded = true;
      if (saveSelections) {
        state.prefs.tasteGenres = Array.from(selectedGenres);
        state.prefs.tasteMoods = Array.from(selectedMoods);
        state.prefs.tasteEras = Array.from(selectedEras);
        state.prefs.tasteStyles = Array.from(selectedStyles);
        state.prefs.tasteArtists = Array.from(selectedArtists);
        // Sync selected artists into state.following using canonical artistKey ("name:...")
        const selectedLower = new Set(Array.from(selectedArtists).map((n) => String(n || "").toLowerCase().trim()).filter(Boolean));
        // Remove any previously followed artist that the user unchecked in the onboarding modal
        state.following = (state.following || []).filter((f) => {
          if (!f || !f.name) return false;
          return selectedLower.has(String(f.name).toLowerCase().trim());
        });
        for (const name of selectedArtists) {
          const clean = String(name || "").trim();
          if (!clean) continue;
          const key = artistKey(clean);
          if (!isFollowing(clean)) {
            state.following.unshift({
              key,
              name: clean,
              source: "catalog",
              handle: "",
              artwork: _onbArtCache[clean] || "/cover-default.jpg",
              lastId: "",
              followedAt: Date.now(),
            });
          }
        }
        saveFollowing({ replaceFollowing: true });
      }
      savePrefs();
      pushUserLibrary({ replaceFollowing: Boolean(saveSelections) });
      overlay.remove();
      if (saveSelections && (selectedGenres.size || selectedMoods.size || selectedEras.size || selectedStyles.size || selectedArtists.size)) {
        toast("Homepage personalized for your taste!", true, "success");
        state.tasteTracks = [];
        state.followedArtistTracks = [];
        loadTasteRecommendations(true);
        loadForYou();
        loadDiscoveryMix(true);
      }
      if (state.view === "home" || state.view === "settings") render();
    };

    const renderStep = () => {
      const curCountry = String((state.prefs && state.prefs.country) || "US").toUpperCase();
      const cName = countryName(curCountry);
      const countryOptionsHtml = COUNTRIES.map(([code, label]) =>
        `<option value="${escapeAttr(code)}" ${code === curCountry ? "selected" : ""}>${escapeHTML(label)}</option>`
      ).join("");

      const signedIn = Boolean(state.auth && state.auth.signedIn);
      const userProfile = (state.auth && state.auth.profile) || {};
      const googleCard = step === 1 ? `
        <div class="onb-auth-card">
          <div class="onb-auth-copy">
            ${signedIn
              ? `<strong>Signed in as ${escapeHTML(userProfile.name || userProfile.email || "Google User")}</strong>
                 <span>Your liked songs, playlists & taste sync automatically.</span>`
              : `<strong>Already used Muchi? Or want to sync across devices?</strong>
                 <span>Sign in with Google — returning users jump straight into the app with their saved library & taste.</span>`}
          </div>
          ${signedIn
            ? `<span class="chip active" style="pointer-events:none">✓ Connected</span>`
            : `<button type="button" class="onb-google-btn" id="onbGoogleLoginBtn">
                 <span class="material-symbols-outlined" style="font-size:18px">account_circle</span>
                 Continue with Google
               </button>`}
        </div>
      ` : "";

      let bodyHtml = "";
      let countHint = "";

      if (step === 1) {
        const genresForCountry = getOnboardGenresForCountry(curCountry);
        countHint = `${selectedGenres.size} selected`;
        bodyHtml = `
          ${googleCard}
          <div class="onb-head">
            <h2>What kind of songs do you like?</h2>
            <p>Tailored for <strong>${escapeHTML(cName)}</strong> — pick the music varieties you enjoy, or tap Skip anytime.</p>
          </div>
          <div class="onb-grid">
            ${genresForCountry.map((g) => {
              const on = selectedGenres.has(g.id);
              return `
                <button type="button" class="onb-tile ${on ? "selected" : ""}" data-onb-genre="${escapeAttr(g.id)}" style="--tile-clr:${g.color}">
                  <span class="onb-tile-check">✓</span>
                  <span class="onb-tile-title">${escapeHTML(g.title)}</span>
                  <span class="onb-tile-sub">${escapeHTML(g.sub)}</span>
                </button>
              `;
            }).join("")}
          </div>
        `;
      } else if (step === 2) {
        countHint = `${selectedMoods.size} selected`;
        bodyHtml = `
          <div class="onb-head">
            <h2>What moods match your vibe?</h2>
            <p>Choose the listening moments and moods you love — we'll build mixes around them.</p>
          </div>
          <div class="onb-grid">
            ${ONBOARD_MOODS.map((m) => {
              const on = selectedMoods.has(m.id);
              return `
                <button type="button" class="onb-tile ${on ? "selected" : ""}" data-onb-mood="${escapeAttr(m.id)}" style="--tile-clr:${m.color}">
                  <span class="onb-tile-check">✓</span>
                  <span class="onb-tile-title">${escapeHTML(m.title)}</span>
                  <span class="onb-tile-sub">${escapeHTML(m.sub)}</span>
                </button>
              `;
            }).join("")}
          </div>
        `;
      } else if (step === 3) {
        const stylesForCountry = getOnboardStylesForCountry(curCountry);
        countHint = `${selectedEras.size + selectedStyles.size} selected`;
        bodyHtml = `
          <div class="onb-head">
            <h2>How do you like your music mix?</h2>
            <p>Pick your favorite eras and how you want ${escapeHTML(cName)} & international songs blended.</p>
          </div>
          <h3 class="onb-subhead">Listening Style & Language Mix</h3>
          <div class="onb-grid" style="margin-bottom:18px">
            ${stylesForCountry.map((st) => {
              const on = selectedStyles.has(st.id);
              return `
                <button type="button" class="onb-tile ${on ? "selected" : ""}" data-onb-style="${escapeAttr(st.id)}" style="--tile-clr:${st.color}">
                  <span class="onb-tile-check">✓</span>
                  <span class="onb-tile-title">${escapeHTML(st.title)}</span>
                  <span class="onb-tile-sub">${escapeHTML(st.sub)}</span>
                </button>
              `;
            }).join("")}
          </div>
          <h3 class="onb-subhead">Favorite Music Eras</h3>
          <div class="onb-grid">
            ${ONBOARD_ERAS.map((er) => {
              const on = selectedEras.has(er.id);
              return `
                <button type="button" class="onb-tile ${on ? "selected" : ""}" data-onb-era="${escapeAttr(er.id)}" style="--tile-clr:${er.color}">
                  <span class="onb-tile-check">✓</span>
                  <span class="onb-tile-title">${escapeHTML(er.title)}</span>
                  <span class="onb-tile-sub">${escapeHTML(er.sub)}</span>
                </button>
              `;
            }).join("")}
          </div>
        `;
      } else {
        countHint = `${selectedArtists.size} followed`;
        const countryArtists = getOnboardArtistsForCountry(curCountry);
        // Keep local country artists and genre-matching artists at the top
        const sortedArtists = [
          ...customSearchedArtists,
          ...countryArtists.filter((a) => !customSearchedArtists.some((c) => c.name.toLowerCase() === a.name.toLowerCase())),
        ].sort((a, b) => {
          const aCustom = customSearchedArtists.some((c) => c.name.toLowerCase() === a.name.toLowerCase()) ? 4 : 0;
          const bCustom = customSearchedArtists.some((c) => c.name.toLowerCase() === b.name.toLowerCase()) ? 4 : 0;
          if (aCustom !== bCustom) return bCustom - aCustom;
          const aLocal = a.local ? 2 : 0;
          const bLocal = b.local ? 2 : 0;
          const aMatch = (a.genres || []).some((g) => selectedGenres.has(g)) ? 1 : 0;
          const bMatch = (b.genres || []).some((g) => selectedGenres.has(g)) ? 1 : 0;
          return (bLocal + bMatch) - (aLocal + aMatch);
        });
        bodyHtml = `
          <div class="onb-head">
            <h2>Which artists do you want to follow?</h2>
            <p>Featuring top artists from <strong>${escapeHTML(cName)}</strong> & global icons — we'll mix their songs with similar tracks you'll love.</p>
          </div>
          <div class="onb-search-row">
            <span class="material-symbols-outlined" style="font-size:20px;opacity:0.7">search</span>
            <input type="text" id="onbArtistSearchInput" placeholder="Search any artist from ${escapeAttr(cName)} or worldwide…" value="${escapeAttr(artistQuery)}" autocomplete="off" />
            <button type="button" class="chip-btn sm" id="onbArtistSearchBtn">Search</button>
          </div>
          <div class="onb-artists-grid" id="onbArtistsGrid">
            ${sortedArtists.map((a) => {
              const on = selectedArtists.has(a.name);
              const cachedArt = _onbArtCache[a.name] || getArtistAvatarSvg(a.name);
              return `
                <button type="button" class="onb-artist-card ${on ? "selected" : ""}" data-onb-artist="${escapeAttr(a.name)}">
                  <div class="onb-artist-avatar">
                    <img src="${escapeAttr(cachedArt)}" data-onb-artist-img="${escapeAttr(a.name)}" alt="${escapeAttr(a.name)}" loading="lazy" />
                    <div class="onb-artist-check"><span class="material-symbols-outlined">check</span></div>
                  </div>
                  <span class="onb-artist-name">${escapeHTML(a.name)}</span>
                  <span class="onb-artist-tag">${escapeHTML(a.tag || "Artist")}</span>
                </button>
              `;
            }).join("")}
          </div>
        `;
      }

      overlay.innerHTML = `
        <div class="onb-dialog">
          <div class="onb-top">
            <div class="onb-brand">
              <img src="${escapeAttr(activeAppIconUrl())}" alt="Muchi" />
              <span>Muchi Setup</span>
              <div class="onb-step-dots" aria-label="Step ${step} of ${TOTAL_STEPS}">
                <span class="onb-step-dot ${step === 1 ? "active" : "done"}"></span>
                <span class="onb-step-dot ${step === 2 ? "active" : step > 2 ? "done" : ""}"></span>
                <span class="onb-step-dot ${step === 3 ? "active" : step > 3 ? "done" : ""}"></span>
                <span class="onb-step-dot ${step === 4 ? "active" : ""}"></span>
              </div>
            </div>
            <div class="onb-top-actions">
              <label class="onb-country-pill" title="Detected country — change to see options & artists for another country">
                <span class="material-symbols-outlined" style="font-size:15px">public</span>
                <select id="onbCountrySelect" aria-label="Country">${countryOptionsHtml}</select>
              </label>
              <button type="button" class="onb-skip-top" id="onbSkipAllBtn">Skip</button>
            </div>
          </div>
          <div class="onb-body">
            ${bodyHtml}
          </div>
          <div class="onb-foot">
            <div class="onb-foot-left">
              ${step > 1 ? `<button type="button" class="chip-btn" id="onbBackBtn">Back</button>` : ""}
              <span class="onb-count-hint" id="onbCountHint">${escapeHTML(countHint)}</span>
            </div>
            <div class="onb-foot-right">
              <button type="button" class="chip-btn" id="onbSkipStepBtn">${step < TOTAL_STEPS ? "Skip question" : "Skip"}</button>
              <button type="button" class="filled-btn" id="onbNextBtn">${step < TOTAL_STEPS ? "Next" : "Done"}</button>
            </div>
          </div>
        </div>
      `;

      // Wire country selector inside onboarding
      const countrySel = overlay.querySelector("#onbCountrySelect");
      if (countrySel) {
        countrySel.addEventListener("change", () => {
          state.prefs.country = countrySel.value;
          state.prefs.countryChosen = true;
          savePrefs();
          try { localStorage.removeItem("aura.home_cache"); } catch {}
          state.home = null;
          loadHome(true);
          renderStep();
        });
      }

      // Wire events
      const skipAll = overlay.querySelector("#onbSkipAllBtn");
      if (skipAll) skipAll.addEventListener("click", () => closeOnboarding(true));

      const skipStep = overlay.querySelector("#onbSkipStepBtn");
      if (skipStep) {
        skipStep.addEventListener("click", () => {
          if (step < TOTAL_STEPS) {
            step += 1;
            renderStep();
          } else {
            closeOnboarding(true);
          }
        });
      }

      const backBtn = overlay.querySelector("#onbBackBtn");
      if (backBtn) {
        backBtn.addEventListener("click", () => {
          if (step > 1) {
            step -= 1;
            renderStep();
          }
        });
      }

      const nextBtn = overlay.querySelector("#onbNextBtn");
      if (nextBtn) {
        nextBtn.addEventListener("click", () => {
          if (step < TOTAL_STEPS) {
            step += 1;
            renderStep();
          } else {
            closeOnboarding(true);
          }
        });
      }

      const gBtn = overlay.querySelector("#onbGoogleLoginBtn");
      if (gBtn) {
        gBtn.addEventListener("click", () => {
          // Do NOT set aura.onboarded="1" yet: after Google login completes,
          // syncUserLibrary() will check if this Google account is an old/returning
          // user. Returning users will automatically skip onboarding & restore their
          // saved data, while brand-new users will continue onboarding!
          try { sessionStorage.setItem("aura.onb_pending_auth", "1"); } catch {}
          state.prefs.tasteGenres = Array.from(selectedGenres);
          state.prefs.tasteMoods = Array.from(selectedMoods);
          state.prefs.tasteEras = Array.from(selectedEras);
          state.prefs.tasteStyles = Array.from(selectedStyles);
          state.prefs.tasteArtists = Array.from(selectedArtists);
          savePrefs();
          startGoogleSignIn();
        });
      }

      overlay.querySelectorAll("[data-onb-genre]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-onb-genre");
          if (!id) return;
          if (selectedGenres.has(id)) selectedGenres.delete(id);
          else selectedGenres.add(id);
          btn.classList.toggle("selected", selectedGenres.has(id));
          const hint = overlay.querySelector("#onbCountHint");
          if (hint) hint.textContent = `${selectedGenres.size} selected`;
        });
      });

      overlay.querySelectorAll("[data-onb-mood]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-onb-mood");
          if (!id) return;
          if (selectedMoods.has(id)) selectedMoods.delete(id);
          else selectedMoods.add(id);
          btn.classList.toggle("selected", selectedMoods.has(id));
          const hint = overlay.querySelector("#onbCountHint");
          if (hint) hint.textContent = `${selectedMoods.size} selected`;
        });
      });

      overlay.querySelectorAll("[data-onb-style]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-onb-style");
          if (!id) return;
          if (selectedStyles.has(id)) selectedStyles.delete(id);
          else selectedStyles.add(id);
          btn.classList.toggle("selected", selectedStyles.has(id));
          const hint = overlay.querySelector("#onbCountHint");
          if (hint) hint.textContent = `${selectedEras.size + selectedStyles.size} selected`;
        });
      });

      overlay.querySelectorAll("[data-onb-era]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-onb-era");
          if (!id) return;
          if (selectedEras.has(id)) selectedEras.delete(id);
          else selectedEras.add(id);
          btn.classList.toggle("selected", selectedEras.has(id));
          const hint = overlay.querySelector("#onbCountHint");
          if (hint) hint.textContent = `${selectedEras.size + selectedStyles.size} selected`;
        });
      });

      overlay.querySelectorAll("[data-onb-artist]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const name = btn.getAttribute("data-onb-artist");
          if (!name) return;
          if (selectedArtists.has(name)) selectedArtists.delete(name);
          else selectedArtists.add(name);
          btn.classList.toggle("selected", selectedArtists.has(name));
          const hint = overlay.querySelector("#onbCountHint");
          if (hint) hint.textContent = `${selectedArtists.size} followed`;
        });
      });

      const searchInp = overlay.querySelector("#onbArtistSearchInput");
      const searchBtn = overlay.querySelector("#onbArtistSearchBtn");
      const runArtistSearch = async () => {
        const q = String((searchInp && searchInp.value) || "").trim();
        if (!q) return;
        artistQuery = q;
        if (searchBtn) {
          searchBtn.disabled = true;
          searchBtn.textContent = "Searching…";
        }
        try {
          const d = await api(`/api/search?q=${encodeURIComponent(q)}&${glq()}`, 8000);
          const found = [];
          const seen = new Set();
          for (const a of (d && d.artists) || []) {
            if (!a || !a.name) continue;
            const k = a.name.toLowerCase();
            if (seen.has(k)) continue;
            seen.add(k);
            if (a.artwork && a.artwork !== "/cover-default.jpg") _onbArtCache[a.name] = a.artwork;
            found.push({ name: a.name, tag: "Artist", genres: [], local: true });
          }
          for (const s of [...((d && d.apple) || []), ...((d && d.youtube) || [])]) {
            const nm = artistName(s);
            if (!nm || nm === "YouTube") continue;
            const k = nm.toLowerCase();
            if (seen.has(k)) continue;
            seen.add(k);
            if (s.artwork && s.artwork !== "/cover-default.jpg" && !_onbArtCache[nm]) _onbArtCache[nm] = s.artwork;
            found.push({ name: nm, tag: "Artist", genres: [], local: true });
            if (found.length >= 6) break;
          }
          if (found.length) {
            saveOnbArtCache();
            customSearchedArtists = [...found, ...customSearchedArtists.filter((x) => !found.some((f) => f.name.toLowerCase() === x.name.toLowerCase()))];
          }
        } catch {}
        renderStep();
      };
      if (searchBtn) searchBtn.addEventListener("click", runArtistSearch);
      if (searchInp) searchInp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runArtistSearch(); } });

      if (step === TOTAL_STEPS) {
        hydrateOnbArtistAvatars(overlay);
      }
    };

    window.__refreshTasteOnboarding = renderStep;
    document.body.appendChild(overlay);
    renderStep();
  }

  function maybeShowFirstLaunchOnboarding() {
    try {
      if (localStorage.getItem("aura.onboarded") || state.prefs.onboarded) return;
      // Only show on first-ever launch; wait briefly for opening splash to fade
      setTimeout(() => {
        if (!localStorage.getItem("aura.onboarded")) {
          openTasteOnboarding(false);
        }
      }, 1250);
    } catch {}
  }

  loadHome();
  loadTasteRecommendations();
  maybeShowFirstLaunchOnboarding();
  checkUpdates(true);
  // Automatically ensure any previously downloaded tracks have synced lyrics cached for offline playback
  setTimeout(() => {
    syncAllOfflineLyrics(false).catch(() => {});
  }, 3500);
  const homeStale = () => Date.now() - homeFetchedAt > 86400000 || (state.home && state.home.day !== utcDayClient());
  setInterval(() => {
    if (!document.hidden && homeStale()) loadHome(true);
  }, 3600000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && homeStale()) loadHome(true);
  });
})();
