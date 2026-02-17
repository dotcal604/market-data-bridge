import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  computeEdgeReport,
  runWalkForward,
  type EdgeReport,
  type WalkForwardResult,
  type FeatureAttribution,
} from "../edge-analytics.js";

/**
 * Test suite for edge analytics module
 * Tests: computeEdgeReport, runWalkForward, feature attribution
 * Requirements: zero data handling, correct metrics, edge score composite,
 * rolling window, insufficient data, window sliding, grid search,
 * edge stability, edge decay, median split, lift, significance
 */

// Mock database module
let mockDb: any = null;

vi.mock("../../db/database.js", () => ({
  getDb: vi.fn(() => {
    if (!mockDb) {
      throw new Error("Mock database not set. Call mockDb = {...} in beforeEach().");
    }
    return mockDb;
  }),
}));

// Mock ensemble scorer module
vi.mock("../ensemble/scorer.js", () => ({
  computeEnsembleWithWeights: vi.fn((evaluations: any[], weights: any) => {
    // Simple mock: weighted average of trade scores
    const compliant = evaluations.filter((e) => e.compliant && e.output);
    if (compliant.length === 0) {
      return { trade_score: 0, should_trade: false };
    }

    const weightSum = weights.claude + weights.gpt4o + weights.gemini;
    const modelWeights = {
      claude: weights.claude / weightSum,
      gpt4o: weights.gpt4o / weightSum,
      gemini: weights.gemini / weightSum,
    };

    const weightedScore = compliant.reduce((sum, e) => {
      const weight = modelWeights[e.model_id as keyof typeof modelWeights] || 0;
      return sum + e.output.trade_score * weight;
    }, 0);

    const scores = compliant.map((e) => e.output.trade_score);
    const spread = Math.max(...scores) - Math.min(...scores);
    const penalty = weights.k * (spread * spread) / 10000;
    const penalizedScore = Math.max(0, weightedScore - penalty);

    return {
      trade_score: penalizedScore,
      should_trade: penalizedScore >= 40,
    };
  }),
}));

describe("edge-analytics", () => {
  beforeEach(() => {
    // Reset mock database before each test
    mockDb = null;
  });

  describe("computeEdgeReport", () => {
    describe("zero data handling", () => {
      it("should return empty report when no outcome data exists", () => {
        mockDb = {
          prepare: vi.fn(() => ({
            all: vi.fn(() => []),
          })),
        };

        const report = computeEdgeReport({ days: 90 });

        expect(report.rolling_metrics).toEqual([]);
        expect(report.current.win_rate).toBe(0);
        expect(report.current.avg_r).toBe(0);
        expect(report.current.sharpe).toBe(0);
        expect(report.current.total_trades).toBe(0);
        expect(report.current.edge_score).toBe(0);
        expect(report.walk_forward).toBeNull();
        expect(report.feature_attribution).toEqual([]);
      });
    });

    describe("correct metrics calculation", () => {
      it("should calculate win rate, avg R, and Sharpe correctly", () => {
        const mockRows = [
          { evaluation_id: "e1", symbol: "AAPL", direction: "long", timestamp: "2024-01-01T10:00:00", ensemble_trade_score: 75, ensemble_should_trade: 1, r_multiple: 2.0, trade_taken: 1, rvol: 1.5, vwap_deviation_pct: 0.5, spread_pct: 0.1, volume_acceleration: 1.2, atr_pct: 2.5, gap_pct: 1.0, range_position_pct: 0.8, price_extension_pct: 1.5, spy_change_pct: 0.5, qqq_change_pct: 0.6, minutes_since_open: 30, volatility_regime: "normal", time_of_day: "morning" },
          { evaluation_id: "e2", symbol: "TSLA", direction: "long", timestamp: "2024-01-02T10:00:00", ensemble_trade_score: 70, ensemble_should_trade: 1, r_multiple: 1.5, trade_taken: 1, rvol: 1.3, vwap_deviation_pct: 0.3, spread_pct: 0.15, volume_acceleration: 1.1, atr_pct: 2.8, gap_pct: 0.8, range_position_pct: 0.7, price_extension_pct: 1.2, spy_change_pct: 0.3, qqq_change_pct: 0.4, minutes_since_open: 45, volatility_regime: "normal", time_of_day: "morning" },
          { evaluation_id: "e3", symbol: "NVDA", direction: "long", timestamp: "2024-01-03T10:00:00", ensemble_trade_score: 68, ensemble_should_trade: 1, r_multiple: 1.0, trade_taken: 1, rvol: 1.2, vwap_deviation_pct: 0.2, spread_pct: 0.12, volume_acceleration: 1.0, atr_pct: 2.3, gap_pct: 0.5, range_position_pct: 0.6, price_extension_pct: 1.0, spy_change_pct: 0.2, qqq_change_pct: 0.3, minutes_since_open: 60, volatility_regime: "low", time_of_day: "morning" },
          { evaluation_id: "e4", symbol: "GOOGL", direction: "long", timestamp: "2024-01-04T10:00:00", ensemble_trade_score: 72, ensemble_should_trade: 1, r_multiple: 1.8, trade_taken: 1, rvol: 1.4, vwap_deviation_pct: 0.4, spread_pct: 0.11, volume_acceleration: 1.15, atr_pct: 2.6, gap_pct: 0.9, range_position_pct: 0.75, price_extension_pct: 1.3, spy_change_pct: 0.4, qqq_change_pct: 0.5, minutes_since_open: 75, volatility_regime: "normal", time_of_day: "morning" },
          { evaluation_id: "e5", symbol: "MSFT", direction: "long", timestamp: "2024-01-05T10:00:00", ensemble_trade_score: 65, ensemble_should_trade: 1, r_multiple: 0.5, trade_taken: 1, rvol: 1.1, vwap_deviation_pct: 0.1, spread_pct: 0.1, volume_acceleration: 0.95, atr_pct: 2.1, gap_pct: 0.3, range_position_pct: 0.5, price_extension_pct: 0.8, spy_change_pct: 0.1, qqq_change_pct: 0.2, minutes_since_open: 90, volatility_regime: "low", time_of_day: "midday" },
          { evaluation_id: "e6", symbol: "AMZN", direction: "long", timestamp: "2024-01-06T10:00:00", ensemble_trade_score: 73, ensemble_should_trade: 1, r_multiple: 2.2, trade_taken: 1, rvol: 1.6, vwap_deviation_pct: 0.6, spread_pct: 0.13, volume_acceleration: 1.25, atr_pct: 2.9, gap_pct: 1.2, range_position_pct: 0.85, price_extension_pct: 1.6, spy_change_pct: 0.6, qqq_change_pct: 0.7, minutes_since_open: 105, volatility_regime: "normal", time_of_day: "midday" },
          { evaluation_id: "e7", symbol: "META", direction: "long", timestamp: "2024-01-07T10:00:00", ensemble_trade_score: 60, ensemble_should_trade: 1, r_multiple: -1.0, trade_taken: 1, rvol: 0.9, vwap_deviation_pct: -0.2, spread_pct: 0.2, volume_acceleration: 0.85, atr_pct: 2.0, gap_pct: -0.5, range_position_pct: 0.3, price_extension_pct: 0.5, spy_change_pct: -0.2, qqq_change_pct: -0.1, minutes_since_open: 120, volatility_regime: "high", time_of_day: "midday" },
          { evaluation_id: "e8", symbol: "NFLX", direction: "long", timestamp: "2024-01-08T10:00:00", ensemble_trade_score: 58, ensemble_should_trade: 1, r_multiple: -0.8, trade_taken: 1, rvol: 0.8, vwap_deviation_pct: -0.3, spread_pct: 0.25, volume_acceleration: 0.8, atr_pct: 1.9, gap_pct: -0.7, range_position_pct: 0.25, price_extension_pct: 0.3, spy_change_pct: -0.3, qqq_change_pct: -0.2, minutes_since_open: 135, volatility_regime: "high", time_of_day: "afternoon" },
          { evaluation_id: "e9", symbol: "PYPL", direction: "long", timestamp: "2024-01-09T10:00:00", ensemble_trade_score: 55, ensemble_should_trade: 1, r_multiple: -1.2, trade_taken: 1, rvol: 0.7, vwap_deviation_pct: -0.4, spread_pct: 0.3, volume_acceleration: 0.75, atr_pct: 1.8, gap_pct: -0.9, range_position_pct: 0.2, price_extension_pct: 0.2, spy_change_pct: -0.4, qqq_change_pct: -0.3, minutes_since_open: 150, volatility_regime: "high", time_of_day: "afternoon" },
          { evaluation_id: "e10", symbol: "UBER", direction: "long", timestamp: "2024-01-10T10:00:00", ensemble_trade_score: 52, ensemble_should_trade: 1, r_multiple: -0.5, trade_taken: 1, rvol: 0.75, vwap_deviation_pct: -0.1, spread_pct: 0.18, volume_acceleration: 0.82, atr_pct: 1.95, gap_pct: -0.3, range_position_pct: 0.35, price_extension_pct: 0.4, spy_change_pct: -0.1, qqq_change_pct: -0.15, minutes_since_open: 165, volatility_regime: "normal", time_of_day: "afternoon" },
        ];

        mockDb = {
          prepare: vi.fn(() => ({
            all: vi.fn(() => mockRows),
          })),
        };

        const report = computeEdgeReport({ days: 90, includeWalkForward: false });

        expect(report.current.win_rate).toBe(0.6);
        expect(report.current.avg_r).toBe(0.55);
        expect(report.current.total_trades).toBe(10);
        expect(report.current.sharpe).toBeGreaterThan(0);
      });
    });

    describe("edge score composite", () => {
      it("should calculate edge score with correct component weights", () => {
        const mockRows = Array.from({ length: 50 }, (_, i) => {
          const isWin = i < 30;
          return {
            evaluation_id: `e${i + 1}`,
            symbol: "AAPL",
            direction: "long",
            timestamp: `2024-01-${String(Math.floor(i / 2) + 1).padStart(2, "0")}T10:00:00`,
            ensemble_trade_score: isWin ? 70 : 55,
            ensemble_should_trade: 1,
            r_multiple: isWin ? 1.5 : -0.75,
            trade_taken: 1,
            rvol: 1.2,
            vwap_deviation_pct: 0.3,
            spread_pct: 0.1,
            volume_acceleration: 1.1,
            atr_pct: 2.5,
            gap_pct: 0.5,
            range_position_pct: 0.6,
            price_extension_pct: 1.0,
            spy_change_pct: 0.2,
            qqq_change_pct: 0.3,
            minutes_since_open: 60,
            volatility_regime: "normal",
            time_of_day: "morning",
          };
        });

        mockDb = {
          prepare: vi.fn(() => ({
            all: vi.fn(() => mockRows),
          })),
        };

        const report = computeEdgeReport({ days: 90, includeWalkForward: false });

        expect(report.current.edge_score).toBeGreaterThan(0);
        expect(report.current.edge_score).toBeLessThanOrEqual(100);
        expect(report.current.edge_score).toBeGreaterThanOrEqual(40);
      });
    });

    describe("rolling window computation", () => {
      it("should calculate rolling metrics with correct window size", () => {
        const mockRows = Array.from({ length: 30 }, (_, i) => ({
          evaluation_id: `e${i + 1}`,
          symbol: "AAPL",
          direction: "long",
          timestamp: `2024-01-${String(Math.floor(i / 3) + 1).padStart(2, "0")}T10:00:00`,
          ensemble_trade_score: 70,
          ensemble_should_trade: 1,
          r_multiple: i % 2 === 0 ? 1.0 : -0.5,
          trade_taken: 1,
          rvol: 1.2,
          vwap_deviation_pct: 0.3,
          spread_pct: 0.1,
          volume_acceleration: 1.1,
          atr_pct: 2.5,
          gap_pct: 0.5,
          range_position_pct: 0.6,
          price_extension_pct: 1.0,
          spy_change_pct: 0.2,
          qqq_change_pct: 0.3,
          minutes_since_open: 60,
          volatility_regime: "normal",
          time_of_day: "morning",
        }));

        mockDb = {
          prepare: vi.fn(() => ({
            all: vi.fn(() => mockRows),
          })),
        };

        const report = computeEdgeReport({ days: 90, rollingWindow: 20, includeWalkForward: false });

        expect(report.rolling_metrics).toHaveLength(30);
        expect(report.rolling_metrics[0].cumulative_trades).toBe(1);
        expect(report.rolling_metrics[29].cumulative_trades).toBe(30);
        expect(report.rolling_metrics[29].rolling_win_rate).toBeGreaterThan(0);
      });
    });
  });

  describe("runWalkForward", () => {
    describe("insufficient data handling", () => {
      it("should return empty result when no data exists", () => {
        mockDb = {
          prepare: vi.fn(() => ({
            all: vi.fn(() => []),
          })),
        };

        const result = runWalkForward({ trainSize: 30, testSize: 10 });

        expect(result.windows).toEqual([]);
        expect(result.aggregate.total_oos_trades).toBe(0);
        expect(result.aggregate.total_windows).toBe(0);
        expect(result.aggregate.edge_stable).toBe(false);
        expect(result.aggregate.edge_decay_detected).toBe(false);
      });

      it("should return empty result when data is less than trainSize + testSize", () => {
        const mockRows = Array.from({ length: 20 }, (_, i) => ({
          evaluation_id: `e${i + 1}`,
          symbol: "AAPL",
          timestamp: `2024-01-${String(Math.floor(i / 2) + 1).padStart(2, "0")}T10:00:00`,
          ensemble_trade_score: 70,
          ensemble_should_trade: 1,
          r_multiple: 1.0,
          trade_taken: 1,
        }));

        mockDb = {
          prepare: vi.fn((sql: string) => {
            if (sql.includes("model_outputs")) {
              return { all: vi.fn(() => []) };
            }
            return { all: vi.fn(() => mockRows) };
          }),
        };

        const result = runWalkForward({ trainSize: 30, testSize: 10 });

        expect(result.windows).toEqual([]);
        expect(result.aggregate.total_oos_trades).toBe(20);
        expect(result.aggregate.total_windows).toBe(0);
      });
    });

    describe("window sliding mechanism", () => {
      it("should create multiple non-overlapping windows", () => {
        const evalRows = Array.from({ length: 60 }, (_, i) => ({
          evaluation_id: `e${i + 1}`,
          symbol: "AAPL",
          timestamp: `2024-01-${String(Math.floor(i / 3) + 1).padStart(2, "0")}T10:00:00`,
          ensemble_trade_score: 70,
          ensemble_should_trade: 1,
          r_multiple: i % 2 === 0 ? 1.5 : -0.5,
          trade_taken: 1,
        }));

        const modelOutputRows = Array.from({ length: 60 * 3 }, (_, i) => {
          const evalIdx = Math.floor(i / 3);
          const models = ["claude", "gpt4o", "gemini"];
          return {
            evaluation_id: `e${evalIdx + 1}`,
            model_id: models[i % 3],
            trade_score: 70,
            expected_rr: 2.0,
            confidence: 0.8,
            should_trade: 1,
            compliant: 1,
          };
        });

        mockDb = {
          prepare: vi.fn((sql: string) => {
            if (sql.includes("model_outputs")) {
              return { all: vi.fn(() => modelOutputRows) };
            }
            return { all: vi.fn(() => evalRows) };
          }),
        };

        const result = runWalkForward({ trainSize: 30, testSize: 10 });

        expect(result.windows.length).toBeGreaterThan(0);
        result.windows.forEach((window) => {
          expect(window.train_size).toBe(30);
          expect(window.test_size).toBeLessThanOrEqual(10);
        });
      });
    });

    describe("grid search weight optimization", () => {
      it("should optimize weights on training data", () => {
        const evalRows = Array.from({ length: 50 }, (_, i) => ({
          evaluation_id: `e${i + 1}`,
          symbol: "AAPL",
          timestamp: `2024-01-${String(Math.floor(i / 3) + 1).padStart(2, "0")}T10:00:00`,
          ensemble_trade_score: 70,
          ensemble_should_trade: 1,
          r_multiple: i % 2 === 0 ? 2.0 : -1.0,
          trade_taken: 1,
        }));

        const modelOutputRows = Array.from({ length: 50 * 3 }, (_, i) => {
          const evalIdx = Math.floor(i / 3);
          const models = ["claude", "gpt4o", "gemini"];
          return {
            evaluation_id: `e${evalIdx + 1}`,
            model_id: models[i % 3],
            trade_score: 70,
            expected_rr: 2.0,
            confidence: 0.8,
            should_trade: 1,
            compliant: 1,
          };
        });

        mockDb = {
          prepare: vi.fn((sql: string) => {
            if (sql.includes("model_outputs")) {
              return { all: vi.fn(() => modelOutputRows) };
            }
            return { all: vi.fn(() => evalRows) };
          }),
        };

        const result = runWalkForward({ trainSize: 30, testSize: 10 });

        expect(result.windows.length).toBeGreaterThan(0);
        const window = result.windows[0];
        expect(window.optimal_weights.claude).toBeGreaterThanOrEqual(0.1);
        expect(window.optimal_weights.gpt4o).toBeGreaterThanOrEqual(0.1);
        expect(window.optimal_weights.gemini).toBeGreaterThanOrEqual(0.1);
        expect(window.optimal_weights.k).toBeGreaterThan(0);

        const sum = window.optimal_weights.claude + window.optimal_weights.gpt4o + window.optimal_weights.gemini;
        expect(sum).toBeCloseTo(1.0, 1);
      });
    });

    describe("edge stability detection", () => {
      it("should detect stable edge when win rate > 50% in majority of windows", () => {
        const evalRows = Array.from({ length: 100 }, (_, i) => ({
          evaluation_id: `e${i + 1}`,
          symbol: "AAPL",
          timestamp: `2024-01-${String(Math.floor(i / 4) + 1).padStart(2, "0")}T10:00:00`,
          ensemble_trade_score: 70,
          ensemble_should_trade: 1,
          r_multiple: 1.5,
          trade_taken: 1,
        }));

        const modelOutputRows = Array.from({ length: 100 * 3 }, (_, i) => {
          const evalIdx = Math.floor(i / 3);
          const models = ["claude", "gpt4o", "gemini"];
          return {
            evaluation_id: `e${evalIdx + 1}`,
            model_id: models[i % 3],
            trade_score: 70,
            expected_rr: 2.0,
            confidence: 0.8,
            should_trade: 1,
            compliant: 1,
          };
        });

        mockDb = {
          prepare: vi.fn((sql: string) => {
            if (sql.includes("model_outputs")) {
              return { all: vi.fn(() => modelOutputRows) };
            }
            return { all: vi.fn(() => evalRows) };
          }),
        };

        const result = runWalkForward({ trainSize: 30, testSize: 10 });
        expect(result.aggregate.edge_stable).toBe(true);
      });

      it("should detect unstable edge when win rate < 50% in most windows", () => {
        const evalRows = Array.from({ length: 100 }, (_, i) => ({
          evaluation_id: `e${i + 1}`,
          symbol: "AAPL",
          timestamp: `2024-01-${String(Math.floor(i / 4) + 1).padStart(2, "0")}T10:00:00`,
          ensemble_trade_score: 70,
          ensemble_should_trade: 1,
          r_multiple: i % 5 === 0 ? 1.5 : -1.0,
          trade_taken: 1,
        }));

        const modelOutputRows = Array.from({ length: 100 * 3 }, (_, i) => {
          const evalIdx = Math.floor(i / 3);
          const models = ["claude", "gpt4o", "gemini"];
          return {
            evaluation_id: `e${evalIdx + 1}`,
            model_id: models[i % 3],
            trade_score: 70,
            expected_rr: 2.0,
            confidence: 0.8,
            should_trade: 1,
            compliant: 1,
          };
        });

        mockDb = {
          prepare: vi.fn((sql: string) => {
            if (sql.includes("model_outputs")) {
              return { all: vi.fn(() => modelOutputRows) };
            }
            return { all: vi.fn(() => evalRows) };
          }),
        };

        const result = runWalkForward({ trainSize: 30, testSize: 10 });
        expect(result.aggregate.edge_stable).toBe(false);
      });
    });

    describe("edge decay detection", () => {
      it("should detect edge decay when recent windows underperform", () => {
        const evalRows = Array.from({ length: 100 }, (_, i) => {
          const isEarly = i < 50;
          return {
            evaluation_id: `e${i + 1}`,
            symbol: "AAPL",
            timestamp: `2024-01-${String(Math.floor(i / 4) + 1).padStart(2, "0")}T10:00:00`,
            ensemble_trade_score: 70,
            ensemble_should_trade: 1,
            r_multiple: isEarly ? 1.5 : (i % 4 === 0 ? 1.0 : -1.0),
            trade_taken: 1,
          };
        });

        const modelOutputRows = Array.from({ length: 100 * 3 }, (_, i) => {
          const evalIdx = Math.floor(i / 3);
          const models = ["claude", "gpt4o", "gemini"];
          return {
            evaluation_id: `e${evalIdx + 1}`,
            model_id: models[i % 3],
            trade_score: 70,
            expected_rr: 2.0,
            confidence: 0.8,
            should_trade: 1,
            compliant: 1,
          };
        });

        mockDb = {
          prepare: vi.fn((sql: string) => {
            if (sql.includes("model_outputs")) {
              return { all: vi.fn(() => modelOutputRows) };
            }
            return { all: vi.fn(() => evalRows) };
          }),
        };

        const result = runWalkForward({ trainSize: 30, testSize: 10 });
        expect(result.aggregate.edge_decay_detected).toBe(true);
      });

      it("should not detect edge decay when performance is consistent", () => {
        const evalRows = Array.from({ length: 100 }, (_, i) => ({
          evaluation_id: `e${i + 1}`,
          symbol: "AAPL",
          timestamp: `2024-01-${String(Math.floor(i / 4) + 1).padStart(2, "0")}T10:00:00`,
          ensemble_trade_score: 70,
          ensemble_should_trade: 1,
          r_multiple: i % 2 === 0 ? 1.5 : -0.8,
          trade_taken: 1,
        }));

        const modelOutputRows = Array.from({ length: 100 * 3 }, (_, i) => {
          const evalIdx = Math.floor(i / 3);
          const models = ["claude", "gpt4o", "gemini"];
          return {
            evaluation_id: `e${evalIdx + 1}`,
            model_id: models[i % 3],
            trade_score: 70,
            expected_rr: 2.0,
            confidence: 0.8,
            should_trade: 1,
            compliant: 1,
          };
        });

        mockDb = {
          prepare: vi.fn((sql: string) => {
            if (sql.includes("model_outputs")) {
              return { all: vi.fn(() => modelOutputRows) };
            }
            return { all: vi.fn(() => evalRows) };
          }),
        };

        const result = runWalkForward({ trainSize: 30, testSize: 10 });
        expect(result.aggregate.edge_decay_detected).toBe(false);
      });
    });
  });

  describe("feature attribution", () => {
    describe("median split logic", () => {
      it("should split features at median correctly", () => {
        const mockRows = Array.from({ length: 30 }, (_, i) => ({
          evaluation_id: `e${i + 1}`,
          symbol: "AAPL",
          direction: "long",
          timestamp: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00`,
          ensemble_trade_score: 70,
          ensemble_should_trade: 1,
          r_multiple: i >= 15 ? 1.5 : -1.0,
          trade_taken: 1,
          rvol: i >= 15 ? 2.0 : 1.0,
          vwap_deviation_pct: 0.3,
          spread_pct: 0.1,
          volume_acceleration: 1.1,
          atr_pct: 2.5,
          gap_pct: 0.5,
          range_position_pct: 0.6,
          price_extension_pct: 1.0,
          spy_change_pct: 0.2,
          qqq_change_pct: 0.3,
          minutes_since_open: 60,
          volatility_regime: "normal",
          time_of_day: "morning",
        }));

        mockDb = {
          prepare: vi.fn(() => ({
            all: vi.fn(() => mockRows),
          })),
        };

        const report = computeEdgeReport({ days: 90, includeWalkForward: false });

        expect(report.feature_attribution.length).toBeGreaterThan(0);
        const rvolFeature = report.feature_attribution.find((f) => f.feature === "rvol");
        expect(rvolFeature).toBeDefined();

        if (rvolFeature) {
          expect(rvolFeature.win_rate_when_high).toBeGreaterThan(0.9);
          expect(rvolFeature.win_rate_when_low).toBeLessThan(0.1);
        }
      });
    });

    describe("lift calculation", () => {
      it("should calculate lift as difference between high and low win rates", () => {
        const mockRows = Array.from({ length: 40 }, (_, i) => {
          const isHighVwap = i >= 20;
          return {
            evaluation_id: `e${i + 1}`,
            symbol: "AAPL",
            direction: "long",
            timestamp: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00`,
            ensemble_trade_score: 70,
            ensemble_should_trade: 1,
            r_multiple: isHighVwap ? (i % 4 === 0 ? -1.0 : 1.5) : (i % 4 === 0 ? 1.5 : -1.0),
            trade_taken: 1,
            rvol: 1.2,
            vwap_deviation_pct: isHighVwap ? 0.8 : 0.1,
            spread_pct: 0.1,
            volume_acceleration: 1.1,
            atr_pct: 2.5,
            gap_pct: 0.5,
            range_position_pct: 0.6,
            price_extension_pct: 1.0,
            spy_change_pct: 0.2,
            qqq_change_pct: 0.3,
            minutes_since_open: 60,
            volatility_regime: "normal",
            time_of_day: "morning",
          };
        });

        mockDb = {
          prepare: vi.fn(() => ({
            all: vi.fn(() => mockRows),
          })),
        };

        const report = computeEdgeReport({ days: 90, includeWalkForward: false });
        const vwapFeature = report.feature_attribution.find((f) => f.feature === "vwap_deviation_pct");
        expect(vwapFeature).toBeDefined();

        if (vwapFeature) {
          expect(Math.abs(vwapFeature.lift)).toBeGreaterThan(0.4);
        }
      });
    });

    describe("significance threshold", () => {
      it("should mark features as significant when lift > 5pp and samples >= 10", () => {
        const mockRows = Array.from({ length: 40 }, (_, i) => {
          const isHighSpread = i >= 20;
          return {
            evaluation_id: `e${i + 1}`,
            symbol: "AAPL",
            direction: "long",
            timestamp: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00`,
            ensemble_trade_score: 70,
            ensemble_should_trade: 1,
            r_multiple: isHighSpread ? (i % 5 === 0 ? -1.0 : 1.5) : (i % 5 === 0 ? 1.5 : -1.0),
            trade_taken: 1,
            rvol: 1.2,
            vwap_deviation_pct: 0.3,
            spread_pct: isHighSpread ? 0.3 : 0.05,
            volume_acceleration: 1.1,
            atr_pct: 2.5,
            gap_pct: 0.5,
            range_position_pct: 0.6,
            price_extension_pct: 1.0,
            spy_change_pct: 0.2,
            qqq_change_pct: 0.3,
            minutes_since_open: 60,
            volatility_regime: "normal",
            time_of_day: "morning",
          };
        });

        mockDb = {
          prepare: vi.fn(() => ({
            all: vi.fn(() => mockRows),
          })),
        };

        const report = computeEdgeReport({ days: 90, includeWalkForward: false });
        const spreadFeature = report.feature_attribution.find((f) => f.feature === "spread_pct");
        expect(spreadFeature).toBeDefined();

        if (spreadFeature) {
          expect(spreadFeature.significant).toBe(true);
          expect(Math.abs(spreadFeature.lift)).toBeGreaterThan(0.05);
          expect(spreadFeature.sample_high).toBeGreaterThanOrEqual(10);
          expect(spreadFeature.sample_low).toBeGreaterThanOrEqual(10);
        }
      });

      it("should not mark features as significant when lift < 5pp", () => {
        const mockRows = Array.from({ length: 40 }, (_, i) => ({
          evaluation_id: `e${i + 1}`,
          symbol: "AAPL",
          direction: "long",
          timestamp: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00`,
          ensemble_trade_score: 70,
          ensemble_should_trade: 1,
          r_multiple: i % 2 === 0 ? 1.5 : -1.0,
          trade_taken: 1,
          rvol: 1.2,
          vwap_deviation_pct: 0.3,
          spread_pct: 0.1,
          volume_acceleration: i >= 20 ? 1.2 : 1.0,
          atr_pct: 2.5,
          gap_pct: 0.5,
          range_position_pct: 0.6,
          price_extension_pct: 1.0,
          spy_change_pct: 0.2,
          qqq_change_pct: 0.3,
          minutes_since_open: 60,
          volatility_regime: "normal",
          time_of_day: "morning",
        }));

        mockDb = {
          prepare: vi.fn(() => ({
            all: vi.fn(() => mockRows),
          })),
        };

        const report = computeEdgeReport({ days: 90, includeWalkForward: false });
        const volAccelFeature = report.feature_attribution.find((f) => f.feature === "volume_acceleration");
        expect(volAccelFeature).toBeDefined();

        if (volAccelFeature) {
          expect(volAccelFeature.significant).toBe(false);
          expect(Math.abs(volAccelFeature.lift)).toBeLessThanOrEqual(0.05);
        }
      });

      it("should not mark features as significant when sample size < 10", () => {
        const mockRows = Array.from({ length: 12 }, (_, i) => ({
          evaluation_id: `e${i + 1}`,
          symbol: "AAPL",
          direction: "long",
          timestamp: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00`,
          ensemble_trade_score: 70,
          ensemble_should_trade: 1,
          r_multiple: 1.5,
          trade_taken: 1,
          rvol: 1.2,
          vwap_deviation_pct: 0.3,
          spread_pct: 0.1,
          volume_acceleration: 1.1,
          atr_pct: i >= 6 ? 3.0 : 1.5,
          gap_pct: 0.5,
          range_position_pct: 0.6,
          price_extension_pct: 1.0,
          spy_change_pct: 0.2,
          qqq_change_pct: 0.3,
          minutes_since_open: 60,
          volatility_regime: "normal",
          time_of_day: "morning",
        }));

        mockDb = {
          prepare: vi.fn(() => ({
            all: vi.fn(() => mockRows),
          })),
        };

        const report = computeEdgeReport({ days: 90, includeWalkForward: false });
        expect(report.feature_attribution).toEqual([]);
      });
    });
  });
});
