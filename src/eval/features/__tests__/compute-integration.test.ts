import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeFeatures } from "../compute.js";
import * as yahoo from "../../../providers/yahoo.js";

// Mock Yahoo Finance provider
vi.mock("../../../providers/yahoo.js", () => ({
  getQuote: vi.fn(),
  getHistoricalBars: vi.fn(),
  getStockDetails: vi.fn(),
}));

describe("computeFeatures integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should include tick_velocity and tick_acceleration fields in FeatureVector", async () => {
    // Mock Yahoo Finance responses
    vi.mocked(yahoo.getQuote).mockResolvedValue({
      symbol: "AAPL",
      last: 150.0,
      bid: 149.95,
      ask: 150.05,
      open: 149.0,
      high: 151.0,
      low: 148.5,
      close: 149.5,
      volume: 1000000,
      marketCap: 2500000000000,
    });

    vi.mocked(yahoo.getHistoricalBars).mockResolvedValue([
      {
        timestamp: Date.now() - 86400000,
        open: 148.0,
        high: 150.0,
        low: 147.0,
        close: 149.0,
        volume: 900000,
      },
    ]);

    vi.mocked(yahoo.getStockDetails).mockResolvedValue({
      symbol: "AAPL",
      name: "Apple Inc.",
      marketCap: 2500000000000,
      sharesOutstanding: 16000000000,
      floatShares: 15500000000,
    });

    const result = await computeFeatures("AAPL", "long");

    // Verify tick velocity fields are present
    expect(result.features).toHaveProperty("tick_velocity");
    expect(result.features).toHaveProperty("tick_acceleration");

    // Since tick data is not available, these should be null
    expect(result.features.tick_velocity).toBeNull();
    expect(result.features.tick_acceleration).toBeNull();

    // Verify other features are still computed
    expect(result.features.symbol).toBe("AAPL");
    expect(result.features.last).toBe(150.0);
    expect(result.features.spread_pct).toBeGreaterThan(0);
  });

  it("should handle computeTickVelocity returning null gracefully", async () => {
    // Setup minimal mocks
    vi.mocked(yahoo.getQuote).mockResolvedValue({
      symbol: "TSLA",
      last: 250.0,
      bid: 249.9,
      ask: 250.1,
      open: 248.0,
      high: 252.0,
      low: 247.0,
      close: 249.0,
      volume: 2000000,
      marketCap: 800000000000,
    });

    vi.mocked(yahoo.getHistoricalBars).mockResolvedValue([
      {
        timestamp: Date.now() - 86400000,
        open: 245.0,
        high: 250.0,
        low: 244.0,
        close: 248.0,
        volume: 1800000,
      },
    ]);

    vi.mocked(yahoo.getStockDetails).mockResolvedValue(null);

    const result = await computeFeatures("TSLA");

    // Should not throw, and tick fields should be null
    expect(result.features.tick_velocity).toBeNull();
    expect(result.features.tick_acceleration).toBeNull();
    
    // Other features should still work
    expect(result.features.symbol).toBe("TSLA");
    expect(result.latencyMs).toBeGreaterThan(0);
  });
});
