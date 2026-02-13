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
    INSERT INTO trade_journal (symbol, strategy_version, reasoning, ai_recommendations, tags, spy_price, vix_level, gap_pct, relative_volume, time_of_day, session_type, spread_pct)
    VALUES (@symbol, @strategy_version, @reasoning, @ai_recommendations, @tags, @spy_price, @vix_level, @gap_pct, @relative_volume, @time_of_day, @session_type, @spread_pct)
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
  const modelStats = stmts.modelStats.all();
  return { totalEvals, totalOutcomes, modelStats };
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
