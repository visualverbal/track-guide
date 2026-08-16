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
      liveEls.connect.textConte…5473 tokens truncated…e
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
