import { describe, it, expect } from "vitest";
import {
  OrderBookFeatures,
  type OrderBookState,
  marketDepthToOrderBook,
  computeOrderBookFeatures,
} from "../order-book-imbalance.js";

describe("OrderBookFeatures.calculateOBI", () => {
  it("should return 0 when bids array is empty", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [],
      asks: [[100, 500]],
      timestamp: Date.now(),
    };
    const result = OrderBookFeatures.calculateOBI(book);
    expect(result).toBe(0);
  });

  it("should return 0 when asks array is empty", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [[100, 500]],
      asks: [],
      timestamp: Date.now(),
    };
    const result = OrderBookFeatures.calculateOBI(book);
    expect(result).toBe(0);
  });

  it("should return 0 when both bid and ask volume are 0", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [[100, 0]],
      asks: [[101, 0]],
      timestamp: Date.now(),
    };
    const result = OrderBookFeatures.calculateOBI(book);
    expect(result).toBe(0);
  });

  it("should return positive imbalance when bid volume exceeds ask volume", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [[100, 1000]],
      asks: [[101, 500]],
      timestamp: Date.now(),
    };
    // OBI = (1000 - 500) / (1000 + 500) = 500 / 1500 = 0.333...
    const result = OrderBookFeatures.calculateOBI(book);
    expect(result).toBeCloseTo(0.333, 3);
  });

  it("should return negative imbalance when ask volume exceeds bid volume", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [[100, 500]],
      asks: [[101, 1000]],
      timestamp: Date.now(),
    };
    // OBI = (500 - 1000) / (500 + 1000) = -500 / 1500 = -0.333...
    const result = OrderBookFeatures.calculateOBI(book);
    expect(result).toBeCloseTo(-0.333, 3);
  });

  it("should return 0 when bid and ask volumes are equal", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [[100, 1000]],
      asks: [[101, 1000]],
      timestamp: Date.now(),
    };
    // OBI = (1000 - 1000) / (1000 + 1000) = 0
    const result = OrderBookFeatures.calculateOBI(book);
    expect(result).toBe(0);
  });

  it("should return 1.0 when ask volume is 0 and bid volume is positive", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [[100, 1000]],
      asks: [[101, 0]],
      timestamp: Date.now(),
    };
    // OBI = (1000 - 0) / 1000 = 1.0
    const result = OrderBookFeatures.calculateOBI(book);
    expect(result).toBe(1.0);
  });

  it("should return -1.0 when bid volume is 0 and ask volume is positive", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [[100, 0]],
      asks: [[101, 1000]],
      timestamp: Date.now(),
    };
    // OBI = (0 - 1000) / 1000 = -1.0
    const result = OrderBookFeatures.calculateOBI(book);
    expect(result).toBe(-1.0);
  });

  it("should use only the best bid and ask (level 1)", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [
        [100, 1000], // Best bid
        [99, 5000],  // Level 2 - should be ignored
      ],
      asks: [
        [101, 500],  // Best ask
        [102, 3000], // Level 2 - should be ignored
      ],
      timestamp: Date.now(),
    };
    // OBI = (1000 - 500) / (1000 + 500) = 0.333...
    const result = OrderBookFeatures.calculateOBI(book);
    expect(result).toBeCloseTo(0.333, 3);
  });

  it("should handle fractional volumes", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [[100, 123.45]],
      asks: [[101, 456.78]],
      timestamp: Date.now(),
    };
    // OBI = (123.45 - 456.78) / (123.45 + 456.78) = -333.33 / 580.23 ≈ -0.574
    const result = OrderBookFeatures.calculateOBI(book);
    expect(result).toBeCloseTo(-0.574, 3);
  });
});

describe("OrderBookFeatures.calculateWOBI", () => {
  it("should return 0 when bids array is empty", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [],
      asks: [[100, 500]],
      timestamp: Date.now(),
    };
    const result = OrderBookFeatures.calculateWOBI(book);
    expect(result).toBe(0);
  });

  it("should return 0 when asks array is empty", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [[100, 500]],
      asks: [],
      timestamp: Date.now(),
    };
    const result = OrderBookFeatures.calculateWOBI(book);
    expect(result).toBe(0);
  });

  it("should calculate weighted imbalance with default depth=5", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [
        [100, 1000],
        [99, 800],
        [98, 600],
        [97, 400],
        [96, 200],
      ],
      asks: [
        [101, 500],
        [102, 600],
        [103, 700],
        [104, 800],
        [105, 900],
      ],
      timestamp: Date.now(),
    };
    // WOBI should be positive since bid volumes are higher at best levels
    const result = OrderBookFeatures.calculateWOBI(book);
    expect(result).toBeGreaterThan(0);
  });

  it("should use custom depth parameter", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [
        [100, 1000],
        [99, 800],
        [98, 600],
      ],
      asks: [
        [101, 500],
        [102, 600],
        [103, 700],
      ],
      timestamp: Date.now(),
    };
    const result = OrderBookFeatures.calculateWOBI(book, 3);
    expect(result).toBeGreaterThan(0);
  });

  it("should apply exponential decay weights to deeper levels", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [
        [100, 100],
        [99, 100],
        [98, 100],
      ],
      asks: [
        [101, 100],
        [102, 100],
        [103, 100],
      ],
      timestamp: Date.now(),
    };
    // Equal volumes at all levels, so WOBI should be 0
    const result = OrderBookFeatures.calculateWOBI(book, 3);
    expect(result).toBeCloseTo(0, 5);
  });

  it("should handle book with fewer levels than requested depth", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [
        [100, 1000],
        [99, 800],
      ],
      asks: [
        [101, 500],
        [102, 600],
      ],
      timestamp: Date.now(),
    };
    // Request depth=5 but only 2 levels available
    const result = OrderBookFeatures.calculateWOBI(book, 5);
    expect(result).toBeGreaterThan(0);
  });

  it("should return 0 when all volumes are 0", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [
        [100, 0],
        [99, 0],
      ],
      asks: [
        [101, 0],
        [102, 0],
      ],
      timestamp: Date.now(),
    };
    const result = OrderBookFeatures.calculateWOBI(book);
    expect(result).toBe(0);
  });

  it("should give more weight to top levels", () => {
    // Top level has strong bid imbalance, deeper levels have ask imbalance
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [
        [100, 10000], // Strong bid at top
        [99, 100],
        [98, 100],
      ],
      asks: [
        [101, 1000],  // Weaker ask at top
        [102, 5000],  // Strong ask at deeper level
        [103, 5000],
      ],
      timestamp: Date.now(),
    };
    // WOBI should still be positive due to heavy weighting of top level
    const result = OrderBookFeatures.calculateWOBI(book, 3);
    expect(result).toBeGreaterThan(0);
  });

  it("should skip levels where total volume is 0", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [
        [100, 1000],
        [99, 0],     // This level has 0 volume
        [98, 800],
      ],
      asks: [
        [101, 500],
        [102, 0],    // This level has 0 volume
        [103, 600],
      ],
      timestamp: Date.now(),
    };
    const result = OrderBookFeatures.calculateWOBI(book, 3);
    // Should only use levels with non-zero volume
    expect(result).toBeGreaterThan(0);
  });
});

describe("OrderBookFeatures.calculateVPIN", () => {
  it("should return 0 when arrays are empty", () => {
    const result = OrderBookFeatures.calculateVPIN([], []);
    expect(result).toBe(0);
  });

  it("should return 0 when arrays have different lengths", () => {
    const buyVolume = [1000, 2000, 3000];
    const sellVolume = [1500, 2500];
    const result = OrderBookFeatures.calculateVPIN(buyVolume, sellVolume);
    expect(result).toBe(0);
  });

  it("should return 0 when total volume is 0", () => {
    const buyVolume = [0, 0, 0];
    const sellVolume = [0, 0, 0];
    const result = OrderBookFeatures.calculateVPIN(buyVolume, sellVolume);
    expect(result).toBe(0);
  });

  it("should calculate VPIN for balanced buy/sell flow", () => {
    const buyVolume = [1000, 1000, 1000];
    const sellVolume = [1000, 1000, 1000];
    // Imbalance = |1000-1000| + |1000-1000| + |1000-1000| = 0
    // Total = 6000
    // VPIN = 0 / 6000 = 0
    const result = OrderBookFeatures.calculateVPIN(buyVolume, sellVolume);
    expect(result).toBe(0);
  });

  it("should calculate VPIN for all buy flow", () => {
    const buyVolume = [1000, 2000, 3000];
    const sellVolume = [0, 0, 0];
    // Imbalance = 1000 + 2000 + 3000 = 6000
    // Total = 6000
    // VPIN = 6000 / 6000 = 1.0
    const result = OrderBookFeatures.calculateVPIN(buyVolume, sellVolume);
    expect(result).toBe(1.0);
  });

  it("should calculate VPIN for all sell flow", () => {
    const buyVolume = [0, 0, 0];
    const sellVolume = [1000, 2000, 3000];
    // Imbalance = 1000 + 2000 + 3000 = 6000
    // Total = 6000
    // VPIN = 6000 / 6000 = 1.0
    const result = OrderBookFeatures.calculateVPIN(buyVolume, sellVolume);
    expect(result).toBe(1.0);
  });

  it("should calculate VPIN for mixed imbalanced flow", () => {
    const buyVolume = [1500, 800, 2000];
    const sellVolume = [1000, 1200, 1500];
    // Bucket 1: |1500 - 1000| = 500
    // Bucket 2: |800 - 1200| = 400
    // Bucket 3: |2000 - 1500| = 500
    // Total imbalance = 1400
    // Total volume = 2500 + 2000 + 3500 = 8000
    // VPIN = 1400 / 8000 = 0.175
    const result = OrderBookFeatures.calculateVPIN(buyVolume, sellVolume);
    expect(result).toBeCloseTo(0.175, 3);
  });

  it("should calculate VPIN for strong buy pressure", () => {
    const buyVolume = [3000, 2500, 4000];
    const sellVolume = [1000, 500, 1500];
    // Bucket 1: |3000 - 1000| = 2000
    // Bucket 2: |2500 - 500| = 2000
    // Bucket 3: |4000 - 1500| = 2500
    // Total imbalance = 6500
    // Total volume = 4000 + 3000 + 5500 = 12500
    // VPIN = 6500 / 12500 = 0.52
    const result = OrderBookFeatures.calculateVPIN(buyVolume, sellVolume);
    expect(result).toBeCloseTo(0.52, 3);
  });

  it("should calculate VPIN for strong sell pressure", () => {
    const buyVolume = [1000, 500, 1500];
    const sellVolume = [3000, 2500, 4000];
    // Bucket 1: |1000 - 3000| = 2000
    // Bucket 2: |500 - 2500| = 2000
    // Bucket 3: |1500 - 4000| = 2500
    // Total imbalance = 6500
    // Total volume = 12500
    // VPIN = 6500 / 12500 = 0.52
    const result = OrderBookFeatures.calculateVPIN(buyVolume, sellVolume);
    expect(result).toBeCloseTo(0.52, 3);
  });

  it("should handle fractional volumes", () => {
    const buyVolume = [123.45, 234.56, 345.67];
    const sellVolume = [111.11, 222.22, 333.33];
    const result = OrderBookFeatures.calculateVPIN(buyVolume, sellVolume);
    // Should calculate without error
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it("should handle large volume windows", () => {
    const buyVolume = Array(50).fill(1000);
    const sellVolume = Array(50).fill(900);
    // Each bucket: |1000 - 900| = 100
    // Total imbalance = 50 * 100 = 5000
    // Total volume = 50 * 1900 = 95000
    // VPIN = 5000 / 95000 ≈ 0.0526
    const result = OrderBookFeatures.calculateVPIN(buyVolume, sellVolume);
    expect(result).toBeCloseTo(0.0526, 3);
  });

  it("should handle alternating buy/sell pressure", () => {
    const buyVolume = [2000, 500, 3000, 800];
    const sellVolume = [500, 2000, 800, 3000];
    // Bucket 1: |2000 - 500| = 1500
    // Bucket 2: |500 - 2000| = 1500
    // Bucket 3: |3000 - 800| = 2200
    // Bucket 4: |800 - 3000| = 2200
    // Total imbalance = 7400
    // Total volume = 2500 + 2500 + 3800 + 3800 = 12600
    // VPIN = 7400 / 12600 ≈ 0.587
    const result = OrderBookFeatures.calculateVPIN(buyVolume, sellVolume);
    expect(result).toBeCloseTo(0.587, 3);
  });
});

describe("marketDepthToOrderBook", () => {
  it("should convert market depth snapshot to order book state", () => {
    const snapshot = {
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
    };

    const book = marketDepthToOrderBook(snapshot);

    expect(book.symbol).toBe("AAPL");
    expect(book.bids).toEqual([
      [150.50, 1000],
      [150.49, 800],
    ]);
    expect(book.asks).toEqual([
      [150.51, 500],
      [150.52, 600],
    ]);
    expect(book.timestamp).toBe(1234567890);
  });

  it("should handle empty bids and asks", () => {
    const snapshot = {
      symbol: "TSLA",
      bids: [],
      asks: [],
      timestamp: Date.now(),
    };

    const book = marketDepthToOrderBook(snapshot);

    expect(book.symbol).toBe("TSLA");
    expect(book.bids).toEqual([]);
    expect(book.asks).toEqual([]);
  });

  it("should ignore marketMaker field when converting", () => {
    const snapshot = {
      symbol: "NVDA",
      bids: [{ price: 500.00, size: 100, marketMaker: "ARCA" }],
      asks: [{ price: 500.10, size: 200, marketMaker: "NSDQ" }],
      timestamp: Date.now(),
    };

    const book = marketDepthToOrderBook(snapshot);

    // Market maker info is discarded, only price and size are kept
    expect(book.bids).toEqual([[500.00, 100]]);
    expect(book.asks).toEqual([[500.10, 200]]);
  });
});

describe("computeOrderBookFeatures", () => {
  it("should compute both OBI and WOBI from book state", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [
        [100, 1000],
        [99, 800],
        [98, 600],
      ],
      asks: [
        [101, 500],
        [102, 600],
        [103, 700],
      ],
      timestamp: Date.now(),
    };

    const features = computeOrderBookFeatures(book, 3);

    expect(features.obi).toBeCloseTo(0.333, 3);
    expect(features.wobi).toBeGreaterThan(0);
  });

  it("should use default depth of 5", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [
        [100, 1000],
        [99, 800],
      ],
      asks: [
        [101, 500],
        [102, 600],
      ],
      timestamp: Date.now(),
    };

    const features = computeOrderBookFeatures(book);

    expect(features.obi).toBeCloseTo(0.333, 3);
    expect(features.wobi).toBeGreaterThan(0);
  });

  it("should handle empty order book", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [],
      asks: [],
      timestamp: Date.now(),
    };

    const features = computeOrderBookFeatures(book);

    expect(features.obi).toBe(0);
    expect(features.wobi).toBe(0);
  });

  it("should handle balanced book", () => {
    const book: OrderBookState = {
      symbol: "AAPL",
      bids: [[100, 1000]],
      asks: [[101, 1000]],
      timestamp: Date.now(),
    };

    const features = computeOrderBookFeatures(book);

    expect(features.obi).toBe(0);
    expect(features.wobi).toBeCloseTo(0, 5);
  });
});
