/**
 * Exit Suggestion Engine — takes a Holly alert/trade setup and produces
 * a complete exit strategy by combining:
 *
 * 1. Offline exit params (analytics/holly_exit/ → exit-params.ts)
 * 2. Exit autopsy archetype detection (exit-autopsy.ts)
 * 3. Trailing stop optimization (trailing-stop-optimizer.ts)
 * 4. Regime-based scaling (regime data from analytics)
 *
 * Output plugs directly into the ExitPolicy type from src/exit-plan/types.ts.
 */
import { logger } from "../logging.js";
import { getStrategyExitParams, type StrategyExitParams, type RegimeScalars } from "./exit-params.js";
import { trailingStopRecommendation } from "./trailing-stop-executor.js";
import { runExitAutopsy } from "./exit-autopsy.js";
import type { ExitPolicy, TPTarget, RunnerPolicy, ProtectTrigger, GivebackGuard } from "../exit-plan/types.js";

const log = logger.child({ module: "suggest-exits" });

// ── Input / Output Types ─────────────────────────────────────────────────

export interface ExitSuggestionInput {
  symbol: string;
  direction: "long" | "short";
  entry_price: number;
  stop_price: number;
  total_shares: number;
  /** Holly strategy name (e.g., "momentum_breakout") */
  strategy?: string;
  /** Current volatility regime */
  volatility_regime?: "low" | "normal" | "high" | "extreme";
  /** Override archetype detection */
  archetype?: ExitPolicy["archetype"];
}

export interface ExitSuggestion {
  /** The suggested exit policy (ready for ExitPlan creation) */
  policy: ExitPolicy;
  /** Where the suggestion data came from */
  sources: string[];
  /** Regime scalars applied (if any) */
  regime_applied: RegimeScalars | null;
  /** Confidence: how much data backs this suggestion (0-1) */
  confidence: number;
  /** Warnings or caveats */
  warnings: string[];
}

// ── Core Logic ────────────────────────────────────────────────────────────

/**
 * Build TP ladder from exit params + regime scaling.
 */
function buildTPLadder(
  entryPrice: number,
  stopPrice: number,
  direction: "long" | "short",
  params: StrategyExitParams | null,
  regimeScalars: RegimeScalars | null,
): TPTarget[] {
  const riskPerShare = Math.abs(entryPrice - stopPrice);
  const targetScalar = regimeScalars?.target_scalar ?? 1.0;

  // Use analytics-optimized targets if available
  const tp1R = (params?.optimal_targets.tp1_r ?? 1.5) * targetScalar;
  const tp1Qty = params?.optimal_targets.tp1_qty_pct ?? 0.33;
  const tp2R = (params?.optimal_targets.tp2_r ?? 2.5) * targetScalar;
  const tp2Qty = params?.optimal_targets.tp2_qty_pct ?? 0.33;

  if (direction === "long") {
    return [
      { label: "tp1", price: +(entryPrice + riskPerShare * tp1R).toFixed(2), qty_pct: tp1Qty },
      { label: "tp2", price: +(entryPrice + riskPerShare * tp2R).toFixed(2), qty_pct: tp2Qty },
    ];
  }

  return [
    { label: "tp1", price: +(entryPrice - riskPerShare * tp1R).toFixed(2), qty_pct: tp1Qty },
    { label: "tp2", price: +(entryPrice - riskPerShare * tp2R).toFixed(2), qty_pct: tp2Qty },
  ];
}

/**
 * Build runner policy from trailing-stop data + exit params.
 */
function buildRunnerPolicy(
  symbol: string,
  strategy: string | undefined,
  params: StrategyExitParams | null,
): RunnerPolicy {
  // Try Holly trailing-stop recommendation first
  if (strategy) {
    const rec = trailingStopRecommendation(symbol, strategy);
    if (rec) {
      const p = rec.params;
      return {
        trail_pct: p.trail_pct ?? params?.optimal_targets.runner_trail_pct ?? 0.03,
        atr_multiple: p.atr_mult ?? null,
        time_stop_min: params?.timing.optimal_time_stop_min ?? null,
        be_trail: p.be_trigger_r !== undefined && p.be_trigger_r !== null,
        post_be_trail_pct: p.post_be_trail_pct ?? null,
      };
    }
  }

  // Fall back to analytics exit params
  if (params) {
    return {
      trail_pct: params.optimal_targets.runner_trail_pct,
      atr_multiple: params.optimal_stop.method === "atr" ? params.optimal_stop.atr_multiple : null,
      time_stop_min: params.timing.optimal_time_stop_min,
      be_trail: true,
      post_be_trail_pct: params.optimal_targets.runner_trail_pct * 0.67, // tighter after BE
    };
  }

  // Sensible defaults
  return {
    trail_pct: 0.03,
    atr_multiple: null,
    time_stop_min: null,
    be_trail: true,
    post_be_trail_pct: 0.02,
  };
}

/**
 * Detect archetype from exit-autopsy data.
 */
function detectArchetype(strategy?: string): ExitPolicy["archetype"] {
  if (!strategy) return "mixed";

  try {
    const report = runExitAutopsy();
    const rec = report.exit_policy_recs.find(
      (r) => r.strategy.toLowerCase() === strategy.toLowerCase(),
    );
    if (rec) return rec.archetype;
  } catch {
    // Exit autopsy unavailable — not enough trade data
  }

  return "mixed";
}

/**
 * Adjust policy based on archetype (same logic as exit-plan/recommend.ts
 * but parameterized by analytics data when available).
 */
function adjustForArchetype(
  policy: ExitPolicy,
  entryPrice: number,
  stopPrice: number,
  direction: "long" | "short",
  params: StrategyExitParams | null,
): ExitPolicy {
  const riskPerShare = Math.abs(entryPrice - stopPrice);

  switch (policy.archetype) {
    case "early_peaker": {
      const timeToMfe = params?.timing.avg_time_to_mfe_min ?? 15;
      policy.tp_ladder = [
        { label: "tp1", price: +(direction === "long" ? entryPrice + riskPerShare : entryPrice - riskPerShare).toFixed(2), qty_pct: 0.50 },
        { label: "tp2", price: +(direction === "long" ? entryPrice + riskPerShare * 1.5 : entryPrice - riskPerShare * 1.5).toFixed(2), qty_pct: 0.25 },
      ];
      policy.runner.time_stop_min = Math.round(timeToMfe * 2);
      policy.runner.trail_pct = 0.02;
      policy.giveback_guard.max_ratio = 0.20;
      break;
    }
    case "late_grower":
      policy.tp_ladder = [
        { label: "tp1", price: +(direction === "long" ? entryPrice + riskPerShare * 2 : entryPrice - riskPerShare * 2).toFixed(2), qty_pct: 0.25 },
        { label: "tp2", price: +(direction === "long" ? entryPrice + riskPerShare * 3.5 : entryPrice - riskPerShare * 3.5).toFixed(2), qty_pct: 0.25 },
      ];
      policy.runner.trail_pct = 0.05;
      policy.giveback_guard.max_ratio = 0.40;
      break;

    case "bleeder":
      policy.tp_ladder = [
        { label: "tp1", price: +(direction === "long" ? entryPrice + riskPerShare * 0.75 : entryPrice - riskPerShare * 0.75).toFixed(2), qty_pct: 0.50 },
        { label: "tp2", price: +(direction === "long" ? entryPrice + riskPerShare * 1.25 : entryPrice - riskPerShare * 1.25).toFixed(2), qty_pct: 0.30 },
      ];
      policy.runner.trail_pct = 0.015;
      policy.runner.time_stop_min = params?.timing.avg_time_to_mfe_min ?? 20;
      policy.giveback_guard.max_ratio = 0.15;
      break;

    case "mixed":
    default:
      break;
  }

  return policy;
}

/**
 * Get regime-based scalars for a strategy + volatility regime.
 */
function getRegimeScalars(
  params: StrategyExitParams | null,
  regime?: string,
): RegimeScalars | null {
  if (!params || !regime) return null;

  const key = regime === "extreme" ? "high_vol" : `${regime}_vol`;
  return params.regime_adjustments[key] ?? null;
}

/**
 * Apply regime stop scalar to the hard stop price.
 */
function applyRegimeStop(
  stopPrice: number,
  entryPrice: number,
  direction: "long" | "short",
  scalars: RegimeScalars | null,
): number {
  if (!scalars) return stopPrice;
  const risk = Math.abs(entryPrice - stopPrice);
  const adjustedRisk = risk * scalars.stop_scalar;

  if (direction === "long") return +(entryPrice - adjustedRisk).toFixed(2);
  return +(entryPrice + adjustedRisk).toFixed(2);
}

// ── Main Entry Point ──────────────────────────────────────────────────────

/**
 * Generate exit suggestion for a trade setup.
 *
 * Combines analytics-optimized exit params, trailing stop data,
 * archetype from exit-autopsy, and regime adjustments.
 */
export function suggestExit(input: ExitSuggestionInput): ExitSuggestion {
  const sources: string[] = [];
  const warnings: string[] = [];
  let confidence = 0.3; // baseline: default params

  // 1. Load analytics exit params for this strategy
  const params = input.strategy ? getStrategyExitParams(input.strategy) : null;
  if (params) {
    sources.push("holly_exit_params");
    confidence = Math.min(1.0, 0.3 + params.trades_analyzed / 200);
    if (params.trades_analyzed < 30) {
      warnings.push(`Low sample size: only ${params.trades_analyzed} trades for strategy '${input.strategy}'`);
    }
  } else if (input.strategy) {
    warnings.push(`No analytics exit params for strategy '${input.strategy}' — using defaults`);
  }

  // 2. Regime scalars
  const regimeScalars = getRegimeScalars(params, input.volatility_regime);
  if (regimeScalars) {
    sources.push(`regime:${input.volatility_regime}`);
  }

  // 3. Archetype
  const archetype = input.archetype ?? detectArchetype(input.strategy);
  if (archetype !== "mixed") {
    sources.push(`archetype:${archetype}`);
  }

  // 4. Adjusted stop
  const adjustedStop = applyRegimeStop(
    input.stop_price,
    input.entry_price,
    input.direction,
    regimeScalars,
  );

  // 5. Build policy
  const riskPerShare = Math.abs(input.entry_price - adjustedStop);

  const runner = buildRunnerPolicy(input.symbol, input.strategy, params);
  if (runner.trail_pct !== 0.03 || runner.atr_multiple) {
    sources.push("trailing_stop_optimizer");
  }

  const protectTrigger: ProtectTrigger = {
    r_multiple: 1.0,
    dollars_per_share: null,
    new_stop: "breakeven",
  };

  const givebackGuard: GivebackGuard = {
    max_ratio: 0.30,
    min_mfe_dollars: riskPerShare * input.total_shares,
  };

  let policy: ExitPolicy = {
    hard_stop: adjustedStop,
    tp_ladder: buildTPLadder(input.entry_price, adjustedStop, input.direction, params, regimeScalars),
    runner,
    protect_trigger: protectTrigger,
    giveback_guard: givebackGuard,
    archetype,
    source: sources.length > 0 ? "holly_optimized" : "default",
  };

  // 6. Archetype adjustments (may override TP ladder, runner, giveback)
  policy = adjustForArchetype(policy, input.entry_price, adjustedStop, input.direction, params);

  // 7. Timing warnings
  if (params?.timing.best_entry_window) {
    sources.push(`timing:${params.timing.best_entry_window}`);
  }

  if (sources.length === 0) {
    sources.push("defaults");
  }

  log.info(
    {
      symbol: input.symbol,
      strategy: input.strategy,
      archetype,
      regime: input.volatility_regime,
      confidence: confidence.toFixed(2),
      sources,
    },
    "Exit suggestion generated",
  );

  return {
    policy,
    sources,
    regime_applied: regimeScalars,
    confidence,
    warnings,
  };
}
