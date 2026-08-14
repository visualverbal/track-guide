const state = {
  data: null,
  country: "all",
  search: "",
  strategy: "all",
  sort: "country",
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
  trackGrid: document.querySelector("#trackGrid"),
  template: document.querySelector("#trackTemplate")
};

applyTheme();

els.themeToggle.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("greyhoundGuide.theme", state.theme);
  applyTheme();
});

fetch("tracks.json")
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
    els.trackGrid.innerHTML = `<div class="empty">${error.message}</div>`;
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
    option.textContent = strategy;
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

  els.legend.innerHTML = state.data.strategyLegend.map((item) => (
    `<div class="legend-item"><strong>${item.key}</strong>: ${item.meaning}</div>`
  )).join("");
}

function render() {
  const tracks = filteredTracks();
  updateTabs();
  updateSummary(tracks.length);
  els.resultCount.textContent = `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`;

  els.trackGrid.innerHTML = "";
  if (!tracks.length) {
    els.trackGrid.innerHTML = '<div class="empty">No tracks match those filters.</div>';
    return;
  }

  for (const track of tracks) {
    els.trackGrid.append(renderTrack(track));
  }
}

function filteredTracks() {
  const textMatches = (track) => {
    if (!state.search) return true;
    const haystack = [
      track.name,
      track.country,
      track.strategy,
      track.grade,
      track.headline,
      track.rule,
      track.notes,
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

function updateTabs() {
  els.countryTabs.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.country === state.country);
  });
}

function updateSummary(count) {
  const total = state.data.tracks.length;
  const starred = state.starred.size;
  els.summary.textContent = `${count} shown / ${total} tracks · ${starred} starred · updated ${state.data.updated}`;
}

function renderTrack(track) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const id = slug(track.name);
  const cardClass = badgeClass(track.strategy);
  node.classList.add(cardClass);
  node.querySelector(".country").textContent = track.country;
  node.querySelector(".strategy").textContent = track.strategy;
  node.querySelector("h2").textContent = track.name;
  node.querySelector(".headline").textContent = track.headline;

  const star = node.querySelector(".star");
  star.textContent = state.starred.has(id) ? "★" : "☆";
  star.classList.toggle("active", state.starred.has(id));
  star.setAttribute("aria-label", state.starred.has(id) ? "Remove track from shortlist" : "Add track to shortlist");
  star.title = state.starred.has(id) ? "Remove from shortlist" : "Add to shortlist";
  star.addEventListener("click", () => {
    if (state.starred.has(id)) {
      state.starred.delete(id);
    } else {
      state.starred.add(id);
    }
    localStorage.setItem("greyhoundGuide.starred", JSON.stringify([...state.starred]));
    render();
  });

  node.querySelector(".metrics").innerHTML = [
    metric("Fav win", percent(track.favouriteWinRate)),
    metric("Sample", number(track.sample)),
    metric("Best draw", drawText(track))
  ].join("");

  const rule = node.querySelector(".rule");
  rule.innerHTML = `<span class="badge ${badgeClass(track.strategy)}">${track.grade || track.strategy}</span><br>${track.rule}`;

  const distances = node.querySelector(".distances");
  distances.innerHTML = (track.distances || []).map((distance) => (
    `<div class="distance"><strong>${distance.distance}</strong>: ${distance.note}</div>`
  )).join("");
  if (!track.distances || !track.distances.length) {
    distances.innerHTML = `<div class="distance">${track.notes}</div>`;
  }

  const textarea = node.querySelector("textarea");
  textarea.value = state.notes[id] || "";
  textarea.addEventListener("input", () => {
    state.notes[id] = textarea.value;
    localStorage.setItem("greyhoundGuide.notes", JSON.stringify(state.notes));
  });

  return node;
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
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
