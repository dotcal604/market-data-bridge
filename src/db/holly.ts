/**
 * Holly AI alerts and signals domain module.
 */

import { getDb, runEvalInsert } from "./connection.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface SignalRow {
  holly_alert_id: number | null;
  evaluation_id: string | null;
  symbol: string;
  direction: string;
  strategy: string | null;
  ensemble_score: number | null;
  should_trade: number | null;
  prefilter_passed: number;
  // AQS shadow-mode fields (optional — null when AQS not yet wired)
  aqs_score?: number | null;
  aqs_version?: string | null;
  aqs_reasons?: string | null; // JSON-stringified string[]
}

// ── Functions ────────────────────────────────────────────────────────────

/**
 * Bulk insert Holly alerts.
 * @param rows Array of alerts
 * @returns Insert/skip counts
 */
export function bulkInsertHollyAlerts(rows: Array<Record<string, unknown>>): { inserted: number; skipped: number } {
  let inserted = 0;
  let skipped = 0;
  const db = getDb();
  const insert = db.transaction((alerts: Array<Record<string, unknown>>) => {
    for (const row of alerts) {
      try {
        runEvalInsert("holly_alerts", row);
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
 * Query Holly alerts.
 * @param opts Filters (symbol, strategy, limit, since)
 * @returns Array of alerts
 */
export function queryHollyAlerts(opts: {
  symbol?: string;
  strategy?: string;
  limit?: number;
  since?: string;
} = {}): Array<Record<string, unknown>> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.symbol) { conditions.push("symbol = ?"); params.push(opts.symbol); }
  if (opts.strategy) { conditions.push("strategy = ?"); params.push(opts.strategy); }
  if (opts.since) { conditions.push("alert_time >= ?"); params.push(opts.since); }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const limit = opts.limit ?? 100;

  return getDb().prepare(`
    SELECT * FROM holly_alerts ${where} ORDER BY alert_time DESC LIMIT ?
  `).all(...params, limit) as Array<Record<string, unknown>>;
}

/**
 * Get aggregate stats for Holly alerts.
 * @returns Stats object
 */
export function getHollyAlertStats(): Record<string, unknown> {
  return getDb().prepare(`
    SELECT
      COUNT(*) as total_alerts,
      COUNT(DISTINCT symbol) as unique_symbols,
      COUNT(DISTINCT strategy) as unique_strategies,
      MIN(alert_time) as first_alert,
      MAX(alert_time) as last_alert,
      COUNT(DISTINCT import_batch) as import_batches,
      COUNT(DISTINCT date(imported_at)) as days_with_alerts
    FROM holly_alerts
  `).get() as Record<string, unknown>;
}

/**
 * Get most recent symbols from Holly alerts.
 * @param limit Max symbols
 * @returns Array of symbols
 */
export function getLatestHollySymbols(limit = 20): string[] {
  const rows = getDb().prepare(`
    SELECT DISTINCT symbol FROM holly_alerts ORDER BY alert_time DESC LIMIT ?
  `).all(limit) as Array<{ symbol: string }>;
  return rows.map((r) => r.symbol);
}

/**
 * Insert a new signal (auto-eval result).
 * @param row Signal details
 * @returns New signal ID
 */
export function insertSignal(row: SignalRow): number {
  const result = getDb().prepare(`
    INSERT INTO signals (holly_alert_id, evaluation_id, symbol, direction, strategy, ensemble_score, should_trade, prefilter_passed, aqs_score, aqs_version, aqs_reasons)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.holly_alert_id, row.evaluation_id, row.symbol, row.direction,
    row.strategy, row.ensemble_score, row.should_trade, row.prefilter_passed,
    row.aqs_score ?? null, row.aqs_version ?? null, row.aqs_reasons ?? null,
  );
  return result.lastInsertRowid as number;
}

/**
 * Query signals.
 * @param opts Filters (symbol, direction, limit, since)
 * @returns Array of signals
 */
export function querySignals(opts: {
  symbol?: string;
  direction?: string;
  limit?: number;
  since?: string;
} = {}): Array<Record<string, unknown>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.symbol) { conditions.push("symbol = ?"); params.push(opts.symbol.toUpperCase()); }
  if (opts.direction) { conditions.push("direction = ?"); params.push(opts.direction); }
  if (opts.since) { conditions.push("created_at >= ?"); params.push(opts.since); }
  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const limit = opts.limit ?? 50;
  return getDb().prepare(`
    SELECT * FROM signals ${where} ORDER BY created_at DESC LIMIT ?
  `).all(...params, limit) as Array<Record<string, unknown>>;
}

/**
 * Get aggregate stats for signals.
 * @returns Stats object
 */
export function getSignalStats(): Record<string, unknown> {
  return getDb().prepare(`
    SELECT
      COUNT(*) as total_signals,
      COUNT(DISTINCT symbol) as unique_symbols,
      SUM(CASE WHEN should_trade = 1 THEN 1 ELSE 0 END) as trade_signals,
      SUM(CASE WHEN should_trade = 0 THEN 1 ELSE 0 END) as no_trade_signals,
      AVG(ensemble_score) as avg_score,
      MIN(created_at) as first_signal,
      MAX(created_at) as last_signal
    FROM signals
  `).get() as Record<string, unknown>;
}

/**
 * Check if a symbol was recently evaluated.
 * @param symbol Stock symbol
 * @param withinMinutes Lookback minutes
 * @returns True if recent eval exists
 */
export function hasRecentEvalForSymbol(symbol: string, withinMinutes: number): boolean {
  const row = getDb().prepare(`
    SELECT COUNT(*) as cnt FROM signals
    WHERE symbol = ? AND created_at >= datetime('now', ?)
  `).get(symbol.toUpperCase(), `-${withinMinutes} minutes`) as { cnt: number };
  return row.cnt > 0;
}

/**
 * Get Holly alerts by import batch ID.
 * @param batchId Batch ID
 * @returns Array of alerts
 */
export function getHollyAlertsByBatch(batchId: string): Array<Record<string, unknown>> {
  return getDb().prepare(`
    SELECT * FROM holly_alerts WHERE import_batch = ? ORDER BY id
  `).all(batchId) as Array<Record<string, unknown>>;
}
