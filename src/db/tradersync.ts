/**
 * TraderSync import domain module.
 */

import { getDb, runEvalInsert } from "./connection.js";

/**
 * Insert a single TraderSync trade.
 * @param row Trade data
 */
export function insertTraderSyncTrade(row: Record<string, unknown>): void {
  runEvalInsert("tradersync_trades", row);
}

/**
 * Bulk insert TraderSync trades.
 * @param rows Array of trade data
 * @returns Insert/skip counts
 */
export function bulkInsertTraderSyncTrades(rows: Array<Record<string, unknown>>): { inserted: number; skipped: number } {
  let inserted = 0;
  let skipped = 0;
  const db = getDb();
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

/**
 * Query TraderSync trades.
 * @param opts Filters (symbol, side, status, days, limit)
 * @returns Array of trades
 */
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

  return getDb().prepare(`
    SELECT * FROM tradersync_trades ${where} ORDER BY open_date DESC, open_time DESC LIMIT ?
  `).all(...params, limit) as Array<Record<string, unknown>>;
}

/**
 * Get aggregate stats for TraderSync trades.
 * @returns Stats object
 */
export function getTraderSyncStats(): Record<string, unknown> {
  return getDb().prepare(`
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

/**
 * Get TraderSync trades for a specific date.
 * @param date YYYY-MM-DD
 * @returns Array of trades
 */
export function getTraderSyncByDate(date: string): Array<Record<string, unknown>> {
  return getDb().prepare(`
    SELECT * FROM tradersync_trades WHERE open_date = ? ORDER BY open_time ASC
  `).all(date) as Array<Record<string, unknown>>;
}
