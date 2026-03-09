/**
 * Drift alerts domain module.
 */

import type { Database as DatabaseType } from "better-sqlite3";
import { getDb, getStmts } from "./connection.js";
const stmts = getStmts();

// ── Types ────────────────────────────────────────────────────────────────

export interface DriftAlertRow {
  id: number;
  alert_type: string;
  model_id: string | null;
  metric_value: number;
  threshold: number;
  message: string;
  timestamp: string;
  created_at: string;
}

// ── Functions ────────────────────────────────────────────────────────────

/**
 * Insert a drift alert with deduplication.
 * Skips insert if same alert_type+model_id exists within last hour.
 */
export function insertDriftAlert(
  alert: {
    alert_type: string;
    model_id: string | null;
    metric_value: number;
    threshold: number;
    message: string;
    timestamp: string;
  },
  database: DatabaseType = getDb()
): void {
  // Check for recent duplicate (within 1 hour)
  const cutoffTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const existing = stmts.checkRecentDriftAlert.get({
    alert_type: alert.alert_type,
    model_id: alert.model_id,
    cutoff_time: cutoffTime,
  });

  if (existing) {
    // Skip — same alert type+model within 1 hour
    return;
  }

  // Insert new alert
  stmts.insertDriftAlert.run({
    alert_type: alert.alert_type,
    model_id: alert.model_id,
    metric_value: alert.metric_value,
    threshold: alert.threshold,
    message: alert.message,
    timestamp: alert.timestamp,
  });
}

/**
 * Get recent drift alerts from database.
 */
export function getRecentDriftAlerts(limit: number = 50): DriftAlertRow[] {
  return stmts.getRecentDriftAlerts.all(limit) as DriftAlertRow[];
}
