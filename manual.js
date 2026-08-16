(() => {
  const storageKey = "greyhoundGuide.manualRace";
  const value = window.GreyhoundValue;
  const manualState = { tracks: [], runners: [] };
  let renderTimer = null;

  const manualEls = {
    form: document.querySelector("#manualForm"),
    track: document.querySelector("#manualTrack"),
    distance: document.querySelector("#manualDistance"),
    racecard: document.querySelector("#manualRacecard"),
    commission: document.querySelector("#manualCommission"),
    minimumEdge: document.querySelector("#manualMinEdge"),
    bankroll: document.querySelector("#manualBankroll"),
    riskCap: document.querySelector("#manualRiskCap"),
    evidence: document.querySelector("#manualEvidence"),
    message: document.querySelector("#manualMessage"),
    clear: document.querySelector("#clearManual"),
    results: document.querySelector("#manualResults")
  };

  setupManualCheck();

  async function setupManualCheck() {
    manualEls.form.addEventListener("submit", checkRace);
    manualEls.form.addEventListener("input", saveManualState);
    manualEls.form.addEventListener("change", () => {
      renderManualResults();
      saveManualState();
    });
    manualEls.clear.addEventListener("click", clearRace);
    manualEls.results.addEventListener("input", editRunnerLive);
    manualEls.results.addEventListener("change", editRunner);
    manualEls.results.addEventListener("click", removeRunner);

    try {
      const data = await fetch("tracks.json", { cache: "no-store" }).then((response) => response.json());
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
    const previous = new Map(manualState.runners.map((runner) => [`${runner.draw}:${runner.name.toLowerCase()}`, runner]));
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
    manualState.runners = result.runners.map((runner) => {
      const saved = previous.get(`${runner.draw}:${runner.name.toLowerCase()}`);
      return saved ? { ...runner, layOdds: saved.layOdds || null, probability: saved.probability || null } : runner;
    });
    const duplicateText = result.duplicates.length
      ? ` Duplicate draws ignored: ${result.duplicates.join(", ")}.`
      : "";
    manualEls.message.textContent = `${result.runners.length} runners found. Add a model win percentage for every runner.${duplicateText}`;
    renderManualResults();
    saveManualState();
  }

  function parseRacecard(valueText) {
    const runners = [];
    const duplicates = [];
    const usedDraws = new Set();
    const lines = String(valueText || "").split(/\r?\n/);

    for (const original of lines) {
      const line = original.trim().replace(/\t+/g, " ").replace(/\s*[|,]\s*/g, " ").replace(/\s+/g, " ");
      if (!line) continue;
      const match = line.match(/^(?:box|trap|t)?\s*([1-8])(?:\s*[-.):]\s*|\s+)(.+)$/i);
      if (!match) continue;
      const draw = Number(match[1]);
      if (usedDraws.has(draw)) {
        duplicates.push(draw);
        continue;
      }

      let name = match[2].trim();
      let backOdds = null;
      const oddsMatch = name.match(/(?:^|\s)(\$?\d+(?:\.\d+)?|\d+\s*\/\s*\d+|evs?|even)$/i);
      if (oddsMatch) {
        backOdds = parseOdds(oddsMatch[1]);
        name = name.slice(0, oddsMatch.index).trim();
      }
      name = name.replace(/^[-.:\s]+|[-.:\s]+$/g, "");
      if (!name || /^(box|trap|runner|greyhound|odds)$/i.test(name)) continue;

      usedDraws.add(draw);
      runners.push({ draw, name, backOdds, layOdds: null, probability: null });
    }

    runners.sort((a, b) => a.draw - b.draw);
    return { runners, duplicates };
  }

  function parseOdds(rawValue) {
    const text = String(rawValue || "").trim().replace(/^\$/, "");
    if (/^(evs?|even)$/i.test(text)) return 2;
    const fraction = text.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (fraction && Number(fraction[2])) return 1 + Number(fraction[1]) / Number(fraction[2]);
    const decimal = Number(text);
    return Number.isFinite(decimal) && decimal > 1 ? decimal : null;
  }

  function renderManualResults() {
    const track = selectedTrack();
    if (!manualState.runners.length || !track) {
      manualEls.results.innerHTML = '<div class="race-empty">Paste a racecard to begin a price and probability assessment.</div>';
      return;
    }

    const settings = decisionSettings();
    const favourite = favouriteFor(manualState.runners);
    const bestDraw = drawNumber(track.bestDraw);
    const distance = distanceContext(track, manualEls.distance.value);
    const probabilityStatus = value.probabilitySetStatus(manualState.runners.map((runner) => probabilityDecimal(runner.probability)));
    const marketProbabilities = value.marketProbabilities(manualState.runners.map((runner) => runner.backOdds));
    const assessments = value.selectMarketDecision(manualState.runners.map((runner) => value.evaluate({
      probability: probabilityDecimal(runner.probability),
      backOdds: runner.backOdds,
      layOdds: runner.layOdds,
      probabilitySetReady: probabilityStatus.balanced,
      ...settings
    })));
    const decisions = assessments.filter((assessment) => assessment.decision !== value.DECISION.NO_BET).length;

    const rows = manualState.runners.map((runner, index) => {
      const context = manualContext(runner, favourite, bestDraw);
      const assessment = assessments[index];
      return `
        <tr>
          <td><span class="trap-number">${runner.draw}</span></td>
          <td><input class="manual-name-input" data-runner-draw="${runner.draw}" data-field="name" value="${manualEscape(runner.name)}" aria-label="Runner ${runner.draw} name"></td>
          <td>${oddsInput(runner, "backOdds", "Back", assessment.backRequired, marketProbabilities[index])}</td>
          <td>${oddsInput(runner, "layOdds", "Lay", assessment.layMaximum)}</td>
          <td><input class="manual-probability-input" data-runner-draw="${runner.draw}" data-field="probability" type="number" min="0.1" max="99.9" step="0.1" value="${numberInputValue(runner.probability, 1)}" placeholder="-" aria-label="Runner ${runner.draw} model win percentage"></td>
          <td>${priceText(assessment.fairOdds)}</td>
          <td class="edge-cell ${edgeClass(assessment.chosenRoi)}">${percentText(assessment.chosenRoi)}</td>
          <td>${decisionHtml(assessment)}</td>
          <td><span class="runner-signal ${context.className}">${context.label}</span></td>
          <td class="manual-remove-cell"><button class="manual-remove" type="button" data-remove-draw="${runner.draw}" aria-label="Remove runner ${runner.draw}" title="Remove runner">&times;</button></td>
        </tr>
      `;
    }).join("");

    manualEls.results.innerHTML = `
      <div class="manual-result-head">
        <div>
          <p class="eyebrow">${manualEscape(track.country)} | historical ${manualEscape(track.strategy)}</p>
          <h2>${manualEscape(track.name)} <span>${manualEscape(normalizeDistance(manualEls.distance.value) || "Distance not set")}</span></h2>
        </div>
        <span class="manual-runner-count">${manualState.runners.length} runners</span>
      </div>
      <div class="decision-progress" aria-label="Assessment status">
        ${progressItem("Race", `${manualState.runners.length} runners`, true)}
        ${progressItem("Probabilities", probabilityStatusText(probabilityStatus, manualState.runners.length), probabilityStatus.balanced)}
        ${progressItem("Costs", `${(settings.commission * 100).toFixed(1)}% commission`, true)}
        ${progressItem("Decision", decisions ? `${decisions} value ${decisions === 1 ? "case" : "cases"}` : "No bet", decisions > 0)}
      </div>
      <div class="manual-summary">
        <div><span>Price favourite</span><strong>${manualEscape(favouriteText(favourite))}</strong></div>
        <div><span>Historical fav win</span><strong>${track.favouriteWinRate.toFixed(1)}%</strong></div>
        <div><span>Historical draw</span><strong>${manualEscape(track.bestDraw)} ${track.bestDrawRate.toFixed(1)}%</strong></div>
        <div><span>Evidence gate</span><strong>${settings.evidence === "validated" ? "Validated model" : "Paper only"}</strong></div>
      </div>
      <div class="manual-guide-rule">
        <strong>${manualEscape(distance.label)}</strong>
        <span>${manualEscape(distance.note)}</span>
        <p>Context only: ${manualEscape(track.rule)}</p>
      </div>
      <div class="runner-table-wrap">
        <table class="runner-table manual-runner-table">
          <thead><tr><th>Draw</th><th>Greyhound</th><th>Back</th><th>Lay</th><th>Model %</th><th>Fair</th><th>Edge</th><th>Decision</th><th>Context</th><th><span class="sr-only">Remove</span></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="dog-history-note">Track statistics and comments provide context only. A value decision requires complete probabilities totalling about 100%; unverified probabilities remain paper-only. Only the strongest qualifying position is selected in each race.</p>
    `;
  }

  function oddsInput(runner, field, label, threshold, marketProbability = null) {
    const thresholdLabel = field === "backOdds" ? "Needs" : "Lay below";
    const marketLabel = Number.isFinite(marketProbability) ? ` | Market ${(marketProbability * 100).toFixed(1)}%` : "";
    return `
      <input class="manual-odds-input" data-runner-draw="${runner.draw}" data-field="${field}" type="number" min="1.01" step="0.01" value="${numberInputValue(runner[field], 2)}" placeholder="-" aria-label="Runner ${runner.draw} ${label.toLowerCase()} odds">
      <small class="price-detail">${Number.isFinite(threshold) ? `${thresholdLabel} ${(threshold * 100).toFixed(1)}%${marketLabel}` : "Price needed"}</small>
    `;
  }

  function progressItem(label, text, ready) {
    return `<div class="${ready ? "ready" : "waiting"}"><span>${label}</span><strong>${manualEscape(text)}</strong></div>`;
  }

  function probabilityStatusText(status, runnerCount) {
    if (!status.count) return "Needed";
    if (!status.complete) return `${status.count}/${runnerCount} entered`;
    return `${(status.total * 100).toFixed(1)}% ${status.balanced ? "ready" : "recheck"}`;
  }

  function decisionHtml(assessment) {
    const stake = Number.isFinite(assessment.stake) && assessment.stake > 0
      ? `<small>${assessment.stakeLabel} $${assessment.stake.toFixed(2)}</small>`
      : "";
    return `<span class="value-decision ${assessment.className}" title="${manualEscape(assessment.reason)}">${assessment.decision}</span>${stake}`;
  }

  function edgeClass(edge) {
    if (!Number.isFinite(edge)) return "";
    return edge > 0 ? "positive" : "negative";
  }

  function editRunner(event) {
    if (!updateRunnerFromInput(event)) return;
    if (renderTimer) window.clearTimeout(renderTimer);
    renderTimer = null;
    renderManualResults();
    saveManualState();
  }

  function editRunnerLive(event) {
    if (!updateRunnerFromInput(event)) return;
    if (renderTimer) window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      renderManualResults();
      saveManualState();
    }, 350);
  }

  function updateRunnerFromInput(event) {
    const input = event.target.closest("[data-runner-draw][data-field]");
    if (!input) return false;
    const runner = manualState.runners.find((item) => item.draw === Number(input.dataset.runnerDraw));
    if (!runner) return false;
    if (input.dataset.field === "name") {
      runner.name = input.value.trim() || runner.name;
    } else {
      const number = Number(input.value);
      const isProbability = input.dataset.field === "probability";
      runner[input.dataset.field] = Number.isFinite(number) && number > 0 && (isProbability ? number < 100 : number > 1) ? number : null;
    }
    return true;
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
    const priced = runners.filter((runner) => Number.isFinite(runner.backOdds));
    if (!priced.length) return { runners: [], odds: null };
    const lowest = Math.min(...priced.map((runner) => runner.backOdds));
    return { runners: priced.filter((runner) => runner.backOdds === lowest), odds: lowest };
  }

  function favouriteText(favourite) {
    if (!favourite.runners.length) return "Odds required";
    const names = favourite.runners.map((runner) => runner.name).join(" / ");
    return `${names} @ ${favourite.odds.toFixed(2)}`;
  }

  function manualContext(runner, favourite, bestDraw) {
    const isFavourite = favourite.runners.some((item) => item.draw === runner.draw);
    const isBestDraw = bestDraw === runner.draw;
    if (isFavourite && isBestDraw) return { label: "Fav + draw candidate", className: "strong" };
    if (isFavourite) return { label: favourite.runners.length > 1 ? "Joint-fav candidate" : "Favourite candidate", className: "favourite" };
    if (isBestDraw) return { label: "Draw candidate", className: "draw" };
    return { label: "Context only", className: "neutral" };
  }

  function decisionSettings() {
    return {
      commission: numberOr(manualEls.commission.value, 8) / 100,
      minimumEdge: numberOr(manualEls.minimumEdge.value, 5) / 100,
      bankroll: numberOr(manualEls.bankroll.value, 0),
      riskCap: numberOr(manualEls.riskCap.value, 0.5) / 100,
      evidence: manualEls.evidence.value
    };
  }

  function numberOr(input, fallback) {
    if (String(input ?? "").trim() === "") return fallback;
    const number = Number(input);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function probabilityDecimal(input) {
    const probability = Number(input);
    return Number.isFinite(probability) && probability > 0 && probability < 100 ? probability / 100 : null;
  }

  function numberInputValue(input, decimals) {
    return Number.isFinite(input) ? Number(input).toFixed(decimals) : "";
  }

  function percentText(input) {
    if (!Number.isFinite(input)) return "-";
    return `${input >= 0 ? "+" : ""}${(input * 100).toFixed(1)}%`;
  }

  function priceText(input) {
    return Number.isFinite(input) ? Number(input).toFixed(2) : "-";
  }

  function drawNumber(input) {
    const match = String(input || "").match(/(?:Box|T)\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  function distanceContext(track, input) {
    const target = normalizeDistance(input);
    if (!target) return { label: "All distances", note: track.headline };
    const exact = (track.distances || []).find((item) => normalizeDistance(item.distance) === target);
    if (exact) return { label: exact.distance, note: exact.note };
    return { label: target, note: "No distance-specific split is stored; use the overall track figures as context only." };
  }

  function normalizeDistance(input) {
    const match = String(input || "").match(/(\d{2,4})/);
    return match ? `${match[1]}m` : "";
  }

  function saveManualState() {
    const payload = {
      track: manualEls.track.value,
      distance: manualEls.distance.value,
      racecard: manualEls.racecard.value,
      runners: manualState.runners,
      settings: {
        commission: manualEls.commission.value,
        minimumEdge: manualEls.minimumEdge.value,
        bankroll: manualEls.bankroll.value,
        riskCap: manualEls.riskCap.value,
        evidence: manualEls.evidence.value
      }
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
    manualEls.commission.value = saved.settings?.commission ?? "8";
    manualEls.minimumEdge.value = saved.settings?.minimumEdge ?? "5";
    manualEls.bankroll.value = saved.settings?.bankroll ?? "";
    manualEls.riskCap.value = saved.settings?.riskCap ?? "0.5";
    manualEls.evidence.value = saved.settings?.evidence || "research";
    manualState.runners = Array.isArray(saved.runners) ? saved.runners.map((runner) => ({
      ...runner,
      backOdds: runner.backOdds ?? runner.odds ?? null,
      layOdds: runner.layOdds ?? null,
      probability: runner.probability ?? null
    })) : [];
    if (manualState.runners.length >= 2 && selectedTrack()) {
      manualEls.message.textContent = `${manualState.runners.length} runners restored.`;
      renderManualResults();
    }
  }

  function clearRace() {
    if (renderTimer) window.clearTimeout(renderTimer);
    renderTimer = null;
    manualEls.form.reset();
    manualState.runners = [];
    manualEls.message.textContent = "";
    manualEls.results.innerHTML = '<div class="race-empty">Paste a racecard to begin a price and probability assessment.</div>';
    localStorage.removeItem(storageKey);
  }

  function manualEscape(input) {
    return String(input ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
