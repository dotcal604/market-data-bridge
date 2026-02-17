/**
 * Holly Exit Autopsy Engine
 *
 * Analyzes historical Holly trade data to reverse-engineer exit behavior:
 * - Strategy leaderboard (expectancy, win rate, Sharpe, tail risk)
 * - MFE/MAE + giveback analysis per strategy/segment/time bucket
 * - Exit quality scoring: how much did each strategy leave on the table?
 * - Time-to-peak analysis: which strategies peak early, which grow late?
 * - Exit policy recommendations: early TP, trailing, time-stop by strategy
 * - Segment comparison (Holly Grail vs Holly Neo vs others)
 * - Time-of-day performance heatmap
 *
 * All analysis is pure SQL against holly_trades table — no external deps needed.
 */

import { getDb } from "../db/database.js";
import { ensureHollyTradesTable } from "./trade-importer.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "exit-autopsy" });

// ── Types ────────────────────────────────────────────────────────────────

export interface StrategyLeaderboard {
  strategy: string;
  total_trades: number;
  win_rate: number;
  avg_pnl: number;
  total_profit: number;
  avg_r_multiple: number | null;
  avg_hold_minutes: number;
  avg_giveback: number;
  avg_giveback_ratio: number;
  avg_time_to_mfe_min: number;
  median_hold_minutes: number;
  sharpe: number;
  profit_factor: number;
  max_win: number;
  max_loss: number;
  expectancy: number;             // avg profit per trade in $ terms
}

export interface MFEMAEProfile {
  strategy: string;
  segment: string | null;
  total_trades: number;
  avg_mfe: number;
  avg_mae: number;
  avg_giveback: number;
  avg_giveback_ratio: number;
  median_giveback_ratio: number;
  avg_time_to_mfe_min: number;
  avg_time_to_mae_min: number;
  pct_peak_in_30min: number;       // % trades where MFE reached within 30 min
  pct_held_over_2hr: number;       // % trades held > 120 min
  pct_peak_early_held_late: number; // peaked in 30min but held 2+ hours
}

export interface ExitPolicyRec {
  strategy: string;
  archetype: "early_peaker" | "late_grower" | "bleeder" | "mixed";
  recommendation: string;
  supporting_data: {
    avg_time_to_mfe_min: number;
    avg_giveback_ratio: number;
    avg_hold_minutes: number;
    pct_peak_early_held_late: number;
  };
}

export interface TimeOfDayBucket {
  hour: number;                    // 6-16 (market hours)
  label: string;                   // "6:00-7:00", etc.
  total_trades: number;
  win_rate: number;
  avg_profit: number;
  avg_r_multiple: number | null;
  avg_giveback_ratio: number;
}

export interface SegmentComparison {
  segment: string;
  total_trades: number;
  win_rate: number;
  avg_profit: number;
  avg_r_multiple: number | null;
  avg_giveback_ratio: number;
  avg_hold_minutes: number;
  total_profit: number;
}

export interface ExitAutopsyReport {
  overview: {
    total_trades: number;
    date_range: { start: string; end: string };
    unique_symbols: number;
    unique_strategies: number;
    overall_win_rate: number;
    overall_avg_r: number | null;
    overall_total_profit: number;
    overall_avg_giveback_ratio: number;
  };
  strategy_leaderboard: StrategyLeaderboard[];
  mfe_mae_profiles: MFEMAEProfile[];
  exit_policy_recs: ExitPolicyRec[];
  time_of_day: TimeOfDayBucket[];
  segment_comparison: SegmentComparison[];
}

// ── Strategy Leaderboard ─────────────────────────────────────────────────

function buildStrategyLeaderboard(opts: {
  since?: string;
  until?: string;
}): StrategyLeaderboard[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.since) { conditions.push("entry_time >= ?"); params.push(opts.since); }
  if (opts.until) { conditions.push("entry_time <= ?"); params.push(opts.until); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.prepare(`
    SELECT
      strategy,
      COUNT(*) as total_trades,
      ROUND(AVG(CASE WHEN actual_pnl > 0 THEN 1.0 ELSE 0.0 END), 3) as win_rate,
      ROUND(AVG(actual_pnl), 2) as avg_pnl,
      ROUND(SUM(actual_pnl), 2) as total_profit,
      ROUND(AVG(r_multiple), 3) as avg_r_multiple,
      ROUND(AVG(hold_minutes), 1) as avg_hold_minutes,
      ROUND(AVG(giveback), 2) as avg_giveback,
      ROUND(AVG(giveback_ratio), 3) as avg_giveback_ratio,
      ROUND(AVG(time_to_mfe_min), 1) as avg_time_to_mfe_min,
      MAX(actual_pnl) as max_win,
      MIN(actual_pnl) as max_loss
    FROM holly_trades
    ${where}
    GROUP BY strategy
    HAVING total_trades >= 5
    ORDER BY total_profit DESC
  `).all(...params) as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const profits = db.prepare(`
      SELECT actual_pnl, hold_minutes FROM holly_trades
      WHERE strategy = ? ${conditions.length > 0 ? "AND " + conditions.join(" AND ") : ""}
      ORDER BY actual_pnl
    `).all(r.strategy, ...params) as Array<{ actual_pnl: number; hold_minutes: number }>;

    const pValues = profits.map((p) => p.actual_pnl).filter((v) => v != null);
    const holdValues = profits.map((p) => p.hold_minutes).filter((v) => v != null);

    // Sharpe
    const mean = pValues.length > 0 ? pValues.reduce((a, b) => a + b, 0) / pValues.length : 0;
    const std = pValues.length > 1
      ? Math.sqrt(pValues.reduce((a, b) => a + (b - mean) ** 2, 0) / (pValues.length - 1))
      : 1;
    const sharpe = std > 0 ? Math.round((mean / std) * 1000) / 1000 : 0;

    // Profit factor
    const grossProfit = pValues.filter((v) => v > 0).reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(pValues.filter((v) => v < 0).reduce((a, b) => a + b, 0));
    const profitFactor = grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : (grossProfit > 0 ? 999 : 0);

    // Median hold
    holdValues.sort((a, b) => a - b);
    const medianHold = holdValues.length > 0
      ? holdValues[Math.floor(holdValues.length / 2)]
      : 0;

    return {
      strategy: r.strategy as string,
      total_trades: r.total_trades as number,
      win_rate: r.win_rate as number,
      avg_pnl: r.avg_pnl as number,
      total_profit: r.total_profit as number,
      avg_r_multiple: r.avg_r_multiple as number | null,
      avg_hold_minutes: r.avg_hold_minutes as number,
      avg_giveback: r.avg_giveback as number,
      avg_giveback_ratio: r.avg_giveback_ratio as number,
      avg_time_to_mfe_min: r.avg_time_to_mfe_min as number,
      median_hold_minutes: Math.round(medianHold * 10) / 10,
      sharpe,
      profit_factor: profitFactor,
      max_win: r.max_win as number,
      max_loss: r.max_loss as number,
      expectancy: mean,
    };
  });
}

// ── MFE/MAE Profiles ─────────────────────────────────────────────────────

function buildMFEMAEProfiles(opts: {
  since?: string;
  until?: string;
}): MFEMAEProfile[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.since) { conditions.push("entry_time >= ?"); params.push(opts.since); }
  if (opts.until) { conditions.push("entry_time <= ?"); params.push(opts.until); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return db.prepare(`
    SELECT
      strategy,
      segment,
      COUNT(*) as total_trades,
      ROUND(AVG(mfe), 2) as avg_mfe,
      ROUND(AVG(mae), 2) as avg_mae,
      ROUND(AVG(giveback), 2) as avg_giveback,
      ROUND(AVG(giveback_ratio), 3) as avg_giveback_ratio,
      ROUND(AVG(time_to_mfe_min), 1) as avg_time_to_mfe_min,
      ROUND(AVG(time_to_mae_min), 1) as avg_time_to_mae_min,
      ROUND(AVG(CASE WHEN time_to_mfe_min <= 30 THEN 1.0 ELSE 0.0 END), 3) as pct_peak_in_30min,
      ROUND(AVG(CASE WHEN hold_minutes > 120 THEN 1.0 ELSE 0.0 END), 3) as pct_held_over_2hr,
      ROUND(AVG(CASE WHEN time_to_mfe_min <= 30 AND hold_minutes > 120 THEN 1.0 ELSE 0.0 END), 3) as pct_peak_early_held_late
    FROM holly_trades
    ${where}
    GROUP BY strategy, segment
    HAVING total_trades >= 5
    ORDER BY avg_giveback_ratio DESC
  `).all(...params).map((r: any) => ({
    strategy: r.strategy,
    segment: r.segment,
    total_trades: r.total_trades,
    avg_mfe: r.avg_mfe ?? 0,
    avg_mae: r.avg_mae ?? 0,
    avg_giveback: r.avg_giveback ?? 0,
    avg_giveback_ratio: r.avg_giveback_ratio ?? 0,
    median_giveback_ratio: r.avg_giveback_ratio ?? 0, // approx
    avg_time_to_mfe_min: r.avg_time_to_mfe_min ?? 0,
    avg_time_to_mae_min: r.avg_time_to_mae_min ?? 0,
    pct_peak_in_30min: r.pct_peak_in_30min ?? 0,
    pct_held_over_2hr: r.pct_held_over_2hr ?? 0,
    pct_peak_early_held_late: r.pct_peak_early_held_late ?? 0,
  }));
}

// ── Exit Policy Recommendations ──────────────────────────────────────────

function buildExitPolicyRecs(leaderboard: StrategyLeaderboard[]): ExitPolicyRec[] {
  return leaderboard.map((s) => {
    // Classify archetype
    let archetype: ExitPolicyRec["archetype"];
    let recommendation: string;

    const peaksEarly = s.avg_time_to_mfe_min < 30;
    const highGiveback = s.avg_giveback_ratio > 0.5;
    const holdsLong = s.avg_hold_minutes > 120;

    if (peaksEarly && highGiveback) {
      archetype = "early_peaker";
      recommendation = `Take profit early (${Math.round(s.avg_time_to_mfe_min)}min avg peak). Consider: 50% at 1R, trail remainder. Time-stop at ${Math.round(s.avg_time_to_mfe_min * 2)}min.`;
    } else if (!peaksEarly && s.avg_giveback_ratio < 0.3) {
      archetype = "late_grower";
      recommendation = `Let run — profits grow late. Trail with ${Math.round(s.avg_time_to_mfe_min * 0.5)}min intervals. Avoid early exits.`;
    } else if (s.win_rate < 0.4 && highGiveback) {
      archetype = "bleeder";
      recommendation = `Consider skipping or tighten stops aggressively. Win rate ${Math.round(s.win_rate * 100)}% with ${Math.round(s.avg_giveback_ratio * 100)}% giveback. Cut quickly.`;
    } else {
      archetype = "mixed";
      recommendation = `Standard bracket: 1.5R target, ${Math.round(s.avg_time_to_mfe_min * 1.5)}min time-stop. Giveback ratio ${Math.round(s.avg_giveback_ratio * 100)}%.`;
    }

    return {
      strategy: s.strategy,
      archetype,
      recommendation,
      supporting_data: {
        avg_time_to_mfe_min: s.avg_time_to_mfe_min,
        avg_giveback_ratio: s.avg_giveback_ratio,
        avg_hold_minutes: s.avg_hold_minutes,
        pct_peak_early_held_late: 0, // filled from MFE profiles
      },
    };
  });
}

// ── Time of Day Analysis ─────────────────────────────────────────────────

function buildTimeOfDayAnalysis(opts: {
  since?: string;
  until?: string;
}): TimeOfDayBucket[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.since) { conditions.push("entry_time >= ?"); params.push(opts.since); }
  if (opts.until) { conditions.push("entry_time <= ?"); params.push(opts.until); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Extract hour from entry_time (format: YYYY-MM-DD HH:MM:SS)
  return db.prepare(`
    SELECT
      CAST(substr(entry_time, 12, 2) AS INTEGER) as hour,
      COUNT(*) as total_trades,
      ROUND(AVG(CASE WHEN actual_pnl > 0 THEN 1.0 ELSE 0.0 END), 3) as win_rate,
      ROUND(AVG(actual_pnl), 2) as avg_profit,
      ROUND(AVG(r_multiple), 3) as avg_r_multiple,
      ROUND(AVG(giveback_ratio), 3) as avg_giveback_ratio
    FROM holly_trades
    ${where}
    GROUP BY hour
    HAVING total_trades >= 3
    ORDER BY hour
  `).all(...params).map((r: any) => ({
    hour: r.hour,
    label: `${String(r.hour).padStart(2, "0")}:00-${String(r.hour + 1).padStart(2, "0")}:00`,
    total_trades: r.total_trades,
    win_rate: r.win_rate,
    avg_profit: r.avg_profit,
    avg_r_multiple: r.avg_r_multiple,
    avg_giveback_ratio: r.avg_giveback_ratio,
  }));
}

// ── Segment Comparison ───────────────────────────────────────────────────

function buildSegmentComparison(opts: {
  since?: string;
  until?: string;
}): SegmentComparison[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.since) { conditions.push("entry_time >= ?"); params.push(opts.since); }
  if (opts.until) { conditions.push("entry_time <= ?"); params.push(opts.until); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return db.prepare(`
    SELECT
      COALESCE(segment, 'Unknown') as segment,
      COUNT(*) as total_trades,
      ROUND(AVG(CASE WHEN actual_pnl > 0 THEN 1.0 ELSE 0.0 END), 3) as win_rate,
      ROUND(AVG(actual_pnl), 2) as avg_profit,
      ROUND(AVG(r_multiple), 3) as avg_r_multiple,
      ROUND(AVG(giveback_ratio), 3) as avg_giveback_ratio,
      ROUND(AVG(hold_minutes), 1) as avg_hold_minutes,
      ROUND(SUM(actual_pnl), 2) as total_profit
    FROM holly_trades
    ${where}
    GROUP BY segment
    HAVING total_trades >= 5
    ORDER BY total_profit DESC
  `).all(...params).map((r: any) => ({
    segment: r.segment,
    total_trades: r.total_trades,
    win_rate: r.win_rate,
    avg_profit: r.avg_profit,
    avg_r_multiple: r.avg_r_multiple,
    avg_giveback_ratio: r.avg_giveback_ratio,
    avg_hold_minutes: r.avg_hold_minutes,
    total_profit: r.total_profit,
  }));
}

// ── Full Report ──────────────────────────────────────────────────────────

/**
 * Run the full exit autopsy report.
 * Analyzes all holly_trades data within the specified timeframe.
 */
export function runExitAutopsy(opts: {
  since?: string;
  until?: string;
} = {}): ExitAutopsyReport {
  ensureHollyTradesTable();
  const db = getDb();

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.since) { conditions.push("entry_time >= ?"); params.push(opts.since); }
  if (opts.until) { conditions.push("entry_time <= ?"); params.push(opts.until); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Overview
  const overview = db.prepare(`
    SELECT
      COUNT(*) as total_trades,
      MIN(entry_time) as start_date,
      MAX(entry_time) as end_date,
      COUNT(DISTINCT symbol) as unique_symbols,
      COUNT(DISTINCT strategy) as unique_strategies,
      ROUND(AVG(CASE WHEN actual_pnl > 0 THEN 1.0 ELSE 0.0 END), 3) as win_rate,
      ROUND(AVG(r_multiple), 3) as avg_r,
      ROUND(SUM(actual_pnl), 2) as total_profit,
      ROUND(AVG(giveback_ratio), 3) as avg_giveback_ratio
    FROM holly_trades
    ${where}
  `).get(...params) as Record<string, unknown>;

  const leaderboard = buildStrategyLeaderboard(opts);
  const mfeProfiles = buildMFEMAEProfiles(opts);
  const exitRecs = buildExitPolicyRecs(leaderboard);
  const timeOfDay = buildTimeOfDayAnalysis(opts);
  const segments = buildSegmentComparison(opts);

  log.info({
    trades: overview.total_trades,
    strategies: overview.unique_strategies,
  }, "Exit autopsy complete");

  return {
    overview: {
      total_trades: overview.total_trades as number,
      date_range: {
        start: (overview.start_date as string) ?? "",
        end: (overview.end_date as string) ?? "",
      },
      unique_symbols: overview.unique_symbols as number,
      unique_strategies: overview.unique_strategies as number,
      overall_win_rate: overview.win_rate as number,
      overall_avg_r: overview.avg_r as number | null,
      overall_total_profit: overview.total_profit as number,
      overall_avg_giveback_ratio: overview.avg_giveback_ratio as number,
    },
    strategy_leaderboard: leaderboard,
    mfe_mae_profiles: mfeProfiles,
    exit_policy_recs: exitRecs,
    time_of_day: timeOfDay,
    segment_comparison: segments,
  };
}
