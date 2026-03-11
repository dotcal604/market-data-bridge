/**
 * IBKR Flex trades domain module.
 */

import { getDb } from "./connection.js";

// ── Schema (called at import time from connection.ts) ─────────────────────

export function ensureFlexTradesTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS flex_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT,
      trade_id TEXT,
      symbol TEXT NOT NULL,
      conid TEXT,
      asset_class TEXT DEFAULT 'STK',
      description TEXT,
      action TEXT NOT NULL,             -- BUY / SELL
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      proceeds REAL,
      commission REAL,
      net_cash REAL,
      trade_date TEXT NOT NULL,         -- YYYY-MM-DD
      trade_time TEXT,
      settle_date TEXT,
      exchange TEXT,
      order_type TEXT,
      currency TEXT DEFAULT 'USD',
      fx_rate REAL DEFAULT 1,
      realized_pnl REAL,
      cost_basis REAL,
      order_id TEXT,
      exec_id TEXT,
      open_close TEXT,                  -- O / C
      notes TEXT,
      raw_json TEXT,                    -- Full original record for audit
      import_batch TEXT,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_id, trade_id, exec_id)
    );
    CREATE INDEX IF NOT EXISTS idx_flex_symbol ON flex_trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_flex_trade_date ON flex_trades(trade_date);
    CREATE INDEX IF NOT EXISTS idx_flex_action ON flex_trades(action);
    CREATE INDEX IF NOT EXISTS idx_flex_batch ON flex_trades(import_batch);
    CREATE INDEX IF NOT EXISTS idx_flex_account ON flex_trades(account_id);
    CREATE INDEX IF NOT EXISTS idx_flex_exec_id ON flex_trades(exec_id);
  `);
}

// ── Insert ────────────────────────────────────────────────────────────────

export function bulkInsertFlexTrades(
  rows: Array<Record<string, unknown>>,
): { inserted: number; skipped: number } {
  ensureFlexTradesTable();
  const db = getDb();
  let inserted = 0;
  let skipped = 0;

  const cols = [
    "account_id", "trade_id", "symbol", "conid", "asset_class", "description",
    "action", "quantity", "price", "proceeds", "commission", "net_cash",
    "trade_date", "trade_time", "settle_date", "exchange", "order_type",
    "currency", "fx_rate", "realized_pnl", "cost_basis", "order_id",
    "exec_id", "open_close", "notes", "raw_json", "import_batch",
  ];

  const placeholders = cols.map((c) => `@${c}`).join(", ");
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO flex_trades (${cols.join(", ")}) VALUES (${placeholders})`,
  );

  const insertAll = db.transaction((trades: Array<Record<string, unknown>>) => {
    for (const row of trades) {
      const bound: Record<string, unknown> = {};
      for (const c of cols) {
        const v = row[c];
        bound[c] = v === undefined ? null : v;
      }
      const result = stmt.run(bound);
      if (result.changes > 0) inserted++;
      else skipped++;
    }
  });

  insertAll(rows);
  return { inserted, skipped };
}

// ── Query ─────────────────────────────────────────────────────────────────

export interface FlexTradeQuery {
  symbol?: string;
  action?: string;     // BUY / SELL
  days?: number;
  from_date?: string;  // YYYY-MM-DD
  to_date?: string;
  account_id?: string;
  limit?: number;
}

export function getFlexTrades(opts: FlexTradeQuery = {}): Array<Record<string, unknown>> {
  ensureFlexTradesTable();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.symbol) {
    conditions.push("symbol = ?");
    params.push(opts.symbol.toUpperCase());
  }
  if (opts.action) {
    conditions.push("action = ?");
    params.push(opts.action.toUpperCase());
  }
  if (opts.account_id) {
    conditions.push("account_id = ?");
    params.push(opts.account_id);
  }
  if (opts.days) {
    conditions.push("trade_date >= date('now', ? || ' days')");
    params.push(`-${opts.days}`);
  }
  if (opts.from_date) {
    conditions.push("trade_date >= ?");
    params.push(opts.from_date);
  }
  if (opts.to_date) {
    conditions.push("trade_date <= ?");
    params.push(opts.to_date);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const limit = opts.limit ?? 500;

  return getDb().prepare(`
    SELECT * FROM flex_trades ${where} ORDER BY trade_date DESC, trade_time DESC LIMIT ?
  `).all(...params, limit) as Array<Record<string, unknown>>;
}

export function getFlexStats(): Record<string, unknown> {
  ensureFlexTradesTable();
  return getDb().prepare(`
    SELECT
      COUNT(*) as total_trades,
      COUNT(DISTINCT symbol) as unique_symbols,
      COUNT(DISTINCT account_id) as accounts,
      SUM(CASE WHEN action = 'BUY' THEN quantity ELSE 0 END) as total_bought,
      SUM(CASE WHEN action = 'SELL' THEN quantity ELSE 0 END) as total_sold,
      SUM(commission) as total_commission,
      SUM(realized_pnl) as total_realized_pnl,
      SUM(net_cash) as total_net_cash,
      MIN(trade_date) as first_trade,
      MAX(trade_date) as last_trade,
      COUNT(DISTINCT import_batch) as import_batches
    FROM flex_trades
  `).get() as Record<string, unknown>;
}
