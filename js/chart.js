// Ratings-timeline chart: single-series line over the show's run with the
// spun episode highlighted. Inline SVG, no libraries.
// Palette validated for dark surface #1f1c2e (CVD + contrast + lightness):
// line #7c5cff, highlight #f24d97.
const CHART_LINE = "#7c5cff";
const CHART_HILITE = "#f24d97";
const CHART_H = 300;
const M = { top: 16, right: 10, bottom: 20, left: 26 };

function renderRatingsChart(container, episodes, currentEp) {
  container.innerHTML = "";
  const rated = episodes.filter((ep) => ep.imdb_rating != null);
  if (rated.length < 2) return;

  const W = Math.max(container.clientWidth || 300, 200);
  const plotW = W - M.left - M.right;
  const plotH = CHART_H - M.top - M.bottom;

  const lo = Math.max(0, Math.floor(Math.min(...rated.map((e) => e.imdb_rating)) - 0.3));
  const hi = Math.min(10, Math.ceil(Math.max(...rated.map((e) => e.imdb_rating))));
  const x = (i) => M.left + (rated.length === 1 ? plotW / 2 : (i / (rated.length - 1)) * plotW);
  const y = (r) => M.top + plotH - ((r - lo) / (hi - lo)) * plotH;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", W);
  svg.setAttribute("height", CHART_H);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Episode ratings across the show's run");

  const el = (tag, attrs, parent = svg) => {
    const node = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };

  // alternating season bands (subtle wash)
  const seasons = [...new Set(rated.map((e) => e.season_number))];
  const seasonSpans = seasons.map((s) => {
    const idxs = rated.map((e, i) => (e.season_number === s ? i : -1)).filter((i) => i >= 0);
    return { s, from: Math.min(...idxs), to: Math.max(...idxs) };
  });
  seasonSpans.forEach((span, k) => {
    const x0 = span.from === 0 ? M.left : (x(span.from - 1) + x(span.from)) / 2;
    const x1 = span.to === rated.length - 1 ? M.left + plotW : (x(span.to) + x(span.to + 1)) / 2;
    if (k % 2 === 1) {
      el("rect", { x: x0, y: M.top, width: x1 - x0, height: plotH, fill: "rgba(255,255,255,0.04)" });
    }
    // season label — every season when few, every other when crowded
    if (seasons.length <= 10 || k % 2 === 0) {
      el("text", {
        x: (x0 + x1) / 2, y: CHART_H - 6, "text-anchor": "middle",
        "font-size": 10, fill: "var(--text-dim)",
      }).textContent = `S${span.s}`;
    }
  });

  // gridlines + y ticks at whole numbers
  for (let t = lo; t <= hi; t++) {
    el("line", { x1: M.left, y1: y(t), x2: M.left + plotW, y2: y(t), stroke: "rgba(255,255,255,0.07)", "stroke-width": 1 });
    el("text", { x: M.left - 6, y: y(t) + 3, "text-anchor": "end", "font-size": 10, fill: "var(--text-dim)" }).textContent = t;
  }

  // area wash + line
  const pts = rated.map((e, i) => `${x(i)},${y(e.imdb_rating)}`);
  el("polygon", {
    points: `${M.left},${M.top + plotH} ${pts.join(" ")} ${M.left + plotW},${M.top + plotH}`,
    fill: CHART_LINE, opacity: 0.1,
  });
  el("polyline", {
    points: pts.join(" "), fill: "none", stroke: CHART_LINE,
    "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round",
  });

  // highlighted spun episode: accent dot with surface ring + value label
  const curIdx = rated.findIndex(
    (e) => e.season_number === currentEp.season_number && e.episode_number === currentEp.episode_number
  );
  if (curIdx >= 0) {
    const cx = x(curIdx);
    const cy = y(rated[curIdx].imdb_rating);
    el("circle", { cx, cy, r: 7, fill: "var(--surface)" }); // surface ring
    el("circle", { cx, cy, r: 5, fill: CHART_HILITE });
    const labelX = Math.min(Math.max(cx, M.left + 12), M.left + plotW - 12);
    el("text", {
      x: labelX, y: Math.max(cy - 11, 11), "text-anchor": "middle",
      "font-size": 11, "font-weight": 700, fill: "var(--text)",
    }).textContent = rated[curIdx].imdb_rating.toFixed(1);
  }

  container.appendChild(svg);

  // caption: where this episode sits in the show's distribution
  if (curIdx >= 0) {
    const below = rated.filter((e) => e.imdb_rating < rated[curIdx].imdb_rating).length;
    const pct = Math.round((below / rated.length) * 100);
    const cap = document.createElement("p");
    cap.className = "chart-caption";
    cap.textContent = pct >= 50
      ? `Rated higher than ${pct}% of the show's ${rated.length} episodes`
      : `Rated lower than ${100 - pct}% of the show's ${rated.length} episodes`;
    container.appendChild(cap);
  }

  // hover/tap: nearest-point crosshair + tooltip
  const tip = document.createElement("div");
  tip.className = "chart-tooltip hidden";
  container.appendChild(tip);
  const cross = el("line", { x1: 0, y1: M.top, x2: 0, y2: M.top + plotH, stroke: "rgba(255,255,255,0.25)", "stroke-width": 1, visibility: "hidden" });
  const hoverDot = el("circle", { r: 4, fill: CHART_LINE, stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" });

  function showTip(clientX) {
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / W; // svg may render scaled by max-width:100%
    const px = (clientX - rect.left) / scale;
    // snap to nearest point, clamped so margin-zone hovers still work
    const i = Math.min(rated.length - 1, Math.max(0, Math.round(((px - M.left) / plotW) * (rated.length - 1))));
    const ep = rated[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    hoverDot.setAttribute("cx", x(i)); hoverDot.setAttribute("cy", y(ep.imdb_rating));
    hoverDot.setAttribute("visibility", "visible");
    tip.textContent = `S${ep.season_number}E${ep.episode_number} · ${ep.name || "?"} · ★${ep.imdb_rating.toFixed(1)}`;
    tip.classList.remove("hidden");
    // measure real width, then keep the tooltip fully inside the container
    const tw = tip.offsetWidth;
    const cw = container.clientWidth;
    const cssX = x(i) * scale;
    const tipX = Math.min(Math.max(cssX - tw / 2, 0), Math.max(cw - tw, 0));
    tip.style.left = `${tipX}px`;
  }
  function hideTip() {
    cross.setAttribute("visibility", "hidden");
    hoverDot.setAttribute("visibility", "hidden");
    tip.classList.add("hidden");
  }
  svg.addEventListener("pointermove", (e) => showTip(e.clientX));
  svg.addEventListener("pointerdown", (e) => showTip(e.clientX));
  svg.addEventListener("pointerleave", hideTip);
}
