/**
 * TraderSync CSV Importer
 *
 * Parses TraderSync trade_data.csv exports and inserts into tradersync_trades table.
 * Handles: date format normalization, comma-stripped numbers, R-multiple/MAE/MFE parsing.
 *
 * Usage:
 *   POST /api/tradersync/import  (multipart/form-data with csv file)
 *   CLI: npx tsx src/tradersync/cli.ts <path-to-csv>
 */

import { parse } from "csv-parse/sync";
import { randomUUID } from "crypto";
import { bulkInsertTraderSyncTrades } from "../db/database.js";

export interface TraderSyncRow {
  status: string;
  symbol: string;
  size: number;
  open_date: string;
  close_date: string;
  open_time: string;
  close_time: string;
  setups: string | null;
  mistakes: string | null;
  entry_price: number;
  exit_price: number;
  return_dollars: number;
  return_pct: number;
  avg_buy: number | null;
  avg_sell: number | null;
  net_return: number | null;
  commission: number | null;
  notes: string | null;
  type: string;
  side: string;
  spread: string;
  cost: number | null;
  executions: number | null;
  holdtime: string | null;
  portfolio: string | null;
  r_multiple: number | null;
  mae: number | null;
  mfe: number | null;
  expectancy: number | null;
  risk: number | null;
  target1: number | null;
  profit_aim1: number | null;
  stop1: number | null;
  risk1: number | null;
  signal_source: string;
}

/** Parse signal source from TraderSync notes field */
function parseSignalSource(notes: string | null | undefined): string {
  if (!notes) return "manual";
  const tags = notes.split(";").map((t) => t.trim().toUpperCase());
  if (tags.includes("IA")) return "holly";     // Trade Ideas / Holly AI
  if (tags.includes("FP")) return "finviz";     // Finviz screener
  if (tags.includes("RP")) return "replay";     // Replay / backtest
  return "manual";
}

/** Strip $ signs, commas, and quotes from numeric strings */
function parseNum(val: string | undefined | null): number | null {
  if (!val || val.trim() === "") return null;
  const cleaned = val.replace(/[$,"\s]/g, "");
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

/** Normalize "Feb 12, 2026" → "2026-02-12" */
function normalizeDate(raw: string): string {
  const d = new Date(raw.trim());
  if (isNaN(d.getTime())) return raw.trim();
  return d.toISOString().slice(0, 10);
}

/** Parse a single CSV row into our DB format */
function parseRow(record: Record<string, string>): TraderSyncRow {
  return {
    status: record["Status"]?.trim() ?? "UNKNOWN",
    symbol: record["Symbol"]?.trim() ?? "",
    size: Number(String(record["Size"] ?? "0").replace(/,/g, "")) || 0,
    open_date: normalizeDate(record["Open Date"] ?? ""),
    close_date: normalizeDate(record["Close Date"] ?? ""),
    open_time: record["Open Time"]?.trim() ?? "",
    close_time: record["Close Time"]?.trim() ?? "",
    setups: record["Setups"]?.trim() || null,
    mistakes: record["Mistakes"]?.trim() || null,
    entry_price: parseNum(record["Entry Price"]) ?? 0,
    exit_price: parseNum(record["Exit Price"]) ?? 0,
    return_dollars: parseNum(record["Return $"]) ?? 0,
    return_pct: parseNum(record["Return %"]?.replace("%", "")) ?? 0,
    avg_buy: parseNum(record["Avg Buy"]),
    avg_sell: parseNum(record["Avg Sell"]),
    net_return: parseNum(record["Net Return"]),
    commission: parseNum(record["Commision"]),  // TraderSync typo: "Commision"
    notes: record["Notes"]?.trim() || null,
    type: record["Type"]?.trim() ?? "SHARE",
    side: record["Side"]?.trim() ?? "LONG",
    spread: record["Spread"]?.trim() ?? "SINGLE",
    cost: parseNum(record["Cost"]),
    executions: parseNum(record["Executions"]) ? Math.round(parseNum(record["Executions"])!) : null,
    holdtime: record["Holdtime"]?.trim() || null,
    portfolio: record["Portfolio"]?.trim() || null,
    r_multiple: parseNum(record["R-Multiple"]),
    mae: parseNum(record["MAE"]),
    mfe: parseNum(record["MFE"]),
    expectancy: parseNum(record["Expectancy"]),
    risk: parseNum(record["Risk"]),
    target1: parseNum(record["target1"]),
    profit_aim1: parseNum(record["profit_aim1"]),
    stop1: parseNum(record["stop1"]),
    risk1: parseNum(record["risk1"]),
    signal_source: parseSignalSource(record["Notes"]),
  };
}

export interface ImportResult {
  batch_id: string;
  total_parsed: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

/**
 * Parse a TraderSync trade_data CSV string and import into DB.
 */
export function importTraderSyncCSV(csvContent: string): ImportResult {
  const batchId = randomUUID().slice(0, 8);
  const errors: string[] = [];

  let records: Record<string, string>[];
  try {
    records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (e: any) {
    return { batch_id: batchId, total_parsed: 0, inserted: 0, skipped: 0, errors: [`CSV parse error: ${e.message}`] };
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

  const { inserted, skipped } = bulkInsertTraderSyncTrades(rows);

  return {
    batch_id: batchId,
    total_parsed: records.length,
    inserted,
    skipped,
    errors,
  };
}
