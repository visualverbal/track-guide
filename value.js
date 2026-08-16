(function exposeValueEngine(root, factory) {
  const valueEngine = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = valueEngine;
  if (root) root.GreyhoundValue = valueEngine;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const DECISION = {
    BACK: "BACK",
    LAY: "LAY",
    NO_BET: "NO BET",
    PAPER: "PAPER ONLY"
  };

  function validOdds(value) {
    const odds = Number(value);
    return Number.isFinite(odds) && odds > 1 ? odds : null;
  }

  function validProbability(value) {
    const probability = Number(value);
    return Number.isFinite(probability) && probability > 0 && probability < 1 ? probability : null;
  }

  function boundedRate(value, fallback = 0) {
    const rate = Number(value);
    return Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 0.25) : fallback;
  }

  function backBreakEvenProbability(oddsValue, commissionValue = 0) {
    const odds = validOdds(oddsValue);
    if (!odds) return null;
    const commission = boundedRate(commissionValue);
    return 1 / (1 + (odds - 1) * (1 - commission));
  }

  function layBreakEvenProbability(oddsValue, commissionValue = 0) {
    const odds = validOdds(oddsValue);
    if (!odds) return null;
    const commission = boundedRate(commissionValue);
    return (1 - commission) / (odds - commission);
  }

  function backExpectedRoi(probabilityValue, oddsValue, commissionValue = 0) {
    const probability = validProbability(probabilityValue);
    const odds = validOdds(oddsValue);
    if (!probability || !odds) return null;
    const commission = boundedRate(commissionValue);
    return probability * (odds - 1) * (1 - commission) - (1 - probability);
  }

  function layExpectedRoiOnLiability(probabilityValue, oddsValue, commissionValue = 0) {
    const probability = validProbability(probabilityValue);
    const odds = validOdds(oddsValue);
    if (!probability || !odds) return null;
    const commission = boundedRate(commissionValue);
    const liability = odds - 1;
    const profitPerLayStake = (1 - probability) * (1 - commission) - probability * liability;
    return profitPerLayStake / liability;
  }

  function oneEighthKelly(probabilityValue, oddsValue, commissionValue = 0, side = "back") {
    const probability = validProbability(probabilityValue);
    const odds = validOdds(oddsValue);
    if (!probability || !odds) return 0;
    const commission = boundedRate(commissionValue);
    let winProbability = probability;
    let profitPerUnitRisk = (odds - 1) * (1 - commission);

    if (side === "lay") {
      winProbability = 1 - probability;
      profitPerUnitRisk = (1 - commission) / (odds - 1);
    }

    const loseProbability = 1 - winProbability;
    const fullKelly = (profitPerUnitRisk * winProbability - loseProbability) / profitPerUnitRisk;
    return Math.max(0, fullKelly / 8);
  }

  function probabilitySetStatus(values, tolerance = 0.02) {
    const probabilities = values.map(validProbability).filter((value) => value !== null);
    const total = probabilities.reduce((sum, value) => sum + value, 0);
    const complete = probabilities.length === values.length && values.length >= 2;
    const balanced = complete && Math.abs(total - 1) <= tolerance;
    return { complete, balanced, total, count: probabilities.length };
  }

  function marketProbabilities(oddsValues) {
    const raw = oddsValues.map((value) => {
      const odds = validOdds(value);
      return odds ? 1 / odds : null;
    });
    const total = raw.reduce((sum, value) => sum + (value || 0), 0);
    return raw.map((value) => value && total ? value / total : null);
  }

  function evaluate(options) {
    const probability = validProbability(options.probability);
    const commission = boundedRate(options.commission);
    const minimumEdge = Math.max(0, Number(options.minimumEdge) || 0);
    const backOdds = validOdds(options.backOdds);
    const layOdds = validOdds(options.layOdds);
    const bankroll = Math.max(0, Number(options.bankroll) || 0);
    const riskCap = Math.max(0, Number(options.riskCap) || 0);
    const result = {
      decision: DECISION.NO_BET,
      className: "no-bet",
      reason: "Model probability required",
      probability,
      fairOdds: probability ? 1 / probability : null,
      backRequired: backBreakEvenProbability(backOdds, commission),
      layMaximum: layBreakEvenProbability(layOdds, commission),
      backRoi: backExpectedRoi(probability, backOdds, commission),
      layRoi: layExpectedRoiOnLiability(probability, layOdds, commission),
      chosenRoi: null,
      stake: null,
      stakeLabel: ""
    };

    if (!probability) return result;
    if (!options.probabilitySetReady) {
      result.reason = "Complete probabilities must total about 100%";
      return result;
    }
    if (!backOdds && !layOdds) {
      result.reason = "Available price required";
      return result;
    }

    const choices = [
      { side: "back", roi: result.backRoi, odds: backOdds },
      { side: "lay", roi: result.layRoi, odds: layOdds }
    ].filter((choice) => Number.isFinite(choice.roi)).sort((a, b) => b.roi - a.roi);
    const best = choices[0];
    result.chosenRoi = best?.roi ?? null;
    if (!best || best.roi < minimumEdge) {
      result.reason = best?.roi > 0 ? "Positive edge below safety margin" : "Price does not beat fair value";
      return result;
    }

    const isValidated = options.evidence === "validated";
    result.decision = isValidated ? (best.side === "back" ? DECISION.BACK : DECISION.LAY) : DECISION.PAPER;
    result.className = isValidated ? best.side : "paper";
    result.reason = isValidated ? `${best.side === "back" ? "Back" : "Lay"} price clears the edge gate` : "Value found, but probability is not validated";

    if (isValidated && bankroll > 0 && riskCap > 0) {
      const kellyFraction = oneEighthKelly(probability, best.odds, commission, best.side);
      const fraction = Math.min(kellyFraction, riskCap);
      result.stake = bankroll * fraction;
      result.stakeLabel = best.side === "lay" ? "max liability" : "max stake";
    }
    return result;
  }

  function selectMarketDecision(results) {
    const eligible = results
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.decision !== DECISION.NO_BET && Number.isFinite(result.chosenRoi))
      .sort((a, b) => b.result.chosenRoi - a.result.chosenRoi);
    if (eligible.length <= 1) return results;
    const selectedIndex = eligible[0].index;
    return results.map((result, index) => {
      if (index === selectedIndex || result.decision === DECISION.NO_BET) return result;
      return {
        ...result,
        decision: DECISION.NO_BET,
        className: "no-bet",
        reason: "A stronger position was selected in this market",
        stake: null,
        stakeLabel: ""
      };
    });
  }

  return {
    DECISION,
    backBreakEvenProbability,
    layBreakEvenProbability,
    backExpectedRoi,
    layExpectedRoiOnLiability,
    oneEighthKelly,
    probabilitySetStatus,
    marketProbabilities,
    evaluate,
    selectMarketDecision
  };
});
