const els = {
  views: {
    main: document.getElementById("view-main"),
    result: document.getElementById("view-result"),
  },
  searchInput: document.getElementById("search-input"),
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
  resultSeasonChip: document.getElementById("result-season-chip"),
  resultEpisodeChip: document.getElementById("result-episode-chip"),
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
}

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

// ---------- Show list ----------

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

async function renderShowList(query = "") {
  let catalogIndex;
  try {
    catalogIndex = await loadCatalogIndex();
  } catch (err) {
    els.showsList.innerHTML = `<li class="empty-hint">Couldn't load catalog: ${err.message}</li>`;
    return;
  }
  const needle = query.trim().toLowerCase();
  const results = needle
    ? catalogIndex.filter((s) => s.name.toLowerCase().includes(needle))
    : catalogIndex;
  els.showsEmpty.classList.toggle("hidden", catalogIndex.length > 0);
  els.surpriseBtn.classList.toggle("hidden", catalogIndex.length === 0);
  els.biasControl.classList.toggle("hidden", catalogIndex.length === 0);
  els.showsList.innerHTML = "";
  for (const show of results) {
    const li = document.createElement("li");
    li.className = "show-card tappable";
    li.innerHTML = `
      ${posterImg(show)}
      <div class="show-info">
        <div class="name">${escapeHtml(show.name)}</div>
      </div>
      <span class="spin-hint">🎲</span>
    `;
    li.addEventListener("click", () => startSpin({ type: "show", showId: show.id }));
    els.showsList.appendChild(li);
  }
}

let searchDebounce = null;
els.searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  const query = els.searchInput.value;
  searchDebounce = setTimeout(() => renderShowList(query), 250);
});

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
    const catalogIndex = await loadCatalogIndex();
    if (scope.type === "show") {
      const show = catalogIndex.find((s) => s.id === scope.showId);
      const episodes = await getAiredEpisodes(scope.showId);
      const pick = pickWeighted(scope.showId, episodes);
      await revealResult(show, pick, episodes.length === 0);
    } else {
      const shuffled = [...catalogIndex].sort(() => Math.random() - 0.5);
      let show = null;
      let pick = null;
      for (const candidate of shuffled) {
        let episodes;
        try {
          episodes = await getAiredEpisodes(candidate.id);
        } catch {
          continue;
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
      : "You're all caught up on every show! 🎉";
    return;
  }

  activeResult = { show, episode };
  els.resultShowName.textContent = show.name;
  els.resultSeasonChip.textContent = `Season ${episode.season_number}`;
  els.resultEpisodeChip.textContent = `Episode ${episode.episode_number}`;
  els.resultEpisodeTitle.textContent = episode.name || "Untitled episode";
  els.resultEpisodeMeta.textContent = episode.air_date ? `Aired ${episode.air_date}` : "";
  if (episode.imdb_rating != null) {
    els.resultRating.textContent = `★ ${episode.imdb_rating.toFixed(1)} IMDb (${episode.imdb_votes.toLocaleString()} votes)`;
    els.resultRating.classList.remove("hidden");
  } else {
    els.resultRating.classList.add("hidden");
  }
  els.resultOverview.textContent = episode.overview || "";
  if (show.poster) {
    els.resultStill.src = show.poster;
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
  showView("main");
});

els.resetWatchedBtn.addEventListener("click", () => {
  if (activeSpinScope?.type === "show") {
    resetWatched(activeSpinScope.showId);
    startSpin(activeSpinScope);
  } else {
    loadCatalogIndex().then((idx) => {
      idx.forEach((s) => resetWatched(s.id));
      startSpin(activeSpinScope);
    });
  }
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

renderShowList();
