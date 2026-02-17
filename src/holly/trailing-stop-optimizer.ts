/**
 * Trailing Stop Optimizer
 *
 * Simulates multiple trailing-stop strategies against historical Holly trades
 * to find the optimal exit approach per strategy/segment.
 *
 * Strategies simulated:
 * 1. Fixed-% trailing stop (e.g., trail by 1%, 2%, 3% from peak)
 * 2. ATR-based trailing (trail by N * ATR from peak)
 * 3. Time-decay exit (reduce target over holding time)
 * 4. MFE-triggered escalation (tighten stop after reaching X% of MFE)
 * 5. Breakeven + trail (move to BE after 1R, then trail)
 *
 * Each strategy is scored by: total P&L improvement, Sharpe improvement,
 * win rate change, and average giveback reduction vs. Holly's actual exits.
 */

import { getDb } from "../db/database.js";
import { ensureHollyTradesTable } from "./trade-importer.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "trailing-stop-optimizer" });

// ── Types ────────────────────────────────────────────────────────────────

export interface TrailingStopParams {
  /** Strategy identifier */
  name: string;
  /** Trail type */
  type: "fixed_pct" | "atr_multiple" | "time_decay" | "mfe_escalation" | "breakeven_trail";
  /** Trailing distance as % of price (for fixed_pct) */
  trail_pct?: number;
  /** ATR multiplier (for atr_multiple) */
  atr_mult?: number;
  /** Initial target as % of MFE (for time_decay, starts here and decays) */
  initial_target_pct?: number;
  /** Decay rate per minute (for time_decay) */
  decay_per_min?: number;
  /** MFE threshold % to trigger tighter stop (for mfe_escalation) */
  mfe_trigger_pct?: number;
  /** Tighter trail % after MFE trigger (for mfe_escalation) */
  tight_trail_pct?: number;
  /** R-multiple to move to breakeven (for breakeven_trail) */
  be_trigger_r?: number;
  /** Trail % after breakeven (for breakeven_trail) */
  post_be_trail_pct?: number;
}

export interface SimulatedExit {
  trade_id: number;
  symbol: string;
  strategy: string;
  original_pnl: number;
  simulated_pnl: number;
  improvement: number;
  original_exit_time_min: number;   // hold_minutes from actual trade
  simulated_exit_time_min: number;  // when the trailing stop would have fired
  exit_reason: "trailing_stop" | "time_stop" | "original_exit";
}

export interface OptimizationResult {
  params: TrailingStopParams;
  total_trades: number;
  /** Original Holly stats */
  original: {
    total_pnl: number;
    win_rate: number;
    avg_pnl: number;
    sharpe: number;
    avg_giveback_ratio: number;
  };
  /** Simulated trailing-stop stats */
  simulated: {
    total_pnl: number;
    win_rate: number;
    avg_pnl: number;
    sharpe: number;
    avg_giveback_ratio: number;
  };
  /** Deltas */
  pnl_improvement: number;
  pnl_improvement_pct: number;
  win_rate_delta: number;
  sharpe_delta: number;
  giveback_reduction: number;
  /** Per-trade breakdown (top 10 biggest improvements) */
  top_improvements: SimulatedExit[];
  /** Per-trade breakdown (top 10 biggest degradations) */
  top_degradations: SimulatedExit[];
}

export interface StrategyOptimization {
  holly_strategy: string;
  total_trades: number;
  best_trailing: OptimizationResult;
  all_results: OptimizationResult[];
}

interface TradeRow {
  id: number;
  symbol: string;
  strategy: string;
  entry_price: number;
  exit_price: number;
  stop_price: number | null;
  shares: number;
  actual_pnl: number;
  mfe: number | null;
  mae: number | null;
  hold_minutes: number | null;
  time_to_mfe_min: number | null;
  time_to_mae_min: number | null;
  giveback: number | null;
  giveback_ratio: number | null;
  max_profit: number | null;
  atr_pct: number | null;
  segment: string | null;
}

// ── Simulation Engine ────────────────────────────────────────────────────

/**
 * Simulate a trailing stop exit on a single trade.
 *
 * Since we don't have tick-by-tick price data, we use the MFE/MAE/time data
 * to approximate when a trailing stop would trigger:
 *
 * - The trade peaks at time_to_mfe_min with profit = MFE
 * - The trade troughs at time_to_mae_min with loss = MAE
 * - If MAE happens before MFE, the stop may trigger before reaching peak
 * - If MFE happens before MAE, we capture the peak then trail down
 *
 * The trailing stop captures: peak_profit - trail_distance
 * If trail_distance > peak_profit, stop fires at a loss.
 */
function simulateTrailingExit(
  trade: TradeRow,
  params: TrailingStopParams,
): SimulatedExit {
  const shares = trade.shares || 100;
  const entryPrice = trade.entry_price;
  const holdMin = trade.hold_minutes ?? 0;
  const mfe = trade.mfe ?? 0;                // max profit ($)
  const mae = trade.mae ?? 0;                // max loss ($, negative)
  const timeToMfe = trade.time_to_mfe_min ?? holdMin / 2;
  const timeToMae = trade.time_to_mae_min ?? holdMin / 2;

  // Price at peak: entry + mfe/shares
  const mfePriceMove = shares > 0 ? mfe / shares : 0;
  const maePriceMove = shares > 0 ? mae / shares : 0;
  const peakPrice = entryPrice + mfePriceMove;
  const troughPrice = entryPrice + maePriceMove;

  let trailDistance: number;     // $ per share from peak
  let simExitPrice: number;
  let simExitTimeMin: number;
  let exitReason: SimulatedExit["exit_reason"];

  switch (params.type) {
    case "fixed_pct": {
      const pct = params.trail_pct ?? 0.02;
      trailDistance = peakPrice * pct;

      if (timeToMae < timeToMfe && Math.abs(maePriceMove) > trailDistance) {
        // Stopped out before reaching MFE
        simExitPrice = entryPrice - trailDistance;
        simExitTimeMin = timeToMae;
        exitReason = "trailing_stop";
      } else {
        // Reached MFE, then trailed
        simExitPrice = peakPrice - trailDistance;
        simExitTimeMin = timeToMfe + 1; // shortly after peak
        exitReason = "trailing_stop";
      }
      break;
    }

    case "atr_multiple": {
      const atrPct = trade.atr_pct ?? 0.03;
      const mult = params.atr_mult ?? 2;
      trailDistance = entryPrice * atrPct * mult;

      if (timeToMae < timeToMfe && Math.abs(maePriceMove) > trailDistance) {
        simExitPrice = entryPrice - trailDistance;
        simExitTimeMin = timeToMae;
        exitReason = "trailing_stop";
      } else {
        simExitPrice = peakPrice - trailDistance;
        simExitTimeMin = timeToMfe + 1;
        exitReason = "trailing_stop";
      }
      break;
    }

    case "time_decay": {
      const initialPct = params.initial_target_pct ?? 0.8;
      const decayRate = params.decay_per_min ?? 0.005;
      // At time T, the target capture is: initialPct - (T * decayRate)
      // Exit when: actual profit < target * MFE  OR  time_stop triggered

      // At peak time, target = initialPct - (timeToMfe * decayRate)
      const targetAtPeak = Math.max(0.1, initialPct - (timeToMfe * decayRate));
      const capturedProfit = mfe * targetAtPeak;
      simExitPrice = entryPrice + (capturedProfit / shares);
      simExitTimeMin = timeToMfe;

      // If time decays below 10%, just exit at current time
      const timeToDecay = (initialPct - 0.1) / decayRate;
      if (holdMin > timeToDecay) {
        simExitTimeMin = Math.min(holdMin, timeToDecay);
        exitReason = "time_stop";
      } else {
        exitReason = "trailing_stop";
      }
      break;
    }

    case "mfe_escalation": {
      const triggerPct = params.mfe_trigger_pct ?? 0.5;
      const tightPct = params.tight_trail_pct ?? 0.01;
      const loosePct = 0.03; // initial loose trail

      // If MFE reached trigger, tighten
      const triggerDollar = (mfe > 0 && entryPrice > 0)
        ? mfe * triggerPct
        : Infinity;

      if (mfe > triggerDollar) {
        // Tighten trail after reaching trigger
        trailDistance = peakPrice * tightPct;
        simExitPrice = peakPrice - trailDistance;
        simExitTimeMin = timeToMfe + 1;
      } else {
        // Use loose trail
        trailDistance = entryPrice * loosePct;
        if (timeToMae < timeToMfe && Math.abs(maePriceMove) > trailDistance) {
          simExitPrice = entryPrice - trailDistance;
          simExitTimeMin = timeToMae;
        } else {
          simExitPrice = peakPrice - trailDistance;
          simExitTimeMin = timeToMfe + 1;
        }
      }
      exitReason = "trailing_stop";
      break;
    }

    case "breakeven_trail": {
      const beTriggerR = params.be_trigger_r ?? 1;
      const postBeTrail = params.post_be_trail_pct ?? 0.015;
      const riskPerShare = trade.stop_price != null
        ? Math.abs(entryPrice - trade.stop_price)
        : entryPrice * 0.02; // default 2% risk

      const beTriggerDollar = beTriggerR * riskPerShare;

      if (mfePriceMove >= beTriggerDollar) {
        // Reached BE trigger, move stop to entry, then trail
        trailDistance = peakPrice * postBeTrail;
        simExitPrice = Math.max(entryPrice, peakPrice - trailDistance);
        simExitTimeMin = timeToMfe + 1;
      } else {
        // Never hit BE trigger — use original stop
        if (trade.stop_price != null && maePriceMove < -(riskPerShare)) {
          simExitPrice = trade.stop_price;
          simExitTimeMin = timeToMae;
        } else {
          // Use original exit
          simExitPrice = trade.exit_price;
          simExitTimeMin = holdMin;
        }
      }
      exitReason = simExitPrice === trade.exit_price ? "original_exit" : "trailing_stop";
      break;
    }

    default:
      simExitPrice = trade.exit_price;
      simExitTimeMin = holdMin;
      exitReason = "original_exit";
  }

  const simPnl = Math.round((simExitPrice - entryPrice) * shares * 100) / 100;
  const improvement = Math.round((simPnl - trade.actual_pnl) * 100) / 100;

  return {
    trade_id: trade.id,
    symbol: trade.symbol,
    strategy: trade.strategy,
    original_pnl: trade.actual_pnl,
    simulated_pnl: simPnl,
    improvement,
    original_exit_time_min: holdMin,
    simulated_exit_time_min: Math.round(simExitTimeMin * 10) / 10,
    exit_reason: exitReason,
  };
}

// ── Statistics Helpers ───────────────────────────────────────────────────

function computeStats(pnls: number[]) {
  if (pnls.length === 0) return { total: 0, avg: 0, winRate: 0, sharpe: 0 };
  const total = pnls.reduce((a, b) => a + b, 0);
  const avg = total / pnls.length;
  const wins = pnls.filter((p) => p > 0).length;
  const winRate = wins / pnls.length;

  const variance = pnls.reduce((a, b) => a + (b - avg) ** 2, 0) / pnls.length;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (avg / std) * Math.sqrt(252) : 0;

  return {
    total: Math.round(total * 100) / 100,
    avg: Math.round(avg * 100) / 100,
    winRate: Math.round(winRate * 1000) / 1000,
    sharpe: Math.round(sharpe * 100) / 100,
  };
}

// ── Default Parameter Sets ──────────────────────────────────────────────

export function getDefaultParamSets(): TrailingStopParams[] {
  return [
    // Fixed % trailing stops
    { name: "Trail 1%", type: "fixed_pct", trail_pct: 0.01 },
    { name: "Trail 1.5%", type: "fixed_pct", trail_pct: 0.015 },
    { name: "Trail 2%", type: "fixed_pct", trail_pct: 0.02 },
    { name: "Trail 3%", type: "fixed_pct", trail_pct: 0.03 },
    { name: "Trail 5%", type: "fixed_pct", trail_pct: 0.05 },

    // ATR-based trailing
    { name: "ATR 1x", type: "atr_multiple", atr_mult: 1 },
    { name: "ATR 1.5x", type: "atr_multiple", atr_mult: 1.5 },
    { name: "ATR 2x", type: "atr_multiple", atr_mult: 2 },
    { name: "ATR 3x", type: "atr_multiple", atr_mult: 3 },

    // Time-decay exits
    { name: "Decay Fast", type: "time_decay", initial_target_pct: 0.9, decay_per_min: 0.01 },
    { name: "Decay Medium", type: "time_decay", initial_target_pct: 0.8, decay_per_min: 0.005 },
    { name: "Decay Slow", type: "time_decay", initial_target_pct: 0.7, decay_per_min: 0.002 },

    // MFE-triggered escalation
    { name: "MFE 50% Tighten 1%", type: "mfe_escalation", mfe_trigger_pct: 0.5, tight_trail_pct: 0.01 },
    { name: "MFE 70% Tighten 1%", type: "mfe_escalation", mfe_trigger_pct: 0.7, tight_trail_pct: 0.01 },
    { name: "MFE 50% Tighten 2%", type: "mfe_escalation", mfe_trigger_pct: 0.5, tight_trail_pct: 0.02 },

    // Breakeven + trail
    { name: "BE at 1R, Trail 1%", type: "breakeven_trail", be_trigger_r: 1, post_be_trail_pct: 0.01 },
    { name: "BE at 1R, Trail 1.5%", type: "breakeven_trail", be_trigger_r: 1, post_be_trail_pct: 0.015 },
    { name: "BE at 0.5R, Trail 1%", type: "breakeven_trail", be_trigger_r: 0.5, post_be_trail_pct: 0.01 },
    { name: "BE at 1.5R, Trail 2%", type: "breakeven_trail", be_trigger_r: 1.5, post_be_trail_pct: 0.02 },
  ];
}

// ── Main Optimization Runner ─────────────────────────────────────────────

/**
 * Run trailing stop simulation on all trades matching the filter.
 */
export function runTrailingStopSimulation(
  params: TrailingStopParams,
  opts: {
    strategy?: string;
    segment?: string;
    since?: string;
    until?: string;
  } = {},
): OptimizationResult {
  ensureHollyTradesTable();
  const db = getDb();

  const conditions: string[] = [];
  const queryParams: unknown[] = [];

  // Must have MFE data for simulation to be meaningful
  conditions.push("mfe IS NOT NULL");
  conditions.push("entry_price > 0");
  conditions.push("shares > 0");

  if (opts.strategy) { conditions.push("strategy = ?"); queryParams.push(opts.strategy); }
  if (opts.segment) { conditions.push("segment = ?"); queryParams.push(opts.segment); }
  if (opts.since) { conditions.push("entry_time >= ?"); queryParams.push(opts.since); }
  if (opts.until) { conditions.push("entry_time <= ?"); queryParams.push(opts.until); }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const trades = db.prepare(`
    SELECT id, symbol, strategy, entry_price, exit_price, stop_price,
           shares, actual_pnl, mfe, mae, hold_minutes,
           time_to_mfe_min, time_to_mae_min, giveback, giveback_ratio,
           max_profit, segment
    FROM holly_trades
    ${where}
    ORDER BY entry_time ASC
  `).all(...queryParams) as TradeRow[];

  if (trades.length === 0) {
    return emptyResult(params);
  }

  // Simulate each trade
  const simResults = trades.map((t) => simulateTrailingExit(t, params));

  // Original stats
  const origPnls = trades.map((t) => t.actual_pnl);
  const origStats = computeStats(origPnls);
  const origGiveback = trades
    .filter((t) => t.giveback_ratio != null)
    .map((t) => t.giveback_ratio!);
  const avgOrigGiveback = origGiveback.length > 0
    ? origGiveback.reduce((a, b) => a + b, 0) / origGiveback.length
    : 0;

  // Simulated stats
  const simPnls = simResults.map((r) => r.simulated_pnl);
  const simStats = computeStats(simPnls);

  // Simulated giveback (using MFE and simulated PnL)
  const simGivebacks: number[] = [];
  for (let i = 0; i < trades.length; i++) {
    const mfe = trades[i].mfe;
    if (mfe != null && mfe > 0) {
      const simGiveback = mfe - simResults[i].simulated_pnl;
      const ratio = simGiveback >= 0 ? simGiveback / mfe : 0;
      simGivebacks.push(ratio);
    }
  }
  const avgSimGiveback = simGivebacks.length > 0
    ? simGivebacks.reduce((a, b) => a + b, 0) / simGivebacks.length
    : 0;

  // Sort by improvement
  const sorted = [...simResults].sort((a, b) => b.improvement - a.improvement);
  const topImprovements = sorted.slice(0, 10);
  const topDegradations = sorted.slice(-10).reverse();

  return {
    params,
    total_trades: trades.length,
    original: {
      total_pnl: origStats.total,
      win_rate: origStats.winRate,
      avg_pnl: origStats.avg,
      sharpe: origStats.sharpe,
      avg_giveback_ratio: Math.round(avgOrigGiveback * 1000) / 1000,
    },
    simulated: {
      total_pnl: simStats.total,
      win_rate: simStats.winRate,
      avg_pnl: simStats.avg,
      sharpe: simStats.sharpe,
      avg_giveback_ratio: Math.round(avgSimGiveback * 1000) / 1000,
    },
    pnl_improvement: Math.round((simStats.total - origStats.total) * 100) / 100,
    pnl_improvement_pct: origStats.total !== 0
      ? Math.round(((simStats.total - origStats.total) / Math.abs(origStats.total)) * 10000) / 100
      : 0,
    win_rate_delta: Math.round((simStats.winRate - origStats.winRate) * 1000) / 1000,
    sharpe_delta: Math.round((simStats.sharpe - origStats.sharpe) * 100) / 100,
    giveback_reduction: Math.round((avgOrigGiveback - avgSimGiveback) * 1000) / 1000,
    top_improvements: topImprovements,
    top_degradations: topDegradations,
  };
}

/**
 * Run all default parameter sets and return sorted by P&L improvement.
 */
export function runFullOptimization(opts: {
  strategy?: string;
  segment?: string;
  since?: string;
  until?: string;
  paramSets?: TrailingStopParams[];
} = {}): OptimizationResult[] {
  const paramSets = opts.paramSets ?? getDefaultParamSets();

  const results = paramSets.map((params) =>
    runTrailingStopSimulation(params, opts),
  );

  // Sort by P&L improvement descending
  results.sort((a, b) => b.pnl_improvement - a.pnl_improvement);

  log.info({
    strategies_tested: results.length,
    trades: results[0]?.total_trades ?? 0,
    best: results[0]?.params.name,
    best_improvement: results[0]?.pnl_improvement,
  }, "Trailing stop optimization complete");

  return results;
}

/**
 * Run optimization per Holly strategy and find the best trailing stop for each.
 */
export function runPerStrategyOptimization(opts: {
  since?: string;
  until?: string;
  minTrades?: number;
} = {}): StrategyOptimization[] {
  ensureHollyTradesTable();
  const db = getDb();
  const minTrades = opts.minTrades ?? 20;

  const conditions: string[] = ["mfe IS NOT NULL"];
  const params: unknown[] = [];
  if (opts.since) { conditions.push("entry_time >= ?"); params.push(opts.since); }
  if (opts.until) { conditions.push("entry_time <= ?"); params.push(opts.until); }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const strategies = db.prepare(`
    SELECT strategy, COUNT(*) as cnt
    FROM holly_trades
    ${where}
    GROUP BY strategy
    HAVING cnt >= ?
    ORDER BY cnt DESC
  `).all(...params, minTrades) as Array<{ strategy: string; cnt: number }>;

  const results: StrategyOptimization[] = [];

  for (const s of strategies) {
    const allResults = runFullOptimization({
      strategy: s.strategy,
      since: opts.since,
      until: opts.until,
    });

    if (allResults.length === 0) continue;

    results.push({
      holly_strategy: s.strategy,
      total_trades: s.cnt,
      best_trailing: allResults[0],
      all_results: allResults,
    });
  }

  log.info({
    strategies_analyzed: results.length,
    total_strategies: strategies.length,
  }, "Per-strategy optimization complete");

  return results;
}

/**
 * Get a summary comparison table of all trailing stop strategies.
 */
export function getOptimizationSummary(opts: {
  strategy?: string;
  segment?: string;
  since?: string;
  until?: string;
} = {}): Array<{
  name: string;
  type: string;
  total_pnl_original: number;
  total_pnl_simulated: number;
  pnl_improvement: number;
  pnl_improvement_pct: number;
  win_rate_original: number;
  win_rate_simulated: number;
  sharpe_original: number;
  sharpe_simulated: number;
  giveback_reduction: number;
}> {
  const results = runFullOptimization(opts);
  return results.map((r) => ({
    name: r.params.name,
    type: r.params.type,
    total_pnl_original: r.original.total_pnl,
    total_pnl_simulated: r.simulated.total_pnl,
    pnl_improvement: r.pnl_improvement,
    pnl_improvement_pct: r.pnl_improvement_pct,
    win_rate_original: r.original.win_rate,
    win_rate_simulated: r.simulated.win_rate,
    sharpe_original: r.original.sharpe,
    sharpe_simulated: r.simulated.sharpe,
    giveback_reduction: r.giveback_reduction,
  }));
}

// ── Helpers ──────────────────────────────────────────────────────────────

function emptyResult(params: TrailingStopParams): OptimizationResult {
  const zero = { total_pnl: 0, win_rate: 0, avg_pnl: 0, sharpe: 0, avg_giveback_ratio: 0 };
  return {
    params,
    total_trades: 0,
    original: zero,
    simulated: zero,
    pnl_improvement: 0,
    pnl_improvement_pct: 0,
    win_rate_delta: 0,
    sharpe_delta: 0,
    giveback_reduction: 0,
    top_improvements: [],
    top_degradations: [],
  };
}
