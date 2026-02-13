import Database, { type Database as DatabaseType } from "better-sqlite3";

let testDb: DatabaseType | null = null;

/**
 * Creates an in-memory SQLite database with the full schema.
 * Call this in your test setup or at the beginning of each test.
 */
export function getTestDb(): DatabaseType {
  if (testDb) return testDb;

  testDb = new Database(":memory:");

  // WAL mode — prevents event loop blocking during concurrent reads/writes
  testDb.pragma("journal_mode = WAL");
  testDb.pragma("synchronous = NORMAL");
  testDb.pragma("foreign_keys = ON");

  // ── Schema Migration ─────────────────────────────────────────────────────
  // Same schema as src/db/database.ts

  testDb.exec(`
    CREATE TABLE IF NOT EXISTS trade_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT,
      strategy_version TEXT,
      reasoning TEXT NOT NULL,
      ai_recommendations TEXT,
      tags TEXT,                -- JSON array
      outcome_tags TEXT,        -- JSON array (post-trade)
      notes TEXT,
      -- Market context at entry
      spy_price REAL,
      vix_level REAL,
      gap_pct REAL,
      relative_volume REAL,
      time_of_day TEXT,
      session_type TEXT,
      spread_pct REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      action TEXT NOT NULL,
      order_type TEXT NOT NULL,
      total_quantity REAL NOT NULL,
      lmt_price REAL,
      aux_price REAL,
      tif TEXT,
      sec_type TEXT DEFAULT 'STK',
      exchange TEXT DEFAULT 'SMART',
      currency TEXT DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'PendingSubmit',
      filled_quantity REAL DEFAULT 0,
      avg_fill_price REAL,
      strategy_version TEXT NOT NULL DEFAULT 'manual',
      order_source TEXT NOT NULL DEFAULT 'manual',
      ai_confidence REAL,
      correlation_id TEXT NOT NULL,
      journal_id INTEGER REFERENCES trade_journal(id),
      parent_order_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exec_id TEXT NOT NULL UNIQUE,
      order_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      shares REAL NOT NULL,
      price REAL NOT NULL,
      cum_qty REAL,
      avg_price REAL,
      commission REAL,
      realized_pnl REAL,
      correlation_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS positions_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      positions TEXT NOT NULL,  -- JSON array
      source TEXT NOT NULL DEFAULT 'reconcile',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS collab_messages (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      reply_to TEXT,
      tags TEXT,               -- JSON array
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      net_liquidation REAL,
      total_cash_value REAL,
      buying_power REAL,
      daily_pnl REAL,
      unrealized_pnl REAL,
      realized_pnl REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Composite indexes for research queries
    CREATE INDEX IF NOT EXISTS idx_orders_symbol_strategy ON orders(symbol, strategy_version);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_correlation ON orders(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_executions_order ON executions(order_id);
    CREATE INDEX IF NOT EXISTS idx_executions_correlation ON executions(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_executions_timestamp ON executions(timestamp);
    CREATE INDEX IF NOT EXISTS idx_journal_symbol_strategy ON trade_journal(symbol, strategy_version);
    CREATE INDEX IF NOT EXISTS idx_journal_created ON trade_journal(created_at);
    CREATE INDEX IF NOT EXISTS idx_collab_author ON collab_messages(author);
    CREATE INDEX IF NOT EXISTS idx_collab_created ON collab_messages(created_at);

    -- ── Eval Engine Tables ──────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      direction TEXT,
      entry_price REAL,
      stop_price REAL,
      user_notes TEXT,
      timestamp TEXT NOT NULL,

      -- Feature vector (JSON blob for reproducibility + individual cols for queries)
      features_json TEXT NOT NULL,
      last_price REAL,
      rvol REAL,
      vwap_deviation_pct REAL,
      spread_pct REAL,
      float_rotation_est REAL,
      volume_acceleration REAL,
      atr_pct REAL,
      price_extension_pct REAL,
      gap_pct REAL,
      range_position_pct REAL,
      volatility_regime TEXT,
      liquidity_bucket TEXT,
      spy_change_pct REAL,
      qqq_change_pct REAL,
      market_alignment TEXT,
      time_of_day TEXT,
      minutes_since_open INTEGER,

      -- Ensemble result
      ensemble_trade_score REAL,
      ensemble_trade_score_median REAL,
      ensemble_expected_rr REAL,
      ensemble_confidence REAL,
      ensemble_should_trade INTEGER,
      ensemble_unanimous INTEGER,
      ensemble_majority_trade INTEGER,
      ensemble_score_spread REAL,
      ensemble_disagreement_penalty REAL,
      weights_json TEXT,

      -- Guardrail
      guardrail_allowed INTEGER,
      guardrail_flags_json TEXT,
      prefilter_passed INTEGER,

      -- Latency
      feature_latency_ms INTEGER,
      total_latency_ms INTEGER
    );

    CREATE TABLE IF NOT EXISTS model_outputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
      model_id TEXT NOT NULL,

      -- Parsed output fields (null if non-compliant)
      trade_score REAL,
      extension_risk REAL,
      exhaustion_risk REAL,
      float_rotation_risk REAL,
      market_alignment_score REAL,
      expected_rr REAL,
      confidence REAL,
      should_trade INTEGER,
      reasoning TEXT,

      -- Meta / audit
      raw_response TEXT,
      compliant INTEGER NOT NULL,
      error TEXT,
      latency_ms INTEGER,
      model_version TEXT,
      prompt_hash TEXT,
      token_count INTEGER,
      api_response_id TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evaluation_id TEXT NOT NULL UNIQUE REFERENCES evaluations(id),
      trade_taken INTEGER NOT NULL,
      actual_entry_price REAL,
      actual_exit_price REAL,
      r_multiple REAL,
      exit_reason TEXT,
      notes TEXT,
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weight_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      weights_json TEXT NOT NULL,
      sample_size INTEGER,
      reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_eval_symbol ON evaluations(symbol);
    CREATE INDEX IF NOT EXISTS idx_eval_timestamp ON evaluations(timestamp);
    CREATE INDEX IF NOT EXISTS idx_eval_symbol_time ON evaluations(symbol, timestamp);
    CREATE INDEX IF NOT EXISTS idx_eval_time_of_day ON evaluations(time_of_day);
    CREATE INDEX IF NOT EXISTS idx_eval_rvol_time ON evaluations(rvol, time_of_day);
    CREATE INDEX IF NOT EXISTS idx_model_eval_id ON model_outputs(evaluation_id);
    CREATE INDEX IF NOT EXISTS idx_model_model_id ON model_outputs(model_id);
    CREATE INDEX IF NOT EXISTS idx_outcome_eval_id ON outcomes(evaluation_id);
  `);

  return testDb;
}

/**
 * Closes the in-memory database and resets the singleton.
 * Call this in afterAll or teardown.
 */
export function closeTestDb(): void {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}
