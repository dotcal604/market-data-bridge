import { describe, it, expect } from "vitest";
import { BayesianUpdater } from "../bayesian-updater.js";

describe("BayesianUpdater", () => {
  it("starts with uniform priors across regimes", () => {
    const updater = new BayesianUpdater();

    for (const regime of ["TRENDING", "CHOP", "VOLATILE"] as const) {
      const weights = updater.getWeights(regime);
      expect(weights.claude).toBeCloseTo(1 / 3, 5);
      expect(weights.gemini).toBeCloseTo(1 / 3, 5);
      expect(weights.openai).toBeCloseTo(1 / 3, 5);
    }
  });

  it("shifts weight toward the correct model on a winning trade", () => {
    const updater = new BayesianUpdater();

    updater.updatePriors(
      "TRENDING",
      2,
      { claude: 1, gemini: -1, openai: -1 },
      1,
    );

    const weights = updater.getWeights("TRENDING");
    expect(weights.claude).toBeGreaterThan(weights.gemini);
    expect(weights.claude).toBeGreaterThan(weights.openai);
  });

  it("does not reward losing trades and keeps relative balance when all are wrong", () => {
    const updater = new BayesianUpdater();

    updater.updatePriors(
      "CHOP",
      -1.5,
      { claude: -1, gemini: -1, openai: -1 },
      1,
    );

    const weights = updater.getWeights("CHOP");
    expect(weights.claude).toBeCloseTo(weights.gemini, 5);
    expect(weights.gemini).toBeCloseTo(weights.openai, 5);
  });

  it("multiple updates converge toward the better model", () => {
    const updater = new BayesianUpdater();

    for (let i = 0; i < 20; i += 1) {
      updater.updatePriors(
        "VOLATILE",
        1.5,
        { claude: 1, gemini: -1, openai: -1 },
        1,
      );
    }

    const weights = updater.getWeights("VOLATILE");
    expect(weights.claude).toBeGreaterThan(0.7);
    expect(weights.gemini).toBeLessThan(0.2);
    expect(weights.openai).toBeLessThan(0.2);
  });

  it("single model repeatedly right approaches full weight", () => {
    const updater = new BayesianUpdater();

    for (let i = 0; i < 40; i += 1) {
      updater.updatePriors(
        "TRENDING",
        3,
        { claude: 1, gemini: -1, openai: -1 },
        1,
      );
    }

    const weights = updater.getWeights("TRENDING");
    expect(weights.claude).toBeGreaterThan(0.9);
  });

  it("round-trips state through JSON serialization", () => {
    const updater = new BayesianUpdater();
    updater.updatePriors(
      "TRENDING",
      2,
      { claude: 1, gemini: -1, openai: -1 },
      1,
    );

    const json = updater.toJSON();
    const restored = new BayesianUpdater();
    restored.fromJSON(json);

    expect(restored.getWeights("TRENDING")).toEqual(updater.getWeights("TRENDING"));
  });

  it("falls back to default priors when hydration JSON is malformed", () => {
    const updater = new BayesianUpdater();
    updater.updatePriors(
      "TRENDING",
      2,
      { claude: 1, gemini: -1, openai: -1 },
      1,
    );

    updater.fromJSON("{not-json");

    const weights = updater.getWeights("TRENDING");
    expect(weights.claude).toBeCloseTo(1 / 3, 5);
    expect(weights.gemini).toBeCloseTo(1 / 3, 5);
    expect(weights.openai).toBeCloseTo(1 / 3, 5);
  });
});
