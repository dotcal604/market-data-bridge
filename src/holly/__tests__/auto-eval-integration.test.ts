/**
 * Integration test for auto-eval pipeline: Holly CSV import → processNewAlerts → signals table
 * 
 * Tests:
 * - Full flow: import holly CSV then processNewAlerts then signals table populated
 * - Dedup: same symbol within 5 min should skip
 * - Prefilter block: features that fail prefilter should insert signal with should_trade=0
 * 
 * Mocks:
 * - computeFeatures: returns fixed FeatureVector
 * - evaluateAllModels: returns 3 model evaluations with known scores
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { setAutoEvalEnabled, processNewAlerts } from "../auto-eval.js";
import { importHollyAlerts } from "../importer.js";
import { db, querySignals, insertSignal } from "../../db/database.js";
import type { FeatureVector } from "../../eval/features/types.js";
import type { ModelEvaluation } from "../../eval/models/types.js";
import type { ComputeResult } from "../../eval/features/compute.js";
import type { RunnerResult } from "../../eval/models/runner.js";

// ── Mock Setup ───────────────────────────────────────────────────────────

// Mock computeFeatures to return a fixed FeatureVector
vi.mock("../../eval/features/compute.js", () => ({
  computeFeatures: vi.fn(),
}));

// Mock evaluateAllModels to return 3 model evaluations
vi.mock("../../eval/models/runner.js", () => ({
  evaluateAllModels: vi.fn(),
}));

// Import the mocked functions after vi.mock
import * as computeModule from "../../eval/features/compute.js";
import * as runnerModule from "../../eval/models/runner.js";

// ── Test Helpers ─────────────────────────────────────────────────────────

function clearTables(): void {
  // Delete in order respecting foreign key constraints
  db.exec("DELETE FROM eval_reasoning");
  db.exec("DELETE FROM model_outputs");
  db.exec("DELETE FROM signals");
  db.exec("DELETE FROM evaluations");
  db.exec("DELETE FROM holly_alerts");
}

const HEADER = "Entry Time,Symbol,Strategy,Entry Price,Stop Price,Shares,Last Price,Segment";

function makeRow(symbol: string, time: string, strategy = "Holly Grail", price = "150.00"): string {
  return `${time},${symbol},${strategy},${price},145.00,100,${price},${strategy}`;
}

/**
 * Create a fixed FeatureVector for testing.
 * This is what computeFeatures will return when mocked.
 */
function createFixedFeatureVector(symbol: string, overrides?: Partial<FeatureVector>): FeatureVector {
  return {
    symbol,
    timestamp: new Date().toISOString(),
    last: 150.0,
    bid: 149.8,
    ask: 150.2,
    open: 148.0,
    high: 151.0,
    low: 147.5,
    close_prev: 147.0,
    volume: 1000000,
    rvol: 1.5,
    vwap_deviation_pct: 0.5,
    spread_pct: 0.3,
    float_rotation_est: 0.02,
    volume_acceleration: 1.2,
    atr_14: 2.5,
    atr_pct: 1.67,
    price_extension_pct: 1.2,
    gap_pct: 0.68,
    range_position_pct: 75.0,
    volatility_regime: "normal",
    liquidity_bucket: "large",
    spy_change_pct: 0.5,
    qqq_change_pct: 0.6,
    market_alignment: "aligned_bull",
    time_of_day: "morning",
    minutes_since_open: 60,
    data_source: "yahoo",
    bridge_latency_ms: 250,
    ...overrides,
  };
}

/**
 * Create fixed model evaluations for testing.
 * This is what evaluateAllModels will return when mocked.
 */
function createFixedModelEvaluations(scores: [number, number, number]): ModelEvaluation[] {
  const timestamp = new Date().toISOString();
  const promptHash = "test-prompt-hash";

  return [
    {
      model_id: "claude",
      output: {
        trade_score: scores[0],
        extension_risk: 20,
        exhaustion_risk: 15,
        float_rotation_risk: 10,
        market_alignment: 80,
        expected_rr: 2.5,
        confidence: 75,
        should_trade: scores[0] >= 50,
        reasoning: "Claude reasoning for this trade setup.",
      },
      raw_response: JSON.stringify({ trade_score: scores[0] }),
      latency_ms: 1200,
      error: null,
      compliant: true,
      model_version: "claude-3-5-sonnet-20241022",
      prompt_hash: promptHash,
      token_count: 1500,
      api_response_id: "claude-resp-1",
      timestamp,
    },
    {
      model_id: "gpt4o",
      output: {
        trade_score: scores[1],
        extension_risk: 18,
        exhaustion_risk: 12,
        float_rotation_risk: 8,
        market_alignment: 85,
        expected_rr: 2.8,
        confidence: 80,
        should_trade: scores[1] >= 50,
        reasoning: "GPT-4o reasoning for this trade setup.",
      },
      raw_response: JSON.stringify({ trade_score: scores[1] }),
      latency_ms: 1100,
      error: null,
      compliant: true,
      model_version: "gpt-4o-2024-11-20",
      prompt_hash: promptHash,
      token_count: 1400,
      api_response_id: "gpt4o-resp-1",
      timestamp,
    },
    {
      model_id: "gemini",
      output: {
        trade_score: scores[2],
        extension_risk: 22,
        exhaustion_risk: 14,
        float_rotation_risk: 12,
        market_alignment: 78,
        expected_rr: 2.3,
        confidence: 70,
        should_trade: scores[2] >= 50,
        reasoning: "Gemini reasoning for this trade setup.",
      },
      raw_response: JSON.stringify({ trade_score: scores[2] }),
      latency_ms: 1000,
      error: null,
      compliant: true,
      model_version: "gemini-1.5-flash-002",
      prompt_hash: promptHash,
      token_count: 1300,
      api_response_id: "gemini-resp-1",
      timestamp,
    },
  ];
}

// ── Integration Tests ────────────────────────────────────────────────────

describe("Auto-Eval Integration Tests", () => {
  beforeEach(() => {
    clearTables();
    setAutoEvalEnabled(true);
    vi.clearAllMocks();
  });

  it("full flow: import holly CSV → processNewAlerts → signals table populated", async () => {
    // Arrange: Mock computeFeatures and evaluateAllModels
    const mockComputeFeatures = vi.mocked(computeModule.computeFeatures);
    const mockEvaluateAllModels = vi.mocked(runnerModule.evaluateAllModels);

    mockComputeFeatures.mockResolvedValue({
      features: createFixedFeatureVector("AAPL"),
      latencyMs: 250,
    } as ComputeResult);

    mockEvaluateAllModels.mockResolvedValue({
      evaluations: createFixedModelEvaluations([72, 68, 75]),
      userPrompt: "test prompt",
      promptHash: "test-hash",
    } as RunnerResult);

    // Step 1: Import Holly CSV
    const csv = [
      HEADER,
      makeRow("AAPL", "2026-02-17 10:00:00", "Holly Grail", "150.00"),
    ].join("\n");

    const importResult = importHollyAlerts(csv);
    expect(importResult.inserted).toBe(1);
    expect(importResult.batch_id).toBeTruthy();

    // Step 2: Process new alerts through auto-eval pipeline
    const processResult = await processNewAlerts(importResult);

    // Assert: Should have evaluated 1 symbol
    expect(processResult.evaluated).toBe(1);
    expect(processResult.skipped).toBe(0);
    expect(processResult.errors).toBe(0);

    // Assert: computeFeatures was called once
    expect(mockComputeFeatures).toHaveBeenCalledTimes(1);
    expect(mockComputeFeatures).toHaveBeenCalledWith("AAPL", "long");

    // Assert: evaluateAllModels was called once
    expect(mockEvaluateAllModels).toHaveBeenCalledTimes(1);

    // Assert: Signal was inserted into signals table
    const signals = querySignals({ symbol: "AAPL" });
    expect(signals).toHaveLength(1);
    expect(signals[0].symbol).toBe("AAPL");
    expect(signals[0].direction).toBe("long");
    expect(signals[0].strategy).toBe("Holly Grail");
    expect(signals[0].prefilter_passed).toBe(1);
    expect(signals[0].should_trade).toBe(1);
    expect(signals[0].ensemble_score).toBeGreaterThan(0);
  });

  it("multiple symbols: imports CSV with 3 symbols → evaluates all 3 → signals populated", async () => {
    // Arrange: Mock to return different scores for different symbols
    const mockComputeFeatures = vi.mocked(computeModule.computeFeatures);
    const mockEvaluateAllModels = vi.mocked(runnerModule.evaluateAllModels);

    mockComputeFeatures.mockImplementation(async (symbol) => ({
      features: createFixedFeatureVector(symbol),
      latencyMs: 250,
    }));

    mockEvaluateAllModels.mockResolvedValue({
      evaluations: createFixedModelEvaluations([70, 72, 68]),
      userPrompt: "test prompt",
      promptHash: "test-hash",
    } as RunnerResult);

    // Step 1: Import Holly CSV with 3 symbols
    const csv = [
      HEADER,
      makeRow("AAPL", "2026-02-17 10:00:00", "Holly Grail", "150.00"),
      makeRow("MSFT", "2026-02-17 10:01:00", "Holly Neo", "380.00"),
      makeRow("TSLA", "2026-02-17 10:02:00", "Holly Grail", "250.00"),
    ].join("\n");

    const importResult = importHollyAlerts(csv);
    expect(importResult.inserted).toBe(3);

    // Step 2: Process new alerts
    const processResult = await processNewAlerts(importResult);

    // Assert: All 3 symbols evaluated
    expect(processResult.evaluated).toBe(3);
    expect(processResult.skipped).toBe(0);
    expect(processResult.errors).toBe(0);

    // Assert: 3 signals in table
    const signals = querySignals({});
    expect(signals).toHaveLength(3);
    expect(signals.map((s) => s.symbol).sort()).toEqual(["AAPL", "MSFT", "TSLA"]);
  });

  it("dedup: same symbol within 5 min should skip", async () => {
    // Arrange: First eval creates a signal
    const mockComputeFeatures = vi.mocked(computeModule.computeFeatures);
    const mockEvaluateAllModels = vi.mocked(runnerModule.evaluateAllModels);

    mockComputeFeatures.mockResolvedValue({
      features: createFixedFeatureVector("AAPL"),
      latencyMs: 250,
    } as ComputeResult);

    mockEvaluateAllModels.mockResolvedValue({
      evaluations: createFixedModelEvaluations([72, 68, 75]),
      userPrompt: "test prompt",
      promptHash: "test-hash",
    } as RunnerResult);

    // Step 1: First import and eval
    const csv1 = [HEADER, makeRow("AAPL", "2026-02-17 10:00:00")].join("\n");
    const importResult1 = importHollyAlerts(csv1);
    expect(importResult1.inserted).toBe(1);

    const processResult1 = await processNewAlerts(importResult1);
    expect(processResult1.evaluated).toBe(1);

    // Assert: First signal created
    let signals = querySignals({ symbol: "AAPL" });
    expect(signals).toHaveLength(1);

    // Step 2: Second import with same symbol within 5 min (should skip)
    const csv2 = [HEADER, makeRow("AAPL", "2026-02-17 10:03:00")].join("\n");
    const importResult2 = importHollyAlerts(csv2);
    expect(importResult2.inserted).toBe(1); // CSV import doesn't dedup on time

    const processResult2 = await processNewAlerts(importResult2);

    // Assert: Second eval was skipped due to dedup
    expect(processResult2.evaluated).toBe(0);
    expect(processResult2.skipped).toBe(1);
    expect(processResult2.errors).toBe(0);

    // Assert: Still only 1 signal (no new signal created)
    signals = querySignals({ symbol: "AAPL" });
    expect(signals).toHaveLength(1);
  });

  it("prefilter block: features that fail prefilter should insert signal with should_trade=0", async () => {
    // Arrange: Mock computeFeatures to return features that fail prefilter
    const mockComputeFeatures = vi.mocked(computeModule.computeFeatures);
    const mockEvaluateAllModels = vi.mocked(runnerModule.evaluateAllModels);

    // Create features that will trigger prefilter failure:
    // - spread_pct > 2.0 triggers "extremely wide" flag
    mockComputeFeatures.mockResolvedValue({
      features: createFixedFeatureVector("NVDA", {
        spread_pct: 2.5, // Extremely wide spread — illiquid
        time_of_day: "premarket",
        volume: 500, // Premarket with negligible volume
      }),
      latencyMs: 250,
    } as ComputeResult);

    // evaluateAllModels should NOT be called when prefilter fails
    mockEvaluateAllModels.mockResolvedValue({
      evaluations: createFixedModelEvaluations([70, 68, 72]),
      userPrompt: "test prompt",
      promptHash: "test-hash",
    } as RunnerResult);

    // Step 1: Import Holly CSV
    const csv = [HEADER, makeRow("NVDA", "2026-02-17 05:00:00", "Holly Grail", "500.00")].join("\n");
    const importResult = importHollyAlerts(csv);
    expect(importResult.inserted).toBe(1);

    // Step 2: Process new alerts
    const processResult = await processNewAlerts(importResult);

    // Assert: Evaluation completed (prefilter block still counts as "evaluated")
    expect(processResult.evaluated).toBe(1);
    expect(processResult.skipped).toBe(0);
    expect(processResult.errors).toBe(0);

    // Assert: computeFeatures was called
    expect(mockComputeFeatures).toHaveBeenCalledTimes(1);

    // Assert: evaluateAllModels was NOT called (prefilter blocked it)
    expect(mockEvaluateAllModels).not.toHaveBeenCalled();

    // Assert: Signal was inserted with should_trade=0 and prefilter_passed=0
    const signals = querySignals({ symbol: "NVDA" });
    expect(signals).toHaveLength(1);
    expect(signals[0].symbol).toBe("NVDA");
    expect(signals[0].prefilter_passed).toBe(0);
    expect(signals[0].should_trade).toBe(0);
    expect(signals[0].ensemble_score).toBe(0);
  });

  it("direction inference: strategy with 'bear' should infer short direction", async () => {
    // Arrange
    const mockComputeFeatures = vi.mocked(computeModule.computeFeatures);
    const mockEvaluateAllModels = vi.mocked(runnerModule.evaluateAllModels);

    mockComputeFeatures.mockResolvedValue({
      features: createFixedFeatureVector("TSLA"),
      latencyMs: 250,
    } as ComputeResult);

    mockEvaluateAllModels.mockResolvedValue({
      evaluations: createFixedModelEvaluations([65, 70, 68]),
      userPrompt: "test prompt",
      promptHash: "test-hash",
    } as RunnerResult);

    // Step 1: Import with bear strategy
    const csv = [HEADER, makeRow("TSLA", "2026-02-17 10:00:00", "Bear Flag Breakdown", "250.00")].join("\n");
    const importResult = importHollyAlerts(csv);
    expect(importResult.inserted).toBe(1);

    // Step 2: Process new alerts
    const processResult = await processNewAlerts(importResult);
    expect(processResult.evaluated).toBe(1);

    // Assert: computeFeatures was called with "short" direction
    expect(mockComputeFeatures).toHaveBeenCalledWith("TSLA", "short");

    // Assert: Signal has short direction
    const signals = querySignals({ symbol: "TSLA" });
    expect(signals).toHaveLength(1);
    expect(signals[0].direction).toBe("short");
    expect(signals[0].strategy).toBe("Bear Flag Breakdown");
  });

  it("disabled auto-eval: processNewAlerts returns zeros", async () => {
    // Arrange
    setAutoEvalEnabled(false);

    // Step 1: Import Holly CSV
    const csv = [HEADER, makeRow("AAPL", "2026-02-17 10:00:00")].join("\n");
    const importResult = importHollyAlerts(csv);
    expect(importResult.inserted).toBe(1);

    // Step 2: Process new alerts (should skip when disabled)
    const processResult = await processNewAlerts(importResult);

    // Assert: Nothing evaluated
    expect(processResult.evaluated).toBe(0);
    expect(processResult.skipped).toBe(0);
    expect(processResult.errors).toBe(0);

    // Assert: No signals created
    const signals = querySignals({});
    expect(signals).toHaveLength(0);
  });

  it("model evaluation error: should still create signal with error count", async () => {
    // Arrange: Mock evaluateAllModels to return some compliant, some errors
    const mockComputeFeatures = vi.mocked(computeModule.computeFeatures);
    const mockEvaluateAllModels = vi.mocked(runnerModule.evaluateAllModels);

    mockComputeFeatures.mockResolvedValue({
      features: createFixedFeatureVector("AMD"),
      latencyMs: 250,
    } as ComputeResult);

    // One model succeeds, two fail
    mockEvaluateAllModels.mockResolvedValue({
      evaluations: [
        {
          model_id: "claude",
          output: {
            trade_score: 70,
            extension_risk: 20,
            exhaustion_risk: 15,
            float_rotation_risk: 10,
            market_alignment: 80,
            expected_rr: 2.5,
            confidence: 75,
            should_trade: true,
            reasoning: "Claude reasoning.",
          },
          raw_response: JSON.stringify({ trade_score: 70 }),
          latency_ms: 1200,
          error: null,
          compliant: true,
          model_version: "claude-3-5-sonnet-20241022",
          prompt_hash: "test-hash",
          token_count: 1500,
          api_response_id: "claude-resp-1",
          timestamp: new Date().toISOString(),
        },
        {
          model_id: "gpt4o",
          output: null,
          raw_response: "",
          latency_ms: 0,
          error: "API timeout",
          compliant: false,
          model_version: "",
          prompt_hash: "test-hash",
          token_count: 0,
          api_response_id: "",
          timestamp: new Date().toISOString(),
        },
        {
          model_id: "gemini",
          output: null,
          raw_response: "",
          latency_ms: 0,
          error: "Rate limit exceeded",
          compliant: false,
          model_version: "",
          prompt_hash: "test-hash",
          token_count: 0,
          api_response_id: "",
          timestamp: new Date().toISOString(),
        },
      ],
      userPrompt: "test prompt",
      promptHash: "test-hash",
    } as RunnerResult);

    // Step 1: Import and process
    const csv = [HEADER, makeRow("AMD", "2026-02-17 10:00:00")].join("\n");
    const importResult = importHollyAlerts(csv);
    const processResult = await processNewAlerts(importResult);

    // Assert: Evaluation completed (even with partial failures)
    expect(processResult.evaluated).toBe(1);
    expect(processResult.errors).toBe(0); // No top-level error

    // Assert: Signal was still created (ensemble can work with partial data)
    const signals = querySignals({ symbol: "AMD" });
    expect(signals).toHaveLength(1);
    expect(signals[0].prefilter_passed).toBe(1);
  });

  it("broadcast callback: signals are broadcast when provided", async () => {
    // Arrange
    const mockComputeFeatures = vi.mocked(computeModule.computeFeatures);
    const mockEvaluateAllModels = vi.mocked(runnerModule.evaluateAllModels);
    const mockBroadcast = vi.fn();

    mockComputeFeatures.mockResolvedValue({
      features: createFixedFeatureVector("GOOG"),
      latencyMs: 250,
    } as ComputeResult);

    mockEvaluateAllModels.mockResolvedValue({
      evaluations: createFixedModelEvaluations([72, 68, 75]),
      userPrompt: "test prompt",
      promptHash: "test-hash",
    } as RunnerResult);

    // Step 1: Import and process with broadcast callback
    const csv = [HEADER, makeRow("GOOG", "2026-02-17 10:00:00")].join("\n");
    const importResult = importHollyAlerts(csv);
    const processResult = await processNewAlerts(importResult, mockBroadcast);

    expect(processResult.evaluated).toBe(1);

    // Assert: Broadcast was called once
    expect(mockBroadcast).toHaveBeenCalledTimes(1);
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "GOOG",
        direction: "long",
        should_trade: true,
      }),
    );
  });

  it("empty batch: processNewAlerts with 0 inserted returns zeros", async () => {
    // Step 1: Create import result with no inserts
    const importResult = {
      batch_id: "empty-batch",
      total_parsed: 0,
      inserted: 0,
      skipped: 0,
      errors: [],
    };

    // Step 2: Process (should early-return)
    const processResult = await processNewAlerts(importResult);

    // Assert
    expect(processResult.evaluated).toBe(0);
    expect(processResult.skipped).toBe(0);
    expect(processResult.errors).toBe(0);
  });
});
