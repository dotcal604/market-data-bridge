/**
 * Auto-eval engine: when Holly alerts arrive, automatically evaluate each
 * symbol through the 3-model ensemble pipeline. Results are stored as signals
 * and broadcast via WebSocket.
 *
 * OFF by default — enable via AUTO_EVAL_ENABLED=true or agent action.
 */
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { logger } from "../logging.js";
import { computeFeatures } from "../eval/features/compute.js";
import { stripMetadata } from "../eval/features/types.js";
import { runPrefilters } from "../eval/guardrails/prefilter.js";
import { evaluateAllModels } from "../eval/models/runner.js";
import { computeEnsemble } from "../eval/ensemble/scorer.js";
import { runGuardrails } from "../eval/guardrails/behavioral.js";
import { computeDriftReport } from "../eval/drift.js";
import { getWeights } from "../eval/ensemble/weights.js";
import { extractFeatureCols } from "../eval/routes.js";
import { extractStructuredReasoning } from "../eval/reasoning/extractor.js";
import {
  insertEvaluation, insertModelOutput, insertEvalReasoning,
  getRecentOutcomes, hasRecentEvalForSymbol, insertSignal, getHollyAlertsByBatch,
} from "../db/database.js";
import { appendInboxItem } from "../inbox/store.js";
import type { ImportResult } from "./importer.js";
import type { FeatureVector } from "../eval/features/types.js";

const log = logger.child({ module: "auto-eval" });

let _enabled = config.autoEval.enabled;
let _running = 0; // concurrent eval count

// Strategy → direction mapping (case-insensitive keyword match)
const DIRECTION_MAP: Array<[RegExp, "long" | "short"]> = [
  [/bear|short|put|fade|breakdown/i, "short"],
  [/bull|long|call|breakout|momentum|gap.?up/i, "long"],
];

function inferDirection(strategy: string | null | undefined): "long" | "short" {
  if (!strategy) return "long";
  for (const [pattern, direction] of DIRECTION_MAP) {
    if (pattern.test(strategy)) return direction;
  }
  return "long"; // default to long
}

export function isAutoEvalEnabled(): boolean { return _enabled; }

export function setAutoEvalEnabled(enabled: boolean): void {
  _enabled = enabled;
  log.info({ enabled }, "Auto-eval toggled");
}

export function getAutoEvalStatus(): {
  enabled: boolean;
  running: number;
  maxConcurrent: number;
  dedupWindowMin: number;
} {
  return {
    enabled: _enabled,
    running: _running,
    maxConcurrent: config.autoEval.maxConcurrent,
    dedupWindowMin: config.autoEval.dedupWindowMin,
  };
}

/**
 * Process newly imported holly alerts through the eval pipeline.
 * Called from watcher.ts after a successful import with inserted > 0.
 */
export async function processNewAlerts(
  result: ImportResult,
  broadcastSignal?: (data: unknown) => void,
): Promise<{ evaluated: number; skipped: number; errors: number }> {
  if (!_enabled) {
    return { evaluated: 0, skipped: 0, errors: 0 };
  }

  if (result.inserted === 0) {
    return { evaluated: 0, skipped: 0, errors: 0 };
  }

  const alerts = getHollyAlertsByBatch(result.batch_id);
  if (alerts.length === 0) {
    return { evaluated: 0, skipped: 0, errors: 0 };
  }

  // Deduplicate: group by symbol, keep first alert per symbol
  const symbolMap = new Map<string, Record<string, unknown>>();
  for (const alert of alerts) {
    const sym = (alert.symbol as string).toUpperCase();
    if (!symbolMap.has(sym)) symbolMap.set(sym, alert);
  }

  let evaluated = 0;
  let skipped = 0;
  let errors = 0;

  const pending: Promise<void>[] = [];

  for (const [symbol, alert] of symbolMap) {
    // Dedup: skip if we already have a recent signal for this symbol
    if (hasRecentEvalForSymbol(symbol, config.autoEval.dedupWindowMin)) {
      skipped++;
      log.debug({ symbol }, "Auto-eval skipped (recent eval exists)");
      continue;
    }

    // Rate limit: wait if at max concurrent
    if (_running >= config.autoEval.maxConcurrent) {
      log.debug({ symbol, running: _running }, "Auto-eval queued (at max concurrent)");
      // Wait for one to finish
      if (pending.length > 0) {
        await Promise.race(pending);
      }
    }

    const p = runSingleEval(symbol, alert, broadcastSignal)
      .then(() => { evaluated++; })
      .catch((err) => {
        errors++;
        log.error({ err, symbol }, "Auto-eval failed for symbol");
      })
      .finally(() => { _running--; });

    _running++;
    pending.push(p);
  }

  // Wait for all remaining
  await Promise.allSettled(pending);

  log.info({ evaluated, skipped, errors, batch: result.batch_id }, "Auto-eval batch complete");
  return { evaluated, skipped, errors };
}

async function runSingleEval(
  symbol: string,
  alert: Record<string, unknown>,
  broadcastSignal?: (data: unknown) => void,
): Promise<void> {
  const direction = inferDirection(alert.strategy as string | null);
  const entryPrice = typeof alert.entry_price === "number" ? alert.entry_price : null;
  const stopPrice = typeof alert.stop_price === "number" ? alert.stop_price : null;
  const hollyAlertId = alert.id as number;

  const id = randomUUID();
  const totalStart = Date.now();
  log.info({ id: id.slice(0, 8), symbol, direction }, "Auto-eval starting");

  // Step 1: Compute features
  const { features, latencyMs: featureLatency } = await computeFeatures(symbol, direction);

  // Step 2: Pre-filter
  const prefilter = runPrefilters(features);
  if (!prefilter.passed) {
    log.info({ id: id.slice(0, 8), symbol, flags: prefilter.flags }, "Auto-eval pre-filter blocked");

    insertEvaluation({
      id, symbol: features.symbol, direction, entry_price: entryPrice, stop_price: stopPrice,
      user_notes: `auto-eval from holly alert #${hollyAlertId}`,
      holly_alert_id: hollyAlertId,
      timestamp: features.timestamp,
      features_json: JSON.stringify(features),
      ...extractFeatureCols(features),
      ensemble_trade_score: 0, ensemble_trade_score_median: 0,
      ensemble_expected_rr: 0, ensemble_confidence: 0,
      ensemble_should_trade: 0, ensemble_unanimous: 1, ensemble_majority_trade: 0,
      ensemble_score_spread: 0, ensemble_disagreement_penalty: 0,
      weights_json: JSON.stringify(getWeights()),
      guardrail_allowed: 0, guardrail_flags_json: JSON.stringify(prefilter.flags),
      prefilter_passed: 0, feature_latency_ms: featureLatency,
      total_latency_ms: Date.now() - totalStart,
    });

    const signalId = insertSignal({
      holly_alert_id: hollyAlertId, evaluation_id: id,
      symbol, direction, strategy: (alert.strategy as string) ?? null,
      ensemble_score: 0, should_trade: 0, prefilter_passed: 0,
    });

    broadcastSignal?.({
      signal_id: signalId, symbol, direction, strategy: alert.strategy,
      ensemble_score: 0, should_trade: false, prefilter_blocked: true,
      evaluation_id: id, alert_time: alert.alert_time,
    });
    return;
  }

  // Step 3: Run 3 models in parallel
  const modelFeatures = stripMetadata(features);
  const { evaluations, promptHash } = await evaluateAllModels(
    symbol, direction, entryPrice, stopPrice, modelFeatures,
  );

  // Step 4: Compute ensemble
  const ensemble = computeEnsemble(evaluations);

  // Step 5: Guardrails
  const guardrail = runGuardrails(ensemble, getRecentOutcomes, () => computeDriftReport());

  const totalLatency = Date.now() - totalStart;

  // Step 6: Store evaluation
  insertEvaluation({
    id, symbol: features.symbol, direction, entry_price: entryPrice, stop_price: stopPrice,
    user_notes: `auto-eval from holly alert #${hollyAlertId}`,
    holly_alert_id: hollyAlertId,
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
    prefilter_passed: 1, feature_latency_ms: featureLatency,
    total_latency_ms: totalLatency,
  });

  // Store model outputs + reasoning
  for (const e of evaluations) {
    insertModelOutput({
      evaluation_id: id, model_id: e.model_id,
      trade_score: e.output?.trade_score ?? null,
      extension_risk: e.output?.extension_risk ?? null,
      exhaustion_risk: e.output?.exhaustion_risk ?? null,
      float_rotation_risk: e.output?.float_rotation_risk ?? null,
      market_alignment_score: e.output?.market_alignment ?? null,
      expected_rr: e.output?.expected_rr ?? null,
      confidence: e.output?.confidence ?? null,
      should_trade: e.output?.should_trade != null ? (e.output.should_trade ? 1 : 0) : null,
      reasoning: e.output?.reasoning ?? null,
      raw_response: e.raw_response, compliant: e.compliant ? 1 : 0,
      error: e.error, latency_ms: e.latency_ms,
      model_version: e.model_version, prompt_hash: e.prompt_hash,
      token_count: e.token_count, api_response_id: e.api_response_id,
      timestamp: e.timestamp,
    });

    if (e.compliant && e.output?.reasoning) {
      try {
        const structured = extractStructuredReasoning(
          e.output.reasoning, e.output.confidence ?? null, e.output.trade_score ?? null,
        );
        insertEvalReasoning({
          evaluation_id: id, model_id: e.model_id,
          key_drivers: JSON.stringify(structured.key_drivers),
          risk_factors: JSON.stringify(structured.risk_factors),
          uncertainties: JSON.stringify(structured.uncertainties),
          conviction: structured.conviction,
        });
      } catch { /* non-fatal */ }
    }
  }

  // Step 7: Insert signal
  const signalId = insertSignal({
    holly_alert_id: hollyAlertId, evaluation_id: id,
    symbol, direction, strategy: (alert.strategy as string) ?? null,
    ensemble_score: ensemble.trade_score, should_trade: ensemble.should_trade ? 1 : 0,
    prefilter_passed: 1,
  });

  log.info({
    id: id.slice(0, 8), symbol, score: ensemble.trade_score,
    should_trade: ensemble.should_trade, latency: totalLatency,
  }, "Auto-eval complete");

  // Broadcast via WebSocket
  broadcastSignal?.({
    signal_id: signalId, symbol, direction, strategy: alert.strategy,
    ensemble_score: ensemble.trade_score, should_trade: ensemble.should_trade,
    evaluation_id: id, alert_time: alert.alert_time, latency_ms: totalLatency,
  });

  // Inbox: notify on ensemble signals (full eval only, not prefilter blocks)
  try {
    const verdict = ensemble.should_trade ? "TRADE" : "NO TRADE";
    appendInboxItem({
      type: "signal",
      symbol,
      title: `${symbol} ${direction.toUpperCase()} → ${verdict} (score ${ensemble.trade_score.toFixed(1)})`,
      body: {
        signal_id: signalId, evaluation_id: id, direction,
        strategy: alert.strategy, ensemble_score: ensemble.trade_score,
        should_trade: ensemble.should_trade, latency_ms: totalLatency,
      },
    });
  } catch { /* non-fatal */ }
}

// Export for testing
export const _testing = { inferDirection, DIRECTION_MAP };
