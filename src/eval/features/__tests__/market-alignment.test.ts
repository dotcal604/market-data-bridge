import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeMarketAlignment } from "../market-alignment.js";

// Mock the yahoo provider
vi.mock("../../../providers/yahoo.js", () => ({
  getQuote: vi.fn(),
}));

import { getQuote } from "../../../providers/yahoo.js";

describe("computeMarketAlignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 'aligned_bull' when both SPY and QQQ are bullish and direction is long", async () => {
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "SPY") {
        return { changePercent: 1.5 } as any;
      }
      if (symbol === "QQQ") {
        return { changePercent: 2.0 } as any;
      }
      return null;
    });

    const result = await computeMarketAlignment("long");
    expect(result.spy_change_pct).toBe(1.5);
    expect(result.qqq_change_pct).toBe(2.0);
    expect(result.market_alignment).toBe("aligned_bull");
  });

  it("should return 'aligned_bear' when both SPY and QQQ are bearish and direction is short", async () => {
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "SPY") {
        return { changePercent: -1.5 } as any;
      }
      if (symbol === "QQQ") {
        return { changePercent: -2.0 } as any;
      }
      return null;
    });

    const result = await computeMarketAlignment("short");
    expect(result.spy_change_pct).toBe(-1.5);
    expect(result.qqq_change_pct).toBe(-2.0);
    expect(result.market_alignment).toBe("aligned_bear");
  });

  it("should return 'mixed' when SPY is bullish and QQQ is bearish", async () => {
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "SPY") {
        return { changePercent: 1.5 } as any;
      }
      if (symbol === "QQQ") {
        return { changePercent: -1.5 } as any;
      }
      return null;
    });

    const result = await computeMarketAlignment("long");
    expect(result.market_alignment).toBe("mixed");
  });

  it("should return 'mixed' when SPY is bearish and QQQ is bullish", async () => {
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "SPY") {
        return { changePercent: -1.5 } as any;
      }
      if (symbol === "QQQ") {
        return { changePercent: 1.5 } as any;
      }
      return null;
    });

    const result = await computeMarketAlignment("short");
    expect(result.market_alignment).toBe("mixed");
  });

  it("should return 'mixed' when markets are bullish but direction is short", async () => {
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "SPY") {
        return { changePercent: 1.5 } as any;
      }
      if (symbol === "QQQ") {
        return { changePercent: 2.0 } as any;
      }
      return null;
    });

    const result = await computeMarketAlignment("short");
    expect(result.market_alignment).toBe("mixed");
  });

  it("should return 'mixed' when markets are bearish but direction is long", async () => {
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "SPY") {
        return { changePercent: -1.5 } as any;
      }
      if (symbol === "QQQ") {
        return { changePercent: -2.0 } as any;
      }
      return null;
    });

    const result = await computeMarketAlignment("long");
    expect(result.market_alignment).toBe("mixed");
  });

  it("should return 'neutral' when changes are within threshold", async () => {
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "SPY") {
        return { changePercent: 0.1 } as any;
      }
      if (symbol === "QQQ") {
        return { changePercent: 0.15 } as any;
      }
      return null;
    });

    const result = await computeMarketAlignment("long");
    expect(result.market_alignment).toBe("neutral");
  });

  it("should use 0.2% threshold for bull/bear classification", async () => {
    // Just below threshold
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "SPY") {
        return { changePercent: 0.19 } as any;
      }
      if (symbol === "QQQ") {
        return { changePercent: 0.19 } as any;
      }
      return null;
    });

    let result = await computeMarketAlignment("long");
    expect(result.market_alignment).toBe("neutral");

    // Just above threshold
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "SPY") {
        return { changePercent: 0.21 } as any;
      }
      if (symbol === "QQQ") {
        return { changePercent: 0.21 } as any;
      }
      return null;
    });

    result = await computeMarketAlignment("long");
    expect(result.market_alignment).toBe("aligned_bull");
  });

  it("should handle null quote responses", async () => {
    vi.mocked(getQuote).mockResolvedValue(null);

    const result = await computeMarketAlignment("long");
    expect(result.spy_change_pct).toBe(0);
    expect(result.qqq_change_pct).toBe(0);
    expect(result.market_alignment).toBe("neutral");
  });

  it("should handle quote fetch errors", async () => {
    vi.mocked(getQuote).mockRejectedValue(new Error("Network error"));

    const result = await computeMarketAlignment("long");
    expect(result.spy_change_pct).toBe(0);
    expect(result.qqq_change_pct).toBe(0);
    expect(result.market_alignment).toBe("neutral");
  });

  it("should round percentages to 2 decimal places", async () => {
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "SPY") {
        return { changePercent: 1.2345 } as any;
      }
      if (symbol === "QQQ") {
        return { changePercent: 2.6789 } as any;
      }
      return null;
    });

    const result = await computeMarketAlignment("long");
    expect(result.spy_change_pct).toBe(1.23);
    expect(result.qqq_change_pct).toBe(2.68);
  });

  it("should handle one null quote response", async () => {
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "SPY") {
        return { changePercent: 1.5 } as any;
      }
      return null;
    });

    const result = await computeMarketAlignment("long");
    expect(result.spy_change_pct).toBe(1.5);
    expect(result.qqq_change_pct).toBe(0);
    // SPY is bull, QQQ is neutral (0), so mixed
    expect(result.market_alignment).toBe("neutral");
  });
});
