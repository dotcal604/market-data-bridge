// ── ExitPlan Domain Types ────────────────────────────────────────────────
//
// First-class exit management domain object.
// Attaches to brackets (correlation_id), not positions — because:
//  1. One symbol can have multiple concurrent brackets (scale-in, re-entry)
//  2. Brackets already have lifecycle tracking (parent_order_id, OCA groups)
//  3. eval_id → correlation_id → execution chain already exists
//  4. Exit autopsy operates at per-trade (bracket) level

// ── State Machine ────────────────────────────────────────────────────────

/**
 * ExitPlan lifecycle states:
 *
 *   draft → active → protecting → scaling → exited
 *                ↘                          ↗
 *                  → cancelled ────────────
 *
 * - draft:      Plan created but bracket not yet filled
 * - active:     Entry filled, exit plan is live (hard stop + initial TP targets)
 * - protecting: Unrealized profit > protect_trigger (e.g., +1R) — stop moved to BE or better
 * - scaling:    Partial TP hit (tp1 filled), runner portion active with trailing stop
 * - exited:     All shares closed (TP, SL, or manual override)
 * - cancelled:  Entry never filled, or bracket cancelled before any fill
 */
export type ExitPlanState =
  | "draft"
  | "active"
  | "protecting"
  | "scaling"
  | "exited"
  | "cancelled";

// ── Policy Definition ────────────────────────────────────────────────────

/** Take-profit ladder target */
export interface TPTarget {
  /** Label for this target level */
  label: string;
  /** Price target */
  price: number;
  /** Fraction of position to close (0-1) */
  qty_pct: number;
}

/** Runner policy — how remaining shares trail after partial TPs */
export interface RunnerPolicy {
  /** Trailing stop percentage (0-1, e.g., 0.03 = 3%) */
  trail_pct: number;
  /** ATR multiplier for trailing stop (alternative to trail_pct) */
  atr_multiple: number | null;
  /** Time-based stop: exit after N minutes regardless */
  time_stop_min: number | null;
  /** Move to breakeven, then trail from there */
  be_trail: boolean;
  /** Post-breakeven trailing percentage (overrides trail_pct after BE) */
  post_be_trail_pct: number | null;
}

/** Protect trigger — conditions to transition from active → protecting */
export interface ProtectTrigger {
  /** Move stop to BE after this R-multiple is reached (e.g., 1.0 = +1R) */
  r_multiple: number;
  /** Alternative: move stop to BE after this $ profit per share */
  dollars_per_share: number | null;
  /** Where to set stop after trigger: "breakeven", "half_r", or specific price delta */
  new_stop: "breakeven" | "half_r" | number;
}

/** Giveback guard — max unrealized profit you'll let evaporate */
export interface GivebackGuard {
  /** Max giveback as ratio of MFE (0-1, e.g., 0.30 = give back max 30% of peak) */
  max_ratio: number;
  /** Minimum MFE in $ before giveback guard activates */
  min_mfe_dollars: number;
}

/** Complete exit policy definition (the "what should happen") */
export interface ExitPolicy {
  /** Hard stop loss price — the worst-case exit */
  hard_stop: number;
  /** Take-profit ladder (ordered by price, ascending for longs) */
  tp_ladder: TPTarget[];
  /** Runner policy for trailing remaining shares */
  runner: RunnerPolicy;
  /** When to start protecting profits */
  protect_trigger: ProtectTrigger;
  /** How much giveback to tolerate */
  giveback_guard: GivebackGuard;
  /** Strategy archetype from exit-autopsy (for recommendation matching) */
  archetype: "early_peaker" | "late_grower" | "bleeder" | "mixed" | null;
  /** Source of this policy: "manual", "recommended", "holly_optimized" */
  source: string;
}

// ── Override Events (Psychology Capture) ──────────────────────────────────

/** Why did the trader override the plan? */
export type OverrideReason =
  | "revenge"          // Holding/widening stop after loss
  | "too_early"        // Took profit too early (FOMO exit)
  | "too_late"         // Held too long, gave back profits
  | "freeze"           // Couldn't pull the trigger on stop
  | "tilt"             // Emotional trading, abandoned plan
  | "news"             // Material news changed thesis
  | "technical"        // Technical signal changed (legitimate)
  | "sizing"           // Changed position size mid-trade
  | "manual_override"  // General manual override
  | "system_error";    // System/connection issue forced manual exit

/** An override event — append-only psychology audit trail */
export interface ExitOverrideEvent {
  id?: number;
  exit_plan_id: string;
  /** What was changed */
  field: string;
  /** Previous value (serialized) */
  old_value: string;
  /** New value (serialized) */
  new_value: string;
  /** Why it was changed */
  reason: OverrideReason;
  /** Free-form notes (e.g., "news: FDA approval, adjusting targets") */
  notes: string | null;
  /** Timestamp of the override */
  timestamp: string;
}

// ── Runtime State (the "what is happening") ──────────────────────────────

/** Runtime state tracked as the trade progresses */
export interface ExitPlanRuntime {
  /** Current plan state */
  state: ExitPlanState;
  /** Actual entry price (from fill) */
  entry_price: number | null;
  /** Current stop price (may differ from hard_stop after protect/trail) */
  current_stop: number | null;
  /** Max favorable excursion since entry ($) */
  mfe: number;
  /** Max adverse excursion since entry ($) */
  mae: number;
  /** Minutes since entry fill */
  hold_minutes: number;
  /** Shares remaining (decreases as TPs hit) */
  shares_remaining: number;
  /** Which TP levels have been hit */
  tps_hit: string[];
  /** Actual exit price (when state = exited) */
  exit_price: number | null;
  /** Actual R-multiple achieved */
  r_multiple: number | null;
  /** Actual giveback ratio at exit */
  giveback_ratio: number | null;
}

// ── The ExitPlan itself ──────────────────────────────────────────────────

/** Complete ExitPlan domain object */
export interface ExitPlan {
  /** UUID */
  id: string;
  /** Links to orders table — the bracket this plan manages */
  correlation_id: string;
  /** Symbol (denormalized for quick queries) */
  symbol: string;
  /** "long" | "short" */
  direction: string;
  /** Total shares in the bracket */
  total_shares: number;
  /** Risk per share (entry - hard_stop) */
  risk_per_share: number;
  /** Optional eval link */
  eval_id: string | null;

  /** The exit policy (the plan) */
  policy: ExitPolicy;

  /** Runtime state (what's happening now) */
  runtime: ExitPlanRuntime;

  /** Append-only override events */
  overrides: ExitOverrideEvent[];

  /** Timestamps */
  created_at: string;
  updated_at: string;
}

// ── State Transitions ────────────────────────────────────────────────────

/** Valid state transitions */
export const VALID_TRANSITIONS: Record<ExitPlanState, ExitPlanState[]> = {
  draft:      ["active", "cancelled"],
  active:     ["protecting", "scaling", "exited", "cancelled"],
  protecting: ["scaling", "exited", "cancelled"],
  scaling:    ["exited", "cancelled"],
  exited:     [],          // terminal
  cancelled:  [],          // terminal
};

/** Check if a state transition is valid */
export function isValidTransition(from: ExitPlanState, to: ExitPlanState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// ── Recommend Policy Params ──────────────────────────────────────────────

/** Input for generating a recommended ExitPolicy */
export interface ExitPlanRecommendInput {
  symbol: string;
  direction: "long" | "short";
  entry_price: number;
  stop_price: number;
  total_shares: number;
  strategy?: string;
  /** Override archetype detection */
  archetype?: ExitPolicy["archetype"];
}

/** MCP tool create input */
export interface ExitPlanCreateInput {
  correlation_id: string;
  symbol: string;
  direction: "long" | "short";
  total_shares: number;
  entry_price: number;
  hard_stop: number;
  /** Optional: provide full policy, or let system recommend */
  policy?: Partial<ExitPolicy>;
  eval_id?: string;
  strategy?: string;
}
