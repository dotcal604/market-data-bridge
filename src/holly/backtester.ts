/**
 * Holly Reverse-Engineering & Backtest Engine
 *
 * 1. Reverse-engineers Holly alert trigger conditions by analyzing feature
 *    distributions of alerts that triggered vs the broader evaluation population.
 *    Extracts decision boundaries (thresholds) per feature per strategy.
 *
 * 2. Backtests extracted rules against any symbol universe across any timeframe
 *    using stored evaluation data. Measures precision (alerts that were tradeable),
 *    recall (tradeable setups caught), and P&L via r_multiple.
 *
 * 3. Produces strategy-level and aggregate reports: which Holly strategies have
 *    real edge, which features matter most, and optimal trigger thresholds.
 */

import { getDb } from "../db/database.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "holly-backtester" });

// ── Types ────────────────────────────────────────────────────────────────

/** A single feature threshold rule extracted from Holly trigger analysis. */
export interface FeatureRule {
  feature: string;
  direction: "above" | "below";   // alert fires when value is above/below threshold
  threshold: number;
  triggered_mean: number;          // mean of this feature in triggered alerts
  baseline_mean: number;           // mean in non-triggered evaluations
  separation: number;              // effect size (Cohen's d)
  importance: number;              // 0-1, how important this rule is
}

/** Complete set of rules for one Holly strategy. */
export interface StrategyRuleSet {
  strategy: string;
  rules: FeatureRule[];
  alert_count: number;             // historical alerts used to derive rules
  tradeable_pct: number;           // % of alerts where ensemble said should_trade
  avg_score: number;               // avg ensemble score for triggered alerts
}

/** Single backtest trade result. */
export interface BacktestTrade {
  evaluation_id: string;
  symbol: string;
  timestamp: string;
  strategy_matched: string;
  match_score: number;              // how many rules matched (0-1)
  ensemble_score: number;
  should_trade: boolean;
  r_multiple: number | null;        // null if no outcome recorded
  direction: string;
}

/** Backtest results for one strategy. */
export interface StrategyBacktestResult {
  strategy: string;
  total_signals: number;             // evaluations matching the rule set
  tradeable_signals: number;         // signals where ensemble said should_trade
  precision: number;                 // tradeable / total (signal quality)
  trades_with_outcome: number;       // trades that have r_multiple recorded
  win_rate: number;                  // % of outcomes with r > 0
  avg_r: number;                     // average r_multiple
  total_r: number;                   // sum of r_multiples
  sharpe: number;                    // R-based Sharpe
  profit_factor: number;             // gross profit / gross loss
  max_drawdown: number;              // peak-to-trough in R
  best_r: number;
  worst_r: number;
  avg_match_score: number;           // how well signals matched rules
  rule_count: number;
  top_rules: FeatureRule[];          // top 5 most important rules
}

/** Full backtest report. */
export interface BacktestReport {
  timeframe: { start: string; end: string; days: number };
  universe_size: number;
  total_evaluations_scanned: number;
  strategies: StrategyBacktestResult[];
  aggregate: {
    total_signals: number;
    total_trades: number;
    win_rate: number;
    avg_r: number;
    total_r: number;
    sharpe: number;
    profit_factor: number;
    best_strategy: string | null;
    worst_strategy: string | null;
  };
  rule_sets: StrategyRuleSet[];      // the extracted rules used
}

// ── Feature constants ────────────────────────────────────────────────────

const NUMERIC_FEATURES = [
  "rvol",
  "vwap_deviation_pct",
  "spread_pct",
  "volume_acceleration",
  "atr_pct",
  "gap_pct",
  "range_position_pct",
  "price_extension_pct",
  "spy_change_pct",
  "qqq_change_pct",
  "minutes_since_open",
] as const;

// ── Rule Extraction ──────────────────────────────────────────────────────

/**
 * Reverse-engineer Holly alert trigger conditions.
 *
 * Compares feature distributions of Holly-triggered evaluations vs the
 * general evaluation population. Features with significant separation
 * (Cohen's d > 0.3) become rules with thresholds at the midpoint.
 */
export function extractRules(opts: {
  minAlerts?: number;
  minSeparation?: number;
  since?: string;
} = {}): StrategyRuleSet[] {
  const { minAlerts = 5, minSeparation = 0.3, since } = opts;
  const db = getDb();

  // Get holly-triggered evaluations with features
  const hollyWhere = since
    ? `AND h.alert_time >= '${since}'`
    : "";
  const hollyRows = db.prepare(`
    SELECT
      h.strategy,
      e.rvol, e.vwap_deviation_pct, e.spread_pct,
      e.volume_acceleration, e.atr_pct, e.gap_pct,
      e.range_position_pct, e.price_extension_pct,
      e.spy_change_pct, e.qqq_change_pct, e.minutes_since_open,
      e.ensemble_trade_score, e.ensemble_should_trade
    FROM holly_alerts h
    JOIN evaluations e ON e.holly_alert_id = h.id
    WHERE e.prefilter_passed = 1 ${hollyWhere}
  `).all() as Array<Record<string, unknown>>;

  // Get baseline: all evaluations NOT linked to holly alerts
  const baselineWhere = since
    ? `AND e.timestamp >= '${since}'`
    : "";
  const baselineRows = db.prepare(`
    SELECT
      e.rvol, e.vwap_deviation_pct, e.spread_pct,
      e.volume_acceleration, e.atr_pct, e.gap_pct,
      e.range_position_pct, e.price_extension_pct,
      e.spy_change_pct, e.qqq_change_pct, e.minutes_since_open
    FROM evaluations e
    WHERE e.holly_alert_id IS NULL
      AND e.prefilter_passed = 1 ${baselineWhere}
  `).all() as Array<Record<string, unknown>>;

  // Compute baseline feature stats
  const baselineStats: Record<string, { mean: number; std: number }> = {};
  for (const feat of NUMERIC_FEATURES) {
    const vals = baselineRows
      .map((r) => r[feat] as number | null)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (vals.length < 3) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    baselineStats[feat] = { mean, std: std || 1 };
  }

  // Group holly by strategy
  const stratGroups = new Map<string, Array<Record<string, unknown>>>();
  for (const row of hollyRows) {
    const strat = (row.strategy as string) ?? "unknown";
    if (!stratGroups.has(strat)) stratGroups.set(strat, []);
    stratGroups.get(strat)!.push(row);
  }

  const ruleSets: StrategyRuleSet[] = [];

  for (const [strategy, rows] of stratGroups) {
    if (rows.length < minAlerts) continue;

    const rules: FeatureRule[] = [];

    for (const feat of NUMERIC_FEATURES) {
      const baseline = baselineStats[feat];
      if (!baseline) continue;

      const trigVals = rows
        .map((r) => r[feat] as number | null)
        .filter((v): v is number => v != null && Number.isFinite(v));
      if (trigVals.length < 3) continue;

      const trigMean = trigVals.reduce((a, b) => a + b, 0) / trigVals.length;

      // Cohen's d: effect size of holly-triggered vs baseline
      const pooledStd = baseline.std;
      const cohensD = Math.abs(trigMean - baseline.mean) / pooledStd;

      if (cohensD < minSeparation) continue;

      // Threshold = midpoint between triggered mean and baseline mean
      const threshold = (trigMean + baseline.mean) / 2;
      const direction: "above" | "below" = trigMean > baseline.mean ? "above" : "below";

      rules.push({
        feature: feat,
        direction,
        threshold: Math.round(threshold * 10000) / 10000,
        triggered_mean: Math.round(trigMean * 10000) / 10000,
        baseline_mean: Math.round(baseline.mean * 10000) / 10000,
        separation: Math.round(cohensD * 1000) / 1000,
        importance: Math.min(1, cohensD / 2), // normalize: d=2 → importance=1
      });
    }

    // Sort by importance descending
    rules.sort((a, b) => b.importance - a.importance);

    const shouldTrade = rows.filter((r) => r.ensemble_should_trade === 1).length;
    const scores = rows
      .map((r) => r.ensemble_trade_score as number | null)
      .filter((v): v is number => v != null);

    ruleSets.push({
      strategy,
      rules,
      alert_count: rows.length,
      tradeable_pct: Math.round((shouldTrade / rows.length) * 1000) / 1000,
      avg_score: scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
        : 0,
    });
  }

  log.info({ strategies: ruleSets.length, totalRules: ruleSets.reduce((s, r) => s + r.rules.length, 0) }, "Rules extracted");
  return ruleSets;
}

// ── Backtest Engine ──────────────────────────────────────────────────────

/**
 * Score an evaluation row against a strategy's rule set.
 * Returns 0-1: fraction of rules that match.
 */
function scoreAgainstRules(
  evalRow: Record<string, unknown>,
  rules: FeatureRule[],
): number {
  if (rules.length === 0) return 0;

  let weightedHits = 0;
  let totalWeight = 0;

  for (const rule of rules) {
    const val = evalRow[rule.feature] as number | null;
    if (val == null || !Number.isFinite(val)) continue;

    totalWeight += rule.importance;
    const match = rule.direction === "above"
      ? val >= rule.threshold
      : val <= rule.threshold;
    if (match) weightedHits += rule.importance;
  }

  return totalWeight > 0 ? weightedHits / totalWeight : 0;
}

/**
 * Run backtest: apply extracted Holly rules to historical evaluations.
 *
 * @param opts.days - lookback period (default 180)
 * @param opts.symbols - restrict to specific symbol universe (optional)
 * @param opts.minMatchScore - min rule-match score to count as signal (0-1, default 0.6)
 * @param opts.since / opts.until - explicit date range (ISO strings)
 * @param opts.ruleSets - pre-built rule sets (optional, extracts fresh if omitted)
 */
export function runBacktest(opts: {
  days?: number;
  symbols?: string[];
  minMatchScore?: number;
  since?: string;
  until?: string;
  ruleSets?: StrategyRuleSet[];
} = {}): BacktestReport {
  const {
    days = 180,
    symbols,
    minMatchScore = 0.6,
    since,
    until,
  } = opts;

  // Extract rules if not provided
  const ruleSets = opts.ruleSets ?? extractRules({ since });
  if (ruleSets.length === 0) {
    return emptyReport(days);
  }

  const db = getDb();

  // Build query for evaluation universe
  const conditions: string[] = ["e.prefilter_passed = 1"];
  const params: unknown[] = [];

  if (since) {
    conditions.push("e.timestamp >= ?");
    params.push(since);
  } else {
    conditions.push("e.timestamp >= datetime('now', ? || ' days')");
    params.push(`-${days}`);
  }
  if (until) {
    conditions.push("e.timestamp <= ?");
    params.push(until);
  }
  if (symbols && symbols.length > 0) {
    conditions.push(`e.symbol IN (${symbols.map(() => "?").join(",")})`);
    params.push(...symbols.map((s) => s.toUpperCase()));
  }

  const sql = `
    SELECT
      e.id as evaluation_id,
      e.symbol,
      e.direction,
      e.timestamp,
      e.rvol, e.vwap_deviation_pct, e.spread_pct,
      e.volume_acceleration, e.atr_pct, e.gap_pct,
      e.range_position_pct, e.price_extension_pct,
      e.spy_change_pct, e.qqq_change_pct, e.minutes_since_open,
      e.ensemble_trade_score,
      e.ensemble_should_trade,
      o.r_multiple,
      o.trade_taken
    FROM evaluations e
    LEFT JOIN outcomes o ON o.evaluation_id = e.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY e.timestamp ASC
  `;

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

  // Derive timeframe and universe
  const uniqueSymbols = new Set(rows.map((r) => r.symbol as string));
  const timestamps = rows.map((r) => r.timestamp as string).filter(Boolean);
  const timeframe = {
    start: timestamps[0] ?? "",
    end: timestamps[timestamps.length - 1] ?? "",
    days,
  };

  // Score each evaluation against each strategy's rule set
  const allTrades: BacktestTrade[] = [];

  for (const ruleSet of ruleSets) {
    if (ruleSet.rules.length === 0) continue;

    for (const row of rows) {
      const matchScore = scoreAgainstRules(row, ruleSet.rules);
      if (matchScore < minMatchScore) continue;

      allTrades.push({
        evaluation_id: row.evaluation_id as string,
        symbol: row.symbol as string,
        timestamp: row.timestamp as string,
        strategy_matched: ruleSet.strategy,
        match_score: Math.round(matchScore * 1000) / 1000,
        ensemble_score: (row.ensemble_trade_score as number) ?? 0,
        should_trade: row.ensemble_should_trade === 1,
        r_multiple: typeof row.r_multiple === "number" ? row.r_multiple : null,
        direction: (row.direction as string) ?? "long",
      });
    }
  }

  // Compute per-strategy results
  const stratResults: StrategyBacktestResult[] = [];

  const tradesByStrategy = new Map<string, BacktestTrade[]>();
  for (const t of allTrades) {
    if (!tradesByStrategy.has(t.strategy_matched)) tradesByStrategy.set(t.strategy_matched, []);
    tradesByStrategy.get(t.strategy_matched)!.push(t);
  }

  for (const ruleSet of ruleSets) {
    const trades = tradesByStrategy.get(ruleSet.strategy) ?? [];
    stratResults.push(computeStrategyResult(ruleSet, trades));
  }

  // Aggregate
  const allWithOutcomes = allTrades.filter((t) => t.r_multiple != null);
  const wins = allWithOutcomes.filter((t) => t.r_multiple! > 0);
  const rValues = allWithOutcomes.map((t) => t.r_multiple!);
  const totalR = rValues.reduce((a, b) => a + b, 0);
  const avgR = rValues.length > 0 ? totalR / rValues.length : 0;
  const grossProfit = rValues.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(rValues.filter((r) => r < 0).reduce((a, b) => a + b, 0));

  const bestStrat = stratResults.length > 0
    ? stratResults.reduce((a, b) => a.total_r > b.total_r ? a : b).strategy
    : null;
  const worstStrat = stratResults.length > 0
    ? stratResults.reduce((a, b) => a.total_r < b.total_r ? a : b).strategy
    : null;

  return {
    timeframe,
    universe_size: uniqueSymbols.size,
    total_evaluations_scanned: rows.length,
    strategies: stratResults,
    aggregate: {
      total_signals: allTrades.length,
      total_trades: allWithOutcomes.length,
      win_rate: allWithOutcomes.length > 0
        ? Math.round((wins.length / allWithOutcomes.length) * 1000) / 1000
        : 0,
      avg_r: Math.round(avgR * 1000) / 1000,
      total_r: Math.round(totalR * 1000) / 1000,
      sharpe: computeSharpe(rValues),
      profit_factor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? 999 : 0,
      best_strategy: bestStrat,
      worst_strategy: worstStrat,
    },
    rule_sets: ruleSets,
  };
}

function computeStrategyResult(
  ruleSet: StrategyRuleSet,
  trades: BacktestTrade[],
): StrategyBacktestResult {
  const tradeable = trades.filter((t) => t.should_trade);
  const withOutcome = trades.filter((t) => t.r_multiple != null);
  const rValues = withOutcome.map((t) => t.r_multiple!);
  const wins = rValues.filter((r) => r > 0);
  const totalR = rValues.reduce((a, b) => a + b, 0);
  const grossProfit = rValues.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(rValues.filter((r) => r < 0).reduce((a, b) => a + b, 0));

  // Max drawdown
  let peak = 0;
  let equity = 0;
  let maxDd = 0;
  for (const r of rValues) {
    equity += r;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }

  return {
    strategy: ruleSet.strategy,
    total_signals: trades.length,
    tradeable_signals: tradeable.length,
    precision: trades.length > 0 ? Math.round((tradeable.length / trades.length) * 1000) / 1000 : 0,
    trades_with_outcome: withOutcome.length,
    win_rate: withOutcome.length > 0 ? Math.round((wins.length / withOutcome.length) * 1000) / 1000 : 0,
    avg_r: rValues.length > 0 ? Math.round((totalR / rValues.length) * 1000) / 1000 : 0,
    total_r: Math.round(totalR * 1000) / 1000,
    sharpe: computeSharpe(rValues),
    profit_factor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? 999 : 0,
    max_drawdown: Math.round(maxDd * 1000) / 1000,
    best_r: rValues.length > 0 ? Math.max(...rValues) : 0,
    worst_r: rValues.length > 0 ? Math.min(...rValues) : 0,
    avg_match_score: trades.length > 0
      ? Math.round((trades.reduce((a, t) => a + t.match_score, 0) / trades.length) * 1000) / 1000
      : 0,
    rule_count: ruleSet.rules.length,
    top_rules: ruleSet.rules.slice(0, 5),
  };
}

function computeSharpe(rValues: number[]): number {
  if (rValues.length < 2) return 0;
  const mean = rValues.reduce((a, b) => a + b, 0) / rValues.length;
  const std = Math.sqrt(rValues.reduce((a, b) => a + (b - mean) ** 2, 0) / (rValues.length - 1));
  return std > 0 ? Math.round((mean / std) * 1000) / 1000 : 0;
}

function emptyReport(days: number): BacktestReport {
  return {
    timeframe: { start: "", end: "", days },
    universe_size: 0,
    total_evaluations_scanned: 0,
    strategies: [],
    aggregate: {
      total_signals: 0, total_trades: 0, win_rate: 0, avg_r: 0,
      total_r: 0, sharpe: 0, profit_factor: 0,
      best_strategy: null, worst_strategy: null,
    },
    rule_sets: [],
  };
}

// ── Convenience: Quick Strategy Breakdown ────────────────────────────────

/**
 * Quick breakdown: for each Holly strategy, what are the defining features
 * and how do they perform historically? Lighter than full backtest.
 */
export function getStrategyBreakdown(opts: {
  since?: string;
} = {}): {
  strategies: Array<{
    strategy: string;
    alert_count: number;
    tradeable_pct: number;
    avg_ensemble_score: number;
    top_features: Array<{
      feature: string;
      direction: string;
      separation: number;
      triggered_mean: number;
      baseline_mean: number;
    }>;
    outcome_summary: {
      trades_with_outcome: number;
      win_rate: number;
      avg_r: number;
      total_r: number;
    } | null;
  }>;
} {
  const db = getDb();
  const ruleSets = extractRules({ since: opts.since });

  const strategies = ruleSets.map((rs) => {
    // Get outcome data for this strategy
    const outcomeRows = db.prepare(`
      SELECT o.r_multiple
      FROM holly_alerts h
      JOIN evaluations e ON e.holly_alert_id = h.id
      JOIN outcomes o ON o.evaluation_id = e.id
      WHERE h.strategy = ?
        AND o.trade_taken = 1
        AND o.r_multiple IS NOT NULL
    `).all(rs.strategy) as Array<{ r_multiple: number }>;

    const rValues = outcomeRows.map((r) => r.r_multiple);
    const wins = rValues.filter((r) => r > 0);

    return {
      strategy: rs.strategy,
      alert_count: rs.alert_count,
      tradeable_pct: rs.tradeable_pct,
      avg_ensemble_score: rs.avg_score,
      top_features: rs.rules.slice(0, 5).map((r) => ({
        feature: r.feature,
        direction: r.direction,
        separation: r.separation,
        triggered_mean: r.triggered_mean,
        baseline_mean: r.baseline_mean,
      })),
      outcome_summary: rValues.length > 0 ? {
        trades_with_outcome: rValues.length,
        win_rate: Math.round((wins.length / rValues.length) * 1000) / 1000,
        avg_r: Math.round((rValues.reduce((a, b) => a + b, 0) / rValues.length) * 1000) / 1000,
        total_r: Math.round(rValues.reduce((a, b) => a + b, 0) * 1000) / 1000,
      } : null,
    };
  });

  return { strategies };
}
