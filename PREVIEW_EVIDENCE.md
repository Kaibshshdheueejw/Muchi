# "Made for you" — 10 playlists × 20 songs, distinct moods, taste-adaptive

Verified live against the running preview stack (worker `127.0.0.1:8787` → router `0.0.0.0:8788`).

## Acceptance evidence (live `/api/home?gl=US`)

| Check | Result |
|---|---|
| Number of "Made for you" playlists | **10** (was 6) |
| Songs per playlist | **20 each** (10/10 cards) |
| Distinct moods across playlists | **10** (`pop, hiphop, rnb, rock, dance, indie, trending, chill, workout, throw`) |
| Distinct songs across **all 10** playlists | **200** |
| Cross-playlist song repeats | **0** (no playlist shares a song with another) |
| Content | Real English chart hits (Blinding Lights/As It Was/Levitating/…/Sicko Mode/…/Bohemian Rhapsody/…) |
| HTTP cache | `Cache-Control: no-store` (fresh payload every load) |

Each card carries its `mood` + `genres` + up to `20 tracks`, so the client reorders it by
taste **and** can open it fully populated.

## Taste-adaptive behaviour (client `forYouPlaylistList` + `fyTasteScore`)

Reordering is driven client-side from the listener's recent plays + likes (`tasteProfile()`),
then re-rendered via `paintHomeSoon()` on every play / like. Simulated on the live payload:

- **Fresh listener** → default order (Pop Hits first).
- **Hip-Hop-heavy listener** → `Hip-Hop` surfaces **#1** (score 34).
- **Chill-heavy listener** → `Chill Vibes` surfaces **#1** (score 24).

## Consistency

Opening a card re-fetches `/api/shelf?q=<mood>` and returns the **identical** 20 songs the card
showed (verified: 20/20 identical), so the opened playlist never drifts.

## What changed

- `src/preview-seed.js` — expanded catalog to **200** distinct English hits; new `fyMoodPools()`
  partitions them into **10 disjoint, mood-coherent sets of 20** (0 repeats); tracks now carry
  `genre` (primary mood) + `_tag` (full mood set); `playlistTracks` uses the same disjoint pool.
- `src/data.js` — `FY_QUERIES` = **10** distinct moods; `buildForYouPlaylists()` returns exactly
  10 cards carrying `mood`/`genres`/`tracks` (no `kind:"mix"`).
- `public/app.js` — `API_CACHE_V = "v2-fy10"` cache-buster (stale 6-card payloads are ignored and
  re-fetched); taste-adaptive `forYouPlaylistList()` (`fyTasteScore`) + `paintHomeSoon()` on
  play/like; card shows "20 songs".
- `public/index.html` `public/styles.css` — asset cache-bump to `?v=90`; `.fy-count` label style.

## Repro

The preview is running at the live preview URL (router on `0.0.0.0:8788`). Hard-refresh the page;
a fresh session fetches `v2-fy10:/api/home` (new cache key) → 10 cards.

> Note: the deployed site `muchi.twiarimascord.workers.dev` still runs the **old** worker. The
> source fixes above take effect there only after a redeploy; the sandbox preview already shows 10.
