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
