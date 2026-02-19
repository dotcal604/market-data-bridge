import { Router } from "express";
import { randomUUID } from "crypto";
import { computeFeatures } from "./features/compute.js";
import { stripMetadata } from "./features/types.js";
import { wsBroadcast } from "../ws/server.js";
import type { FeatureVector } from "./features/types.js";
import { runPrefilters } from "./guardrails/prefilter.js";
import { evaluateAllModels } from "./models/runner.js";
import { computeEnsemble, computeEnsembleWithWeights } from "./ensemble/scorer.js";
import { runGuardrails } from "./guardrails/behavioral.js";
import { getWeights, updateWeights } from "./ensemble/weights.js";
import type { ModelEvaluation } from "./models/types.js";
import {
  insertEvaluation,
  insertModelOutput,
  insertEvalReasoning,
  insertOutcome,
  getEvaluationById,
  getModelOutputsForEval,
  getOutcomeForEval,
  getReasoningForEval,
  getRecentEvaluations,
  getRecentOutcomes,
  getOutcomeCount,
  getEvalStats,
  getDailySummaries,
  getTodaysTrades,
  getEvalsForSimulation,
  getEvalOutcomes,
  getTraderSyncTrades,
  getTraderSyncStats,
  getWeightHistory,
  getAutoLinkStats,
  getRecentLinks,
} from "../db/database.js";
import { importTraderSyncCSV } from "../tradersync/importer.js";
import { computeDriftReport } from "./drift.js";
import { extractStructuredReasoning } from "./reasoning/extractor.js";
import { logger } from "../logging.js";
import { wsBroadcastWithSequence, getNextSequenceId } from "../ws/server.js";

export const evalRouter = Router();


function buildReasoningResponse(evalId: string): { evaluation_id: string; models: Record<string, unknown> } {
  const rows = getReasoningForEval(evalId);
  const models: Record<string, unknown> = {};
  for (const row of rows) {
    models[row.model_id as string] = {
      key_drivers: JSON.parse(row.key_drivers as string),
      risk_factors: JSON.parse(row.risk_factors as string),
      uncertainties: JSON.parse(row.uncertainties as string),
      conviction: row.conviction,
    };
  }
  return { evaluation_id: evalId, models };
}

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

    // Step 4: Compute ensemble (with regime-conditioned weights)
    const ensemble = computeEnsemble(evaluations, features.volatility_regime);

    // Step 5: Run guardrails (inject DB function to avoid circular dep)
    const guardrail = runGuardrails(ensemble, getRecentOutcomes, getOutcomeCount, () => computeDriftReport());

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

    // Store individual model outputs + structured reasoning
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

      // Extract and store structured reasoning
      if (e.compliant && e.output?.reasoning) {
        try {
          const structured = extractStructuredReasoning(
            e.output.reasoning,
            e.output.confidence ?? null,
            e.output.trade_score ?? null,
          );
          insertEvalReasoning({
            evaluation_id: id,
            model_id: e.model_id,
            key_drivers: JSON.stringify(structured.key_drivers),
            risk_factors: JSON.stringify(structured.risk_factors),
            uncertainties: JSON.stringify(structured.uncertainties),
            conviction: structured.conviction,
          });
        } catch (err) {
          // Non-fatal — don't block eval pipeline for reasoning extraction failures
          logger.warn({ err, model_id: e.model_id }, "[Eval] Reasoning extraction failed");
        }
      }
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

    // Emit eval creation to WebSocket clients (with sequence ID for ordering)
    const seqId = getNextSequenceId();
    wsBroadcastWithSequence("eval_created", {
      type: "eval",
      action: "created",
      evalId: id,
      symbol: features.symbol,
      score: ensemble.trade_score,
      models: Object.keys(models),
      timestamp: features.timestamp,
    }, seqId);

    const evalResult = {
      id,
      symbol: features.symbol,
      timestamp: features.timestamp,
      prefilter: { passed: true, flags: prefilter.flags },
      features,
      models,
      ensemble,
      guardrail,
      latency_ms: latencyDetail,
    };

    res.json(evalResult);

    // Broadcast to WebSocket subscribers (legacy, supplemented by eval_created above)
    wsBroadcast("eval", { id, symbol: features.symbol, ensemble, guardrail: { allowed: guardrail.allowed } });
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
      confidence_rating = null,
      rule_followed = null,
      setup_type = null,
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

    if (confidence_rating != null && (confidence_rating < 1 || confidence_rating > 3)) {
      res.status(400).json({ error: "confidence_rating must be 1 (low), 2 (medium), or 3 (high)" });
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
      confidence_rating,
      rule_followed: rule_followed != null ? (rule_followed ? 1 : 0) : null,
      setup_type,
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

// POST /weights — update ensemble weights
evalRouter.post("/weights", (req, res) => {
  try {
    const { claude, gpt4o, gemini, k, sample_size, source } = req.body ?? {};

    // Validate at least one weight is provided
    if (claude === undefined && gpt4o === undefined && gemini === undefined && k === undefined && sample_size === undefined) {
      res.status(400).json({ error: "At least one of claude, gpt4o, gemini, k, or sample_size must be provided" });
      return;
    }

    // Validate numeric types
    if (claude !== undefined && typeof claude !== "number") {
      res.status(400).json({ error: "claude must be a number" });
      return;
    }
    if (gpt4o !== undefined && typeof gpt4o !== "number") {
      res.status(400).json({ error: "gpt4o must be a number" });
      return;
    }
    if (gemini !== undefined && typeof gemini !== "number") {
      res.status(400).json({ error: "gemini must be a number" });
      return;
    }
    if (k !== undefined && typeof k !== "number") {
      res.status(400).json({ error: "k must be a number" });
      return;
    }
    if (sample_size !== undefined && typeof sample_size !== "number") {
      res.status(400).json({ error: "sample_size must be a number" });
      return;
    }

    // Validate non-negative
    if ((claude !== undefined && claude < 0) || (gpt4o !== undefined && gpt4o < 0) || (gemini !== undefined && gemini < 0)) {
      res.status(400).json({ error: "Weights must be non-negative" });
      return;
    }
    if (k !== undefined && k < 0) {
      res.status(400).json({ error: "k must be non-negative" });
      return;
    }

    const updated = updateWeights(
      { claude, gpt4o, gemini, k, sample_size },
      typeof source === "string" ? source : "manual"
    );

    logger.info(`[Weights] Updated via API: claude=${updated.claude} gpt4o=${updated.gpt4o} gemini=${updated.gemini} k=${updated.k}`);
    res.json(updated);
  } catch (e: any) {
    logger.error({ err: e }, "[Eval] POST /weights failed");
    res.status(400).json({ error: e.message });
  }
});

// GET /weights/history — weight change history
evalRouter.get("/weights/history", (req, res) => {
  try {
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 100;
    const history = getWeightHistory(isNaN(limit) ? 100 : Math.min(limit, 500));
    
    // Parse weights_json for each record
    const parsed = history.map((row) => ({
      id: row.id,
      weights: JSON.parse(row.weights_json),
      sample_size: row.sample_size,
      reason: row.reason,
      created_at: row.created_at,
    }));

    res.json({ count: parsed.length, history: parsed });
  } catch (e: any) {
    logger.error({ err: e }, "[Eval] GET /weights/history failed");
    res.status(500).json({ error: e.message });
  }
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

// ── Drift Detection ──────────────────────────────────────────────────────

// GET /drift — model accuracy and calibration drift report
evalRouter.get("/drift", (_req, res) => {
  try {
    const report = computeDriftReport();
    res.json({ data: report });
  } catch (e: any) {
    logger.error({ err: e }, "[Eval] drift failed");
    res.status(500).json({ error: e.message });
  }
});

// GET /calibration — per-model calibration data for calibration curve
evalRouter.get("/calibration", (_req, res) => {
  try {
    const report = computeDriftReport();
    // Extract calibration data per model
    const calibration = report.by_model.map((model) => ({
      model_id: model.model_id,
      sample_size: model.sample_size,
      buckets: model.calibration_by_decile.map((bucket) => ({
        bucket: `${bucket.decile * 10}-${bucket.decile * 10 + 10}`,
        midpoint: bucket.decile * 10 + 5,
        predicted_win_rate: bucket.predicted_win_rate,
        actual_win_rate: bucket.actual_win_rate,
        sample_size: bucket.count,
      })),
    }));
    res.json({ calibration });
  } catch (e: any) {
    logger.error({ err: e }, "[Eval] calibration failed");
    res.status(500).json({ error: e.message });
  }
});

// GET /model-agreement — pairwise agreement between models
evalRouter.get("/model-agreement", (_req, res) => {
  try {
    // Get all evaluations with model outputs
    const evaluations = getRecentEvaluations(500);
    
    // Define models
    const models = ["claude-sonnet", "gpt-4o", "gemini-flash"];
    
    // Initialize agreement matrix
    const agreement: Record<string, Record<string, { agreements: number; total: number }>> = {};
    for (const m1 of models) {
      agreement[m1] = {};
      for (const m2 of models) {
        agreement[m1][m2] = { agreements: 0, total: 0 };
      }
    }
    
    // Calculate pairwise agreement
    for (const evaluation of evaluations) {
      const evalId = evaluation.id as string;
      const outputs = getModelOutputsForEval(evalId);
      
      // Extract scores by model
      const scoreMap: Record<string, number> = {};
      for (const output of outputs) {
        const modelId = output.model_id as string;
        const score = output.trade_score as number | null;
        if (score !== null) {
          scoreMap[modelId] = score;
        }
      }
      
      // Compare all pairs
      for (let i = 0; i < models.length; i++) {
        for (let j = 0; j < models.length; j++) {
          const m1 = models[i];
          const m2 = models[j];
          
          if (scoreMap[m1] !== undefined && scoreMap[m2] !== undefined) {
            agreement[m1][m2].total += 1;
            
            // Agreement = same direction (both >60 bull, both <40 bear, or both 40-60 neutral)
            const s1 = scoreMap[m1];
            const s2 = scoreMap[m2];
            
            const dir1 = s1 >= 60 ? "bull" : s1 <= 40 ? "bear" : "neutral";
            const dir2 = s2 >= 60 ? "bull" : s2 <= 40 ? "bear" : "neutral";
            
            if (dir1 === dir2) {
              agreement[m1][m2].agreements += 1;
            }
          }
        }
      }
    }
    
    // Calculate rates
    const agreementRates: Record<string, Record<string, number>> = {};
    for (const m1 of models) {
      agreementRates[m1] = {};
      for (const m2 of models) {
        const { agreements, total } = agreement[m1][m2];
        agreementRates[m1][m2] = total > 0 ? agreements / total : 0;
      }
    }
    
    res.json({ agreement: agreementRates, models });
  } catch (e: any) {
    logger.error({ err: e }, "[Eval] model-agreement failed");
    res.status(500).json({ error: e.message });
  }
});

// ── TraderSync ───────────────────────────────────────────────────────────

// POST /tradersync/import — import TraderSync CSV
evalRouter.post("/tradersync/import", (req, res) => {
  try {
    const csv = req.body?.csv;
    if (!csv || typeof csv !== "string") {
      res.status(400).json({ error: "Request body must include 'csv' string field with CSV content" });
      return;
    }
    const result = importTraderSyncCSV(csv);
    logger.info({ batch: result.batch_id, inserted: result.inserted, skipped: result.skipped }, "[TraderSync] Import complete");
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /tradersync/stats — aggregate stats
evalRouter.get("/tradersync/stats", (_req, res) => {
  try {
    res.json(getTraderSyncStats());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /tradersync/trades — query trades
evalRouter.get("/tradersync/trades", (req, res) => {
  try {
    const trades = getTraderSyncTrades({
      symbol: typeof req.query.symbol === "string" ? req.query.symbol : undefined,
      side: typeof req.query.side === "string" ? req.query.side : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      days: req.query.days ? Number(req.query.days) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ count: trades.length, trades });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /reasoning/:evalId — structured reasoning for an evaluation
evalRouter.get("/reasoning/:evalId", (req, res) => {
  try {
    const evalId = req.params.evalId;
    const evaluation = getEvaluationById(evalId);
    if (!evaluation) {
      res.status(404).json({ error: "Evaluation not found" });
      return;
    }

    res.json(buildReasoningResponse(evalId));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /:id/reasoning — backwards-compatible alias
evalRouter.get("/:id/reasoning", (req, res) => {
  try {
    const evalId = req.params.id;
    const evaluation = getEvaluationById(evalId);
    if (!evaluation) {
      res.status(404).json({ error: "Evaluation not found" });
      return;
    }

    res.json(buildReasoningResponse(evalId));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — single evaluation with model outputs and outcome
evalRouter.get("/auto-links", (_req, res) => {
  try {
    const stats = getAutoLinkStats();
    const recent = getRecentLinks(20);
    res.json({ stats, recent });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

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

/**
 * Extract DB-compatible feature columns from a FeatureVector.
 * @param f Full feature vector
 * @returns Object with keys matching DB columns
 */
export function extractFeatureCols(f: FeatureVector): Record<string, unknown> {
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
