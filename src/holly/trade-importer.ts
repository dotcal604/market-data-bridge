/**
 * Holly AI Trade CSV Importer
 *
 * Parses Holly AI trade execution CSVs with non-standard date format (dates with commas).
 * Computes derived fields: hold_minutes, MFE, MAE, giveback, giveback_ratio, time_to_mfe_min, r_multiple.
 *
 * Usage:
 *   importHollyTrades(csvContent: string): ImportResult
 */

import { parse } from "csv-parse/sync";
import { randomUUID } from "crypto";
import { logger } from "../logging.js";

const log = logger.child({ module: "holly-trades" });

export interface HollyTradeRow {
  symbol: string;
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  size: number;
  side: "LONG" | "SHORT";
  stop_price: number | null;
  target_price: number | null;
  max_price: number | null;  // highest price reached (for longs) or lowest (for shorts)
  min_price: number | null;  // lowest price reached (for longs) or highest (for shorts)
  strategy: string | null;
  notes: string | null;
  // Derived fields
  hold_minutes: number;
  mfe: number;  // max favorable excursion (in dollars)
  mae: number;  // max adverse excursion (in dollars)
  r_multiple: number | null;
  pnl: number;
  pnl_pct: number;
  giveback: number | null;  // from MFE peak to exit (in dollars)
  giveback_ratio: number | null;  // giveback / MFE
  time_to_mfe_min: number | null;  // minutes from entry to MFE peak
}

export interface ImportResult {
  batch_id: string;
  total_parsed: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

/** Strip BOM (Byte Order Mark) if present */
function stripBOM(content: string): string {
  if (content.charCodeAt(0) === 0xFEFF) {
    return content.slice(1);
  }
  return content;
}

/** Parse numeric values, stripping $, commas, quotes */
function parseNum(val: string | undefined | null): number | null {
  if (!val || val.trim() === "") return null;
  const cleaned = val.replace(/[$,"\s]/g, "");
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

/** Parse date with commas: "Feb 12, 2026 10:30:00" or "2026-02-12 10:30:00" */
function parseDateTime(raw: string): string {
  if (!raw || !raw.trim()) return new Date().toISOString();
  const trimmed = raw.trim();
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return trimmed;
  return d.toISOString();
}

/** Calculate hold time in minutes */
function calcHoldMinutes(entry: string, exit: string): number {
  const entryMs = new Date(entry).getTime();
  const exitMs = new Date(exit).getTime();
  if (isNaN(entryMs) || isNaN(exitMs)) return 0;
  return Math.max(0, Math.round((exitMs - entryMs) / 60000));
}

/** Calculate MFE (max favorable excursion) */
function calcMFE(
  side: string,
  entryPrice: number,
  maxPrice: number | null,
  minPrice: number | null,
  size: number
): number {
  if (side === "LONG") {
    const peak = maxPrice ?? entryPrice;
    return Math.max(0, (peak - entryPrice) * size);
  } else {
    const trough = minPrice ?? entryPrice;
    return Math.max(0, (entryPrice - trough) * size);
  }
}

/** Calculate MAE (max adverse excursion) */
function calcMAE(
  side: string,
  entryPrice: number,
  maxPrice: number | null,
  minPrice: number | null,
  size: number
): number {
  if (side === "LONG") {
    const trough = minPrice ?? entryPrice;
    return Math.abs(Math.min(0, (trough - entryPrice) * size));
  } else {
    const peak = maxPrice ?? entryPrice;
    return Math.abs(Math.min(0, (entryPrice - peak) * size));
  }
}

/** Calculate R-multiple (PnL / risk) */
function calcRMultiple(pnl: number, entryPrice: number, stopPrice: number | null, size: number): number | null {
  if (stopPrice == null) return null;
  const risk = Math.abs((entryPrice - stopPrice) * size);
  if (risk === 0) return null;
  return pnl / risk;
}

/** Calculate giveback (from MFE peak to exit) */
function calcGiveback(mfe: number, pnl: number): number | null {
  if (mfe === 0) return null;
  return Math.max(0, mfe - pnl);
}

/** Calculate giveback ratio */
function calcGivebackRatio(giveback: number | null, mfe: number): number | null {
  if (giveback == null || mfe === 0) return null;
  return giveback / mfe;
}

/** Parse time to MFE from notes field (format: "mfe_time:15" for 15 minutes) */
function parseTimeToMFE(notes: string | null): number | null {
  if (!notes) return null;
  const match = notes.match(/mfe_time:(\d+)/i);
  return match ? Number(match[1]) : null;
}

/** Parse a single CSV row */
export function parseRow(record: Record<string, string>): HollyTradeRow {
  const symbol = record["Symbol"]?.trim().toUpperCase() || "";
  const entryTime = parseDateTime(record["Entry Time"] ?? "");
  const exitTime = parseDateTime(record["Exit Time"] ?? "");
  const entryPrice = parseNum(record["Entry Price"]) ?? 0;
  const exitPrice = parseNum(record["Exit Price"]) ?? 0;
  const size = Math.abs(parseNum(record["Size"]) ?? 0);
  const rawSide = record["Side"]?.trim().toUpperCase();
  const side = (rawSide && rawSide !== "" ? rawSide : "LONG") as "LONG" | "SHORT";
  const stopPrice = parseNum(record["Stop Price"]);
  const targetPrice = parseNum(record["Target Price"]);
  const maxPrice = parseNum(record["Max Price"]);
  const minPrice = parseNum(record["Min Price"]);
  const strategy = record["Strategy"]?.trim() || null;
  const notes = record["Notes"]?.trim() || null;

  // Compute derived fields
  const holdMinutes = calcHoldMinutes(entryTime, exitTime);
  const mfe = calcMFE(side, entryPrice, maxPrice, minPrice, size);
  const mae = calcMAE(side, entryPrice, maxPrice, minPrice, size);
  
  const pnl = side === "LONG" 
    ? (exitPrice - entryPrice) * size 
    : (entryPrice - exitPrice) * size;
  const pnlPct = entryPrice !== 0 
    ? (pnl / (entryPrice * size)) * 100 
    : 0;

  const rMultiple = calcRMultiple(pnl, entryPrice, stopPrice, size);
  const giveback = calcGiveback(mfe, pnl);
  const givebackRatio = calcGivebackRatio(giveback, mfe);
  const timeToMfeMin = parseTimeToMFE(notes);

  return {
    symbol,
    entry_time: entryTime,
    exit_time: exitTime,
    entry_price: entryPrice,
    exit_price: exitPrice,
    size,
    side,
    stop_price: stopPrice,
    target_price: targetPrice,
    max_price: maxPrice,
    min_price: minPrice,
    strategy,
    notes,
    hold_minutes: holdMinutes,
    mfe,
    mae,
    r_multiple: rMultiple,
    pnl,
    pnl_pct: pnlPct,
    giveback,
    giveback_ratio: givebackRatio,
    time_to_mfe_min: timeToMfeMin,
  };
}

/**
 * Import Holly trades from CSV string.
 * 
 * CSV format expected:
 * Symbol,Entry Time,Exit Time,Entry Price,Exit Price,Size,Side,Stop Price,Target Price,Max Price,Min Price,Strategy,Notes
 * 
 * Entry Time and Exit Time can include commas: "Feb 12, 2026 10:30:00"
 */
export function importHollyTrades(
  csvContent: string,
  bulkInsertFn: (rows: Array<Record<string, unknown>>) => { inserted: number; skipped: number }
): ImportResult {
  const batchId = randomUUID().slice(0, 8);
  const errors: string[] = [];

  // Strip BOM if present
  const cleanContent = stripBOM(csvContent);

  let records: Record<string, string>[];
  try {
    records = parse(cleanContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (e: any) {
    return { 
      batch_id: batchId, 
      total_parsed: 0, 
      inserted: 0, 
      skipped: 0, 
      errors: [`CSV parse error: ${e.message}`] 
    };
  }

  if (records.length === 0) {
    return { batch_id: batchId, total_parsed: 0, inserted: 0, skipped: 0, errors: [] };
  }

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < records.length; i++) {
    try {
      const parsed = parseRow(records[i]);
      if (!parsed.symbol) {
        errors.push(`Row ${i + 2}: missing symbol`);
        continue;
      }
      rows.push({ ...parsed, import_batch: batchId });
    } catch (e: any) {
      errors.push(`Row ${i + 2}: ${e.message}`);
    }
  }

  if (rows.length === 0) {
    return { 
      batch_id: batchId, 
      total_parsed: records.length, 
      inserted: 0, 
      skipped: 0, 
      errors 
    };
  }

  const { inserted, skipped } = bulkInsertFn(rows);

  if (inserted > 0) {
    const symbols = [...new Set(rows.slice(0, inserted).map((r) => r.symbol))];
    log.info({ batch_id: batchId, inserted, skipped, symbols }, "Holly trades imported");
  }

  return {
    batch_id: batchId,
    total_parsed: records.length,
    inserted,
    skipped,
    errors,
  };
}

/**
 * Query helper functions
 */

export function queryTrades(
  db: any,
  opts: {
    symbol?: string;
    side?: string;
    strategy?: string;
    days?: number;
    limit?: number;
  } = {}
): Array<Record<string, unknown>> {
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
  if (opts.strategy) {
    conditions.push("strategy = ?");
    params.push(opts.strategy);
  }
  if (opts.days) {
    conditions.push("entry_time >= datetime('now', ? || ' days')");
    params.push(`-${opts.days}`);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  const limit = opts.limit ?? 500;

  return db.prepare(`
    SELECT * FROM holly_trades ${where} ORDER BY entry_time DESC LIMIT ?
  `).all(...params, limit) as Array<Record<string, unknown>>;
}

export function getTradeStats(db: any): Record<string, unknown> {
  return db.prepare(`
    SELECT
      COUNT(*) as total_trades,
      AVG(pnl) as avg_pnl,
      SUM(pnl) as total_pnl,
      AVG(r_multiple) as avg_r,
      AVG(hold_minutes) as avg_hold_minutes,
      AVG(mfe) as avg_mfe,
      AVG(mae) as avg_mae,
      AVG(giveback_ratio) as avg_giveback_ratio,
      AVG(time_to_mfe_min) as avg_time_to_mfe_min,
      COUNT(DISTINCT symbol) as unique_symbols,
      MIN(entry_time) as first_trade,
      MAX(entry_time) as last_trade,
      COUNT(DISTINCT import_batch) as import_batches
    FROM holly_trades
  `).get() as Record<string, unknown>;
}
