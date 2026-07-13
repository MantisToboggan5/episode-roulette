const showDataCache = {};

async function loadCatalogIndex() {
  const res = await fetch("data/shows/index.json", { cache: "no-store" });
  return res.ok ? res.json() : [];
}

async function loadShowData(showId) {
  if (showDataCache[showId]) return showDataCache[showId];
  const res = await fetch(`data/shows/${showId}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Show ${showId} hasn't been ingested yet.`);
  const data = await res.json();
  showDataCache[showId] = data;
  return data;
}
