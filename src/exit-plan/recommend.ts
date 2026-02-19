// ── ExitPlan Policy Recommender ──────────────────────────────────────────
//
// Generates a sensible default ExitPolicy by combining:
//  1. Hard stop from user input
//  2. TP ladder based on R-multiples (standard: 1R, 2R, runner)
//  3. Holly exit-autopsy archetype (if available)
//  4. Per-strategy trailing stop optimization (if historical data exists)

import { logger } from "../logging.js";
import { trailingStopRecommendation } from "../holly/trailing-stop-executor.js";
import { runExitAutopsy } from "../holly/exit-autopsy.js";
import type {
  ExitPolicy,
  ExitPlanRecommendInput,
  TPTarget,
  RunnerPolicy,
  ProtectTrigger,
  GivebackGuard,
} from "./types.js";

const log = logger.child({ module: "exit-plan-recommend" });

// ── Default TP Ladder ────────────────────────────────────────────────────

function buildTPLadder(
  entryPrice: number,
  stopPrice: number,
  direction: "long" | "short",
): TPTarget[] {
  const riskPerShare = Math.abs(entryPrice - stopPrice);

  if (direction === "long") {
    return [
      { label: "tp1", price: +(entryPrice + riskPerShare * 1.5).toFixed(2), qty_pct: 0.33 },
      { label: "tp2", price: +(entryPrice + riskPerShare * 2.5).toFixed(2), qty_pct: 0.33 },
      // Remaining 34% is the "runner" — managed by runner policy
    ];
  }

  // Short direction
  return [
    { label: "tp1", price: +(entryPrice - riskPerShare * 1.5).toFixed(2), qty_pct: 0.33 },
    { label: "tp2", price: +(entryPrice - riskPerShare * 2.5).toFixed(2), qty_pct: 0.33 },
  ];
}

// ── Default Runner Policy ────────────────────────────────────────────────

function buildRunnerPolicy(
  strategy?: string,
): RunnerPolicy {
  // Try Holly trailing-stop recommendation first
  if (strategy) {
    const rec = trailingStopRecommendation("_default", strategy);
    if (rec) {
      const params = rec.params;
      return {
        trail_pct: params.trail_pct ?? 0.03,
        atr_multiple: params.atr_mult ?? null,
        time_stop_min: null, // Holly doesn't have time stops — use archetype adjustments
        be_trail: params.be_trigger_r !== undefined && params.be_trigger_r !== null,
        post_be_trail_pct: params.post_be_trail_pct ?? null,
      };
    }
  }

  // Sensible defaults
  return {
    trail_pct: 0.03,       // 3% trailing stop
    atr_multiple: null,
    time_stop_min: null,
    be_trail: true,         // Move to BE then trail
    post_be_trail_pct: 0.02, // Tighter 2% trail after BE
  };
}

// ── Default Protect Trigger ──────────────────────────────────────────────

function buildProtectTrigger(): ProtectTrigger {
  return {
    r_multiple: 1.0,           // Protect after +1R
    dollars_per_share: null,
    new_stop: "breakeven",     // Move stop to BE
  };
}

// ── Default Giveback Guard ───────────────────────────────────────────────

function buildGivebackGuard(riskPerShare: number, totalShares: number): GivebackGuard {
  return {
    max_ratio: 0.30,                         // Give back max 30% of peak profit
    min_mfe_dollars: riskPerShare * totalShares, // Activate after 1R of total $ profit
  };
}

// ── Archetype Detection ──────────────────────────────────────────────────

/**
 * Try to detect strategy archetype from Holly exit-autopsy data.
 * Falls back to "mixed" if no historical data or insufficient trades.
 */
function detectArchetype(
  strategy?: string,
): ExitPolicy["archetype"] {
  if (!strategy) return "mixed";

  try {
    const report = runExitAutopsy();
    const rec = report.exit_policy_recs.find(
      (r) => r.strategy.toLowerCase() === strategy.toLowerCase(),
    );
    if (rec) {
      log.info({ strategy, archetype: rec.archetype }, "Archetype detected from exit-autopsy");
      return rec.archetype;
    }
  } catch (err) {
    log.debug({ err, strategy }, "Exit-autopsy unavailable — using default archetype");
  }

  return "mixed";
}

// ── Archetype Adjustments ────────────────────────────────────────────────

function adjustForArchetype(
  policy: ExitPolicy,
  entryPrice: number,
  stopPrice: number,
  direction: "long" | "short",
): ExitPolicy {
  const riskPerShare = Math.abs(entryPrice - stopPrice);

  switch (policy.archetype) {
    case "early_peaker":
      // Take profit faster, add time stop
      policy.tp_ladder = [
        { label: "tp1", price: +(direction === "long" ? entryPrice + riskPerShare : entryPrice - riskPerShare).toFixed(2), qty_pct: 0.50 },
        { label: "tp2", price: +(direction === "long" ? entryPrice + riskPerShare * 1.5 : entryPrice - riskPerShare * 1.5).toFixed(2), qty_pct: 0.25 },
      ];
      policy.runner.time_stop_min = 30; // Exit runner after 30 min
      policy.runner.trail_pct = 0.02;   // Tighter trail
      policy.giveback_guard.max_ratio = 0.20; // Tighter giveback
      break;

    case "late_grower":
      // Let it run, wider trail
      policy.tp_ladder = [
        { label: "tp1", price: +(direction === "long" ? entryPrice + riskPerShare * 2 : entryPrice - riskPerShare * 2).toFixed(2), qty_pct: 0.25 },
        { label: "tp2", price: +(direction === "long" ? entryPrice + riskPerShare * 3.5 : entryPrice - riskPerShare * 3.5).toFixed(2), qty_pct: 0.25 },
      ];
      policy.runner.trail_pct = 0.05; // Wider trail
      policy.giveback_guard.max_ratio = 0.40; // More tolerance
      break;

    case "bleeder":
      // Aggressive profit-taking, tight everything
      policy.tp_ladder = [
        { label: "tp1", price: +(direction === "long" ? entryPrice + riskPerShare * 0.75 : entryPrice - riskPerShare * 0.75).toFixed(2), qty_pct: 0.50 },
        { label: "tp2", price: +(direction === "long" ? entryPrice + riskPerShare * 1.25 : entryPrice - riskPerShare * 1.25).toFixed(2), qty_pct: 0.30 },
      ];
      policy.runner.trail_pct = 0.015; // Very tight trail
      policy.runner.time_stop_min = 20; // Exit runner fast
      policy.giveback_guard.max_ratio = 0.15; // Minimal giveback
      break;

    case "mixed":
    default:
      // Keep defaults — standard bracket approach
      break;
  }

  return policy;
}

// ── Main Recommend Function ──────────────────────────────────────────────

export function recommendPolicy(input: ExitPlanRecommendInput): ExitPolicy {
  const riskPerShare = Math.abs(input.entry_price - input.stop_price);

  const archetype = input.archetype ?? detectArchetype(input.strategy);

  let policy: ExitPolicy = {
    hard_stop: input.stop_price,
    tp_ladder: buildTPLadder(input.entry_price, input.stop_price, input.direction),
    runner: buildRunnerPolicy(input.strategy),
    protect_trigger: buildProtectTrigger(),
    giveback_guard: buildGivebackGuard(riskPerShare, input.total_shares),
    archetype,
    source: "recommended",
  };

  // Adjust based on archetype
  policy = adjustForArchetype(policy, input.entry_price, input.stop_price, input.direction);

  log.info(
    {
      symbol: input.symbol,
      archetype,
      tp_levels: policy.tp_ladder.length,
      trail_pct: policy.runner.trail_pct,
    },
    "Exit policy recommended",
  );

  return policy;
}
