# Greyhound Track Guide

Static GitHub Pages site for the greyhound track notes from the ChatGPT conversation.

## Files

- `index.html` loads the page.
- `tracks.json` contains all track data, country grouping, strategy labels and notes.
- `styles.css` controls layout and presentation.
- `app.js` renders filters, cards, starred tracks and local browser notes.

## Data Basis

- Existing AU favourite figures from the original guide are preserved at their noted distances.
- Newly calculated AU figures use Betfair greyhound WIN BSP files from 1 January 2022 to 31 May 2025. Parklands uses its available history from 2025 through 14 August 2026.
- AU `bestDrawRate` is the winning percentage for all runners from that box, not only favourites.
- Refreshed Sheffield figures use Betfair WIN BSP files from 1 January to 14 August 2026.
- Irish figures use official Greyhound Racing Ireland results over the same 2026 period.
- A favourite is the single shortest Betfair starting price for Betfair calculations, or the single runner marked `f` in Irish results. Joint favourites are excluded.
- UK and Irish `bestDrawRate` is the win percentage when the favourite starts from that trap.

## Updating Tracks

Edit `tracks.json`, then commit the change. GitHub Pages will serve the updated site after the repository is published from the `main` branch root.

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
