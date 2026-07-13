# Episode Roulette

Mobile-first PWA: ingest the TV shows you're watching (with real IMDb per-episode
ratings), and hit Spin to get a randomly picked (unwatched) episode — optionally
biased toward higher-rated episodes.

Runs entirely off IMDb's official free datasets — **no accounts or API keys needed**.

## Setup

1. Run a local server from this folder:
   ```
   python -m http.server 8000
   ```
2. Open http://localhost:8000 in a browser (use a phone-sized viewport / real phone
   to see the intended layout). On a phone you can "Add to Home Screen" to install it.

The service worker is network-first: when online you always get the latest app and
show data; the cache only kicks in offline. A plain refresh picks up any update.

## Adding a show (ingest)

The app spins from shows you've ingested. From the project folder:

```
python ingest.py "Breaking Bad"
python ingest.py tt0903747     # or an IMDb series id directly
```

Name search picks the most-voted matching series and prints what it matched (plus
runners-up with their tt-ids, in case it picked the wrong one). Output goes to
`data/shows/<tt-id>.json` plus `data/shows/index.json`.

The first run downloads IMDb's public datasets (datasets.imdbws.com) into
`data/imdb_cache/` — about 250MB total — and builds a local SQLite index. That's
one-time (auto-refreshed every 30 days); every ingest after it takes seconds.

## Spin bias

The My Shows tab has a "Spin bias" slider, 0–5. At 0 every unwatched episode has an
equal chance (true random). Higher values weight the random pick toward episodes
rated above the show's own average (weight = e^(bias × (rating − showAvg))), without
ever fully excluding lower-rated ones. Anchoring to the show's average keeps the
skew meaningful even for shows where every episode rates 8+.

## Notes

- IMDb's datasets only include episodes that have ratings, so unrated (usually very
  new or very obscure) episodes won't appear.
- No poster art or episode synopses in IMDb-only mode — supplementing with TMDB
  imagery/synopses (free API key) is a planned later addition; `js/config.example.js`
  is kept around for that.
- Saved shows, watched episodes, and the bias setting live in the browser's
  localStorage — the app makes no network calls at all beyond loading its own files.
- `data/shows/*.json` is the app's actual episode+rating dataset and is committed to
  the repo. `data/imdb_cache/` (the raw IMDb dataset download + SQLite index) is
  gitignored — regenerate it any time by deleting the folder and re-running
  `ingest.py`.
