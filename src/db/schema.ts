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
