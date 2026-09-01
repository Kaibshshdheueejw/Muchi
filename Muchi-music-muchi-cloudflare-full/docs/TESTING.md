# MUCHI Cloudflare — deployed-Worker test checklist

Run every item against the deployed Worker URL (`https://<name>.<account>
.workers.dev`). Record PASS / FAIL / PENDING per item. This sandbox could not
run these (no outbound internet) — **do not mark anything verified without a
real run**.

## A. Basics
- [ ] `GET /api/health` → `{"ok":true,"name":"Muchi","version":"1.2.1","time":…}`
- [ ] `GET /` serves the app shell (index.html); `GET /sw.js` serves the SW
- [ ] `GET /api/moods` → 12 moods for IN, 12 for US, 10 for XX
- [ ] `?debug=1` adds `x-muchi-ms`; dashboard shows CPU/invocation < 10 ms
- [ ] OPTIONS preflight → 204 with CORS headers

## B. /api/stream (the critical one — real deployed test)
- [ ] status: 200 for a live radio stream URL (`/api/stream?url=https://…`)
- [ ] content-type: audio type with params stripped
- [ ] streaming: first bytes arrive without buffering; body streams
- [ ] Range: `Range: bytes=0-1023` → 206 with 1024 bytes when upstream honors
- [ ] redirects: 301/302 upstream URLs are followed (final 200)
- [ ] headers: `Cache-Control: no-store`, `Access-Control-Allow-Origin: *`
- [ ] long-running playback: stream for 60+ minutes without error
- [ ] reconnect/disconnect: client aborts mid-stream; Worker logs no error
- [ ] CPU: dashboard shows < 10 ms for a multi-minute stream
- [ ] SSRF: `url=http://127.0.0.1/…` → 400; `url=ftp://…` → 400

## C. External APIs
- [ ] /api/radio?q=hits → non-empty tracks with streamUrl
- [ ] /api/radio/click/{id} → 200 {ok:true}
- [ ] /api/audius/stream/{trackId} → {url}; /api/audius/file/{id} streams
- [ ] /api/img?url=https://i.ytimg.com/… → 200 image, Cache-Control 86400
- [ ] /api/lyrics?title=…&artist=… → {lyrics, synced} or empty
- [ ] /api/yt/playlist?id=PL… → up to 300 tracks
- [ ] /api/search?q=… → youtube/audius/radio/apple/artists/playlists filled
- [ ] /api/home, /api/shelf, /api/discover, /api/related, /api/artist
- [ ] Repeat /api/home twice → second response served from cache (x-muchi-ms
      drops, dashboard CPU ~0)

## D. Google OAuth (the full chain — no shortcuts)
- [ ] /api/auth/status → configured:true (after secrets set)
- [ ] Open /api/auth/google/url in a browser → Google consent page
- [ ] Sign in with a REAL Google account
- [ ] Redirect back → cookie set (httpOnly), session row in D1
  (`wrangler d1 execute DB --remote --command "SELECT count(*) FROM sessions"`)
- [ ] /api/auth/status with cookie → signedIn:true, profile = real account
- [ ] Settings shows the authenticated account
- [ ] Connect YouTube → consent → /api/youtube/liked returns REAL liked
      songs; /api/youtube/playlists returns REAL playlists
- [ ] Restart/refresh: session persists (D1, not memory)
- [ ] /api/auth/signout → session row deleted, cookie cleared
- [ ] Native path: `platform=native` → `muchi://auth/success?token=…`
- [ ] Wrong/expired state → redirect to error home (no session created)

## E. D1 + sessions persistence
- [ ] Login → `wrangler d1 execute DB --remote --command "SELECT sid FROM sessions"`
- [ ] Redeploy the Worker (push a trivial change) → session STILL valid
- [ ] 30-day expiry enforced (expires_at); sweep deletes old rows

## F. Frontend on the Worker
- [ ] Open the app, play a YouTube track (client-side IFrame playback)
- [ ] Radio station plays via /api/stream proxy
- [ ] Audius track plays via /api/audius/file
- [ ] Search, Library (if signed in), Settings pages functional
