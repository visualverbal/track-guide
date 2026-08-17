(() => {
  const connectorOrigin = ["127.0.0.1", "localhost"].includes(location.hostname)
    ? ""
    : "http://127.0.0.1:8787";

  const liveState = {
    connectorOnline: false,
    connected: false,
    demo: false,
    tracks: [],
    markets: [],
    selectedMarketId: null,
    recorderClipboardHtml: "",
    recorderSourceUrl: "",
    bookTimer: null,
    clockTimer: null,
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
    error: document.querySelector("#betfairError"),
    recorderDialog: document.querySelector("#recorderDialog"),
    recorderForm: document.querySelector("#recorderForm"),
    recorderPaste: document.querySelector("#recorderPaste"),
    recorderLink: document.querySelector("#openRecorder"),
    recorderClose: document.querySelector("#closeRecorder"),
    recorderError: document.querySelector("#recorderError")
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
    liveEls.recorderClose.addEventListener("click", () => liveEls.recorderDialog.close());
    liveEls.recorderForm.addEventListener("submit", importRecorderForm);
    liveEls.recorderPaste.addEventListener("paste", captureRecorderPaste);
    liveEls.recorderPaste.addEventListener("input", () => {
      if (!liveEls.recorderPaste.value.trim()) liveState.recorderClipboardHtml = "";
    });
    liveEls.raceDetail.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-import-recorder]");
      if (button) openRecorderImport(button.dataset.recorderUrl || "");
    });
    liveEls.raceList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-market-id]");
      if (button) selectMarket(button.dataset.marketId);
    });

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

  function openRecorderImport(sourceUrl) {
    liveState.recorderClipboardHtml = "";
    liveState.recorderSourceUrl = sourceUrl;
    liveEls.recorderPaste.value = "";
    liveEls.recorderError.textContent = "";
    liveEls.recorderLink.href = sourceUrl || "https://www.thegreyhoundrecorder.com.au/form-guides/";
    liveEls.recorderDialog.showModal();
  }

  function captureRecorderPaste(event) {
    const html = event.clipboardData?.getData("text/html") || "";
    liveState.recorderClipboardHtml = html;
  }

  async function importRecorderForm(event) {
    event.preventDefault();
    const html = liveState.recorderClipboardHtml || liveEls.recorderPaste.value;
    const submit = liveEls.recorderForm.querySelector('button[type="submit"]');
    liveEls.recorderError.textContent = "";
    submit.disabled = true;
    submit.textContent = "Checking...";
    try {
      await api("/api/recorder/import", {
        method: "POST",
        body: JSON.stringify({
          marketId: liveState.selectedMarketId,
          html,
          sourceUrl: liveState.recorderSourceUrl
        })
      });
      liveEls.recorderDialog.close();
      await loadMarketBook();
    } catch (error) {
      liveEls.recorderError.textContent = error.message;
    } finally {
      submit.disabled = false;
      submit.textContent = "Import form";
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
      renderMarket(data.catalogue || market, data.book, data.fetchedAt, data.enrichment || null);
    } catch (error) {
      liveEls.raceDetail.innerHTML = `<div class="race-empty">${liveEscape(error.message)}</div>`;
    }
  }

  function renderMarket(market, book, fetchedAt, enrichment) {
    const venue = market.event?.venue || market.event?.name || "Greyhounds";
    const guide = findGuideTrack(venue);
    const prices = new Map((book.runners || []).map((runner) => [String(runner.selectionId), runner]));
    const activeIds = new Set((book.runners || [])
      .filter((runner) => runner.status === "ACTIVE")
      .map((runner) => String(runner.selectionId)));
    const runners = [...(market.runners || [])]
      .filter((runner) => !activeIds.size || activeIds.has(String(runner.selectionId)))
      .sort((a, b) => a.sortPriority - b.sortPriority);
    const favourite = runners.reduce((best, runner) => {
      const price = bestBack(prices.get(String(runner.selectionId)));
      return price && (!best || price < best.price) ? { id: runner.selectionId, price } : best;
    }, null);

    const preparedRunners = runners.map((runner) => {
      const priceData = prices.get(String(runner.selectionId)) || {};
      const back = bestBack(priceData);
      const lay = bestLay(priceData);
      const metadata = runnerMetadata(runner);
      return {
        runner,
        priceData,
        back,
        lay,
        metadata,
        recorder: runner.recorder || null,
        actualBox: actualBoxFor(runner, market)
      };
    });
    const rankedRunners = scoreRace(preparedRunners, favourite, guide).sort((a, b) => {
      const signalDifference = b.signal.priority - a.signal.priority;
      if (signalDifference) return signalDifference;
      const scoreDifference = b.signal.score - a.signal.score;
      if (scoreDifference) return scoreDifference;
      const priceDifference = (a.back ?? Number.POSITIVE_INFINITY) - (b.back ?? Number.POSITIVE_INFINITY);
      return priceDifference || a.runner.sortPriority - b.runner.sortPriority;
    });

    const rows = rankedRunners.map(({ runner, priceData, back, lay, signal, metadata, recorder, actualBox, speedRank }, index) => {
      const comment = recorder?.comment || metadata.comment;
      return `
        <tr class="${index === 0 ? "priority-lead" : ""}">
          <td><span class="priority-rank">${index + 1}</span></td>
          <td class="box-cell">${boxHtml(recorder, actualBox)}</td>
          <td>
            <strong>${liveEscape(cleanRunnerName(runner.runnerName))}</strong>
            ${runnerMetadataHtml(metadata, comment)}
          </td>
          <td>${paceHtml(recorder, speedRank, comment)}</td>
          <td>${numberText(recorder?.rating)}</td>
          <td class="form-cell">${liveEscape(recorder?.form || "-")}</td>
          <td class="price-cell back-price">${priceText(back)}</td>
          <td class="price-cell lay-price">${priceText(lay)}</td>
          <td class="reference-price">${priceText(recorder?.ourPrice)}</td>
          <td><span class="runner-signal ${signal.className}" title="${liveEscape(signal.reason)}">${signal.label}</span></td>
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
      ${raceSummary(rankedRunners, enrichment)}
      ${enrichmentStatus(enrichment)}
      <div class="runner-table-wrap">
        <table class="runner-table">
          <thead><tr><th>Priority</th><th>Box</th><th>Greyhound</th><th>Early</th><th>Rtg</th><th>Form</th><th>Back</th><th>Lay</th><th>Our $ <span>ref</span></th><th>Signal</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="market-footer">
        <span>Market ${liveEscape(book.status || "UNKNOWN")}${book.inplay ? " | In-play" : ""}</span>
        <span>Fetched ${formatTime(fetchedAt)} | delayed data</span>
      </div>
      <p class="dog-history-note">${metadataFooter(rankedRunners, enrichment)}</p>
    `;
  }

  function raceSummary(rankedRunners, enrichment) {
    if (!rankedRunners.length) return "";
    const evidenceAvailable = ["matched", "partial"].includes(enrichment?.status);
    const intro = evidenceAvailable
      ? "Recorder form ranked with market and Track Guide context"
      : "Market and available Betfair evidence only";
    const items = rankedRunners.slice(0, 4).map(({ runner, signal }) => `
      <div class="race-summary-item ${signal.className}">
        <span>${signal.label}</span>
        <strong>${liveEscape(cleanRunnerName(runner.runnerName))}</strong>
        <small>${liveEscape(signal.reason)}</small>
      </div>
    `).join("");
    return `
      <section class="race-summary" aria-label="Race Summary">
        <div class="race-summary-head"><strong>Race Summary</strong><span>${liveEscape(intro)}</span></div>
        <div class="race-summary-list">${items}</div>
      </section>
    `;
  }

  function enrichmentStatus(enrichment) {
    if (!enrichment || enrichment.status === "not-applicable") return "";
    if (["matched", "partial"].includes(enrichment.status)) {
      const sourceLink = enrichment.sourceUrl
        ? `<a href="${liveEscape(enrichment.sourceUrl)}" target="_blank" rel="noreferrer">Greyhound Recorder</a>`
        : "Greyhound Recorder";
      return `
        <div class="enrichment-status matched">
          <strong>${liveEscape(enrichment.matchedRunners)}/${liveEscape(enrichment.betfairActiveRunners)} runners matched</strong>
          <span>Actual boxes and form from ${sourceLink}. Our $ is reference only.</span>
        </div>
      `;
    }
    const importButton = enrichment.meetingUrl
      ? `<button class="recorder-import-button" type="button" data-import-recorder data-recorder-url="${liveEscape(enrichment.meetingUrl)}">Import form</button>`
      : "";
    return `
      <div class="enrichment-status unavailable">
        <strong>Recorder form unavailable</strong>
        <span>${liveEscape(enrichment.reason || "The source could not be matched safely.")} Betfair Live Check remains active.</span>
        ${importButton}
      </div>
    `;
  }

  function guideContext(guide) {
    if (!guide) {
      return '<div class="guide-context unavailable"><strong>Track guide unavailable</strong><span>No matching track entry was found.</span></div>';
    }
    return `
      <div class="guide-context">
        <div><span>Guide</span><strong>${liveEscape(guide.strategy)}</strong></div>
        <div><span>Favourite win</span><strong>${guide.favouriteWinRate.toFixed(1)}%</strong></div>
        <div><span>Best draw</span><strong>${liveEscape(guide.bestDraw)} ${guide.bestDrawRate.toFixed(1)}%</strong></div>
        <p>${liveEscape(guide.rule)}</p>
      </div>
    `;
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

  function actualBoxFor(runner, market) {
    const value = Number(runner.recorder?.actualBox ?? runner.actualBox);
    if (Number.isInteger(value) && value >= 1 && value <= 10) return value;
    if (market.event?.countryCode === "AU") return null;
    const fallback = Number(runner.sortPriority);
    return Number.isInteger(fallback) ? fallback : null;
  }

  function scoreRace(runners, favourite, guide) {
    const speedOrder = rankedValues(runners, (item) => item.recorder?.earlySpeed);
    const ratingOrder = rankedValues(runners, (item) => item.recorder?.rating);
    const marketOrder = [...runners]
      .filter((item) => Number.isFinite(item.back))
      .sort((a, b) => a.back - b.back);
    const marketRanks = new Map(marketOrder.map((item, index) => [String(item.runner.selectionId), index + 1]));
    const drawMatch = guide?.bestDraw?.match(/(?:Box|T)\s*(\d+)/i);
    const bestDrawNumber = drawMatch ? Number(drawMatch[1]) : null;

    return runners.map((item) => {
      let score = 0;
      const evidence = [];
      const speedRank = speedOrder.get(String(item.runner.selectionId)) || null;
      const ratingRank = ratingOrder.get(String(item.runner.selectionId)) || null;
      const marketRank = marketRanks.get(String(item.runner.selectionId)) || null;
      const fieldSize = runners.length;
      const isFavourite = favourite && String(favourite.id) === String(item.runner.selectionId);
      const bestDraw = bestDrawNumber && item.actualBox === bestDrawNumber;
      const comment = item.recorder?.comment || item.metadata.comment;
      const commentView = commentEvidence(comment);

      if (speedRank) {
        if (speedRank === 1) {
          score += 4;
          evidence.push("fastest early speed");
        } else if (speedRank <= Math.max(2, Math.ceil(fieldSize / 4))) {
          score += 3;
          evidence.push(`early speed rank ${speedRank}/${speedOrder.size}`);
        } else if (speedRank <= Math.ceil(speedOrder.size / 2)) {
          score += 1;
          evidence.push(`above-median early speed`);
        } else if (speedRank === speedOrder.size) {
          score -= 2;
          evidence.push("lowest early speed");
        }
      } else {
        const pace = derivedPace(comment);
        if (pace === "FAST") {
          score += 2;
          evidence.push("comment supports early pace");
        } else if (pace === "SLOW") {
          score -= 2;
          evidence.push("comment questions early pace");
        }
      }

      if (ratingRank) {
        if (ratingRank === 1) {
          score += 3;
          evidence.push("top Recorder rating");
        } else if (ratingRank <= Math.min(3, ratingOrder.size)) {
          score += 2;
          evidence.push(`rating rank ${ratingRank}/${ratingOrder.size}`);
        } else if (ratingRank === ratingOrder.size) {
          score -= 1;
          evidence.push("lowest Recorder rating");
        }
      }

      if (marketRank === 1) {
        score += 3;
        evidence.push("market favourite");
      } else if (marketRank === 2) {
        score += 2;
        evidence.push("second in market");
      } else if (marketRank === 3) {
        score += 1;
        evidence.push("third in market");
      }

      if (bestDraw) {
        score += 2;
        evidence.push(`${guide.bestDraw} guide positive`);
      }
      if (isFavourite && /^A/.test(guide?.strategy || "")) score += 1;

      const formView = recentFormEvidence(item.recorder?.form);
      score += formView.score;
      if (formView.reason) evidence.push(formView.reason);
      score += commentView.score;
      if (commentView.reason) evidence.push(commentView.reason);

      let label;
      if (score >= 8) label = "TOP SIGNAL";
      else if (score >= 5) label = "GOOD LOOK";
      else if (score >= 1) label = "MIXED";
      else label = "CAUTION";
      if (commentView.negative && ["TOP SIGNAL", "GOOD LOOK"].includes(label)) label = "MIXED";
      if (commentView.severe && label === "MIXED" && score < 4) label = "CAUTION";

      const classes = { "TOP SIGNAL": "top-signal", "GOOD LOOK": "good-look", "MIXED": "mixed", "CAUTION": "caution" };
      const priorities = { "TOP SIGNAL": 4, "GOOD LOOK": 3, "MIXED": 2, "CAUTION": 1 };
      return {
        ...item,
        speedRank,
        signal: {
          label,
          className: classes[label],
          priority: priorities[label],
          score,
          reason: evidence.slice(0, 3).join("; ") || "Limited verified form evidence"
        }
      };
    });
  }

  function rankedValues(runners, getter) {
    const ordered = [...runners]
      .filter((item) => Number.isFinite(getter(item)))
      .sort((a, b) => getter(b) - getter(a));
    return new Map(ordered.map((item, index) => [String(item.runner.selectionId), index + 1]));
  }

  function recentFormEvidence(form) {
    const positions = String(form || "").match(/[1-8]/g)?.map(Number) || [];
    if (!positions.length) return { score: 0, reason: "" };
    const wins = positions.filter((position) => position === 1).length;
    const placings = positions.filter((position) => position <= 3).length;
    if (wins >= 2) return { score: 2, reason: "multiple recent wins" };
    if (wins || placings >= 2) return { score: 1, reason: "recent top-three form" };
    if (positions.every((position) => position >= 5)) return { score: -2, reason: "weak recent finishes" };
    return { score: 0, reason: "mixed recent form" };
  }

  function commentEvidence(comment) {
    const text = String(comment || "").toLowerCase();
    if (!text) return { score: 0, reason: "", negative: false, severe: false };
    if (/ready to end|must have|must be considered|running hot|right box|strong chance|hard to beat|should be saluting/.test(text)) {
      return { score: 2, reason: "positive form comment", negative: false, severe: false };
    }
    if (/not do enough at the jump|slow away|tardy|take (?:her|his|their) time|awkward|early pace concern/.test(text)) {
      return { score: -3, reason: "negative early-pace comment", negative: true, severe: true };
    }
    if (/doesn.t always|harder on (?:his|her|their) chances|challenge is to repeat|too risky|happy to look elsewhere|needs luck|poor form/.test(text)) {
      return { score: -2, reason: "negative form/draw comment", negative: true, severe: false };
    }
    if (/chance|consider|suited|well drawn|good beginner|quick|fast/.test(text)) {
      return { score: 1, reason: "supportive form comment", negative: false, severe: false };
    }
    return { score: 0, reason: "neutral form comment", negative: false, severe: false };
  }

  function derivedPace(comment) {
    const text = String(comment || "").toLowerCase();
    if (/good beginner|quick|fast|early pace|plenty of speed/.test(text)) return "FAST";
    if (/slow away|tardy|awkward|not do enough at the jump|take (?:her|his|their) time/.test(text)) return "SLOW";
    if (/average early|steady beginner/.test(text)) return "AVERAGE";
    return "UNKNOWN";
  }

  function paceHtml(recorder, speedRank, comment) {
    if (Number.isFinite(recorder?.earlySpeed)) {
      const rank = speedRank ? `<small>${speedRank}</small>` : "";
      return `<span class="pace-value">${numberText(recorder.earlySpeed)}${rank}</span>`;
    }
    const pace = derivedPace(comment);
    return `<span class="pace-label ${pace.toLowerCase()}">${pace}</span>`;
  }

  function boxHtml(recorder, actualBox) {
    const rug = Number(recorder?.rug);
    const reserve = Number.isInteger(rug) && rug !== actualBox;
    return `<span class="trap-number${actualBox ? "" : " unknown"}">${actualBox || "-"}</span>${reserve ? `<small class="rug-note">Rug ${rug}</small>` : ""}`;
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

  function runnerMetadataHtml(metadata, comment = "") {
    if (comment) {
      return `<span class="runner-meta comment">${liveEscape(comment)}</span>`;
    }
    if (metadata.summary.length) {
      return `<span class="runner-meta">${liveEscape(metadata.summary.join(" | "))}</span>`;
    }
    return "";
  }

  function metadataFooter(rankedRunners, enrichment) {
    if (["matched", "partial"].includes(enrichment?.status)) {
      return "Summary labels combine available evidence; they are not a claim of guaranteed profit. Recorder Our $ is shown as reference only.";
    }
    const withMetadata = rankedRunners.filter(({ metadata }) => metadata.entries.length).length;
    const withComments = rankedRunners.filter(({ metadata }) => metadata.comment).length;
    if (withComments) return `Betfair returned runner comments for ${withComments} runner${withComments === 1 ? "" : "s"}; comment keywords are folded into the signal.`;
    if (withMetadata) return `Betfair returned runner metadata for ${withMetadata} runner${withMetadata === 1 ? "" : "s"}, but no comment field was detected.`;
    return "Betfair supplied prices and runner names, but no runner metadata/comments were returned for this race.";
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

