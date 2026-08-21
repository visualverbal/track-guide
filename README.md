# Greyhound Track Guide

Static GitHub Pages site for the greyhound track notes from the ChatGPT conversation.

## Files

- `index.html` loads the page.
- `tracks.json` contains all track data, country grouping, strategy labels, source profiles and notes.
- `styles.css` controls layout and presentation.
- `app.js` renders filters, card/table views, confidence labels, starred tracks and local browser notes.
- `betfair.js` renders the delayed Live Check interface.
- `manual.js` parses pasted racecards and compares price/draw signals with the guide.
- `betfair_connector.py` securely connects the local interface to Betfair.
- `recorder_enrichment.py` locates, validates and caches Australian Greyhound Recorder long-form cards.
- `atr_enrichment.py` locates, validates and caches British/Irish At The Races cards.
- `browser_fetcher.py` renders form pages in a hidden installed Edge or Chrome browser when HTTP is blocked.
- `start-betfair.cmd` launches the local interface on Windows.

## Betfair Live Check

The Betfair API does not allow direct browser requests. Live Check therefore uses a read-only connector bound to `127.0.0.1`; it cannot accept connections from other computers.

1. Create a free Delayed App Key using the [Betfair Exchange getting-started guide](https://developer.betfair.com/get-started/exchange/).
2. Double-click `start-betfair.cmd`.
3. Open **Live check**, click **Connect**, and enter the delayed key and Betfair login.

The connector sends the login directly to Betfair over HTTPS. It never writes the username, password, app key or session token to disk. Closing the connector window clears the in-memory session. The connector exposes only market discovery and price reads; it contains no bet-placement operation.

The public GitHub Pages site cannot access a connector on the private loopback network because of browser security controls. Use the local URL opened by `start-betfair.cmd` for Live Check; the public site remains available for the standard track guide.

### Greyhound Recorder enrichment

For Australian races, the connector attempts to match the Betfair market to a Greyhound Recorder long-form card using venue, local date, race number, start time, distance and normalized runner-name overlap. A successful match adds the actual rug/box, Early Speed, Rating, Form, Comment and Recorder `Our $` reference. It never treats Betfair `sortPriority` as an Australian box.

Each validated racecard is stored in `.recorder-cache/` and reused during polling, so Live Check does not refetch form on every price update. The connector first tries normal HTTP and silently renders the page in an installed Edge or Chrome browser if Recorder returns HTTP 403. Low-confidence matches, changed source markup and source/network failures return an unavailable status while Betfair prices continue to work. Recorder `Our $` is reference data only; the Race Summary is an evidence label, not a profitability claim.

If both automatic methods fail, **Advanced fallback** remains available. Open the linked Recorder meeting, choose the selected race's long-form page, copy the complete webpage and paste it into the fallback dialog. The connector applies the same venue, date, race number, distance, start-time and runner-overlap validation before using or caching the copied card. A wrong or low-confidence card is rejected without affecting Betfair Live Check.

The local connector must be restarted after connector code changes. Betfair credentials and copied page content remain on the local computer and are not published to GitHub Pages.

### At The Races enrichment

For British and Irish races, Live Check uses [At The Races Greyhounds](https://greyhounds.attheraces.com/) as the optional form source. It first tries the normal HTTP page, then silently renders ATR in an installed Edge or Chrome browser when the HTTP response contains only the app shell. The match verifies venue, local date, race number, start time, distance and normalized runner-name overlap before adding actual trap, recent Form, Top Speed, Expert View and Quick Form. Each validated card is stored once in `.atr-cache/`, so polling only refreshes Betfair prices.

ATR Top Speed is displayed as a supporting performance rating; it is not presented as Early Speed. The Early column only uses ATR's explicit **Early Leaders** race angle or supported comment evidence. If both automatic methods fail, **Advanced fallback** accepts either copied ATR webpage HTML or flattened page text. Flattened text does not need to preserve the page heading, but it must come from the exact selected race URL and still pass distance and runner-overlap checks. A failed or low-confidence match leaves Betfair prices and the existing Live Check working.

### Race Summary priority

Race Summary ranks available evidence in this order: recent form, early speed, verified box/trap context, market rank, then rating. Expert comments act as a qualitative check and can downgrade a superficially strong runner. A top rating by itself cannot create a **Top Signal**, and the summary does not use the former value calculator or claim a profitable bet.

## Manual Check

Manual Check runs entirely in the browser and does not need Betfair or the local connector. Select a track and paste one runner per line using a box/trap number, dog name and optional decimal or fractional odds. Examples:

```text
1 Rapid Echo 2.80
Box 2 Blue Lantern 4.20
T3 Final Turn 5/1
```

The parsed names and odds remain editable. The checker identifies the favourite or joint favourites, highlights the guide's strongest draw and shows any stored distance-specific note. The current version compares race price/draw information with track-level statistics; it does not yet contain dog-level historical form.

## Data Basis

- Existing AU favourite figures from the original guide are preserved at their noted distances.
- Newly calculated AU figures use Betfair greyhound WIN BSP files from 1 January 2022 to 31 May 2025. Parklands uses its available history from 2025 through 14 August 2026.
- AU `bestDrawRate` is the winning percentage for all runners from that box, not only favourites.
- Refreshed Sheffield figures use Betfair WIN BSP files from 1 January to 14 August 2026.
- Irish figures use official Greyhound Racing Ireland results over the same 2026 period. Kilkenny uses 398 single favourites from 57 meetings; all qualifying races were over 525 yards.
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

