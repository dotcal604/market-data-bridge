import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { tuneRiskParams, normalizeRiskConfig, type RiskTuneResult } from "../risk-tuning.js";
import type { RiskConfigRow } from "../../db/database.js";
import { RISK_CONFIG_DEFAULTS } from "../../db/schema.js";

// Mock database module
vi.mock("../../db/database.js", () => ({
  db: {
    prepare: vi.fn(),
  },
  upsertRiskConfig: vi.fn(),
}));

// Mock logger
vi.mock("../../logging.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("risk-tuning", () => {
  describe("tuneRiskParams", () => {
    let mockDb: any;
    let mockUpsertRiskConfig: any;

    beforeEach(async () => {
      vi.clearAllMocks();
      const dbModule = vi.mocked(await import("../../db/database.js"));
      mockDb = dbModule.db;
      mockUpsertRiskConfig = dbModule.upsertRiskConfig;

      // Default mock: empty outcomes/journal (will be overridden in specific tests)
      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it("should handle no data (empty R-multiples)", () => {
      // Mock DB queries to return empty arrays
      mockDb.prepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = tuneRiskParams();

      expect(result.sampleSize).toBe(0);
      expect(result.winRate).toBe(0);
      expect(result.avgWinR).toBe(0);
      expect(result.avgLossRAbs).toBe(1); // Default when no losses
      expect(result.halfKelly).toBeGreaterThan(0);
      expect(result.suggestions).toHaveLength(4);
      expect(result.suggestions.every((s) => s.value > 0)).toBe(true);
    });

    it("should handle consistent losses (all negative R)", () => {
      // Mock trade journal with only losses
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes("trade_journal")) {
          return {
            all: vi.fn().mockReturnValue([
              { outcome_tags: "[-1.5R]", notes: null },
              { outcome_tags: "[-2.0R]", notes: null },
              { outcome_tags: null, notes: "Stopped out at -1.0R" },
              { outcome_tags: "[-0.8R]", notes: null },
              { outcome_tags: "[-1.2R]", notes: null },
            ]),
          };
        }
        // Fallback query should not be needed
        return {
          all: vi.fn().mockReturnValue([]),
        };
      });

      const result = tuneRiskParams();

      expect(result.sampleSize).toBe(5);
      expect(result.winRate).toBe(0);
      expect(result.avgWinR).toBe(0);
      expect(result.avgLossRAbs).toBeGreaterThan(0);
      expect(result.halfKelly).toBeGreaterThan(0);
      // With 0 win rate, Kelly should be very low
      expect(result.halfKelly).toBeLessThan(0.02);
      expect(result.suggestions).toHaveLength(4);
    });

    it("should handle consistent wins (all positive R)", () => {
      // Mock trade journal with only wins
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes("trade_journal")) {
          return {
            all: vi.fn().mockReturnValue([
              { outcome_tags: "[+2.5R]", notes: null },
              { outcome_tags: "[+3.0R]", notes: null },
              { outcome_tags: null, notes: "Won 1.8R on breakout" },
              { outcome_tags: "[+2.2R]", notes: null },
              { outcome_tags: "[+4.0R]", notes: null },
            ]),
          };
        }
        return {
          all: vi.fn().mockReturnValue([]),
        };
      });

      const result = tuneRiskParams();

      expect(result.sampleSize).toBe(5);
      expect(result.winRate).toBe(1.0);
      expect(result.avgWinR).toBeGreaterThan(2.0);
      expect(result.avgLossRAbs).toBe(1); // Default when no losses
      expect(result.halfKelly).toBeGreaterThan(0);
      // With 100% win rate, Kelly should be high but capped
      expect(result.halfKelly).toBeLessThanOrEqual(RISK_CONFIG_DEFAULTS.max_position_pct);
      expect(result.suggestions).toHaveLength(4);
      expect(result.suggestions.find((s) => s.param === "max_position_pct")?.value).toBeGreaterThan(0);
    });

    it("should handle mixed results (wins and losses)", () => {
      // Mock trade journal with mixed results
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes("trade_journal")) {
          return {
            all: vi.fn().mockReturnValue([
              { outcome_tags: "[+2.0R]", notes: null },
              { outcome_tags: "[-1.0R]", notes: null },
              { outcome_tags: "[+3.0R]", notes: null },
              { outcome_tags: "[-1.0R]", notes: null },
              { outcome_tags: "[+1.5R]", notes: null },
              { outcome_tags: null, notes: "Lost -1.0R" },
              { outcome_tags: "[+2.5R]", notes: null },
              { outcome_tags: "[-1.0R]", notes: null },
            ]),
          };
        }
        return {
          all: vi.fn().mockReturnValue([]),
        };
      });

      const result = tuneRiskParams();

      expect(result.sampleSize).toBe(8);
      expect(result.winRate).toBe(0.5); // 4 wins, 4 losses
      expect(result.avgWinR).toBeCloseTo(2.25, 1); // (2.0 + 3.0 + 1.5 + 2.5) / 4
      expect(result.avgLossRAbs).toBeCloseTo(1.0, 1); // All losses are -1.0R
      expect(result.halfKelly).toBeGreaterThan(0);
      expect(result.suggestions).toHaveLength(4);

      // Verify all suggestions have reasonable values
      const maxPosition = result.suggestions.find((s) => s.param === "max_position_pct");
      const maxDailyLoss = result.suggestions.find((s) => s.param === "max_daily_loss_pct");
      const maxConcentration = result.suggestions.find((s) => s.param === "max_concentration_pct");
      const volatilityScalar = result.suggestions.find((s) => s.param === "volatility_scalar");

      expect(maxPosition?.value).toBeGreaterThan(0);
      expect(maxDailyLoss?.value).toBeGreaterThan(0);
      expect(maxConcentration?.value).toBeGreaterThan(0);
      expect(volatilityScalar?.value).toBeGreaterThan(0);
      expect(volatilityScalar?.value).toBeLessThanOrEqual(1.0);

      // Verify upsertRiskConfig was called
      expect(mockUpsertRiskConfig).toHaveBeenCalledTimes(1);
      expect(mockUpsertRiskConfig).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ param: "max_position_pct", source: "auto-tuned" }),
          expect.objectContaining({ param: "max_daily_loss_pct", source: "auto-tuned" }),
          expect.objectContaining({ param: "max_concentration_pct", source: "auto-tuned" }),
          expect.objectContaining({ param: "volatility_scalar", source: "auto-tuned" }),
        ])
      );
    });

    it("should handle single trade", () => {
      // Mock trade journal with single trade
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes("trade_journal")) {
          return {
            all: vi.fn().mockReturnValue([
              { outcome_tags: "[+2.0R]", notes: null },
            ]),
          };
        }
        return {
          all: vi.fn().mockReturnValue([]),
        };
      });

      const result = tuneRiskParams();

      expect(result.sampleSize).toBe(1);
      expect(result.winRate).toBe(1.0);
      expect(result.avgWinR).toBe(2.0);
      expect(result.avgLossRAbs).toBe(1); // Default
      expect(result.halfKelly).toBeGreaterThan(0);
      expect(result.suggestions).toHaveLength(4);
    });

    it("should handle all stops hit (all R = -1)", () => {
      // Mock trade journal with all stops hit at -1R
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes("trade_journal")) {
          return {
            all: vi.fn().mockReturnValue([
              { outcome_tags: "[-1.0R]", notes: "Stop hit" },
              { outcome_tags: "[-1.0R]", notes: "Stop hit" },
              { outcome_tags: "[-1.0R]", notes: "Stop hit" },
              { outcome_tags: "[-1.0R]", notes: "Stop hit" },
              { outcome_tags: "[-1.0R]", notes: "Stop hit" },
            ]),
          };
        }
        return {
          all: vi.fn().mockReturnValue([]),
        };
      });

      const result = tuneRiskParams();

      expect(result.sampleSize).toBe(5);
      expect(result.winRate).toBe(0);
      expect(result.avgWinR).toBe(0);
      expect(result.avgLossRAbs).toBe(1.0); // Exactly 1.0R per loss
      expect(result.halfKelly).toBeGreaterThan(0);
      expect(result.suggestions).toHaveLength(4);

      // With consistent -1R losses, suggestions should be conservative
      const maxPosition = result.suggestions.find((s) => s.param === "max_position_pct");
      expect(maxPosition?.value).toBeLessThan(0.03); // Very conservative
    });

    it("should fallback to outcomes table when journal is empty", () => {
      // Mock empty trade journal, but outcomes table has data
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes("trade_journal")) {
          return {
            all: vi.fn().mockReturnValue([]),
          };
        }
        if (sql.includes("outcomes")) {
          return {
            all: vi.fn().mockReturnValue([
              { r_multiple: 2.0 },
              { r_multiple: -1.0 },
              { r_multiple: 3.0 },
              { r_multiple: -1.0 },
            ]),
          };
        }
        return {
          all: vi.fn().mockReturnValue([]),
        };
      });

      const result = tuneRiskParams();

      expect(result.sampleSize).toBe(4);
      expect(result.winRate).toBe(0.5);
      expect(result.suggestions).toHaveLength(4);
    });

    it("should parse R-multiples from notes field", () => {
      // Mock trade journal with R in notes field
      mockDb.prepare.mockImplementation((sql: string) => {
        if (sql.includes("trade_journal")) {
          return {
            all: vi.fn().mockReturnValue([
              { outcome_tags: null, notes: "Trade result: +2.5R gain" },
              { outcome_tags: null, notes: "Stopped out for -1.0R" },
              { outcome_tags: null, notes: "Won 3.2r on momentum" },
            ]),
          };
        }
        return {
          all: vi.fn().mockReturnValue([]),
        };
      });

      const result = tuneRiskParams();

      expect(result.sampleSize).toBe(3);
      // Should parse 2.5, -1.0, and 3.2 from notes
    });
  });

  describe("normalizeRiskConfig", () => {
    it("should return defaults when rows array is empty", () => {
      const result = normalizeRiskConfig([]);

      expect(result).toEqual(RISK_CONFIG_DEFAULTS);
    });

    it("should merge custom values with defaults", () => {
      const rows: RiskConfigRow[] = [
        { param: "max_position_pct", value: 0.03, source: "manual", updated_at: "2024-01-01" },
        { param: "volatility_scalar", value: 0.8, source: "auto-tuned", updated_at: "2024-01-01" },
      ];

      const result = normalizeRiskConfig(rows);

      expect(result.max_position_pct).toBe(0.03);
      expect(result.volatility_scalar).toBe(0.8);
      expect(result.max_daily_loss_pct).toBe(RISK_CONFIG_DEFAULTS.max_daily_loss_pct);
      expect(result.max_concentration_pct).toBe(RISK_CONFIG_DEFAULTS.max_concentration_pct);
    });

    it("should ignore non-finite values", () => {
      const rows: RiskConfigRow[] = [
        { param: "max_position_pct", value: NaN, source: "manual", updated_at: "2024-01-01" },
        { param: "volatility_scalar", value: Infinity, source: "manual", updated_at: "2024-01-01" },
      ];

      const result = normalizeRiskConfig(rows);

      // Should use defaults for non-finite values
      expect(result.max_position_pct).toBe(RISK_CONFIG_DEFAULTS.max_position_pct);
      expect(result.volatility_scalar).toBe(RISK_CONFIG_DEFAULTS.volatility_scalar);
    });

    it("should ignore unknown parameters", () => {
      const rows: RiskConfigRow[] = [
        { param: "max_position_pct", value: 0.04, source: "manual", updated_at: "2024-01-01" },
        { param: "unknown_param" as any, value: 0.5, source: "manual", updated_at: "2024-01-01" },
      ];

      const result = normalizeRiskConfig(rows);

      expect(result.max_position_pct).toBe(0.04);
      expect(result).not.toHaveProperty("unknown_param");
      expect(Object.keys(result)).toHaveLength(4); // Only the 4 known params
    });

    it("should handle all parameters being overridden", () => {
      const rows: RiskConfigRow[] = [
        { param: "max_position_pct", value: 0.06, source: "manual", updated_at: "2024-01-01" },
        { param: "max_daily_loss_pct", value: 0.03, source: "manual", updated_at: "2024-01-01" },
        { param: "max_concentration_pct", value: 0.30, source: "manual", updated_at: "2024-01-01" },
        { param: "volatility_scalar", value: 0.9, source: "auto-tuned", updated_at: "2024-01-01" },
      ];

      const result = normalizeRiskConfig(rows);

      expect(result.max_position_pct).toBe(0.06);
      expect(result.max_daily_loss_pct).toBe(0.03);
      expect(result.max_concentration_pct).toBe(0.30);
      expect(result.volatility_scalar).toBe(0.9);
    });
  });
});
