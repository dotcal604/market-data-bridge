import { Router } from "express";
import { randomUUID } from "crypto";
import { computeFeatures } from "./features/compute.js";
import { stripMetadata } from "./features/types.js";
import type { FeatureVector } from "./features/types.js";
import { runPrefilters } from "./guardrails/prefilter.js";
import { evaluateAllModels } from "./models/runner.js";
import { computeEnsemble, computeEnsembleWithWeights } from "./ensemble/scorer.js";
import { runGuardrails } from "./guardrails/behavioral.js";
import { getWeights } from "./ensemble/weights.js";
import type { ModelEvaluation } from "./models/types.js";
import {
  insertEvaluation,
  insertModelOutput,
  insertOutcome,
  getEvaluationById,
  getModelOutputsForEval,
  getOutcomeForEval,
  getRecentEvaluations,
  getRecentOutcomes,
  getEvalStats,
  getDailySummaries,
  getTodaysTrades,
  getEvalsForSimulation,
  getEvalOutcomes,
} from "../db/database.js";
import { logger } from "../logging.js";

export const evalRouter = Router();

// POST /evaluate — full evaluation pipeline
evalRouter.post("/evaluate", async (req, res) => {
  const totalStart = Date.now();
  try {
    const { symbol, direction = "long", entry_price = null, stop_price = null, notes = null } = req.body ?? {};

    if (!symbol || typeof symbol !== "string") {
      res.status(400).json({ error: "symbol is required" });
      return;
    }

    const id = randomUUID();
    logger.info(`[Eval ${id.slice(0, 8)}] Starting ${symbol} ${direction}`);

    // Step 1: Compute features
    const { features, latencyMs: featureLatency } = await computeFeatures(symbol, direction);

    // Step 2: Pre-filter check
    const prefilter = runPrefilters(features);
    if (!prefilter.passed) {
      logger.info(`[Eval ${id.slice(0, 8)}] Pre-filter BLOCKED: ${prefilter.flags.join(", ")}`);

      insertEvaluation({
        id,
        symbol: features.symbol,
        direction,
        entry_price,
        stop_price,
        user_notes: notes,
        timestamp: features.timestamp,
        features_json: JSON.stringify(features),
        ...extractFeatureCols(features),
        ensemble_trade_score: 0,
        ensemble_trade_score_median: 0,
        ensemble_expected_rr: 0,
        ensemble_confidence: 0,
        ensemble_should_trade: 0,
        ensemble_unanimous: 1,
        ensemble_majority_trade: 0,
        ensemble_score_spread: 0,
        ensemble_disagreement_penalty: 0,
        weights_json: JSON.stringify(getWeights()),
        guardrail_allowed: 0,
        guardrail_flags_json: JSON.stringify(prefilter.flags),
        prefilter_passed: 0,
        feature_latency_ms: featureLatency,
        total_latency_ms: Date.now() - totalStart,
      });

      res.json({
        id,
        symbol: features.symbol,
        timestamp: features.timestamp,
        prefilter: { passed: false, flags: prefilter.flags },
        features,
        models: {},
        ensemble: null,
        guardrail: { allowed: false, flags: prefilter.flags },
        latency_ms: { features: featureLatency, total: Date.now() - totalStart },
      });
      return;
    }

    // Step 3: Run 3 models in parallel
    const modelFeatures = stripMetadata(features);
    const { evaluations, promptHash } = await evaluateAllModels(
      symbol, direction, entry_price, stop_price, modelFeatures,
    );

    // Step 4: Compute ensemble
    const ensemble = computeEnsemble(evaluations);

    // Step 5: Run guardrails (inject DB function to avoid circular dep)
    const guardrail = runGuardrails(ensemble, getRecentOutcomes);

    const totalLatency = Date.now() - totalStart;

    // Step 6: Store evaluation
    insertEvaluation({
      id,
      symbol: features.symbol,
      direction,
      entry_price,
      stop_price,
      user_notes: notes,
      timestamp: features.timestamp,
      features_json: JSON.stringify(features),
      ...extractFeatureCols(features),
      ensemble_trade_score: ensemble.trade_score,
      ensemble_trade_score_median: ensemble.trade_score_median,
      ensemble_expected_rr: ensemble.expected_rr,
      ensemble_confidence: ensemble.confidence,
      ensemble_should_trade: ensemble.should_trade ? 1 : 0,
      ensemble_unanimous: ensemble.unanimous ? 1 : 0,
      ensemble_majority_trade: ensemble.majority_trade ? 1 : 0,
      ensemble_score_spread: ensemble.score_spread,
      ensemble_disagreement_penalty: ensemble.disagreement_penalty,
      weights_json: JSON.stringify(ensemble.weights_used),
      guardrail_allowed: guardrail.allowed ? 1 : 0,
      guardrail_flags_json: JSON.stringify(guardrail.flags),
      prefilter_passed: 1,
      feature_latency_ms: featureLatency,
      total_latency_ms: totalLatency,
    });

    // Store individual model outputs
    for (const e of evaluations) {
      insertModelOutput({
        evaluation_id: id,
        model_id: e.model_id,
        trade_score: e.output?.trade_score ?? null,
        extension_risk: e.output?.extension_risk ?? null,
        exhaustion_risk: e.output?.exhaustion_risk ?? null,
        float_rotation_risk: e.output?.float_rotation_risk ?? null,
        market_alignment_score: e.output?.market_alignment ?? null,
        expected_rr: e.output?.expected_rr ?? null,
        confidence: e.output?.confidence ?? null,
        should_trade: e.output?.should_trade != null ? (e.output.should_trade ? 1 : 0) : null,
        reasoning: e.output?.reasoning ?? null,
        raw_response: e.raw_response,
        compliant: e.compliant ? 1 : 0,
        error: e.error,
        latency_ms: e.latency_ms,
        model_version: e.model_version,
        prompt_hash: e.prompt_hash,
        token_count: e.token_count,
        api_response_id: e.api_response_id,
        timestamp: e.timestamp,
      });
    }

    // Build response
    const models: Record<string, unknown> = {};
    for (const e of evaluations) {
      models[e.model_id] = e.compliant
        ? { ...e.output, latency_ms: e.latency_ms }
        : { error: e.error, latency_ms: e.latency_ms };
    }

    const latencyDetail: Record<string, number> = { features: featureLatency, total: totalLatency };
    for (const e of evaluations) {
      latencyDetail[e.model_id] = e.latency_ms;
    }

    logger.info(`[Eval ${id.slice(0, 8)}] Done ${totalLatency}ms — score=${ensemble.trade_score} trade=${ensemble.should_trade} allowed=${guardrail.allowed}`);

    res.json({
      id,
      symbol: features.symbol,
      timestamp: features.timestamp,
      prefilter: { passed: true, flags: prefilter.flags },
      features,
      models,
      ensemble,
      guardrail,
      latency_ms: latencyDetail,
    });
  } catch (e: any) {
    logger.error({ err: e }, "[Eval] evaluate failed");
    res.status(500).json({ error: e.message });
  }
});

// POST /outcome — record trade outcome
evalRouter.post("/outcome", (req, res) => {
  try {
    const {
      evaluation_id,
      trade_taken = false,
      decision_type = null,
      actual_entry_price = null,
      actual_exit_price = null,
      r_multiple = null,
      exit_reason = null,
      notes = null,
    } = req.body ?? {};

    if (!evaluation_id) {
      res.status(400).json({ error: "evaluation_id is required" });
      return;
    }

    if (decision_type && !["took_trade", "passed_setup", "ensemble_no", "risk_gate_blocked"].includes(decision_type)) {
      res.status(400).json({ error: "decision_type must be one of: took_trade, passed_setup, ensemble_no, risk_gate_blocked" });
      return;
    }

    const existing = getEvaluationById(evaluation_id);
    if (!existing) {
      res.status(404).json({ error: `Evaluation ${evaluation_id} not found` });
      return;
    }

    insertOutcome({
      evaluation_id,
      trade_taken: trade_taken ? 1 : 0,
      decision_type,
      actual_entry_price,
      actual_exit_price,
      r_multiple,
      exit_reason,
      notes,
      recorded_at: new Date().toISOString(),
    });

    logger.info(`[Eval] Outcome recorded for ${evaluation_id}: taken=${trade_taken} R=${r_multiple}`);
    res.json({ success: true, evaluation_id });
  } catch (e: any) {
    logger.error({ err: e }, "[Eval] outcome failed");
    res.status(500).json({ error: e.message });
  }
});

// GET /history — recent evaluations
evalRouter.get("/history", (req, res) => {
  try {
    const limit = parseInt(String(req.query.limit ?? "50"), 10);
    const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
    const evaluations = getRecentEvaluations(limit, symbol);
    res.json({ count: evaluations.length, evaluations });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /stats — model performance stats
evalRouter.get("/stats", (_req, res) => {
  try {
    const stats = getEvalStats();
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /weights — current ensemble weights
evalRouter.get("/weights", (_req, res) => {
  res.json(getWeights());
});

// POST /weights/simulate — "what if" re-scoring with custom weights
// Body: { claude: 0.5, gpt4o: 0.3, gemini: 0.2, k?: 1.5, days?: 90, symbol?: "AAPL" }
evalRouter.post("/weights/simulate", (req, res) => {
  try {
    const { claude, gpt4o, gemini, k, days, symbol } = req.body ?? {};

    // Validate weights
    if (typeof claude !== "number" || typeof gpt4o !== "number" || typeof gemini !== "number") {
      res.status(400).json({ error: "Required: claude, gpt4o, gemini (numbers)" });
      return;
    }
    if (claude < 0 || gpt4o < 0 || gemini < 0) {
      res.status(400).json({ error: "Weights must be non-negative" });
      return;
    }
    const weightSum = claude + gpt4o + gemini;
    if (weightSum <= 0) {
      res.status(400).json({ error: "At least one weight must be > 0" });
      return;
    }

    const currentWeights = getWeights();
    const simWeights = {
      claude,
      gpt4o,
      gemini,
      k: typeof k === "number" && k >= 0 ? k : currentWeights.k,
    };

    // Pull historical evals with model outputs
    const rawEvals = getEvalsForSimulation({
      days: typeof days === "number" ? days : 90,
      symbol: typeof symbol === "string" ? symbol : undefined,
    });

    if (rawEvals.length === 0) {
      res.json({
        simulated_weights: simWeights,
        current_weights: { claude: currentWeights.claude, gpt4o: currentWeights.gpt4o, gemini: currentWeights.gemini, k: currentWeights.k },
        evaluations_count: 0,
        message: "No evaluations found for simulation",
      });
      return;
    }

    // Re-score each eval with both current and simulated weights
    let currentTradeCount = 0, simTradeCount = 0;
    let currentScoreSum = 0, simScoreSum = 0;
    let currentCorrect = 0, simCorrect = 0;
    let outcomesWithTrades = 0;

    const details: Array<{
      evaluation_id: string;
      symbol: string;
      timestamp: string;
      current_score: number;
      current_should_trade: boolean;
      sim_score: number;
      sim_should_trade: boolean;
      r_multiple: number | null;
      decision_changed: boolean;
    }> = [];

    for (const row of rawEvals) {
      // Reconstruct ModelEvaluation[] from DB rows
      const modelEvals: ModelEvaluation[] = row.model_outputs.map((mo) => ({
        model_id: mo.model_id as ModelEvaluation["model_id"],
        output: mo.compliant && mo.trade_score != null ? {
          trade_score: mo.trade_score,
          extension_risk: 0,
          exhaustion_risk: 0,
          float_rotation_risk: 0,
          market_alignment: 0,
          expected_rr: mo.expected_rr ?? 0,
          confidence: mo.confidence ?? 0,
          should_trade: mo.should_trade === 1,
          reasoning: "",
        } : null,
        raw_response: "",
        latency_ms: 0,
        error: null,
        compliant: mo.compliant === 1,
        model_version: "",
        prompt_hash: "",
        token_count: 0,
        api_response_id: "",
        timestamp: row.timestamp,
      }));

      const currentResult = computeEnsembleWithWeights(modelEvals, {
        claude: currentWeights.claude,
        gpt4o: currentWeights.gpt4o,
        gemini: currentWeights.gemini,
        k: currentWeights.k,
      });
      const simResult = computeEnsembleWithWeights(modelEvals, simWeights);

      currentScoreSum += currentResult.trade_score;
      simScoreSum += simResult.trade_score;
      if (currentResult.should_trade) currentTradeCount++;
      if (simResult.should_trade) simTradeCount++;

      // Track accuracy against outcomes
      if (row.trade_taken === 1 && row.r_multiple != null) {
        outcomesWithTrades++;
        const isWin = row.r_multiple > 0;
        // "Correct" = recommended trade that won, or didn't recommend a trade that lost
        if ((currentResult.should_trade && isWin) || (!currentResult.should_trade && !isWin)) {
          currentCorrect++;
        }
        if ((simResult.should_trade && isWin) || (!simResult.should_trade && !isWin)) {
          simCorrect++;
        }
      }

      details.push({
        evaluation_id: row.evaluation_id,
        symbol: row.symbol,
        timestamp: row.timestamp,
        current_score: currentResult.trade_score,
        current_should_trade: currentResult.should_trade,
        sim_score: simResult.trade_score,
        sim_should_trade: simResult.should_trade,
        r_multiple: row.r_multiple,
        decision_changed: currentResult.should_trade !== simResult.should_trade,
      });
    }

    const n = rawEvals.length;
    const changedDecisions = details.filter((d) => d.decision_changed).length;

    res.json({
      simulated_weights: simWeights,
      current_weights: { claude: currentWeights.claude, gpt4o: currentWeights.gpt4o, gemini: currentWeights.gemini, k: currentWeights.k },
      evaluations_count: n,
      outcomes_with_trades: outcomesWithTrades,
      comparison: {
        current: {
          avg_score: Math.round((currentScoreSum / n) * 100) / 100,
          trade_rate: Math.round((currentTradeCount / n) * 1000) / 1000,
          accuracy: outcomesWithTrades > 0 ? Math.round((currentCorrect / outcomesWithTrades) * 1000) / 1000 : null,
        },
        simulated: {
          avg_score: Math.round((simScoreSum / n) * 100) / 100,
          trade_rate: Math.round((simTradeCount / n) * 1000) / 1000,
          accuracy: outcomesWithTrades > 0 ? Math.round((simCorrect / outcomesWithTrades) * 1000) / 1000 : null,
        },
        delta: {
          avg_score: Math.round(((simScoreSum - currentScoreSum) / n) * 100) / 100,
          trade_rate: Math.round(((simTradeCount - currentTradeCount) / n) * 1000) / 1000,
          accuracy: outcomesWithTrades > 0
            ? Math.round(((simCorrect - currentCorrect) / outcomesWithTrades) * 1000) / 1000
            : null,
          decisions_changed: changedDecisions,
          decisions_changed_pct: Math.round((changedDecisions / n) * 1000) / 1000,
        },
      },
      evaluations: details,
    });
  } catch (e: any) {
    logger.error({ err: e }, "[Eval] weights/simulate failed");
    res.status(500).json({ error: e.message });
  }
});

// GET /daily-summary — session-level P&L, win rate, avg R
// Query params: ?date=2026-02-13 (single day) or ?days=30 (range)
evalRouter.get("/daily-summary", (req, res) => {
  try {
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    const daysStr = typeof req.query.days === "string" ? req.query.days : undefined;
    const days = daysStr ? parseInt(daysStr, 10) : undefined;

    const summaries = getDailySummaries({
      date,
      days: isNaN(days as number) ? undefined : days,
    });

    // If asking for a specific date, also return individual trades
    const trades = date ? getTodaysTrades() : undefined;

    // Compute rolling totals across all returned days
    let totalTrades = 0, totalWins = 0, totalLosses = 0, totalR = 0;
    for (const s of summaries) {
      totalTrades += s.total_trades;
      totalWins += s.wins;
      totalLosses += s.losses;
      totalR += s.total_r ?? 0;
    }

    res.json({
      sessions: summaries,
      ...(trades ? { trades } : {}),
      rolling: {
        total_trades: totalTrades,
        wins: totalWins,
        losses: totalLosses,
        win_rate: totalTrades > 0 ? totalWins / totalTrades : null,
        avg_r: totalTrades > 0 ? totalR / totalTrades : null,
        total_r: totalR,
        days_with_trades: summaries.length,
      },
    });
  } catch (e: any) {
    logger.error({ err: e }, "[Eval] daily-summary failed");
    res.status(500).json({ error: e.message });
  }
});

// GET /outcomes — evals joined with outcomes (for calibration, scatter, analytics)
// Query params: ?limit=500&symbol=AAPL&days=90&all=true (include non-trades)
evalRouter.get("/outcomes", (req, res) => {
  try {
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
    const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
    const days = typeof req.query.days === "string" ? parseInt(req.query.days, 10) : undefined;
    const tradesTakenOnly = req.query.all !== "true";

    const outcomes = getEvalOutcomes({
      limit: isNaN(limit as number) ? undefined : limit,
      symbol,
      days: isNaN(days as number) ? undefined : days,
      tradesTakenOnly,
    });

    res.json({ count: outcomes.length, outcomes });
  } catch (e: any) {
    logger.error({ err: e }, "[Eval] outcomes failed");
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — single evaluation with model outputs and outcome
evalRouter.get("/:id", (req, res) => {
  try {
    const evaluation = getEvaluationById(req.params.id);
    if (!evaluation) {
      res.status(404).json({ error: "Evaluation not found" });
      return;
    }
    const modelOutputs = getModelOutputsForEval(req.params.id);
    const outcome = getOutcomeForEval(req.params.id) ?? null;
    res.json({ evaluation, modelOutputs, outcome });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Helper ---

function extractFeatureCols(f: FeatureVector): Record<string, unknown> {
  return {
    last_price: f.last,
    rvol: f.rvol,
    vwap_deviation_pct: f.vwap_deviation_pct,
    spread_pct: f.spread_pct,
    float_rotation_est: f.float_rotation_est,
    volume_acceleration: f.volume_acceleration,
    atr_pct: f.atr_pct,
    price_extension_pct: f.price_extension_pct,
    gap_pct: f.gap_pct,
    range_position_pct: f.range_position_pct,
    volatility_regime: f.volatility_regime,
    liquidity_bucket: f.liquidity_bucket,
    spy_change_pct: f.spy_change_pct,
    qqq_change_pct: f.qqq_change_pct,
    market_alignment: f.market_alignment,
    time_of_day: f.time_of_day,
    minutes_since_open: f.minutes_since_open,
  };
}
