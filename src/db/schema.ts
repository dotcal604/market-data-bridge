export const evalReasoningSchemaSql = `
  -- Structured reasoning extracted from model responses
  CREATE TABLE IF NOT EXISTS eval_reasoning (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    model_id TEXT NOT NULL,
    key_drivers TEXT NOT NULL,     -- JSON array
    risk_factors TEXT NOT NULL,    -- JSON array
    uncertainties TEXT NOT NULL,   -- JSON array
    conviction TEXT,               -- "high" | "medium" | "low"
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(evaluation_id, model_id)
  );
  CREATE INDEX IF NOT EXISTS idx_reasoning_eval_id ON eval_reasoning(evaluation_id);
  CREATE INDEX IF NOT EXISTS idx_reasoning_model_id ON eval_reasoning(model_id);
`;

export const RISK_CONFIG_DEFAULTS = {
  max_position_pct: 0.05,
  max_daily_loss_pct: 0.02,
  max_concentration_pct: 0.25,
  volatility_scalar: 1.0,
} as const;

export type RiskConfigParam = keyof typeof RISK_CONFIG_DEFAULTS;

export const RISK_CONFIG_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS risk_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    param TEXT NOT NULL UNIQUE,
    value REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_risk_config_param ON risk_config(param);
`;

export const ANALYTICS_JOBS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS analytics_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    script TEXT NOT NULL,
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'running',
    exit_code INTEGER,
    stdout TEXT,
    stderr TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_analytics_jobs_script ON analytics_jobs(script);
  CREATE INDEX IF NOT EXISTS idx_analytics_jobs_status ON analytics_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_analytics_jobs_created ON analytics_jobs(created_at);
`;
