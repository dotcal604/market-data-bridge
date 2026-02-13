import { Router } from "express";
import { randomUUID } from "crypto";
import { computeFeatures } from "./features/compute.js";
import { stripMetadata } from "./features/types.js";
import type { FeatureVector } from "./features/types.js";
import { runPrefilters } from "./guardrails/prefilter.js";
import { evaluateAllModels } from "./models/runner.js";
import { computeEnsemble } from "./ensemble/scorer.js";
import { runGuardrails } from "./guardrails/behavioral.js";
import { getWeights } from "./ensemble/weights.js";
import {
  insertEvaluation,
  insertModelOutput,
  insertOutcome,
  getEvaluationById,
  getRecentEvaluations,
  getRecentOutcomes,
  getEvalStats,
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

    const existing = getEvaluationById(evaluation_id);
    if (!existing) {
      res.status(404).json({ error: `Evaluation ${evaluation_id} not found` });
      return;
    }

    insertOutcome({
      evaluation_id,
      trade_taken: trade_taken ? 1 : 0,
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
