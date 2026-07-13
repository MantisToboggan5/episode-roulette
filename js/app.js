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
    if (btn.dataset.view === "search") renderBrowseList(els.searchInput.value);
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
  searchDebounce = setTimeout(() => renderBrowseList(query), 250);
});

function posterPlaceholder(name) {
  const initials = name
    .split(/\s+/)
    .filter((w) => w && !/^(the|a|an|of)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
  return `<div class="poster-placeholder">${escapeHtml(initials || "?")}</div>`;
}

function posterImg(show) {
  return show.poster
    ? `<img src="${show.poster}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />`
    : posterPlaceholder(show.name);
}

async function renderBrowseList(query = "") {
  let catalogIndex;
  try {
    catalogIndex = await loadCatalogIndex();
  } catch (err) {
    els.searchResults.innerHTML = `<li class="empty-hint">Couldn't load catalog: ${err.message}</li>`;
    return;
  }
  const needle = query.trim().toLowerCase();
  const results = needle
    ? catalogIndex.filter((s) => s.name.toLowerCase().includes(needle))
    : catalogIndex;
  const savedIds = new Set(getShows().map((s) => s.id));
  els.searchResults.innerHTML = "";
  els.searchEmpty.classList.toggle("hidden", catalogIndex.length > 0);
  if (needle && results.length === 0) {
    els.searchResults.innerHTML = `
      <li class="empty-hint">No ingested show matches "${escapeHtml(query)}".<br><br>
      To add a new show, ask Claude or run:<br>
      <span class="ingest-hint">python ingest.py "${escapeHtml(query)}"</span></li>
    `;
    return;
  }
  for (const show of results) {
    const li = document.createElement("li");
    li.className = "show-card";
    const added = savedIds.has(show.id);
    li.innerHTML = `
      ${posterImg(show)}
      <div class="show-info">
        <div class="name">${escapeHtml(show.name)}</div>
      </div>
      <button class="${added ? "added" : ""}">${added ? "Added" : "Add"}</button>
    `;
    const btn = li.querySelector("button");
    btn.addEventListener("click", () => {
      if (savedIds.has(show.id)) return;
      addShow({ id: show.id, name: show.name, poster: show.poster || null });
      savedIds.add(show.id);
      btn.textContent = "Added";
      btn.classList.add("added");
    });
    els.searchResults.appendChild(li);
  }
}

// ---------- My Shows ----------

async function renderShowsList() {
  const shows = getShows();
  els.showsEmpty.classList.toggle("hidden", shows.length > 0);
  els.surpriseBtn.classList.toggle("hidden", shows.length === 0);
  els.biasControl.classList.toggle("hidden", shows.length === 0);
  els.showsList.innerHTML = "";
  // Saved entries may predate the poster field; backfill from the catalog.
  let posterById = {};
  try {
    posterById = Object.fromEntries((await loadCatalogIndex()).map((s) => [s.id, s.poster]));
  } catch {}
  for (const show of shows) {
    if (!show.poster && posterById[show.id]) show.poster = posterById[show.id];
    const li = document.createElement("li");
    li.className = "show-card";
    li.innerHTML = `
      ${posterImg(show)}
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
  // Include undated episodes; year-only strings ("2020") compare fine vs "2026-07-12".
  return data.episodes.filter((ep) => !ep.air_date || ep.air_date <= cutoff);
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
  // Softmax-style: bias acts as temperature on distance from the show's own
  // average, so the skew is meaningful even when all episodes rate 8-10.
  // Unrated episodes sit at the average (weight 1). At bias 5, an episode a
  // full point above average is picked ~150x more often than one at average.
  const weights = unwatched.map((ep) => {
    const rating = ep.imdb_rating != null ? ep.imdb_rating : avg;
    return Math.exp(bias * (rating - avg));
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
  els.resultEpisodeMeta.textContent =
    `S${episode.season_number}E${episode.episode_number}` +
    (episode.air_date ? ` · ${episode.air_date}` : "");
  if (episode.imdb_rating != null) {
    els.resultRating.textContent = `★ ${episode.imdb_rating.toFixed(1)} IMDb (${episode.imdb_votes.toLocaleString()} votes)`;
    els.resultRating.classList.remove("hidden");
  } else {
    els.resultRating.classList.add("hidden");
  }
  els.resultOverview.textContent = episode.overview || "";
  let poster = show.poster;
  if (!poster) {
    try {
      poster = (await loadShowData(show.id)).poster; // cached; covers legacy saved entries
    } catch {}
  }
  if (poster) {
    els.resultStill.src = poster;
    els.resultStill.style.display = "block";
  } else {
    els.resultStill.style.display = "none";
  }

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
renderBrowseList();
