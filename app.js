const state = {
  data: null,
  country: "all",
  search: "",
  strategy: "all",
  sort: "country",
  view: localStorage.getItem("greyhoundGuide.view") || "cards",
  starredOnly: false,
  theme: localStorage.getItem("greyhoundGuide.theme") || "dark",
  starred: new Set(JSON.parse(localStorage.getItem("greyhoundGuide.starred") || "[]")),
  notes: JSON.parse(localStorage.getItem("greyhoundGuide.notes") || "{}")
};

const els = {
  summary: document.querySelector("#summary"),
  countryTabs: document.querySelector("#countryTabs"),
  searchInput: document.querySelector("#searchInput"),
  strategyFilter: document.querySelector("#strategyFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  starredFilter: document.querySelector("#starredFilter"),
  themeToggle: document.querySelector("#themeToggle"),
  themeColor: document.querySelector('meta[name="theme-color"]'),
  resultCount: document.querySelector("#resultCount"),
  legend: document.querySelector("#legend"),
  viewToggle: document.querySelector("#viewToggle"),
  trackGrid: document.querySelector("#trackGrid"),
  trackTableWrap: document.querySelector("#trackTableWrap"),
  trackTableBody: document.querySelector("#trackTableBody"),
  template: document.querySelector("#trackTemplate")
};

applyTheme();

els.themeToggle.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("greyhoundGuide.theme", state.theme);
  applyTheme();
});

fetch("tracks.json", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error("Could not load tracks.json");
    return response.json();
  })
  .then((data) => {
    state.data = data;
    setupControls();
    render();
  })
  .catch((error) => {
    els.trackGrid.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    els.summary.textContent = "Data unavailable";
  });

function setupControls() {
  const countries = [{ code: "all", name: "All" }, ...state.data.countries];
  els.countryTabs.innerHTML = countries.map((country) => (
    `<button type="button" data-country="${country.code}">${country.code}</button>`
  )).join("");

  els.countryTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-country]");
    if (!button) return;
    state.country = button.dataset.country;
    render();
  });

  const strategies = [...new Set(state.data.tracks.map((track) => track.strategy))].sort();
  for (const strategy of strategies) {
    const option = document.createElement("option");
    option.value = strategy;
    option.textContent = profileLabel(strategy);
    els.strategyFilter.append(option);
  }

  els.searchInput.addEventListener("input", () => {
    state.search = els.searchInput.value.trim().toLowerCase();
    render();
  });

  els.strategyFilter.addEventListener("change", () => {
    state.strategy = els.strategyFilter.value;
    render();
  });

  els.sortSelect.addEventListener("change", () => {
    state.sort = els.sortSelect.value;
    render();
  });

  els.starredFilter.addEventListener("click", () => {
    state.starredOnly = !state.starredOnly;
    els.starredFilter.setAttribute("aria-pressed", String(state.starredOnly));
    render();
  });

  els.viewToggle.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) return;
    state.view = button.dataset.view;
    localStorage.setItem("greyhoundGuide.view", state.view);
    render();
  });

  const strategyItems = state.data.strategyLegend.map((item) => (
    `<div class="legend-item"><strong>${escapeHtml(profileLabel(item.key))}</strong>: historical track behaviour only; it does not establish value for an individual runner.</div>`
  ));
  strategyItems.push(
    '<div class="legend-item"><strong>Sample confidence</strong>: High uses 1,000+ favourite races, medium 300-999, and low fewer than 300. This is confidence in the track statistic, not a runner prediction.</div>',
    '<div class="legend-item"><strong>Draw metrics</strong>: AU shows the win rate for all runners from that box. UK and Ireland show the favourite win rate from that trap.</div>',
    '<div class="legend-item"><strong>Value gate</strong>: Manual and Live Value require complete runner probabilities, commission-adjusted edge and sufficient evidence before returning a bet decision.</div>'
  );
  els.legend.innerHTML = strategyItems.join("");
}

function render() {
  const tracks = filteredTracks();
  const useCards = state.view === "cards";
  updateControls();
  updateSummary(tracks.length);
  els.resultCount.textContent = `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`;
  els.trackGrid.innerHTML = "";
  els.trackTableBody.innerHTML = "";

  if (!tracks.length) {
    els.trackGrid.hidden = false;
    els.trackTableWrap.hidden = true;
    els.trackGrid.innerHTML = '<div class="empty">No tracks match those filters.</div>';
    return;
  }

  els.trackGrid.hidden = !useCards;
  els.trackTableWrap.hidden = useCards;

  if (useCards) {
    for (const track of tracks) {
      els.trackGrid.append(renderTrack(track));
    }
  } else {
    const fragment = document.createDocumentFragment();
    for (const track of tracks) {
      fragment.append(renderTableRow(track));
    }
    els.trackTableBody.append(fragment);
  }
}

function filteredTracks() {
  const textMatches = (track) => {
    if (!state.search) return true;
    const profile = profileFor(track);
    const haystack = [
      track.name,
      track.country,
      track.strategy,
      track.grade,
      track.headline,
      track.rule,
      track.notes,
      profile.source,
      profile.period,
      profile.drawBasis,
      ...(track.distances || []).map((distance) => `${distance.distance} ${distance.note}`)
    ].join(" ").toLowerCase();
    return haystack.includes(state.search);
  };

  return state.data.tracks
    .filter((track) => state.country === "all" || track.country === state.country)
    .filter((track) => state.strategy === "all" || track.strategy === state.strategy)
    .filter((track) => !state.starredOnly || state.starred.has(slug(track.name)))
    .filter(textMatches)
    .sort(sortTracks);
}

function sortTracks(a, b) {
  if (state.sort === "rate") {
    return valueForSort(b.favouriteWinRate) - valueForSort(a.favouriteWinRate) || a.name.localeCompare(b.name);
  }
  if (state.sort === "sample") {
    return valueForSort(b.sample) - valueForSort(a.sample) || a.name.localeCompare(b.name);
  }
  if (state.sort === "track") {
    return a.name.localeCompare(b.name);
  }
  return a.country.localeCompare(b.country) || a.name.localeCompare(b.name);
}

function valueForSort(value) {
  return Number.isFinite(value) ? value : -1;
}

function updateControls() {
  els.countryTabs.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.country === state.country);
  });
  els.viewToggle.querySelectorAll("button").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function updateSummary(count) {
  const total = state.data.tracks.length;
  const starred = state.starred.size;
  els.summary.textContent = `${count} shown / ${total} tracks | ${starred} starred | updated ${state.data.updated}`;
}

function renderTrack(track) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const profile = profileFor(track);
  const confidence = confidenceFor(track);
  node.classList.add(badgeClass(track.strategy));
  node.querySelector(".country").textContent = track.country;
  node.querySelector(".strategy").textContent = profileLabel(track.strategy);
  node.querySelector("h2").textContent = track.name;
  node.querySelector(".headline").textContent = track.headline;

  configureStar(node.querySelector(".star"), track);

  node.querySelector(".card-meta").innerHTML = [
    confidenceBadge(confidence),
    `<span class="meta-item" title="Data source">${escapeHtml(profile.source)}</span>`,
    `<span class="meta-item" title="Analysis period">${escapeHtml(profile.period)}</span>`
  ].join("");

  node.querySelector(".metrics").innerHTML = [
    metric("Fav win", percent(track.favouriteWinRate)),
    metric("Sample", number(track.sample)),
    metric(profile.drawLabel, drawText(track))
  ].join("");

  const rule = node.querySelector(".rule");
  rule.innerHTML = `<span class="badge ${badgeClass(track.strategy)}">Context ${escapeHtml(track.grade || track.strategy)}</span><br><strong>Historical note:</strong> ${escapeHtml(track.rule)}`;

  const distances = node.querySelector(".distances");
  distances.innerHTML = (track.distances || []).map((distance) => (
    `<div class="distance"><strong>${escapeHtml(distance.distance)}</strong>: ${escapeHtml(distance.note)}</div>`
  )).join("");
  if (!track.distances || !track.distances.length) {
    distances.innerHTML = `<div class="distance">${escapeHtml(track.notes)}</div>`;
  }

  const textarea = node.querySelector("textarea");
  const id = slug(track.name);
  textarea.value = state.notes[id] || "";
  textarea.addEventListener("input", () => {
    state.notes[id] = textarea.value;
    localStorage.setItem("greyhoundGuide.notes", JSON.stringify(state.notes));
  });

  return node;
}

function renderTableRow(track) {
  const row = document.createElement("tr");
  const profile = profileFor(track);
  const confidence = confidenceFor(track);
  const distance = strongestDistance(track);
  row.className = badgeClass(track.strategy);
  row.innerHTML = `
    <td>
      <strong class="table-track">${escapeHtml(track.name)}</strong>
      <span class="table-sub">${escapeHtml(track.country)} | ${escapeHtml(profileLabel(track.strategy))}</span>
    </td>
    <td>${confidenceBadge(confidence)}</td>
    <td><strong class="table-rate">${percent(track.favouriteWinRate)}</strong></td>
    <td>${number(track.sample)}</td>
    <td><strong>${escapeHtml(drawText(track))}</strong><span class="table-sub">${escapeHtml(profile.drawBasis)}</span></td>
    <td><strong>${escapeHtml(distance.label)}</strong><span class="table-sub">${escapeHtml(distance.detail)}</span></td>
    <td>${escapeHtml(profile.source)}<span class="table-sub">${escapeHtml(profile.period)}</span></td>
    <td class="table-star-cell"></td>
  `;
  configureStar(row.querySelector(".table-star-cell").appendChild(document.createElement("button")), track, true);
  return row;
}

function configureStar(button, track, compact = false) {
  const id = slug(track.name);
  const active = state.starred.has(id);
  button.type = "button";
  button.className = compact ? "star table-star" : "star";
  button.textContent = active ? "\u2605" : "\u2606";
  button.classList.toggle("active", active);
  button.setAttribute("aria-label", active ? "Remove track from shortlist" : "Add track to shortlist");
  button.title = active ? "Remove from shortlist" : "Add to shortlist";
  button.addEventListener("click", () => {
    if (state.starred.has(id)) {
      state.starred.delete(id);
    } else {
      state.starred.add(id);
    }
    localStorage.setItem("greyhoundGuide.starred", JSON.stringify([...state.starred]));
    render();
  });
}

function profileFor(track) {
  const profileKey = state.data.trackProfiles?.[track.name];
  const profile = state.data.dataProfiles?.[profileKey];
  if (profile) return profile;
  return {
    source: "Guide analysis",
    period: "Period not specified",
    drawBasis: track.country === "AU" ? "All runners from box" : "Favourite wins from trap",
    drawLabel: track.country === "AU" ? "All-runner box" : "Fav by trap"
  };
}

function confidenceFor(track) {
  if (track.sample >= 1000) {
    return { level: "high", label: "High", title: "High sample confidence: 1,000+ favourite races" };
  }
  if (track.sample >= 300) {
    return { level: "medium", label: "Medium", title: "Medium sample confidence: 300-999 favourite races" };
  }
  return { level: "low", label: "Low", title: "Low sample confidence: fewer than 300 favourite races" };
}

function confidenceBadge(confidence) {
  return `<span class="confidence confidence-${confidence.level}" title="${confidence.title}">${confidence.label} confidence</span>`;
}

function strongestDistance(track) {
  let best = null;
  for (const item of track.distances || []) {
    const match = item.note.match(/(\d+(?:\.\d+)?)%/);
    if (!match) continue;
    const rate = Number(match[1]);
    if (!best || rate > best.rate) {
      best = { label: item.distance, detail: `${rate.toFixed(1)}%`, rate };
    }
  }
  return best || { label: "Not split", detail: "Track-wide only" };
}

function metric(label, value) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function percent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "TBC";
}

function number(value) {
  return Number.isFinite(value) ? value.toLocaleString() : "TBC";
}

function drawText(track) {
  if (!track.bestDraw) return "TBC";
  return Number.isFinite(track.bestDrawRate) ? `${track.bestDraw} ${track.bestDrawRate.toFixed(1)}%` : track.bestDraw;
}

function badgeClass(strategy) {
  if (strategy.includes("FOLLOW")) return "follow";
  if (strategy.includes("TRAP")) return "trap";
  if (strategy.includes("RESEARCH")) return "research";
  return "caution";
}

function profileLabel(strategy) {
  const labels = {
    "A+ FOLLOW": "High favourite reliability",
    "A FOLLOW": "Solid favourite reliability",
    "B / CHECK FORM": "Mixed favourite reliability",
    "BOX + $": "Draw-sensitive",
    "BOX OVERRIDE": "Draw-sensitive",
    "TRAP-SPECIFIC": "Trap-sensitive",
    "RESEARCH": "Research only"
  };
  return labels[strategy] || strategy;
}

function applyTheme() {
  const isDark = state.theme === "dark";
  document.documentElement.dataset.theme = state.theme;
  els.themeToggle.setAttribute("aria-pressed", String(isDark));
  els.themeToggle.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} mode`);
  els.themeColor.content = isDark ? "#0b0f14" : "#f2f4f7";
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
