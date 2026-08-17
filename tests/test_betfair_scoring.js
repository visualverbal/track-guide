const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("betfair.js", "utf8");
const start = source.indexOf("  function scoreRace(");
const end = source.indexOf("  function runnerMetadata(");
assert.ok(start >= 0 && end > start, "scoring functions were not found");

const context = {};
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}\nthis.scoreRace = scoreRace;`, context);

const runners = [
  {
    runner: { selectionId: 1, runnerName: "Negative Favourite" },
    back: 2.0,
    actualBox: 1,
    recorder: {
      earlySpeed: 40,
      rating: 100,
      form: "7777",
      comment: "Might not do enough at the jump to go with them."
    },
    metadata: { comment: "" }
  },
  {
    runner: { selectionId: 2, runnerName: "Fast Runner" },
    back: 3.0,
    actualBox: 4,
    recorder: {
      earlySpeed: 86,
      rating: 90,
      form: "1515",
      comment: "In the right box to get plenty of attention. Chance."
    },
    metadata: { comment: "" }
  },
  {
    runner: { selectionId: 3, runnerName: "Other Runner" },
    back: 5.0,
    actualBox: 8,
    recorder: { earlySpeed: 60, rating: 70, form: "4564", comment: "" },
    metadata: { comment: "" }
  }
];
const guide = { bestDraw: "Box 1", strategy: "A+ FOLLOW" };
const scored = context.scoreRace(runners, { id: 1, price: 2.0 }, guide);
const favourite = scored.find((item) => item.runner.selectionId === 1);
const fastest = scored.find((item) => item.runner.selectionId === 2);

assert.equal(favourite.signal.label, "CAUTION", "negative pace/form must downgrade the favourite");
assert.equal(fastest.speedRank, 1, "numeric Early Speed must be ranked within the race");
assert.match(fastest.signal.label, /TOP SIGNAL|GOOD LOOK/);
console.log("Race scoring validation passed.");
