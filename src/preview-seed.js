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

// ── Curated catalog (real English hits, mood-tagged) ─────────────────────
// [title, artist, duration, moodTags...] — a track belongs to the moods it is
// tagged with, so each "Made for you" playlist draws its own distinct set.
const CATALOG = [
  // Pop
  ["Blinding Lights", "The Weeknd", 200, "pop", "trending"],
  ["As It Was", "Harry Styles", 174, "pop", "trending"],
  ["Levitating", "Dua Lipa", 203, "pop", "dance", "workout"],
  ["Uptown Funk", "Mark Ronson feat. Bruno Mars", 270, "pop", "dance", "throwback"],
  ["Shape of You", "Ed Sheeran", 234, "pop", "trending"],
  ["Shake It Off", "Taylor Swift", 219, "pop", "workout", "throwback"],
  ["Flowers", "Miley Cyrus", 193, "pop", "trending"],
  ["As It Was (Live)", "Harry Styles", 178, "pop"],
  ["Stay", "The Kid LAROI & Justin Bieber", 141, "pop", "trending"],
  ["Watermelon Sugar", "Harry Styles", 174, "pop", "chill"],
  ["Bad Guy", "Billie Eilish", 194, "pop", "trending"],
  ["Dance Monkey", "Tones and I", 209, "pop", "dance", "trending"],
  ["Happier", "Ed Sheeran", 205, "pop", "chill"],
  ["Counting Stars", "OneRepublic", 257, "pop", "workout", "throwback"],
  ["Shivers", "Ed Sheeran", 207, "pop", "trending"],
  ["Hold Me Closer", "Elton John & Britney Spears", 202, "pop", "dance"],
  ["Heat Waves", "Glass Animals", 226, "pop", "chill", "indie"],
  ["Sunroof", "Nicky Youre & dazy", 168, "pop", "chill", "trending"],
  ["Radioactive", "Imagine Dragons", 187, "pop", "rock", "workout"],
  ["Believer", "Imagine Dragons", 204, "pop", "rock", "workout"],
  // Hip-Hop
  ["Sicko Mode", "Travis Scott", 312, "hiphop", "trending"],
  ["HUMBLE.", "Kendrick Lamar", 177, "hiphop", "workout"],
  ["God's Plan", "Drake", 198, "hiphop", "trending"],
  ["Lose Yourself", "Eminem", 326, "hiphop", "workout", "throwback"],
  ["Old Town Road", "Lil Nas X", 193, "hiphop", "trending"],
  ["Alright", "Kendrick Lamar", 219, "hiphop"],
  ["Industry Baby", "Lil Nas X & Jack Harlow", 212, "hiphop", "workout"],
  ["Going Bad", "Meek Mill feat. Drake", 207, "hiphop"],
  ["Rockstar", "Post Malone feat. 21 Savage", 218, "hiphop", "trending"],
  ["I Like It", "Cardi B, Bad Bunny & J Balvin", 253, "hiphop", "dance"],
  ["Chun-Li", "Nicki Minaj", 178, "hiphop"],
  ["XO Tour Llif3", "Lil Uzi Vert", 182, "hiphop", "trending"],
  ["Money in the Grave", "Drake", 205, "hiphop", "workout"],
  ["Wow.", "Post Malone", 149, "hiphop", "workout"],
  ["No Role Modelz", "J. Cole", 292, "hiphop", "chill"],
  ["Rack City", "Tyga", 203, "hiphop"],
  ["Pain", "Pusha T", 262, "hiphop"],
  ["Bodak Yellow", "Cardi B", 190, "hiphop", "workout"],
  ["Mask Off", "Future", 198, "hiphop", "trending"],
  ["Look At Me!", "XXXTENTACION", 137, "hiphop"],
  // R&B
  ["Leave the Door Open", "Bruno Mars & Anderson .Paak", 242, "rnb", "chill"],
  ["Peaches", "Justin Bieber feat. Daniel Caesar", 198, "rnb", "trending"],
  ["Kiss Me More", "Doja Cat feat. SZA", 208, "rnb", "trending"],
  ["CUFF IT", "Beyoncé", 224, "rnb", "dance"],
  ["Snooze", "SZA", 208, "rnb", "chill"],
  ["Blinding Lights (Remix)", "The Weeknd", 203, "rnb"],
  ["Good Days", "SZA", 283, "rnb", "chill"],
  ["I Fall Apart", "Post Malone", 221, "rnb", "chill"],
  ["Redbone", "Childish Gambino", 332, "rnb", "chill"],
  ["Best Part", "Daniel Caesar & H.E.R.", 210, "rnb", "chill"],
  ["Off the Grid", "Kanye West", 246, "rnb", "hiphop"],
  ["Girls Need Love", "Summer Walker", 182, "rnb", "chill"],
  ["Focus", "H.E.R.", 204, "rnb"],
  ["Adorn", "Miguel", 212, "rnb", "chill"],
  ["Blame It", "Jamie Foxx feat. T-Pain", 264, "rnb", "throwback"],
  ["Show Me", "Kid Ink feat. Chris Brown", 216, "rnb"],
  ["Dark Red", "Steve Lacy", 169, "rnb", "indie", "chill"],
  ["Break from Toronto", "PARTYNEXTDOOR", 200, "rnb", "chill"],
  ["In My Feelings", "Drake", 217, "rnb", "dance"],
  ["Needed Me", "Rihanna", 191, "rnb"],
  // Rock
  ["Mr. Brightside", "The Killers", 222, "rock", "throwback", "workout"],
  ["Seven Nation Army", "The White Stripes", 231, "rock", "workout"],
  ["Smells Like Teen Spirit", "Nirvana", 278, "rock", "throwback"],
  ["Livin' on a Prayer", "Bon Jovi", 249, "rock", "throwback"],
  ["Highway to Hell", "AC/DC", 208, "rock", "workout"],
  ["Take Me Out", "Franz Ferdinand", 237, "rock", "indie"],
  ["Do I Wanna Know?", "Arctic Monkeys", 272, "rock", "indie"],
  ["R U Mine?", "Arctic Monkeys", 201, "rock", "indie"],
  ["Somebody to Love", "Queen", 296, "rock", "throwback"],
  ["Don't Stop Believin'", "Journey", 251, "rock", "throwback"],
  ["Everlong", "Foo Fighters", 250, "rock", "throwback"],
  ["Zombie", "The Cranberries", 311, "rock", "throwback"],
  ["Believer (Remix)", "Imagine Dragons", 166, "rock", "workout"],
  ["Sweater Weather", "The Neighbourhood", 240, "rock", "indie", "chill"],
  ["Ocean Eyes", "Billie Eilish", 200, "rock", "indie"],
  ["Rollercoaster", "Bleachers", 204, "rock", "indie"],
  ["Girls Like You", "Maroon 5", 216, "rock", "pop"],
  ["Sugar", "Maroon 5", 235, "rock", "pop"],
  ["Best Day of My Life", "American Authors", 194, "rock", "workout"],
  ["Shut Up and Dance", "Walk the Moon", 195, "rock", "dance", "workout"],
  // Dance / Electronic
  ["One Kiss", "Calvin Harris & Dua Lipa", 214, "dance", "workout"],
  ["Titanium", "David Guetta feat. Sia", 245, "dance", "workout"],
  ["Clarity", "Zedd feat. Foxes", 271, "dance"],
  ["Wake Me Up", "Avicii", 271, "dance", "throwback"],
  ["Levels", "Avicii", 218, "dance", "throwback"],
  ["This Is What You Came For", "Calvin Harris & Rihanna", 222, "dance"],
  ["Don't Start Now", "Dua Lipa", 183, "dance", "workout", "trending"],
  ["Physical", "Dua Lipa", 193, "dance", "workout"],
  ["Pepas", "Farruko", 289, "dance", "workout"],
  ["The Business", "Tiësto", 183, "dance", "workout"],
  ["Dancin (Krono Remix)", "Aaron Smith", 205, "dance", "chill"],
  ["Staying Alive", "Bee Gees", 236, "dance", "throwback"],
  ["I Wanna Dance with Somebody", "Whitney Houston", 299, "dance", "throwback"],
  ["All Night Long", "Lionel Richie", 269, "dance", "throwback"],
  ["Party in the U.S.A.", "Miley Cyrus", 201, "dance", "pop", "trending"],
  ["Blinding Lights (Live)", "The Weeknd", 177, "dance"],
  ["Faded", "Alan Walker", 211, "dance", "chill"],
  ["Alone", "Marshmello", 261, "dance"],
  ["Closer", "The Chainsmokers feat. Halsey", 244, "dance", "chill"],
  ["Taki Taki", "DJ Snake feat. Selena Gomez", 212, "dance", "hiphop"],
  // Indie / Alternative
  ["Heat Waves (Piano)", "Glass Animals", 202, "indie", "chill"],
  ["Riptide", "Vance Joy", 204, "indie", "chill"],
  ["Dog Days Are Over", "Florence + The Machine", 252, "indie", "chill"],
  ["Somebody Else", "The 1975", 338, "indie", "chill"],
  ["Motion Sickness", "Phoebe Bridgers", 225, "indie"],
  ["Cigarette Daydreams", "Cage the Elephant", 233, "indie", "chill"],
  ["Tongue Tied", "Grouplove", 203, "indie", "workout"],
  ["Electric Feel", "MGMT", 220, "indie", "chill"],
  ["Little Talks", "Of Monsters and Men", 261, "indie", "chill"],
  ["Ho Hey", "The Lumineers", 163, "indie", "chill"],
  ["Crazy", "Gnarls Barkley", 178, "indie", "throwback"],
  ["Happy", "Pharrell Williams", 232, "pop", "indie", "workout"],
  ["Passionfruit", "Drake", 299, "indie", "rnb", "chill"],
  ["Lost", "Frank Ocean", 270, "indie", "rnb", "chill"],
  ["Sofia", "Clairo", 200, "indie", "chill"],
  ["Paris", "The 1975", 273, "indie", "chill"],
  ["Space Song", "Beach House", 342, "indie", "chill"],
  ["Meet Me in the Middle", "Twin Peaks", 221, "indie"],
  ["Time to Pretend", "MGMT", 181, "indie"],
  ["Stolen Dance", "Milky Chance", 320, "indie", "chill"],
  // Pop
  ["Anti-Hero", "Taylor Swift", 200, "pop", "trending"],
  ["Cruel Summer", "Taylor Swift", 171, "pop", "trending"],
  ["Espresso", "Sabrina Carpenter", 175, "pop", "trending"],
  ["Die With A Smile", "Lady Gaga & Bruno Mars", 251, "pop", "trending"],
  ["Birds of a Feather", "Billie Eilish", 210, "pop", "chill"],
  ["Good 4 U", "Olivia Rodrigo", 178, "pop", "workout"],
  ["Kill Bill", "SZA", 173, "pop", "rnb"],
  ["Calm Down", "Rema & Selena Gomez", 219, "pop", "dance"],
  // Hip-Hop
  ["Stronger", "Kanye West", 312, "hiphop", "workout", "throwback"],
  ["Crank That (Soulja Boy)", "Soulja Boy", 208, "hiphop", "throwback"],
  ["In Da Club", "50 Cent", 213, "hiphop", "workout", "throwback"],
  ["Broke In A Minute", "Tory Lanez", 177, "hiphop"],
  ["Sticky", "Tyler, The Creator", 240, "hiphop"],
  ["Like That", "Future, Metro Boomin & Kendrick Lamar", 227, "hiphop", "trending"],
  ["Not Like Us", "Kendrick Lamar", 274, "hiphop", "trending"],
  ["HUMBLE. (Remix)", "Kendrick Lamar", 180, "hiphop", "workout"],
  // R&B
  ["Hrs & Hrs", "Muni Long", 211, "rnb", "chill"],
  ["Sure Thing", "Miguel", 211, "rnb", "chill"],
  ["Woman", "Doja Cat", 162, "rnb", "pop", "dance"],
  ["Nights Like This", "Kehlani", 210, "rnb", "chill"],
  ["Get You", "Daniel Caesar", 272, "rnb", "chill"],
  ["Karma", "Summer Walker", 223, "rnb", "chill"],
  ["Location", "Khalid", 200, "rnb", "chill"],
  ["Better", "Khalid", 200, "rnb", "chill"],
  // Rock
  ["Back In Black", "AC/DC", 255, "rock", "workout", "throwback"],
  ["Sweet Child O' Mine", "Guns N' Roses", 356, "rock", "throwback"],
  ["Bohemian Rhapsody", "Queen", 354, "rock", "throwback"],
  ["Losing My Religion", "R.E.M.", 266, "rock", "indie"],
  ["Wonderwall", "Oasis", 258, "rock", "indie", "throwback"],
  ["Every Rose Has Its Thorn", "Poison", 260, "rock", "throwback"],
  ["Under Pressure", "Queen & David Bowie", 241, "rock", "throwback"],
  ["Paradise City", "Guns N' Roses", 410, "rock", "workout"],
  // Dance / Electronic
  ["Cold Heart", "Elton John & Dua Lipa", 200, "dance", "pop", "trending"],
  ["Moth To A Flame", "Swedish House Mafia & The Weeknd", 220, "dance", "workout"],
  ["Savage", "Megan Thee Stallion", 160, "dance", "hiphop"],
  ["Head & Heart", "Joel Corry feat. MNEK", 160, "dance", "workout"],
  ["Goosebumps", "Travis Scott", 214, "dance", "hiphop"],
  ["Sunflower", "Post Malone & Swae Lee", 158, "dance", "pop", "chill"],
  ["Pepas (Remix)", "Farruko", 200, "dance", "workout"],
  ["Watch Me (Whip/Nae Nae)", "Silentó", 200, "dance", "workout"],
  // Indie / Alternative
  ["The Less I Know The Better", "Tame Impala", 216, "indie", "chill"],
  ["Youth", "Daughter", 210, "indie", "chill"],
  ["Electric Love", "BØRNS", 200, "indie", "dance"],
  ["Loving Is Easy", "Rex Orange County", 200, "indie", "chill"],
  ["Someone New", "Hozier", 200, "indie", "pop"],
  ["I Will Follow You Into The Dark", "Death Cab for Cutie", 210, "indie", "chill"],
  ["Loverboy", "A-Wall", 190, "indie", "chill"],
  ["Night Owl", "Galimatias", 190, "indie", "chill"],
  // Trending
  ["Barbie World", "Nicki Minaj & Ice Spice", 120, "trending", "hiphop", "dance"],
  ["Dance The Night", "Dua Lipa", 178, "trending", "pop", "dance"],
  ["Paint The Town Red", "Doja Cat", 200, "trending", "hiphop"],
  ["Seven", "Jung Kook feat. Latto", 200, "trending", "pop"],
  ["What Was I Made For?", "Billie Eilish", 200, "trending", "chill"],
  ["Vampire", "Olivia Rodrigo", 200, "trending", "pop"],
  ["Fast Car", "Luke Combs", 201, "trending", "pop"],
  ["Summer", "Calvin Harris", 200, "trending", "dance"],
  // Chill
  ["Sunset Lover", "Petit Biscuit", 200, "chill"],
  ["The Night We Met", "Lord Huron", 220, "chill", "indie"],
  ["Catch & Release", "Matt Simons", 200, "chill", "pop"],
  ["Let Her Go", "Passenger", 253, "chill", "pop", "throwback"],
  ["Young Dumb & Broke", "Khalid", 224, "chill", "rnb", "pop"],
  ["Snooze (Acoustic)", "SZA", 208, "chill", "rnb"],
  ["Blinding Lights (Instrumental)", "The Weeknd", 200, "chill"],
  ["As It Was (Acoustic)", "Harry Styles", 174, "chill", "pop"],
  // Workout
  ["Eye of the Tiger", "Survivor", 244, "workout", "throwback"],
  ["Stronger", "Kelly Clarkson", 204, "workout", "pop"],
  ["Till I Collapse", "Eminem", 297, "workout", "hiphop"],
  ["Can't Hold Us", "Macklemore & Ryan Lewis", 258, "workout", "hiphop", "throwback"],
  ["Power", "Kanye West", 280, "workout", "hiphop"],
  ["Bangarang", "Skrillex", 214, "workout", "dance"],
  ["Born to Run", "Bruce Springsteen", 270, "workout", "rock", "throwback"],
  ["The Champion", "Carrie Underwood feat. Ludacris", 210, "workout", "pop"],
  // Throwback
  ["I Want It That Way", "Backstreet Boys", 200, "throwback", "pop"],
  ["Wannabe", "Spice Girls", 150, "throwback", "pop", "dance"],
  ["...Baby One More Time", "Britney Spears", 200, "throwback", "pop"],
  ["Say My Name", "Destiny's Child", 240, "throwback", "rnb", "dance"],
  ["No Scrubs", "TLC", 244, "throwback", "rnb"],
  ["Crazy in Love", "Beyoncé feat. Jay-Z", 235, "throwback", "rnb", "dance"],
  ["Toxic", "Britney Spears", 200, "throwback", "pop", "dance"],
  ["Genie in a Bottle", "Christina Aguilera", 197, "throwback", "pop"],
];

// The 10 "Made for you" mood playlists. `tags` lists the mood tags (from the
// catalog above) that populate each playlist; `count` is how many songs it
// shows (20). Cover art = the first song's artwork (per customer request).
const FY_MOODS = [
  { id: "mod:pop",      title: "Pop Hits",       subtitle: "Top English pop",          tags: ["pop"],         count: 20, cover: "/covers/cover-pop.jpg" },
  { id: "mod:hiphop",   title: "Hip-Hop",        subtitle: "Fresh flows",              tags: ["hiphop"],      count: 20, cover: "/covers/cover-hiphop.jpg" },
  { id: "mod:rnb",      title: "R&B",            subtitle: "Smooth grooves",           tags: ["rnb"],         count: 20, cover: "/covers/cover-rnb.jpg" },
  { id: "mod:rock",     title: "Rock",           subtitle: "Earworms",                 tags: ["rock"],        count: 20, cover: "/covers/cover-rock.jpg" },
  { id: "mod:dance",    title: "Dance Hits",     subtitle: "Party starters",           tags: ["dance"],       count: 20, cover: "/covers/cover-dance.jpg" },
  { id: "mod:indie",    title: "Indie",          subtitle: "New discoveries",          tags: ["indie"],       count: 20, cover: "/covers/cover-indie.jpg" },
  { id: "mod:trending", title: "Trending",       subtitle: "What the world is playing", tags: ["trending"],   count: 20, cover: "/covers/cover-trending.jpg" },
  { id: "mod:chill",    title: "Chill Vibes",    subtitle: "Easy listening, all day",  tags: ["chill"],       count: 20, cover: "/covers/cover-chill.jpg" },
  { id: "mod:workout",  title: "Workout Energy", subtitle: "Push through the burn",     tags: ["workout"],     count: 20, cover: "/covers/cover-workout.jpg" },
  { id: "mod:throw",    title: "Throwback",      subtitle: "90s & 2000s classics",      tags: ["throwback"],   count: 20, cover: "/covers/cover-throwback.jpg" },
];

// Stable sub-set of the catalog for the genre "shelves" (pop/hiphop/etc).
const SHELVES = [
  { id: "today",   title: "Today's Top Hits",   tags: ["trending", "pop", "dance"] },
  { id: "pop",     title: "Pop",                tags: ["pop"] },
  { id: "hiphop",  title: "Hip-Hop",            tags: ["hiphop"] },
  { id: "rnb",     title: "R&B",                tags: ["rnb"] },
  { id: "rock",    title: "Rock",               tags: ["rock"] },
  { id: "dance",   title: "Dance & Electronic", tags: ["dance"] },
  { id: "indie",   title: "Indie",              tags: ["indie"] },
];
const SHELF_BY_ID = {}; for (const s of SHELVES) SHELF_BY_ID[s.id] = s;

const AUDIO_URL = "/api/preview/audio";
// The sandbox has NO egress to real music providers, so the preview plays a
// locally-generated WAV tone for the SAME length as the track's real duration,
// so the progress bar/seek behave like a real song.
const streamUrlFor = (duration) => `${AUDIO_URL}?dur=${Number(duration) || 30}`;
const ARTWORK = "/cover-default.jpg";

let seq = 0;
function mkTrack([title, artist, duration], tag = "") {
  seq += 1;
  // `tag` may be a single string or a comma-separated list of mood tags.
  const tags = String(tag).split(",").map((x) => x.trim()).filter(Boolean);
  return {
    id: `pv:${seq}`,
    source: "preview",
    title,
    artist,
    album: "",
    duration,
    artwork: ARTWORK,
    streamUrl: streamUrlFor(duration),
    playQuery: `${title} ${artist} official audio`,
    genre: tags[0] || "",        // primary mood — drives the taste profile
    _tag: tags.join(","),        // full mood set
  };
}

// Return up to `n` distinct catalog songs whose mood tag is in `tags`. If there
// are fewer than `n` direct matches, top up with the rest of the catalog so a
// mood playlist always has a full set of latest English hits (distinct per mood
// via tag priority, but never empty). Deterministic & stable.
function moodTracks(tags, n) {
  const match = CATALOG.filter((c) => c.slice(3).some((t) => tags.includes(t)));
  const rest = CATALOG.filter((c) => !c.slice(3).some((t) => tags.includes(t)));
  // Interleave rest deterministically starting at 0 so secondary playlists are
  // distinct, not identical to the primary list.
  const picks = [];
  const seen = new Set();
  for (const c of [...match, ...rest]) {
    const key = `${c[0]}|${c[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(c);
    if (picks.length >= n) break;
  }
  return picks.slice(0, n).map((p) => mkTrack([p[0], p[1], p[2]], p.slice(3).join(",")));
}

// Plain (untagged) user taste mix — used by /api/for-you and /api/discover.
function allTracks() {
  return CATALOG.map((p) => mkTrack([p[0], p[1], p[2]], p.slice(3).join(",")));
}

function catalogTracks() {
  return allTracks().map((t) => ({ ...t }));
}

// Partition the whole catalog into 10 DISJOINT pools of exactly `per` songs,
// one per mood, so no two "Made for you" playlists share a single song.
//
// Coherence strategy: each song's FIRST tag is its primary mood. Moods with
// >= per primary songs give per of them to themselves and donate the rest to a
// shared donor pool; moods with fewer primary songs keep all of theirs and then
// draw from the donor pool, preferring donated songs that also carry their own
// tag. Because the 6 primary-heavy moods (pop/hiphop/rnb/rock/dance/indie)
// overflow by exactly the 4 undersupplied moods' shortfall (48), this fills
// every pool to exactly `per` while keeping each playlist dominated by its
// mood and guaranteeing zero cross-playlist repeats.
function fyMoodPools(per = 20) {
  const tags = FY_MOODS.map((m) => m.tags[0]);
  // Group songs by primary (first) tag.
  const primary = {};
  for (const c of CATALOG) {
    const t = c[3] || "pop";
    (primary[t] = primary[t] || []).push(c);
  }
  const pools = FY_MOODS.map(() => []);
  const used = new Set(); // "title|artist" keys
  const key = (c) => `${c[0]}|${c[1]}`;
  const donor = []; // overflow songs from primary-heavy moods
  for (let i = 0; i < FY_MOODS.length; i++) {
    const group = primary[tags[i]] || [];
    const take = Math.min(per, group.length);
    for (let j = 0; j < take; j++) {
      pools[i].push(group[j]);
      used.add(key(group[j]));
    }
    for (let j = take; j < group.length; j++) donor.push(group[j]);
  }
  // Fill undersupplied moods from the donor pool, preferring donated songs that
  // carry this mood's tag (so Chill Vibes gets chill-leaning songs, etc.).
  for (let i = 0; i < FY_MOODS.length; i++) {
    const t = tags[i];
    while (pools[i].length < per) {
      let idx = donor.findIndex((c) => !used.has(key(c)) && c.slice(3).includes(t));
      if (idx === -1) idx = donor.findIndex((c) => !used.has(key(c)));
      if (idx === -1) break;
      used.add(key(donor[idx]));
      pools[i].push(donor[idx]);
    }
  }
  return pools;
}

// Build a "Made for you" playlist object from a pre-partitioned song pool.
function fyPlaylistFrom(mood, pool) {
  const tracks = pool.map((c) => {
    const t = mkTrack([c[0], c[1], c[2]], c.slice(3).join(","));
    return { ...t, artwork: mood.cover };
  });
  return {
    id: mood.id,
    title: mood.title,
    subtitle: mood.subtitle,
    query: mood.tags.join(" "),
    artwork: (tracks[0] && tracks[0].artwork) || mood.cover,
    playlistId: "",
    kind: "yt",
    mood: mood.id,
    genres: mood.tags,
    tracks,
  };
}

// A "Trending in <country>" / "Global trending playlists" card: cover art is
// the FIRST song inside the playlist and it carries the full song list, so the
// card shows the real song count and opens with everything already present.
function shelfPlaylistCard(card, mood) {
  const tracks = (card && card.tracks) || [];
  return {
    title: (card && card.title) || (mood && mood.title) || "Daily mix",
    artist: "Daily mix",
    artwork: (tracks[0] && tracks[0].artwork) || (card && card.artwork) || ARTWORK,
    query: (mood && mood.tags && mood.tags.join(" ")) || "",
    tracks,
  };
}

function tracksForShelf(shelfId) {
  const s = SHELF_BY_ID[shelfId];
  if (!s) return [];
  if (shelfId === "today") {
    // Mix a few from every genre.
    return CATALOG.filter((_, i) => i % 3 === 0).map((p) => mkTrack([p[0], p[1], p[2]], p.slice(3).join(",")));
  }
  return moodTracks(s.tags, 20);
}

function playlistTracks(q) {
  const needle = String(q || "").toLowerCase();
  // Use the SAME disjoint mood pool the "Made for you" card shows, so opening a
  // card re-fetches exactly the 20 songs that were displayed (no drift).
  const pools = fyMoodPools(20);
  const idx = FY_MOODS.findIndex((m) => m.tags.some((t) => needle.includes(t)));
  if (idx >= 0) return fyPlaylistFrom(FY_MOODS[idx], pools[idx]).tracks;
  return moodTracks(["pop"], 20);
}

// ── /api/home ───────────────────────────────────────────────────────────
export function previewHome(gl, taste) {
  const shelves = SHELVES.map((s) => ({
    id: s.id,
    title: s.title,
    query: s.tags.join(" "),
    tracks: tracksForShelf(s.id),
  }));
  const moods = (FY_MOODS.filter((m) => !m.tags.includes("trending"))).map((m, i) => ({
    id: m.tags[0],
    title: m.title,
    query: m.tags.join(" "),
    color: ["#90e0ef", "#e9c46a", "#c084fc", "#fb7185", "#4cc9f0", "#80ed99"][i % 6],
  }));
  // Taste-adaptive: when the user has a taste profile (artists/genres they have
  // been listening to), reorder the "Made for you" playlists so the moods that
  // match their top genres surface first. This is what makes the section change
  // as they keep listening.
  // Each card gets its own DISJOINT 20-song pool from fyMoodPools(), so the 10
  // playlists never share a song and each is a genuinely different mood.
  const pools = fyMoodPools(20);
  let cards = FY_MOODS.map((m, i) => fyPlaylistFrom(m, pools[i]));
  if (taste && (taste.genres || []).length) {
    const g = taste.genres.map((x) => (Array.isArray(x) ? x[0] : x)).filter(Boolean);
    const key = new Set(g.map((x) => String(x).toLowerCase()));
    cards = cards.slice().sort((a, b) => {
      const am = (a.genres || []).filter((t) => key.has(t)).length;
      const bm = (b.genres || []).filter((t) => key.has(t)).length;
      return bm - am;
    });
  }
  return {
    country: gl || "IN",
    day: new Date().toISOString().slice(0, 10),
    localQuery: "popular songs",
    moods,
    shelves,
    youtubeCharts: allTracks().slice(0, 20),
    youtubeIndia: allTracks().slice(0, 12),
    youtubeLocal: allTracks().slice(0, 10),
    countryPlaylists: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => shelfPlaylistCard(cards[i], FY_MOODS[i])),
    globalPlaylists: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => shelfPlaylistCard(cards[i], FY_MOODS[i])),
    // 10 curated "Made for you" cards, each with its first song's art + 20 songs.
    forYouPlaylists: cards,
    audius: [],
    underground: allTracks().slice(0, 8),
    radio: [],
  };
}

// ── /api/shelf ───────────────────────────────────────────────────────────
export function previewShelf(id, q, gl) {
  if (id && SHELF_BY_ID[id]) {
    const s = SHELF_BY_ID[id];
    return { id, title: s.title, query: s.tags.join(" "), tracks: tracksForShelf(id) };
  }
  const mood = FY_MOODS.find((m) =>
    String(q || "").toLowerCase() === m.tags[0] ||
    String(q || "").toLowerCase().includes(m.title.toLowerCase().split(" ")[0])
  );
  const tracks = (mood ? moodTracks(mood.tags, mood.count) : playlistTracks(q)).map((t) => ({
    ...t,
    artwork: (mood && mood.cover) || ARTWORK,
  }));
  return { id: "", title: (mood && mood.title) || q || "Songs", query: q || "", tracks };
}

// ── /api/search + /api/youtube/search ────────────────────────────────────
function matchTracks(q) {
  const needle = String(q || "").toLowerCase().trim();
  if (!needle) return allTracks().slice(0, 24);
  const wantedTag = ["pop", "hiphop", "rnb", "rock", "dance", "indie"].find((t) => needle.includes(t)) || "";
  return allTracks().filter((t) => {
    const hay = `${t.title} ${t.artist} ${t._tag}`.toLowerCase();
    if (wantedTag && t._tag === wantedTag) return true;
    return needle.split(/\s+/).every((w) => hay.includes(w));
  }).slice(0, 24);
}

export function previewSearch(q) {
  const tracks = matchTracks(q);
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

// ── /api/related + /api/discover + /api/for-you ──────────────────────────
export function previewRelated(title) {
  const base = matchTracks(title);
  const tracks = base.length ? base : allTracks().slice(0, 24);
  return { tracks: tracks.slice(0, 24) };
}

// Taste-adaptive discovery / "for you" mix. We use the same English catalog and
// PROMOTE songs by artists the user has been listening to (from the taste
// profile). When no taste exists, we just return a broad English mix.
export function previewDiscover(gl, taste) {
  let tracks = allTracks();
  const artists = taste && taste.artists ? taste.artists.map((x) => (Array.isArray(x) ? x[0] : x)).filter(Boolean) : [];
  if (artists.length) {
    const a = new Set(artists.map((x) => String(x).toLowerCase()));
    tracks = tracks.slice().sort((x, y) => {
      const am = a.has(String(x.artist).toLowerCase()) ? 1 : 0;
      const bm = a.has(String(y.artist).toLowerCase()) ? 1 : 0;
      return bm - am;
    });
  }
  return { week: "preview", title: "Discovery Mix", tracks: tracks.slice(0, 30) };
}

// ── /api/radio ───────────────────────────────────────────────────────────
export function previewRadio(q) {
  return { tracks: matchTracks(q).slice(0, 36) };
}

// ── /api/lyrics ──────────────────────────────────────────────────────────
export function previewLyrics(title, artist) {
  // Matches the contract the client (public/app.js loadLyrics) reads:
  // { lyrics: <string>, synced: <array> }.
  return {
    title: title || "Song",
    artist: artist || "Artist",
    lyrics: [
      `♪ ${title || "This song"} ♪`,
      "",
      `— ${artist || "Artist"}`,
      "",
      "(Preview lyrics shown for testing.)",
    ].join("\n"),
    synced: [],
  };
}

// ── /api/preview/audio — a pleasant local tone (WAV) ────────────────────
// 16-bit PCM mono WAV. The tone length is taken from the request (?dur=) so a
// tapped song plays for its REAL duration (progress bar/seek behave like a real
// track) instead of a jarring 6-second blip.
const WAV_SAMPLE_RATE = 16000;
const WAV_MAX_SEC = 360;
let wavCache = { key: null, buf: null };
export function previewAudioWav(durArg) {
  const dur = Math.min(Math.max(Number(durArg) || 30, 5), WAV_MAX_SEC);
  const key = String(dur);
  if (wavCache.key === key && wavCache.buf) return wavCache.buf;
  const sr = WAV_SAMPLE_RATE;
  const n = Math.floor(sr * dur);
  const data = new Int16Array(n);
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
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sr, 24);
  header.writeUInt32LE(sr * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(n * 2, 40);
  const buf = Buffer.concat([header, Buffer.from(data.buffer)]);
  wavCache = { key, buf };
  return buf;
}
