const assert = require("node:assert/strict");
const value = require("../value.js");

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not close to ${expected}`);
}

close(value.backBreakEvenProbability(2.74, 0.08), 1 / (1 + 1.74 * 0.92));
close(value.layBreakEvenProbability(2.74, 0.08), 0.92 / 2.66);
close(value.backExpectedRoi(0.4, 2.74, 0.08), 0.04032);
close(value.layExpectedRoiOnLiability(0.25, 4, 0.08), -0.02);

assert.deepEqual(value.probabilitySetStatus([0.4, 0.3, 0.2, 0.1]), {
  complete: true,
  balanced: true,
  total: 0.9999999999999999,
  count: 4
});
assert.equal(value.probabilitySetStatus([0.4, null, 0.6]).balanced, false);

const back = value.evaluate({
  probability: 0.4,
  backOdds: 2.74,
  layOdds: 2.8,
  commission: 0.08,
  minimumEdge: 0.03,
  evidence: "validated",
  probabilitySetReady: true,
  bankroll: 1000,
  riskCap: 0.005
});
assert.equal(back.decision, "BACK");
assert.ok(back.stake > 0 && back.stake <= 5);

const paper = value.evaluate({ ...back, probability: 0.4, backOdds: 2.74, layOdds: 2.8, commission: 0.08, minimumEdge: 0.03, evidence: "research", probabilitySetReady: true });
assert.equal(paper.decision, "PAPER ONLY");

const noBet = value.evaluate({ probability: 0.36, backOdds: 2.74, layOdds: 2.8, commission: 0.08, minimumEdge: 0.03, evidence: "validated", probabilitySetReady: true });
assert.equal(noBet.decision, "NO BET");

const lay = value.evaluate({ probability: 0.01, backOdds: 13, layOdds: 13.1, commission: 0.08, minimumEdge: 0.05, evidence: "validated", probabilitySetReady: true, bankroll: 1000, riskCap: 0.005 });
assert.equal(lay.decision, "LAY");
assert.ok(lay.stake > 0 && lay.stake <= 5);

const invalidSet = value.evaluate({ probability: 0.4, backOdds: 2.74, commission: 0.08, minimumEdge: 0.03, evidence: "validated", probabilitySetReady: false });
assert.equal(invalidSet.decision, "NO BET");

const selected = value.selectMarketDecision([back, lay]);
assert.equal(selected.filter((result) => result.decision !== "NO BET").length, 1);
assert.equal(selected[0].decision, "NO BET");
assert.equal(selected[1].decision, "LAY");

console.log("value engine tests passed");
