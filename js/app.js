const els = {
  views: {
    search: document.getElementById("view-search"),
    shows: document.getElementById("view-shows"),
    result: document.getElementById("view-result"),
  },
  tabBtns: document.querySelectorAll(".tab-btn"),
  searchInput: document.getElementById("search-input"),
  searchResults: document.getElementById("search-results"),
  searchEmpty: document.getElementById("search-empty"),
  showsList: document.getElementById("shows-list"),
  showsEmpty: document.getElementById("shows-empty"),
  surpriseBtn: document.getElementById("surprise-btn"),
  spinIndicator: document.getElementById("spin-indicator"),
  resultContent: document.getElementById("result-content"),
  resultCaughtUp: document.getElementById("result-caught-up"),
  caughtUpMessage: document.getElementById("caught-up-message"),
  resultActions: document.getElementById("result-actions"),
  resultStill: document.getElementById("result-still"),
  resultShowName: document.getElementById("result-show-name"),
  resultEpisodeTitle: document.getElementById("result-episode-title"),
  resultEpisodeMeta: document.getElementById("result-episode-meta"),
  resultOverview: document.getElementById("result-overview"),
  markWatchedBtn: document.getElementById("mark-watched-btn"),
  rerollBtn: document.getElementById("reroll-btn"),
  backBtn: document.getElementById("back-btn"),
  resetWatchedBtn: document.getElementById("reset-watched-btn"),
};

const episodeCache = {}; // showId -> aired episodes array
let activeResult = null; // { show, episode }
let activeSpinScope = null; // { type: "show", showId } | { type: "all" }

function showView(name) {
  for (const [key, el] of Object.entries(els.views)) {
    el.classList.toggle("hidden", key !== name);
  }
  els.tabBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
}

els.tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    showView(btn.dataset.view);
    if (btn.dataset.view === "shows") renderShowsList();
  });
});

// ---------- Search ----------

let searchDebounce = null;
els.searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  const query = els.searchInput.value;
  searchDebounce = setTimeout(() => runSearch(query), 350);
});

async function runSearch(query) {
  if (!query.trim()) {
    els.searchResults.innerHTML = "";
    els.searchEmpty.classList.remove("hidden");
    return;
  }
  let results;
  try {
    results = await searchShows(query);
  } catch (err) {
    els.searchResults.innerHTML = `<li class="empty-hint">Search failed: ${err.message}</li>`;
    return;
  }
  els.searchEmpty.classList.add("hidden");
  const savedIds = new Set(getShows().map((s) => s.id));
  els.searchResults.innerHTML = "";
  for (const show of results) {
    if (!show.name) continue;
    const li = document.createElement("li");
    li.className = "show-card";
    const year = (show.first_air_date || "").slice(0, 4);
    li.innerHTML = `
      <img src="${posterUrl(show.poster_path) || ""}" alt="" onerror="this.style.visibility='hidden'" />
      <div class="show-info">
        <div class="name">${escapeHtml(show.name)}</div>
        <div class="year">${year}</div>
      </div>
      <button class="${savedIds.has(show.id) ? "added" : ""}">${savedIds.has(show.id) ? "Added" : "Add"}</button>
    `;
    const btn = li.querySelector("button");
    btn.addEventListener("click", () => {
      if (savedIds.has(show.id)) return;
      addShow({
        id: show.id,
        name: show.name,
        poster_path: show.poster_path || null,
      });
      savedIds.add(show.id);
      btn.textContent = "Added";
      btn.classList.add("added");
    });
    els.searchResults.appendChild(li);
  }
}

// ---------- My Shows ----------

function renderShowsList() {
  const shows = getShows();
  els.showsEmpty.classList.toggle("hidden", shows.length > 0);
  els.surpriseBtn.classList.toggle("hidden", shows.length === 0);
  els.showsList.innerHTML = "";
  for (const show of shows) {
    const li = document.createElement("li");
    li.className = "show-card";
    li.innerHTML = `
      <img src="${posterUrl(show.poster_path) || ""}" alt="" onerror="this.style.visibility='hidden'" />
      <div class="show-info">
        <div class="name">${escapeHtml(show.name)}</div>
      </div>
      <div class="show-btns">
        <button class="spin-btn">🎲 Spin</button>
        <button class="remove">✕</button>
      </div>
    `;
    li.querySelector(".spin-btn").addEventListener("click", () => {
      startSpin({ type: "show", showId: show.id });
    });
    li.querySelector(".remove").addEventListener("click", () => {
      removeShow(show.id);
      delete episodeCache[show.id];
      renderShowsList();
    });
    els.showsList.appendChild(li);
  }
}

els.surpriseBtn.addEventListener("click", () => startSpin({ type: "all" }));

// ---------- Spin logic ----------

async function getAiredEpisodes(showId) {
  if (episodeCache[showId]) return episodeCache[showId];
  const details = await getShowDetails(showId);
  const seasons = (details.seasons || []).filter((s) => s.season_number > 0);
  const today = new Date().toISOString().slice(0, 10);
  const all = [];
  for (const season of seasons) {
    const episodes = await getSeasonEpisodes(showId, season.season_number);
    for (const ep of episodes) {
      if (ep.air_date && ep.air_date <= today) all.push(ep);
    }
  }
  episodeCache[showId] = all;
  return all;
}

function pickUnwatched(showId, episodes) {
  const watched = new Set(getWatchedForShow(showId));
  const unwatched = episodes.filter(
    (ep) => !watched.has(episodeKey(ep.season_number, ep.episode_number))
  );
  if (unwatched.length === 0) return null;
  return unwatched[Math.floor(Math.random() * unwatched.length)];
}

async function startSpin(scope) {
  activeSpinScope = scope;
  showView("result");
  els.resultContent.classList.add("hidden");
  els.resultCaughtUp.classList.add("hidden");
  els.resultActions.classList.add("hidden");
  els.spinIndicator.classList.remove("hidden");

  try {
    if (scope.type === "show") {
      const shows = getShows();
      const show = shows.find((s) => s.id === scope.showId);
      const episodes = await getAiredEpisodes(scope.showId);
      const pick = pickUnwatched(scope.showId, episodes);
      await revealResult(show, pick, episodes.length === 0);
    } else {
      const shows = getShows();
      const shuffled = [...shows].sort(() => Math.random() - 0.5);
      let show = null;
      let pick = null;
      for (const candidate of shuffled) {
        const episodes = await getAiredEpisodes(candidate.id);
        const candidatePick = pickUnwatched(candidate.id, episodes);
        if (candidatePick) {
          show = candidate;
          pick = candidatePick;
          break;
        }
      }
      await revealResult(show, pick, false);
    }
  } catch (err) {
    els.spinIndicator.classList.add("hidden");
    els.resultCaughtUp.classList.remove("hidden");
    els.caughtUpMessage.textContent = `Something went wrong: ${err.message}`;
    els.resetWatchedBtn.classList.add("hidden");
  }
}

async function revealResult(show, episode, showHasNoEpisodes) {
  await new Promise((r) => setTimeout(r, 650)); // slot-machine pause
  els.spinIndicator.classList.add("hidden");

  if (!show || !episode) {
    els.resultCaughtUp.classList.remove("hidden");
    els.resetWatchedBtn.classList.remove("hidden");
    els.caughtUpMessage.textContent = showHasNoEpisodes
      ? "No aired episodes found for this show yet."
      : show
      ? `You've watched every episode of ${show.name}! 🎉`
      : "You're all caught up on every saved show! 🎉";
    return;
  }

  activeResult = { show, episode };
  els.resultShowName.textContent = show.name;
  els.resultEpisodeTitle.textContent = episode.name || "Untitled episode";
  els.resultEpisodeMeta.textContent = `S${episode.season_number}E${episode.episode_number} · ${episode.air_date || "unknown air date"}`;
  els.resultOverview.textContent = episode.overview || "No synopsis available.";
  const still = stillUrl(episode.still_path);
  els.resultStill.src = still || posterUrl(show.poster_path) || "";
  els.resultStill.style.visibility = still || show.poster_path ? "visible" : "hidden";

  els.resultContent.classList.remove("hidden");
  els.resultActions.classList.remove("hidden");
}

els.markWatchedBtn.addEventListener("click", () => {
  if (!activeResult) return;
  const { show, episode } = activeResult;
  markWatched(show.id, episode.season_number, episode.episode_number);
  startSpin(activeSpinScope);
});

els.rerollBtn.addEventListener("click", () => {
  if (activeSpinScope) startSpin(activeSpinScope);
});

els.backBtn.addEventListener("click", () => {
  showView("shows");
  renderShowsList();
});

els.resetWatchedBtn.addEventListener("click", () => {
  if (activeSpinScope?.type === "show") {
    resetWatched(activeSpinScope.showId);
  } else {
    getShows().forEach((s) => resetWatched(s.id));
  }
  startSpin(activeSpinScope);
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

renderShowsList();
