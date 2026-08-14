# Greyhound Track Guide

Static GitHub Pages site for the greyhound track notes from the ChatGPT conversation.

## Files

- `index.html` loads the page.
- `tracks.json` contains all track data, country grouping, strategy labels and notes.
- `styles.css` controls layout and presentation.
- `app.js` renders filters, cards, starred tracks and local browser notes.

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

Use `null` where a stat is not known yet.
