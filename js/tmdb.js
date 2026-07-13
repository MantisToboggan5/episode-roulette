const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG_BASE = "https://image.tmdb.org/t/p";

async function tmdbGet(path, params = {}) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("api_key", TMDB_API_KEY);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TMDB request failed (${res.status}): ${path}`);
  }
  return res.json();
}

async function searchShows(query) {
  if (!query.trim()) return [];
  const data = await tmdbGet("/search/tv", { query, include_adult: false });
  return data.results || [];
}

async function getShowDetails(showId) {
  return tmdbGet(`/tv/${showId}`);
}

async function getSeasonEpisodes(showId, seasonNumber) {
  const data = await tmdbGet(`/tv/${showId}/season/${seasonNumber}`);
  return data.episodes || [];
}

function posterUrl(path, size = "w342") {
  return path ? `${TMDB_IMG_BASE}/${size}${path}` : null;
}

function stillUrl(path, size = "w500") {
  return path ? `${TMDB_IMG_BASE}/${size}${path}` : null;
}
