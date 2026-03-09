/**
 * Eval analytics — outcomes, simulation data, daily summaries, drift queries.
 */

import { getDb } from "./connection.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface EvalOutcomeRow {
  evaluation_id: string;
  symbol: string;
  direction: string;
  timestamp: string;
  ensemble_trade_score: number;
  ensemble_should_trade: number;
  ensemble_confidence: number;
  ensemble_expected_rr: number;
  time_of_day: string;
  volatility_regime: string;
  liquidity_bucket: string;
  rvol: number;
  trade_taken: number;
  decision_type: string | null;
  confidence_rating: number | null;
  rule_followed: number | null;
  setup_type: string | null;
  r_multiple: number | null;
  exit_reason: string | null;
  recorded_at: string;
}

export interface SimulationEvalRow {
  evaluation_id: string;
  symbol: string;
  direction: string;
  timestamp: string;
  ensemble_trade_score: number;
  ensemble_should_trade: number;
  r_multiple: number | null;
  trade_taken: number | null;
  model_outputs: Array<{
    model_id: string;
    trade_score: number | null;
    expected_rr: number | null;
    confidence: number | null;
    should_trade: number | null;
    compliant: number;
  }>;
}

export interface DailySummaryRow {
  session_date: string;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_r: number | null;
  best_r: number | null;
  worst_r: number | null;
  total_r: number | null;
  symbols_traded: string;
}

// ── Functions ────────────────────────────────────────────────────────────

/**
 * Get evaluations joined with outcomes — the core data for calibration,
 * regime analysis, and weight recalibration analytics.
 */
export function getEvalOutcomes(opts: {
  limit?: number;
  symbol?: string;
  days?: number;
  tradesTakenOnly?: boolean;
} = {}): EvalOutcomeRow[] {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 500, 2000);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.tradesTakenOnly !== false) {
    conditions.push("o.trade_taken = 1");
  }
  if (opts.symbol) {
    conditions.push("e.symbol = ?");
    params.push(opts.symbol);
  }
  if (opts.days) {
    conditions.push("e.timestamp >= datetime('now', ? || ' days')");
    params.push(`-${opts.days}`);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  return db.prepare(`
    SELECT
      e.id as evaluation_id,
      e.symbol,
      e.direction,
      e.timestamp,
      e.ensemble_trade_score,
      e.ensemble_should_trade,
      e.ensemble_confidence,
      e.ensemble_expected_rr,
      e.time_of_day,
      e.volatility_regime,
      e.liquidity_bucket,
      e.rvol,
      o.trade_taken,
      o.decision_type,
      o.confidence_rating,
      o.rule_followed,
      o.setup_type,
      o.r_multiple,
      o.exit_reason,
      o.recorded_at
    FROM evaluations e
    JOIN outcomes o ON o.evaluation_id = e.id
    ${where}
    ORDER BY e.timestamp DESC
    LIMIT ?
  `).all(...params, limit) as EvalOutcomeRow[];
}

/**
 * Pull historical evaluations with model outputs and outcomes for weight simulation.
 * Only includes evals that passed pre-filter (real scoring decisions).
 */
export function getEvalsForSimulation(opts: { days?: number; symbol?: string } = {}): SimulationEvalRow[] {
  const db = getDb();
  const days = opts.days ?? 90;

  let whereClause = "WHERE e.prefilter_passed = 1 AND e.timestamp >= datetime('now', ? || ' days')";
  const params: unknown[] = [`-${days}`];

  if (opts.symbol) {
    whereClause += " AND e.symbol = ?";
    params.push(opts.symbol);
  }

  const evals = db.prepare(`
    SELECT
      e.id as evaluation_id,
      e.symbol,
      e.direction,
      e.timestamp,
      e.ensemble_trade_score,
      e.ensemble_should_trade,
      o.r_multiple,
      o.trade_taken
    FROM evaluations e
    LEFT JOIN outcomes o ON o.evaluation_id = e.id
    ${whereClause}
    ORDER BY e.timestamp DESC
  `).all(...params) as Array<{
    evaluation_id: string;
    symbol: string;
    direction: string;
    timestamp: string;
    ensemble_trade_score: number;
    ensemble_should_trade: number;
    r_multiple: number | null;
    trade_taken: number | null;
  }>;

  // Batch-load model outputs for all evals
  const evalIds = evals.map((e) => e.evaluation_id);
  if (evalIds.length === 0) return [];

  const placeholders = evalIds.map(() => "?").join(",");
  const outputs = db.prepare(`
    SELECT evaluation_id, model_id, trade_score, expected_rr, confidence, should_trade, compliant
    FROM model_outputs
    WHERE evaluation_id IN (${placeholders})
  `).all(...evalIds) as Array<{
    evaluation_id: string;
    model_id: string;
    trade_score: number | null;
    expected_rr: number | null;
    confidence: number | null;
    should_trade: number | null;
    compliant: number;
  }>;

  // Group outputs by evaluation_id
  const outputMap = new Map<string, typeof outputs>();
  for (const o of outputs) {
    const arr = outputMap.get(o.evaluation_id) ?? [];
    arr.push(o);
    outputMap.set(o.evaluation_id, arr);
  }

  return evals.map((e) => ({
    ...e,
    model_outputs: outputMap.get(e.evaluation_id) ?? [],
  }));
}

/**
 * Get daily session summaries — P&L, win rate, avg R grouped by date.
 * Win = r_multiple > 0, Loss = r_multiple <= 0.
 */
export function getDailySummaries(opts: { days?: number; date?: string } = {}): DailySummaryRow[] {
  const db = getDb();
  if (opts.date) {
    // Single day
    return db.prepare(`
      SELECT
        DATE(o.recorded_at) as session_date,
        COUNT(*) as total_trades,
        SUM(CASE WHEN o.r_multiple > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN o.r_multiple <= 0 THEN 1 ELSE 0 END) as losses,
        CAST(SUM(CASE WHEN o.r_multiple > 0 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) as win_rate,
        AVG(o.r_multiple) as avg_r,
        MAX(o.r_multiple) as best_r,
        MIN(o.r_multiple) as worst_r,
        SUM(o.r_multiple) as total_r,
        GROUP_CONCAT(DISTINCT e.symbol) as symbols_traded
      FROM outcomes o
      JOIN evaluations e ON o.evaluation_id = e.id
      WHERE o.trade_taken = 1 AND o.r_multiple IS NOT NULL
        AND DATE(o.recorded_at) = ?
      GROUP BY DATE(o.recorded_at)
    `).all(opts.date) as DailySummaryRow[];
  }

  // Multiple days (default: last 30)
  const days = opts.days ?? 30;
  return db.prepare(`
    SELECT
      DATE(o.recorded_at) as session_date,
      COUNT(*) as total_trades,
      SUM(CASE WHEN o.r_multiple > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN o.r_multiple <= 0 THEN 1 ELSE 0 END) as losses,
      CAST(SUM(CASE WHEN o.r_multiple > 0 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) as win_rate,
      AVG(o.r_multiple) as avg_r,
      MAX(o.r_multiple) as best_r,
      MIN(o.r_multiple) as worst_r,
      SUM(o.r_multiple) as total_r,
      GROUP_CONCAT(DISTINCT e.symbol) as symbols_traded
    FROM outcomes o
    JOIN evaluations e ON o.evaluation_id = e.id
    WHERE o.trade_taken = 1 AND o.r_multiple IS NOT NULL
      AND o.recorded_at >= datetime('now', ? || ' days')
    GROUP BY DATE(o.recorded_at)
    ORDER BY session_date DESC
  `).all(`-${days}`) as DailySummaryRow[];
}

/**
 * Get today's trades as individual rows (for detailed session view).
 */
export function getTodaysTrades(): Array<Record<string, unknown>> {
  return getDb().prepare(`
    SELECT
      e.id as evaluation_id,
      e.symbol,
      e.direction,
      e.ensemble_trade_score,
      e.ensemble_should_trade,
      e.time_of_day,
      o.actual_entry_price,
      o.actual_exit_price,
      o.r_multiple,
      o.exit_reason,
      o.notes,
      o.recorded_at
    FROM outcomes o
    JOIN evaluations e ON o.evaluation_id = e.id
    WHERE o.trade_taken = 1
      AND DATE(o.recorded_at) = DATE('now')
    ORDER BY o.recorded_at DESC
  `).all() as Array<Record<string, unknown>>;
}

/**
 * Get per-model confidence + r_multiple for drift calibration.
 * Joins model_outputs with outcomes for trades that have both.
 * @param days Lookback period in days
 * @returns Array of outcomes
 */
export function getModelOutcomesForDrift(days: number = 90): Array<Record<string, unknown>> {
  return getDb().prepare(`
    SELECT
      m.model_id,
      m.confidence,
      o.r_multiple
    FROM model_outputs m
    JOIN evaluations e ON m.evaluation_id = e.id
    JOIN outcomes o ON o.evaluation_id = e.id
    WHERE m.compliant = 1
      AND o.trade_taken = 1
      AND o.r_multiple IS NOT NULL
      AND m.confidence IS NOT NULL
      AND e.timestamp >= datetime('now', ? || ' days')
    ORDER BY e.timestamp DESC
  `).all(`-${days}`) as Array<Record<string, unknown>>;
}
