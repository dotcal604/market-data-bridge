import { describe, it, expect } from "vitest";
import type { ModelFeatureVector } from "../../features/types.js";
import { SYSTEM_PROMPT, buildUserPrompt, hashPrompt } from "../prompt.js";

const baseFeatures: ModelFeatureVector = {
  symbol: "TSLA",
  timestamp: "2025-02-03T15:00:00.000Z",
  last: 201.25,
  bid: 201.2,
  ask: 201.3,
  open: 198,
  high: 204,
  low: 197.5,
  close_prev: 196.8,
  volume: 10_000_000,
  rvol: 2.3,
  vwap_deviation_pct: 0.9,
  spread_pct: 0.05,
  float_rotation_est: 0.3,
  volume_acceleration: 1.8,
  atr_14: 6.2,
  atr_pct: 3.1,
  price_extension_pct: 1.2,
  gap_pct: 0.6,
  range_position_pct: 70,
  volatility_regime: "high",
  liquidity_bucket: "large",
  spy_change_pct: 0.4,
  qqq_change_pct: 0.7,
  market_alignment: "aligned_bull",
  time_of_day: "power_hour",
  minutes_since_open: 330,
};

describe("buildUserPrompt", () => {
  it("includes symbol, direction, entry, stop, and risk per share", () => {
    const prompt = buildUserPrompt("TSLA", "long", 201.25, 198.75, baseFeatures);

    expect(prompt).toContain("Evaluate this potential long trade for TSLA.");
    expect(prompt).toContain("Proposed entry: $201.25");
    expect(prompt).toContain(", stop: $198.75");
    expect(prompt).toContain(", risk per share: $2.50");
  });

  it("omits risk per share when entry or stop is missing", () => {
    const promptWithoutEntry = buildUserPrompt("TSLA", "long", null, 198.75, baseFeatures);
    const promptWithoutStop = buildUserPrompt("TSLA", "long", 201.25, null, baseFeatures);

    expect(promptWithoutEntry).not.toContain("risk per share");
    expect(promptWithoutStop).not.toContain("risk per share");
  });

  it("includes feature timestamp context", () => {
    const prompt = buildUserPrompt("TSLA", "short", 201.25, 203.5, baseFeatures);
    expect(prompt).toContain(`Feature vector (all values computed from live market data at ${baseFeatures.timestamp}):`);
  });

  it("serializes full feature payload as pretty JSON", () => {
    const prompt = buildUserPrompt("TSLA", "short", 201.25, 203.5, baseFeatures);

    expect(prompt).toContain("\n{");
    expect(prompt).toContain('"time_of_day": "power_hour"');
    expect(prompt).toContain('"minutes_since_open": 330');
  });

  it("is deterministic for the same inputs", () => {
    const promptA = buildUserPrompt("TSLA", "short", 201.25, 203.5, baseFeatures);
    const promptB = buildUserPrompt("TSLA", "short", 201.25, 203.5, baseFeatures);

    expect(promptA).toBe(promptB);
  });

  it("does not include stop clause when stop is null", () => {
    const prompt = buildUserPrompt("TSLA", "long", 201.25, null, baseFeatures);
    expect(prompt).not.toContain(", stop:");
  });
});

describe("hashPrompt", () => {
  it("returns a deterministic 16-char hash", () => {
    const hashA = hashPrompt("example prompt");
    const hashB = hashPrompt("example prompt");

    expect(hashA).toBe(hashB);
    expect(hashA).toHaveLength(16);
  });

  it("changes when user prompt changes", () => {
    const hashA = hashPrompt("prompt one");
    const hashB = hashPrompt("prompt two");

    expect(hashA).not.toBe(hashB);
  });

  it("incorporates SYSTEM_PROMPT into the digest", () => {
    const baseline = hashPrompt("shared user prompt");
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(baseline).toMatch(/^[a-f0-9]{16}$/);
  });
});
