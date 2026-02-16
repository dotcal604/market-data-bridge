import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearQuoteCache, getQuote, isStale, updateQuote } from "../market-cache.js";

describe("market-cache", () => {
  beforeEach(() => {
    clearQuoteCache();
  });

  it("stores and returns quote snapshots by symbol", () => {
    updateQuote("aapl", { bid: 199.5, ask: 199.7, last: 199.6, volume: 12345, timestamp: 1700000000000 });

    expect(getQuote("AAPL")).toEqual({
      bid: 199.5,
      ask: 199.7,
      last: 199.6,
      volume: 12345,
      timestamp: 1700000000000,
    });
  });

  it("updates only the provided fields while preserving existing values", () => {
    updateQuote("MSFT", { bid: 400, ask: 401, timestamp: 1700000000000 });
    updateQuote("MSFT", { last: 400.5, timestamp: 1700000005000 });

    expect(getQuote("MSFT")).toEqual({
      bid: 400,
      ask: 401,
      last: 400.5,
      timestamp: 1700000005000,
    });
  });

  it("reports staleness based on max age and missing symbols", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

    updateQuote("NVDA", { last: 1000, timestamp: Date.now() });
    expect(isStale("NVDA", 1000)).toBe(false);

    vi.advanceTimersByTime(2000);
    expect(isStale("NVDA", 1000)).toBe(true);
    expect(isStale("UNKNOWN", 1000)).toBe(true);

    vi.useRealTimers();
  });
});
