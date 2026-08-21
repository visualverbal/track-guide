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

const atrRunners = [
  {
    runner: { selectionId: 11, runnerName: "ATR Leader" },
    back: 3.0,
    actualBox: 6,
    recorder: { earlyRank: 1, rating: 99, ratingLabel: "Top Speed", form: "61563", comment: "" },
    metadata: { comment: "" }
  },
  {
    runner: { selectionId: 12, runnerName: "ATR Second" },
    back: 2.5,
    actualBox: 3,
    recorder: { earlyRank: 2, rating: 96, ratingLabel: "Top Speed", form: "41315", comment: "" },
    metadata: { comment: "" }
  },
  {
    runner: { selectionId: 13, runnerName: "ATR Third" },
    back: 4.0,
    actualBox: 4,
    recorder: { earlyRank: 3, rating: 98, ratingLabel: "Top Speed", form: "56122", comment: "" },
    metadata: { comment: "" }
  }
];
const atrScored = context.scoreRace(atrRunners, { id: 12, price: 2.5 }, null);
assert.equal(atrScored.find((item) => item.runner.selectionId === 11).speedRank, 1);
assert.match(atrScored.find((item) => item.runner.selectionId === 11).signal.reason, /ATR early leader/);
assert.doesNotMatch(atrScored.find((item) => item.runner.selectionId === 13).signal.reason, /lowest ranked/);

const priorityRunners = [
  {
    runner: { selectionId: 21, runnerName: "Rating Only" },
    back: 2.0,
    actualBox: 1,
    recorder: { earlySpeed: 60, rating: 100, form: "6758", comment: "" },
    metadata: { comment: "" }
  },
  {
    runner: { selectionId: 22, runnerName: "Form And Pace" },
    back: 3.2,
    actualBox: 4,
    recorder: { earlySpeed: 85, rating: 84, form: "1213", comment: "" },
    metadata: { comment: "" }
  },
  {
    runner: { selectionId: 23, runnerName: "Neutral" },
    back: 5.0,
    actualBox: 6,
    recorder: { earlySpeed: 45, rating: 70, form: "4454", comment: "" },
    metadata: { comment: "" }
  }
];
const priorityScored = context.scoreRace(priorityRunners, { id: 21, price: 2.0 }, guide);
const ratingOnly = priorityScored.find((item) => item.runner.selectionId === 21);
const formAndPace = priorityScored.find((item) => item.runner.selectionId === 22);
assert.ok(formAndPace.signal.score > ratingOnly.signal.score, "recent form and early pace must outrank rating alone");
assert.equal(formAndPace.signal.label, "TOP SIGNAL");
assert.notEqual(ratingOnly.signal.label, "TOP SIGNAL", "top rating alone must not create a top signal");

const aliasStart = source.indexOf("  function canonicalGuideTrack(");
const aliasEnd = source.indexOf("  function actualBoxFor(");
assert.ok(aliasStart >= 0 && aliasEnd > aliasStart, "guide alias functions were not found");
const aliasContext = {};
vm.createContext(aliasContext);
vm.runInContext(`${source.slice(aliasStart, aliasEnd)}\nthis.canonicalGuideTrack = canonicalGuideTrack;`, aliasContext);
assert.equal(aliasContext.canonicalGuideTrack("Valley"), "thevalley");
assert.equal(aliasContext.canonicalGuideTrack("Richmond"), "richmondloop");
assert.equal(aliasContext.canonicalGuideTrack("Monmore Green"), "monmore");
assert.equal(aliasContext.canonicalGuideTrack("Q2 Parklands"), "parklands");
assert.equal(aliasContext.canonicalGuideTrack("Murray Bridge Straight"), "murraybridge");
console.log("Race scoring validation passed.");

