/**
 * Weight history and risk configuration domain module.
 */

import { getDb, runEvalInsert } from "./connection.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface WeightHistoryRow {
  id: number;
  weights_json: string;
  sample_size: number | null;
  reason: string | null;
  created_at: string;
}

export interface RiskConfigRow {
  param: string;
  value: number;
  source: string;
  updated_at: string;
}

// ── Functions ────────────────────────────────────────────────────────────

/**
 * Get all risk configuration rows.
 * @returns Array of RiskConfigRow
 */
export function getRiskConfigRows(): RiskConfigRow[] {
  return getDb().prepare(`
    SELECT param, value, source, updated_at
    FROM risk_config
    ORDER BY param ASC
  `).all() as RiskConfigRow[];
}

/**
 * Get a specific risk config value.
 * @param param Parameter name
 * @returns Value or null
 */
export function getRiskConfigValue(param: string): number | null {
  const row = getDb().prepare(`SELECT value FROM risk_config WHERE param = ? ORDER BY updated_at DESC LIMIT 1`).get(param) as { value: number } | undefined;
  return row?.value ?? null;
}

/**
 * Update or insert risk configuration parameters.
 * @param entries Array of config entries
 */
export function upsertRiskConfig(entries: Array<{ param: string; value: number; source?: string }>): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO risk_config (param, value, source, updated_at)
    VALUES (@param, @value, @source, datetime('now'))
    ON CONFLICT(param) DO UPDATE SET
      value = excluded.value,
      source = excluded.source,
      updated_at = datetime('now')
  `);

  const tx = db.transaction((rows: Array<{ param: string; value: number; source?: string }>) => {
    rows.forEach((row) => {
      stmt.run({ param: row.param, value: row.value, source: row.source ?? "manual" });
    });
  });

  tx(entries);
}

/**
 * Insert a weight history record.
 * @param weights - Object with claude, gpt4o, gemini, k, source, sample_size
 * @param reason - Description of why weights changed (e.g., "manual", "recalibration", "simulation")
 */
export function insertWeightHistory(weights: Record<string, unknown>, reason: string | null = null): void {
  const sample_size = (weights.sample_size as number) ?? null;
  runEvalInsert("weight_history", {
    weights_json: JSON.stringify(weights),
    sample_size,
    reason,
    created_at: new Date().toISOString(),
  });
}

/**
 * Get weight history records, most recent first.
 * @param limit - Number of records to return (default: 100)
 */
export function getWeightHistory(limit: number = 100): WeightHistoryRow[] {
  return getDb().prepare(`
    SELECT id, weights_json, sample_size, reason, created_at
    FROM weight_history
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as WeightHistoryRow[];
}
