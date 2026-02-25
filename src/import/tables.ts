/**
 * Import Pipeline — Additional DB Tables
 *
 * Tables for data types beyond TraderSync/Holly that the import pipeline supports.
 * Called once at module load to ensure tables exist.
 */

import { getDb } from "../db/database.js";

export function ensureImportTables(): void {
  const db = getDb();

  // ── Watchlists ──────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      list_name TEXT NOT NULL DEFAULT 'default',
      notes TEXT,
      source TEXT,               -- e.g. "import", "mcp", "manual", "screener"
      import_batch TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(symbol, list_name)
    );
    CREATE INDEX IF NOT EXISTS idx_watchlists_symbol ON watchlists(symbol);
    CREATE INDEX IF NOT EXISTS idx_watchlists_list ON watchlists(list_name);
  `);

  // ── Screener Snapshots ──────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS screener_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      screener_id TEXT,          -- e.g. "day_gainers", "most_actives", custom name
      price REAL,
      change_pct REAL,
      volume INTEGER,
      market_cap REAL,
      relative_volume REAL,
      extra TEXT,                -- JSON for any additional fields
      import_batch TEXT,
      captured_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_screener_snap_symbol ON screener_snapshots(symbol);
    CREATE INDEX IF NOT EXISTS idx_screener_snap_screener ON screener_snapshots(screener_id);
    CREATE INDEX IF NOT EXISTS idx_screener_snap_captured ON screener_snapshots(captured_at);
  `);

  // ── Generic Imported Data ───────────────────────────────────────────────
  // Catch-all for arbitrary structured data from MCP tools, APIs, webhooks.
  // Stores the full payload as JSON with optional type/source tagging.
  db.exec(`
    CREATE TABLE IF NOT EXISTS imported_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_type TEXT NOT NULL DEFAULT 'generic', -- e.g. "mcp_response", "api_result", "webhook", "generic"
      source TEXT,                               -- e.g. "ibkr", "yahoo", "tradingview", "custom"
      symbol TEXT,                               -- optional, for symbol-linked data
      payload TEXT NOT NULL,                     -- JSON blob
      tags TEXT,                                 -- JSON array of tags for filtering
      import_batch TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_imported_data_type ON imported_data(data_type);
    CREATE INDEX IF NOT EXISTS idx_imported_data_source ON imported_data(source);
    CREATE INDEX IF NOT EXISTS idx_imported_data_symbol ON imported_data(symbol);
    CREATE INDEX IF NOT EXISTS idx_imported_data_created ON imported_data(created_at);
  `);
}

// Initialize on module load
ensureImportTables();
