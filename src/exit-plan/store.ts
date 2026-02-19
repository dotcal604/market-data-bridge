// ── ExitPlan Store — Database CRUD + State Machine ──────────────────────

import { randomUUID } from "crypto";
import { getDb } from "../db/database.js";
import { logger } from "../logging.js";
import { EXIT_PLAN_SCHEMA_SQL } from "./schema.js";
import type {
  ExitPlan,
  ExitPlanState,
  ExitPolicy,
  ExitPlanRuntime,
  ExitOverrideEvent,
  OverrideReason,
  ExitPlanCreateInput,
} from "./types.js";
import { isValidTransition } from "./types.js";
import { recommendPolicy } from "./recommend.js";

const log = logger.child({ module: "exit-plan" });

// ── Schema Init ──────────────────────────────────────────────────────────

let _initialized = false;

function ensureSchema(): void {
  if (_initialized) return;
  const db = getDb();
  db.exec(EXIT_PLAN_SCHEMA_SQL);
  _initialized = true;
}

// ── Create ───────────────────────────────────────────────────────────────

export function createExitPlan(input: ExitPlanCreateInput): ExitPlan {
  ensureSchema();
  const db = getDb();

  const id = randomUUID();
  const riskPerShare = Math.abs(input.entry_price - input.hard_stop);

  // Build policy — merge user-provided overrides with recommendations
  const basePolicy = recommendPolicy({
    symbol: input.symbol,
    direction: input.direction,
    entry_price: input.entry_price,
    stop_price: input.hard_stop,
    total_shares: input.total_shares,
    strategy: input.strategy,
  });

  const policy: ExitPolicy = {
    ...basePolicy,
    ...input.policy,
    hard_stop: input.hard_stop,
  };

  // Initial runtime state
  const runtime: ExitPlanRuntime = {
    state: "draft",
    entry_price: null,
    current_stop: policy.hard_stop,
    mfe: 0,
    mae: 0,
    hold_minutes: 0,
    shares_remaining: input.total_shares,
    tps_hit: [],
    exit_price: null,
    r_multiple: null,
    giveback_ratio: null,
  };

  db.prepare(`
    INSERT INTO exit_plans (id, correlation_id, symbol, direction, total_shares, risk_per_share, eval_id, state, policy_json, runtime_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.correlation_id,
    input.symbol,
    input.direction,
    input.total_shares,
    riskPerShare,
    input.eval_id ?? null,
    "draft",
    JSON.stringify(policy),
    JSON.stringify(runtime),
  );

  log.info({ id, symbol: input.symbol, correlation_id: input.correlation_id }, "Exit plan created");

  return {
    id,
    correlation_id: input.correlation_id,
    symbol: input.symbol,
    direction: input.direction,
    total_shares: input.total_shares,
    risk_per_share: riskPerShare,
    eval_id: input.eval_id ?? null,
    policy,
    runtime,
    overrides: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// ── Read ─────────────────────────────────────────────────────────────────

interface ExitPlanRow {
  id: string;
  correlation_id: string;
  symbol: string;
  direction: string;
  total_shares: number;
  risk_per_share: number;
  eval_id: string | null;
  state: string;
  policy_json: string;
  runtime_json: string;
  created_at: string;
  updated_at: string;
}

interface ExitEventRow {
  id: number;
  exit_plan_id: string;
  field: string;
  old_value: string;
  new_value: string;
  reason: string;
  notes: string | null;
  timestamp: string;
}

function rowToPlan(row: ExitPlanRow, events: ExitEventRow[] = []): ExitPlan {
  return {
    id: row.id,
    correlation_id: row.correlation_id,
    symbol: row.symbol,
    direction: row.direction,
    total_shares: row.total_shares,
    risk_per_share: row.risk_per_share,
    eval_id: row.eval_id,
    policy: JSON.parse(row.policy_json) as ExitPolicy,
    runtime: JSON.parse(row.runtime_json) as ExitPlanRuntime,
    overrides: events.map((e) => ({
      id: e.id,
      exit_plan_id: e.exit_plan_id,
      field: e.field,
      old_value: e.old_value,
      new_value: e.new_value,
      reason: e.reason as OverrideReason,
      notes: e.notes,
      timestamp: e.timestamp,
    })),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getExitPlan(id: string): ExitPlan | null {
  ensureSchema();
  const db = getDb();

  const row = db.prepare("SELECT * FROM exit_plans WHERE id = ?").get(id) as ExitPlanRow | undefined;
  if (!row) return null;

  const events = db.prepare(
    "SELECT * FROM exit_events WHERE exit_plan_id = ? ORDER BY timestamp ASC",
  ).all(id) as ExitEventRow[];

  return rowToPlan(row, events);
}

export function getExitPlanByCorrelation(correlationId: string): ExitPlan | null {
  ensureSchema();
  const db = getDb();

  const row = db.prepare(
    "SELECT * FROM exit_plans WHERE correlation_id = ?",
  ).get(correlationId) as ExitPlanRow | undefined;
  if (!row) return null;

  const events = db.prepare(
    "SELECT * FROM exit_events WHERE exit_plan_id = ? ORDER BY timestamp ASC",
  ).all(row.id) as ExitEventRow[];

  return rowToPlan(row, events);
}

export function getActiveExitPlans(): ExitPlan[] {
  ensureSchema();
  const db = getDb();

  const rows = db.prepare(
    "SELECT * FROM exit_plans WHERE state IN ('draft', 'active', 'protecting', 'scaling') ORDER BY updated_at DESC",
  ).all() as ExitPlanRow[];

  return rows.map((row) => {
    const events = db.prepare(
      "SELECT * FROM exit_events WHERE exit_plan_id = ? ORDER BY timestamp ASC",
    ).all(row.id) as ExitEventRow[];
    return rowToPlan(row, events);
  });
}

export function queryExitPlans(opts: {
  symbol?: string;
  state?: ExitPlanState;
  limit?: number;
}): ExitPlan[] {
  ensureSchema();
  const db = getDb();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.symbol) {
    conditions.push("symbol = ?");
    params.push(opts.symbol);
  }
  if (opts.state) {
    conditions.push("state = ?");
    params.push(opts.state);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 50;
  params.push(limit);

  const rows = db.prepare(
    `SELECT * FROM exit_plans ${where} ORDER BY updated_at DESC LIMIT ?`,
  ).all(...params) as ExitPlanRow[];

  return rows.map((row) => {
    const events = db.prepare(
      "SELECT * FROM exit_events WHERE exit_plan_id = ? ORDER BY timestamp ASC",
    ).all(row.id) as ExitEventRow[];
    return rowToPlan(row, events);
  });
}

// ── State Transitions ────────────────────────────────────────────────────

export function transitionState(
  id: string,
  newState: ExitPlanState,
  runtimeUpdates?: Partial<ExitPlanRuntime>,
): ExitPlan {
  ensureSchema();
  const db = getDb();

  const plan = getExitPlan(id);
  if (!plan) throw new Error(`Exit plan not found: ${id}`);

  const currentState = plan.runtime.state;
  if (!isValidTransition(currentState, newState)) {
    throw new Error(
      `Invalid state transition: ${currentState} → ${newState} (plan ${id})`,
    );
  }

  const updatedRuntime: ExitPlanRuntime = {
    ...plan.runtime,
    ...runtimeUpdates,
    state: newState,
  };

  db.prepare(`
    UPDATE exit_plans
    SET state = ?, runtime_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newState, JSON.stringify(updatedRuntime), id);

  log.info({ id, from: currentState, to: newState, symbol: plan.symbol }, "Exit plan state transition");

  return { ...plan, runtime: updatedRuntime };
}

// ── Activate (entry filled) ──────────────────────────────────────────────

export function activateExitPlan(id: string, entryPrice: number): ExitPlan {
  return transitionState(id, "active", {
    entry_price: entryPrice,
    current_stop: null, // will be set from policy.hard_stop
  });
}

// ── Update Runtime (price ticks, MFE/MAE tracking) ──────────────────────

export function updateRuntime(
  id: string,
  updates: Partial<ExitPlanRuntime>,
): ExitPlan {
  ensureSchema();
  const db = getDb();

  const plan = getExitPlan(id);
  if (!plan) throw new Error(`Exit plan not found: ${id}`);

  const updatedRuntime: ExitPlanRuntime = {
    ...plan.runtime,
    ...updates,
  };

  db.prepare(`
    UPDATE exit_plans
    SET runtime_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(updatedRuntime), id);

  return { ...plan, runtime: updatedRuntime };
}

// ── Update Policy (for modifications before or during trade) ─────────────

export function updatePolicy(
  id: string,
  policyUpdates: Partial<ExitPolicy>,
): ExitPlan {
  ensureSchema();
  const db = getDb();

  const plan = getExitPlan(id);
  if (!plan) throw new Error(`Exit plan not found: ${id}`);

  const updatedPolicy: ExitPolicy = {
    ...plan.policy,
    ...policyUpdates,
  };

  db.prepare(`
    UPDATE exit_plans
    SET policy_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(updatedPolicy), id);

  log.info({ id, symbol: plan.symbol, changes: Object.keys(policyUpdates) }, "Exit plan policy updated");

  return { ...plan, policy: updatedPolicy };
}

// ── Record Override (psychology capture) ──────────────────────────────────

export function recordOverride(input: {
  exit_plan_id: string;
  field: string;
  old_value: string;
  new_value: string;
  reason: OverrideReason;
  notes?: string;
}): ExitOverrideEvent {
  ensureSchema();
  const db = getDb();

  const plan = getExitPlan(input.exit_plan_id);
  if (!plan) throw new Error(`Exit plan not found: ${input.exit_plan_id}`);

  const timestamp = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO exit_events (exit_plan_id, field, old_value, new_value, reason, notes, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.exit_plan_id,
    input.field,
    input.old_value,
    input.new_value,
    input.reason,
    input.notes ?? null,
    timestamp,
  );

  log.warn(
    {
      plan_id: input.exit_plan_id,
      symbol: plan.symbol,
      field: input.field,
      reason: input.reason,
    },
    "Exit plan override recorded",
  );

  return {
    id: Number(result.lastInsertRowid),
    exit_plan_id: input.exit_plan_id,
    field: input.field,
    old_value: input.old_value,
    new_value: input.new_value,
    reason: input.reason as OverrideReason,
    notes: input.notes ?? null,
    timestamp,
  };
}

// ── Close Plan (terminal states) ─────────────────────────────────────────

export function closeExitPlan(
  id: string,
  exitPrice: number,
  reason: "tp_filled" | "sl_filled" | "manual" | "flatten" | "cancelled",
): ExitPlan {
  const plan = getExitPlan(id);
  if (!plan) throw new Error(`Exit plan not found: ${id}`);

  const targetState: ExitPlanState = reason === "cancelled" ? "cancelled" : "exited";

  // Calculate R-multiple and giveback
  let rMultiple: number | null = null;
  let givebackRatio: number | null = null;

  if (plan.runtime.entry_price && plan.risk_per_share > 0 && targetState === "exited") {
    const pnlPerShare = plan.direction === "long"
      ? exitPrice - plan.runtime.entry_price
      : plan.runtime.entry_price - exitPrice;
    rMultiple = pnlPerShare / plan.risk_per_share;

    if (plan.runtime.mfe > 0) {
      const actualPnl = pnlPerShare * plan.total_shares;
      const mfePnl = plan.runtime.mfe;
      const giveback = mfePnl - actualPnl;
      givebackRatio = giveback > 0 ? giveback / mfePnl : 0;
    }
  }

  return transitionState(id, targetState, {
    exit_price: exitPrice,
    shares_remaining: 0,
    r_multiple: rMultiple,
    giveback_ratio: givebackRatio,
  });
}

// ── Analytics Queries ────────────────────────────────────────────────────

export interface ExitPlanStats {
  total: number;
  active: number;
  exited: number;
  cancelled: number;
  avg_r_multiple: number | null;
  avg_giveback_ratio: number | null;
  override_count: number;
  override_reasons: Record<string, number>;
}

export function getExitPlanStats(days: number = 90): ExitPlanStats {
  ensureSchema();
  const db = getDb();

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN state IN ('draft','active','protecting','scaling') THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN state = 'exited' THEN 1 ELSE 0 END) as exited,
      SUM(CASE WHEN state = 'cancelled' THEN 1 ELSE 0 END) as cancelled
    FROM exit_plans
    WHERE created_at >= datetime('now', ? || ' days')
  `).get(`-${days}`) as { total: number; active: number; exited: number; cancelled: number };

  const avgs = db.prepare(`
    SELECT
      AVG(json_extract(runtime_json, '$.r_multiple')) as avg_r,
      AVG(json_extract(runtime_json, '$.giveback_ratio')) as avg_giveback
    FROM exit_plans
    WHERE state = 'exited'
      AND created_at >= datetime('now', ? || ' days')
  `).get(`-${days}`) as { avg_r: number | null; avg_giveback: number | null };

  const overrides = db.prepare(`
    SELECT reason, COUNT(*) as cnt
    FROM exit_events ee
    JOIN exit_plans ep ON ep.id = ee.exit_plan_id
    WHERE ep.created_at >= datetime('now', ? || ' days')
    GROUP BY reason
    ORDER BY cnt DESC
  `).all(`-${days}`) as Array<{ reason: string; cnt: number }>;

  const overrideReasons: Record<string, number> = {};
  let overrideCount = 0;
  for (const row of overrides) {
    overrideReasons[row.reason] = row.cnt;
    overrideCount += row.cnt;
  }

  return {
    total: totals.total,
    active: totals.active,
    exited: totals.exited,
    cancelled: totals.cancelled,
    avg_r_multiple: avgs.avg_r,
    avg_giveback_ratio: avgs.avg_giveback,
    override_count: overrideCount,
    override_reasons: overrideReasons,
  };
}
