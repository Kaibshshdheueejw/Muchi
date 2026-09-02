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
      codec: "auto",
      notifyFollows: true,
      github: "",
      username: "",
      avatar: "",
      ui: "glass",
      playerStyle: "pill",
      iconSize: "default",
    }, load("aura.prefs", {})),
    showProfile: false,
    downloads: [],
    following: [],
    forYou: [],
    discovery: load("aura.discovery", { week: "", tracks: [] }),
    homeTasteTab: "moods",
    sleep: { mode: "off", until: 0, timer: null },
    playerReady: false,
    detailTrack: null,
    settingsPage: null,
    catalogPlaylist: null,
  };
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
  const APP_VERSION = "1.2.1";

  const COUNTRIES = [
    ["IN", "India"], ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"],
    ["AU", "Australia"], ["DE", "Germany"], ["FR", "France"], ["JP", "Japan"],
    ["KR", "South Korea"], ["BR", "Brazil"], ["MX", "Mexico"], ["NG", "Nigeria"],
    ["ZA", "South Africa"], ["AE", "UAE"], ["SA", "Saudi Arabia"], ["PK", "Pakistan"],
    ["BD", "Bangladesh"], ["ID", "Indonesia"], ["MY", "Malaysia"], ["SG", "Singapore"],
    ["PH", "Philippines"], ["TH", "Thailand"], ["VN", "Vietnam"], ["EG", "Egypt"],
    ["IT", "Italy"], ["ES", "Spain"], ["TR", "Turkey"], ["NZ", "New Zealand"],
    ["NL", "Netherlands"], ["SE", "Sweden"],
  ];

  function countryName(code) {
    const hit = COUNTRIES.find((c) => c[0] === code);
    return hit ? hit[1] : code;
  }

  function savePrefs() { save("aura.prefs", state.prefs); }
  if (state.prefs.soundV !== 2) {
    if (!state.prefs.spatial || state.prefs.spatial === "off") state.prefs.spatial = "phone";
    state.prefs.soundV = 2;
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
    // Keep the Android status bar consistent with the in-app theme
    // (Capacitor StatusBar plugin; no-op on web/iOS).
    const P = nativePlugins();
    const SB = P && P.StatusBar;
    if (!SB || !window.Capacitor || !window.Capacitor.getPlatform || window.Capacitor.getPlatform() !== "android") return;
    const light = t === "light";
    try {
      SB.setStyle({ style: light ? "DARK" : "LIGHT" });
      SB.setBackgroundColor({ color: light ? "#e6eae6" : "#101413" });
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
  function applyUi() {
    const ui = state.prefs.ui === "material" ? "material" : "glass";
    document.documentElement.dataset.ui = ui;
    const ps = state.prefs.playerStyle;
    document.documentElement.dataset.player = ["pill", "island", "wave", "bar"].includes(ps) ? ps : "pill";
    const icons = ["small", "default", "medium", "large"].includes(state.prefs.iconSize) ? state.prefs.iconSize : "default";
    document.documentElement.dataset.icons = icons;
    const bar = $("playerBar");
    if (bar) bar.dataset.player = document.documentElement.dataset.player;
    syncPlayerVisibility();
  }
  function uiLabel() {
    return state.prefs.ui === "material" ? "Material 3" : "Glass UI";
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
    return `<button type="button" class="theme-card ${on ? "on" : ""}" data-set-theme="${th.id}">
      <div class="theme-preview" style="background:${bg};--tp-a:${th.a};--tp-b:${th.b}">
        <i class="tp-bar"></i><i class="tp-row"></i><i class="tp-row dim"></i><i class="tp-pill"></i>
      </div>
      <span><strong>${th.name}</strong><em>${th.blurb}</em></span>
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

  function hydrateLibrary() {
    state.liked = asArray(load("aura.liked", state.liked));
    state.recents = asArray(load("aura.recents", state.recents));
    state.following = asArray(load("aura.following", state.following));
    state.downloads = asArray(load("aura.downloads", state.downloads));
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

  async function api(path, timeoutMs = 18000, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = Object.assign({}, (opts && opts.headers) || {}, authHeaders());
      const res = await fetch(API_BASE + path, Object.assign({ signal: ctrl.signal }, opts || {}, { headers }));
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
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

  function isSaved(track) {
    if (!track) return false;
    const k = trackKey(track);
    return state.downloads.some((t) => trackKey(t) === k);
  }

  function toggleLike(track) {
    if (!track) return;
    const was = isLiked(track);
    if (was) state.liked = state.liked.filter((t) => trackKey(t) !== trackKey(track));
    else state.liked.unshift(track);
    save("aura.liked", state.liked);
    const btn = $("likeBtn");
    if (btn) {
      btn.classList.toggle("pop", !was);
      setTimeout(() => btn.classList.remove("pop"), 400);
    }
    renderChrome();
    if (!was) {
      burstHearts(btn);
      toast("Added to Liked Songs");
    } else {
      toast("Removed from Liked Songs");
    }
    if (state.view === "library" || state.view === "home") render();
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
    const canDl = track.source === "audius";
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
          ${track.source !== "radio" ? sheetItem("follow", isFollowing(track) ? "person_remove" : "person_add", isFollowing(track) ? "Unfollow artist" : "Follow artist") : ""}
          ${canDl ? sheetItem("dl", "download", isSaved(track) ? "Saved offline" : "Save offline") : ""}
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
        else if (act === "follow") toggleFollow(track);
        else if (act === "dl") downloadTrack(track);
        else if (act === "share") shareTrack(track);
        else if (act === "now") {
          const list = inLiked ? state.liked
            : inPl ? state.playlists[state.activePlaylist].tracks
            : state.queue;
          const i = list.findIndex((x) => x.id === track.id);
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
    save("aura.playlists", state.playlists);
    toast(`Removed from ${p.name}`, true, "success");
    if (state.view === "library") render();
  }

  function pushRecent(track) {
    const item = { ...track, playedAt: Date.now() };
    state.recents = [item, ...state.recents.filter((t) => t.id !== track.id)].slice(0, 200);
    save("aura.recents", state.recents);
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
    const h = audiusHandle(t);
    if (h) return `audius:${h.toLowerCase()}`;
    const n = artistName(t).toLowerCase();
    return n ? `name:${n}` : "";
  }
  function isFollowing(t) {
    const k = artistKey(t);
    return !!k && state.following.some((f) => f.key === k);
  }
  function saveFollowing() { save("aura.following", state.following); }

  function toggleFollow(track) {
    if (!track || track.source === "radio") {
      toast("Radio stations can’t be followed as artists");
      return;
    }
    const key = artistKey(track);
    if (!key) return;
    if (isFollowing(track)) {
      state.following = state.following.filter((f) => f.key !== key);
      saveFollowing();
      toast(`Unfollowed ${artistName(track)}`, true, "success");
    } else {
      state.following.unshift({
        key,
        name: artistName(track),
        source: track.source,
        handle: audiusHandle(track),
        artwork: artUrl(track),
        lastId: track.id,
        followedAt: Date.now(),
      });
      saveFollowing();
      toast(`Following ${artistName(track)}`, true, "success");
      if (state.prefs.notifyFollows && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    }
    renderChrome();
    if (state.view === "library" || state.view === "settings" || state.artistPage) render();
  }

  function tasteProfile() {
    const pool = [...(state.recents || []), ...(state.liked || [])];
    const artists = {};
    const sources = {};
    const genres = {};
    for (const t of pool) {
      if (!t) continue;
      const a = artistName(t);
      if (a && a !== "YouTube" && a !== "Live radio") artists[a] = (artists[a] || 0) + 1;
      sources[t.source || "other"] = (sources[t.source || "other"] || 0) + 1;
      if (t.genre) genres[t.genre] = (genres[t.genre] || 0) + 1;
      else if (t.album && t.source === "audius") genres[t.album] = (genres[t.album] || 0) + 1;
    }
    const rank = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
    return {
      plays: state.recents.length,
      liked: state.liked.length,
      following: state.following.length,
      artists: rank(artists).slice(0, 8),
      genres: rank(genres).slice(0, 6),
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
    const rest = state.queue.filter((t, i) => i !== state.index && t.id !== track.id);
    const cur = current();
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
    if (state.queue.some((t) => t.id === track.id)) {
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
    return `<span class="badge rd">Radio</span>`;
  }

  const IDB_NAME = "aura";
  const IDB_STORE = "downloads";
  function openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
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

  async function downloadTrack(t) {
    if (!t || t.source !== "audius" || !t.trackId) {
      toast("Only independent Audius tracks can be saved offline.");
      return;
    }
    if (state.downloads.some((d) => d.id === t.id)) {
      toast("Already saved on this device");
      return;
    }
    toast("Saving track…");
    try {
      const res = await fetch(`${API_BASE}/api/audius/file/${encodeURIComponent(t.trackId)}`);
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      await idbPut(t.id, blob);
      const meta = { ...t, savedAt: Date.now() };
      delete meta.streamUrl;
      state.downloads = [meta, ...state.downloads.filter((d) => d.id !== t.id)];
      save("aura.downloads", state.downloads);
      toast("Saved for offline", true, "success");
      if (IS_NATIVE && document.hidden) nativeNotifySaved(t.title);
      renderChrome();
      if (state.view === "settings" || state.view === "library" || state.view === "now" || state.view === "home") render();
    } catch (e) {
      console.error(e);
      toast("Could not save this track", true, "error");
    }
  }

  async function removeDownload(id) {
    await idbDel(id);
    state.downloads = state.downloads.filter((d) => d.id !== id);
    save("aura.downloads", state.downloads);
    toast("Removed offline file", true, "success");
    if (state.view === "settings" || state.view === "library") render();
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
  function spatialMode() {
    const m = state.prefs.spatial || "off";
    if (m === "wide" || m === "motion") return "spatial";
    if (m === "phone" || m === "bass" || m === "spatial" || m === "dynamic" || m === "off") return m;
    return "off";
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
  } catch {}
  function unlockSound() {
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
    if (state.prefs.normalize) vol *= 0.92;
    audio.volume = Math.min(1, vol);
    if (state.yt && state.yt.setPlaybackRate) {
      try { state.yt.setPlaybackRate(rate); } catch {}
    }
    hookSound();
    applyYtQuality();
  }

  const QUALITY_NAMES = { low: "Low", standard: "Standard", high: "High", highest: "Highest" };
  function qualityLabel() {
    const auto = (state.prefs.quality || "auto") === "auto";
    const r = resolvedQuality();
    return auto ? `Auto · ${QUALITY_NAMES[r] || "High"}` : (QUALITY_NAMES[r] || "High");
  }

  function baseVolume() {
    const vol = state.volume / 100;
    return state.prefs.normalize ? Math.min(1, vol * 0.88) : vol;
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
    if (!fade || !t || t.source === "youtube" || t.source === "radio") return;
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
      const m = Math.max(0, Math.ceil((state.sleep.until - Date.now()) / 60000));
      return m ? `${m} min left` : "Off";
    }
    return "Off";
  }

  function pauseForSleep() {
    if (state.sleep.timer) clearTimeout(state.sleep.timer);
    state.sleep = { mode: "off", until: 0, timer: null };
    state.playing = false;
    audio.pause();
    nativePausePlayback();
    if (state.yt && state.yt.pauseVideo) {
      try { state.yt.pauseVideo(); } catch {}
    }
    updateWakeLock();
    renderChrome();
    toast("Sleep timer — paused");
  }

  function setSleep(kind) {
    if (state.sleep.timer) clearTimeout(state.sleep.timer);
    if (kind === "off") {
      state.sleep = { mode: "off", until: 0, timer: null };
      toast("Sleep timer off");
    } else if (kind === "track") {
      state.sleep = { mode: "track", until: 0, timer: null };
      toast("Stops after this track");
    } else {
      const mins = Number(kind);
      state.sleep = {
        mode: "mins",
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
      const left = Math.round((state.sleep.until - Date.now()) / 60000);
      cur = [15, 30, 45, 60].reduce((best, n) => (Math.abs(n - left) < Math.abs(best - left) ? n : best), 15);
      cur = String(cur);
    }
    const nextKind = order[(order.indexOf(String(cur)) + 1) % order.length];
    setSleep(nextKind);
  }

  function artUrl(t) {
    return t && t.artwork ? t.artwork : "/cover-default.png";
  }

  function cardHTML(t) {
    const liked = isLiked(t);
    const saved = isSaved(t);
    return `
      <div class="card-wrap">
      <div class="card">
        <button type="button" class="card-hit" data-open-detail="${escapeAttr(t.id)}" title="Details">
          <div class="art">
            <img src="${escapeAttr(artUrl(t))}" alt="" loading="lazy" onerror="this.src='/cover-default.png'"/>
            ${sourceBadge(t.source)}
            ${liked ? `<span class="liked-dot"><span class="material-symbols-outlined filled">favorite</span></span>` : ""}
          </div>
          <h3>${escapeHTML(t.title)}</h3>
          <p>${escapeHTML(t.artist)}</p>
        </button>
        <button type="button" class="play-fab" data-play="${escapeAttr(t.id)}" title="Play">
          <span class="material-symbols-outlined filled">play_arrow</span>
        </button>
      </div>
      ${t.source === "audius" ? `<button type="button" class="card-dl ${saved ? "on" : ""}" data-dl="${escapeAttr(t.id)}" title="${saved ? "Saved offline" : "Save offline"}"><span class="material-symbols-outlined">${saved ? "download_done" : "download"}</span></button>` : ""}
      </div>`;
  }

  function rowHTML(t, i, extra = "") {
    return `
      <button class="track-row ${current() && current().id === t.id ? "active" : ""}" data-play="${escapeAttr(t.id)}" data-idx="${i}">
        <img src="${escapeAttr(artUrl(t))}" alt="" loading="lazy" onerror="this.src='/cover-default.png'"/>
        <div>
          <div class="t-title">${escapeHTML(t.title)}</div>
          <div class="t-sub">${escapeHTML(t.artist)}${t.source && t.source !== "apple" ? ` · ${escapeHTML(t.source)}` : ""}</div>
        </div>
        <span class="t-dur">${t.source === "radio" ? "LIVE" : fmt(t.duration)}</span>
        ${extra}
      </button>`;
  }

  function libTrackHTML(t, i) {
    return `
      <div class="track-row lib-track ${current() && current().id === t.id ? "active" : ""}">
        <button type="button" class="lib-track-main" data-play="${escapeAttr(t.id)}" data-idx="${i}">
          <img src="${escapeAttr(artUrl(t))}" alt="" loading="lazy" onerror="this.src='/cover-default.png'"/>
          <div>
            <div class="t-title">${escapeHTML(t.title)}</div>
            <div class="t-sub">${escapeHTML(t.artist)}</div>
          </div>
        </button>
        <button type="button" class="icon-btn more-btn" data-more="${escapeAttr(t.id)}" data-idx="${i}" title="More">
          <span class="material-symbols-outlined">more_vert</span>
        </button>
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
    return [].concat(
      shelves,
      h.youtubeCharts || [],
      h.youtubeLocal || [],
      h.youtubeIndia || [],
      h.audius || [],
      h.underground || [],
      h.radio || [],
      state.forYou || [],
      state.recents || []
    );
  }

  function findTrack(id) {
    try {
      const pools = [
        state.queue,
        state.liked,
        state.recents,
        state.radio,
        ...(state.playlists.map((p) => p.tracks)),
        state.downloads,
        homeTrackPool(),
        (state.catalogPlaylist && state.catalogPlaylist.tracks) || [],
        state.search ? [].concat(state.search.youtube, state.search.apple, state.search.audius, state.search.radio) : [],
        (state.artistPage && state.artistPage.songs) || [],
      ];
      for (const arr of pools) {
        const hit = (arr || []).find((t) => t && t.id === id);
        if (hit) return hit;
      }
    } catch {}
    return null;
  }

  function playFromList(list, index) {
    const next = list && list[index];
    const same = !!(next && current() && current().id === next.id);
    let src = Array.isArray(list) ? list.slice() : [];
    let idx = Number.isInteger(index) ? index : 0;
    // Queue hygiene: keep mixes/compilations/podcasts out of the queue so it
    // lists real songs (Spotify-style) — but never drop the track the user
    // actually tapped.
    if (src.some((t) => !looksLikeSong(t))) {
      const wanted = src[idx];
      const clean = [];
      for (let i = 0; i < src.length; i++) {
        if (i === idx || looksLikeSong(src[i])) clean.push(src[i]);
      }
      if (clean.length) {
        src = clean;
        idx = wanted ? Math.max(0, src.findIndex((t) => t && t.id === wanted.id)) : 0;
        // The rest of the context was all junk — line up good similar songs
        // after the one the user tapped (Spotify-style "up next").
        if (clean.length === 1 && list.length > 1 && wanted && wanted.source !== "radio") {
          fillRelatedQueue(wanted);
        }
      }
    }
    state.queue = src.slice();
    state.index = idx;
    state.playerReady = true;
    if (same) {
      if (!state.playing) togglePlay();
      renderQueue();
      syncPlayerVisibility();
      return;
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
  async function dzFetch(path, ms = 9000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(DZ_BASE + path, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error("deezer " + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }
  const dzFold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  async function deezerBrowserCatalog(name) {
    const want = dzFold(name);
    if (!want) return null;
    // Same matching rule as the worker: exact (accent-folded) name, else
    // the shortest "starts with" candidate — never a blind first row
    // ("adele" must not resolve to the duo "Adèle & Robin").
    const sj = await dzFetch(`/search/artist?q=${encodeURIComponent(String(name).slice(0, 80))}&limit=10`);
    const rows = (sj && sj.data) || [];

    let a = rows.find((r) => dzFold(r.name) === want);
    if (!a) {
      const cands = rows.filter((r) => dzFold(r.name).startsWith(want));
      if (cands.length) a = cands.sort((x, y) => dzFold(x.name).length - dzFold(y.name).length)[0];
    }
    if (!a || !a.id) return null;
    const artist = { name: a.name || name, artwork: a.picture_medium || "" };
    const dzSong = (t, srcArt) => (!t || !t.title) ? null : {
      id: `deezer:${t.id}`,
      source: "deezer",
      title: t.title,
      artist: (t.artist && t.artist.name) || artist.name,
      album: (t.album && t.album.title) || "",
      duration: Number(t.duration || 0),
      artwork: (t.album && t.album.cover_medium) || srcArt || "",
      playQuery: `${t.title} ${(t.artist && t.artist.name) || artist.name} official audio`.trim(),
    };
    // 1) Most popular tracks (Deezer ranks the artist's top list by popularity).
    const top = [];
    try {
      const tj = await dzFetch(`/artist/${a.id}/top?limit=50`);
      for (const t of (tj && tj.data) || []) { const s = dzSong(t, artist.artwork); if (s) top.push(s); }
    } catch {}
    // 2) Complete discography (offset pagination, capped at 100 albums).
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
        albums.push({
          id: `deezer-album:${al.id}`,
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
    // 3) Newest 8 albums → full track lists (correct order + album).
    const all = [...top];
    const seen = new Set(all.map((t) => dzFold(t.title) + "|" + dzFold(t.artist)));
    const expand = albums.slice(0, 8);
    for (let i = 0; i < expand.length; i += 4) {
      const chunk = expand.slice(i, i + 4);
      const res = await Promise.all(chunk.map((al) => dzFetch(`/album/${String(al.id).replace("deezer-album:", "")}`).catch(() => null)));
      for (const r of res) {
        const rows2 = (r && r.data && r.data.tracks && r.data.tracks.data) || [];
        for (const t of rows2) {
          const s = dzSong(t, (r && r.data && r.data.cover_medium) || artist.artwork);
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

  // ── iTunes Search (worldwide catalogue, CORS-open, no key) ─────────────
  // Backbone for the browser-side catalogue: up to 200 songs + 200 albums
  // per artist. Metadata only — playback resolves through the app's
  // normal search pipeline via playQuery, exactly like the Deezer rows.
  const ITUNES_BASE = "https://itunes.apple.com";
  async function itFetch(path, ms = 9000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(ITUNES_BASE + path, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error("itunes " + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }
  async function itunesBrowserCatalog(name) {
    const want = dzFold(name);
    if (!want) return null;
    const country = String((state.prefs && state.prefs.country) || "IN");
    // iTunes Search (verified API surface: term/entity/limit/country only —
    // there is no artist entity and no attribute param). Step 1 pulls the
    // artist's songs; the canonical artist name is derived from the
    // dominant artistName among rows that actually relate to the query,
    // so "post malone" never resolves to the Sam Feldt track that merely
    // features him.
    const ssj = await itFetch(`/search?term=${encodeURIComponent(String(name).slice(0, 80))}&entity=song&limit=200&country=${country}`);
    const rows = (ssj && ssj.results) || [];
    const related = rows.filter((t) => {
      const na = dzFold(t.artistName);
      return na && (na === want || na.includes(want) || want.includes(na));
    });
    if (!related.length) return null;
    const freq = new Map();
    for (const t of related.slice(0, 50)) {
      const na = dzFold(t.artistName);
      freq.set(na, (freq.get(na) || 0) + 1);
    }
    let an = "";
    let best = 0;
    for (const [k, v] of freq) if (v > best || (v === best && k.length > an.length)) { an = k; best = v; }
    const orig = related.find((t) => dzFold(t.artistName) === an) || related[0];
    const artistName = orig.artistName || name;
    const art = String(orig.artworkUrl100 || "").replace("100x100bb", "500x500bb");
    const itSong = (t) => (!t || !t.trackName) ? null : {
      id: `itunes:${t.trackId}`,
      source: "itunes",
      title: t.trackName,
      artist: t.artistName || artistName,
      album: t.collectionName || "",
      duration: Math.round(Number(t.trackTimeMillis || 0) / 1000),
      artwork: String(t.artworkUrl100 || "").replace("100x100bb", "300x300bb"),
      playQuery: `${t.trackName} ${t.artistName || artistName} official audio`.trim(),
    };
    // Strict artist match: the row's artist IS the canonical name or a
    // collaboration with it ("Post Malone & Swae Lee" keeps; a track that
    // merely mentions the name in its title does not).
    const byArtist = (na) => na === an || na.includes(an);
    const songs = [];
    for (const t of rows) if (byArtist(dzFold(t.artistName))) { const s = itSong(t); if (s) songs.push(s); }
    const sj2 = await itFetch(`/search?term=${encodeURIComponent(artistName.slice(0, 80))}&entity=album&limit=200&country=${country}`).catch(() => null);
    const albums = [];
    for (const t of (sj2 && sj2.results) || []) {
      if (!t || !t.collectionName) continue;
      // Album rows carry the collection's artist in artistName — an album
      // that only features the queried artist belongs to its main artist.
      if (!byArtist(dzFold(t.artistName))) continue;
      albums.push({
        id: `itunes-album:${t.collectionId}`,
        kind: "playlist",
        title: t.collectionName,
        artist: t.artistName || artistName,
        artwork: String(t.artworkUrl100 || "").replace("100x100bb", "300x300bb"),
        source: "itunes",
        query: `${t.collectionName} ${t.artistName || artistName}`.trim(),
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
    if (t.source === "audius" || t.source === "radio") return true;
    // Combined videos: 1–2 hour "songs" are mixes/compilations, not songs.
    const dur = Number(t.duration);
    if (dur > 1200) return false;
    const artist = String(t.artist || "").toLowerCase();
    const title = String(t.title || "").toLowerCase();
    if (/^(episode|podcast|clip|news|trailer|various artists|various)$/i.test(artist.trim())) return false;
    const text = `${title} ${artist}`;
    if (/\b(episode|podcast|trailer|full movie|gameplay|nato|imran khan|vlog|tutorial|reaction|unboxing|live stream)\b/i.test(text)) return false;
    // YouTube auto "Topic" channels re-upload with garbage metadata.
    if (/\btopic\b/i.test(artist)) return false;
    // YouTube search surfaces a lot of junk — hour-long mixes, compilations,
    // mashups, karaoke/instrumental covers, "best of" collections, re-upload
    // channels. Keep playlists/queues listing real songs like Spotify's.
    if (/\b(non[- ]?stop|full album|album mix|megamix|compilation|collection|dj set|live set|greatest hits|best of|billboard|top ?(?:10|20|40|50|100) ?(?:pop|english|hit|song|music|playlist)? ?songs?|hits ?(?:19\d\d|20\d\d|vol\.?\s*\d)|1 ?hour|one hour|hour mix|karaoke|instrumental|sped ?up|slowed|reverb|mashup|medley|mixtape|mix tape|playlist)\b/i.test(text)) return false;
    // "... mix" / "... remix" as the whole tail of a title is usually a
    // re-upload collection ("90s hits mix", "pop songs remix").
    if (/\b(?:mix|remix)\b\s*$/i.test(title)) return false;
    // Channel-style artists that just re-upload other people's songs.
    if (/\b(?:mix|remix|hits|top)\b/i.test(artist)) return false;
    return true;
  }

  async function fetchRelated(seed, extraSkip) {
    if (!seed || seed.source === "radio") return [];
    const artist = artistName(seed);
    const title = seed.title || "";
    const skip = [relatedSkip(seed), extraSkip || ""].filter(Boolean).join(",");
    const data = await api(
      `/api/related?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&skip=${encodeURIComponent(skip)}&${glq()}`,
      14000
    );
    return (data && data.tracks) || [];
  }

  async function fillRelatedQueue(seed) {
    const gen = ++relatedGen;
    if (!seed || seed.source === "radio") return;
    try {
      const rows = await fetchRelated(seed);
      if (gen !== relatedGen) return;
      if (!state.queue.some((t) => t && t.id === seed.id)) return;
      const have = new Set();
      state.queue.forEach((t) => {
        if (!t) return;
        if (t.id) have.add(t.id);
        if (t.videoId) have.add(t.videoId);
      });
      const extra = [];
      for (const t of rows) {
        if (!t || !looksLikeSong(t)) continue;
        if (have.has(t.id) || (t.videoId && have.has(t.videoId))) continue;
        have.add(t.id);
        if (t.videoId) have.add(t.videoId);
        extra.push(t);
        if (extra.length >= 20) break;
      }
      if (!extra.length) return;
      state.queue = state.queue.concat(extra);
      renderQueue();
    } catch {}
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
    const have = new Set(p.tracks.map((t) => t.id).filter(Boolean));
    p.tracks.forEach((t) => { if (t && t.videoId) have.add(t.videoId); });
    const seeds = [];
    const ts = p.tracks;
    seeds.push(ts[ts.length - 1]);
    if (ts[0] && ts[0].id !== seeds[0].id) seeds.push(ts[0]);
    if (ts.length > 2) {
      const mid = ts[Math.floor(ts.length / 2)];
      if (mid && !seeds.some((s) => s.id === mid.id)) seeds.push(mid);
    }
    const out = [];
    for (const seed of seeds.slice(0, 3)) {
      try {
        const rows = await fetchRelated(seed, [...have].join(","));
        for (const t of rows) {
          if (!t || !looksLikeSong(t) || have.has(t.id) || (t.videoId && have.has(t.videoId))) continue;
          have.add(t.id);
          if (t.videoId) have.add(t.videoId);
          out.push(t);
          if (out.length >= 10) break;
        }
      } catch {}
      if (out.length >= 10) break;
    }
    if (plRecs.key !== key) return;
    plRecs = { key, tracks: out, loading: false };
    if (state.view === "library" && state.activePlaylist === plIndex) render();
  }

  let failSkip = 0;
  let failSkipAt = 0;
  let playGen = 0;
  function skipFailed(msg) {
    const now = Date.now();
    if (now - failSkipAt > 12000) failSkip = 0;
    failSkipAt = now;
    failSkip += 1;
    if (failSkip === 1) toast(msg || "Could not play this track", true, "error");
    if (failSkip >= 3) {
      toast("Stopped skipping. Pick another song.");
      state.playing = false;
      renderChrome();
      return;
    }
    setTimeout(() => next(true), 450);
  }

  async function resolveYouTubePlay(t) {
    if (!t || t.videoId) return t;
    const q = String(t.playQuery || `${t.title || ""} ${t.artist || ""} official audio`).trim();
    if (!q) throw new Error("No playable version");
    let rows = [];
    try {
      const data = await api(`/api/youtube/search?q=${encodeURIComponent(q)}&${glq()}`, 14000);
      rows = data.tracks || data.youtube || [];
    } catch {}
    if (!Array.isArray(rows) || !rows.length) {
      try {
        const data = await api(`/api/search?q=${encodeURIComponent(q)}&source=youtube&${glq()}`, 14000);
        rows = data.youtube || [];
      } catch {}
    }
    const hit = (Array.isArray(rows) ? rows : []).find((x) => x && x.videoId);
    if (!hit) throw new Error("No playable version");
    t.videoId = hit.videoId;
    t.source = "youtube";
    if (!t.artwork || t.artwork === "/cover-default.png") t.artwork = hit.artwork;
    return t;
  }

  async function playCurrent(reset) {
    const t = current();
    if (!t) return;
    const gen = ++playGen;
    pushRecent(t);
    renderChrome();
    loadLyrics(t);
    stopTimer();
    try {
      if (t.source === "apple" || (t.source === "youtube" && !t.videoId)) {
        await resolveYouTubePlay(t);
      }
      if (gen !== playGen) return;
      if (t.videoId) await playYouTube(t, reset);
      else if (t.source === "youtube") throw new Error("No video");
      else await playAudio(t);
      if (gen !== playGen) return;
      failSkip = 0;
      state.playing = true;
      setWantPlay(true);
      showEl($("eqBars"), true);
      updateMediaSession();
      updateWakeLock();
    } catch (err) {
      console.error(err);
      if (gen === playGen) skipFailed("Could not play this track");
    }
    if (state.view === "now" && gen === playGen) render();
  }

  function stopOthers(keep) {
    if (keep !== "audio") {
      audio.pause();
      audio.removeAttribute("src");
      nativeStopPlayback();
    }
    if (keep !== "yt" && state.yt && state.yt.pauseVideo) {
      try { state.yt.pauseVideo(); } catch {}
    }
  }

  async function playAudio(t) {
    stopOthers("audio");
    let url = t.streamUrl;
    try {
      const blob = await idbGet(t.id);
      if (blob) url = URL.createObjectURL(blob);
    } catch {}
    if (!url && t.source === "audius" && t.trackId) {
      const data = await api(`/api/audius/stream/${encodeURIComponent(t.trackId)}`);
      url = data.url;
    }
    if (t.source === "radio") {
      if (t.stationId) fetch(`${API_BASE}/api/radio/click/${encodeURIComponent(t.stationId)}`).catch(() => {});
      // Same-origin deploys proxy radio streams through /api/stream. When talking
      // to a remote API base, the browser can play the resolved stream directly.
      if (url && /^https?:\/\//i.test(url) && !API_BASE) url = `/api/stream?url=${encodeURIComponent(url)}`;
    }
    if (!url) throw new Error("No stream");
    // Optional native background playback: the native Android/iOS shells ship
    // a MuchiAudio plugin (a foreground media service that keeps playing with
    // the screen locked, with the OS media notification + lock-screen
    // controls), so http(s) streams are handed to it. On the web there is no
    // native plugin, so audio plays in the WebView <audio> element.
    if (nativePlayer() && /^https?:\/\//i.test(url)) {
      if (nativePlayTrack(url, t.title, artistName(t) || t.artist, artUrl(t), t.duration || 0)) {
        setWantPlay(true);
        state.playing = true;
        showEl($("eqBars"), true);
        updateMediaSession();
        updateWakeLock();
        startTimer();
        return;
      }
    }
    playAudioWeb(url);
  }

  async function playAudioWeb(url) {
    const t = current();
    if (!t) return;
    audio.src = url;
    applyPlaybackPrefs();
    await audio.play();
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
          if (ytWanted) e.target.loadVideoById(ytWanted);
          e.target.playVideo();
          e.target.setVolume(state.volume);
        } catch {}
        if (typeof ytReadyResolve === "function") {
          const done = ytReadyResolve;
          ytReadyResolve = null;
          done(state.yt);
        }
      },
      onStateChange: (e) => {
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
          if (!wantPlay) {
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
        onYouTubeError(e && e.data);
      },
    };
  }

  function createYT(initialId) {
    if (typeof YT === "undefined" || !YT.Player) return null;
    const host = $("ytPlayer");
    if (!host) return null;
    const opts = {
      width: "360",
      height: "202",
      playerVars: {
        autoplay: 1,
        controls: 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        enablejsapi: 1,
        origin: location.origin,
        fs: 1,
        vq: ytQualityVq(),
      },
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
    ytWait = new Promise((resolve, reject) => {
      ytReadyResolve = resolve;
      rejectP = reject;
    });
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

  function onYouTubeError(code) {
    const want = ytWanted;
    const cur = current();
    if (!want || !cur || String(cur.videoId || "") !== String(want)) return;
    if (code === 100 || code === 101 || code === 150) {
      recoverYouTubeAlt(cur);
      return;
    }
    if (ytRetry < 3) {
      ytRetry += 1;
      setTimeout(() => retryYouTube(want, ytToken), 220 * ytRetry);
    }
  }

  async function recoverYouTubeAlt(t) {
    if (!t) return;
    const blocked = String(t.videoId || "");
    const q = String(t.playQuery || `${t.title || ""} ${t.artist || ""} official audio`).trim();
    if (!q) return;
    try {
      const data = await api(`/api/youtube/search?q=${encodeURIComponent(q)}&${glq()}`, 12000);
      const hit = (data.tracks || []).find((x) => x && x.videoId && x.videoId !== blocked);
      if (!hit || current() !== t) return;
      t.videoId = hit.videoId;
      ytRetry = 0;
      await playYouTube(t);
    } catch {}
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
        }, 120);
      } else {
        state.yt.loadVideoById(id);
      }
    } catch {}
  }

  function kickYouTube(id) {
    const player = state.yt;
    if (!player) return;
    try {
      if (typeof player.loadVideoById === "function") player.loadVideoById(id);
    } catch {}
    try { player.playVideo(); } catch {}
    try { player.setVolume(state.volume); } catch {}
    if (player.setPlaybackRate) {
      try { player.setPlaybackRate(Number(state.prefs.speed || 1)); } catch {}
    }
    applyYtQuality();
  }

  async function playYouTube(t) {
    if (!t || !t.videoId) throw new Error("No video");
    const id = String(t.videoId);
    ytToken += 1;
    const token = ytToken;
    ytWanted = id;
    ytSwitching = true;
    ytRetry = 0;
    stopOthers("yt");
    if (state.prefs.autoVideo || state.showVideo) {
      state.showVideo = true;
      showEl($("ytWrap"), true);
    }
    if (state.yt && typeof state.yt.loadVideoById === "function") {
      if (ytPlayingId() === id) {
        try { state.yt.playVideo(); } catch {}
        startTimer();
        return;
      }
      kickYouTube(id);
      startTimer();
      return;
    }
    const player = await ensureYT(id);
    if (token !== ytToken) return;
    if (!player) throw new Error("YouTube player missing");
    kickYouTube(id);
    startTimer();
  }

  function setQueueOpen(open) {
    state.showQueue = !!open;
    showEl($("queuePanel"), open);
    if ($("queuePanel")) $("queuePanel").classList.toggle("open", !!open);
    showEl($("scrim"), open || ($("sidebar") && $("sidebar").classList.contains("open")));
    if (open) {
      navPush();
      renderQueue();
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
    const t = current();
    if (!t) {
      if (state.recents[0]) playFromList(state.recents, 0);
      else testPlay();
      return;
    }
    if (t.videoId || t.source === "youtube") {
      const s = state.yt && state.yt.getPlayerState && state.yt.getPlayerState();
      if (state.yt && (s === 1 || s === 3)) {
        setWantPlay(false);
        try { state.yt.pauseVideo(); } catch {}
        state.playing = false;
      } else if (state.yt && s === 2) {
        setWantPlay(true);
        try { state.yt.playVideo(); } catch {}
        state.playing = true;
      } else {
        setWantPlay(true);
        playCurrent(true);
        return;
      }
    } else if (npActive && nativePlayer()) {
      if (npPlaying) {
        setWantPlay(false);
        nativePausePlayback();
        state.playing = false;
      } else {
        setWantPlay(true);
        nativeResumePlayback();
        state.playing = true;
      }
    } else if (audio.paused) {
      setWantPlay(true);
      audio.play();
      state.playing = true;
    } else {
      setWantPlay(false);
      audio.pause();
      state.playing = false;
    }
    if (state.playing && !state.timer) startTimer();
    updateMediaSession();
    renderChrome();
    if (state.playing) burstHearts($("playBtn"));
  }

  function next(force) {
    if (!state.queue.length) return;
    if (!force && state.sleep.mode === "track") {
      pauseForSleep();
      return;
    }
    if (!force && !state.prefs.autoplay) {
      state.playing = false;
      renderChrome();
      return;
    }
    if (state.repeat === "one" && !force) return playCurrent(true);
    if (state.shuffle) {
      state.index = Math.floor(Math.random() * state.queue.length);
    } else if (state.index + 1 < state.queue.length) {
      state.index += 1;
    } else if (state.repeat === "all") {
      state.index = 0;
    } else {
      state.playing = false;
      renderChrome();
      return;
    }
    playCurrent(true);
  }

  function prev() {
    const pos = position();
    if (pos > 3) return seekTo(0);
    state.index = (state.index - 1 + state.queue.length) % state.queue.length;
    playCurrent(true);
  }

  function position() {
    const t = current();
    if (!t) return 0;
    if (npActive) return npPos || 0;
    if (t.source === "youtube" && state.yt && state.yt.getCurrentTime) return state.yt.getCurrentTime() || 0;
    return audio.currentTime || 0;
  }

  function duration() {
    const t = current();
    if (!t) return 0;
    if (t.source === "radio") return 0;
    if (npActive) return npDur || t.duration || 0;
    if (t.source === "youtube" && state.yt && state.yt.getDuration) return state.yt.getDuration() || t.duration || 0;
    return audio.duration && isFinite(audio.duration) ? audio.duration : t.duration || 0;
  }

  function seekTo(sec) {
    const t = current();
    if (!t || t.source === "radio") return;
    const at = Math.max(0, Number(sec) || 0);
    if (npActive && nativeSeekTo(at)) { updateProgress(); return; }
    if ((t.source === "youtube" || t.videoId) && state.yt && state.yt.seekTo) state.yt.seekTo(at, true);
    else audio.currentTime = at;
    updateProgress();
  }

  let waveRaf = 0;
  let waveLast = 0;
  function cheapPhone() {
    return !!(window.matchMedia && (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 980px)").matches));
  }
  function startTimer() {
    stopTimer();
    const cheap = cheapPhone();
    state.timer = setInterval(updateProgress, cheap ? 1500 : 500);
    if (!cheap) {
      const loop = (now) => {
        if (!state.playing) {
          waveRaf = 0;
          drawSeekWave();
          return;
        }
        if (!waveLast || now - waveLast > 80) {
          drawSeekWave();
          waveLast = now;
        }
        waveRaf = requestAnimationFrame(loop);
      };
      waveRaf = requestAnimationFrame(loop);
    } else {
      drawSeekWave();
    }
    updateProgress();
    renderChrome();
  }
  function stopTimer() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    if (waveRaf) cancelAnimationFrame(waveRaf);
    waveRaf = 0;
  }

  function updateProgress() {
    const d = duration();
    const p = position();
    tickCrossfade(d, p);
    updateMediaPosition();
    msPosTick = (msPosTick || 0) + 1;
    if (msPosTick % 5 === 0) updateMediaSession();
    if (document.hidden && cheapPhone()) return;
    $("curTime").textContent = fmt(p);
    $("durTime").textContent = current() && current().source === "radio" ? "LIVE" : fmt(d);
    const seek = $("seek");
    if (seek) {
      const tv = d ? Math.round((p / d) * 1000) : 0;
      if (seek.matches(":active")) {
        seekCur = -1; seekTgt = -1;
        if (seekRaf) { cancelAnimationFrame(seekRaf); seekRaf = 0; }
      } else if (prefersReducedMotion()) {
        seek.value = tv;
      } else {
        seekTgt = tv;
        if (seekCur < 0) seekCur = Number(seek.value) || 0;
        if (!seekRaf) seekRaf = requestAnimationFrame(seekTick);
      }
    }
    if (!cheapPhone()) drawSeekWave();
    highlightLyric(p);
    nativeTickControls();
  }
  let msPosTick = 0;

  let seekCur = -1, seekTgt = -1, seekRaf = 0;
  function seekTick() {
    const seek = $("seek");
    if (!seek || seek.matches(":active") || seekTgt < 0) { seekRaf = 0; return; }
    const diff = seekTgt - seekCur;
    if (Math.abs(diff) < 0.25) {
      seek.value = seekTgt;
      seekCur = -1; seekTgt = -1; seekRaf = 0;
      return;
    }
    seekCur += diff * 0.28;
    seek.value = Math.round(seekCur);
    seekRaf = requestAnimationFrame(seekTick);
  }
  function prefersReducedMotion() {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function drawSeekWave() {
    const svg = $("seekWave");
    const seek = $("seek");
    if (!svg || !seek) return;
    const playing = !!state.playing;
    const style = document.documentElement.dataset.player || "pill";
    const strong = style === "wave" || style === "pill";
    const v = Number(seek.value) || 0;
    const t = Date.now() / 240;
    const W = 400, mid = 8;
    const amp = !playing ? 0.4 : strong ? 4.4 : 2.2;
    const filled = (v / 1000) * W;
    let d = `M 0 ${mid}`;
    for (let x = 0; x <= W; x += 5) {
      const live = x <= filled ? 1 : 0.28;
      const y = mid + Math.sin(x / 16 + t) * amp * live + Math.sin(x / 7 + t * 1.4) * (amp * 0.28) * live;
      d += ` L ${x} ${y.toFixed(2)}`;
    }
    let path = svg.querySelector("path");
    if (!path) {
      path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
    }
    path.setAttribute("d", d);
    path.setAttribute("stroke-width", playing ? (strong ? "2.4" : "2") : "1.6");
  }

  function setVolume(v) {
    state.volume = v;
    save("aura.vol", v);
    const vol = v / 100;
    audio.volume = Math.min(1, state.prefs.normalize ? vol * 0.92 : vol);
    if (state.yt && state.yt.setVolume) {
      try { state.yt.setVolume(Math.min(100, Math.round(v))); } catch {}
      try { if (state.yt.unMute) state.yt.unMute(); } catch {}
    }
    hookSound();
    syncAndroid();
  }

  let wantPlay = false;
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

  function keepBackgroundPlay() {
    if (state.prefs.bgPlay === false || !wantPlay) return;
    unlockSound();
    const t = current();
    if (!t) return;
    if (t.videoId || t.source === "youtube") {
      if (!state.yt || !state.yt.getPlayerState) return;
      let s = -1;
      try { s = state.yt.getPlayerState(); } catch {}
      if (s === 2 || s === -1 || s === 5) {
        try { state.yt.playVideo(); } catch {}
      }
    } else if (npActive && !npPlaying) {
      nativeResumePlayback();
    } else if (audio.paused && audio.src && !audio.ended) {
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
  let mcCreated = false;
  let mcLastElapsed = -1;
  function nativePlugins() {
    if (!IS_NATIVE || !window.Capacitor || !window.Capacitor.Plugins) return null;
    return window.Capacitor.Plugins;
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
  let npDur = 0;          // last known duration (s)
  let npPermAsked = false; // one-time native notification permission ask
  function nativeEnsureNotifyPermission() {
    // Android 13+ POST_NOTIFICATIONS for the background media notification
    // (lock-screen controls still work without it; only the notification
    // banner waits for the grant). Canonical Capacitor flow: the plugin
    // declares the permission natively, JS asks once. Never blocks playback.
    const NP = nativePlayer();
    if (npPermAsked || !NP || typeof NP.checkPermissions !== "function") return;
    npPermAsked = true;
    NP.checkPermissions()
      .then((st) => {
        if (st && st.muchi_audio === "prompt" && typeof NP.requestPermissions === "function") {
          NP.requestPermissions().catch(() => {});
        }
      })
      .catch(() => {});
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
  function nativePlayTrack(url, title, artist, artwork, durationSec) {
    const NP = nativePlayer();
    if (!NP) return false;
    nativeEnsureNotifyPermission();
    // The Media3 notification replaces the legacy MusicControls one.
    const P = nativePlugins();
    const MC = P && P.MusicControls;
    if (MC) { try { MC.destroy().catch(() => {}); } catch {} }
    npActive = true;
    npPlaying = true;
    npPos = 0;
    npDur = Number(durationSec) || 0;
    NP.play({
      url: String(url),
      title: String(title || "Muchi"),
      artist: String(artist || ""),
      artwork: String(artwork || ""),
      duration: Math.round((Number(durationSec) || 0) * 1000),
    }).catch(() => {
      // Native playback failed — fall back to the WebView audio element.
      if (npActive) npActive = false;
      playAudioWeb(url);
    });
    return true;
  }
  function nativePausePlayback() {
    const NP = nativePlayer();
    if (!NP || !npActive) return;
    npPlaying = false;
    NP.pause().catch(() => {});
  }
  function nativeResumePlayback() {
    const NP = nativePlayer();
    if (!NP || !npActive) return;
    npPlaying = true;
    NP.resume().catch(() => {});
  }
  function nativeStopPlayback() {
    const NP = nativePlayer();
    if (!NP || !npActive) return;
    npActive = false;
    npPlaying = false;
    npPos = 0;
    NP.stop().catch(() => {});
  }
  function nativeSeekTo(sec) {
    const NP = nativePlayer();
    if (!NP || !npActive) return false;
    npPos = Math.max(0, Number(sec) || 0);
    NP.seekTo({ position: Math.round(npPos * 1000) }).catch(() => {});
    return true;
  }
  function nativeSyncMediaControls() {
    // When the real native player (Media3) is active it owns the OS media
    // notification/lock-screen surface — don't double-create MusicControls.
    if (npActive) return;
    const P = nativePlugins();
    const MC = P && P.MusicControls;
    if (!MC) return;
    const t = current();
    const playing = !!(wantPlay || state.playing);
    const name = t ? String(t.title || "Muchi") : "Muchi";
    const artist = t ? String(artistName(t) || t.artist || "") : "";
    const album = t && t.album ? String(t.album) : "Muchi";
    const cover = t ? artUrl(t) : "";
    const dur = Math.round(duration() || 0);
    const pos = Math.round(position() || 0);
    if (!mcCreated) {
      MC.create({
        track: name,
        artist,
        album,
        cover,
        isPlaying: playing,
        hasPrev: true,
        hasNext: true,
        hasClose: false,
        hasScrubbing: true,
        duration: dur,
        elapsed: pos,
        ticker: playing ? `Now playing "${name}"` : "Muchi",
      }).then(() => { mcCreated = true; }).catch(() => {});
    } else {
      try { MC.updateIsPlaying({ isPlaying: playing }); } catch {}
      try { MC.updateElapsed({ elapsed: pos, isPlaying: playing }); } catch {}
    }
  }
  function nativeTickControls() {
    const P = nativePlugins();
    const MC = P && P.MusicControls;
    if (!MC || !mcCreated || !current()) return;
    const pos = Math.round(position() || 0);
    if (Math.abs(pos - mcLastElapsed) >= 1) {
      mcLastElapsed = pos;
      try { MC.updateElapsed({ elapsed: pos, isPlaying: !!(wantPlay || state.playing) }); } catch {}
    }
  }
  function nativeHandleControls(action) {
    if (!action) return;
    const msg = action.message || action;
    if (msg === "music-controls-play") { setWantPlay(true); if (!state.playing) togglePlay(); }
    else if (msg === "music-controls-pause" || msg === "music-controls-destroy") { setWantPlay(false); if (state.playing) togglePlay(); }
    else if (msg === "music-controls-next") next(true);
    else if (msg === "music-controls-previous") prev();
    else if (msg === "music-controls-toggle-play-pause") togglePlay();
    else if (msg === "music-controls-seek-to" || msg === "music-controls-skip-to") {
      const sec = Number(action.position != null ? action.position : action.seekTo);
      if (isFinite(sec)) seekTo(sec);
    } else if (msg === "music-controls-headset-unplugged") {
      setWantPlay(false);
      if (state.playing) togglePlay();
    } else if (msg === "play") { setWantPlay(true); if (!state.playing) togglePlay(); }
    else if (msg === "pause") { setWantPlay(false); if (state.playing) togglePlay(); }
    else if (msg === "next") next(true);
    else if (msg === "previous") prev();
    else if (msg === "seek") {
      const sec = Number(action.position != null ? action.position : action.seekTo);
      if (isFinite(sec)) seekTo(sec);
    } else if (msg === "ended") {
      next(true);
    } else if (msg === "error") {
      if (npActive) { npActive = false; }
      if (state.playing && current()) skipFailed("Playback error");
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
    }
    const MC = P.MusicControls;
    if (MC) {
      try {
        if (window.Capacitor.getPlatform() === "ios") {
          MC.addListener("controlsNotification", (info) => nativeHandleControls(info));
        } else {
          document.addEventListener("controlsNotification", (e) => nativeHandleControls({ message: e.message, position: e.position }));
        }
      } catch {}
    }
    const NP = P.MuchiAudio;
    if (NP) {
      try {
        NP.addListener("muchiControls", (e) => nativeHandleControls(e || {}));
        NP.addListener("muchiProgress", (e) => {
          const v = e || {};
          npPos = (Number(v.positionMs) || 0) / 1000;
          npDur = (Number(v.durationMs) || 0) / 1000;
          npPlaying = !!v.playing;
          if (state.playing) updateProgress();
        });
      } catch {}
    }
  }
  initNativeBridge();

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
      const d = await api("/api/youtube/liked");
      state.ytLiked = { tracks: (d && d.tracks) || [], truncated: !!(d && d.truncated) };
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
      const d = await api("/api/youtube/playlists");
      state.ytPlaylists = (d && d.playlists) || [];
      state.ytReconnect = false;
    } catch (err) {
      state.ytPlaylists = { error: true };
      if (String((err && err.message) || "").indexOf("youtube") >= 0) state.ytReconnect = true;
    }
    if (state.view === "library") render();
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
            if (state.view === "settings" || state.view === "library") render();
          });
        }
      } else if (pathname === "youtube/success") {
        refreshAuth(true).then(() => {
          toast("YouTube connected");
          if (state.view === "settings" || state.view === "library") render();
        });
      } else if (pathname === "auth/error" || pathname === "youtube/error") {
        toast("Google sign-in was cancelled or failed");
      }
      return true;
    } catch { return false; }
  }
  async function initAuth() {
    // Web: the OAuth callback redirects back to "/?auth=success" etc.
    let touched = false;
    try {
      const params = new URLSearchParams(window.location.search || "");
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

  function lyricsBodyHTML() {
    const L = state.lyrics;
    if (!L) return `<div class="ly-wait">Looking up lyrics…</div>`;
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
      el.addEventListener("click", () => {
        lyFollow = true;
        seekTo(Number(el.dataset.lyT) || 0);
      });
    });
  }

  function paintLyricsBox() {
    const box = $("lyScroll");
    if (!box) return false;
    box.innerHTML = lyricsBodyHTML();
    bindLyricLines(box);
    highlightLyric(position());
    return true;
  }

  async function loadLyrics(t) {
    if (!t || t.source === "radio") {
      state.lyrics = { lyrics: "", synced: [], key: lyricsKey(t) };
      if (state.view === "now") paintLyricsBox() || render();
      return;
    }
    const key = lyricsKey(t);
    if (state.lyrics && state.lyrics.key === key && (state.lyrics.lyrics || (state.lyrics.synced && state.lyrics.synced.length))) {
      if (state.view === "now") paintLyricsBox();
      return;
    }
    const gen = ++lyricsGen;
    lyActive = -1;
    state.lyrics = { key, lyrics: "", synced: [] };
    const cleanTitle = String(t.title || "").replace(/\s*[\[(][^)\]]*(official|audio|video|lyric|visualizer)[^)\]]*[)\]]/gi, "").trim() || t.title;
    const artist = artistName(t) || String(t.artist || "").split("·")[0].replace(/youtube/ig, "").trim();
    try {
      const data = await api(`/api/lyrics?title=${encodeURIComponent(cleanTitle)}&artist=${encodeURIComponent(artist)}`, 14000);
      if (gen !== lyricsGen) return;
      state.lyrics = { lyrics: (data && data.lyrics) || "", synced: (data && data.synced) || [], key };
    } catch {
      if (gen !== lyricsGen) return;
      state.lyrics = { lyrics: "", synced: [], key };
    }
    if (state.view === "now") paintLyricsBox() || render();
  }

  function highlightLyric(p) {
    const box = $("lyScroll") || document.querySelector(".lyrics");
    const lines = box ? box.querySelectorAll("[data-ly]") : document.querySelectorAll("[data-ly]");
    if (!lines.length || !state.lyrics || !state.lyrics.synced || !state.lyrics.synced.length) return;
    let active = -1;
    const rows = state.lyrics.synced;
    for (let i = 0; i < rows.length; i++) {
      if (p >= (Number(rows[i].t) || 0)) active = i;
    }
    if (active === lyActive) return;
    lines.forEach((el, i) => {
      el.classList.toggle("on", i === active);
      el.classList.toggle("past", i < active);
    });
    lyActive = active;
    const on = active >= 0 ? lines[active] : null;
    if (!on || !lyFollow) return;
    lyProg = true;
    try {
      on.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    } catch {
      if (box) {
        const top = on.offsetTop - box.clientHeight / 2 + on.clientHeight / 2;
        box.scrollTop = Math.max(0, top);
      }
    }
    clearTimeout(highlightLyric._t);
    highlightLyric._t = setTimeout(() => { lyProg = false; }, 480);
  }

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
    if (wash) wash.style.backgroundImage = `url("${src}")`;
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
    state.showQueue = false;
    showEl($("queuePanel"), false);
    if ($("queuePanel")) $("queuePanel").classList.remove("open");
    showEl($("scrim"), false);
    syncPlayerVisibility();
  }

  function renderChrome() {
    const t = current();
    const coverImg = $("coverArt");
    const artSrc = t ? artUrl(t) : "/cover-default.png";
    if (coverImg && coverImg.getAttribute("src") !== artSrc) {
      coverImg.setAttribute("src", artSrc);
      coverImg.classList.remove("art-swap");
      void coverImg.offsetWidth;
      coverImg.classList.add("art-swap");
    }
    themeFromTrack(t);
    $("trackTitle").textContent = t ? t.title : "Nothing playing";
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
      const can = !!(t && t.source === "audius");
      const saved = !!(t && isSaved(t));
      dl.classList.toggle("on", saved);
      dl.classList.toggle("dim", !can);
      dl.title = !t ? "Save offline" : !can ? "Only Audius tracks can be saved" : saved ? "Saved offline" : "Save offline";
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
    $("volume").value = state.volume;
    updateWakeLock();
    document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
    syncPlayerVisibility();
    nativeSyncMediaControls();
  }

  function renderQueue() {
    const el = $("queueList");
    if (!el) return;
    if (!state.queue.length) {
      el.innerHTML = `<div class="empty">Queue is empty</div>`;
      if ($("queueSub")) $("queueSub").textContent = "Play next · drag to reorder";
      return;
    }
    const upcoming = Math.max(0, state.queue.length - 1);
    if ($("queueSub")) $("queueSub").textContent = `${state.queue.length} in queue · ${upcoming} up next`;
    el.innerHTML = state.queue.map((t, i) => {
      const now = i === state.index;
      return `
        <div class="q-row ${now ? "now" : ""}" draggable="true" data-q-i="${i}">
          <span class="q-handle" title="Drag to reorder">⋮⋮</span>
          <img src="${escapeAttr(artUrl(t))}" alt="" onerror="this.src='/cover-default.png'"/>
          <button type="button" class="q-main" data-play="${escapeAttr(t.id)}" data-idx="${i}">
            <div class="t-title">${escapeHTML(t.title)}</div>
            <div class="t-sub">${escapeHTML(t.artist)}</div>
          </button>
          ${now ? `<span class="q-now-tag">Now</span>` : `<button type="button" class="icon-btn q-del" data-q-del="${i}" title="Remove"><span class="material-symbols-outlined">close</span></button>`}
        </div>`;
    }).join("");
  }

  function renderPlaylistsNav() {
    if (!$("playlistNav")) return;
    $("playlistNav").innerHTML = [
      `<button data-open-liked>Liked songs · ${state.liked.length}</button>`,
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
      save("aura.playlists", state.playlists);
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
        <button type="button" class="avatar-btn" id="profileBtn" title="${escapeAttr(name || "Profile")}">${avatarInner()}</button>
      </div>
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
        </div>` : ""}`;
  }

  function renderHome() {
    const h = state.home;
    if (!h) {
      return `
        ${homeBarHTML()}
        <div class="hero">
          <div>
            <h1>${greeting()}</h1>
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
    return `
      ${homeBarHTML()}
      <div class="hero home-hero">
        <div class="hero-orbs" aria-hidden="true"><i></i><i></i><i></i></div>
        <div>
          <h1>${greeting()}</h1>
          <p>English hits · pop, hip-hop, rock, R&amp;B, dance · a little from ${escapeHTML(region)}${liveNote}</p>
        </div>
      </div>
      <div class="section">
        <div class="section-head"><h2>${tasteProfile().plays ? "For your taste" : "Moods & genres"}</h2></div>
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
      ${playlistSection(`Trending in ${region}`, h.countryPlaylists || [], "country")}
      ${section(`Top songs in ${region}`, local, "local")}
      ${playlistSection("Global trending playlists", h.globalPlaylists || [], "global")}
      ${shelves.map((s) => section(s.title, s.tracks, s.id || s.title)).join("")}
      ${section("Independent artists", h.audius, "audius")}
      ${section("Underground", h.underground, "underground")}
      ${section("Live radio", h.radio, "radio")}
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
    return `<div class="section"><div class="section-head">${heading}${open}</div><div class="row">${rows.length ? rows.map(cardHTML).join("") : `<p class="empty">Open to load songs</p>`}</div></div>`;
  }

  function plCardHTML(p, group, i) {
    const art = p.artwork || (p.tracks && p.tracks[0] && p.tracks[0].artwork) || "/cover-default.png";
    return `<div class="card-wrap">
      <button type="button" class="card card-hit" data-open-home-pl="${escapeAttr(group)}" data-pl-i="${i}">
        <div class="art">
          <img src="${escapeAttr(art)}" alt="" loading="lazy" onerror="this.src='/cover-default.png'"/>
          <span class="badge yt">Playlist</span>
        </div>
        <h3>${escapeHTML(p.title || "Playlist")}</h3>
        <p>${escapeHTML(p.artist || "Daily mix")}</p>
      </button>
    </div>`;
  }

  function playlistSection(title, playlists, group) {
    if (!playlists || !playlists.length) return "";
    return `<div class="section"><div class="section-head"><h2>${title}</h2><span>${playlists.length}</span></div><div class="row">${playlists.map((p, i) => plCardHTML(p, group, i)).join("")}</div></div>`;
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

  function forYouPlaylistList() {
    const h = state.home || {};
    let pls = (h.forYouPlaylists || []).slice();
    // Mix playlists only make sense once the user has some taste (likes/follows).
    const taste = tasteProfile();
    if (!taste.artists.length && !taste.genres.length) pls = pls.filter((p) => p.kind !== "mix");
    // If the API hasn't sent curated playlists yet (e.g. preview against an
    // older server), build sensible defaults so the format still works.
    if (!pls.length) {
      const cache = fyCardCache();
      const defs = [
        { id: "fy-trending", title: "Trending", subtitle: "What the world is playing", artwork: "", playlistId: "", query: "trending music hits", kind: "yt" },
        { id: "fy-releases", title: "Hit Releases", subtitle: "Fresh hits, just out", artwork: "", playlistId: "", query: "new hit releases official audio", kind: "yt" },
        { id: "fy-top50", title: "Top 50 Global", subtitle: "The biggest songs right now", artwork: "", playlistId: "", query: "top 50 global hits official audio", kind: "yt" },
        { id: "fy-dance", title: "Dance Hits", subtitle: "Club-ready anthems", artwork: "", playlistId: "", query: "dance hits official audio", kind: "yt" },
        { id: "fy-chillv", title: "Chill Vibes", subtitle: "Easy listening, all day", artwork: "", playlistId: "", query: "chill vibes songs official audio", kind: "yt" },
        { id: "fy-workout", title: "Workout Energy", subtitle: "Push through the burn", artwork: "", playlistId: "", query: "workout motivation songs official audio", kind: "yt" },
        { id: "fy-indie", title: "Indie Radar", subtitle: "Fresh independent sounds", artwork: "", playlistId: "", query: "indie alternative hits official audio", kind: "yt" },
        { id: "fy-throw", title: "Throwback", subtitle: "90s & 2000s classics", artwork: "", playlistId: "", query: "throwback 90s 2000s hits official audio", kind: "yt" },
      ];
      if (taste.artists.length || taste.genres.length) {
        defs.push({ id: "fy-mix", title: "Your Mix", subtitle: "From artists you like", artwork: "", playlistId: "", query: "", kind: "mix" });
        defs.push({ id: "fy-chill", title: "Chill Mix", subtitle: "Easy listening", artwork: "", playlistId: "", query: "", kind: "mix" });
      }
      for (const d of defs) {
        const c = d.query && cache[d.query];
        if (c && c.id) d.playlistId = c.id;
        if (c && c.art) d.artwork = c.art;
      }
      pls = defs;
    }
    fyCardsList = pls;
    return pls;
  }

  function forYouCardHTML(p, i) {
    const art = p.artwork || (state.forYou && state.forYou[0] && state.forYou[0].artwork) || "/cover-default.png";
    return `<div class="card-wrap">
      <button type="button" class="card card-hit" data-open-fy="${i}">
        <div class="art">
          <img src="${escapeAttr(art)}" alt="" loading="lazy" onerror="this.src='/cover-default.png'"/>
          <span class="badge yt">Playlist</span>
        </div>
        <h3>${escapeHTML(p.title || "Playlist")}</h3>
        <p>${escapeHTML(p.subtitle || "Muchi mix")}</p>
      </button>
    </div>`;
  }

  function forYouSection() {
    const pls = forYouPlaylistList();
    return `<div class="section"><div class="section-head"><h2>Made for you</h2><span>${pls.length}</span></div><div class="row">${pls.map(forYouCardHTML).join("")}</div></div>`;
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
      forYouMix: p.kind === "mix",
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
    const cards = forYouPlaylistList().filter((p) => p.kind === "yt" && !p.playlistId && p.query);
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
    const labels = { all: "All", songs: "Songs", artists: "Artists", playlists: "Playlists", albums: "Albums", radio: "Radio", history: "History" };
    return ["all", "songs", "artists", "playlists", "albums", "radio", "history"].map((f) =>
      `<button class="chip ${state.filter === f ? "active" : ""}" data-filter="${f}">${labels[f]}</button>`
    ).join("");
  }

  function artistHitHTML(a, i) {
    return `<button type="button" class="lib-row artist" data-open-artist="${i}">
      <img class="round" src="${escapeAttr(a.artwork || "/cover-default.png")}" alt="" onerror="this.src='/cover-default.png'"/>
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
      <img src="${escapeAttr(p.artwork || "/cover-default.png")}" alt="" onerror="this.src='/cover-default.png'"/>
      <div>
        <div class="t-title">${escapeHTML(p.title)}</div>
        <div class="t-sub">${kind}${p.artist ? " · " + escapeHTML(p.artist) : ""}${extra.length ? " · " + escapeHTML(extra.join(" · ")) : ""}</div>
      </div>
    </button>`;
  }

  function pickTopArtist(s, query) {
    const arts = (s && s.artists) || [];
    if (!arts.length) return null;
    const q = String(query || "").trim().toLowerCase();
    if (!q) return arts[0];
    return arts.find((a) => String(a.name || "").toLowerCase() === q)
      || arts.find((a) => {
        const n = String(a.name || "").toLowerCase();
        return n.includes(q) || q.includes(n);
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
        <img class="artist-photo" src="${escapeAttr(a.artwork || "/cover-default.png")}" alt="" onerror="this.src='/cover-default.png'"/>
        <div>
          <p class="lib-kicker">Artist</p>
          <h1>${escapeHTML(a.name)}</h1>
          <p>${a.loading ? "Loading catalogue…" : `${songs.length} songs · ${albums.length} albums`}</p>
          <div class="artist-actions">
            ${songs.length ? `<button class="filled-btn" id="playArtist" type="button"><span class="material-symbols-outlined filled">play_arrow</span> Play</button>` : ""}
            <button class="tonal-btn" id="followArtist" type="button">
              <span class="material-symbols-outlined">${isFollowing({ artist: a.name, source: a.source }) ? "person_check" : "person_add"}</span>
              ${isFollowing({ artist: a.name, source: a.source }) ? "Following" : "Follow"}
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
    const songs = [].concat(s.youtube || [], s.apple || [], s.audius || []);
    const artists = s.artists || [];
    const playlists = (s.playlists || []).filter((p) => p.source !== "apple");
    const albums = (s.playlists || []).filter((p) => p.source === "apple");
    const radio = s.radio || [];
    const empty = !songs.length && !artists.length && !playlists.length && !albums.length && !radio.length;
    if (empty) return `<div class="empty"><h3>No matches</h3><p>Try another spelling, or paste a YouTube URL.</p></div>`;
    const top = pickTopArtist(s, state.query);
    const topIdx = top ? artists.indexOf(top) : -1;
    const hero = (f === "all" && top) ? `
      <button type="button" class="artist-hero" data-open-artist="${topIdx}">
        <img class="round" src="${escapeAttr(top.artwork || "/cover-default.png")}" alt="" onerror="this.src='/cover-default.png'"/>
        <div>
          <p class="lib-kicker">Artist</p>
          <h2>${escapeHTML(top.name)}</h2>
          <p>Open profile · songs & albums</p>
        </div>
        <span class="material-symbols-outlined">chevron_right</span>
      </button>` : "";
    if (f === "songs") {
      return `<div class="section"><div class="section-head"><h2>Songs</h2></div><div class="list">${songs.map((t, i) => rowHTML(t, i)).join("")}</div></div>`;
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
      ${hero}
      <div class="section">
        <div class="section-head"><h2>Songs</h2><span>${songs.length}</span></div>
        <div class="list">${songs.map((t, i) => rowHTML(t, i)).join("")}</div>
      </div>
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
      const tracks = p.tracks || [];
      return `
        <div class="lib-detail">
          <button class="chip-btn page-back" id="libBack" type="button"><span class="material-symbols-outlined">arrow_back</span> Back</button>
          <div class="lib-hero custom-pl">
            <img class="lib-cover" src="${escapeAttr(p.artwork || (tracks[0] && tracks[0].artwork) || "/cover-default.png")}" alt="" onerror="this.src='/cover-default.png'"/>
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
            <img class="lib-cover" src="${escapeAttr(o.artwork || (tracks[0] && tracks[0].artwork) || "/cover-default.png")}" alt="" onerror="this.src='/cover-default.png'"/>
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
                <img class="lib-cover" src="${escapeAttr(playlistArt(p))}" alt="" onerror="this.src='/cover-default.png'"/>
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
                  <img src="${escapeAttr(artUrl(t))}" alt="" loading="lazy" onerror="this.src='/cover-default.png'"/>
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
    const playlistRows = state.playlists.map((p, i) => `
      <button type="button" class="lib-row" data-open-pl="${i}">
        <img src="${escapeAttr(playlistArt(p))}" alt="" onerror="this.src='/cover-default.png'"/>
        <div>
          <div class="t-title">${escapeHTML(p.name)}</div>
          <div class="t-sub">Playlist · ${trackStats(p.tracks)}</div>
        </div>
      </button>`).join("");
    const artistRows = state.following.map((a) => `
      <button type="button" class="lib-row artist" data-artist="${escapeAttr(a.key)}">
        <img class="round" src="${escapeAttr(a.artwork || "/cover-default.png")}" alt="" onerror="this.src='/cover-default.png'"/>
        <div>
          <div class="t-title">${escapeHTML(a.name)}</div>
          <div class="t-sub">Artist</div>
        </div>
      </button>`).join("");
    const dlRows = state.downloads.map((t, i) => rowHTML(t, i)).join("");
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
              <img src="${escapeAttr(p.artwork || "/cover-default.png")}" alt="" onerror="this.src='/cover-default.png'"/>
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
      body = likedRow + ytRows + (playlistRows || `<p class="empty">Create a playlist with the + button.</p>`);
    } else if (f === "artists") {
      body = artistRows || `<p class="empty">Follow an artist from the player.</p>`;
    } else if (f === "downloaded") {
      body = dlRows || `<p class="empty">Save an Audius track from the player to listen offline.</p>`;
    } else {
      body = likedRow + ytRows + playlistRows + artistRows;
      if (!state.playlists.length && !state.following.length) {
        body += `<p class="empty">Heart songs, follow artists, or make a playlist — they’ll land here.</p>`;
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
    const u = String(state.prefs.github || "").replace(/\/$/, "");
    const m = u.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
    if (!m) return null;
    return { url: `https://github.com/${m[1]}/${m[2].replace(/\.git$/i, "")}`, owner: m[1], repo: m[2].replace(/\.git$/i, "") };
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
    const status = u.error ? "offline" : u.available ? "update available" : (u.latest ? "up to date" : "checking");
    return `
      <p class="upd-ver">Current <strong>${escapeHTML(u.current || APP_VERSION)}</strong>${u.latest ? ` · Latest <strong>${escapeHTML(u.latest)}</strong>` : ""} · <em>${status}</em></p>
      <div class="upd-tiles">
        <button type="button" class="upd-tile" id="updAndroid" style="animation-delay:.05s">
          <span class="upd-tile-icon"><span class="material-symbols-outlined">android</span></span>
          <span class="upd-tile-name">Android</span>
          <span class="upd-tile-sub">Download &amp; install the APK</span>
        </button>
        <button type="button" class="upd-tile" id="updIos" style="animation-delay:.16s">
          <span class="upd-tile-icon ios">
            <svg class="apple-logo" viewBox="0 0 384 512" role="img" aria-label="Apple" xmlns="http://www.w3.org/2000/svg"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
          </span>
          <span class="upd-tile-name">iOS</span>
          <span class="upd-tile-sub">App Store / TestFlight</span>
        </button>
      </div>
      <div class="upd-sub" id="updSub" hidden></div>`;
  }
  function showUpdatePlatform(which) {
    const sub = document.getElementById("updSub");
    const tiles = document.querySelector("#modal .upd-tiles");
    if (!sub) return;
    const u = state.update || {};
    if (which === "android") {
      sub.innerHTML = `
        <div class="upd-sub-head">
          <span class="material-symbols-outlined">android</span>
          <div><strong>Android update</strong><p>Installs over this app — your likes, playlists and settings stay.</p></div>
        </div>
        ${u.apkUrl
          ? `<a class="filled-btn upd-dl" href="${escapeAttr(u.apkUrl)}" target="_blank" rel="noopener"><span class="material-symbols-outlined filled">download</span> Download Muchi ${escapeHTML(u.latest || "")}</a>`
          : `<p class="upd-pending">${u.available
              ? "The Android release is being prepared — the download link appears here the moment it is published."
              : "You're on the latest published Android version."}</p>`}
        <p class="upd-note">If your phone asks for permission, allow “Install unknown apps” for this app (Android 8+ security rule).</p>`;
    } else {
      sub.innerHTML = `
        <div class="upd-sub-head">
          <span class="material-symbols-outlined">smartphone_iphone</span>
          <div><strong>iOS update</strong><p>iPhone apps update through Apple's App Store or TestFlight.</p></div>
        </div>
        ${u.appStoreUrl
          ? `<a class="filled-btn upd-dl" href="${escapeAttr(u.appStoreUrl)}" target="_blank" rel="noopener"><span class="material-symbols-outlined filled">open_in_new</span> Open in the App Store</a>`
          : `<p class="upd-pending">MUCHI isn't on the App Store yet. Once it's published, this button opens the App Store automatically — iPhones can't side-load apps, and we won't pretend otherwise.</p>`}`;
    }
    sub.hidden = false;
    if (tiles) tiles.classList.add("dim");
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
    const color = THEMES.filter((t) => t.group === "color");
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
          <p>Now using ${escapeHTML(themeLabel())}.</p>
        </div>
      </div>
      <div class="settings">
        <div class="set-card">
          <h3>Light / Dark / System</h3>
          <p class="set-lead">Choose how MUCHI appears. System follows this device — and keeps following it live, without a restart.</p>
          <div class="seg" role="radiogroup" aria-label="Appearance">
            ${apBtn("light", "Light")}
            ${apBtn("dark", "Dark")}
            ${apBtn("system", "System")}
          </div>
        </div>
        <div class="set-card">
          <h3>Theme skins</h3>
          <p class="set-lead">Optional color skins on top of the appearance above. ${color.length} colorful + classic skins.</p>
          <div class="theme-grid">${skins.map((th) => themeCardHTML(th, p.theme === th.id)).join("")}</div>
        </div>
        <div class="set-card">
          <h3>Custom theme</h3>
          <p class="set-lead">Build your own. Colors apply live; they’re saved on this device.</p>
          <button type="button" class="theme-card custom-use ${customOn ? "on" : ""}" data-set-theme="custom">
            <div class="theme-preview" style="background:${c.surface};--tp-a:${c.primary};--tp-b:${c.accent}">
              <i class="tp-bar"></i><i class="tp-row"></i><i class="tp-row dim"></i><i class="tp-pill"></i>
            </div>
            <span><strong>${escapeHTML(c.name || "My theme")}</strong><em>${customOn ? "In use" : "Tap to use this mix"}</em></span>
          </button>
          <label class="set-row">
            <div><strong>Name</strong><p>Shown on the Settings row.</p></div>
            <input id="customName" type="text" maxlength="24" value="${escapeAttr(c.name)}" />
          </label>
          <div class="set-row">
            <div><strong>Base</strong><p>Dark or light starting point.</p></div>
            <div class="chip-row">
              <button type="button" class="chip ${c.mode === "dark" ? "active" : ""}" data-custom-mode="dark">Dark</button>
              <button type="button" class="chip ${c.mode === "light" ? "active" : ""}" data-custom-mode="light">Light</button>
            </div>
          </div>
          ${[
            ["surface", "Background", "Page color"],
            ["card", "Cards", "Tiles, menus, player"],
            ["primary", "Accent", "Buttons and highlights"],
            ["accent", "Glow", "Second color and wash"],
            ["text", "Text", "Titles and labels"],
          ].map(([key, title, hint]) => `
            <label class="set-row color-row">
              <div><strong>${title}</strong><p>${hint}</p></div>
              <span class="color-field">
                <input type="color" data-custom-color="${key}" value="${c[key]}" />
                <code>${c[key]}</code>
              </span>
            </label>`).join("")}
          <div class="set-row">
            <div><strong>Reset mix</strong><p>Back to the starter purple.</p></div>
            <button class="chip-btn" id="resetCustom" type="button">Reset</button>
          </div>
        </div>
      </div>`;
  }

  function renderUiPage() {
    const ui = state.prefs.ui === "material" ? "material" : "glass";
    const card = (id, name, blurb, extra) => `
      <button type="button" class="ui-pick ${ui === id ? "on" : ""}" data-set-ui="${id}">
        <div class="ui-pick-preview ${id}">${extra}</div>
        <span>
          <strong>${name}</strong>
          <em>${blurb}</em>
        </span>
        ${ui === id ? `<span class="ui-pick-on">On</span>` : ""}
      </button>`;
    return `
      <div class="hero">
        <div>
          <button class="chip-btn page-back" id="settingsBack" type="button">
            <span class="material-symbols-outlined">arrow_back</span>
            Back
          </button>
          <h1>UI</h1>
          <p>How Muchi is drawn. Colors still come from Appearance.</p>
        </div>
      </div>
      <div class="settings">
        <div class="set-card">
          <h3>Icons</h3>
          <p class="set-lead">Size of buttons and dock icons on this phone.</p>
          <div class="chip-row icon-size-row">
            ${[["small", "Small"], ["default", "Default"], ["medium", "Medium"], ["large", "Large"]].map(([id, label]) =>
              `<button type="button" class="chip ${(state.prefs.iconSize || "default") === id ? "active" : ""}" data-set-icons="${id}">${label}</button>`
            ).join("")}
          </div>
        </div>
        <div class="set-card">
          <h3>Layout</h3>
          <p class="set-lead">Pick one. Saved on this device.</p>
          <div class="ui-pick-list">
            ${card("material", "Material 3", "Default — filled cards, You-style player.", `<i></i><i></i><i></i>`)}
            ${card("glass", "Glass UI", "iPhone frosted glass — blur, thin borders, floating bars.", `<i></i><i></i><i></i>`)}
          </div>
        </div>
      </div>`;
  }


  function playerStyleLabel() {
    const id = state.prefs.playerStyle || "pill";
    return ({ pill: "Glass pill", island: "Island", wave: "Wave", bar: "Solid bar" })[id] || "Glass pill";
  }

  function accountCardHTML() {
    const a = state.auth;
    if (!a) return `<div class="set-card"><h3>Account</h3><div class="ly-wait">Checking…</div></div>`;
    if (a.configured === false) return "";
    if (!a.signedIn) {
      return `
        <div class="set-card">
          <h3>Account</h3>
          <p class="set-hint">Sign in with Google to bring your YouTube likes and playlists into your Library.</p>
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
        <h3>Account</h3>
        <div class="set-row">
          <div class="acct-user">${pic}<div><strong>${escapeHTML(pr.name || pr.email || "Google user")}</strong><p>${escapeHTML(pr.email || "")}</p></div></div>
        </div>
        ${yt ? `
        <div class="set-row">
          <div><strong>YouTube</strong><p>Likes and playlists sync to your Library.</p></div>
          <button type="button" class="chip-btn" id="gYtRefresh">Refresh</button>
          <button type="button" class="chip-btn" id="gYtDisconnect">Disconnect</button>
        </div>` : `
        <div class="set-row">
          <div><strong>YouTube</strong><p>Authorize MUCHI to read your liked videos and playlists.</p></div>
          <button type="button" class="chip-btn" id="gYtConnect">Connect</button>
        </div>`}
        <div class="set-row">
          <div><strong>Sign out</strong><p>Removes your Google session and YouTube data from this device.</p></div>
          <button type="button" class="chip-btn" id="gSignOut">Sign out</button>
        </div>
      </div>`;
  }

  function settingsSubChrome(title, sub) {
    return `
      <div class="hero">
        <div>
          <button class="chip-btn page-back" id="settingsBack" type="button">
            <span class="material-symbols-outlined">arrow_back</span>
            Back
          </button>
          <h1>${title}</h1>
          <p>${sub}</p>
        </div>
      </div>`;
  }

  function renderPlayerPage() {
    const cur = ["pill", "island", "wave", "bar"].includes(state.prefs.playerStyle) ? state.prefs.playerStyle : "pill";
    const types = [
      ["pill", "Glass pill", "Floating capsule with liquid shine."],
      ["island", "Island", "Compact, round — like a Dynamic Island."],
      ["wave", "Wave", "Live wiggly seek line while music plays."],
      ["bar", "Solid bar", "Filled Material bar, less glass."],
    ];
    return `
      ${settingsSubChrome("Player", "Four looks for the bar. Seek wiggles while a song plays.")}
      <div class="settings">
        <div class="set-card">
          <h3>Type</h3>
          <div class="ui-pick-list">
            ${types.map(([id, name, blurb]) => `
              <button type="button" class="ui-pick ${cur === id ? "on" : ""}" data-set-player="${id}">
                <div class="ui-pick-preview player-${id}"><i></i><i></i><i></i></div>
                <span><strong>${name}</strong><em>${blurb}</em></span>
                ${cur === id ? `<span class="ui-pick-on">On</span>` : ""}
              </button>`).join("")}
          </div>
        </div>
      </div>`;
  }

  function renderPlaybackPage() {
    const p = state.prefs;
    return `
      ${settingsSubChrome("Playback", "How tracks start, fade, and stream.")}
      <div class="settings">
        <div class="set-card">
          <div class="set-row">
            <div><strong>Autoplay</strong><p>Play the next song when one ends.</p></div>
            <button class="switch ${p.autoplay ? "on" : ""}" data-pref="autoplay" type="button"><i></i></button>
          </div>
          <label class="set-row">
            <div><strong>Crossfade</strong><p>Audius only. YouTube is skipped.</p></div>
            <select id="setFade">
              ${[0, 3, 6, 12].map((n) => `<option value="${n}" ${Number(p.crossfade) === n ? "selected" : ""}>${n ? n + "s" : "Off"}</option>`).join("")}
            </select>
          </label>
          <div class="set-row">
            <div><strong>Even volume</strong><p>Tame sudden loud tracks.</p></div>
            <button class="switch ${p.normalize ? "on" : ""}" data-pref="normalize" type="button"><i></i></button>
          </div>
          <label class="set-row">
            <div><strong>Speed</strong><p>Audius, radio, and YouTube when allowed.</p></div>
            <select id="setSpeed">
              ${[0.75, 1, 1.25, 1.5].map((n) => `<option value="${n}" ${Number(p.speed) === n ? "selected" : ""}>${n}×</option>`).join("")}
            </select>
          </label>
          <label class="set-row">
            <div><strong>Sound stage</strong><p>Speakers, bass, or headphone spatial. YouTube stays in Google’s player.</p></div>
            <select id="setSpatial">
              <option value="phone" ${spatialMode() === "phone" ? "selected" : ""}>Phone · feel it</option>
              <option value="bass" ${spatialMode() === "bass" ? "selected" : ""}>Super Bass</option>
              <option value="spatial" ${spatialMode() === "spatial" ? "selected" : ""}>Spatial · Atmos-style headphones</option>
              <option value="dynamic" ${spatialMode() === "dynamic" ? "selected" : ""}>Dynamic</option>
              <option value="off" ${spatialMode() === "off" ? "selected" : ""}>Off</option>
            </select>
          </label>
          <div class="set-row">
            <div><strong>Stream quality</strong><p>YouTube resolution + radio bitrate. Audius is always 320 kbps.</p></div>
          </div>
          <div class="chip-row quality-row">
            ${[["auto", "Auto · network"], ["low", "Low"], ["standard", "Standard"], ["high", "High"], ["highest", "Highest"]].map(([id, label]) =>
              `<button type="button" class="chip ${(p.quality || "high") === id ? "active" : ""}" data-set-quality="${id}">${label}</button>`
            ).join("")}
          </div>
          <label class="set-row">
            <div><strong>Audio codec</strong><p>Radio only.</p></div>
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
    return `
      ${settingsSubChrome("Listening", "Sleep timer, resume, and the video pane.")}
      <div class="settings">
        <div class="set-card">
          <label class="set-row">
            <div><strong>Sleep timer</strong><p>${sleepLabel()}. Also on the moon button in the player.</p></div>
            <select id="setSleep">
              <option value="off" ${state.sleep.mode === "off" ? "selected" : ""}>Off</option>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">60 min</option>
              <option value="track" ${state.sleep.mode === "track" ? "selected" : ""}>End of track</option>
            </select>
          </label>
          <div class="set-row">
            <div><strong>Resume last song</strong><p>Load the last queue when you open Muchi. Won’t auto-play.</p></div>
            <button class="switch ${p.resume ? "on" : ""}" data-pref="resume" type="button"><i></i></button>
          </div>
          <div class="set-row">
            <div><strong>Keep screen on</strong><p>While something is playing.</p></div>
            <button class="switch ${p.wake ? "on" : ""}" data-pref="wake" type="button"><i></i></button>
          </div>
          <div class="set-row">
            <div><strong>Show YouTube video</strong><p>Pop the official player when a YouTube track starts.</p></div>
            <button class="switch ${p.autoVideo ? "on" : ""}" data-pref="autoVideo" type="button"><i></i></button>
          </div>
        </div>
      </div>`;
  }

  function renderSettings() {
    if (state.settingsPage === "appearance") return renderAppearance();
    if (state.settingsPage === "ui") return renderUiPage();
    if (state.settingsPage === "player") return renderPlayerPage();
    if (state.settingsPage === "playback") return renderPlaybackPage();
    if (state.settingsPage === "listening") return renderListeningPage();
    const p = state.prefs;
    const opts = COUNTRIES.map(([c, n]) => `<option value="${c}" ${p.country === c ? "selected" : ""}>${n}</option>`).join("");
    const dls = state.downloads || [];
    const taste = tasteProfile();
    const gh = String(p.github || "").replace(/\/$/, "");
    const ghOk = /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/i.test(gh);
    const sleepVal = state.sleep.mode === "track" ? "track" : state.sleep.mode === "mins" ? "on" : "off";
    return `
      <div class="hero">
        <div>
          <button class="chip-btn page-back" id="settingsBack" type="button">
            <span class="material-symbols-outlined">arrow_back</span>
            Back
          </button>
          <h1>Settings</h1>
          <p>Only the controls you need while listening.</p>
        </div>
      </div>
      <div class="settings">
        ${accountCardHTML()}
        <div class="set-card">
          <h3>Look</h3>
          <button type="button" class="set-row set-go" id="openUi">
            <div><strong>UI</strong><p>${escapeHTML(uiLabel())} — Material 3 or iPhone glass.</p></div>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
          <button type="button" class="set-row set-go" id="openAppearance">
            <div><strong>Appearance</strong><p>${escapeHTML(themeLabel())} — themes and a custom mix.</p></div>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
          <button type="button" class="set-row set-go" id="openPlayer">
            <div><strong>Player</strong><p>${escapeHTML(playerStyleLabel())} — bar shape and the seek line.</p></div>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
        <div class="set-card">
          <h3>Sound</h3>
          <button type="button" class="set-row set-go" id="openPlayback">
            <div><strong>Playback</strong><p>Autoplay, fade, speed, quality.</p></div>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
          <button type="button" class="set-row set-go" id="openListening">
            <div><strong>Listening</strong><p>Background play, lock screen, sleep.</p></div>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
        <div class="set-card">
          <h3>Catalog</h3>
          <label class="set-row">
            <div><strong>Country</strong><p>One local row on Home plus search ranking. The rest of Home is English hits.</p></div>
            <select id="setCountry">${opts}</select>
          </label>
        </div>
        <div class="set-card">
          <h3>Offline</h3>
          <div class="set-row">
            <div><strong>Audius downloads</strong><p>Legal independent files only. YouTube cannot be saved.</p></div>
            <span>${dls.length}</span>
          </div>
          <div class="list">${dls.map((t, i) => `
            <div class="track-row ${current() && current().id === t.id ? "active" : ""}">
              <img src="${escapeAttr(artUrl(t))}" alt="" loading="lazy" onerror="this.src='/cover-default.png'"/>
              <button type="button" data-play="${escapeAttr(t.id)}" data-idx="${i}" style="all:unset;cursor:pointer;flex:1;min-width:0">
                <div class="t-title">${escapeHTML(t.title)}</div>
                <div class="t-sub">${escapeHTML(t.artist)}</div>
              </button>
              <button type="button" class="icon-btn" data-del-dl="${escapeAttr(t.id)}" title="Remove">
                <span class="material-symbols-outlined">delete</span>
              </button>
            </div>`).join("") || "<p class='empty' style='padding:16px'>Save a track from Now Playing.</p>"}</div>
        </div>
        <div class="set-card">
          <h3>Taste profile</h3>
          <div class="set-row">
            <div><strong>${taste.plays} plays</strong><p>${taste.liked} liked · ${taste.following} following</p></div>
          </div>
          <div class="taste-grid">
            ${taste.artists.slice(0, 6).map(([n, c]) => `<span class="taste-chip"><strong>${c}×</strong>${escapeHTML(n)}</span>`).join("") || "<p class='empty' style='padding:8px'>Play a few songs to build your profile.</p>"}
          </div>
          ${taste.genres.length ? `<div class="taste-grid">${taste.genres.map(([n, c]) => `<span class="taste-chip"><strong>${escapeHTML(n)}</strong>${c} tracks</span>`).join("")}</div>` : ""}
        </div>
        <div class="set-card">
          <h3>Following</h3>
          <div class="set-row">
            <div><strong>New-release alerts</strong><p>Browser notification when a followed Audius artist drops a track.</p></div>
            <button class="switch ${p.notifyFollows ? "on" : ""}" data-pref="notifyFollows" type="button"><i></i></button>
          </div>
          <div class="list">${state.following.map((f) => `
            <div class="track-row">
              <img src="${escapeAttr(f.artwork || "/cover-default.png")}" alt="" onerror="this.src='/cover-default.png'"/>
              <div>
                <div class="t-title">${escapeHTML(f.name)}</div>
                <div class="t-sub">${escapeHTML(f.source)}${f.handle ? " · @" + escapeHTML(f.handle) : ""}</div>
              </div>
              <button type="button" class="chip-btn" data-unfollow="${escapeAttr(f.key)}">Unfollow</button>
            </div>`).join("") || "<p class='empty' style='padding:16px'>Tap the person icon on the player to follow the current artist.</p>"}</div>
        </div>
        <div class="set-card">
          <h3>About</h3>
          <div class="set-row">
            <div><strong>Muchi ${APP_VERSION}</strong><p>${updateLine()}</p></div>
          </div>
          <div class="set-row">
            <div><strong>Updates</strong><p>Check for a new version, or restart the app.</p></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="chip-btn" id="updateBtn" type="button"><span class="material-symbols-outlined">system_update</span>Update</button>
              <button class="chip-btn" id="reloadApp" type="button"><span class="material-symbols-outlined">refresh</span>Reload App</button>
            </div>
          </div>
          <div class="set-row">
            <div><strong>Help</strong><p>What’s new in this version, or send a note if something’s off.</p></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="chip-btn" id="ghRelease" type="button" ${ghOk ? "" : "disabled"}>What's new</button>
              <button class="chip-btn" id="ghBug" type="button" ${ghOk ? "" : "disabled"}>Send feedback</button>
            </div>
          </div>
        </div>
        <div class="set-card">
          <h3>Data</h3>
          <div class="set-row">
            <div><strong>This device</strong><p id="cacheHint">Measuring…</p></div>
          </div>
          <div class="set-row">
            <div><strong>Clear cache</strong><p>App shell and Home feed. Likes stay.</p></div>
            <button class="chip-btn" data-clear="sw" type="button">Clear</button>
          </div>
          <div class="set-row">
            <div><strong>Clear history</strong><p>Recently played.</p></div>
            <button class="chip-btn" data-clear="recents" type="button">Clear</button>
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
              <em>Open source · Muchi-music (public)</em>
            </span>
          </a>
          <a class="dev-repo" href="https://github.com/Kaibshshdheueejw/Muchi-music" target="_blank" rel="noopener noreferrer">View the code</a>
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
    const t = state.detailTrack;
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
          <img class="detail-art" src="${escapeAttr(artUrl(t))}" alt="" onerror="this.src='/cover-default.png'"/>
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
    return `
      <div class="ly-screen">
        <div class="ly-bg" style="background-image:url('${escapeAttr(art)}')"></div>
        <div class="ly-head">
          <button class="icon-btn" id="nowBack" type="button" title="Back" aria-label="Back">
            <span class="material-symbols-outlined">keyboard_arrow_down</span>
          </button>
          <div class="ly-meta">
            <img src="${escapeAttr(art)}" alt="" onerror="this.src='/cover-default.png'"/>
            <div>
              <strong>${escapeHTML(t.title)}</strong>
              <button type="button" class="artist-link-now" id="nowArtist">${escapeHTML(artistName(t) || t.artist)}</button>
            </div>
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
      if (inp && state.query && inp.value !== state.query) inp.value = state.query;
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
        } else if (state.view === "library" && state.activePlaylist === "catalog") {
          const rows = (state.catalogPlaylist && state.catalogPlaylist.tracks) || [];
          track = (rows[idx] && rows[idx].id === id) ? rows[idx] : rows.find((t) => t.id === id);
        } else if (state.view === "library" && typeof state.activePlaylist === "number") {
          const rows = state.playlists[state.activePlaylist] && state.playlists[state.activePlaylist].tracks || [];
          track = (rows[idx] && rows[idx].id === id) ? rows[idx] : rows.find((t) => t.id === id);
        }
        if (!track) track = findTrack(id);
        if (!track) { toast("Couldn't open options", true, "error"); return; }
        const where = state.view === "library" && state.activePlaylist === "liked"
          ? "liked"
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
    if (detailPlay) detailPlay.addEventListener("click", () => {
      const tr = state.detailTrack;
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
    const detailArtist = viewEl.querySelector("#detailArtist");
    if (detailArtist) detailArtist.addEventListener("click", () => openArtistFromTrack(state.detailTrack));
    const detailLike = viewEl.querySelector("#detailLike");
    if (detailLike) detailLike.addEventListener("click", () => {
      if (state.detailTrack) { toggleLike(state.detailTrack); render(); }
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
        const fromSearch = state.view === "search";
        let list = [];
        if (state.view === "library" && state.activePlaylist === "liked") list = state.liked;
        else if (state.view === "library" && state.activePlaylist === "yt-liked") list = (state.ytLiked && state.ytLiked.tracks) || [];
        else if (state.view === "library" && typeof state.activePlaylist === "string" && state.activePlaylist.indexOf("yt-pl:") === 0) list = (state.ytOpen && state.ytOpen.tracks) || [];
        else if (state.view === "library" && state.activePlaylist === "discovery") list = (state.discovery && state.discovery.tracks) || [];
        else if (state.view === "library" && state.activePlaylist === "catalog") list = (state.catalogPlaylist && state.catalogPlaylist.tracks) || [];
        else if (state.view === "library" && typeof state.activePlaylist === "number") list = state.playlists[state.activePlaylist].tracks;
        else if (state.view === "settings") list = state.downloads;
        else if (fromSearch && state.artistPage) list = state.artistPage.songs || [];
        else if (fromSearch && state.filter === "history") list = state.recents;
        else if (fromSearch && (state.filter === "songs" || state.filter === "all")) list = [].concat(
          (state.search && state.search.youtube) || [],
          (state.search && state.search.apple) || [],
          (state.search && state.search.audius) || [],
          (state.search && state.search.radio) || [],
          state.recents
        );
        else if (fromSearch) list = [].concat(
          (state.search && state.search.youtube) || [],
          (state.search && state.search.apple) || [],
          (state.search && state.search.audius) || [],
          (state.search && state.search.radio) || [],
          state.recents
        );
        else if (state.view === "radio") list = state.radio;
        else if (state.view === "home" && el.closest("[data-disc-mix]")) list = (state.discovery && state.discovery.tracks) || [];
        else if (state.view === "home") list = homeTrackPool();
        else if (state.view === "library") list = [].concat(state.liked, state.recents, state.downloads);
        else list = state.queue;
        const i = Number.isInteger(idx) && list[idx] && list[idx].id === id ? idx : list.findIndex((t) => t.id === id);
        const track = i >= 0 ? list[i] : findTrack(id);
        if (!track) return;
        if (fromSearch && !state.artistPage && state.filter !== "history" && track.source !== "radio") {
          playFromList([track], 0);
          fillRelatedQueue(track);
          return;
        }
        if (i >= 0) playFromList(list.filter(Boolean), i);
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
      state.prevView = "home";
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
      el.addEventListener("click", () => { state.filter = el.dataset.filter; render(); });
    });
    viewEl.querySelectorAll("[data-open-artist]").forEach((el) => {
      el.addEventListener("click", () => {
        const pool = (state.artistPage && state.artistPage.albums) ? null : ((state.search && state.search.artists) || []);
        const a = pool && pool[Number(el.dataset.openArtist)];
        if (a) openArtistProfile(a);
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
        toggleFollow({ artist: a.name, source: a.source || "youtube", artwork: a.artwork, id: a.id });
      });
    }
    const nowArtist = viewEl.querySelector("#nowArtist");
    if (nowArtist) nowArtist.addEventListener("click", () => openArtistFromTrack(current()));
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
      el.addEventListener("click", () => { rememberScroll(); state.activePlaylist = Number(el.dataset.openPl); navPush(); paintNav(false); });
    });
    const np = viewEl.querySelector("#newPl2");
    if (np) np.addEventListener("click", newPlaylist);
    viewEl.querySelectorAll("[data-open-yt-liked]").forEach((el) => {
      el.addEventListener("click", () => { state.activePlaylist = "yt-liked"; render(); });
    });
    viewEl.querySelectorAll("[data-open-yt-pl]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.openYtPl || "";
        const pl = Array.isArray(state.ytPlaylists) ? state.ytPlaylists.find((p) => String(p.id) === id) : null;
        state.ytOpen = { id, title: (pl && pl.title) || "Playlist", artwork: (pl && pl.artwork) || "", tracks: null, loading: true };
        state.activePlaylist = "yt-pl:" + id;
        render();
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
    const gYtRefresh = viewEl.querySelector("#gYtRefresh");
    if (gYtRefresh) gYtRefresh.addEventListener("click", () => {
      state.ytLiked = null;
      state.ytPlaylists = null;
      loadYtLiked(true);
      loadYtPlaylists(true);
      toast("Refreshing YouTube…");
    });
    viewEl.querySelectorAll("[data-open-liked]").forEach((el) => {
      el.addEventListener("click", () => { rememberScroll(); state.activePlaylist = "liked"; navPush(); paintNav(false); });
    });
    viewEl.querySelectorAll("[data-lib-filter]").forEach((el) => {
      el.addEventListener("click", () => { state.libFilter = el.dataset.libFilter; render(); });
    });
    const libBack = viewEl.querySelector("#libBack");
    if (libBack) libBack.addEventListener("click", requestBack);
    const playLiked = viewEl.querySelector("#playLiked");
    if (playLiked) playLiked.addEventListener("click", () => { if (state.liked[0]) playFromList(state.liked, 0); });
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
        save("aura.playlists", state.playlists);
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
    const dlNow = viewEl.querySelector("#dlNow");
    if (dlNow) dlNow.addEventListener("click", () => downloadTrack(current()));
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
      lyScroll.addEventListener("pointerdown", pauseFollow, { passive: true });
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
    viewEl.querySelectorAll("[data-set-player]").forEach((el) => {
      el.addEventListener("click", () => {
        state.prefs.playerStyle = el.dataset.setPlayer;
        savePrefs();
        applyUi();
        drawSeekWave();
        render();
      });
    });
    viewEl.querySelectorAll("[data-set-ui]").forEach((el) => {
      el.addEventListener("click", () => {
        state.prefs.ui = el.dataset.setUi === "material" ? "material" : "glass";
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
        toast(`Home will load ${countryName(state.prefs.country)} charts`);
        state.home = null;
        if (state.view === "settings") render();
        loadHome(true);
      });
    }
    const setSpeed = viewEl.querySelector("#setSpeed");
    if (setSpeed) {
      setSpeed.addEventListener("change", () => {
        state.prefs.speed = Number(setSpeed.value);
        savePrefs();
        applyPlaybackPrefs();
        toast(`Speed ${state.prefs.speed}×`);
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
        toast(t && t.source === "youtube" ? `${labels[state.prefs.spatial] || "Updated"}. YouTube stays in Google’s player.` : (labels[state.prefs.spatial] || "Updated"));
      });
    }
    viewEl.querySelectorAll("[data-set-quality]").forEach((el) => {
      el.addEventListener("click", () => {
        state.prefs.quality = el.dataset.setQuality;
        savePrefs();
        applyYtQuality();
        const names = { auto: "Auto · network", low: "Low · data saver", standard: "Standard", high: "High", highest: "Highest" };
        toast(`Stream quality · ${names[state.prefs.quality] || state.prefs.quality}`);
        render();
      });
    });
    const setCodec = viewEl.querySelector("#setCodec");
    if (setCodec) {
      setCodec.addEventListener("change", () => {
        state.prefs.codec = setCodec.value;
        savePrefs();
        toast(state.prefs.codec === "auto" ? "Any radio codec" : `Prefer ${state.prefs.codec.toUpperCase()} on radio`);
      });
    }
    const setGithub = viewEl.querySelector("#setGithub");
    if (setGithub) {
      setGithub.addEventListener("change", () => {
        state.prefs.github = String(setGithub.value || "").trim().replace(/\/$/, "");
        savePrefs();
        toast(state.prefs.github ? "GitHub repo saved" : "GitHub unlinked");
        render();
      });
    }
    const ghRelease = viewEl.querySelector("#ghRelease");
    if (ghRelease) ghRelease.addEventListener("click", () => {
      const u = String(state.prefs.github || "").replace(/\/$/, "");
      if (u) window.open(`${u}/releases`, "_blank", "noopener");
    });
    const ghBug = viewEl.querySelector("#ghBug");
    if (ghBug) ghBug.addEventListener("click", () => {
      const u = String(state.prefs.github || "").replace(/\/$/, "");
      if (!u) return;
      const body = encodeURIComponent(`**Muchi ${APP_VERSION}**\nBrowser: ${navigator.userAgent}\nView: ${state.view}\n\nSteps:\n1.\n`);
      window.open(`${u}/issues/new?title=${encodeURIComponent("Bug: ")}&body=${body}`, "_blank", "noopener");
    });
    viewEl.querySelectorAll("[data-unfollow]").forEach((el) => {
      el.addEventListener("click", () => {
        state.following = state.following.filter((f) => f.key !== el.dataset.unfollow);
        saveFollowing();
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
      el.addEventListener("click", () => {
        const f = state.following.find((x) => x.key === el.dataset.artist);
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
        toast(id === "system" ? "Following this device" : id === "custom" ? `${customTheme().name || "Custom"} theme` : `${pack ? pack.name : id} theme`);
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
        toast(mode === "light" ? "Light appearance" : mode === "dark" ? "Dark appearance" : "Following this device");
        if (state.view === "settings") render();
      });
    });
    const setFade = viewEl.querySelector("#setFade");
    if (setFade) {
      setFade.addEventListener("change", () => {
        state.prefs.crossfade = Number(setFade.value);
        savePrefs();
        toast(state.prefs.crossfade ? `Crossfade ${state.prefs.crossfade}s` : "Crossfade off");
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
        save("aura.playlists", state.playlists);
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
    restoreScroll(!!fromBack);
    // CSS view fade — no snapshot machinery, so no white-flash risk
    fadeView();
  }
  function applyNav(s) {
    if (!s || !s.muchi) return false;
    navSilent = true;
    state.view = s.view || "home";
    state.settingsPage = s.settingsPage || null;
    state.activePlaylist = s.activePlaylist == null ? null : s.activePlaylist;
    if (!s.hasArtist) {
      state.artistPage = null;
      state.artistFrom = null;
    }
    if (!s.hasDetail) state.detailTrack = null;
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
      setView(state.prevView || "home", true);
      return true;
    }
    if (state.view === "detail") {
      state.detailTrack = null;
      setView(state.prevView || "home", true);
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
      if (from && from !== state.view) setView(from, true);
      else { softRender(); navReplace(); }
      return true;
    }
    if (state.view === "library" && state.activePlaylist != null) {
      const fromCatalog = state.activePlaylist === "catalog";
      state.activePlaylist = null;
      state.catalogPlaylist = null;
      if (fromCatalog && state.prevView && state.prevView !== "library") {
        setView(state.prevView, true);
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
    try {
      if (history.state && history.state.muchi && window.history.length > 1) {
        history.back();
        return;
      }
    } catch {}
    logicalBack();
  }

  function setView(name, fromBack) {
    if (!fromBack) rememberScroll();
    if (!fromBack && name === state.view && !state.settingsPage && state.activePlaylist == null && !state.artistPage && !state.detailTrack && !state.showQueue) {
      if (name === "home") { state.showProfile = false; render(); }
      return;
    }
    if ((name === "now" || name === "settings" || name === "detail") && state.view !== name) state.prevView = state.view;
    if (name !== "home") state.showProfile = false;
    if (name !== "search" && name !== "now" && name !== "settings" && name !== "detail") state.artistPage = null;
    if (name !== "detail") state.detailTrack = null;
    state.view = name;
    // "now" (lyrics) and "detail" (track page) are transient overlays on
    // top of the current view — going back must land the user exactly
    // where they were, playlist included.
    if (name !== "library" && name !== "now" && name !== "detail") {
      state.activePlaylist = null;
      // Keep state.catalogPlaylist as an in-memory cache: nav history may
      // still point at it (e.g. home → playlist → lyrics → back). Nulling
      // it here used to strand the playlist in a permanent "Loading songs…".
    }
    if (name !== "settings") state.settingsPage = null;
    closeOverlays();
    if (!fromBack) navPush();
    else navReplace();
    paintNav(fromBack);
  }

  function openTrackDetail(track) {
    if (!track) return;
    state.detailTrack = track;
    if (state.view !== "detail") state.prevView = state.view;
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
    const gen = ++artistGen;
    if (!state.artistPage) state.artistFrom = state.view;
    state.view = "search";
    state.artistPage = { name: artist.name, artwork: artist.artwork, id: artist.id, source: artist.source, songs: [], albums: [], popular: [], playlists: [], loading: true };
    navPush();
    paintNav();
    const q = artist.query || artist.name;
    const songs = [];
    const albums = [];
    let popular = [];
    const norm = (t) => `${dzFold(t && t.title)}|${dzFold(t && t.artist)}`;
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
    // 1) Primary: the worker's artist build (parallel Apple + YouTube +
    //    Deezer, cached).
    let data = null;
    try {
      const appleId = String(artist.id || "").startsWith("artist:apple:") ? String(artist.id).slice("artist:apple:".length) : "";
      data = await api(`/api/artist?q=${encodeURIComponent(q)}&id=${encodeURIComponent(appleId)}&${glq()}`, 30000);
    } catch {}
    if (data && data.name) state.artistPage.name = data.name;
    if (data && data.artwork && !state.artistPage.artwork) state.artistPage.artwork = data.artwork;
    addSongs((data && data.songs) || []);
    addAlbums((data && data.albums) || []);
    popular = songs.slice(0, 20); // worker lists the best matches first
    paint(); // fast first paint, then keep completing in the background
    // 2) Complete the discography in the browser whenever the API came
    //    back thin (old deployment, cold start) — all songs, popular
    //    tracks, every album and the artist's YouTube playlists, for
    //    every artist. Three independent sources, in parallel:
    //   • Deezer — richest metadata (top tracks + complete album list);
    //     metadata only, never audio;
    //   • iTunes — worldwide catalogue (up to 200 songs + 200 albums),
    //     CORS-open — the reliable backbone;
    //   • MUCHI  — the worker's own search rows + YouTube playlists.
    if (gen === artistGen && (songs.length < 20 || !albums.length)) {
      const nm = state.artistPage.name || q;
      const [dz, it, sr] = await Promise.all([
        deezerBrowserCatalog(nm).catch(() => null),
        itunesBrowserCatalog(nm).catch(() => null),
        artistSearchCatalog(nm).catch(() => null),
      ]);
      if (gen !== artistGen || !state.artistPage) return;
      addSongs(dz && dz.songs);
      addSongs(it && it.songs);
      addSongs(sr && sr.songs);
      addAlbums(dz && dz.albums);
      addAlbums(it && it.albums);
      if (dz && dz.artist.name) state.artistPage.name = dz.artist.name;
      else if (it && it.artist.name) state.artistPage.name = it.artist.name;
      if (it && it.artist.artwork && !state.artistPage.artwork) state.artistPage.artwork = it.artist.artwork;
      else if (dz && dz.artist.artwork && !state.artistPage.artwork) state.artistPage.artwork = dz.artist.artwork;
      // Popular: Deezer's real popularity ranking when available,
      // otherwise the best-first merged list (worker rows first).
      if (dz && dz.popular && dz.popular.length) popular = dz.popular;
      else popular = songs.slice(0, 20);
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

  async function runSearch(q) {
    state.query = q;
    state.view = "search";
    state.artistPage = null;
    state.search = null;
    $("searchInput").value = q;
    render();
    try {
      state.search = await api(`/api/search?q=${encodeURIComponent(q)}&${glq()}&quality=${encodeURIComponent(resolvedQuality())}&codec=${encodeURIComponent(state.prefs.codec || "auto")}`);
      if (state.search && Array.isArray(state.search.youtube)) {
        state.search.youtube = state.search.youtube.filter((t) => {
          const blob = `${t && t.title || ""} ${t && t.artist || ""}`;
          return !/\b(gameplay|walkthrough|trailer|full movie|episode|vlog|tutorial|unboxing|reaction|#shorts?|minecraft|fortnite|roblox|podcast)\b/i.test(blob);
        });
      }
    } catch (e) {
      toast("Search failed. Try again.");
      state.search = { youtube: [], audius: [], radio: [], apple: [], artists: [], playlists: [] };
    }
    render();
  }

  async function openSearchPlaylist(playlistId, fallbackQ) {
    await openCatalogPlaylist({ playlistId, query: fallbackQ, title: fallbackQ || "Playlist" });
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
      query = h.localQuery || "";
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
    openCatalogPlaylist({
      title,
      tracks: tracks.slice(),
      artwork: tracks[0] && tracks[0].artwork,
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

  // Home rows prefer real songs (Spotify-style), but a degraded provider must
  // never leave a Home row empty: if fewer than 3 songs survive the junk
  // filter, keep the best available rows (same "never starve" rule as
  // vertical playlists). Playback itself still filters via looksLikeSong.
  function keepBestTracks(a) {
    if (!Array.isArray(a)) return a;
    const good = a.filter((t) => t && looksLikeSong(t));
    return good.length >= 3 ? good : a;
  }

  async function openCatalogPlaylist(meta, opts) {
    if (!meta) return;
    // refill=true: re-fetch for a catalog view that is ALREADY current
    // (e.g. restored from history whose data was lost) — no nav push, no
    // view change, the caller has already painted the loading state.
    const refill = !!(opts && opts.refill);
    if (!refill) rememberScroll();
    const preview = cleanPlaylistTracks(Array.isArray(meta.tracks) ? meta.tracks.slice() : []);
    const playlistId = meta.playlistId || "";
    const fallbackQ = meta.query || meta.title || "";
    const shelfId = meta.shelfId || "";
    const forYouMix = !!meta.forYouMix;
    const fyIndex = meta.fyIndex != null ? Number(meta.fyIndex) : null;
    const needFill = !!(forYouMix || shelfId || playlistId || fallbackQ);
    state.catalogPlaylist = {
      title: meta.title || "Playlist",
      artist: meta.artist || "",
      artwork: meta.artwork || (preview[0] && preview[0].artwork) || "",
      playlistId,
      query: fallbackQ,
      shelfId,
      tracks: preview,
      loading: needFill,
    };
    // Small, JSON-safe meta so a history restore can re-fetch this exact
    // playlist if the in-memory data was ever lost.
    state.catalogMeta = {
      title: meta.title || "Playlist",
      playlistId,
      query: fallbackQ,
      shelfId,
      forYouMix,
      fyIndex,
    };
    if (!refill) {
      state.prevView = state.view === "library" ? (state.prevView || "home") : state.view;
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
    // 0) Taste-driven mix ("Made for you" mixes) — fetch the auto-mix catalog.
    if (forYouMix) {
      const fetchMix = async () => {
        const data = await api(`/api/for-you?${forYouQs()}&${glq()}`, 25000);
        return (data && data.tracks) || [];
      };
      try { got = await fetchMix(); } catch {}
      if (!got.length) {
        try { await wait(1200); got = await fetchMix(); } catch {}
      }
    }
    if (!forYouMix && (shelfId || (fallbackQ && !playlistId))) {
      const q = fallbackQ || "";
      const fetchShelf = async (full, timeoutMs) => {
        const data = await api(
          `/api/shelf?id=${encodeURIComponent(shelfId)}&q=${encodeURIComponent(q)}&full=${full ? "1" : "0"}&gl=US`,
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
        const data = await api(`/api/yt/playlist?id=${encodeURIComponent(playlistId)}`, 18000);
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
        got = [].concat(data.youtube || [], data.apple || [], data.audius || []);
      } catch {}
    }
    if (state.activePlaylist !== "catalog" || !state.catalogPlaylist) return;
    if (got.length) {
      const tracks = cleanPlaylistTracks(got);
      state.catalogPlaylist.tracks = tracks;
      if (!state.catalogPlaylist.artwork && tracks[0]) state.catalogPlaylist.artwork = tracks[0].artwork;
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

  function utcDayClient() {
    return new Date().toISOString().slice(0, 10);
  }

  function seedHome() {
    return {
      moods: [],
      day: utcDayClient(),
      shelves: FALLBACK_SHELVES.map((s) => ({ ...s, tracks: [] })),
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

  async function loadHome(force) {
    if (!force && state.home && Date.now() - homeFetchedAt < 86400000 && state.home.day === utcDayClient()) {
      if (state.view === "home") render();
      return;
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
    if (!state.home) {
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
      // returned them empty (provider degradation).
      const prev = state.home;
      if (prev && Array.isArray(prev.shelves) && data.shelves && data.shelves.length) {
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
        if (Array.isArray(state.home.shelves)) {
          state.home.shelves = state.home.shelves.map((s) => ({ ...s, tracks: keepBestTracks(s.tracks) }));
        }
        state.home.youtubeLocal = keepBestTracks(state.home.youtubeLocal);
        state.home.youtubeIndia = keepBestTracks(state.home.youtubeIndia);
        state.home.youtubeCharts = keepBestTracks(state.home.youtubeCharts);
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
      state.home.shelves = FALLBACK_SHELVES.map((s) => ({ ...s, tracks: [] }));
    }
    homeFetchedAt = Date.now();
    loadForYou();
    checkFollowReleases();
    if (state.view === "home") render();
    hydrateShelves();
    // Resolve real playlist IDs + first-song covers for the "Made for you"
    // cards directly from the browser (works against any server state).
    hydrateForYouCards();
  }

  let homePaintT = 0;
  function paintHomeSoon() {
    if (state.view !== "home") return;
    clearTimeout(homePaintT);
    homePaintT = setTimeout(() => {
      if (state.view === "home") render();
    }, 160);
  }

  async function hydrateShelves() {
    const h = state.home;
    if (!h) return;
    const rows = h.shelves && h.shelves.length ? h.shelves : FALLBACK_SHELVES.map((s) => ({ ...s, tracks: [] }));
    h.shelves = rows;
    await Promise.all(rows.map(async (s) => {
      if (s.tracks && s.tracks.length) return;
      const q = s.query || (FALLBACK_SHELVES.find((d) => d.id === s.id) || {}).query;
      if (!q) return;
      try {
        const data = await api(`/api/shelf?id=${encodeURIComponent(s.id || "")}&q=${encodeURIComponent(q)}&gl=US`, 16000);
        const tracks = data.tracks || [];
        s.tracks = tracks;
        if (!s.title && data.title) s.title = data.title;
        // /api/home may have resolved while this fetch was in flight and
        // swapped state.home — forward the rows into the CURRENT home so
        // nothing is dropped when the worker returned that shelf empty.
        if (state.home !== h && state.home) {
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
        const data = await api(`/api/youtube/search?q=${encodeURIComponent("english pop hits official audio")}&gl=US`, 16000);
        if (!cur.shelves.some((s) => s.id === "today" && s.tracks && s.tracks.length)) {
          cur.youtubeCharts = data.tracks || [];
        }
        paintHomeSoon();
      } catch {}
    }
  }

  function forYouQs() {
    const taste = tasteProfile();
    const qs = new URLSearchParams({
      artists: taste.artists.slice(0, 4).map((x) => x[0]).join(","),
      genres: taste.genres.slice(0, 3).map((x) => x[0]).join(","),
      week: mondayWeekKey(),
    });
    return qs.toString();
  }

  async function loadForYou() {
    const taste = tasteProfile();
    if (!taste.artists.length && !taste.genres.length) return;
    try {
      const data = await api(`/api/for-you?${forYouQs()}&${glq()}`);
      state.forYou = data.tracks || [];
      if (state.view === "home") render();
    } catch { state.forYou = []; }
  }

  async function loadDiscoveryMix(force) {
    const week = mondayWeekKey();
    const have = state.discovery && state.discovery.week === week && (state.discovery.tracks || []).length;
    if (have && !force) return;
    const taste = tasteProfile();
    try {
      const qs = new URLSearchParams({
        artists: taste.artists.slice(0, 4).map((x) => x[0]).join(","),
        genres: taste.genres.slice(0, 3).map((x) => x[0]).join(","),
        week,
      });
      const data = await api(`/api/discover?${qs}&${glq()}`, 18000);
      const tracks = data.tracks || [];
      if (!tracks.length) return;
      state.discovery = { week, tracks, savedAt: Date.now() };
      save("aura.discovery", state.discovery);
      paintHomeSoon();
    } catch {}
  }

  async function checkFollowReleases() {
    if (!state.prefs.notifyFollows || !state.following.length) return;
    let changed = false;
    for (const f of state.following.slice(0, 6)) {
      try {
        const data = await api(`/api/artist?name=${encodeURIComponent(f.name)}&handle=${encodeURIComponent(f.handle || "")}&${glq()}`);
        const latest = data.latest;
        if (latest && latest.id && latest.id !== f.lastId) {
          const first = !f.lastId;
          f.lastId = latest.id;
          changed = true;
          if (!first) {
            if ("Notification" in window && Notification.permission === "granted") {
              try { new Notification(`${f.name} released a track`, { body: latest.title, icon: artUrl(latest) }); } catch {}
            } else toast(`${f.name}: ${latest.title}`);
          }
        } else if (latest && latest.id && !f.lastId) {
          f.lastId = latest.id;
          changed = true;
        }
      } catch {}
    }
    if (changed) saveFollowing();
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
    const cover = d.cover || "/cover-default.png";
    return `
      <p class="pl-ed-lead">Name it, then tap the cover or banner. Crop opens on top — you come right back here.</p>
      <div class="pl-ed">
        <div class="pl-ed-banner${d.banner ? " has-img" : ""}" id="plEdBanner">
          <button type="button" class="chip-btn pl-ed-ban-btn" id="plEdPickBanner">${d.banner ? "Change banner" : "Add banner"}</button>
        </div>
        <button type="button" class="pl-ed-cover-btn" id="plEdPickCover" title="Change picture">
          <img id="plEdCover" src="${escapeAttr(cover)}" alt="" onerror="this.src='/cover-default.png'"/>
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
          save("aura.playlists", state.playlists);
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
        save("aura.playlists", state.playlists);
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
        <img src="${escapeAttr(playlistArt(p))}" alt="" onerror="this.src='/cover-default.png'"/>
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
        save("aura.playlists", state.playlists);
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
    $("searchInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.value.trim()) runSearch(e.target.value.trim());
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
    $("playBtn").onclick = togglePlay;
    $("nextBtn").onclick = () => next(true);
    $("prevBtn").onclick = prev;
    $("shuffleBtn").onclick = () => { state.shuffle = !state.shuffle; renderChrome(); };
    $("repeatBtn").onclick = () => {
      state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
      toast(state.repeat === "off" ? "Repeat off" : state.repeat === "all" ? "Repeat queue" : "Repeat one");
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
    $("seek").addEventListener("input", (e) => {
      const d = duration();
      if (d) seekTo((Number(e.target.value) / 1000) * d);
    });
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
    $("videoBtn").onclick = () => {
      state.showVideo = !state.showVideo;
      showEl($("ytWrap"), state.showVideo);
    };
    $("closeVideo").onclick = () => { state.showVideo = false; showEl($("ytWrap"), false); };
    $("lyricsBtn").onclick = () => {
      if (!current()) { toast("Play a song first"); return; }
      if (state.view === "now") requestBack();
      else setView("now");
    };
    $("openNow").onclick = () => {
      if (!current()) { toast("Play a song first"); return; }
      if (state.view === "now") return;
      setView("now");
    };
    if ($("pasteBtn")) $("pasteBtn").onclick = pasteYouTube;
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
      closeOverlays();
      if (b.hasAttribute("data-open-liked")) { state.view = "library"; state.activePlaylist = "liked"; render(); }
      if (b.dataset.pl) { state.view = "library"; state.activePlaylist = Number(b.dataset.pl); render(); }
    });
    $("queueList").addEventListener("click", (e) => {
      const del = e.target.closest("[data-q-del]");
      if (del) {
        e.stopPropagation();
        removeQueued(Number(del.dataset.qDel));
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
    audio.addEventListener("ended", () => {
      if (state._xfading) { state._xfading = false; return; }
      next(false);
    });
    audio.addEventListener("play", () => { state.playing = true; updateMediaSession(); renderChrome(); });
    audio.addEventListener("pause", () => {
      if (current() && current().source === "youtube") return;
      if (audio.ended) return;
      if (wantPlay && state.prefs.bgPlay !== false && document.hidden) {
        audio.play().catch(() => {});
        return;
      }
      if (!wantPlay) {
        state.playing = false;
        updateMediaSession();
        renderChrome();
      }
    });
    audio.addEventListener("error", () => { if (current() && current().source !== "youtube") skipFailed("Stream failed"); });

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
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let x = innerWidth / 2;
    let y = innerHeight - 80;
    if (el && el.getBoundingClientRect) {
      const r = el.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top;
    }
    const glyphs = ["♥", "♡", "♪", "♫"];
    for (let i = 0; i < 16; i++) {
      sparkBits.push({
        x: x * dpr,
        y: y * dpr,
        vx: (Math.random() - 0.5) * 7 * dpr,
        vy: -(2.2 + Math.random() * 5) * dpr,
        life: 1,
        decay: 0.014 + Math.random() * 0.01,
        g: glyphs[i % glyphs.length],
        s: 14 + Math.random() * 16,
        hue: i % 2 ? 340 + Math.random() * 18 : 300 + Math.random() * 40,
      });
    }
  }
  (function startSparks() {
    const c = $("sparkLayer");
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return; // no 2D context (headless test env) — skip the effect
    const dpr = () => Math.min(2, window.devicePixelRatio || 1);
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
      if (state.view !== "home" || sparkBits.length > 20) return;
      const p = dpr();
      sparkBits.push({
        x: Math.random() * innerWidth * p,
        y: (anywhere ? innerHeight * (0.12 + Math.random() * 0.72) : innerHeight + 12) * p,
        vx: (Math.random() - 0.5) * 0.55 * p,
        vy: -(0.35 + Math.random() * 0.85) * p,
        life: 1,
        decay: 0.0016 + Math.random() * 0.001,
        g: ambient[Math.floor(Math.random() * ambient.length)],
        s: 16 + Math.random() * 14,
        hue: [150 + Math.random() * 45, 260 + Math.random() * 35, 335 + Math.random() * 25][Math.floor(Math.random() * 3)],
      });
    }
    let sparkOn = true;
    function tick() {
      if (document.hidden) {
        sparkOn = false;
        return;
      }
      const need = sparkBits.length || state.view === "home";
      if (!need) {
        ctx.clearRect(0, 0, c.width, c.height);
        sparkOn = false;
        return;
      }
      ctx.clearRect(0, 0, c.width, c.height);
      if (state.view === "home" && sparkBits.length < 20 && Math.random() < 0.03) spawnAmbient();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const p = dpr();
      for (let i = sparkBits.length - 1; i >= 0; i--) {
        const b = sparkBits[i];
        b.x += b.vx;
        b.y += b.vy;
        b.life -= b.decay;
        if (b.life <= 0) {
          sparkBits.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, b.life) * 0.9;
        ctx.font = `${b.s * p}px "Segoe UI Emoji", "Apple Color Emoji", system-ui, sans-serif`;
        ctx.fillStyle = `hsl(${b.hue} 85% 72%)`;
        ctx.fillText(b.g, b.x, b.y);
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(tick);
    }
    function kickSparks() {
      if (sparkOn) return;
      sparkOn = true;
      requestAnimationFrame(tick);
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) kickSparks();
    });
    window.kickSparks = kickSparks;
    // Seed a few notes right away so the homepage shows the animation
    // immediately instead of waiting for random spawns.
    for (let i = 0; i < 10; i++) spawnAmbient(true);
    requestAnimationFrame(tick);
  })();

  applyTheme();
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
    if (document.visibilityState === "visible") updateWakeLock();
    keepBackgroundPlay();
  });
  window.addEventListener("pageshow", () => keepBackgroundPlay());
  document.addEventListener("resume", () => keepBackgroundPlay());
  document.addEventListener("freeze", () => {
    if (wantPlay) updateMediaSession();
  });
  if (state.prefs.resume && state.recents.length) {
    state.queue = state.recents.slice(0, 24);
    state.index = 0;
  }
  if (!state.prefs.github) {
    state.prefs.github = "https://github.com/Kaibshshdheueejw/Muchi-music-New";
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
  try { if (window.MuchiAndroid && MuchiAndroid.ready) MuchiAndroid.ready(); } catch {}
  if (/MuchiApp/i.test(navigator.userAgent)) {
    setInterval(() => { if (wantPlay) keepBackgroundPlay(); }, 2000);
  }
  detectCountry();
  setVolume(state.volume);
  wire();
  initAuth();
  setQueueOpen(false);
  renderPlaylistsNav();
  try { history.replaceState(navSnap(), ""); } catch {}
  loadHome();
  checkUpdates(true);
  const homeStale = () => Date.now() - homeFetchedAt > 86400000 || (state.home && state.home.day !== utcDayClient());
  setInterval(() => {
    if (!document.hidden && homeStale()) loadHome(true);
  }, 3600000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && homeStale()) loadHome(true);
  });
})();
