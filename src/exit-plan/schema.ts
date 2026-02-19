// ── ExitPlan SQLite Schema ───────────────────────────────────────────────
//
// Two tables:
//   exit_plans  — one row per bracket, JSON policy + runtime
//   exit_events — append-only override log (psychology audit trail)

export const EXIT_PLAN_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS exit_plans (
    id TEXT PRIMARY KEY,
    correlation_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    total_shares REAL NOT NULL,
    risk_per_share REAL NOT NULL,
    eval_id TEXT,

    -- State machine
    state TEXT NOT NULL DEFAULT 'draft',

    -- Policy definition (JSON — the plan)
    policy_json TEXT NOT NULL,

    -- Runtime state (JSON — what's happening now)
    runtime_json TEXT NOT NULL,

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_exit_plans_correlation ON exit_plans(correlation_id);
  CREATE INDEX IF NOT EXISTS idx_exit_plans_symbol ON exit_plans(symbol);
  CREATE INDEX IF NOT EXISTS idx_exit_plans_state ON exit_plans(state);
  CREATE INDEX IF NOT EXISTS idx_exit_plans_eval ON exit_plans(eval_id);
  CREATE INDEX IF NOT EXISTS idx_exit_plans_created ON exit_plans(created_at);

  -- Append-only override event log (psychology capture)
  CREATE TABLE IF NOT EXISTS exit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exit_plan_id TEXT NOT NULL REFERENCES exit_plans(id),
    field TEXT NOT NULL,
    old_value TEXT NOT NULL,
    new_value TEXT NOT NULL,
    reason TEXT NOT NULL,
    notes TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_exit_events_plan ON exit_events(exit_plan_id);
  CREATE INDEX IF NOT EXISTS idx_exit_events_reason ON exit_events(reason);
  CREATE INDEX IF NOT EXISTS idx_exit_events_timestamp ON exit_events(timestamp);
`;
