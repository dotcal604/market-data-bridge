// ── Holly Exit Suggestion Engine ──────────────────────────────────────────
//
// Bridges the Python optimizer output (optimal_exit_params.json) to the
// ExitPlan domain. Maps data-driven exit rules to ExitPolicy format.
//
// Usage:
//   suggestExits({ symbol, direction, entry_price, stop_price, total_shares, strategy })
//   → ExitPolicy with source "holly_optimized"
//
// Falls back to recommend.ts heuristic when no optimizer data available.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logging.js";
import { recommendPolicy } from "../exit-plan/recommend.js";
import type {
  ExitPolicy,
  ExitPlanRecommendInput,
  TPTarget,
  RunnerPolicy,
  ProtectTrigger,
  GivebackGuard,
} from "../exit-plan/types.js";

const log = logger.child({ module: "holly-suggest-exits" });

// ── Types for Walk-Forward Validation ───────────────────────────────────

interface WalkForwardStrategy {
  strategy: string;
  exit_rule: string;
  params: string; // JSON string
  test_sharpe: number;
  test_pf: number;
  test_wr: number;
}

interface WalkForwardSummary {
  generated_at: string;
  method: string;
  train_pct: number | null;
  n_folds: number | null;
  total_strategies: number;
  robust_count: number;
  overfit_count: number;
  robust_strategies: WalkForwardStrategy[];
}

// ── Types for Optimizer Output ──────────────────────────────────────────

interface OptimizerParams {
  // fixed_trail
  trail_pct?: number;
  // atr_trail
  atr_multiplier?: number;
  atr_period?: number;
  // fixed_tp
  tp_pct?: number;
  // breakeven_plus_trail
  trigger_pct?: number;
  trail_pct_after?: number;
  // volume_climax
  volume_multiplier?: number;
  lookback_bars?: number;
  // partial_plus_trail
  partial_tp_pct?: number;
  partial_size?: number;
  // time_stop
  max_hold_minutes?: number;
  // chandelier_exit
  // (uses atr_multiplier + atr_period)
  // parabolic_sar
  acceleration?: number;
  max_acceleration?: number;
}

interface OptimizerMetrics {
  win_rate: number;
  avg_pnl: number;
  total_pnl: number;
  profit_factor: number;
  sharpe: number;
  max_drawdown: number;
  avg_hold_minutes: number;
}

interface StrategyOptimal {
  direction: "Long" | "Short";
  trade_count: number;
  exit_rule: string;
  params: OptimizerParams;
  baseline: {
    win_rate: number;
    avg_pnl: number;
    total_pnl: number;
  };
  optimized: OptimizerMetrics;
  validated: boolean;
}

interface OptimalExitData {
  generated_at: string;
  data_range: string;
  total_trades_analyzed: number;
  strategies: Record<string, StrategyOptimal>;
  global_filters: {
    exclude_strategies: string[];
    min_stop_buffer_pct: number;
    price_range: [number, number];
  };
}

// ── Cache ────────────────────────────────────────────────────────────────

let cachedData: OptimalExitData | null = null;
let cacheLoadedAt: number = 0;
let cachedWF: WalkForwardSummary | null = null;
let wfLoadedAt: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // Reload every 5 minutes

/** Resolve path to a file in analytics/holly_exit/output/ */
function resolveOutputPath(filename: string): string {
  const candidates = [
    resolve(dirname(fileURLToPath(import.meta.url)), `../../analytics/holly_exit/output/${filename}`),
    resolve(process.cwd(), `analytics/holly_exit/output/${filename}`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

/** Load optimizer output with TTL cache */
function loadOptimalParams(): OptimalExitData | null {
  const now = Date.now();
  if (cachedData && now - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedData;
  }

  const path = resolveOutputPath("optimal_exit_params.json");
  if (!existsSync(path)) {
    log.warn({ path }, "optimal_exit_params.json not found — run optimizer first");
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    cachedData = JSON.parse(raw) as OptimalExitData;
    cacheLoadedAt = now;
    log.info(
      {
        strategies: Object.keys(cachedData.strategies).length,
        generated_at: cachedData.generated_at,
        trades: cachedData.total_trades_analyzed,
      },
      "Loaded optimal exit params",
    );
    return cachedData;
  } catch (err) {
    log.error({ err, path }, "Failed to load optimal_exit_params.json");
    return null;
  }
}

/** Load walk-forward validation summary with TTL cache */
function loadWalkForwardSummary(): WalkForwardSummary | null {
  const now = Date.now();
  if (cachedWF && now - wfLoadedAt < CACHE_TTL_MS) {
    return cachedWF;
  }

  const path = resolveOutputPath("walk_forward_summary.json");
  if (!existsSync(path)) {
    return null; // Walk-forward is optional
  }

  try {
    const raw = readFileSync(path, "utf-8");
    cachedWF = JSON.parse(raw) as WalkForwardSummary;
    wfLoadedAt = now;
    log.info(
      {
        method: cachedWF.method,
        robust: cachedWF.robust_count,
        overfit: cachedWF.overfit_count,
        total: cachedWF.total_strategies,
      },
      "Loaded walk-forward summary",
    );
    return cachedWF;
  } catch (err) {
    log.error({ err, path }, "Failed to load walk_forward_summary.json");
    return null;
  }
}

/** Check if a strategy passed walk-forward validation */
function isWalkForwardRobust(strategyName: string): { robust: boolean; wfData?: WalkForwardStrategy } {
  const wf = loadWalkForwardSummary();
  if (!wf) return { robust: false }; // No WF data — can't confirm

  const lower = strategyName.toLowerCase();
  const match = wf.robust_strategies.find(
    (s) => s.strategy.toLowerCase() === lower ||
      lower.startsWith(s.strategy.toLowerCase()) ||
      s.strategy.toLowerCase().startsWith(lower),
  );

  return match ? { robust: true, wfData: match } : { robust: false };
}

// ── Strategy Lookup ─────────────────────────────────────────────────────

/** Fuzzy-match Holly strategy name to optimizer key */
function findStrategy(
  data: OptimalExitData,
  strategyName: string,
): { key: string; config: StrategyOptimal } | null {
  // Exact match first
  if (data.strategies[strategyName]) {
    return { key: strategyName, config: data.strategies[strategyName] };
  }

  // Case-insensitive match
  const lower = strategyName.toLowerCase();
  for (const [key, config] of Object.entries(data.strategies)) {
    if (key.toLowerCase() === lower) {
      return { key, config };
    }
  }

  // Partial match (strategy names like "The 5 Day Bounce - Over $20" may
  // be stored as "The 5 Day Bounce" in optimizer output)
  for (const [key, config] of Object.entries(data.strategies)) {
    if (lower.startsWith(key.toLowerCase()) || key.toLowerCase().startsWith(lower)) {
      return { key, config };
    }
  }

  return null;
}

// ── Exit Rule → ExitPolicy Mapping ──────────────────────────────────────

/** Build TP ladder from optimizer params */
function buildOptimizedTPLadder(
  entryPrice: number,
  stopPrice: number,
  direction: "long" | "short",
  exitRule: string,
  params: OptimizerParams,
): TPTarget[] {
  const riskPerShare = Math.abs(entryPrice - stopPrice);
  const sign = direction === "long" ? 1 : -1;

  switch (exitRule) {
    case "fixed_tp": {
      const tpPct = params.tp_pct ?? 1.0;
      const tpPrice = +(entryPrice + sign * entryPrice * (tpPct / 100)).toFixed(2);
      return [
        { label: "tp1", price: tpPrice, qty_pct: 1.0 },
      ];
    }

    case "partial_plus_trail": {
      const partialPct = params.partial_tp_pct ?? 1.0;
      const partialSize = params.partial_size ?? 0.5;
      const partialPrice = +(entryPrice + sign * entryPrice * (partialPct / 100)).toFixed(2);
      return [
        { label: "tp1_partial", price: partialPrice, qty_pct: partialSize },
        // Remainder managed by runner trail
      ];
    }

    default: {
      // For trail-only rules (fixed_trail, atr_trail, breakeven_plus_trail,
      // volume_climax, time_stop, etc.) — no fixed TP, use R-based defaults
      return [
        { label: "tp1", price: +(entryPrice + sign * riskPerShare * 1.5).toFixed(2), qty_pct: 0.33 },
        { label: "tp2", price: +(entryPrice + sign * riskPerShare * 2.5).toFixed(2), qty_pct: 0.33 },
      ];
    }
  }
}

/** Build runner policy from optimizer params */
function buildOptimizedRunnerPolicy(
  exitRule: string,
  params: OptimizerParams,
): RunnerPolicy {
  switch (exitRule) {
    case "fixed_trail":
      return {
        trail_pct: (params.trail_pct ?? 1.0) / 100, // Optimizer stores as %, domain uses fraction
        atr_multiple: null,
        time_stop_min: null,
        be_trail: false,
        post_be_trail_pct: null,
      };

    case "atr_trail":
    case "chandelier_exit":
      return {
        trail_pct: 0.03, // Fallback — ATR-based trails compute dynamically
        atr_multiple: params.atr_multiplier ?? 1.0,
        time_stop_min: null,
        be_trail: false,
        post_be_trail_pct: null,
      };

    case "breakeven_plus_trail":
      return {
        trail_pct: (params.trail_pct_after ?? 1.0) / 100,
        atr_multiple: null,
        time_stop_min: null,
        be_trail: true,
        post_be_trail_pct: (params.trail_pct_after ?? 1.0) / 100,
      };

    case "partial_plus_trail":
      return {
        trail_pct: (params.trail_pct_after ?? 1.0) / 100,
        atr_multiple: null,
        time_stop_min: null,
        be_trail: false,
        post_be_trail_pct: null,
      };

    case "time_stop":
      return {
        trail_pct: 0.03,
        atr_multiple: null,
        time_stop_min: params.max_hold_minutes ?? 60,
        be_trail: false,
        post_be_trail_pct: null,
      };

    case "volume_climax":
      // Volume climax is a signal-based exit — trail as fallback
      return {
        trail_pct: 0.03,
        atr_multiple: null,
        time_stop_min: null,
        be_trail: false,
        post_be_trail_pct: null,
      };

    case "fixed_tp":
      // Pure TP rule — runner manages leftover after partial
      return {
        trail_pct: 0.03,
        atr_multiple: null,
        time_stop_min: null,
        be_trail: false,
        post_be_trail_pct: null,
      };

    case "parabolic_sar":
      return {
        trail_pct: 0.02, // SAR is adaptive — use tight fallback
        atr_multiple: null,
        time_stop_min: null,
        be_trail: false,
        post_be_trail_pct: null,
      };

    default:
      return {
        trail_pct: 0.03,
        atr_multiple: null,
        time_stop_min: null,
        be_trail: true,
        post_be_trail_pct: 0.02,
      };
  }
}

/** Build protect trigger from optimizer data */
function buildOptimizedProtectTrigger(
  exitRule: string,
  params: OptimizerParams,
): ProtectTrigger {
  if (exitRule === "breakeven_plus_trail") {
    // Use the optimizer's trigger_pct as the R-equivalent
    const triggerPct = params.trigger_pct ?? 1.5;
    return {
      r_multiple: triggerPct / 1.0, // Approximate: trigger_pct% ≈ trigger_pct R for near-stop entries
      dollars_per_share: null,
      new_stop: "breakeven",
    };
  }

  // Default: protect at +1R
  return {
    r_multiple: 1.0,
    dollars_per_share: null,
    new_stop: "breakeven",
  };
}

/** Build giveback guard tuned to strategy performance */
function buildOptimizedGivebackGuard(
  riskPerShare: number,
  totalShares: number,
  metrics: OptimizerMetrics,
): GivebackGuard {
  // Tighter giveback for high-win-rate strategies (they shouldn't give back much)
  // Looser for lower win-rate, higher avg_pnl strategies (runners need room)
  let maxRatio = 0.30; // default
  if (metrics.win_rate > 0.85) {
    maxRatio = 0.20; // Very high WR → tight
  } else if (metrics.win_rate < 0.55) {
    maxRatio = 0.40; // Lower WR → needs room to breathe
  }

  return {
    max_ratio: maxRatio,
    min_mfe_dollars: riskPerShare * totalShares * 0.5, // Activate after 0.5R total
  };
}

// ── Main Suggest Function ───────────────────────────────────────────────

export interface SuggestExitsInput {
  symbol: string;
  direction: "long" | "short";
  entry_price: number;
  stop_price: number;
  total_shares: number;
  strategy?: string;
}

export interface SuggestExitsResult {
  policy: ExitPolicy;
  source: "holly_optimized" | "recommended_fallback";
  walk_forward_validated: boolean;
  optimizer_data?: {
    strategy_key: string;
    exit_rule: string;
    params: OptimizerParams;
    trade_count: number;
    win_rate: number;
    profit_factor: number;
    sharpe: number;
    avg_hold_minutes: number;
  };
  walk_forward?: {
    test_sharpe: number;
    test_pf: number;
    test_wr: number;
    method: string;
    n_folds: number | null;
  };
  notes: string[];
}

/**
 * Suggest exit policy for a Holly trade.
 *
 * Priority:
 *  1. If strategy has optimizer data → use data-driven ExitPolicy
 *  2. Otherwise → fall back to recommend.ts heuristics
 */
export function suggestExits(input: SuggestExitsInput): SuggestExitsResult {
  const notes: string[] = [];
  const data = loadOptimalParams();

  // Try optimizer data first
  if (data && input.strategy) {
    const match = findStrategy(data, input.strategy);

    if (match) {
      const { key, config } = match;

      // Validate direction matches
      const optimizerDir = config.direction.toLowerCase() as "long" | "short";
      if (optimizerDir !== input.direction) {
        notes.push(
          `Direction mismatch: trade is ${input.direction}, optimizer has ${config.direction}. Using optimizer direction.`,
        );
      }

      // Check if optimizer result is actually profitable
      if (config.optimized.profit_factor < 1.0) {
        notes.push(
          `Warning: optimizer result for "${key}" has profit_factor ${config.optimized.profit_factor.toFixed(2)} (<1.0). ` +
          `Consider using baseline Holly exits instead.`,
        );
      }

      // Walk-forward validation check
      const wfResult = isWalkForwardRobust(key);
      if (!wfResult.robust) {
        notes.push(
          `Walk-forward warning: "${key}" did NOT pass out-of-sample validation. ` +
          `Optimizer params may be overfit. Consider using heuristic exits or tighter risk.`,
        );
      }

      if (!config.validated && !wfResult.robust) {
        notes.push(`Warning: optimizer result for "${key}" has not been validated by any method.`);
      }

      const riskPerShare = Math.abs(input.entry_price - input.stop_price);

      const policy: ExitPolicy = {
        hard_stop: input.stop_price,
        tp_ladder: buildOptimizedTPLadder(
          input.entry_price, input.stop_price, input.direction,
          config.exit_rule, config.params,
        ),
        runner: buildOptimizedRunnerPolicy(config.exit_rule, config.params),
        protect_trigger: buildOptimizedProtectTrigger(config.exit_rule, config.params),
        giveback_guard: buildOptimizedGivebackGuard(riskPerShare, input.total_shares, config.optimized),
        archetype: null, // Optimizer supersedes archetype-based adjustments
        source: "holly_optimized",
      };

      // Add time-based note for strategies with short avg hold
      if (config.optimized.avg_hold_minutes < 15) {
        notes.push(
          `Fast strategy: avg hold ${config.optimized.avg_hold_minutes.toFixed(0)} min. ` +
          `Consider time stop at ${Math.ceil(config.optimized.avg_hold_minutes * 2)} min.`,
        );
        if (!policy.runner.time_stop_min) {
          policy.runner.time_stop_min = Math.ceil(config.optimized.avg_hold_minutes * 2);
        }
      }

      // Add volume climax note
      if (config.exit_rule === "volume_climax") {
        notes.push(
          `Volume climax exit: watch for ${config.params.volume_multiplier}x volume spike ` +
          `over ${config.params.lookback_bars}-bar lookback.`,
        );
      }

      const wfSummary = loadWalkForwardSummary();

      log.info(
        {
          symbol: input.symbol,
          strategy: key,
          exit_rule: config.exit_rule,
          trade_count: config.trade_count,
          profit_factor: config.optimized.profit_factor,
          walk_forward_validated: wfResult.robust,
        },
        "Optimizer-driven exit policy generated",
      );

      return {
        policy,
        source: "holly_optimized",
        walk_forward_validated: wfResult.robust,
        optimizer_data: {
          strategy_key: key,
          exit_rule: config.exit_rule,
          params: config.params,
          trade_count: config.trade_count,
          win_rate: config.optimized.win_rate,
          profit_factor: config.optimized.profit_factor,
          sharpe: config.optimized.sharpe,
          avg_hold_minutes: config.optimized.avg_hold_minutes,
        },
        walk_forward: wfResult.wfData ? {
          test_sharpe: wfResult.wfData.test_sharpe,
          test_pf: wfResult.wfData.test_pf,
          test_wr: wfResult.wfData.test_wr,
          method: wfSummary?.method ?? "unknown",
          n_folds: wfSummary?.n_folds ?? null,
        } : undefined,
        notes,
      };
    }

    notes.push(`No optimizer data for strategy "${input.strategy}". Using heuristic recommendation.`);
  } else if (!data) {
    notes.push("optimal_exit_params.json not found. Run optimizer pipeline first.");
  } else if (!input.strategy) {
    notes.push("No strategy provided. Using heuristic recommendation.");
  }

  // Fallback to recommend.ts
  const recommendInput: ExitPlanRecommendInput = {
    symbol: input.symbol,
    direction: input.direction,
    entry_price: input.entry_price,
    stop_price: input.stop_price,
    total_shares: input.total_shares,
    strategy: input.strategy,
  };

  const policy = recommendPolicy(recommendInput);

  return {
    policy,
    source: "recommended_fallback",
    walk_forward_validated: false,
    notes,
  };
}

// ── Bulk Query ──────────────────────────────────────────────────────────

export interface StrategyExitSummary {
  strategy: string;
  direction: string;
  exit_rule: string;
  params: OptimizerParams;
  trade_count: number;
  win_rate: number;
  profit_factor: number;
  sharpe: number;
  avg_hold_minutes: number;
  profitable: boolean;
  walk_forward_validated: boolean;
  walk_forward_sharpe?: number;
  walk_forward_pf?: number;
}

/** Get all optimizer results as a summary table */
export function getOptimalExitSummary(): StrategyExitSummary[] | null {
  const data = loadOptimalParams();
  if (!data) return null;

  return Object.entries(data.strategies)
    .map(([strategy, config]) => {
      const wf = isWalkForwardRobust(strategy);
      return {
        strategy,
        direction: config.direction,
        exit_rule: config.exit_rule,
        params: config.params,
        trade_count: config.trade_count,
        win_rate: config.optimized.win_rate,
        profit_factor: config.optimized.profit_factor,
        sharpe: config.optimized.sharpe,
        avg_hold_minutes: config.optimized.avg_hold_minutes,
        profitable: config.optimized.profit_factor > 1.0,
        walk_forward_validated: wf.robust,
        walk_forward_sharpe: wf.wfData?.test_sharpe,
        walk_forward_pf: wf.wfData?.test_pf,
      };
    })
    .sort((a, b) => b.profit_factor - a.profit_factor);
}

/** Get optimizer metadata */
export function getOptimalExitMeta(): {
  generated_at: string;
  data_range: string;
  total_trades: number;
  strategies_count: number;
  profitable_count: number;
  global_filters: OptimalExitData["global_filters"];
  walk_forward?: {
    generated_at: string;
    method: string;
    n_folds: number | null;
    robust_count: number;
    overfit_count: number;
    total_evaluated: number;
  };
} | null {
  const data = loadOptimalParams();
  if (!data) return null;

  const strategies = Object.values(data.strategies);
  const wf = loadWalkForwardSummary();

  return {
    generated_at: data.generated_at,
    data_range: data.data_range,
    total_trades: data.total_trades_analyzed,
    strategies_count: strategies.length,
    profitable_count: strategies.filter((s) => s.optimized.profit_factor > 1.0).length,
    global_filters: data.global_filters,
    walk_forward: wf ? {
      generated_at: wf.generated_at,
      method: wf.method,
      n_folds: wf.n_folds,
      robust_count: wf.robust_count,
      overfit_count: wf.overfit_count,
      total_evaluated: wf.total_strategies,
    } : undefined,
  };
}

/** Force reload optimizer + walk-forward data (e.g., after re-running optimization) */
export function reloadOptimalParams(): boolean {
  cachedData = null;
  cacheLoadedAt = 0;
  cachedWF = null;
  wfLoadedAt = 0;
  const data = loadOptimalParams();
  loadWalkForwardSummary(); // Also refresh WF data
  return data !== null;
}
