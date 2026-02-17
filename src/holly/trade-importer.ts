/**
 * Holly Trade CSV Importer
 *
 * Parses the Trade Ideas Holly AI historical trade export CSV.
 * The CSV has a non-standard format where dates contain commas:
 *   YYYY,Mon,DD,"HH:MM:SS,YYYY",Mon,DD,"HH:MM:SS,Symbol,Shares,...rest"
 *
 * Creates holly_trades table with full trade data including MFE/MAE,
 * max profit times, exit metrics — everything needed for the exit autopsy.
 */

import { getDb } from "../db/database.js";
import { logger } from "../logging.js";

const log = logger.child({ module: "holly-trade-importer" });

// ── Types ────────────────────────────────────────────────────────────────

export interface HollyTrade {
  entry_time: string;
  exit_time: string;
  symbol: string;
  shares: number;
  entry_price: number;
  last_price: number;
  change_from_entry: number | null;
  change_from_close: number | null;
  change_from_close_pct: number | null;
  strategy: string;
  exit_price: number;
  closed_profit: number;
  profit_change_15: number | null;
  profit_change_5: number | null;
  max_profit: number | null;
  profit_basis_points: number | null;
  open_profit: number | null;
  stop_price: number | null;
  time_stop: string | null;
  max_profit_time: string | null;
  distance_from_max_profit: number | null;
  min_profit: number | null;
  min_profit_time: string | null;
  distance_from_stop: number | null;
  smart_stop: number | null;
  pct_to_stop: number | null;
  time_until: number | null;
  segment: string | null;
  change_from_entry_pct: number | null;
  long_term_profit: number | null;
  long_term_profit_pct: number | null;
}

export interface TradeImportResult {
  total_rows: number;
  imported: number;
  skipped: number;
  errors: number;
  error_samples: string[];
}

// ── Month Map ────────────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// ── Schema ───────────────────────────────────────────────────────────────

export function ensureHollyTradesTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS holly_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_time TEXT NOT NULL,
      exit_time TEXT NOT NULL,
      symbol TEXT NOT NULL,
      shares INTEGER,
      entry_price REAL NOT NULL,
      last_price REAL,
      change_from_entry REAL,
      change_from_close REAL,
      change_from_close_pct REAL,
      strategy TEXT,
      exit_price REAL,
      closed_profit REAL,
      profit_change_15 REAL,
      profit_change_5 REAL,
      max_profit REAL,
      profit_basis_points REAL,
      open_profit REAL,
      stop_price REAL,
      time_stop TEXT,
      max_profit_time TEXT,
      distance_from_max_profit REAL,
      min_profit REAL,
      min_profit_time TEXT,
      distance_from_stop REAL,
      smart_stop REAL,
      pct_to_stop REAL,
      time_until REAL,
      segment TEXT,
      change_from_entry_pct REAL,
      long_term_profit REAL,
      long_term_profit_pct REAL,
      -- Derived fields (computed on import)
      hold_minutes REAL,
      mfe REAL,               -- max favorable excursion = max_profit
      mae REAL,               -- max adverse excursion = min_profit
      giveback REAL,          -- max_profit - closed_profit
      giveback_ratio REAL,    -- giveback / max_profit (0-1, lower=better)
      time_to_mfe_min REAL,   -- minutes from entry to max profit
      time_to_mae_min REAL,   -- minutes from entry to min profit
      r_multiple REAL,        -- closed_profit / |entry - stop| (if stop exists)
      import_batch TEXT,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(symbol, entry_time, strategy)
    );
    CREATE INDEX IF NOT EXISTS idx_holly_trades_symbol ON holly_trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_holly_trades_strategy ON holly_trades(strategy);
    CREATE INDEX IF NOT EXISTS idx_holly_trades_entry_time ON holly_trades(entry_time);
    CREATE INDEX IF NOT EXISTS idx_holly_trades_segment ON holly_trades(segment);
    CREATE INDEX IF NOT EXISTS idx_holly_trades_batch ON holly_trades(import_batch);
  `);
}

// ── Parser ───────────────────────────────────────────────────────────────

/**
 * Parse a single row from the Trade Ideas Holly CSV.
 * Format: YYYY,Mon,DD,"HH:MM:SS,YYYY",Mon,DD,"HH:MM:SS,Symbol,Shares,..."
 *
 * The key insight: the first quoted field contains "entryTime,exitYear"
 * and the second quoted field contains "exitTime,symbol,shares,...rest"
 */
function parseRow(line: string): HollyTrade | null {
  // Step 1: Extract quoted sections
  // Pattern: YYYY,Mon,DD,"time,YYYY",Mon,DD,"time,SYM,shares,...rest"
  const quoteMatch = line.match(
    /^(\d{4}),(\w{3}),(\d{1,2}),"(\d{2}:\d{2}:\d{2}),(\d{4})",(\w{3}),(\d{1,2}),"(\d{2}:\d{2}:\d{2}),(.+)"?\s*$/,
  );

  if (!quoteMatch) return null;

  const [, entryYear, entryMon, entryDay, entryTime, exitYear, exitMon, exitDay, exitTime, rest] = quoteMatch;

  const entryMonNum = MONTHS[entryMon];
  const exitMonNum = MONTHS[exitMon];
  if (!entryMonNum || !exitMonNum) return null;

  const entryDayPad = entryDay.padStart(2, "0");
  const exitDayPad = exitDay.padStart(2, "0");
  const entryTs = `${entryYear}-${entryMonNum}-${entryDayPad} ${entryTime}`;
  const exitTs = `${exitYear}-${exitMonNum}-${exitDayPad} ${exitTime}`;

  // Step 2: Split the rest by comma — these are the remaining fields
  const fields = rest.split(",");
  // Expected: symbol, shares, entry_price, last_price, change_from_entry,
  //   change_from_close, change_from_close_pct, strategy, exit_price,
  //   closed_profit, profit_change_15, profit_change_5, max_profit,
  //   profit_basis_points, open_profit, stop_price, time_stop,
  //   max_profit_time, distance_from_max_profit, min_profit,
  //   min_profit_time, distance_from_stop, smart_stop, pct_to_stop,
  //   time_until, segment, change_from_entry_pct, long_term_profit,
  //   long_term_profit_pct

  if (fields.length < 25) return null;

  const num = (s: string): number | null => {
    if (!s || s.trim() === "") return null;
    // Remove spaces in numbers like "-7 569"
    const cleaned = s.trim().replace(/\s/g, "");
    const v = parseFloat(cleaned);
    return Number.isFinite(v) ? v : null;
  };

  const str = (s: string): string | null => {
    const trimmed = s?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
  };

  const symbol = fields[0].trim();
  const shares = num(fields[1]) ?? 0;
  const entryPrice = num(fields[2]);
  const lastPrice = num(fields[3]);
  const exitPrice = num(fields[8]);

  if (!entryPrice || !symbol) return null;

  const closedProfit = num(fields[9]);
  const maxProfit = num(fields[12]);
  const minProfit = num(fields[19]);
  const stopPrice = num(fields[15]);

  // Parse compound datetime fields (e.g., "2020 Mar 31 12:45:00")
  const parseDateTime = (s: string): string | null => {
    const trimmed = s?.trim();
    if (!trimmed || trimmed === "") return null;
    const m = trimmed.match(/(\d{4})\s+(\w{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})/);
    if (!m) return null;
    const mon = MONTHS[m[2]];
    if (!mon) return null;
    return `${m[1]}-${mon}-${m[3].padStart(2, "0")} ${m[4]}`;
  };

  return {
    entry_time: entryTs,
    exit_time: exitTs,
    symbol,
    shares: shares as number,
    entry_price: entryPrice,
    last_price: lastPrice ?? 0,
    change_from_entry: num(fields[4]),
    change_from_close: num(fields[5]),
    change_from_close_pct: num(fields[6]),
    strategy: fields[7]?.trim() ?? "",
    exit_price: exitPrice ?? 0,
    closed_profit: closedProfit ?? 0,
    profit_change_15: num(fields[10]),
    profit_change_5: num(fields[11]),
    max_profit: maxProfit,
    profit_basis_points: num(fields[13]),
    open_profit: num(fields[14]),
    stop_price: stopPrice,
    time_stop: parseDateTime(fields[16] ?? ""),
    max_profit_time: parseDateTime(fields[17] ?? ""),
    distance_from_max_profit: num(fields[18]),
    min_profit: minProfit,
    min_profit_time: parseDateTime(fields[20] ?? ""),
    distance_from_stop: num(fields[21]),
    smart_stop: num(fields[22]),
    pct_to_stop: num(fields[23]),
    time_until: num(fields[24]),
    segment: str(fields[25]),
    change_from_entry_pct: num(fields[26]),
    long_term_profit: num(fields[27]),
    long_term_profit_pct: num(fields[28]),
  };
}

// ── Derived Fields ───────────────────────────────────────────────────────

function computeDerived(t: HollyTrade): Record<string, number | null> {
  // Hold minutes
  const entryMs = new Date(t.entry_time.replace(" ", "T") + "Z").getTime();
  const exitMs = new Date(t.exit_time.replace(" ", "T") + "Z").getTime();
  const holdMinutes = Number.isFinite(entryMs) && Number.isFinite(exitMs)
    ? (exitMs - entryMs) / 60000
    : null;

  // MFE / MAE
  const mfe = t.max_profit;
  const mae = t.min_profit;

  // Giveback
  const giveback = mfe != null ? mfe - (t.closed_profit ?? 0) : null;
  const givebackRatio = mfe != null && mfe > 0 && giveback != null
    ? giveback / mfe
    : null;

  // Time to MFE
  let timeToMfe: number | null = null;
  if (t.max_profit_time && Number.isFinite(entryMs)) {
    const mfeMs = new Date(t.max_profit_time.replace(" ", "T") + "Z").getTime();
    if (Number.isFinite(mfeMs)) timeToMfe = (mfeMs - entryMs) / 60000;
  }

  // Time to MAE
  let timeToMae: number | null = null;
  if (t.min_profit_time && Number.isFinite(entryMs)) {
    const maeMs = new Date(t.min_profit_time.replace(" ", "T") + "Z").getTime();
    if (Number.isFinite(maeMs)) timeToMae = (maeMs - entryMs) / 60000;
  }

  // R-multiple
  let rMultiple: number | null = null;
  if (t.stop_price != null && t.entry_price > 0 && t.closed_profit != null) {
    const risk = Math.abs(t.entry_price - t.stop_price);
    if (risk > 0) {
      rMultiple = t.closed_profit / (risk * (t.shares || 100));
    }
  }

  return {
    hold_minutes: holdMinutes != null ? Math.round(holdMinutes * 10) / 10 : null,
    mfe,
    mae,
    giveback: giveback != null ? Math.round(giveback * 100) / 100 : null,
    giveback_ratio: givebackRatio != null ? Math.round(givebackRatio * 1000) / 1000 : null,
    time_to_mfe_min: timeToMfe != null ? Math.round(timeToMfe * 10) / 10 : null,
    time_to_mae_min: timeToMae != null ? Math.round(timeToMae * 10) / 10 : null,
    r_multiple: rMultiple != null ? Math.round(rMultiple * 1000) / 1000 : null,
  };
}

// ── Bulk Importer ────────────────────────────────────────────────────────

/**
 * Import Holly trades from the Trade Ideas CSV export.
 * Parses the non-standard CSV format, computes derived metrics,
 * and bulk-inserts into holly_trades table.
 */
export function importHollyTrades(csvContent: string, batchId?: string): TradeImportResult {
  ensureHollyTradesTable();

  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length <= 1) return { total_rows: 0, imported: 0, skipped: 0, errors: 0, error_samples: [] };

  // Skip header (first line)
  const dataLines = lines.slice(1);
  const batch = batchId ?? new Date().toISOString();

  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO holly_trades (
      entry_time, exit_time, symbol, shares, entry_price, last_price,
      change_from_entry, change_from_close, change_from_close_pct,
      strategy, exit_price, closed_profit,
      profit_change_15, profit_change_5, max_profit,
      profit_basis_points, open_profit, stop_price,
      time_stop, max_profit_time, distance_from_max_profit,
      min_profit, min_profit_time, distance_from_stop,
      smart_stop, pct_to_stop, time_until,
      segment, change_from_entry_pct, long_term_profit, long_term_profit_pct,
      hold_minutes, mfe, mae, giveback, giveback_ratio,
      time_to_mfe_min, time_to_mae_min, r_multiple,
      import_batch
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?
    )
  `);

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const errorSamples: string[] = [];

  const insertMany = db.transaction(() => {
    for (const line of dataLines) {
      try {
        const trade = parseRow(line);
        if (!trade) {
          errors++;
          if (errorSamples.length < 5) errorSamples.push(line.slice(0, 120));
          continue;
        }

        const derived = computeDerived(trade);

        const result = insert.run(
          trade.entry_time, trade.exit_time, trade.symbol, trade.shares,
          trade.entry_price, trade.last_price,
          trade.change_from_entry, trade.change_from_close, trade.change_from_close_pct,
          trade.strategy, trade.exit_price, trade.closed_profit,
          trade.profit_change_15, trade.profit_change_5, trade.max_profit,
          trade.profit_basis_points, trade.open_profit, trade.stop_price,
          trade.time_stop, trade.max_profit_time, trade.distance_from_max_profit,
          trade.min_profit, trade.min_profit_time, trade.distance_from_stop,
          trade.smart_stop, trade.pct_to_stop, trade.time_until,
          trade.segment, trade.change_from_entry_pct, trade.long_term_profit,
          trade.long_term_profit_pct,
          derived.hold_minutes, derived.mfe, derived.mae,
          derived.giveback, derived.giveback_ratio,
          derived.time_to_mfe_min, derived.time_to_mae_min, derived.r_multiple,
          batch,
        );

        if (result.changes > 0) imported++;
        else skipped++;
      } catch (err) {
        errors++;
        if (errorSamples.length < 5) errorSamples.push(line.slice(0, 120));
      }
    }
  });

  insertMany();

  log.info({ total: dataLines.length, imported, skipped, errors }, "Holly trades imported");
  return { total_rows: dataLines.length, imported, skipped, errors, error_samples: errorSamples };
}

/**
 * Import Holly trades from a file path.
 */
export function importHollyTradesFromFile(filePath: string, batchId?: string): TradeImportResult {
  const fs = require("node:fs");
  const content = fs.readFileSync(filePath, "utf-8");
  // Strip BOM if present
  const clean = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
  return importHollyTrades(clean, batchId);
}

// ── Query helpers ────────────────────────────────────────────────────────

export function getHollyTradeStats(): Record<string, unknown> {
  ensureHollyTradesTable();
  const db = getDb();
  return db.prepare(`
    SELECT
      COUNT(*) as total_trades,
      COUNT(DISTINCT symbol) as unique_symbols,
      COUNT(DISTINCT strategy) as unique_strategies,
      COUNT(DISTINCT segment) as unique_segments,
      MIN(entry_time) as earliest_trade,
      MAX(entry_time) as latest_trade,
      ROUND(AVG(hold_minutes), 1) as avg_hold_minutes,
      ROUND(AVG(closed_profit), 2) as avg_closed_profit,
      ROUND(SUM(closed_profit), 2) as total_closed_profit,
      ROUND(AVG(CASE WHEN closed_profit > 0 THEN 1.0 ELSE 0.0 END) * 100, 1) as win_rate_pct,
      ROUND(AVG(giveback), 2) as avg_giveback,
      ROUND(AVG(giveback_ratio), 3) as avg_giveback_ratio,
      ROUND(AVG(time_to_mfe_min), 1) as avg_time_to_mfe_min,
      ROUND(AVG(r_multiple), 3) as avg_r_multiple
    FROM holly_trades
  `).get() as Record<string, unknown>;
}

export function queryHollyTrades(opts: {
  symbol?: string;
  strategy?: string;
  segment?: string;
  since?: string;
  until?: string;
  limit?: number;
}): Array<Record<string, unknown>> {
  ensureHollyTradesTable();
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.symbol) { conditions.push("symbol = ?"); params.push(opts.symbol.toUpperCase()); }
  if (opts.strategy) { conditions.push("strategy = ?"); params.push(opts.strategy); }
  if (opts.segment) { conditions.push("segment = ?"); params.push(opts.segment); }
  if (opts.since) { conditions.push("entry_time >= ?"); params.push(opts.since); }
  if (opts.until) { conditions.push("entry_time <= ?"); params.push(opts.until); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(opts.limit ?? 100, 1000);

  return db.prepare(`SELECT * FROM holly_trades ${where} ORDER BY entry_time DESC LIMIT ?`).all(...params, limit) as Array<Record<string, unknown>>;
}
