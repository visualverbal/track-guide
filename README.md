# Greyhound Track & Value Guide

Static GitHub Pages site for the greyhound track notes from the ChatGPT conversation.

## Files

- `index.html` loads the page.
- `tracks.json` contains all track data, country grouping, strategy labels, source profiles and notes.
- `styles.css` controls layout and presentation.
- `app.js` renders filters, card/table views, confidence labels, starred tracks and local browser notes.
- `value.js` is the shared commission, edge, decision and staking engine.
- `betfair.js` renders the delayed Live Value interface.
- `manual.js` parses pasted racecards and runs Manual Value assessments.
- `betfair_connector.py` securely connects the local interface to Betfair.
- `start-betfair.cmd` launches the local interface on Windows.
- `tests/value.test.js` checks back, lay, probability-gate and staking calculations.

## Betfair Live Check

The Betfair API does not allow direct browser requests. Live Check therefore uses a read-only connector bound to `127.0.0.1`; it cannot accept connections from other computers.

1. Create a free Delayed App Key using the [Betfair Exchange getting-started guide](https://developer.betfair.com/get-started/exchange/).
2. Double-click `start-betfair.cmd`.
3. Open **Live check**, click **Connect**, and enter the delayed key and Betfair login.

The connector sends the login directly to Betfair over HTTPS. It never writes the username, password, app key or session token to disk. Closing the connector window clears the in-memory session. The connector exposes only market discovery and price reads; it contains no bet-placement operation.

The public GitHub Pages site cannot access a connector on the private loopback network because of browser security controls. Use the local URL opened by `start-betfair.cmd` for Live Check; the public site remains available for the standard track guide.

## Manual Check

Manual Check runs entirely in the browser and does not need Betfair or the local connector. Select a track and paste one runner per line using a box/trap number, dog name and optional decimal or fractional odds. Examples:

```text
1 Rapid Echo 2.80
Box 2 Blue Lantern 4.20
T3 Final Turn 5/1
```

The parsed names and prices remain editable. The checker identifies favourite/draw candidates and shows the stored distance context. Enter a model win probability for every runner, plus optional lay prices, to calculate commission-adjusted break-even probabilities, fair odds, expected edge and a decision.

## Value Decisions

- `NO BET` is the default.
- Runner probabilities must be complete and total between 98% and 102%.
- Track favourite/draw statistics and runner comments are context only; they never create a bet by themselves.
- The default safety margin requires at least 5% expected return after commission.
- Unverified probabilities can return `PAPER ONLY`, but never a live `BACK` or `LAY` decision.
- `BACK` and `LAY` require the probability source to be marked as a validated out-of-sample model.
- Only the strongest qualifying position is selected in each race.
- When a bankroll is supplied, staking uses one-eighth Kelly and is capped at 0.5% bankroll risk by default. Lay sizing is shown as maximum liability.

Betfair commission varies by market. Set the rate from that market's Rules before assessing value. The calculations approximate a single position; final commission is charged by Betfair on net market winnings.

## Runner Form Roadmap

The next modelling phase is to import historical runner form, sectionals, grade, days between runs and structured trouble/pace comments. It must be trained and tested chronologically, then calibrated against Betfair Starting Price before its probabilities can pass the validated-model gate. API credentials must remain in the local connector and must never be committed to this public repository.

## Data Basis

- Existing AU favourite figures from the original guide are preserved at their noted distances.
- Newly calculated AU figures use Betfair greyhound WIN BSP files from 1 January 2022 to 31 May 2025. Parklands uses its available history from 2025 through 14 August 2026.
- AU `bestDrawRate` is the winning percentage for all runners from that box, not only favourites.
- Refreshed Sheffield figures use Betfair WIN BSP files from 1 January to 14 August 2026.
- Irish figures use official Greyhound Racing Ireland results over the same 2026 period.
- A favourite is the single shortest Betfair starting price for Betfair calculations, or the single runner marked `f` in Irish results. Joint favourites are excluded.
- UK and Irish `bestDrawRate` is the win percentage when the favourite starts from that trap.

## Confidence Labels

Confidence is derived from the track sample size:

- High: at least 1,000 races.
- Medium: 300 to 999 races.
- Low: fewer than 300 races.

Each track is assigned to a key in `trackProfiles`. That key points to a reusable entry in `dataProfiles`, which supplies the source, date range, draw definition and draw label shown by the site.

## Updating Tracks

Edit `tracks.json`, then commit the change. GitHub Pages will serve the updated site after the repository is published from the `main` branch root. When adding a track, also add its name to `trackProfiles` using the most appropriate data profile.

Keep new entries in this shape:

```json
{
  "name": "Track Name",
  "country": "AU",
  "strategy": "BOX + $",
  "grade": "B",
  "headline": "Short summary.",
  "favouriteWinRate": 40.0,
  "sample": 1000,
  "wins": 400,
  "bestDraw": "Box 1",
  "bestDrawRate": 20.0,
  "rule": "Practical race-day rule.",
  "distances": [
    { "distance": "500m", "note": "Distance-specific note." }
  ],
  "notes": "Extra context."
}
```

Use `null` only when a stat is genuinely unknown; the site displays it as `TBC`.
