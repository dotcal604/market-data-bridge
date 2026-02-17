/**
 * Holly AI Alert CSV Importer
 *
 * Parses Trade Ideas Holly AI alert log CSVs and inserts into holly_alerts table.
 * Flexible column mapping — auto-detects columns from the header row so it works
 * with both the historical export format and the live Alert Logging format.
 *
 * Usage:
 *   Automatic: file watcher (src/holly/watcher.ts) calls importHollyAlerts()
 *   Manual:    POST /api/agent { action: "holly_import", params: { csv: "..." } }
 */

import { parse } from "csv-parse/sync";
import { randomUUID } from "crypto";
import { bulkInsertHollyAlerts } from "../db/database.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "holly" });

export interface ImportResult {
  batch_id: string;
  total_parsed: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

// ── Column name mapping ──────────────────────────────────────────────────
// Trade Ideas CSVs use verbose column names. Map them to our DB columns.
// Keys are lowercased + trimmed versions of the CSV header.

const COLUMN_MAP: Record<string, string> = {
  "entry time": "alert_time",
  "time": "alert_time",
  "alert time": "alert_time",
  "symbol": "symbol",
  "ticker": "symbol",
  "strategy": "strategy",
  "entry price": "entry_price",
  "price": "entry_price",
  "stop price": "stop_price",
  "stop": "stop_price",
  "smart stop": "stop_price",
  "shares": "shares",
  "size": "shares",
  "last price": "last_price",
  "last": "last_price",
  "segment": "segment",
  "exit price": "exit_price",
  "exit time": "exit_time",
  "closed profit": "closed_profit",
  "change from entry %": "change_pct",
  "max profit": "max_profit",
  "min profit": "min_profit",
};

// DB columns we map into (the rest go to `extra` JSON)
const KNOWN_DB_COLS = new Set([
  "alert_time", "symbol", "strategy", "entry_price", "stop_price",
  "shares", "last_price", "segment",
]);

function parseNum(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const cleaned = v.replace(/[$,\s"]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeRow(
  raw: Record<string, string>,
  headerMap: Map<string, string>,
): Record<string, unknown> | null {
  const mapped: Record<string, unknown> = {};
  const extra: Record<string, string> = {};

  for (const [csvCol, value] of Object.entries(raw)) {
    const dbCol = headerMap.get(csvCol.toLowerCase().trim());
    if (dbCol && KNOWN_DB_COLS.has(dbCol)) {
      mapped[dbCol] = value;
    } else {
      // Store unmapped columns in extra JSON
      if (value && value.trim()) {
        extra[csvCol.trim()] = value.trim();
      }
    }
  }

  // Symbol is required
  if (!mapped.symbol || typeof mapped.symbol !== "string" || !mapped.symbol.toString().trim()) {
    return null;
  }

  // Normalize types
  const symbol = mapped.symbol.toString().trim().toUpperCase();
  const alert_time = mapped.alert_time?.toString().trim() ?? new Date().toISOString();
  const strategy = mapped.strategy?.toString().trim() ?? null;
  const entry_price = parseNum(mapped.entry_price?.toString());
  const stop_price = parseNum(mapped.stop_price?.toString());
  const shares = parseNum(mapped.shares?.toString());
  const last_price = parseNum(mapped.last_price?.toString());
  const segment = mapped.segment?.toString().trim() ?? null;

  return {
    alert_time,
    symbol,
    strategy,
    entry_price,
    stop_price,
    shares: shares != null ? Math.round(shares) : null,
    last_price,
    segment,
    extra: Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
  };
}

export function importHollyAlerts(csvContent: string): ImportResult {
  const batch_id = randomUUID();
  const errors: string[] = [];

  let records: Array<Record<string, string>>;
  try {
    records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (e: any) {
    return { batch_id, total_parsed: 0, inserted: 0, skipped: 0, errors: [`CSV parse error: ${e.message}`] };
  }

  if (records.length === 0) {
    return { batch_id, total_parsed: 0, inserted: 0, skipped: 0, errors: [] };
  }

  // Build header mapping from first record's keys
  const headerMap = new Map<string, string>();
  for (const col of Object.keys(records[0])) {
    const normalized = col.toLowerCase().trim();
    if (COLUMN_MAP[normalized]) {
      headerMap.set(normalized, COLUMN_MAP[normalized]);
    }
  }

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < records.length; i++) {
    try {
      const row = normalizeRow(records[i], headerMap);
      if (row) {
        row.import_batch = batch_id;
        rows.push(row);
      } else {
        errors.push(`Row ${i + 1}: missing symbol`);
      }
    } catch (e: any) {
      errors.push(`Row ${i + 1}: ${e.message}`);
    }
  }

  if (rows.length === 0) {
    return { batch_id, total_parsed: records.length, inserted: 0, skipped: 0, errors };
  }

  const { inserted, skipped } = bulkInsertHollyAlerts(rows);

  if (inserted > 0) {
    const symbols = [...new Set(rows.slice(0, inserted).map((r) => r.symbol))];
    log.info({ batch_id, inserted, skipped, symbols }, "Holly alerts imported");
  }

  return { batch_id, total_parsed: records.length, inserted, skipped, errors };
}
