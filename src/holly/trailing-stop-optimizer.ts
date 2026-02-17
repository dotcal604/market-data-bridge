/**
 * Holly Trailing Stop Optimizer
 *
 * Simulates 19 different trailing stop strategies against historical Holly trades
 * to find optimal exit params per strategy. Uses MFE/MAE/time_to_mfe_min/time_to_mae_min
 * data from the holly_trades table to model alternate exits.
 *
 * Strategies tested:
 * 1. Fixed % trails (5%, 10%, 15%, 20%)
 * 2. ATR-based trails (1.0x, 1.5x, 2.0x, 2.5x, 3.0x ATR)
 * 3. Time-decay trails (30min, 60min, 90min decay)
 * 4. MFE-escalation (50%, 75%, 100% MFE triggers)
 * 5. Breakeven trails (1R, 1.5R, 2R breakeven)
 * 6. Hybrid strategies (combinations)
 */

import { getDb } from "../db/database.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "trailing-stop-optimizer" });

// ── Types ────────────────────────────────────────────────────────────────

export interface TrailingStopParams {
  name: string;
  type: "fixed_pct" | "atr_based" | "time_decay" | "mfe_escalation" | "breakeven_trail" | "hybrid";
  fixed_pct?: number;              // For fixed % trails (0.05 = 5%)
  atr_multiplier?: number;         // For ATR-based trails (1.5 = 1.5x ATR)
  decay_minutes?: number;          // For time-decay trails
  mfe_trigger_pct?: number;        // For MFE-escalation (0.5 = 50% of MFE)
  breakeven_r_multiple?: number;   // For breakeven trails (1.5 = 1.5R)
  tighten_after_trigger?: boolean; // Whether to tighten after trigger
}

export interface TradeSimulation {
  original_entry_price: number;
  original_exit_price: number;
  original_pnl: number;
  simulated_exit_price: number;
  simulated_pnl: number;
  improvement: number;             // simulated_pnl - original_pnl
  exit_reason: string;             // "trailing_stop", "original_exit", "mae_first", etc.
  peak_price: number;              // Highest price reached (for LONG)
  worst_price: number;             // Lowest price reached (for LONG)
}

export interface SimulationStats {
  param_name: string;
  total_trades: number;
  win_rate: number;
  avg_improvement: number;
  total_improvement: number;
  median_improvement: number;
  improvement_sharpe: number;      // (mean improvement / std improvement) * sqrt(252)
  better_exits: number;            // Count of trades with positive improvement
  worse_exits: number;             // Count of trades with negative improvement
  unchanged_exits: number;         // Count of trades with zero improvement
  top_improvements: Array<{ symbol: string; improvement: number }>;
  top_degradations: Array<{ symbol: string; improvement: number }>;
}

export interface PerStrategyStats {
  strategy: string;
  param_name: string;
  total_trades: number;
  avg_improvement: number;
  total_improvement: number;
  win_rate: number;
  improvement_sharpe: number;
}

export interface OptimizationSummary {
  overall_best: string;            // Param name with highest total improvement
  by_strategy: Array<{
    strategy: string;
    best_param: string;
    improvement: number;
  }>;
  by_segment?: Array<{
    segment: string;
    best_param: string;
    improvement: number;
  }>;
}

interface TradeRow {
  id: number;
  entry_time: string;
  exit_time: string;
  symbol: string;
  shares: number;
  entry_price: number;
  exit_price: number;
  actual_pnl: number;
  mfe: number | null;
  mae: number | null;
  time_to_mfe_min: number | null;
  time_to_mae_min: number | null;
  hold_minutes: number | null;
  stop_price: number | null;
  strategy: string;
  segment: string | null;
  r_multiple: number | null;
}

// ── Default Parameters ───────────────────────────────────────────────────

export const DEFAULT_PARAMS: TrailingStopParams[] = [
  // Fixed % trails
  { name: "Fixed 5%", type: "fixed_pct", fixed_pct: 0.05 },
  { name: "Fixed 10%", type: "fixed_pct", fixed_pct: 0.10 },
  { name: "Fixed 15%", type: "fixed_pct", fixed_pct: 0.15 },
  { name: "Fixed 20%", type: "fixed_pct", fixed_pct: 0.20 },
  // ATR-based trails (assume 2% ATR as placeholder)
  { name: "ATR 1.0x", type: "atr_based", atr_multiplier: 1.0 },
  { name: "ATR 1.5x", type: "atr_based", atr_multiplier: 1.5 },
  { name: "ATR 2.0x", type: "atr_based", atr_multiplier: 2.0 },
  { name: "ATR 2.5x", type: "atr_based", atr_multiplier: 2.5 },
  { name: "ATR 3.0x", type: "atr_based", atr_multiplier: 3.0 },
  // Time-decay trails
  { name: "Decay 30min", type: "time_decay", decay_minutes: 30 },
  { name: "Decay 60min", type: "time_decay", decay_minutes: 60 },
  { name: "Decay 90min", type: "time_decay", decay_minutes: 90 },
  // MFE-escalation
  { name: "MFE 50%", type: "mfe_escalation", mfe_trigger_pct: 0.50, tighten_after_trigger: true },
  { name: "MFE 75%", type: "mfe_escalation", mfe_trigger_pct: 0.75, tighten_after_trigger: true },
  { name: "MFE 100%", type: "mfe_escalation", mfe_trigger_pct: 1.00, tighten_after_trigger: true },
  // Breakeven trails
  { name: "Breakeven 1R", type: "breakeven_trail", breakeven_r_multiple: 1.0 },
  { name: "Breakeven 1.5R", type: "breakeven_trail", breakeven_r_multiple: 1.5 },
  { name: "Breakeven 2R", type: "breakeven_trail", breakeven_r_multiple: 2.0 },
  // Hybrid
  { name: "Hybrid MFE+Time", type: "hybrid", mfe_trigger_pct: 0.50, decay_minutes: 60 },
];

// ── Simulation Logic ─────────────────────────────────────────────────────

/**
 * Simulate a trailing stop strategy for a single trade.
 * Returns the simulated exit price and reason.
 */
export function simulateTrailingStop(
  trade: TradeRow,
  params: TrailingStopParams
): TradeSimulation {
  const isLong = trade.shares > 0;
  const entry = trade.entry_price;
  const originalExit = trade.exit_price;
  const originalPnl = trade.actual_pnl;
  
  // Edge cases
  if (trade.shares === 0 || entry === 0) {
    return {
      original_entry_price: entry,
      original_exit_price: originalExit,
      original_pnl: originalPnl,
      simulated_exit_price: originalExit,
      simulated_pnl: originalPnl,
      improvement: 0,
      exit_reason: "invalid_trade",
      peak_price: entry,
      worst_price: entry,
    };
  }

  // If no MFE data, return original exit
  if (trade.mfe === null || trade.mfe === undefined) {
    return {
      original_entry_price: entry,
      original_exit_price: originalExit,
      original_pnl: originalPnl,
      simulated_exit_price: originalExit,
      simulated_pnl: originalPnl,
      improvement: 0,
      exit_reason: "no_mfe_data",
      peak_price: entry,
      worst_price: entry,
    };
  }

  // Calculate peak and worst prices from MFE/MAE
  const mfePerShare = trade.mfe / Math.abs(trade.shares);
  const maePerShare = trade.mae !== null ? trade.mae / Math.abs(trade.shares) : 0;
  
  const peakPrice = isLong ? entry + mfePerShare : entry - mfePerShare;
  const worstPrice = isLong ? entry + maePerShare : entry - maePerShare;

  // Check if MAE happened before MFE (early stop out)
  if (
    trade.time_to_mae_min !== null &&
    trade.time_to_mfe_min !== null &&
    trade.time_to_mae_min < trade.time_to_mfe_min
  ) {
    // If MAE was severe enough to hit the trail, we'd be stopped out early
    const maeDistance = Math.abs(maePerShare);
    const shouldStopEarly = maeDistance / entry > 0.02; // 2% adverse move
    
    if (shouldStopEarly) {
      const simulatedExit = worstPrice;
      const simulatedPnl = (simulatedExit - entry) * trade.shares;
      return {
        original_entry_price: entry,
        original_exit_price: originalExit,
        original_pnl: originalPnl,
        simulated_exit_price: simulatedExit,
        simulated_pnl: simulatedPnl,
        improvement: simulatedPnl - originalPnl,
        exit_reason: "mae_first",
        peak_price: peakPrice,
        worst_price: worstPrice,
      };
    }
  }

  let simulatedExit = originalExit;
  let exitReason = "original_exit";

  switch (params.type) {
    case "fixed_pct": {
      // Fixed % trail from peak
      const trailPct = params.fixed_pct || 0.10;
      const trailDistance = peakPrice * trailPct;
      simulatedExit = isLong
        ? peakPrice - trailDistance
        : peakPrice + trailDistance;
      exitReason = "trailing_stop";
      break;
    }

    case "atr_based": {
      // ATR-based trail (assume 2% ATR as proxy)
      const atrPct = 0.02;
      const multiplier = params.atr_multiplier || 1.5;
      const trailDistance = entry * atrPct * multiplier;
      simulatedExit = isLong
        ? peakPrice - trailDistance
        : peakPrice + trailDistance;
      exitReason = "atr_trail";
      break;
    }

    case "time_decay": {
      // Time-decay: reduce target over holding time
      const decayMinutes = params.decay_minutes || 60;
      const holdMinutes = trade.hold_minutes || 0;
      const decayFactor = Math.min(holdMinutes / decayMinutes, 1.0);
      const targetMove = peakPrice - entry;
      const reducedTarget = entry + targetMove * (1 - decayFactor * 0.3); // 30% reduction at full decay
      simulatedExit = reducedTarget;
      exitReason = "time_decay";
      break;
    }

    case "mfe_escalation": {
      // MFE-escalation: tighten trail after reaching trigger %
      const triggerPct = params.mfe_trigger_pct || 0.50;
      const mfeReached = Math.abs(peakPrice - entry) / entry;
      if (mfeReached >= triggerPct * 0.02) { // Trigger if we reached 50% of expected 2% move
        const tightenedTrail = peakPrice * 0.05; // Tighten to 5% trail
        simulatedExit = isLong
          ? peakPrice - tightenedTrail
          : peakPrice + tightenedTrail;
        exitReason = "mfe_escalation";
      } else {
        simulatedExit = originalExit;
        exitReason = "below_trigger";
      }
      break;
    }

    case "breakeven_trail": {
      // Breakeven trail: move stop to entry after N*R reached
      const rMultiple = params.breakeven_r_multiple || 1.0;
      if (trade.r_multiple !== null && trade.r_multiple >= rMultiple) {
        // Move stop to breakeven (entry)
        simulatedExit = entry;
        exitReason = "breakeven_trail";
      } else {
        simulatedExit = originalExit;
        exitReason = "below_breakeven_threshold";
      }
      break;
    }

    case "hybrid": {
      // Combine MFE trigger with time decay
      const mfeTrigger = params.mfe_trigger_pct || 0.50;
      const decayMinutes = params.decay_minutes || 60;
      const holdMinutes = trade.hold_minutes || 0;
      
      const mfeReached = Math.abs(peakPrice - entry) / entry;
      const decayFactor = Math.min(holdMinutes / decayMinutes, 1.0);
      
      if (mfeReached >= mfeTrigger * 0.02) {
        // Tighten trail based on time decay
        const baseTrail = peakPrice * 0.05;
        const adjustedTrail = baseTrail * (1 + decayFactor * 0.5); // Widen trail over time
        simulatedExit = isLong
          ? peakPrice - adjustedTrail
          : peakPrice + adjustedTrail;
        exitReason = "hybrid";
      } else {
        simulatedExit = originalExit;
        exitReason = "below_hybrid_trigger";
      }
      break;
    }
  }

  const simulatedPnl = (simulatedExit - entry) * trade.shares;
  const improvement = simulatedPnl - originalPnl;

  return {
    original_entry_price: entry,
    original_exit_price: originalExit,
    original_pnl: originalPnl,
    simulated_exit_price: simulatedExit,
    simulated_pnl: simulatedPnl,
    improvement,
    exit_reason: exitReason,
    peak_price: peakPrice,
    worst_price: worstPrice,
  };
}

// ── Statistics ───────────────────────────────────────────────────────────

/**
 * Run simulation for all trades with given params and compute stats.
 */
export function runTrailingStopSimulation(
  trades: TradeRow[],
  params: TrailingStopParams
): SimulationStats {
  const simulations = trades.map((t) => simulateTrailingStop(t, params));
  
  const improvements = simulations.map((s) => s.improvement);
  const totalImprovement = improvements.reduce((sum, x) => sum + x, 0);
  const avgImprovement = improvements.length > 0 ? totalImprovement / improvements.length : 0;
  
  // Sort for median
  const sortedImprovements = [...improvements].sort((a, b) => a - b);
  const medianImprovement = sortedImprovements.length > 0
    ? sortedImprovements[Math.floor(sortedImprovements.length / 2)]
    : 0;
  
  // Sharpe ratio: (mean / std) * sqrt(252)
  const variance = improvements.reduce((sum, x) => sum + Math.pow(x - avgImprovement, 2), 0) / improvements.length;
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? (avgImprovement / stdDev) * Math.sqrt(252) : 0;
  
  // Win rate: % of trades with simulated PnL > 0
  const winners = simulations.filter((s) => s.simulated_pnl > 0).length;
  const winRate = simulations.length > 0 ? winners / simulations.length : 0;
  
  // Better/worse/unchanged
  const better = simulations.filter((s) => s.improvement > 0).length;
  const worse = simulations.filter((s) => s.improvement < 0).length;
  const unchanged = simulations.filter((s) => s.improvement === 0).length;
  
  // Top improvements and degradations
  const withSymbol = simulations.map((s, i) => ({
    symbol: trades[i].symbol,
    improvement: s.improvement,
  }));
  const sortedByImprovement = [...withSymbol].sort((a, b) => b.improvement - a.improvement);
  const topImprovements = sortedByImprovement.slice(0, 5);
  const topDegradations = sortedByImprovement.slice(-5).reverse();
  
  return {
    param_name: params.name,
    total_trades: simulations.length,
    win_rate: winRate,
    avg_improvement: avgImprovement,
    total_improvement: totalImprovement,
    median_improvement: medianImprovement,
    improvement_sharpe: sharpe,
    better_exits: better,
    worse_exits: worse,
    unchanged_exits: unchanged,
    top_improvements: topImprovements,
    top_degradations: topDegradations,
  };
}

// ── Optimization API ─────────────────────────────────────────────────────

/**
 * Run full optimization across all 19 default parameter sets.
 * Returns stats for each, sorted by total P&L improvement.
 */
export function runFullOptimization(filters?: {
  strategy?: string;
  segment?: string;
  startDate?: string;
  endDate?: string;
}): SimulationStats[] {
  const db = getDb();
  
  // Build query with filters
  let query = "SELECT * FROM holly_trades WHERE 1=1";
  const params: unknown[] = [];
  
  if (filters?.strategy) {
    query += " AND strategy = ?";
    params.push(filters.strategy);
  }
  if (filters?.segment) {
    query += " AND segment = ?";
    params.push(filters.segment);
  }
  if (filters?.startDate) {
    query += " AND entry_time >= ?";
    params.push(filters.startDate);
  }
  if (filters?.endDate) {
    query += " AND entry_time <= ?";
    params.push(filters.endDate);
  }
  
  const stmt = db.prepare(query);
  const trades = stmt.all(...params) as TradeRow[];
  
  if (trades.length === 0) {
    log.warn({ filters }, "No trades found for optimization filters");
    return [];
  }
  
  const results = DEFAULT_PARAMS.map((p) => runTrailingStopSimulation(trades, p));
  
  // Sort by total improvement descending
  return results.sort((a, b) => b.total_improvement - a.total_improvement);
}

/**
 * Run optimization grouped by Holly strategy.
 */
export function runPerStrategyOptimization(): PerStrategyStats[] {
  const db = getDb();
  
  // Get all strategies
  const strategies = db.prepare("SELECT DISTINCT strategy FROM holly_trades WHERE strategy IS NOT NULL").all() as Array<{ strategy: string }>;
  
  const results: PerStrategyStats[] = [];
  
  for (const { strategy } of strategies) {
    const trades = db.prepare("SELECT * FROM holly_trades WHERE strategy = ?").all(strategy) as TradeRow[];
    
    if (trades.length === 0) continue;
    
    for (const params of DEFAULT_PARAMS) {
      const stats = runTrailingStopSimulation(trades, params);
      results.push({
        strategy,
        param_name: params.name,
        total_trades: stats.total_trades,
        avg_improvement: stats.avg_improvement,
        total_improvement: stats.total_improvement,
        win_rate: stats.win_rate,
        improvement_sharpe: stats.improvement_sharpe,
      });
    }
  }
  
  return results;
}

/**
 * Get optimization summary with overall best and per-strategy best params.
 */
export function getOptimizationSummary(filters?: {
  strategy?: string;
  segment?: string;
  startDate?: string;
  endDate?: string;
}): OptimizationSummary {
  const fullResults = runFullOptimization(filters);
  const perStrategyResults = runPerStrategyOptimization();
  
  const overallBest = fullResults.length > 0 ? fullResults[0].param_name : "";
  
  // Group per-strategy results by strategy
  const byStrategy: Record<string, PerStrategyStats[]> = {};
  for (const stat of perStrategyResults) {
    if (!byStrategy[stat.strategy]) {
      byStrategy[stat.strategy] = [];
    }
    byStrategy[stat.strategy].push(stat);
  }
  
  const strategyBest = Object.entries(byStrategy).map(([strategy, stats]) => {
    const sorted = [...stats].sort((a, b) => b.total_improvement - a.total_improvement);
    return {
      strategy,
      best_param: sorted[0]?.param_name || "",
      improvement: sorted[0]?.total_improvement || 0,
    };
  });
  
  return {
    overall_best: overallBest,
    by_strategy: strategyBest,
  };
}
