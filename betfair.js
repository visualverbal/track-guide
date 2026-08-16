(() => {
  const value = window.GreyhoundValue;
  const valueSettingsKey = "greyhoundGuide.liveValueSettings";
  const connectorOrigin = ["127.0.0.1", "localhost"].includes(location.hostname) && location.port
    ? ""
    : "http://127.0.0.1:8787";

  const liveState = {
    connectorOnline: false,
    connected: false,
    demo: false,
    tracks: [],
    markets: [],
    selectedMarketId: null,
    bookTimer: null,
    clockTimer: null,
    lastBook: null,
    lastFetchedAt: null,
    estimates: {},
    valueSettings: restoreValueSettings(),
    mode: localStorage.getItem("greyhoundGuide.mode") || "guide"
  };

  const liveEls = {
    modeTabs: document.querySelector("#modeTabs"),
    guideView: document.querySelector("#guideView"),
    manualView: document.querySelector("#manualView"),
    liveView: document.querySelector("#liveView"),
    connectionStatus: document.querySelector("#connectionStatus"),
    connect: document.querySelector("#connectBetfair"),
    refresh: document.querySelector("#refreshMarkets"),
    connectorOffline: document.querySelector("#connectorOffline"),
    workspace: document.querySelector("#liveWorkspace"),
    raceWindow: document.querySelector("#raceWindow"),
    marketFreshness: document.querySelector("#marketFreshness"),
    raceList: document.querySelector("#raceList"),
    raceDetail: document.querySelector("#raceDetail"),
    dialog: document.querySelector("#betfairDialog"),
    form: document.querySelector("#betfairForm"),
    closeDialog: document.querySelector("#closeBetfair"),
    error: document.querySelector("#betfairError")
  };

  setupLiveCheck();

  async function setupLiveCheck() {
    liveEls.modeTabs.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-mode]");
      if (!button) return;
      setMode(button.dataset.mode);
    });
    liveEls.connect.addEventListener("click", handleConnectButton);
    liveEls.refresh.addEventListener("click", loadMarkets);
    liveEls.raceWindow.addEventListener("change", loadMarkets);
    liveEls.closeDialog.addEventListener("click", () => liveEls.dialog.close());
    liveEls.form.addEventListener("submit", login);
    liveEls.raceList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-market-id]");
      if (button) selectMarket(button.dataset.marketId);
    });
    liveEls.raceDetail.addEventListener("input", storeValueInput);
    liveEls.raceDetail.addEventListener("submit", assessValue);

    try {
      const data = await fetch("tracks.json", { cache: "no-store" }).then((response) => response.json());
      liveState.tracks = data.tracks || [];
    } catch (_error) {
      liveState.tracks = [];
    }

    setMode(liveState.mode, false);
    liveState.clockTimer = window.setInterval(updateCountdowns, 1000);
  }

  function setMode(mode, persist = true) {
    liveState.mode = ["guide", "manual", "live"].includes(mode) ? mode : "guide";
    if (persist) localStorage.setItem("greyhoundGuide.mode", liveState.mode);
    const showLive = liveState.mode === "live";
    liveEls.guideView.hidden = liveState.mode !== "guide";
    liveEls.manualView.hidden = liveState.mode !== "manual";
    liveEls.liveView.hidden = !showLive;
    liveEls.modeTabs.querySelectorAll("button").forEach((button) => {
      const active = button.dataset.mode === liveState.mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (showLive) checkConnector();
  }

  async function checkConnector() {
    try {
      const status = await api("/api/betfair/status");
      liveState.connectorOnline = true;
      liveState.connected = status.connected;
      liveState.demo = status.demo;
      updateConnectionUi();
      if (liveState.connected) await loadMarkets();
    } catch (_error) {
      liveState.connectorOnline = false;
      liveState.connected = false;
      updateConnectionUi();
    }
  }

  function updateConnectionUi() {
    liveEls.connectionStatus.classList.toggle("online", liveState.connected);
    liveEls.connectionStatus.classList.toggle("offline", !liveState.connected);
    if (!liveState.connectorOnline) {
      liveEls.connectionStatus.textContent = "Connector offline";
      liveEls.connect.textContent = "Start connector";
      liveEls.connectorOffline.hidden = false;
      liveEls.workspace.hidden = true;
    } else if (!liveState.connected) {
      liveEls.connectionStatus.textContent = "Not connected";
      liveEls.connect.textContent = "Connect";
      liveEls.connectorOffline.hidden = true;
      liveEls.workspace.hidden = true;
    } else {
      liveEls.connectionStatus.textContent = liveState.demo ? "Demo connected" : "Delayed feed connected";
      liveEls.connect.textContent = "Disconnect";
      liveEls.connectorOffline.hidden = true;
      liveEls.workspace.hidden = false;
    }
    liveEls.refresh.disabled = !liveState.connected;
  }

  async function handleConnectButton() {
    if (!liveState.connectorOnline) {
      window.location.href = "http://127.0.0.1:8787/";
      return;
    }
    if (!liveState.connected) {
      liveEls.error.textContent = "";
      liveEls.dialog.showModal();
      return;
    }
    await api("/api/betfair/logout", { method: "POST", body: "{}" });
    liveState.connected = false;
    liveState.markets = [];
    liveState.selectedMarketId = null;
    liveState.lastBook = null;
    liveState.lastFetchedAt = null;
    stopBookPolling();
    updateConnectionUi();
  }

  async function login(event) {
    event.preventDefault();
    liveEls.error.textContent = "";
    const submit = liveEls.form.querySelector('button[type="submit"]');
    const formData = new FormData(liveEls.form);
    const payload = Object.fromEntries(formData.entries());
    liveEls.form.elements.password.value = "";
    submit.disabled = true;
    submit.textContent = "Connecting...";
    try {
      const status = await api("/api/betfair/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      liveState.connected = status.connected;
      liveState.demo = status.demo;
      liveEls.dialog.close();
      updateConnectionUi();
      await loadMarkets();
    } catch (error) {
      liveEls.error.textContent = error.message;
    } finally {
      submit.disabled = false;
      submit.textContent = "Connect";
    }
  }

  async function loadMarkets() {
    if (!liveState.connected) return;
    liveEls.refresh.disabled = true;
    liveEls.marketFreshness.textContent = "Refreshing...";
    try {
      const minutes = liveEls.raceWindow.value;
      const data = await api(`/api/betfair/markets?minutes=${minutes}`);
      const now = Date.now() - 60_000;
      liveState.markets = (data.markets || []).filter((market) => Date.parse(market.marketStartTime) >= now);
      liveEls.marketFreshness.textContent = `Updated ${formatTime(data.fetchedAt)}`;
      renderMarketList();
      const current = liveState.markets.find((market) => market.marketId === liveState.selectedMarketId);
      if (current) {
        await selectMarket(current.marketId);
      } else if (liveState.markets.length) {
        await selectMarket(liveState.markets[0].marketId);
      } else {
        liveState.selectedMarketId = null;
        liveState.lastBook = null;
        liveState.lastFetchedAt = null;
        stopBookPolling();
        liveEls.raceDetail.innerHTML = '<div class="race-empty">No greyhound WIN markets in this window.</div>';
      }
    } catch (error) {
      liveEls.marketFreshness.textContent = "Update failed";
      liveEls.raceList.innerHTML = `<div class="race-empty">${liveEscape(error.message)}</div>`;
    } finally {
      liveEls.refresh.disabled = !liveState.connected;
    }
  }

  function renderMarketList() {
    if (!liveState.markets.length) {
      liveEls.raceList.innerHTML = '<div class="race-empty compact">No races found.</div>';
      return;
    }
    liveEls.raceList.innerHTML = liveState.markets.map((market) => {
      const selected = market.marketId === liveState.selectedMarketId;
      const venue = market.event?.venue || market.event?.name || "Greyhounds";
      return `
        <button type="button" class="race-list-item${selected ? " active" : ""}" data-market-id="${liveEscape(market.marketId)}">
          <span class="race-list-top"><strong>${liveEscape(venue)}</strong><time>${formatTime(market.marketStartTime)}</time></span>
          <span>${liveEscape(market.marketName)}</span>
          <span class="race-countdown" data-start="${liveEscape(market.marketStartTime)}">${countdown(market.marketStartTime)}</span>
        </button>
      `;
    }).join("");
  }

  async function selectMarket(marketId) {
    const market = liveState.markets.find((item) => item.marketId === marketId);
    if (!market) return;
    liveState.selectedMarketId = marketId;
    renderMarketList();
    liveEls.raceDetail.innerHTML = '<div class="race-empty">Loading market...</div>';
    stopBookPolling();
    await loadMarketBook();
    liveState.bookTimer = window.setInterval(loadMarketBook, 20_000);
  }

  async function loadMarketBook() {
    const market = liveState.markets.find((item) => item.marketId === liveState.selectedMarketId);
    if (!market || !liveState.connected) return;
    try {
      const query = new URLSearchParams({ marketId: market.marketId, exchange: market.exchange });
      const data = await api(`/api/betfair/market?${query}`);
      liveState.lastBook = data.book;
      liveState.lastFetchedAt = data.fetchedAt;
      renderMarket(market, data.book, data.fetchedAt);
    } catch (error) {
      liveEls.raceDetail.innerHTML = `<div class="race-empty">${liveEscape(error.message)}</div>`;
    }
  }

  function renderMarket(market, book, fetchedAt) {
    const venue = market.event?.venue || market.event?.name || "Greyhounds";
    const guide = findGuideTrack(venue);
    const prices = new Map((book.runners || []).map((runner) => [String(runner.selectionId), runner]));
    const runners = [...(market.runners || [])].sort((a, b) => a.sortPriority - b.sortPriority);
    const favourite = runners.reduce((best, runner) => {
      const price = bestBack(prices.get(String(runner.selectionId)));
      return price && (!best || price < best.price) ? { id: runner.selectionId, price } : best;
    }, null);
    const marketProbabilities = value.marketProbabilities(runners.map((runner) => bestBack(prices.get(String(runner.selectionId)))));
    const estimates = liveState.estimates[market.marketId] || {};
    const probabilityStatus = value.probabilitySetStatus(runners.map((runner) => probabilityDecimal(estimates[runner.selectionId])));
    const settings = liveDecisionSettings();
    let assessedRunners = runners.map((runner, index) => {
      const priceData = prices.get(String(runner.selectionId)) || {};
      const back = bestBack(priceData);
      const lay = bestLay(priceData);
      const metadata = runnerMetadata(runner);
      const context = runnerContext(runner, favourite, guide, metadata);
      const assessment = value.evaluate({
        probability: probabilityDecimal(estimates[runner.selectionId]),
        backOdds: back,
        layOdds: lay,
        probabilitySetReady: probabilityStatus.balanced,
        ...settings
      });
      return { runner, priceData, back, lay, context, metadata, assessment, marketProbability: marketProbabilities[index] };
    });
    const selectedAssessments = value.selectMarketDecision(assessedRunners.map(({ assessment }) => assessment));
    assessedRunners = assessedRunners.map((item, index) => ({ ...item, assessment: selectedAssessments[index] }));
    const decisions = assessedRunners.filter(({ assessment }) => assessment.decision !== value.DECISION.NO_BET).length;

    const rows = assessedRunners.map(({ runner, priceData, back, lay, context, metadata, assessment, marketProbability }) => {
      return `
        <tr>
          <td><span class="trap-number">${liveEscape(runner.sortPriority)}</span></td>
          <td>
            <strong>${liveEscape(cleanRunnerName(runner.runnerName))}</strong>
            ${runnerMetadataHtml(metadata)}
          </td>
          <td class="price-cell back-price">${priceText(back)}<small>${Number.isFinite(assessment.backRequired) ? `Needs ${(assessment.backRequired * 100).toFixed(1)}%` : "-"} | Market ${percentText(marketProbability, false)}</small></td>
          <td class="price-cell lay-price">${priceText(lay)}<small>${Number.isFinite(assessment.layMaximum) ? `Lay below ${(assessment.layMaximum * 100).toFixed(1)}%` : "-"}</small></td>
          <td><input class="live-probability-input" data-model-selection="${liveEscape(runner.selectionId)}" type="number" min="0.1" max="99.9" step="0.1" value="${numberInputValue(estimates[runner.selectionId], 1)}" placeholder="-" aria-label="${liveEscape(cleanRunnerName(runner.runnerName))} model win percentage"></td>
          <td>${priceText(assessment.fairOdds)}</td>
          <td class="edge-cell ${edgeClass(assessment.chosenRoi)}">${percentText(assessment.chosenRoi)}</td>
          <td>${decisionHtml(assessment)}</td>
          <td><span class="runner-signal ${context.className}">${context.label}</span></td>
          <td><span class="market-secondary">Last ${priceText(priceData.lastPriceTraded)}<br>${numberText(priceData.totalMatched)} matched</span></td>
        </tr>
      `;
    }).join("");

    liveEls.raceDetail.innerHTML = `
      <div class="race-detail-head">
        <div>
          <p class="eyebrow">${liveEscape(market.exchange.toUpperCase())} exchange | delayed</p>
          <h2>${liveEscape(venue)} <span>${liveEscape(market.marketName)}</span></h2>
        </div>
        <div class="race-time-block">
          <time>${formatTime(market.marketStartTime)}</time>
          <strong data-start="${liveEscape(market.marketStartTime)}">${countdown(market.marketStartTime)}</strong>
        </div>
      </div>
      ${guideContext(guide)}
      ${valueControls()}
      <div class="decision-progress" aria-label="Assessment status">
        ${progressItem("Race", `${runners.length} runners`, true)}
        ${progressItem("Probabilities", probabilityStatusText(probabilityStatus, runners.length), probabilityStatus.balanced)}
        ${progressItem("Costs", `${(settings.commission * 100).toFixed(1)}% commission`, true)}
        ${progressItem("Decision", decisions ? `${decisions} value ${decisions === 1 ? "case" : "cases"}` : "No bet", decisions > 0)}
      </div>
      <div class="runner-table-wrap">
        <table class="runner-table live-runner-table">
          <thead><tr><th>Trap</th><th>Greyhound</th><th>Back</th><th>Lay</th><th>Model %</th><th>Fair</th><th>Edge</th><th>Decision</th><th>Context</th><th>Market</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="market-footer">
        <span>Market ${liveEscape(book.status || "UNKNOWN")}${book.inplay ? " | In-play" : ""}</span>
        <span>Fetched ${formatTime(fetchedAt)} | delayed data</span>
      </div>
      <p class="dog-history-note">${metadataFooter(assessedRunners)}</p>
    `;
  }

  function valueControls() {
    const settings = liveState.valueSettings;
    return `
      <form class="value-controls" data-value-form>
        <label><span>Commission</span><span class="input-suffix"><input data-live-setting="commission" type="number" min="0" max="25" step="0.1" value="${settingInputValue(settings.commission, 1)}"><em>%</em></span></label>
        <label><span>Minimum edge</span><span class="input-suffix"><input data-live-setting="minimumEdge" type="number" min="0" max="50" step="0.5" value="${settingInputValue(settings.minimumEdge, 1)}"><em>%</em></span></label>
        <label><span>Bankroll <small>optional</small></span><span class="input-prefix"><em>$</em><input data-live-setting="bankroll" type="number" min="0" step="10" value="${numberInputValue(settings.bankroll, 0)}" placeholder="-"></span></label>
        <label><span>Maximum risk</span><span class="input-suffix"><input data-live-setting="riskCap" type="number" min="0" max="5" step="0.1" value="${settingInputValue(settings.riskCap, 1)}"><em>%</em></span></label>
        <label class="value-evidence"><span>Probability evidence</span><select data-live-setting="evidence"><option value="research"${settings.evidence === "research" ? " selected" : ""}>Research / unverified</option><option value="validated"${settings.evidence === "validated" ? " selected" : ""}>Validated out-of-sample model</option></select></label>
        <button class="primary-button" type="submit">Assess value</button>
      </form>
    `;
  }

  function storeValueInput(event) {
    const setting = event.target.closest("[data-live-setting]");
    if (setting) {
      liveState.valueSettings[setting.dataset.liveSetting] = setting.value;
      localStorage.setItem(valueSettingsKey, JSON.stringify(liveState.valueSettings));
      return;
    }
    const probability = event.target.closest("[data-model-selection]");
    if (!probability || !liveState.selectedMarketId) return;
    liveState.estimates[liveState.selectedMarketId] ||= {};
    const number = Number(probability.value);
    liveState.estimates[liveState.selectedMarketId][probability.dataset.modelSelection] = Number.isFinite(number) && number > 0 && number < 100 ? number : null;
  }

  function assessValue(event) {
    if (!event.target.matches("[data-value-form]")) return;
    event.preventDefault();
    const market = liveState.markets.find((item) => item.marketId === liveState.selectedMarketId);
    if (market && liveState.lastBook) renderMarket(market, liveState.lastBook, liveState.lastFetchedAt);
  }

  function liveDecisionSettings() {
    return {
      commission: numberOr(liveState.valueSettings.commission, 8) / 100,
      minimumEdge: numberOr(liveState.valueSettings.minimumEdge, 5) / 100,
      bankroll: numberOr(liveState.valueSettings.bankroll, 0),
      riskCap: numberOr(liveState.valueSettings.riskCap, 0.5) / 100,
      evidence: liveState.valueSettings.evidence === "validated" ? "validated" : "research"
    };
  }

  function restoreValueSettings() {
    try {
      return { commission: "8", minimumEdge: "5", bankroll: "", riskCap: "0.5", evidence: "research", ...JSON.parse(localStorage.getItem(valueSettingsKey) || "{}") };
    } catch (_error) {
      localStorage.removeItem(valueSettingsKey);
      return { commission: "8", minimumEdge: "5", bankroll: "", riskCap: "0.5", evidence: "research" };
    }
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
    const number = Number(input);
    return Number.isFinite(number) && number > 0 ? number.toFixed(decimals) : "";
  }

  function settingInputValue(input, decimals) {
    const number = Number(input);
    return Number.isFinite(number) && number >= 0 ? number.toFixed(decimals) : "";
  }

  function progressItem(label, text, ready) {
    return `<div class="${ready ? "ready" : "waiting"}"><span>${label}</span><strong>${liveEscape(text)}</strong></div>`;
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
    return `<span class="value-decision ${assessment.className}" title="${liveEscape(assessment.reason)}">${assessment.decision}</span>${stake}`;
  }

  function edgeClass(edge) {
    if (!Number.isFinite(edge)) return "";
    return edge > 0 ? "positive" : "negative";
  }

  function percentText(input, signed = true) {
    if (!Number.isFinite(input)) return "-";
    return `${signed && input >= 0 ? "+" : ""}${(input * 100).toFixed(1)}%`;
  }

  function guideContext(guide) {
    if (!guide) {
      return '<div class="guide-context unavailable"><strong>Track guide unavailable</strong><span>No matching track entry was found.</span></div>';
    }
    return `
      <div class="guide-context">
        <div><span>Track profile</span><strong>${liveEscape(liveProfileLabel(guide.strategy))}</strong></div>
        <div><span>Historical fav win</span><strong>${guide.favouriteWinRate.toFixed(1)}%</strong></div>
        <div><span>Historical draw</span><strong>${liveEscape(guide.bestDraw)} ${guide.bestDrawRate.toFixed(1)}%</strong></div>
        <p><strong>Context only.</strong> ${liveEscape(guide.rule)}</p>
      </div>
    `;
  }

  function liveProfileLabel(strategy) {
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

  function findGuideTrack(venue) {
    const target = normalizeTrack(venue);
    const aliases = {
      richmond: "richmondloop",
      monmoregreen: "monmore",
      valley: "thevalley"
    };
    const expected = aliases[target] || target;
    return liveState.tracks.find((track) => {
      const name = normalizeTrack(track.name);
      return name === expected || name.includes(expected) || expected.includes(name);
    }) || null;
  }

  function normalizeTrack(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/greyhounds?|dogs?/g, "")
      .replace(/[^a-z0-9]+/g, "");
  }

  function runnerContext(runner, favourite, guide, metadata = {}) {
    const drawMatch = guide?.bestDraw?.match(/(?:Box|T)\s*(\d+)/i);
    const bestDraw = drawMatch && Number(drawMatch[1]) === Number(runner.sortPriority);
    const isFavourite = favourite && String(favourite.id) === String(runner.selectionId);
    const comment = commentSignal(metadata.comment);
    if (comment?.className === "caution") return { label: isFavourite ? "Fav candidate | caution" : comment.label, className: "caution" };
    if (isFavourite && bestDraw) return { label: "Fav + draw candidate", className: "strong" };
    if (isFavourite) return { label: "Favourite candidate", className: "favourite" };
    if (bestDraw) return { label: "Draw candidate", className: "draw" };
    if (comment) return { label: comment.label, className: comment.className };
    return { label: "Context only", className: "neutral" };
  }

  function runnerMetadata(runner) {
    const metadata = runner?.metadata && typeof runner.metadata === "object" ? runner.metadata : {};
    const entries = Object.entries(metadata)
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
      .map(([key, value]) => [String(key), String(value).trim()]);
    const comment = metadataComment(entries);
    const summary = entries
      .filter(([key]) => !comment || !comment.keys.includes(key))
      .slice(0, 3)
      .map(([key, value]) => `${readableMetadataKey(key)}: ${value}`);
    return { entries, comment: comment?.text || "", summary };
  }

  function metadataComment(entries) {
    const commentKeys = [
      "COMMENT",
      "COMMENTS",
      "COMMENTARY",
      "RUN_COMMENT",
      "RUNNER_COMMENT",
      "SELECTION_COMMENT",
      "FORM_COMMENT",
      "RACE_COMMENT",
      "VERDICT"
    ];
    const matches = entries.filter(([key]) => commentKeys.includes(key.toUpperCase()) || /COMMENT|VERDICT|PREVIEW/i.test(key));
    if (!matches.length) return null;
    return {
      keys: matches.map(([key]) => key),
      text: matches.map(([, value]) => value).join(" ")
    };
  }

  function runnerMetadataHtml(metadata) {
    if (metadata.comment) {
      return `<span class="runner-meta comment">${liveEscape(metadata.comment)}</span>`;
    }
    if (metadata.summary.length) {
      return `<span class="runner-meta">${liveEscape(metadata.summary.join(" | "))}</span>`;
    }
    return "";
  }

  function metadataFooter(rankedRunners) {
    const withMetadata = rankedRunners.filter(({ metadata }) => metadata.entries.length).length;
    const withComments = rankedRunners.filter(({ metadata }) => metadata.comment).length;
    if (withComments) return `Betfair returned runner comments for ${withComments} runner${withComments === 1 ? "" : "s"}. They are shown as evidence notes and never create a bet decision by themselves.`;
    if (withMetadata) return `Betfair returned runner metadata for ${withMetadata} runner${withMetadata === 1 ? "" : "s"}, but no comment field was detected.`;
    return "Betfair supplied prices and runner names, but no runner metadata/comments were returned for this race.";
  }

  function commentSignal(comment) {
    const text = String(comment || "").toLowerCase();
    if (!text) return null;
    if (/\b(slow|awkward|miss(?:ed)?|crowd|checked|bump|trouble|needs luck|risky|wide from inside|inside from wide)\b/.test(text)) {
      return { label: "Comment caution", shortLabel: "caution", className: "caution" };
    }
    if (/\b(quick|fast|early pace|good beginner|clear run|drops? in grade|well drawn|suited|strong chance|hard to beat)\b/.test(text)) {
      return { label: "Positive comment", shortLabel: "comment", className: "comment" };
    }
    return { label: "Comment note", shortLabel: "note", className: "comment" };
  }

  function readableMetadataKey(key) {
    return key.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function bestBack(runner) {
    return runner?.ex?.availableToBack?.[0]?.price || null;
  }

  function bestLay(runner) {
    return runner?.ex?.availableToLay?.[0]?.price || null;
  }

  function cleanRunnerName(name) {
    return String(name || "").replace(/^\d+\.\s*/, "");
  }

  function priceText(value) {
    return Number.isFinite(value) ? Number(value).toFixed(2) : "-";
  }

  function numberText(value) {
    return Number.isFinite(value) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "-";
  }

  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "-" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function countdown(value) {
    const difference = Date.parse(value) - Date.now();
    if (!Number.isFinite(difference)) return "-";
    if (difference <= -60_000) return "Started";
    if (difference <= 0) return "Due now";
    const totalSeconds = Math.ceil(difference / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function updateCountdowns() {
    document.querySelectorAll("[data-start]").forEach((element) => {
      element.textContent = countdown(element.dataset.start);
    });
  }

  function stopBookPolling() {
    if (liveState.bookTimer) window.clearInterval(liveState.bookTimer);
    liveState.bookTimer = null;
  }

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(`${connectorOrigin}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) }
      });
    } catch (_error) {
      throw new Error("Local connector is not running.");
    }
    let payload = {};
    try {
      payload = await response.json();
    } catch (_error) {
      throw new Error("Connector returned an invalid response.");
    }
    if (!response.ok) throw new Error(payload.error || `Connector error ${response.status}`);
    return payload;
  }

  function liveEscape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
