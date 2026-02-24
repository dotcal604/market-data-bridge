/**
 * Data Type Importers
 *
 * Import functions for each supported data type beyond TraderSync/Holly.
 * Each returns a standard { inserted, skipped, errors } result.
 */

import { randomUUID } from "crypto";
import { getDb } from "../db/database.js";
import { insertJournalEntry } from "../db/database.js";
import { insertOutcome } from "../db/database.js";
import "./tables.js"; // ensure tables exist

export interface ImportResult {
  inserted: number;
  skipped: number;
  errors: string[];
}

// ── Watchlist Importer ────────────────────────────────────────────────────

export function importWatchlist(
  items: Array<{ symbol: string; notes?: string; list_name?: string; source?: string }>,
  batchId?: string,
): ImportResult {
  const db = getDb();
  const batch = batchId ?? randomUUID().slice(0, 12);
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO watchlists (symbol, list_name, notes, source, import_batch)
    VALUES (?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (let i = 0; i < items.length; i++) {
      try {
        const item = items[i];
        const symbol = item.symbol?.trim().toUpperCase();
        if (!symbol) { errors.push(`Item ${i + 1}: missing symbol`); continue; }

        const result = stmt.run(
          symbol,
          item.list_name ?? "default",
          item.notes ?? null,
          item.source ?? "import",
          batch,
        );
        if (result.changes > 0) inserted++;
        else skipped++;
      } catch (e: any) {
        errors.push(`Item ${i + 1}: ${e.message}`);
      }
    }
  });
  tx();

  return { inserted, skipped, errors };
}

/**
 * Import a simple symbol list (one symbol per line, or comma-separated).
 */
export function importSymbolList(content: string, listName?: string, batchId?: string): ImportResult {
  // Split by newlines, commas, semicolons, or whitespace
  const symbols = content
    .split(/[\n\r,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0 && s.length <= 20 && /^[A-Z0-9.\-^]+$/.test(s));

  const items = symbols.map((symbol) => ({ symbol, list_name: listName ?? "default" }));
  return importWatchlist(items, batchId);
}

// ── Journal Entry Importer ────────────────────────────────────────────────

export function importJournalEntries(
  entries: Array<Record<string, unknown>>,
): ImportResult {
  let inserted = 0;
  const errors: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    try {
      const e = entries[i];
      if (!e.reasoning || typeof e.reasoning !== "string") {
        errors.push(`Entry ${i + 1}: missing 'reasoning' field`);
        continue;
      }
      insertJournalEntry({
        symbol: typeof e.symbol === "string" ? e.symbol : undefined,
        strategy_version: typeof e.strategy_version === "string" ? e.strategy_version : undefined,
        reasoning: e.reasoning,
        ai_recommendations: typeof e.ai_recommendations === "string" ? e.ai_recommendations : undefined,
        tags: Array.isArray(e.tags) ? e.tags : undefined,
        confidence_rating: typeof e.confidence_rating === "number" ? e.confidence_rating : undefined,
        rule_followed: typeof e.rule_followed === "boolean" ? e.rule_followed : undefined,
        setup_type: typeof e.setup_type === "string" ? e.setup_type : undefined,
        spy_price: typeof e.spy_price === "number" ? e.spy_price : undefined,
        vix_level: typeof e.vix_level === "number" ? e.vix_level : undefined,
        gap_pct: typeof e.gap_pct === "number" ? e.gap_pct : undefined,
        relative_volume: typeof e.relative_volume === "number" ? e.relative_volume : undefined,
        time_of_day: typeof e.time_of_day === "string" ? e.time_of_day : undefined,
        session_type: typeof e.session_type === "string" ? e.session_type : undefined,
        spread_pct: typeof e.spread_pct === "number" ? e.spread_pct : undefined,
      });
      inserted++;
    } catch (e: any) {
      errors.push(`Entry ${i + 1}: ${e.message}`);
    }
  }

  return { inserted, skipped: 0, errors };
}

// ── Eval Outcome Importer ─────────────────────────────────────────────────

export function importEvalOutcomes(
  outcomes: Array<Record<string, unknown>>,
): ImportResult {
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < outcomes.length; i++) {
    try {
      const o = outcomes[i];
      const evaluationId = o.evaluation_id;
      if (!evaluationId || typeof evaluationId !== "string") {
        errors.push(`Outcome ${i + 1}: missing evaluation_id`);
        continue;
      }

      try {
        insertOutcome({
          evaluation_id: evaluationId,
          trade_taken: typeof o.trade_taken === "boolean" ? o.trade_taken : o.trade_taken === 1 || o.trade_taken === "true",
          actual_entry_price: typeof o.actual_entry_price === "number" ? o.actual_entry_price : undefined,
          actual_exit_price: typeof o.actual_exit_price === "number" ? o.actual_exit_price : undefined,
          r_multiple: typeof o.r_multiple === "number" ? o.r_multiple : undefined,
          exit_reason: typeof o.exit_reason === "string" ? o.exit_reason : undefined,
        });
        inserted++;
      } catch (e: any) {
        if (e.message?.includes("UNIQUE constraint")) {
          skipped++;
        } else {
          errors.push(`Outcome ${i + 1}: ${e.message}`);
        }
      }
    } catch (e: any) {
      errors.push(`Outcome ${i + 1}: ${e.message}`);
    }
  }

  return { inserted, skipped, errors };
}

// ── Screener Snapshot Importer ────────────────────────────────────────────

export function importScreenerSnapshots(
  snapshots: Array<Record<string, unknown>>,
  screenerId?: string,
  batchId?: string,
): ImportResult {
  const db = getDb();
  const batch = batchId ?? randomUUID().slice(0, 12);
  let inserted = 0;
  const errors: string[] = [];

  const stmt = db.prepare(`
    INSERT INTO screener_snapshots (symbol, screener_id, price, change_pct, volume, market_cap, relative_volume, extra, import_batch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (let i = 0; i < snapshots.length; i++) {
      try {
        const s = snapshots[i];
        const symbol = (typeof s.symbol === "string" ? s.symbol : "").trim().toUpperCase();
        if (!symbol) { errors.push(`Snapshot ${i + 1}: missing symbol`); continue; }

        // Collect extra fields beyond known ones
        const knownKeys = new Set(["symbol", "screener_id", "price", "change_pct", "volume", "market_cap", "relative_volume"]);
        const extra: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(s)) {
          if (!knownKeys.has(k) && v != null) extra[k] = v;
        }

        stmt.run(
          symbol,
          (typeof s.screener_id === "string" ? s.screener_id : screenerId) ?? null,
          typeof s.price === "number" ? s.price : null,
          typeof s.change_pct === "number" ? s.change_pct : null,
          typeof s.volume === "number" ? s.volume : null,
          typeof s.market_cap === "number" ? s.market_cap : null,
          typeof s.relative_volume === "number" ? s.relative_volume : null,
          Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
          batch,
        );
        inserted++;
      } catch (e: any) {
        errors.push(`Snapshot ${i + 1}: ${e.message}`);
      }
    }
  });
  tx();

  return { inserted, skipped: 0, errors };
}

// ── Generic Data Importer ─────────────────────────────────────────────────

export function importGenericData(
  items: Array<Record<string, unknown>>,
  dataType?: string,
  source?: string,
  batchId?: string,
): ImportResult {
  const db = getDb();
  const batch = batchId ?? randomUUID().slice(0, 12);
  let inserted = 0;
  const errors: string[] = [];

  const stmt = db.prepare(`
    INSERT INTO imported_data (data_type, source, symbol, payload, tags, import_batch)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (let i = 0; i < items.length; i++) {
      try {
        const item = items[i];
        const symbol = typeof item.symbol === "string" ? item.symbol.trim().toUpperCase() : null;
        const tags = Array.isArray(item._tags) ? JSON.stringify(item._tags) : null;
        const type = typeof item._type === "string" ? item._type : (dataType ?? "generic");
        const src = typeof item._source === "string" ? item._source : (source ?? null);

        stmt.run(type, src, symbol, JSON.stringify(item), tags, batch);
        inserted++;
      } catch (e: any) {
        errors.push(`Item ${i + 1}: ${e.message}`);
      }
    }
  });
  tx();

  return { inserted, skipped: 0, errors };
}
