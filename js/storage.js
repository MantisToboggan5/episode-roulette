const SHOWS_KEY = "er_shows";
const WATCHED_KEY = "er_watched";
const BIAS_KEY = "er_bias";

function getShows() {
  return JSON.parse(localStorage.getItem(SHOWS_KEY) || "[]");
}

function saveShows(shows) {
  localStorage.setItem(SHOWS_KEY, JSON.stringify(shows));
}

function addShow(show) {
  const shows = getShows();
  if (shows.some((s) => s.id === show.id)) return;
  shows.push(show);
  saveShows(shows);
}

function removeShow(showId) {
  saveShows(getShows().filter((s) => s.id !== showId));
  const watched = getWatchedMap();
  delete watched[showId];
  saveWatchedMap(watched);
}

function getWatchedMap() {
  return JSON.parse(localStorage.getItem(WATCHED_KEY) || "{}");
}

function saveWatchedMap(map) {
  localStorage.setItem(WATCHED_KEY, JSON.stringify(map));
}

function episodeKey(seasonNumber, episodeNumber) {
  return `${seasonNumber}:${episodeNumber}`;
}

function getWatchedForShow(showId) {
  return getWatchedMap()[showId] || [];
}

function markWatched(showId, seasonNumber, episodeNumber) {
  const map = getWatchedMap();
  const key = episodeKey(seasonNumber, episodeNumber);
  map[showId] = map[showId] || [];
  if (!map[showId].includes(key)) map[showId].push(key);
  saveWatchedMap(map);
}

function resetWatched(showId) {
  const map = getWatchedMap();
  delete map[showId];
  saveWatchedMap(map);
}

function getBias() {
  const stored = localStorage.getItem(BIAS_KEY);
  return stored === null ? 0 : Number(stored);
}

function setBias(value) {
  localStorage.setItem(BIAS_KEY, String(value));
}
