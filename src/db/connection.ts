/**
 * Database connection, schema, migrations, and prepared statements.
 *
 * This module is the single source of the SQLite singleton.  Domain modules
 * (`orders.ts`, `journal.ts`, …) import `getDb` and/or `stmts` from here
 * and are re-exported through the barrel file `database.ts`.
 */

import Database, { type Database as DatabaseType } from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { evalReasoningSchemaSql, RISK_CONFIG_DEFAULTS, RISK_CONFIG_SCHEMA_SQL, ANALYTICS_JOBS_SCHEMA_SQL, type RiskConfigParam } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.join(__dirname, "../../data");
if (!fs.existsSync(defaultDataDir)) fs.mkdirSync(defaultDataDir, { recursive: true });

// DB_PATH env var allows parallel instances (e.g., paper vs live) to use separate databases
const dbPath = process.env.DB_PATH
  ? (process.env.DB_PATH === ":memory:" ? ":memory:" : path.resolve(process.env.DB_PATH))
  : path.join(defaultDataDir, "bridge.db");
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db: DatabaseType = new Database(dbPath);

/**
 * Get the singleton database connection instance.
 * @returns better-sqlite3 Database instance
 */
export function getDb(): DatabaseType {
  return db;
}

// WAL mode — prevents event loop blocking during concurrent reads/writes
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");

// ── Schema Migration ─────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS trade_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    strategy_version TEXT,
    reasoning TEXT NOT NULL,
    ai_recommendations TEXT,
    tags TEXT,                -- JSON array
    outcome_tags TEXT,        -- JSON array (post-trade)
    notes TEXT,
    -- Behavioral fields (surfaces behavioral edge after 50+ trades)
    confidence_rating INTEGER,  -- 1=low, 2=medium, 3=high (trader's subjective confidence)
    rule_followed INTEGER,      -- 1=yes, 0=no (did trader follow their own rules?)
    setup_type TEXT,            -- e.g. "breakout", "pullback", "reversal", "gap_fill", "momentum"
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
    type TEXT NOT NULL DEFAULT 'info',  -- info|request|decision|handoff|blocker
    content TEXT NOT NULL,
    reply_to TEXT,
    tags TEXT,               -- JSON array
    metadata TEXT,           -- JSON object for structured data
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
    decision_type TEXT,         -- "took_trade", "passed_setup", "ensemble_no", "risk_gate_blocked"
    -- Behavioral fields (tag post-session alongside outcome recording)
    confidence_rating INTEGER,  -- 1=low, 2=medium, 3=high (trader's subjective confidence)
    rule_followed INTEGER,      -- 1=yes, 0=no (did trader follow their own rules?)
    setup_type TEXT,            -- e.g. "breakout", "pullback", "reversal", "gap_fill", "momentum"
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

  CREATE TABLE IF NOT EXISTS drift_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_type TEXT NOT NULL,
    model_id TEXT,
    metric_value REAL NOT NULL,
    threshold REAL NOT NULL,
    message TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_eval_symbol ON evaluations(symbol);
  CREATE INDEX IF NOT EXISTS idx_eval_timestamp ON evaluations(timestamp);
  CREATE INDEX IF NOT EXISTS idx_eval_symbol_time ON evaluations(symbol, timestamp);
  CREATE INDEX IF NOT EXISTS idx_eval_time_of_day ON evaluations(time_of_day);
  CREATE INDEX IF NOT EXISTS idx_eval_rvol_time ON evaluations(rvol, time_of_day);
  CREATE INDEX IF NOT EXISTS idx_model_eval_id ON model_outputs(evaluation_id);
  CREATE INDEX IF NOT EXISTS idx_model_model_id ON model_outputs(model_id);
  CREATE INDEX IF NOT EXISTS idx_outcome_eval_id ON outcomes(evaluation_id);
  CREATE INDEX IF NOT EXISTS idx_drift_alert_type_model ON drift_alerts(alert_type, model_id);
  CREATE INDEX IF NOT EXISTS idx_drift_alert_timestamp ON drift_alerts(timestamp);
  CREATE INDEX IF NOT EXISTS idx_drift_alert_created ON drift_alerts(created_at);

  ${evalReasoningSchemaSql}

  -- TraderSync imported trades (actual trade history for calibration + analytics)
  CREATE TABLE IF NOT EXISTS tradersync_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,           -- WIN / LOSS
    symbol TEXT NOT NULL,
    size INTEGER NOT NULL,
    open_date TEXT NOT NULL,
    close_date TEXT NOT NULL,
    open_time TEXT NOT NULL,
    close_time TEXT NOT NULL,
    setups TEXT,                    -- semicolon-separated tags
    mistakes TEXT,                  -- semicolon-separated tags
    entry_price REAL NOT NULL,
    exit_price REAL NOT NULL,
    return_dollars REAL NOT NULL,
    return_pct REAL NOT NULL,
    avg_buy REAL,
    avg_sell REAL,
    net_return REAL,
    commission REAL,
    notes TEXT,
    type TEXT DEFAULT 'SHARE',
    side TEXT NOT NULL,             -- LONG / SHORT
    spread TEXT DEFAULT 'SINGLE',
    cost REAL,
    executions INTEGER,
    holdtime TEXT,
    portfolio TEXT,
    r_multiple REAL,
    mae REAL,                      -- max adverse excursion
    mfe REAL,                      -- max favorable excursion
    expectancy REAL,
    risk REAL,
    target1 REAL,
    profit_aim1 REAL,
    stop1 REAL,
    risk1 REAL,
    import_batch TEXT,             -- batch ID to track imports
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(symbol, open_date, open_time, side)
  );
  CREATE INDEX IF NOT EXISTS idx_ts_symbol ON tradersync_trades(symbol);
  CREATE INDEX IF NOT EXISTS idx_ts_open_date ON tradersync_trades(open_date);
  CREATE INDEX IF NOT EXISTS idx_ts_status ON tradersync_trades(status);
  CREATE INDEX IF NOT EXISTS idx_ts_side ON tradersync_trades(side);
  CREATE INDEX IF NOT EXISTS idx_ts_batch ON tradersync_trades(import_batch);
`);

// ── Holly AI Alerts ───────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS holly_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_time TEXT NOT NULL,
    symbol TEXT NOT NULL,
    strategy TEXT,
    entry_price REAL,
    stop_price REAL,
    shares INTEGER,
    last_price REAL,
    segment TEXT,
    extra TEXT,
    import_batch TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(symbol, alert_time, strategy)
  );
  CREATE INDEX IF NOT EXISTS idx_holly_symbol ON holly_alerts(symbol);
  CREATE INDEX IF NOT EXISTS idx_holly_time ON holly_alerts(alert_time);
  CREATE INDEX IF NOT EXISTS idx_holly_strategy ON holly_alerts(strategy);
  CREATE INDEX IF NOT EXISTS idx_holly_batch ON holly_alerts(import_batch);
`);

// ── Signals (auto-eval results from Holly alerts) ────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    holly_alert_id INTEGER REFERENCES holly_alerts(id),
    evaluation_id TEXT,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'long',
    strategy TEXT,
    ensemble_score REAL,
    should_trade INTEGER,
    prefilter_passed INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
  CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);
  CREATE INDEX IF NOT EXISTS idx_signals_eval ON signals(evaluation_id);
`);

// ── Inbox (event buffer for ChatGPT polling) ────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS inbox (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    symbol TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_inbox_type ON inbox(type);
  CREATE INDEX IF NOT EXISTS idx_inbox_read ON inbox(read);
  CREATE INDEX IF NOT EXISTS idx_inbox_created ON inbox(created_at);
`);

// ── Eval-Execution Auto-Links ────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS eval_execution_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    order_id INTEGER NOT NULL,
    exec_id TEXT,
    link_type TEXT NOT NULL,
    confidence REAL,
    symbol TEXT NOT NULL,
    direction TEXT,
    linked_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(evaluation_id, order_id)
  );
  CREATE INDEX IF NOT EXISTS idx_eel_eval ON eval_execution_links(evaluation_id);
  CREATE INDEX IF NOT EXISTS idx_eel_order ON eval_execution_links(order_id);
  CREATE INDEX IF NOT EXISTS idx_eel_symbol ON eval_execution_links(symbol);
`);

// ── MCP Session Tracking (for session recovery and metrics) ────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS mcp_sessions (
    id TEXT PRIMARY KEY,
    transport TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_active TEXT NOT NULL DEFAULT (datetime('now')),
    tool_calls INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_mcp_sessions_created ON mcp_sessions(created_at);
  CREATE INDEX IF NOT EXISTS idx_mcp_sessions_closed ON mcp_sessions(closed_at);
`);

db.exec(RISK_CONFIG_SCHEMA_SQL);
db.exec(ANALYTICS_JOBS_SCHEMA_SQL);

// ── Ops Availability Tables ────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS ops_availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    bridge_ok INTEGER NOT NULL,
    ibkr_ok INTEGER NOT NULL,
    tunnel_ok INTEGER NOT NULL,
    mcp_sessions INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ops_avail_timestamp ON ops_availability(timestamp);
  CREATE INDEX IF NOT EXISTS idx_ops_avail_bridge ON ops_availability(bridge_ok);
  CREATE INDEX IF NOT EXISTS idx_ops_avail_ibkr ON ops_availability(ibkr_ok);

  CREATE TABLE IF NOT EXISTS ops_outages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    affected_components TEXT NOT NULL,
    cause TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ops_outages_start ON ops_outages(start);
  CREATE INDEX IF NOT EXISTS idx_ops_outages_created ON ops_outages(created_at);
`);

// ── Column Migrations (safe for existing DBs — silently ignored if column exists) ──

function addColumnIfMissing(table: string, column: string, type: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch {
    // Column already exists — expected for fresh DBs
  }
}

// v2: Behavioral fields on trade_journal (legacy — kept for existing data)
addColumnIfMissing("trade_journal", "confidence_rating", "INTEGER");
addColumnIfMissing("trade_journal", "rule_followed", "INTEGER");
addColumnIfMissing("trade_journal", "setup_type", "TEXT");

// v3: TraderSync signal source (parsed from notes — e.g. "holly", "manual")
addColumnIfMissing("tradersync_trades", "signal_source", "TEXT");

// v2: Decision type + behavioral fields on outcomes (primary location)
addColumnIfMissing("outcomes", "decision_type", "TEXT");
addColumnIfMissing("outcomes", "confidence_rating", "INTEGER");
addColumnIfMissing("outcomes", "rule_followed", "INTEGER");
addColumnIfMissing("outcomes", "setup_type", "TEXT");

// v5: Link evaluations to holly alerts for auto-eval tracking
addColumnIfMissing("evaluations", "holly_alert_id", "INTEGER");

// v6: Link orders to evaluations for auto-link tracking
addColumnIfMissing("orders", "eval_id", "TEXT");

// v4: risk config source label for older DBs that may have only param/value
addColumnIfMissing("risk_config", "source", "TEXT NOT NULL DEFAULT 'manual'");
addColumnIfMissing("risk_config", "updated_at", "TEXT NOT NULL DEFAULT (datetime('now'))");

// v7: Collab message type + metadata for performative messaging
addColumnIfMissing("collab_messages", "type", "TEXT NOT NULL DEFAULT 'info'");
addColumnIfMissing("collab_messages", "metadata", "TEXT");

// v8: Massive.com analyst ratings + corporate guidance features on evaluations
addColumnIfMissing("evaluations", "analyst_rating_momentum", "REAL");
addColumnIfMissing("evaluations", "analyst_avg_pt_upside_pct", "REAL");
addColumnIfMissing("evaluations", "analyst_consensus", "TEXT");
addColumnIfMissing("evaluations", "guidance_net_direction", "REAL");
addColumnIfMissing("evaluations", "guidance_latest_direction", "TEXT");

function ensureRiskConfigDefaults(): void {
  const upsert = db.prepare(`
    INSERT INTO risk_config (param, value, source)
    VALUES (?, ?, 'manual')
    ON CONFLICT(param) DO NOTHING
  `);

  const tx = db.transaction(() => {
    (Object.entries(RISK_CONFIG_DEFAULTS) as Array<[RiskConfigParam, number]>).forEach(([param, value]) => {
      upsert.run(param, value);
    });
  });

  tx();
}

ensureRiskConfigDefaults();

// ── Prepared Statements ──────────────────────────────────────────────────

const _stmts = {
  // Orders
  insertOrder: db.prepare(`
    INSERT INTO orders (order_id, symbol, action, order_type, total_quantity, lmt_price, aux_price, tif, sec_type, exchange, currency, status, strategy_version, order_source, ai_confidence, correlation_id, journal_id, parent_order_id, eval_id)
    VALUES (@order_id, @symbol, @action, @order_type, @total_quantity, @lmt_price, @aux_price, @tif, @sec_type, @exchange, @currency, @status, @strategy_version, @order_source, @ai_confidence, @correlation_id, @journal_id, @parent_order_id, @eval_id)
  `),
  updateOrderStatus: db.prepare(`
    UPDATE orders SET status = @status, filled_quantity = @filled_quantity, avg_fill_price = @avg_fill_price, updated_at = datetime('now')
    WHERE order_id = @order_id
  `),
  updateOrderStatusOnly: db.prepare(`
    UPDATE orders SET status = @status, updated_at = datetime('now')
    WHERE order_id = @order_id
  `),
  getOrderByOrderId: db.prepare(`SELECT * FROM orders WHERE order_id = ?`),
  getOrdersByCorrelation: db.prepare(`SELECT * FROM orders WHERE correlation_id = ?`),
  getOrdersByStatus: db.prepare(`SELECT * FROM orders WHERE status = ?`),
  getLiveOrders: db.prepare(`SELECT * FROM orders WHERE status IN ('PendingSubmit', 'PreSubmitted', 'Submitted', 'RECONCILING')`),
  queryOrders: db.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`),
  queryOrdersBySymbol: db.prepare(`SELECT * FROM orders WHERE symbol = ? ORDER BY created_at DESC LIMIT ?`),
  queryOrdersByStrategy: db.prepare(`SELECT * FROM orders WHERE strategy_version = ? ORDER BY created_at DESC LIMIT ?`),

  // Executions
  insertExecution: db.prepare(`
    INSERT OR IGNORE INTO executions (exec_id, order_id, symbol, side, shares, price, cum_qty, avg_price, commission, realized_pnl, correlation_id, timestamp)
    VALUES (@exec_id, @order_id, @symbol, @side, @shares, @price, @cum_qty, @avg_price, @commission, @realized_pnl, @correlation_id, @timestamp)
  `),
  updateExecutionCommission: db.prepare(`
    UPDATE executions SET commission = @commission, realized_pnl = @realized_pnl WHERE exec_id = @exec_id
  `),
  queryExecutions: db.prepare(`SELECT * FROM executions ORDER BY timestamp DESC LIMIT ?`),
  queryExecutionsBySymbol: db.prepare(`SELECT * FROM executions WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?`),
  getExecutionByExecId: db.prepare(`SELECT * FROM executions WHERE exec_id = ?`),

  // Positions snapshots
  insertPositionSnapshot: db.prepare(`
    INSERT INTO positions_snapshots (positions, source) VALUES (@positions, @source)
  `),
  getLatestPositionSnapshot: db.prepare(`SELECT * FROM positions_snapshots ORDER BY created_at DESC LIMIT 1`),

  // Collab messages
  insertCollab: db.prepare(`
    INSERT INTO collab_messages (id, author, type, content, reply_to, tags, metadata, created_at)
    VALUES (@id, @author, @type, @content, @reply_to, @tags, @metadata, @created_at)
  `),
  getRecentCollab: db.prepare(`SELECT * FROM collab_messages ORDER BY created_at DESC LIMIT ?`),
  deleteAllCollab: db.prepare(`DELETE FROM collab_messages`),
  countCollab: db.prepare(`SELECT COUNT(*) as count FROM collab_messages`),

  // Trade journal
  insertJournal: db.prepare(`
    INSERT INTO trade_journal (symbol, strategy_version, reasoning, ai_recommendations, tags, confidence_rating, rule_followed, setup_type, spy_price, vix_level, gap_pct, relative_volume, time_of_day, session_type, spread_pct)
    VALUES (@symbol, @strategy_version, @reasoning, @ai_recommendations, @tags, @confidence_rating, @rule_followed, @setup_type, @spy_price, @vix_level, @gap_pct, @relative_volume, @time_of_day, @session_type, @spread_pct)
  `),
  updateJournal: db.prepare(`
    UPDATE trade_journal SET outcome_tags = @outcome_tags, notes = @notes, updated_at = datetime('now')
    WHERE id = @id
  `),
  getJournalById: db.prepare(`SELECT * FROM trade_journal WHERE id = ?`),
  queryJournal: db.prepare(`SELECT * FROM trade_journal ORDER BY created_at DESC LIMIT ?`),
  queryJournalBySymbol: db.prepare(`SELECT * FROM trade_journal WHERE symbol = ? ORDER BY created_at DESC LIMIT ?`),
  queryJournalByStrategy: db.prepare(`SELECT * FROM trade_journal WHERE strategy_version = ? ORDER BY created_at DESC LIMIT ?`),

  // Account snapshots
  insertAccountSnapshot: db.prepare(`
    INSERT INTO account_snapshots (net_liquidation, total_cash_value, buying_power, daily_pnl, unrealized_pnl, realized_pnl)
    VALUES (@net_liquidation, @total_cash_value, @buying_power, @daily_pnl, @unrealized_pnl, @realized_pnl)
  `),
  queryAccountSnapshots: db.prepare(`SELECT * FROM account_snapshots ORDER BY created_at DESC LIMIT ?`),

  // Evaluations
  getEvaluationById: db.prepare(`SELECT * FROM evaluations WHERE id = ?`),
  queryEvaluations: db.prepare(`SELECT * FROM evaluations ORDER BY timestamp DESC LIMIT ?`),
  queryEvaluationsBySymbol: db.prepare(`SELECT * FROM evaluations WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?`),

  // Model outputs
  queryModelOutputsByEval: db.prepare(`SELECT * FROM model_outputs WHERE evaluation_id = ?`),

  // Outcomes
  getOutcomeByEval: db.prepare(`SELECT * FROM outcomes WHERE evaluation_id = ?`),
  queryRecentOutcomes: db.prepare(`
    SELECT e.*, o.trade_taken, o.r_multiple, o.exit_reason
    FROM evaluations e
    JOIN outcomes o ON e.id = o.evaluation_id
    WHERE o.trade_taken = 1
    ORDER BY e.timestamp DESC
    LIMIT ?
  `),

  // Eval reasoning
  queryReasoningByEval: db.prepare(`SELECT * FROM eval_reasoning WHERE evaluation_id = ?`),

  // Eval stats
  countEvaluations: db.prepare(`SELECT COUNT(*) as n FROM evaluations`),
  countOutcomes: db.prepare(`SELECT COUNT(*) as n FROM outcomes WHERE trade_taken = 1`),
  modelStats: db.prepare(`
    SELECT model_id,
      COUNT(*) as total,
      SUM(CASE WHEN compliant = 1 THEN 1 ELSE 0 END) as compliant,
      AVG(CASE WHEN compliant = 1 THEN trade_score END) as avg_score,
      AVG(CASE WHEN compliant = 1 THEN confidence END) as avg_confidence,
      AVG(latency_ms) as avg_latency_ms
    FROM model_outputs
    GROUP BY model_id
  `),

  // Eval-Execution Auto-Links
  insertEvalExecutionLink: db.prepare(`
    INSERT OR IGNORE INTO eval_execution_links (evaluation_id, order_id, exec_id, link_type, confidence, symbol, direction)
    VALUES (@evaluation_id, @order_id, @exec_id, @link_type, @confidence, @symbol, @direction)
  `),
  getLinksForEval: db.prepare(`SELECT * FROM eval_execution_links WHERE evaluation_id = ?`),
  getLinksForOrder: db.prepare(`SELECT * FROM eval_execution_links WHERE order_id = ?`),
  getRecentEvalsForSymbol: db.prepare(`
    SELECT id, symbol, direction, entry_price, stop_price, timestamp, ensemble_should_trade
    FROM evaluations
    WHERE symbol = ? AND timestamp >= ? AND prefilter_passed = 1
    ORDER BY timestamp DESC
  `),
  getUnlinkedExecutions: db.prepare(`
    SELECT e.* FROM executions e
    LEFT JOIN eval_execution_links l ON e.exec_id = l.exec_id
    WHERE l.id IS NULL AND datetime(e.timestamp) >= datetime(?)
    ORDER BY e.timestamp DESC
  `),
  getExecutionsByCorrelation: db.prepare(`SELECT * FROM executions WHERE correlation_id = ? ORDER BY timestamp ASC`),
  getAutoLinkStats: db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN link_type = 'explicit' THEN 1 ELSE 0 END) as explicit_links,
      SUM(CASE WHEN link_type = 'heuristic' THEN 1 ELSE 0 END) as heuristic_links,
      AVG(confidence) as avg_confidence
    FROM eval_execution_links
  `),
  getRecentLinks: db.prepare(`
    SELECT eel.*, e.ensemble_trade_score, e.ensemble_should_trade, e.direction as eval_direction
    FROM eval_execution_links eel
    LEFT JOIN evaluations e ON e.id = eel.evaluation_id
    ORDER BY eel.linked_at DESC
    LIMIT ?
  `),

  // Drift alerts
  insertDriftAlert: db.prepare(`
    INSERT INTO drift_alerts (alert_type, model_id, metric_value, threshold, message, timestamp)
    VALUES (@alert_type, @model_id, @metric_value, @threshold, @message, @timestamp)
  `),
  getRecentDriftAlerts: db.prepare(`
    SELECT * FROM drift_alerts ORDER BY created_at DESC LIMIT ?
  `),
  checkRecentDriftAlert: db.prepare(`
    SELECT id FROM drift_alerts
    WHERE alert_type = @alert_type
      AND (model_id IS NULL AND @model_id IS NULL OR model_id = @model_id)
      AND datetime(created_at) > datetime(@cutoff_time)
    LIMIT 1
  `),

  // Inbox
  insertInbox: db.prepare(`
    INSERT INTO inbox (id, type, symbol, title, body, created_at)
    VALUES (@id, @type, @symbol, @title, @body, @created_at)
  `),
  getRecentInbox: db.prepare(`SELECT * FROM inbox ORDER BY created_at DESC LIMIT ?`),
  markInboxRead: db.prepare(`UPDATE inbox SET read = 1 WHERE id = ?`),
  markAllInboxRead: db.prepare(`UPDATE inbox SET read = 1 WHERE read = 0`),
  deleteAllInbox: db.prepare(`DELETE FROM inbox`),
  countInbox: db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as unread FROM inbox`),
  pruneInbox: db.prepare(`DELETE FROM inbox WHERE created_at < datetime('now', '-' || ? || ' days')`),

  // MCP Sessions
  insertMcpSession: db.prepare(`
    INSERT INTO mcp_sessions (id, transport, created_at, last_active)
    VALUES (@id, @transport, @created_at, @last_active)
  `),
  updateMcpSessionActivity: db.prepare(`
    UPDATE mcp_sessions SET last_active = @last_active, tool_calls = tool_calls + 1
    WHERE id = @id
  `),
  closeMcpSession: db.prepare(`
    UPDATE mcp_sessions SET closed_at = @closed_at WHERE id = @id
  `),
  getActiveMcpSessions: db.prepare(`
    SELECT * FROM mcp_sessions WHERE closed_at IS NULL ORDER BY created_at DESC
  `),
  getMcpSessionStats: db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN closed_at IS NULL THEN 1 ELSE 0 END) as active,
      AVG(CASE WHEN closed_at IS NOT NULL THEN (julianday(closed_at) - julianday(created_at)) * 86400 ELSE NULL END) as avg_duration_seconds,
      SUM(tool_calls) as total_tool_calls
    FROM mcp_sessions
  `),

  // Analytics Jobs
  insertAnalyticsJob: db.prepare(`
    INSERT INTO analytics_jobs (script, trigger_type, status)
    VALUES (@script, @trigger_type, @status)
  `),
  updateAnalyticsJob: db.prepare(`
    UPDATE analytics_jobs
    SET status = @status, exit_code = @exit_code, stdout = @stdout, stderr = @stderr, duration_ms = @duration_ms, completed_at = datetime('now')
    WHERE id = @id
  `),
  queryAnalyticsJobs: db.prepare(`
    SELECT * FROM analytics_jobs ORDER BY created_at DESC LIMIT ?
  `),
  getAnalyticsJobById: db.prepare(`
    SELECT * FROM analytics_jobs WHERE id = ?
  `),
};

/**
 * Access the prepared statements object.
 * Return type is `typeof _stmts` internally; annotated as `any` for the .d.ts
 * because `BetterSqlite3.Statement` can't be referenced under Node16 modules.
 * Consumers still get full autocomplete inside this package since TS infers
 * the concrete type from the function body within the same compilation unit.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getStmts(): any { return _stmts; }

// ── Exported Helpers ─────────────────────────────────────────────────────

/**
 * Generate a unique correlation ID for linking orders.
 * @returns UUID v4 string
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Check if the database is writable.
 * @returns True if writable
 */
export function isDbWritable(): boolean {
  try {
    db.exec("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Close the database connection.
 */
export function closeDb() {
  db.close();
}

/**
 * Generic row insert for eval tables (evaluations, model_outputs, outcomes).
 * Handles dynamic columns — keys become column names, values become bound params.
 */
export function runEvalInsert(table: string, row: Record<string, unknown>): void {
  const cols = Object.keys(row);
  const placeholders = cols.map((c) => `@${c}`).join(", ");
  const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`;
  const bound: Record<string, unknown> = {};
  for (const c of cols) {
    const v = row[c];
    if (v === undefined || v === null) bound[c] = null;
    else if (typeof v === "boolean") bound[c] = v ? 1 : 0;
    else bound[c] = v;
  }
  getDb().prepare(sql).run(bound);
}

// Re-export db for backwards compatibility (used by `export { db }` in original)
export { db };
