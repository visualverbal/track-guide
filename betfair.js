(() => {
  const connectorOrigin = location.hostname === "127.0.0.1" && location.port === "8787"
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

    try {
      const data = await fetch("tracks.json").then((response) => response.json());
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

    const rankedRunners = runners.map((runner) => {
      const priceData = prices.get(String(runner.selectionId)) || {};
      const back = bestBack(priceData);
      const lay = bestLay(priceData);
      const signal = runnerSignal(runner, favourite, guide);
      return { runner, priceData, back, lay, signal };
    }).sort((a, b) => {
      const signalDifference = b.signal.priority - a.signal.priority;
      if (signalDifference) return signalDifference;
      const priceDifference = (a.back ?? Number.POSITIVE_INFINITY) - (b.back ?? Number.POSITIVE_INFINITY);
      return priceDifference || a.runner.sortPriority - b.runner.sortPriority;
    });

    const rows = rankedRunners.map(({ runner, priceData, back, lay, signal }, index) => {
      return `
        <tr class="${index === 0 ? "priority-lead" : ""}">
          <td><span class="priority-rank">${index + 1}</span></td>
          <td><span class="trap-number">${liveEscape(runner.sortPriority)}</span></td>
          <td><strong>${liveEscape(cleanRunnerName(runner.runnerName))}</strong></td>
          <td class="price-cell back-price">${priceText(back)}</td>
          <td class="price-cell lay-price">${priceText(lay)}</td>
          <td>${priceText(priceData.lastPriceTraded)}</td>
          <td>${numberText(priceData.totalMatched)}</td>
          <td><span class="runner-signal ${signal.className}">${signal.label}</span></td>
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
      <div class="runner-table-wrap">
        <table class="runner-table">
          <thead><tr><th>Priority</th><th>Trap</th><th>Greyhound</th><th>Back</th><th>Lay</th><th>Last</th><th>Matched</th><th>Signal</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="market-footer">
        <span>Market ${liveEscape(book.status || "UNKNOWN")}${book.inplay ? " | In-play" : ""}</span>
        <span>Fetched ${formatTime(fetchedAt)} | delayed data</span>
      </div>
      <p class="dog-history-note">Betfair supplies prices and runner names. Dog-level form will require importing the free historical files.</p>
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

  function runnerSignal(runner, favourite, guide) {
    const drawMatch = guide?.bestDraw?.match(/(?:Box|T)\s*(\d+)/i);
    const bestDraw = drawMatch && Number(drawMatch[1]) === Number(runner.sortPriority);
    const isFavourite = favourite && String(favourite.id) === String(runner.selectionId);
    if (isFavourite && bestDraw) return { label: "Fav + draw", className: "strong", priority: 3 };
    if (isFavourite) return { label: "Favourite", className: "favourite", priority: 2 };
    if (bestDraw) return { label: "Best draw", className: "draw", priority: 1 };
    return { label: "Market price", className: "neutral", priority: 0 };
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
