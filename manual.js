(() => {
  const storageKey = "greyhoundGuide.manualRace";
  const manualState = {
    tracks: [],
    runners: []
  };

  const manualEls = {
    form: document.querySelector("#manualForm"),
    track: document.querySelector("#manualTrack"),
    distance: document.querySelector("#manualDistance"),
    racecard: document.querySelector("#manualRacecard"),
    message: document.querySelector("#manualMessage"),
    clear: document.querySelector("#clearManual"),
    results: document.querySelector("#manualResults")
  };

  setupManualCheck();

  async function setupManualCheck() {
    manualEls.form.addEventListener("submit", checkRace);
    manualEls.form.addEventListener("input", saveManualState);
    manualEls.clear.addEventListener("click", clearRace);
    manualEls.results.addEventListener("change", editRunner);
    manualEls.results.addEventListener("click", removeRunner);

    try {
      const data = await fetch("tracks.json").then((response) => response.json());
      manualState.tracks = data.tracks || [];
      populateTracks();
      restoreManualState();
    } catch (_error) {
      manualEls.message.textContent = "Track data could not be loaded.";
    }
  }

  function populateTracks() {
    const countryOrder = { AU: 0, UK: 1, IRE: 2 };
    const tracks = [...manualState.tracks].sort((a, b) => (
      countryOrder[a.country] - countryOrder[b.country] || a.name.localeCompare(b.name)
    ));
    manualEls.track.insertAdjacentHTML("beforeend", tracks.map((track) => (
      `<option value="${manualEscape(track.name)}">${manualEscape(track.country)} | ${manualEscape(track.name)}</option>`
    )).join(""));
  }

  function checkRace(event) {
    event.preventDefault();
    const result = parseRacecard(manualEls.racecard.value);
    if (result.runners.length < 2) {
      manualState.runners = [];
      manualEls.message.textContent = result.runners.length
        ? "Only one runner was found. Add at least one more line."
        : "No runners found. Start each line with its box or trap number.";
      renderManualResults();
      saveManualState();
      return;
    }
    manualState.runners = result.runners;
    const duplicateText = result.duplicates.length
      ? ` Duplicate draws ignored: ${result.duplicates.join(", ")}.`
      : "";
    manualEls.message.textContent = `${result.runners.length} runners found.${duplicateText}`;
    renderManualResults();
    saveManualState();
  }

  function parseRacecard(value) {
    const runners = [];
    const duplicates = [];
    const usedDraws = new Set();
    const lines = String(value || "").split(/\r?\n/);

    for (const original of lines) {
      const line = original
        .trim()
        .replace(/\t+/g, " ")
        .replace(/\s*[|,]\s*/g, " ")
        .replace(/\s+/g, " ");
      if (!line) continue;
      const match = line.match(/^(?:box|trap|t)?\s*([1-8])(?:\s*[-.):]\s*|\s+)(.+)$/i);
      if (!match) continue;
      const draw = Number(match[1]);
      if (usedDraws.has(draw)) {
        duplicates.push(draw);
        continue;
      }

      let name = match[2].trim();
      let odds = null;
      const oddsMatch = name.match(/(?:^|\s)(\$?\d+(?:\.\d+)?|\d+\s*\/\s*\d+|evs?|even)$/i);
      if (oddsMatch) {
        odds = parseOdds(oddsMatch[1]);
        name = name.slice(0, oddsMatch.index).trim();
      }
      name = name.replace(/^[-.:\s]+|[-.:\s]+$/g, "");
      if (!name || /^(box|trap|runner|greyhound|odds)$/i.test(name)) continue;

      usedDraws.add(draw);
      runners.push({ draw, name, odds });
    }

    runners.sort((a, b) => a.draw - b.draw);
    return { runners, duplicates };
  }

  function parseOdds(value) {
    const text = String(value || "").trim().replace(/^\$/, "");
    if (/^(evs?|even)$/i.test(text)) return 2;
    const fraction = text.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (fraction && Number(fraction[2])) {
      return 1 + Number(fraction[1]) / Number(fraction[2]);
    }
    const decimal = Number(text);
    return Number.isFinite(decimal) && decimal > 1 ? decimal : null;
  }

  function renderManualResults() {
    const track = selectedTrack();
    if (!manualState.runners.length || !track) {
      manualEls.results.innerHTML = '<div class="race-empty">Paste a racecard to compare its runners with the track guide.</div>';
      return;
    }

    const favourite = favouriteFor(manualState.runners);
    const bestDraw = drawNumber(track.bestDraw);
    const distance = distanceContext(track, manualEls.distance.value);
    const rows = manualState.runners.map((runner) => {
      const signal = manualSignal(runner, favourite, bestDraw);
      return `
        <tr>
          <td><span class="trap-number">${runner.draw}</span></td>
          <td><input class="manual-name-input" data-runner-draw="${runner.draw}" data-field="name" value="${manualEscape(runner.name)}" aria-label="Runner ${runner.draw} name"></td>
          <td><input class="manual-odds-input" data-runner-draw="${runner.draw}" data-field="odds" type="number" min="1.01" step="0.01" value="${runner.odds ? runner.odds.toFixed(2) : ""}" placeholder="-" aria-label="Runner ${runner.draw} odds"></td>
          <td><span class="runner-signal ${signal.className}">${signal.label}</span></td>
          <td class="manual-remove-cell"><button class="manual-remove" type="button" data-remove-draw="${runner.draw}" aria-label="Remove runner ${runner.draw}" title="Remove runner">&times;</button></td>
        </tr>
      `;
    }).join("");

    manualEls.results.innerHTML = `
      <div class="manual-result-head">
        <div>
          <p class="eyebrow">${manualEscape(track.country)} | ${manualEscape(track.strategy)}</p>
          <h2>${manualEscape(track.name)} <span>${manualEscape(normalizeDistance(manualEls.distance.value) || "Distance not set")}</span></h2>
        </div>
        <span class="manual-runner-count">${manualState.runners.length} runners</span>
      </div>
      <div class="manual-summary">
        <div><span>Favourite</span><strong>${manualEscape(favouriteText(favourite))}</strong></div>
        <div><span>Track fav win</span><strong>${track.favouriteWinRate.toFixed(1)}%</strong></div>
        <div><span>Best draw</span><strong>${manualEscape(track.bestDraw)} ${track.bestDrawRate.toFixed(1)}%</strong></div>
        <div><span>Guide signal</span><strong>${manualEscape(alignmentText(favourite, bestDraw))}</strong></div>
      </div>
      <div class="manual-guide-rule">
        <strong>${manualEscape(distance.label)}</strong>
        <span>${manualEscape(distance.note)}</span>
        <p>${manualEscape(track.rule)}</p>
      </div>
      <div class="runner-table-wrap">
        <table class="runner-table manual-runner-table">
          <thead><tr><th>Draw</th><th>Greyhound</th><th>Odds</th><th>Signal</th><th><span class="sr-only">Remove</span></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="dog-history-note">This check compares price and draw with the track guide. It does not yet include each dog's historical form.</p>
    `;
  }

  function editRunner(event) {
    const input = event.target.closest("[data-runner-draw][data-field]");
    if (!input) return;
    const runner = manualState.runners.find((item) => item.draw === Number(input.dataset.runnerDraw));
    if (!runner) return;
    if (input.dataset.field === "name") {
      runner.name = input.value.trim() || runner.name;
    } else {
      const value = Number(input.value);
      runner.odds = Number.isFinite(value) && value > 1 ? value : null;
    }
    renderManualResults();
    saveManualState();
  }

  function removeRunner(event) {
    const button = event.target.closest("button[data-remove-draw]");
    if (!button) return;
    manualState.runners = manualState.runners.filter((runner) => runner.draw !== Number(button.dataset.removeDraw));
    manualEls.message.textContent = `${manualState.runners.length} runners remaining.`;
    renderManualResults();
    saveManualState();
  }

  function selectedTrack() {
    return manualState.tracks.find((track) => track.name === manualEls.track.value) || null;
  }

  function favouriteFor(runners) {
    const priced = runners.filter((runner) => Number.isFinite(runner.odds));
    if (!priced.length) return { runners: [], odds: null };
    const lowest = Math.min(...priced.map((runner) => runner.odds));
    return { runners: priced.filter((runner) => runner.odds === lowest), odds: lowest };
  }

  function favouriteText(favourite) {
    if (!favourite.runners.length) return "Odds required";
    const names = favourite.runners.map((runner) => runner.name).join(" / ");
    return `${names} @ ${favourite.odds.toFixed(2)}`;
  }

  function alignmentText(favourite, bestDraw) {
    if (!favourite.runners.length) return "Waiting for odds";
    if (!bestDraw) return "Use track rule";
    const aligned = favourite.runners.some((runner) => runner.draw === bestDraw);
    if (aligned && favourite.runners.length > 1) return "Joint favourite includes best draw";
    if (aligned) return "Favourite and best draw align";
    return "Favourite differs from best draw";
  }

  function manualSignal(runner, favourite, bestDraw) {
    const isFavourite = favourite.runners.some((item) => item.draw === runner.draw);
    const isBestDraw = bestDraw === runner.draw;
    if (isFavourite && isBestDraw) return { label: "Fav + draw", className: "strong" };
    if (isFavourite) return { label: favourite.runners.length > 1 ? "Joint fav" : "Favourite", className: "favourite" };
    if (isBestDraw) return { label: "Best draw", className: "draw" };
    return { label: "-", className: "neutral" };
  }

  function drawNumber(value) {
    const match = String(value || "").match(/(?:Box|T)\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  function distanceContext(track, value) {
    const target = normalizeDistance(value);
    if (!target) return { label: "All distances", note: track.headline };
    const exact = (track.distances || []).find((item) => normalizeDistance(item.distance) === target);
    if (exact) return { label: exact.distance, note: exact.note };
    return { label: target, note: "No distance-specific split is stored; use the overall track figures." };
  }

  function normalizeDistance(value) {
    const match = String(value || "").match(/(\d{2,4})/);
    return match ? `${match[1]}m` : "";
  }

  function saveManualState() {
    const payload = {
      track: manualEls.track.value,
      distance: manualEls.distance.value,
      racecard: manualEls.racecard.value,
      runners: manualState.runners
    };
    localStorage.setItem(storageKey, JSON.stringify(payload));
  }

  function restoreManualState() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    } catch (_error) {
      localStorage.removeItem(storageKey);
    }
    if (!saved) return;
    manualEls.track.value = saved.track || "";
    manualEls.distance.value = saved.distance || "";
    manualEls.racecard.value = saved.racecard || "";
    manualState.runners = Array.isArray(saved.runners) ? saved.runners : [];
    if (manualState.runners.length >= 2 && selectedTrack()) {
      manualEls.message.textContent = `${manualState.runners.length} runners restored.`;
      renderManualResults();
    }
  }

  function clearRace() {
    manualEls.form.reset();
    manualState.runners = [];
    manualEls.message.textContent = "";
    manualEls.results.innerHTML = '<div class="race-empty">Paste a racecard to compare its runners with the track guide.</div>';
    localStorage.removeItem(storageKey);
  }

  function manualEscape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
