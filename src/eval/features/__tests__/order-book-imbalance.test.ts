import { describe, it, expect } from "vitest";
import {
  computeBookImbalance,
  computeWeightedBookImbalance,
  computeVPIN,
  classifyTrades,
  computeTradeFlowToxicity,
  type OrderBookLevel,
  type TradeTick,
} from "../order-book-imbalance.js";

describe("computeBookImbalance", () => {
  it("should return 0 when bids array is empty", () => {
    const bids: OrderBookLevel[] = [];
    const asks: OrderBookLevel[] = [{ price: 100.5, size: 100 }];
    expect(computeBookImbalance(bids, asks)).toBe(0);
  });

  it("should return 0 when asks array is empty", () => {
    const bids: OrderBookLevel[] = [{ price: 100, size: 100 }];
    const asks: OrderBookLevel[] = [];
    expect(computeBookImbalance(bids, asks)).toBe(0);
  });

  it("should return 0 when both arrays are empty", () => {
    const bids: OrderBookLevel[] = [];
    const asks: OrderBookLevel[] = [];
    expect(computeBookImbalance(bids, asks)).toBe(0);
  });

  it("should return 0 when total volume is 0", () => {
    const bids: OrderBookLevel[] = [{ price: 100, size: 0 }];
    const asks: OrderBookLevel[] = [{ price: 100.5, size: 0 }];
    expect(computeBookImbalance(bids, asks)).toBe(0);
  });

  it("should return positive value when bid volume exceeds ask volume", () => {
    const bids: OrderBookLevel[] = [{ price: 100, size: 300 }];
    const asks: OrderBookLevel[] = [{ price: 100.5, size: 100 }];
    // (300 - 100) / (300 + 100) = 200 / 400 = 0.5
    expect(computeBookImbalance(bids, asks)).toBe(0.5);
  });

  it("should return negative value when ask volume exceeds bid volume", () => {
    const bids: OrderBookLevel[] = [{ price: 100, size: 100 }];
    const asks: OrderBookLevel[] = [{ price: 100.5, size: 300 }];
    // (100 - 300) / (100 + 300) = -200 / 400 = -0.5
    expect(computeBookImbalance(bids, asks)).toBe(-0.5);
  });

  it("should return 0 when bid and ask volumes are equal", () => {
    const bids: OrderBookLevel[] = [{ price: 100, size: 200 }];
    const asks: OrderBookLevel[] = [{ price: 100.5, size: 200 }];
    // (200 - 200) / (200 + 200) = 0 / 400 = 0
    expect(computeBookImbalance(bids, asks)).toBe(0);
  });

  it("should return 1 when ask volume is 0", () => {
    const bids: OrderBookLevel[] = [{ price: 100, size: 500 }];
    const asks: OrderBookLevel[] = [{ price: 100.5, size: 0 }];
    // (500 - 0) / (500 + 0) = 500 / 500 = 1
    expect(computeBookImbalance(bids, asks)).toBe(1);
  });

  it("should return -1 when bid volume is 0", () => {
    const bids: OrderBookLevel[] = [{ price: 100, size: 0 }];
    const asks: OrderBookLevel[] = [{ price: 100.5, size: 500 }];
    // (0 - 500) / (0 + 500) = -500 / 500 = -1
    expect(computeBookImbalance(bids, asks)).toBe(-1);
  });

  it("should only consider best bid and ask (first element)", () => {
    const bids: OrderBookLevel[] = [
      { price: 100, size: 100 },
      { price: 99.5, size: 500 },
      { price: 99, size: 1000 },
    ];
    const asks: OrderBookLevel[] = [
      { price: 100.5, size: 200 },
      { price: 101, size: 600 },
      { price: 101.5, size: 1200 },
    ];
    // (100 - 200) / (100 + 200) = -100 / 300 = -0.333...
    expect(computeBookImbalance(bids, asks)).toBeCloseTo(-0.333, 3);
  });
});

describe("computeWeightedBookImbalance", () => {
  it("should return 0 when bids array is empty", () => {
    const bids: OrderBookLevel[] = [];
    const asks: OrderBookLevel[] = [{ price: 100.5, size: 100 }];
    expect(computeWeightedBookImbalance(bids, asks)).toBe(0);
  });

  it("should return 0 when asks array is empty", () => {
    const bids: OrderBookLevel[] = [{ price: 100, size: 100 }];
    const asks: OrderBookLevel[] = [];
    expect(computeWeightedBookImbalance(bids, asks)).toBe(0);
  });

  it("should return 0 when max depth is 0", () => {
    const bids: OrderBookLevel[] = [{ price: 100, size: 100 }];
    const asks: OrderBookLevel[] = [{ price: 100.5, size: 100 }];
    expect(computeWeightedBookImbalance(bids, asks, 0)).toBe(0);
  });

  it("should handle single level with equal volumes", () => {
    const bids: OrderBookLevel[] = [{ price: 100, size: 100 }];
    const asks: OrderBookLevel[] = [{ price: 100.5, size: 100 }];
    // Level 0: (100 - 100) / 200 = 0, weight = e^0 = 1
    // WOBI = 0 * 1 / 1 = 0
    expect(computeWeightedBookImbalance(bids, asks, 1)).toBe(0);
  });

  it("should apply exponential decay weights to deeper levels", () => {
    const bids: OrderBookLevel[] = [
      { price: 100, size: 100 }, // Level 0: weight = 1.0
      { price: 99.5, size: 100 }, // Level 1: weight = e^(-0.5) ≈ 0.606
    ];
    const asks: OrderBookLevel[] = [
      { price: 100.5, size: 50 },  // Level 0
      { price: 101, size: 50 },    // Level 1
    ];
    // Level 0: (100-50)/150 = 0.333, weight = 1.0
    // Level 1: (100-50)/150 = 0.333, weight ≈ 0.606
    // WOBI = (0.333*1.0 + 0.333*0.606) / (1.0 + 0.606) ≈ 0.535 / 1.606 ≈ 0.333
    const result = computeWeightedBookImbalance(bids, asks, 2);
    expect(result).toBeCloseTo(0.333, 2);
  });

  it("should skip levels with zero volume", () => {
    const bids: OrderBookLevel[] = [
      { price: 100, size: 100 },
      { price: 99.5, size: 0 },  // Zero volume level
      { price: 99, size: 100 },
    ];
    const asks: OrderBookLevel[] = [
      { price: 100.5, size: 100 },
      { price: 101, size: 0 },   // Zero volume level
      { price: 101.5, size: 100 },
    ];
    // Should only consider non-zero levels
    const result = computeWeightedBookImbalance(bids, asks, 3);
    expect(result).toBe(0); // Symmetric bid/ask at each level
  });

  it("should use default depth of 5", () => {
    const bids: OrderBookLevel[] = [
      { price: 100, size: 100 },
      { price: 99.5, size: 90 },
      { price: 99, size: 80 },
      { price: 98.5, size: 70 },
      { price: 98, size: 60 },
      { price: 97.5, size: 50 }, // Should not be included
    ];
    const asks: OrderBookLevel[] = [
      { price: 100.5, size: 50 },
      { price: 101, size: 45 },
      { price: 101.5, size: 40 },
      { price: 102, size: 35 },
      { price: 102.5, size: 30 },
      { price: 103, size: 25 }, // Should not be included
    ];
    // Should only use first 5 levels (default depth)
    const result = computeWeightedBookImbalance(bids, asks);
    expect(result).toBeGreaterThan(0); // Bids dominate
    expect(result).toBeLessThan(1);
  });

  it("should limit depth to shortest array length", () => {
    const bids: OrderBookLevel[] = [
      { price: 100, size: 100 },
      { price: 99.5, size: 100 },
    ];
    const asks: OrderBookLevel[] = [
      { price: 100.5, size: 50 },
      { price: 101, size: 50 },
      { price: 101.5, size: 50 },
      { price: 102, size: 50 },
      { price: 102.5, size: 50 },
    ];
    // Should only use 2 levels (limited by bids length)
    const result = computeWeightedBookImbalance(bids, asks, 5);
    expect(result).toBeGreaterThan(0); // Bids dominate
  });
});

describe("computeVPIN", () => {
  it("should return 0 when buy volumes array is empty", () => {
    const buyVolumes: number[] = [];
    const sellVolumes: number[] = [100, 200];
    expect(computeVPIN(buyVolumes, sellVolumes)).toBe(0);
  });

  it("should return 0 when sell volumes array is empty", () => {
    const buyVolumes: number[] = [100, 200];
    const sellVolumes: number[] = [];
    expect(computeVPIN(buyVolumes, sellVolumes)).toBe(0);
  });

  it("should return 0 when arrays have different lengths", () => {
    const buyVolumes: number[] = [100, 200];
    const sellVolumes: number[] = [100];
    expect(computeVPIN(buyVolumes, sellVolumes)).toBe(0);
  });

  it("should return 0 when total volume is 0", () => {
    const buyVolumes: number[] = [0, 0, 0];
    const sellVolumes: number[] = [0, 0, 0];
    expect(computeVPIN(buyVolumes, sellVolumes)).toBe(0);
  });

  it("should return 0 when buy and sell volumes are perfectly balanced", () => {
    const buyVolumes: number[] = [100, 200, 150];
    const sellVolumes: number[] = [100, 200, 150];
    // Σ|100-100| + |200-200| + |150-150| = 0
    // Σ(100+100) + (200+200) + (150+150) = 900
    // VPIN = 0 / 900 = 0
    expect(computeVPIN(buyVolumes, sellVolumes)).toBe(0);
  });

  it("should return 1 when all volume is one-sided (all buys)", () => {
    const buyVolumes: number[] = [100, 200, 150];
    const sellVolumes: number[] = [0, 0, 0];
    // Σ|100-0| + |200-0| + |150-0| = 450
    // Σ(100+0) + (200+0) + (150+0) = 450
    // VPIN = 450 / 450 = 1
    expect(computeVPIN(buyVolumes, sellVolumes)).toBe(1);
  });

  it("should return 1 when all volume is one-sided (all sells)", () => {
    const buyVolumes: number[] = [0, 0, 0];
    const sellVolumes: number[] = [100, 200, 150];
    // Σ|0-100| + |0-200| + |0-150| = 450
    // Σ(0+100) + (0+200) + (0+150) = 450
    // VPIN = 450 / 450 = 1
    expect(computeVPIN(buyVolumes, sellVolumes)).toBe(1);
  });

  it("should calculate VPIN for mixed buy/sell flow", () => {
    const buyVolumes: number[] = [100, 50, 200];
    const sellVolumes: number[] = [50, 150, 100];
    // Σ|100-50| + |50-150| + |200-100| = 50 + 100 + 100 = 250
    // Σ(100+50) + (50+150) + (200+100) = 150 + 200 + 300 = 650
    // VPIN = 250 / 650 ≈ 0.385
    expect(computeVPIN(buyVolumes, sellVolumes)).toBeCloseTo(0.385, 3);
  });

  it("should handle large imbalances", () => {
    const buyVolumes: number[] = [1000, 2000, 1500];
    const sellVolumes: number[] = [100, 200, 150];
    // Σ|1000-100| + |2000-200| + |1500-150| = 900 + 1800 + 1350 = 4050
    // Σ(1100) + (2200) + (1650) = 4950
    // VPIN = 4050 / 4950 ≈ 0.818
    expect(computeVPIN(buyVolumes, sellVolumes)).toBeCloseTo(0.818, 3);
  });

  it("should handle alternating imbalances", () => {
    const buyVolumes: number[] = [200, 50, 200, 50];
    const sellVolumes: number[] = [50, 200, 50, 200];
    // Σ|200-50| + |50-200| + |200-50| + |50-200| = 150 + 150 + 150 + 150 = 600
    // Σ(250) + (250) + (250) + (250) = 1000
    // VPIN = 600 / 1000 = 0.6
    expect(computeVPIN(buyVolumes, sellVolumes)).toBe(0.6);
  });
});

describe("classifyTrades", () => {
  it("should return empty arrays when trades array is empty", () => {
    const trades: TradeTick[] = [];
    const result = classifyTrades(trades, 100);
    expect(result.buyVolumes).toEqual([]);
    expect(result.sellVolumes).toEqual([]);
  });

  it("should return empty arrays when midpoint is 0", () => {
    const trades: TradeTick[] = [{ price: 100, size: 10, timestamp: 1000 }];
    const result = classifyTrades(trades, 0);
    expect(result.buyVolumes).toEqual([]);
    expect(result.sellVolumes).toEqual([]);
  });

  it("should return empty arrays when midpoint is negative", () => {
    const trades: TradeTick[] = [{ price: 100, size: 10, timestamp: 1000 }];
    const result = classifyTrades(trades, -100);
    expect(result.buyVolumes).toEqual([]);
    expect(result.sellVolumes).toEqual([]);
  });

  it("should classify trade at midpoint as buy", () => {
    const trades: TradeTick[] = [{ price: 100, size: 50, timestamp: 1000 }];
    const result = classifyTrades(trades, 100);
    expect(result.buyVolumes).toEqual([50]);
    expect(result.sellVolumes).toEqual([0]);
  });

  it("should classify trade above midpoint as buy", () => {
    const trades: TradeTick[] = [{ price: 100.5, size: 75, timestamp: 1000 }];
    const result = classifyTrades(trades, 100);
    expect(result.buyVolumes).toEqual([75]);
    expect(result.sellVolumes).toEqual([0]);
  });

  it("should classify trade below midpoint as sell", () => {
    const trades: TradeTick[] = [{ price: 99.5, size: 60, timestamp: 1000 }];
    const result = classifyTrades(trades, 100);
    expect(result.buyVolumes).toEqual([0]);
    expect(result.sellVolumes).toEqual([60]);
  });

  it("should classify multiple trades correctly", () => {
    const trades: TradeTick[] = [
      { price: 100.5, size: 100, timestamp: 1000 }, // Buy
      { price: 99.5, size: 50, timestamp: 1001 },   // Sell
      { price: 100, size: 75, timestamp: 1002 },    // Buy (at midpoint)
      { price: 99, size: 25, timestamp: 1003 },     // Sell
    ];
    const result = classifyTrades(trades, 100);
    expect(result.buyVolumes).toEqual([100, 0, 75, 0]);
    expect(result.sellVolumes).toEqual([0, 50, 0, 25]);
  });

  it("should handle all buys scenario", () => {
    const trades: TradeTick[] = [
      { price: 101, size: 100, timestamp: 1000 },
      { price: 102, size: 150, timestamp: 1001 },
      { price: 103, size: 200, timestamp: 1002 },
    ];
    const result = classifyTrades(trades, 100);
    expect(result.buyVolumes).toEqual([100, 150, 200]);
    expect(result.sellVolumes).toEqual([0, 0, 0]);
  });

  it("should handle all sells scenario", () => {
    const trades: TradeTick[] = [
      { price: 99, size: 100, timestamp: 1000 },
      { price: 98, size: 150, timestamp: 1001 },
      { price: 97, size: 200, timestamp: 1002 },
    ];
    const result = classifyTrades(trades, 100);
    expect(result.buyVolumes).toEqual([0, 0, 0]);
    expect(result.sellVolumes).toEqual([100, 150, 200]);
  });
});

describe("computeTradeFlowToxicity", () => {
  it("should return 0 when arrays are empty", () => {
    expect(computeTradeFlowToxicity([], [])).toBe(0);
  });

  it("should return 0 when arrays have different lengths", () => {
    expect(computeTradeFlowToxicity([100], [100, 200])).toBe(0);
  });

  it("should return same value as VPIN for balanced flow", () => {
    const buyVolumes = [100, 200, 150];
    const sellVolumes = [100, 200, 150];
    const toxicity = computeTradeFlowToxicity(buyVolumes, sellVolumes);
    const vpin = computeVPIN(buyVolumes, sellVolumes);
    expect(toxicity).toBe(vpin);
    expect(toxicity).toBe(0);
  });

  it("should return same value as VPIN for imbalanced flow", () => {
    const buyVolumes = [200, 300, 250];
    const sellVolumes = [50, 100, 75];
    const toxicity = computeTradeFlowToxicity(buyVolumes, sellVolumes);
    const vpin = computeVPIN(buyVolumes, sellVolumes);
    expect(toxicity).toBe(vpin);
    expect(toxicity).toBeGreaterThan(0.5);
  });

  it("should indicate high toxicity for one-sided flow", () => {
    const buyVolumes = [1000, 2000, 1500];
    const sellVolumes = [0, 0, 0];
    const toxicity = computeTradeFlowToxicity(buyVolumes, sellVolumes);
    expect(toxicity).toBe(1); // Maximum toxicity
  });

  it("should indicate moderate toxicity for mixed flow", () => {
    const buyVolumes = [100, 50, 200];
    const sellVolumes = [50, 150, 100];
    const toxicity = computeTradeFlowToxicity(buyVolumes, sellVolumes);
    expect(toxicity).toBeGreaterThan(0);
    expect(toxicity).toBeLessThan(1);
    expect(toxicity).toBeCloseTo(0.385, 3);
  });
});
