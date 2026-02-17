import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchOrderBookFeatures,
  augmentEvaluationWithOrderBook,
} from "../orderbook-integration.js";

// Mock the IBKR modules
vi.mock("../../../ibkr/connection.js", () => ({
  isConnected: vi.fn(),
}));

vi.mock("../../../ibkr/marketdata.js", () => ({
  getMarketDepth: vi.fn(),
}));

vi.mock("../../../logging.js", () => ({
  logger: {
    child: vi.fn(() => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

// Import mocked functions
import { isConnected } from "../../../ibkr/connection.js";
import { getMarketDepth } from "../../../ibkr/marketdata.js";

describe("fetchOrderBookFeatures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return null when IBKR is not connected", async () => {
    vi.mocked(isConnected).mockReturnValue(false);

    const result = await fetchOrderBookFeatures("AAPL");

    expect(result).toBeNull();
    expect(isConnected).toHaveBeenCalled();
    expect(getMarketDepth).not.toHaveBeenCalled();
  });

  it("should return order book features when IBKR is connected", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "AAPL",
      bids: [
        { price: 150.50, size: 1000 },
        { price: 150.49, size: 800 },
      ],
      asks: [
        { price: 150.51, size: 500 },
        { price: 150.52, size: 600 },
      ],
      timestamp: 1234567890,
    });

    const result = await fetchOrderBookFeatures("AAPL");

    expect(result).not.toBeNull();
    expect(result?.obi).toBeCloseTo(0.333, 3); // (1000-500)/(1000+500)
    expect(result?.wobi).toBeDefined();
    expect(result?.timestamp).toBe(1234567890);
  });

  it("should use default depth of 10", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "AAPL",
      bids: [{ price: 150.50, size: 1000 }],
      asks: [{ price: 150.51, size: 1000 }],
      timestamp: Date.now(),
    });

    await fetchOrderBookFeatures("AAPL");

    expect(getMarketDepth).toHaveBeenCalledWith("AAPL", 10, 5000);
  });

  it("should use custom depth parameter", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "AAPL",
      bids: [{ price: 150.50, size: 1000 }],
      asks: [{ price: 150.51, size: 1000 }],
      timestamp: Date.now(),
    });

    await fetchOrderBookFeatures("AAPL", 5);

    expect(getMarketDepth).toHaveBeenCalledWith("AAPL", 5, 5000);
  });

  it("should return null when getMarketDepth fails", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockRejectedValue(new Error("Market data timeout"));

    const result = await fetchOrderBookFeatures("AAPL");

    expect(result).toBeNull();
  });

  it("should calculate positive OBI for bid-heavy order book", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "TSLA",
      bids: [{ price: 200.00, size: 5000 }],
      asks: [{ price: 200.10, size: 1000 }],
      timestamp: Date.now(),
    });

    const result = await fetchOrderBookFeatures("TSLA");

    expect(result?.obi).toBeCloseTo(0.667, 3); // (5000-1000)/(5000+1000)
  });

  it("should calculate negative OBI for ask-heavy order book", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "NVDA",
      bids: [{ price: 500.00, size: 1000 }],
      asks: [{ price: 500.10, size: 5000 }],
      timestamp: Date.now(),
    });

    const result = await fetchOrderBookFeatures("NVDA");

    expect(result?.obi).toBeCloseTo(-0.667, 3); // (1000-5000)/(1000+5000)
  });

  it("should calculate zero OBI for balanced order book", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "SPY",
      bids: [{ price: 450.00, size: 2000 }],
      asks: [{ price: 450.01, size: 2000 }],
      timestamp: Date.now(),
    });

    const result = await fetchOrderBookFeatures("SPY");

    expect(result?.obi).toBe(0);
  });

  it("should handle empty order book gracefully", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "ILLIQUID",
      bids: [],
      asks: [],
      timestamp: Date.now(),
    });

    const result = await fetchOrderBookFeatures("ILLIQUID");

    expect(result?.obi).toBe(0);
    expect(result?.wobi).toBe(0);
  });

  it("should handle market depth with multiple levels", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "AAPL",
      bids: [
        { price: 150.50, size: 1000 },
        { price: 150.49, size: 800 },
        { price: 150.48, size: 600 },
        { price: 150.47, size: 400 },
        { price: 150.46, size: 200 },
      ],
      asks: [
        { price: 150.51, size: 500 },
        { price: 150.52, size: 600 },
        { price: 150.53, size: 700 },
        { price: 150.54, size: 800 },
        { price: 150.55, size: 900 },
      ],
      timestamp: Date.now(),
    });

    const result = await fetchOrderBookFeatures("AAPL");

    expect(result?.obi).toBeCloseTo(0.333, 3); // Based on L1 only
    expect(result?.wobi).toBeDefined();
    expect(result?.wobi).toBeGreaterThan(0); // Bid-heavy at top levels
  });
});

describe("augmentEvaluationWithOrderBook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return base features when IBKR is not connected", async () => {
    vi.mocked(isConnected).mockReturnValue(false);

    const baseFeatures = {
      rvol: 2.5,
      gap: 0.05,
      vwap_deviation: 0.02,
    };

    const result = await augmentEvaluationWithOrderBook("AAPL", baseFeatures);

    expect(result).toEqual(baseFeatures);
    expect(result).not.toHaveProperty("order_book_imbalance");
  });

  it("should augment features with order book data when available", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "AAPL",
      bids: [{ price: 150.50, size: 1000 }],
      asks: [{ price: 150.51, size: 500 }],
      timestamp: 1234567890,
    });

    const baseFeatures = {
      rvol: 2.5,
      gap: 0.05,
      vwap_deviation: 0.02,
    };

    const result = await augmentEvaluationWithOrderBook("AAPL", baseFeatures);

    expect(result).toMatchObject(baseFeatures);
    expect(result.order_book_imbalance).toBeCloseTo(0.333, 3);
    expect(result.order_book_weighted_imbalance).toBeDefined();
    expect(result.order_book_timestamp).toBe(1234567890);
  });

  it("should preserve all base feature fields", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "TSLA",
      bids: [{ price: 200.00, size: 1000 }],
      asks: [{ price: 200.10, size: 1000 }],
      timestamp: Date.now(),
    });

    const baseFeatures = {
      rvol: 3.2,
      gap: -0.01,
      vwap_deviation: 0.005,
      atr: 5.5,
      spread: 0.003,
      range_position: 0.75,
    };

    const result = await augmentEvaluationWithOrderBook("TSLA", baseFeatures);

    // All base features should be preserved
    expect(result.rvol).toBe(3.2);
    expect(result.gap).toBe(-0.01);
    expect(result.vwap_deviation).toBe(0.005);
    expect(result.atr).toBe(5.5);
    expect(result.spread).toBe(0.003);
    expect(result.range_position).toBe(0.75);
  });

  it("should return base features when market depth fetch fails", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockRejectedValue(new Error("Connection timeout"));

    const baseFeatures = {
      rvol: 2.5,
      gap: 0.05,
    };

    const result = await augmentEvaluationWithOrderBook("AAPL", baseFeatures);

    expect(result).toEqual(baseFeatures);
    expect(result).not.toHaveProperty("order_book_imbalance");
  });

  it("should handle different symbols correctly", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "NVDA",
      bids: [{ price: 500.00, size: 2000 }],
      asks: [{ price: 500.10, size: 1000 }],
      timestamp: Date.now(),
    });

    const baseFeatures = { test: "value" };

    await augmentEvaluationWithOrderBook("NVDA", baseFeatures);

    expect(getMarketDepth).toHaveBeenCalledWith("NVDA", 10, 5000);
  });

  it("should add order book features without overwriting existing keys", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "AAPL",
      bids: [{ price: 150.50, size: 1500 }],
      asks: [{ price: 150.51, size: 500 }],
      timestamp: 9999999,
    });

    const baseFeatures = {
      existing_field: "preserve_me",
      another_field: 123,
    };

    const result = await augmentEvaluationWithOrderBook("AAPL", baseFeatures);

    expect(result.existing_field).toBe("preserve_me");
    expect(result.another_field).toBe(123);
    expect(result.order_book_imbalance).toBeCloseTo(0.5, 3); // (1500-500)/(1500+500)
  });

  it("should handle base features with order book keys already present", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "AAPL",
      bids: [{ price: 150.50, size: 1000 }],
      asks: [{ price: 150.51, size: 1000 }],
      timestamp: 5555555,
    });

    const baseFeatures = {
      order_book_imbalance: -999, // Should be overwritten
    };

    const result = await augmentEvaluationWithOrderBook("AAPL", baseFeatures);

    expect(result.order_book_imbalance).toBe(0); // New value, not -999
    expect(result.order_book_timestamp).toBe(5555555);
  });
});

describe("integration with order-book-imbalance module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should correctly compute OBI through full integration", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "TEST",
      bids: [
        { price: 100.00, size: 3000 },
        { price: 99.99, size: 2000 },
      ],
      asks: [
        { price: 100.01, size: 1000 },
        { price: 100.02, size: 1500 },
      ],
      timestamp: Date.now(),
    });

    const result = await fetchOrderBookFeatures("TEST");

    // OBI = (3000 - 1000) / (3000 + 1000) = 2000 / 4000 = 0.5
    expect(result?.obi).toBeCloseTo(0.5, 3);
  });

  it("should correctly compute WOBI through full integration", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "TEST",
      bids: [
        { price: 100.00, size: 1000 },
        { price: 99.99, size: 1000 },
      ],
      asks: [
        { price: 100.01, size: 1000 },
        { price: 100.02, size: 1000 },
      ],
      timestamp: Date.now(),
    });

    const result = await fetchOrderBookFeatures("TEST");

    // Equal volumes at all levels, WOBI should be ~0
    expect(result?.wobi).toBeCloseTo(0, 5);
  });

  it("should handle market maker field in depth snapshot", async () => {
    vi.mocked(isConnected).mockReturnValue(true);
    vi.mocked(getMarketDepth).mockResolvedValue({
      symbol: "TEST",
      bids: [
        { price: 100.00, size: 1000, marketMaker: "ARCA" },
      ],
      asks: [
        { price: 100.01, size: 500, marketMaker: "NSDQ" },
      ],
      timestamp: Date.now(),
    });

    const result = await fetchOrderBookFeatures("TEST");

    // Should ignore marketMaker and calculate OBI normally
    expect(result?.obi).toBeCloseTo(0.333, 3); // (1000-500)/(1000+500)
  });
});
