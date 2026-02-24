/**
 * Import History — tracks all file imports for audit and status queries.
 */

import { getDb } from "../db/database.js";

// ── Schema ────────────────────────────────────────────────────────────────

export function ensureImportHistoryTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS import_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      format TEXT NOT NULL,
      confidence REAL,
      detection_reason TEXT,
      status TEXT NOT NULL DEFAULT 'processing',
      inserted INTEGER DEFAULT 0,
      skipped INTEGER DEFAULT 0,
      errors TEXT DEFAULT '[]',
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_import_history_id ON import_history(import_id);
    CREATE INDEX IF NOT EXISTS idx_import_history_status ON import_history(status);
    CREATE INDEX IF NOT EXISTS idx_import_history_created ON import_history(created_at);
  `);
}

// Initialize table on module load
ensureImportHistoryTable();

// ── Insert / Update ───────────────────────────────────────────────────────

export function insertImportRecord(record: {
  import_id: string;
  file_name: string;
  format: string;
  confidence: number;
  detection_reason: string;
  status: string;
  inserted: number;
  skipped: number;
  errors: string;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO import_history (import_id, file_name, format, confidence, detection_reason, status, inserted, skipped, errors)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.import_id, record.file_name, record.format, record.confidence,
    record.detection_reason, record.status, record.inserted, record.skipped, record.errors,
  );
}

export function updateImportRecord(importId: string, updates: {
  status?: string;
  inserted?: number;
  skipped?: number;
  errors?: string;
  duration_ms?: number;
}): void {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) { sets.push("status = ?"); params.push(updates.status); }
  if (updates.inserted !== undefined) { sets.push("inserted = ?"); params.push(updates.inserted); }
  if (updates.skipped !== undefined) { sets.push("skipped = ?"); params.push(updates.skipped); }
  if (updates.errors !== undefined) { sets.push("errors = ?"); params.push(updates.errors); }
  if (updates.duration_ms !== undefined) { sets.push("duration_ms = ?"); params.push(updates.duration_ms); }

  if (sets.length === 0) return;
  params.push(importId);

  db.prepare(`UPDATE import_history SET ${sets.join(", ")} WHERE import_id = ?`).run(...params);
}

// ── Queries ───────────────────────────────────────────────────────────────

export function getImportHistory(opts: {
  limit?: number;
  status?: string;
  format?: string;
} = {}): Array<Record<string, unknown>> {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.status) { conditions.push("status = ?"); params.push(opts.status); }
  if (opts.format) { conditions.push("format = ?"); params.push(opts.format); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(opts.limit ?? 50, 500);

  return db.prepare(`
    SELECT * FROM import_history ${where} ORDER BY created_at DESC LIMIT ?
  `).all(...params, limit) as Array<Record<string, unknown>>;
}

export function getImportById(importId: string): Record<string, unknown> | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM import_history WHERE import_id = ?`).get(importId) as Record<string, unknown> | undefined;
}

export function getImportStats(): Record<string, unknown> {
  const db = getDb();
  return db.prepare(`
    SELECT
      COUNT(*) as total_imports,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(inserted) as total_inserted,
      SUM(skipped) as total_skipped,
      COUNT(DISTINCT format) as formats_seen,
      MIN(created_at) as first_import,
      MAX(created_at) as last_import,
      ROUND(AVG(duration_ms), 0) as avg_duration_ms
    FROM import_history
  `).get() as Record<string, unknown>;
}
