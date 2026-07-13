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
  biasControl: document.getElementById("bias-control"),
  biasSlider: document.getElementById("bias-slider"),
  biasLabel: document.getElementById("bias-label"),
  spinIndicator: document.getElementById("spin-indicator"),
  resultContent: document.getElementById("result-content"),
  resultCaughtUp: document.getElementById("result-caught-up"),
  caughtUpMessage: document.getElementById("caught-up-message"),
  resultActions: document.getElementById("result-actions"),
  resultStill: document.getElementById("result-still"),
  resultShowName: document.getElementById("result-show-name"),
  resultEpisodeTitle: document.getElementById("result-episode-title"),
  resultEpisodeMeta: document.getElementById("result-episode-meta"),
  resultRating: document.getElementById("result-rating"),
  resultOverview: document.getElementById("result-overview"),
  markWatchedBtn: document.getElementById("mark-watched-btn"),
  rerollBtn: document.getElementById("reroll-btn"),
  backBtn: document.getElementById("back-btn"),
  resetWatchedBtn: document.getElementById("reset-watched-btn"),
};

const BIAS_LABELS = ["True Random", "Slight Favorite", "Favor Higher Rated", "Strongly Favor", "Heavily Favor", "Top Rated Only"];

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

// ---------- Bias slider ----------

function renderBiasLabel() {
  const value = Number(els.biasSlider.value);
  els.biasLabel.textContent = BIAS_LABELS[value] || BIAS_LABELS[0];
}

els.biasSlider.value = getBias();
renderBiasLabel();
els.biasSlider.addEventListener("input", () => {
  setBias(Number(els.biasSlider.value));
  renderBiasLabel();
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
  let catalogIndex;
  try {
    [results, catalogIndex] = await Promise.all([searchShows(query), loadCatalogIndex()]);
  } catch (err) {
    els.searchResults.innerHTML = `<li class="empty-hint">Search failed: ${err.message}</li>`;
    return;
  }
  els.searchEmpty.classList.add("hidden");
  const ingestedIds = new Set(catalogIndex.map((s) => s.id));
  const savedIds = new Set(getShows().map((s) => s.id));
  els.searchResults.innerHTML = "";
  for (const show of results) {
    if (!show.name) continue;
    const li = document.createElement("li");
    li.className = "show-card-wrap";
    const year = (show.first_air_date || "").slice(0, 4);
    const ingested = ingestedIds.has(show.id);
    const added = savedIds.has(show.id);
    let btnLabel = "Add";
    let btnClass = "";
    if (!ingested) {
      btnLabel = "Ingest first";
      btnClass = "remove";
    } else if (added) {
      btnLabel = "Added";
      btnClass = "added";
    }
    li.innerHTML = `
      <div class="show-card">
        <img src="${posterUrl(show.poster_path) || ""}" alt="" onerror="this.style.visibility='hidden'" />
        <div class="show-info">
          <div class="name">${escapeHtml(show.name)}</div>
          <div class="year">${year}</div>
        </div>
        <button class="${btnClass}">${btnLabel}</button>
      </div>
      <p class="ingest-hint hidden">python ingest.py ${show.id}</p>
    `;
    const btn = li.querySelector("button");
    const hint = li.querySelector(".ingest-hint");
    btn.addEventListener("click", () => {
      if (!ingested) {
        hint.classList.toggle("hidden");
        return;
      }
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
  els.biasControl.classList.toggle("hidden", shows.length === 0);
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
      renderShowsList();
    });
    els.showsList.appendChild(li);
  }
}

els.surpriseBtn.addEventListener("click", () => startSpin({ type: "all" }));

// ---------- Spin logic ----------

const today = () => new Date().toISOString().slice(0, 10);

async function getAiredEpisodes(showId) {
  const data = await loadShowData(showId);
  const cutoff = today();
  return data.episodes.filter((ep) => ep.air_date && ep.air_date <= cutoff);
}

function showAverageRating(episodes) {
  const rated = episodes.filter((ep) => ep.imdb_rating != null);
  if (rated.length === 0) return 7; // neutral fallback when nothing is rated
  return rated.reduce((sum, ep) => sum + ep.imdb_rating, 0) / rated.length;
}

function pickWeighted(showId, episodes) {
  const watched = new Set(getWatchedForShow(showId));
  const unwatched = episodes.filter(
    (ep) => !watched.has(episodeKey(ep.season_number, ep.episode_number))
  );
  if (unwatched.length === 0) return null;

  const bias = getBias();
  if (bias === 0) {
    return unwatched[Math.floor(Math.random() * unwatched.length)];
  }

  const avg = showAverageRating(episodes);
  const weights = unwatched.map((ep) => {
    const rating = ep.imdb_rating != null ? ep.imdb_rating : avg;
    return Math.pow(Math.max(rating, 0.1), bias);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < unwatched.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return unwatched[i];
  }
  return unwatched[unwatched.length - 1];
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
      const pick = pickWeighted(scope.showId, episodes);
      await revealResult(show, pick, episodes.length === 0);
    } else {
      const shows = getShows();
      const shuffled = [...shows].sort(() => Math.random() - 0.5);
      let show = null;
      let pick = null;
      for (const candidate of shuffled) {
        let episodes;
        try {
          episodes = await getAiredEpisodes(candidate.id);
        } catch {
          continue; // show removed from catalog since it was saved
        }
        const candidatePick = pickWeighted(candidate.id, episodes);
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
  if (episode.imdb_rating != null) {
    els.resultRating.textContent = `★ ${episode.imdb_rating.toFixed(1)} IMDb (${episode.imdb_votes.toLocaleString()} votes)`;
    els.resultRating.classList.remove("hidden");
  } else {
    els.resultRating.classList.add("hidden");
  }
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
