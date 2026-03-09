/**
 * Evaluations, model outputs, outcomes, and eval stats domain module.
 */

import { getDb, getStmts, runEvalInsert } from "./connection.js";
const stmts = getStmts();

/**
 * Insert a new evaluation record.
 * @param row Evaluation data
 */
export function insertEvaluation(row: Record<string, unknown>): void {
  runEvalInsert("evaluations", row);
}

/**
 * Insert a model output record.
 * @param row Model output data
 */
export function insertModelOutput(row: Record<string, unknown>): void {
  runEvalInsert("model_outputs", row);
}

/**
 * Insert a trade outcome record.
 * @param row Outcome data
 */
export function insertOutcome(row: Record<string, unknown>): void {
  runEvalInsert("outcomes", row);
}

/**
 * Insert extracted reasoning data.
 * @param row Reasoning data
 */
export function insertEvalReasoning(row: Record<string, unknown>): void {
  runEvalInsert("eval_reasoning", row);
}

/**
 * Get structured reasoning for an evaluation.
 * @param evaluationId Evaluation ID
 * @returns Array of reasoning records
 */
export function getReasoningForEval(evaluationId: string): Record<string, unknown>[] {
  return stmts.queryReasoningByEval.all(evaluationId) as Record<string, unknown>[];
}

/**
 * Get evaluation by ID.
 * @param id Evaluation ID
 * @returns Evaluation record or undefined
 */
export function getEvaluationById(id: string): Record<string, unknown> | undefined {
  return stmts.getEvaluationById.get(id) as Record<string, unknown> | undefined;
}

/**
 * Get recent evaluations.
 * @param limit Max records
 * @param symbol Optional symbol filter
 * @returns Array of evaluations
 */
export function getRecentEvaluations(limit: number = 50, symbol?: string): Record<string, unknown>[] {
  if (symbol) return stmts.queryEvaluationsBySymbol.all(symbol, limit) as Record<string, unknown>[];
  return stmts.queryEvaluations.all(limit) as Record<string, unknown>[];
}

/**
 * Get recent trade outcomes.
 * @param limit Max outcomes
 * @returns Array of outcomes
 */
export function getRecentOutcomes(limit: number = 20): Array<Record<string, unknown>> {
  return stmts.queryRecentOutcomes.all(limit) as Array<Record<string, unknown>>;
}

/**
 * Count total recorded outcomes.
 * @returns Count
 */
export function getOutcomeCount(): number {
  const row = stmts.countOutcomes.get() as { n?: number } | undefined;
  return row?.n ?? 0;
}

/**
 * Get model outputs for a specific evaluation.
 * @param evaluationId Evaluation ID
 * @returns Array of model outputs
 */
export function getModelOutputsForEval(evaluationId: string): Record<string, unknown>[] {
  return stmts.queryModelOutputsByEval.all(evaluationId) as Record<string, unknown>[];
}

/**
 * Get the outcome for an evaluation.
 * @param evaluationId Evaluation ID
 * @returns Outcome record or undefined
 */
export function getOutcomeForEval(evaluationId: string): Record<string, unknown> | undefined {
  return stmts.getOutcomeByEval.get(evaluationId) as Record<string, unknown> | undefined;
}

/**
 * Compute aggregate evaluation statistics.
 * @returns Stats object
 */
export function getEvalStats(): Record<string, unknown> {
  const db = getDb();
  const totalEvals = (stmts.countEvaluations.get() as { n: number } | undefined)?.n ?? 0;
  const totalOutcomes = (stmts.countOutcomes.get() as { n: number } | undefined)?.n ?? 0;
  const modelStats = stmts.modelStats.all() as Array<{ model_id: string; total: number; compliant: number; avg_score: number | null; avg_confidence: number | null; avg_latency_ms: number | null }>;

  // Calculate aggregate stats
  const evalAggregates = db.prepare(`
    SELECT
      AVG(ensemble_trade_score) as avg_score,
      AVG(total_latency_ms) as avg_latency_ms,
      SUM(CASE WHEN ensemble_should_trade = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as trade_rate,
      SUM(CASE WHEN guardrail_allowed = 0 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as guardrail_block_rate
    FROM evaluations
    WHERE prefilter_passed = 1
  `).get() as Record<string, number | null> | undefined;

  const outcomeAggregates = db.prepare(`
    SELECT
      AVG(r_multiple) as avg_r_multiple,
      COUNT(*) as outcomes_recorded,
      SUM(CASE WHEN r_multiple > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN r_multiple <= 0 THEN 1 ELSE 0 END) as losses
    FROM outcomes
    WHERE trade_taken = 1 AND r_multiple IS NOT NULL
  `).get() as Record<string, number | null> | undefined;

  const wins = outcomeAggregates?.wins ?? 0;
  const losses = outcomeAggregates?.losses ?? 0;
  const totalTrades = wins + losses;

  // Build model_compliance map
  const modelCompliance: Record<string, number> = {};
  for (const m of modelStats) {
    if (m.total > 0) {
      modelCompliance[m.model_id] = m.compliant / m.total;
    }
  }

  return {
    total_evaluations: totalEvals,
    avg_score: evalAggregates?.avg_score ?? 0,
    avg_latency_ms: evalAggregates?.avg_latency_ms ?? 0,
    trade_rate: evalAggregates?.trade_rate ?? 0,
    guardrail_block_rate: evalAggregates?.guardrail_block_rate ?? 0,
    model_compliance: modelCompliance,
    outcomes_recorded: outcomeAggregates?.outcomes_recorded ?? 0,
    avg_r_multiple: outcomeAggregates?.avg_r_multiple ?? null,
    wins,
    losses,
    win_rate: totalTrades > 0 ? wins / totalTrades : null,
    model_stats: modelStats,
  };
}
