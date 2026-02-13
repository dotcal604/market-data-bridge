import Database, { type Database as DatabaseType } from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "../../data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "bridge.db");
const db: DatabaseType = new Database(dbPath);

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

  CREATE INDEX IF NOT EXISTS idx_eval_symbol ON evaluations(symbol);
  CREATE INDEX IF NOT EXISTS idx_eval_timestamp ON evaluations(timestamp);
  CREATE INDEX IF NOT EXISTS idx_eval_symbol_time ON evaluations(symbol, timestamp);
  CREATE INDEX IF NOT EXISTS idx_eval_time_of_day ON evaluations(time_of_day);
  CREATE INDEX IF NOT EXISTS idx_eval_rvol_time ON evaluations(rvol, time_of_day);
  CREATE INDEX IF NOT EXISTS idx_model_eval_id ON model_outputs(evaluation_id);
  CREATE INDEX IF NOT EXISTS idx_model_model_id ON model_outputs(model_id);
  CREATE INDEX IF NOT EXISTS idx_outcome_eval_id ON outcomes(evaluation_id);

  -- Structured reasoning extracted from model responses
  CREATE TABLE IF NOT EXISTS eval_reasoning (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    model_id TEXT NOT NULL,
    key_drivers TEXT NOT NULL,     -- JSON array of {feature, direction, weight}
    risk_factors TEXT NOT NULL,    -- JSON array of strings
    uncertainties TEXT NOT NULL,   -- JSON array of strings
    conviction TEXT,               -- "high" | "medium" | "low"
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(evaluation_id, model_id)
  );
  CREATE INDEX IF NOT EXISTS idx_reasoning_eval_id ON eval_reasoning(evaluation_id);
  CREATE INDEX IF NOT EXISTS idx_reasoning_model_id ON eval_reasoning(model_id);

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

// ── Prepared Statements ──────────────────────────────────────────────────

const stmts = {
  // Orders
  insertOrder: db.prepare(`
    INSERT INTO orders (order_id, symbol, action, order_type, total_quantity, lmt_price, aux_price, tif, sec_type, exchange, currency, status, strategy_version, order_source, ai_confidence, correlation_id, journal_id, parent_order_id)
    VALUES (@order_id, @symbol, @action, @order_type, @total_quantity, @lmt_price, @aux_price, @tif, @sec_type, @exchange, @currency, @status, @strategy_version, @order_source, @ai_confidence, @correlation_id, @journal_id, @parent_order_id)
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

  // Positions snapshots
  insertPositionSnapshot: db.prepare(`
    INSERT INTO positions_snapshots (positions, source) VALUES (@positions, @source)
  `),
  getLatestPositionSnapshot: db.prepare(`SELECT * FROM positions_snapshots ORDER BY created_at DESC LIMIT 1`),

  // Collab messages
  insertCollab: db.prepare(`
    INSERT INTO collab_messages (id, author, content, reply_to, tags, created_at)
    VALUES (@id, @author, @content, @reply_to, @tags, @created_at)
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
};

// ── Helper Functions ─────────────────────────────────────────────────────

export function generateCorrelationId(): string {
  return randomUUID();
}

export function insertOrder(data: {
  order_id: number;
  symbol: string;
  action: string;
  order_type: string;
  total_quantity: number;
  lmt_price?: number | null;
  aux_price?: number | null;
  tif?: string;
  sec_type?: string;
  exchange?: string;
  currency?: string;
  status?: string;
  strategy_version?: string;
  order_source?: string;
  ai_confidence?: number | null;
  correlation_id: string;
  journal_id?: number | null;
  parent_order_id?: number | null;
}) {
  return stmts.insertOrder.run({
    order_id: data.order_id,
    symbol: data.symbol,
    action: data.action,
    order_type: data.order_type,
    total_quantity: data.total_quantity,
    lmt_price: data.lmt_price ?? null,
    aux_price: data.aux_price ?? null,
    tif: data.tif ?? "DAY",
    sec_type: data.sec_type ?? "STK",
    exchange: data.exchange ?? "SMART",
    currency: data.currency ?? "USD",
    status: data.status ?? "PendingSubmit",
    strategy_version: data.strategy_version ?? "manual",
    order_source: data.order_source ?? "manual",
    ai_confidence: data.ai_confidence ?? null,
    correlation_id: data.correlation_id,
    journal_id: data.journal_id ?? null,
    parent_order_id: data.parent_order_id ?? null,
  });
}

export function updateOrderStatus(orderId: number, status: string, filled?: number, avgPrice?: number) {
  if (filled !== undefined) {
    stmts.updateOrderStatus.run({
      order_id: orderId,
      status,
      filled_quantity: filled,
      avg_fill_price: avgPrice ?? null,
    });
  } else {
    stmts.updateOrderStatusOnly.run({ order_id: orderId, status });
  }
}

export function insertExecution(data: {
  exec_id: string;
  order_id: number;
  symbol: string;
  side: string;
  shares: number;
  price: number;
  cum_qty?: number;
  avg_price?: number;
  commission?: number | null;
  realized_pnl?: number | null;
  correlation_id: string;
  timestamp: string;
}) {
  return stmts.insertExecution.run({
    exec_id: data.exec_id,
    order_id: data.order_id,
    symbol: data.symbol,
    side: data.side,
    shares: data.shares,
    price: data.price,
    cum_qty: data.cum_qty ?? null,
    avg_price: data.avg_price ?? null,
    commission: data.commission ?? null,
    realized_pnl: data.realized_pnl ?? null,
    correlation_id: data.correlation_id,
    timestamp: data.timestamp,
  });
}

export function updateExecutionCommission(execId: string, commission: number, realizedPnl: number | null) {
  stmts.updateExecutionCommission.run({ exec_id: execId, commission, realized_pnl: realizedPnl ?? null });
}

export function insertCollabMessage(msg: {
  id: string;
  author: string;
  content: string;
  reply_to?: string | null;
  tags?: string[] | null;
  created_at: string;
}) {
  stmts.insertCollab.run({
    id: msg.id,
    author: msg.author,
    content: msg.content,
    reply_to: msg.reply_to ?? null,
    tags: msg.tags ? JSON.stringify(msg.tags) : null,
    created_at: msg.created_at,
  });
}

export function loadRecentCollab(limit: number = 200): Array<{
  id: string; author: string; content: string; reply_to: string | null; tags: string | null; created_at: string;
}> {
  const rows = stmts.getRecentCollab.all(limit) as any[];
  return rows.reverse(); // DB returns newest first, we want oldest first
}

export function clearCollabDb(): number {
  const info = stmts.deleteAllCollab.run();
  return info.changes;
}

export function insertPositionSnapshot(positions: any[], source: string = "reconcile") {
  stmts.insertPositionSnapshot.run({ positions: JSON.stringify(positions), source });
}

export function getLatestPositionSnapshot(): any[] | null {
  const row = stmts.getLatestPositionSnapshot.get() as any;
  if (!row) return null;
  return JSON.parse(row.positions);
}

export function insertJournalEntry(data: {
  symbol?: string;
  strategy_version?: string;
  reasoning: string;
  ai_recommendations?: string;
  tags?: string[];
  confidence_rating?: number;
  rule_followed?: boolean;
  setup_type?: string;
  spy_price?: number;
  vix_level?: number;
  gap_pct?: number;
  relative_volume?: number;
  time_of_day?: string;
  session_type?: string;
  spread_pct?: number;
}): number {
  const info = stmts.insertJournal.run({
    symbol: data.symbol ?? null,
    strategy_version: data.strategy_version ?? null,
    reasoning: data.reasoning,
    ai_recommendations: data.ai_recommendations ?? null,
    tags: data.tags ? JSON.stringify(data.tags) : null,
    confidence_rating: data.confidence_rating ?? null,
    rule_followed: data.rule_followed != null ? (data.rule_followed ? 1 : 0) : null,
    setup_type: data.setup_type ?? null,
    spy_price: data.spy_price ?? null,
    vix_level: data.vix_level ?? null,
    gap_pct: data.gap_pct ?? null,
    relative_volume: data.relative_volume ?? null,
    time_of_day: data.time_of_day ?? null,
    session_type: data.session_type ?? null,
    spread_pct: data.spread_pct ?? null,
  });
  return Number(info.lastInsertRowid);
}

export function updateJournalEntry(id: number, data: { outcome_tags?: string[]; notes?: string }) {
  stmts.updateJournal.run({
    id,
    outcome_tags: data.outcome_tags ? JSON.stringify(data.outcome_tags) : null,
    notes: data.notes ?? null,
  });
}

export function insertAccountSnapshot(data: {
  net_liquidation?: number;
  total_cash_value?: number;
  buying_power?: number;
  daily_pnl?: number;
  unrealized_pnl?: number;
  realized_pnl?: number;
}) {
  stmts.insertAccountSnapshot.run({
    net_liquidation: data.net_liquidation ?? null,
    total_cash_value: data.total_cash_value ?? null,
    buying_power: data.buying_power ?? null,
    daily_pnl: data.daily_pnl ?? null,
    unrealized_pnl: data.unrealized_pnl ?? null,
    realized_pnl: data.realized_pnl ?? null,
  });
}

// ── Query Helpers ────────────────────────────────────────────────────────

export function queryOrders(opts: { symbol?: string; strategy?: string; limit?: number } = {}) {
  const limit = opts.limit ?? 100;
  if (opts.symbol) return stmts.queryOrdersBySymbol.all(opts.symbol, limit);
  if (opts.strategy) return stmts.queryOrdersByStrategy.all(opts.strategy, limit);
  return stmts.queryOrders.all(limit);
}

export function queryExecutions(opts: { symbol?: string; limit?: number } = {}) {
  const limit = opts.limit ?? 100;
  if (opts.symbol) return stmts.queryExecutionsBySymbol.all(opts.symbol, limit);
  return stmts.queryExecutions.all(limit);
}

export function queryJournal(opts: { symbol?: string; strategy?: string; limit?: number } = {}) {
  const limit = opts.limit ?? 100;
  if (opts.symbol) return stmts.queryJournalBySymbol.all(opts.symbol, limit);
  if (opts.strategy) return stmts.queryJournalByStrategy.all(opts.strategy, limit);
  return stmts.queryJournal.all(limit);
}

export function queryAccountSnapshots(limit: number = 100) {
  return stmts.queryAccountSnapshots.all(limit);
}

export function getOrderByOrderId(orderId: number) {
  return stmts.getOrderByOrderId.get(orderId);
}

export function getOrdersByCorrelation(correlationId: string) {
  return stmts.getOrdersByCorrelation.all(correlationId);
}

export function getLiveBracketCorrelations(): Array<{ correlation_id: string }> {
  // Find correlation_ids where child orders exist (parent_order_id set)
  // and at least one order in the group is still live.
  return db.prepare(`
    SELECT DISTINCT o1.correlation_id
    FROM orders o1
    WHERE o1.parent_order_id IS NOT NULL
      AND o1.parent_order_id > 0
      AND EXISTS (
        SELECT 1 FROM orders o2
        WHERE o2.correlation_id = o1.correlation_id
          AND o2.status IN ('PendingSubmit', 'PreSubmitted', 'Submitted', 'RECONCILING')
      )
  `).all() as Array<{ correlation_id: string }>;
}

export function getLiveOrders() {
  return stmts.getLiveOrders.all();
}

export function getJournalById(id: number) {
  return stmts.getJournalById.get(id);
}

// ── Eval Engine Helpers ──────────────────────────────────────────────────

/**
 * Generic row insert for eval tables (evaluations, model_outputs, outcomes).
 * Handles dynamic columns — keys become column names, values become bound params.
 */
function runEvalInsert(table: string, row: Record<string, unknown>): void {
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
  db.prepare(sql).run(bound);
}

export function insertEvaluation(row: Record<string, unknown>): void {
  runEvalInsert("evaluations", row);
}

export function insertModelOutput(row: Record<string, unknown>): void {
  runEvalInsert("model_outputs", row);
}

export function insertOutcome(row: Record<string, unknown>): void {
  runEvalInsert("outcomes", row);
}

export function insertEvalReasoning(row: Record<string, unknown>): void {
  runEvalInsert("eval_reasoning", row);
}

export function getReasoningForEval(evaluationId: string): Record<string, unknown>[] {
  return stmts.queryReasoningByEval.all(evaluationId) as Record<string, unknown>[];
}

export function getEvaluationById(id: string): Record<string, unknown> | undefined {
  return stmts.getEvaluationById.get(id) as Record<string, unknown> | undefined;
}

export function getRecentEvaluations(limit: number = 50, symbol?: string): Record<string, unknown>[] {
  if (symbol) return stmts.queryEvaluationsBySymbol.all(symbol, limit) as Record<string, unknown>[];
  return stmts.queryEvaluations.all(limit) as Record<string, unknown>[];
}

export function getRecentOutcomes(limit: number = 20): Array<Record<string, unknown>> {
  return stmts.queryRecentOutcomes.all(limit) as Array<Record<string, unknown>>;
}

export function getModelOutputsForEval(evaluationId: string): Record<string, unknown>[] {
  return stmts.queryModelOutputsByEval.all(evaluationId) as Record<string, unknown>[];
}

export function getOutcomeForEval(evaluationId: string): Record<string, unknown> | undefined {
  return stmts.getOutcomeByEval.get(evaluationId) as Record<string, unknown> | undefined;
}

export function getEvalStats(): Record<string, unknown> {
  const totalEvals = (stmts.countEvaluations.get() as any)?.n ?? 0;
  const totalOutcomes = (stmts.countOutcomes.get() as any)?.n ?? 0;
  const modelStats = stmts.modelStats.all() as any[];

  // Calculate aggregate stats
  const evalAggregates = db.prepare(`
    SELECT
      AVG(ensemble_trade_score) as avg_score,
      AVG(total_latency_ms) as avg_latency_ms,
      SUM(CASE WHEN ensemble_should_trade = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as trade_rate,
      SUM(CASE WHEN guardrail_allowed = 0 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as guardrail_block_rate
    FROM evaluations
    WHERE prefilter_passed = 1
  `).get() as any;

  const outcomeAggregates = db.prepare(`
    SELECT
      AVG(r_multiple) as avg_r_multiple,
      COUNT(*) as outcomes_recorded,
      SUM(CASE WHEN r_multiple > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN r_multiple <= 0 THEN 1 ELSE 0 END) as losses
    FROM outcomes
    WHERE trade_taken = 1 AND r_multiple IS NOT NULL
  `).get() as any;

  const wins = outcomeAggregates?.wins ?? 0;
  const losses = outcomeAggregates?.losses ?? 0;
  const totalTrades = wins + losses;

  // Build model_compliance map
  const modelCompliance: Record<string, number> = {};
  for (const m of modelStats) {
    if (m.total > 0) {
      modelCompliance[m.model_id] = m.compliant / m.total;
    }
  }

  return {
    total_evaluations: totalEvals,
    avg_score: evalAggregates?.avg_score ?? 0,
    avg_latency_ms: evalAggregates?.avg_latency_ms ?? 0,
    trade_rate: evalAggregates?.trade_rate ?? 0,
    guardrail_block_rate: evalAggregates?.guardrail_block_rate ?? 0,
    model_compliance: modelCompliance,
    outcomes_recorded: outcomeAggregates?.outcomes_recorded ?? 0,
    avg_r_multiple: outcomeAggregates?.avg_r_multiple ?? null,
    wins,
    losses,
    win_rate: totalTrades > 0 ? wins / totalTrades : null,
    model_stats: modelStats,
  };
}

// ── Eval Outcomes (evals joined with outcomes for analytics) ──────────────

export interface EvalOutcomeRow {
  evaluation_id: string;
  symbol: string;
  direction: string;
  timestamp: string;
  ensemble_trade_score: number;
  ensemble_should_trade: number;
  ensemble_confidence: number;
  ensemble_expected_rr: number;
  time_of_day: string;
  volatility_regime: string;
  liquidity_bucket: string;
  rvol: number;
  trade_taken: number;
  decision_type: string | null;
  confidence_rating: number | null;
  rule_followed: number | null;
  setup_type: string | null;
  r_multiple: number | null;
  exit_reason: string | null;
  recorded_at: string;
}

/**
 * Get evaluations joined with outcomes — the core data for calibration,
 * regime analysis, and weight recalibration analytics.
 */
export function getEvalOutcomes(opts: {
  limit?: number;
  symbol?: string;
  days?: number;
  tradesTakenOnly?: boolean;
} = {}): EvalOutcomeRow[] {
  const limit = Math.min(opts.limit ?? 500, 2000);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.tradesTakenOnly !== false) {
    conditions.push("o.trade_taken = 1");
  }
  if (opts.symbol) {
    conditions.push("e.symbol = ?");
    params.push(opts.symbol);
  }
  if (opts.days) {
    conditions.push("e.timestamp >= datetime('now', ? || ' days')");
    params.push(`-${opts.days}`);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  return db.prepare(`
    SELECT
      e.id as evaluation_id,
      e.symbol,
      e.direction,
      e.timestamp,
      e.ensemble_trade_score,
      e.ensemble_should_trade,
      e.ensemble_confidence,
      e.ensemble_expected_rr,
      e.time_of_day,
      e.volatility_regime,
      e.liquidity_bucket,
      e.rvol,
      o.trade_taken,
      o.decision_type,
      o.confidence_rating,
      o.rule_followed,
      o.setup_type,
      o.r_multiple,
      o.exit_reason,
      o.recorded_at
    FROM evaluations e
    JOIN outcomes o ON o.evaluation_id = e.id
    ${where}
    ORDER BY e.timestamp DESC
    LIMIT ?
  `).all(...params, limit) as EvalOutcomeRow[];
}

// ── Weight Simulation Data ────────────────────────────────────────────────

export interface SimulationEvalRow {
  evaluation_id: string;
  symbol: string;
  direction: string;
  timestamp: string;
  ensemble_trade_score: number;
  ensemble_should_trade: number;
  r_multiple: number | null;
  trade_taken: number | null;
  model_outputs: Array<{
    model_id: string;
    trade_score: number | null;
    expected_rr: number | null;
    confidence: number | null;
    should_trade: number | null;
    compliant: number;
  }>;
}

/**
 * Pull historical evaluations with model outputs and outcomes for weight simulation.
 * Only includes evals that passed pre-filter (real scoring decisions).
 */
export function getEvalsForSimulation(opts: { days?: number; symbol?: string } = {}): SimulationEvalRow[] {
  const days = opts.days ?? 90;

  let whereClause = "WHERE e.prefilter_passed = 1 AND e.timestamp >= datetime('now', ? || ' days')";
  const params: unknown[] = [`-${days}`];

  if (opts.symbol) {
    whereClause += " AND e.symbol = ?";
    params.push(opts.symbol);
  }

  const evals = db.prepare(`
    SELECT
      e.id as evaluation_id,
      e.symbol,
      e.direction,
      e.timestamp,
      e.ensemble_trade_score,
      e.ensemble_should_trade,
      o.r_multiple,
      o.trade_taken
    FROM evaluations e
    LEFT JOIN outcomes o ON o.evaluation_id = e.id
    ${whereClause}
    ORDER BY e.timestamp DESC
  `).all(...params) as Array<{
    evaluation_id: string;
    symbol: string;
    direction: string;
    timestamp: string;
    ensemble_trade_score: number;
    ensemble_should_trade: number;
    r_multiple: number | null;
    trade_taken: number | null;
  }>;

  // Batch-load model outputs for all evals
  const evalIds = evals.map((e) => e.evaluation_id);
  if (evalIds.length === 0) return [];

  const placeholders = evalIds.map(() => "?").join(",");
  const outputs = db.prepare(`
    SELECT evaluation_id, model_id, trade_score, expected_rr, confidence, should_trade, compliant
    FROM model_outputs
    WHERE evaluation_id IN (${placeholders})
  `).all(...evalIds) as Array<{
    evaluation_id: string;
    model_id: string;
    trade_score: number | null;
    expected_rr: number | null;
    confidence: number | null;
    should_trade: number | null;
    compliant: number;
  }>;

  // Group outputs by evaluation_id
  const outputMap = new Map<string, typeof outputs>();
  for (const o of outputs) {
    const arr = outputMap.get(o.evaluation_id) ?? [];
    arr.push(o);
    outputMap.set(o.evaluation_id, arr);
  }

  return evals.map((e) => ({
    ...e,
    model_outputs: outputMap.get(e.evaluation_id) ?? [],
  }));
}

// ── Daily Session Summary ────────────────────────────────────────────────

export interface DailySummaryRow {
  session_date: string;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_r: number | null;
  best_r: number | null;
  worst_r: number | null;
  total_r: number | null;
  symbols_traded: string;
}

/**
 * Get daily session summaries — P&L, win rate, avg R grouped by date.
 * Win = r_multiple > 0, Loss = r_multiple <= 0.
 */
export function getDailySummaries(opts: { days?: number; date?: string } = {}): DailySummaryRow[] {
  if (opts.date) {
    // Single day
    return db.prepare(`
      SELECT
        DATE(o.recorded_at) as session_date,
        COUNT(*) as total_trades,
        SUM(CASE WHEN o.r_multiple > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN o.r_multiple <= 0 THEN 1 ELSE 0 END) as losses,
        CAST(SUM(CASE WHEN o.r_multiple > 0 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) as win_rate,
        AVG(o.r_multiple) as avg_r,
        MAX(o.r_multiple) as best_r,
        MIN(o.r_multiple) as worst_r,
        SUM(o.r_multiple) as total_r,
        GROUP_CONCAT(DISTINCT e.symbol) as symbols_traded
      FROM outcomes o
      JOIN evaluations e ON o.evaluation_id = e.id
      WHERE o.trade_taken = 1 AND o.r_multiple IS NOT NULL
        AND DATE(o.recorded_at) = ?
      GROUP BY DATE(o.recorded_at)
    `).all(opts.date) as DailySummaryRow[];
  }

  // Multiple days (default: last 30)
  const days = opts.days ?? 30;
  return db.prepare(`
    SELECT
      DATE(o.recorded_at) as session_date,
      COUNT(*) as total_trades,
      SUM(CASE WHEN o.r_multiple > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN o.r_multiple <= 0 THEN 1 ELSE 0 END) as losses,
      CAST(SUM(CASE WHEN o.r_multiple > 0 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) as win_rate,
      AVG(o.r_multiple) as avg_r,
      MAX(o.r_multiple) as best_r,
      MIN(o.r_multiple) as worst_r,
      SUM(o.r_multiple) as total_r,
      GROUP_CONCAT(DISTINCT e.symbol) as symbols_traded
    FROM outcomes o
    JOIN evaluations e ON o.evaluation_id = e.id
    WHERE o.trade_taken = 1 AND o.r_multiple IS NOT NULL
      AND o.recorded_at >= datetime('now', ? || ' days')
    GROUP BY DATE(o.recorded_at)
    ORDER BY session_date DESC
  `).all(`-${days}`) as DailySummaryRow[];
}

/**
 * Get today's trades as individual rows (for detailed session view).
 */
export function getTodaysTrades(): Array<Record<string, unknown>> {
  return db.prepare(`
    SELECT
      e.id as evaluation_id,
      e.symbol,
      e.direction,
      e.ensemble_trade_score,
      e.ensemble_should_trade,
      e.time_of_day,
      o.actual_entry_price,
      o.actual_exit_price,
      o.r_multiple,
      o.exit_reason,
      o.notes,
      o.recorded_at
    FROM outcomes o
    JOIN evaluations e ON o.evaluation_id = e.id
    WHERE o.trade_taken = 1
      AND DATE(o.recorded_at) = DATE('now')
    ORDER BY o.recorded_at DESC
  `).all() as Array<Record<string, unknown>>;
}

// ── Drift Detection Query ─────────────────────────────────────────────────

/**
 * Get per-model confidence + r_multiple for drift calibration.
 * Joins model_outputs with outcomes for trades that have both.
 */
export function getModelOutcomesForDrift(days: number = 90): Array<Record<string, unknown>> {
  return db.prepare(`
    SELECT
      m.model_id,
      m.confidence,
      o.r_multiple
    FROM model_outputs m
    JOIN evaluations e ON m.evaluation_id = e.id
    JOIN outcomes o ON o.evaluation_id = e.id
    WHERE m.compliant = 1
      AND o.trade_taken = 1
      AND o.r_multiple IS NOT NULL
      AND m.confidence IS NOT NULL
      AND e.timestamp >= datetime('now', ? || ' days')
    ORDER BY e.timestamp DESC
  `).all(`-${days}`) as Array<Record<string, unknown>>;
}

// ── TraderSync Import Helpers ─────────────────────────────────────────────

export function insertTraderSyncTrade(row: Record<string, unknown>): void {
  runEvalInsert("tradersync_trades", row);
}

export function bulkInsertTraderSyncTrades(rows: Array<Record<string, unknown>>): { inserted: number; skipped: number } {
  let inserted = 0;
  let skipped = 0;
  const insert = db.transaction((trades: Array<Record<string, unknown>>) => {
    for (const row of trades) {
      try {
        runEvalInsert("tradersync_trades", row);
        inserted++;
      } catch (e: any) {
        if (e.message?.includes("UNIQUE constraint")) {
          skipped++;
        } else {
          throw e;
        }
      }
    }
  });
  insert(rows);
  return { inserted, skipped };
}

export function getTraderSyncTrades(opts: {
  symbol?: string;
  side?: string;
  status?: string;
  days?: number;
  limit?: number;
} = {}): Array<Record<string, unknown>> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.symbol) {
    conditions.push("symbol = ?");
    params.push(opts.symbol);
  }
  if (opts.side) {
    conditions.push("side = ?");
    params.push(opts.side);
  }
  if (opts.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }
  if (opts.days) {
    conditions.push("open_date >= date('now', ? || ' days')");
    params.push(`-${opts.days}`);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const limit = opts.limit ?? 500;

  return db.prepare(`
    SELECT * FROM tradersync_trades ${where} ORDER BY open_date DESC, open_time DESC LIMIT ?
  `).all(...params, limit) as Array<Record<string, unknown>>;
}

export function getTraderSyncStats(): Record<string, unknown> {
  return db.prepare(`
    SELECT
      COUNT(*) as total_trades,
      SUM(CASE WHEN status = 'WIN' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN status = 'LOSS' THEN 1 ELSE 0 END) as losses,
      CAST(SUM(CASE WHEN status = 'WIN' THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) as win_rate,
      AVG(r_multiple) as avg_r,
      SUM(return_dollars) as total_pnl,
      AVG(return_dollars) as avg_pnl,
      SUM(net_return) as total_net,
      COUNT(DISTINCT symbol) as unique_symbols,
      MIN(open_date) as first_trade,
      MAX(open_date) as last_trade,
      COUNT(DISTINCT import_batch) as import_batches
    FROM tradersync_trades
  `).get() as Record<string, unknown>;
}

export function getTraderSyncByDate(date: string): Array<Record<string, unknown>> {
  return db.prepare(`
    SELECT * FROM tradersync_trades WHERE open_date = ? ORDER BY open_time ASC
  `).all(date) as Array<Record<string, unknown>>;
}

export function isDbWritable(): boolean {
  try {
    db.exec("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export function closeDb() {
  db.close();
}

export { db };
