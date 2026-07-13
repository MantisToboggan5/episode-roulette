#!/usr/bin/env python3
"""Ingest a TV show's episodes + IMDb ratings into data/shows/<id>.json.

Usage:
    python ingest.py "Breaking Bad"
    python ingest.py 1396          # TMDB show id directly

Requires a TMDB API key in js/config.js (see README). Downloads IMDb's
official non-commercial datasets (datasets.imdbws.com) once and caches a
local SQLite ratings index at data/imdb_cache/episodes.db, refreshed
every 30 days.
"""
import argparse
import gzip
import json
import os
import shutil
import sqlite3
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
CONFIG_JS = os.path.join(ROOT, "js", "config.js")
IMDB_CACHE_DIR = os.path.join(ROOT, "data", "imdb_cache")
SHOWS_DIR = os.path.join(ROOT, "data", "shows")
INDEX_PATH = os.path.join(SHOWS_DIR, "index.json")
DB_PATH = os.path.join(IMDB_CACHE_DIR, "episodes.db")

TMDB_BASE = "https://api.themoviedb.org/3"
IMDB_EPISODE_URL = "https://datasets.imdbws.com/title.episode.tsv.gz"
IMDB_RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz"
DB_MAX_AGE_DAYS = 30
USER_AGENT = "episode-roulette-ingest/1.0"


def load_api_key():
    if not os.path.exists(CONFIG_JS):
        sys.exit("js/config.js not found. Copy js/config.example.js to js/config.js and add your TMDB key.")
    with open(CONFIG_JS, "r", encoding="utf-8") as f:
        content = f.read()
    import re
    match = re.search(r'TMDB_API_KEY\s*=\s*"([^"]*)"', content)
    if not match or not match.group(1):
        sys.exit("No TMDB_API_KEY set in js/config.js. See README for setup.")
    return match.group(1)


def tmdb_get(path, api_key, params=None):
    params = dict(params or {})
    params["api_key"] = api_key
    url = f"{TMDB_BASE}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read().decode("utf-8"))


def download(url, dest):
    print(f"Downloading {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req) as res, open(dest, "wb") as out:
        shutil.copyfileobj(res, out)


def ensure_ratings_db():
    os.makedirs(IMDB_CACHE_DIR, exist_ok=True)
    if os.path.exists(DB_PATH):
        age_days = (time.time() - os.path.getmtime(DB_PATH)) / 86400
        if age_days < DB_MAX_AGE_DAYS:
            return

    episode_gz = os.path.join(IMDB_CACHE_DIR, "title.episode.tsv.gz")
    ratings_gz = os.path.join(IMDB_CACHE_DIR, "title.ratings.tsv.gz")
    download(IMDB_RATINGS_URL, ratings_gz)
    download(IMDB_EPISODE_URL, episode_gz)

    print("Building local ratings index (one-time, ~a minute)...")
    ratings = {}
    with gzip.open(ratings_gz, "rt", encoding="utf-8") as f:
        next(f)
        for line in f:
            tconst, avg, votes = line.rstrip("\n").split("\t")
            ratings[tconst] = (float(avg), int(votes))

    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE episode_ratings ("
        "parent_tconst TEXT, tconst TEXT, season_number INTEGER, "
        "episode_number INTEGER, rating REAL, votes INTEGER)"
    )
    rows = []
    with gzip.open(episode_gz, "rt", encoding="utf-8") as f:
        next(f)
        for line in f:
            tconst, parent, season, episode = line.rstrip("\n").split("\t")
            if season == "\\N" or episode == "\\N":
                continue
            rating = ratings.get(tconst)
            if not rating:
                continue
            rows.append((parent, tconst, int(season), int(episode), rating[0], rating[1]))
            if len(rows) >= 5000:
                conn.executemany("INSERT INTO episode_ratings VALUES (?,?,?,?,?,?)", rows)
                rows = []
    if rows:
        conn.executemany("INSERT INTO episode_ratings VALUES (?,?,?,?,?,?)", rows)
    conn.execute("CREATE INDEX idx_parent ON episode_ratings(parent_tconst)")
    conn.commit()
    conn.close()
    print(f"Ratings index built at {DB_PATH}")


def get_ratings_for_show(imdb_id):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute(
        "SELECT season_number, episode_number, rating, votes FROM episode_ratings WHERE parent_tconst = ?",
        (imdb_id,),
    )
    result = {(s, e): (r, v) for s, e, r, v in cur.fetchall()}
    conn.close()
    return result


def resolve_show(query, api_key):
    if query.isdigit():
        return int(query)
    results = tmdb_get("/search/tv", api_key, {"query": query}).get("results", [])
    if not results:
        sys.exit(f"No TMDB results for '{query}'")
    show = results[0]
    year = (show.get("first_air_date") or "")[:4]
    print(f"Matched: {show['name']} ({year}) — TMDB id {show['id']}")
    return show["id"]


def update_index(show_id, name, poster_path, imdb_id):
    index = []
    if os.path.exists(INDEX_PATH):
        with open(INDEX_PATH, "r", encoding="utf-8") as f:
            index = json.load(f)
    index = [s for s in index if s["id"] != show_id]
    index.append({"id": show_id, "name": name, "poster_path": poster_path, "imdb_id": imdb_id})
    index.sort(key=lambda s: s["name"].lower())
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2)


def ingest(query, api_key):
    show_id = resolve_show(query, api_key)
    details = tmdb_get(f"/tv/{show_id}", api_key)
    external = tmdb_get(f"/tv/{show_id}/external_ids", api_key)
    imdb_id = external.get("imdb_id")

    ensure_ratings_db()
    ratings = get_ratings_for_show(imdb_id) if imdb_id else {}
    if imdb_id and not ratings:
        print(f"Warning: no IMDb ratings found for {imdb_id} — episodes will be unrated.")

    episodes = []
    seasons = [s for s in details.get("seasons", []) if s["season_number"] > 0]
    for season in seasons:
        season_data = tmdb_get(f"/tv/{show_id}/season/{season['season_number']}", api_key)
        for ep in season_data.get("episodes", []):
            key = (ep["season_number"], ep["episode_number"])
            rating, votes = ratings.get(key, (None, None))
            episodes.append({
                "season_number": ep["season_number"],
                "episode_number": ep["episode_number"],
                "name": ep.get("name"),
                "overview": ep.get("overview"),
                "air_date": ep.get("air_date"),
                "still_path": ep.get("still_path"),
                "imdb_rating": rating,
                "imdb_votes": votes,
            })

    os.makedirs(SHOWS_DIR, exist_ok=True)
    show_record = {
        "id": show_id,
        "name": details["name"],
        "poster_path": details.get("poster_path"),
        "imdb_id": imdb_id,
        "episodes": episodes,
    }
    with open(os.path.join(SHOWS_DIR, f"{show_id}.json"), "w", encoding="utf-8") as f:
        json.dump(show_record, f, indent=2)

    update_index(show_id, details["name"], details.get("poster_path"), imdb_id)
    rated_count = sum(1 for e in episodes if e["imdb_rating"] is not None)
    print(f"Wrote data/shows/{show_id}.json — {len(episodes)} episodes, {rated_count} with IMDb ratings.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("show", help="Show name to search TMDB for, or a TMDB show id")
    args = parser.parse_args()
    api_key = load_api_key()
    ingest(args.show, api_key)


if __name__ == "__main__":
    main()
