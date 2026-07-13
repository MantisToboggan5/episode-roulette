# Episode Roulette

Mobile-first PWA: search for TV shows, ingest the ones you're watching (pulls in
real IMDb per-episode ratings), and hit Spin to get a randomly picked (unwatched)
episode — optionally biased toward higher-rated episodes.

## Setup

1. Get a free TMDB API key:
   - Create an account at https://www.themoviedb.org/signup
   - Go to https://www.themoviedb.org/settings/api and request a key (choose "Developer")
   - Copy the **API Key (v3 auth)** value
2. Copy `js/config.example.js` to `js/config.js` and paste your key in:
   ```js
   const TMDB_API_KEY = "your key here";
   ```
   `js/config.js` is gitignored so your key never gets committed. `ingest.py`
   (see below) reads the same key from this file.
3. Run a local server from this folder:
   ```
   python -m http.server 8000
   ```
4. Open http://localhost:8000 in a browser (use a phone-sized viewport / real phone
   to see the intended layout). On a phone you can "Add to Home Screen" to install it.

**Dev tip:** the service worker caches app files aggressively (that's the point, for
offline/installed use). If you edit HTML/CSS/JS and don't see the change, unregister
it once (DevTools → Application → Service Workers → Unregister, then hard reload).

## Adding a show (ingest)

Search only *discovers* shows — spinning requires a show to be ingested first, since
that's what pulls in the actual episode list and IMDb ratings. From the project folder:

```
python ingest.py "Breaking Bad"
python ingest.py 1396          # or a TMDB show id directly
```

This fetches the show's episodes from TMDB and joins in real IMDb ratings, writing
`data/shows/<id>.json` plus updating `data/shows/index.json`. The first run also
downloads IMDb's public ratings datasets (datasets.imdbws.com) into
`data/imdb_cache/` and builds a local SQLite index — a one-time, several-tens-of-MB
download, refreshed automatically every 30 days. Every ingest after that is fast.

Once ingested, the show shows up as "Add" (instead of "Ingest first") in the app's
Search tab.

## Spin bias

The My Shows tab has a "Spin bias" slider, 0–5. At 0 every unwatched episode has an
equal chance (true random). Higher values weight the random pick toward
higher-IMDb-rated episodes (weight = rating^bias), without ever fully excluding
lower-rated ones. Episodes IMDb doesn't have a rating for use the show's average
rating so they're neither favored nor penalized.

## Notes

- Saved shows, watched episodes, and the bias setting live in the browser's
  localStorage — nothing leaves the device except TMDB search calls and TMDB's
  (keyless) image CDN.
- `data/shows/*.json` is the app's actual episode+rating dataset and is committed to
  the repo. `data/imdb_cache/` (the raw IMDb dataset download + SQLite index) is
  gitignored — regenerate it any time by deleting the folder and re-running
  `ingest.py`.
- The TMDB key is used directly from the browser for search, which is fine for
  personal/prototype use. If this ever needs to scale up publicly, add a small
  server-side proxy in front of TMDB to hide the key and cache responses.
