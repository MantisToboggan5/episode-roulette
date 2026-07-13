#!/usr/bin/env python3
"""Ingest a TV show's episodes + IMDb ratings into data/shows/<tconst>.json.

Usage:
    python ingest.py "Breaking Bad"
    python ingest.py tt0903747     # IMDb series id directly

Runs entirely off IMDb's official non-commercial datasets
(datasets.imdbws.com) — no API keys or accounts needed. The first run
downloads three dataset files (~250MB total) and builds a local SQLite
index at data/imdb_cache/episodes.db, refreshed every 30 days. Ingests
after that take seconds.
"""
import argparse
import gzip
import json
import os
import shutil
import sqlite3
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
IMDB_CACHE_DIR = os.path.join(ROOT, "data", "imdb_cache")
SHOWS_DIR = os.path.join(ROOT, "data", "shows")
INDEX_PATH = os.path.join(SHOWS_DIR, "index.json")
DB_PATH = os.path.join(IMDB_CACHE_DIR, "episodes.db")

IMDB_BASICS_URL = "https://datasets.imdbws.com/title.basics.tsv.gz"
IMDB_EPISODE_URL = "https://datasets.imdbws.com/title.episode.tsv.gz"
IMDB_RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz"
DB_MAX_AGE_DAYS = 30
USER_AGENT = "episode-roulette-ingest/1.0"
SERIES_TYPES = {"tvSeries", "tvMiniSeries"}


def download(url, dest):
    print(f"Downloading {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req) as res, open(dest, "wb") as out:
        shutil.copyfileobj(res, out)


def ensure_db():
    os.makedirs(IMDB_CACHE_DIR, exist_ok=True)
    if os.path.exists(DB_PATH):
        age_days = (time.time() - os.path.getmtime(DB_PATH)) / 86400
        if age_days < DB_MAX_AGE_DAYS:
            return

    basics_gz = os.path.join(IMDB_CACHE_DIR, "title.basics.tsv.gz")
    episode_gz = os.path.join(IMDB_CACHE_DIR, "title.episode.tsv.gz")
    ratings_gz = os.path.join(IMDB_CACHE_DIR, "title.ratings.tsv.gz")
    download(IMDB_RATINGS_URL, ratings_gz)
    download(IMDB_EPISODE_URL, episode_gz)
    download(IMDB_BASICS_URL, basics_gz)

    print("Building local index (one-time, a few minutes)...")

    print("  1/3 ratings...")
    ratings = {}
    with gzip.open(ratings_gz, "rt", encoding="utf-8") as f:
        next(f)
        for line in f:
            tconst, avg, votes = line.rstrip("\n").split("\t")
            ratings[tconst] = (float(avg), int(votes))

    print("  2/3 episode structure...")
    # tconst -> [parent, season, episode, rating, votes, title, year]
    episodes = {}
    with gzip.open(episode_gz, "rt", encoding="utf-8") as f:
        next(f)
        for line in f:
            tconst, parent, season, episode = line.rstrip("\n").split("\t")
            if season == "\\N" or episode == "\\N":
                continue
            rating = ratings.get(tconst)
            if not rating:
                continue
            episodes[tconst] = [parent, int(season), int(episode), rating[0], rating[1], None, None]

    print("  3/3 titles...")
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE series (tconst TEXT PRIMARY KEY, title TEXT, start_year INTEGER, votes INTEGER)"
    )
    conn.execute(
        "CREATE TABLE episode_ratings ("
        "parent_tconst TEXT, tconst TEXT, season_number INTEGER, episode_number INTEGER, "
        "title TEXT, year INTEGER, rating REAL, votes INTEGER)"
    )
    series_rows = []
    with gzip.open(basics_gz, "rt", encoding="utf-8") as f:
        next(f)
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 6:
                continue
            tconst, title_type, primary_title, _original, _adult, start_year = parts[:6]
            if title_type in SERIES_TYPES:
                votes = ratings.get(tconst, (None, 0))[1]
                year = None if start_year == "\\N" else int(start_year)
                series_rows.append((tconst, primary_title, year, votes))
                if len(series_rows) >= 5000:
                    conn.executemany("INSERT INTO series VALUES (?,?,?,?)", series_rows)
                    series_rows = []
            elif title_type == "tvEpisode":
                ep = episodes.get(tconst)
                if ep:
                    ep[5] = primary_title
                    ep[6] = None if start_year == "\\N" else int(start_year)
    if series_rows:
        conn.executemany("INSERT INTO series VALUES (?,?,?,?)", series_rows)

    ep_rows = [
        (ep[0], tconst, ep[1], ep[2], ep[5], ep[6], ep[3], ep[4])
        for tconst, ep in episodes.items()
    ]
    for i in range(0, len(ep_rows), 5000):
        conn.executemany("INSERT INTO episode_ratings VALUES (?,?,?,?,?,?,?,?)", ep_rows[i:i + 5000])

    conn.execute("CREATE INDEX idx_parent ON episode_ratings(parent_tconst)")
    conn.execute("CREATE INDEX idx_series_title ON series(title COLLATE NOCASE)")
    conn.commit()
    conn.close()
    print(f"Index built at {DB_PATH}")


def resolve_show(query, conn):
    if query.startswith("tt") and query[2:].isdigit():
        row = conn.execute(
            "SELECT tconst, title, start_year FROM series WHERE tconst = ?", (query,)
        ).fetchone()
        if not row:
            sys.exit(f"No series found for id {query}")
        return row
    rows = conn.execute(
        "SELECT tconst, title, start_year FROM series WHERE title LIKE ? ORDER BY votes DESC LIMIT 5",
        (query,),
    ).fetchall()
    if not rows:
        rows = conn.execute(
            "SELECT tconst, title, start_year FROM series WHERE title LIKE ? ORDER BY votes DESC LIMIT 5",
            (f"%{query}%",),
        ).fetchall()
    if not rows:
        sys.exit(f"No series found matching '{query}'")
    best = rows[0]
    print(f"Matched: {best[1]} ({best[2] or '?'}) — {best[0]}")
    if len(rows) > 1:
        others = ", ".join(f"{r[1]} ({r[2] or '?'}, {r[0]})" for r in rows[1:])
        print(f"  Other matches: {others}")
    return best


def update_index(tconst, name):
    index = []
    if os.path.exists(INDEX_PATH):
        with open(INDEX_PATH, "r", encoding="utf-8") as f:
            index = json.load(f)
    index = [s for s in index if s["id"] != tconst]
    index.append({"id": tconst, "name": name, "poster_path": None, "imdb_id": tconst})
    index.sort(key=lambda s: s["name"].lower())
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2)


def ingest(query):
    ensure_db()
    conn = sqlite3.connect(DB_PATH)
    tconst, name, _year = resolve_show(query, conn)

    rows = conn.execute(
        "SELECT season_number, episode_number, title, year, rating, votes "
        "FROM episode_ratings WHERE parent_tconst = ? ORDER BY season_number, episode_number",
        (tconst,),
    ).fetchall()
    conn.close()
    if not rows:
        sys.exit(f"No rated episodes found for {name} ({tconst})")

    episodes = [
        {
            "season_number": season,
            "episode_number": episode,
            "name": title,
            "overview": None,
            "air_date": str(year) if year else None,
            "still_path": None,
            "imdb_rating": rating,
            "imdb_votes": votes,
        }
        for season, episode, title, year, rating, votes in rows
    ]

    os.makedirs(SHOWS_DIR, exist_ok=True)
    show_record = {
        "id": tconst,
        "name": name,
        "poster_path": None,
        "imdb_id": tconst,
        "episodes": episodes,
    }
    with open(os.path.join(SHOWS_DIR, f"{tconst}.json"), "w", encoding="utf-8") as f:
        json.dump(show_record, f, indent=2)

    update_index(tconst, name)
    print(f"Wrote data/shows/{tconst}.json — {len(episodes)} rated episodes.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("show", help="Show name to search for, or an IMDb series id (tt...)")
    args = parser.parse_args()
    ingest(args.show)


if __name__ == "__main__":
    main()
