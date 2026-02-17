import { getDb, insertDriftAlert, getRecentDriftAlerts as dbGetRecentDriftAlerts } from "../db/database.js";
import { config } from "../config.js";
import { appendInboxItem } from "../inbox/store.js";
import type { DriftReport } from "./drift.js";

export interface DriftAlert {
  id?: number;
  alert_type: "accuracy_low" | "calibration_high" | "regime_shift";
  model_id: string | null;
  metric_value: number;
  threshold: number;
  message: string;
  timestamp: string;
  created_at?: string;
}

/**
 * Check drift report against configured thresholds and return alerts.
 * Deduplicates same alert type within 1 hour for each model.
 */
export function checkDriftAlerts(report: DriftReport): DriftAlert[] {
  if (!config.drift.enabled) {
    return [];
  }

  const alerts: DriftAlert[] = [];
  const timestamp = new Date().toISOString();

  // Check overall accuracy
  if (report.overall_accuracy < config.drift.accuracyThreshold) {
    alerts.push({
      alert_type: "accuracy_low",
      model_id: null,
      metric_value: report.overall_accuracy,
      threshold: config.drift.accuracyThreshold,
      message: `Overall model accuracy ${(report.overall_accuracy * 100).toFixed(1)}% is below threshold ${(config.drift.accuracyThreshold * 100).toFixed(1)}%`,
      timestamp,
    });
  }

  // Check per-model metrics
  for (const model of report.by_model) {
    // Check rolling accuracy (use last_20 as the key metric)
    if (model.rolling_accuracy.last_20 < config.drift.accuracyThreshold) {
      alerts.push({
        alert_type: "accuracy_low",
        model_id: model.model_id,
        metric_value: model.rolling_accuracy.last_20,
        threshold: config.drift.accuracyThreshold,
        message: `Model ${model.model_id} accuracy ${(model.rolling_accuracy.last_20 * 100).toFixed(1)}% (last 20) is below threshold ${(config.drift.accuracyThreshold * 100).toFixed(1)}%`,
        timestamp,
      });
    }

    // Check calibration error
    if (model.calibration_error > config.drift.calibrationThreshold) {
      alerts.push({
        alert_type: "calibration_high",
        model_id: model.model_id,
        metric_value: model.calibration_error,
        threshold: config.drift.calibrationThreshold,
        message: `Model ${model.model_id} calibration error ${(model.calibration_error * 100).toFixed(1)}% is above threshold ${(config.drift.calibrationThreshold * 100).toFixed(1)}%`,
        timestamp,
      });
    }

    // Check regime shift
    if (model.regime_shift_detected) {
      alerts.push({
        alert_type: "regime_shift",
        model_id: model.model_id,
        metric_value: model.rolling_accuracy.last_50 - model.rolling_accuracy.last_10,
        threshold: 0.15,
        message: `Model ${model.model_id} regime shift detected (last_50=${(model.rolling_accuracy.last_50 * 100).toFixed(1)}%, last_10=${(model.rolling_accuracy.last_10 * 100).toFixed(1)}%)`,
        timestamp,
      });
    }
  }

  // Store alerts with deduplication (skip if same type+model within 1 hour)
  const db = getDb();
  for (const alert of alerts) {
    insertDriftAlert(alert, db);

    // Inbox: notify on drift alerts
    try {
      appendInboxItem({
        type: "drift_alert",
        title: `Drift: ${alert.alert_type}` + (alert.model_id ? ` (${alert.model_id})` : ""),
        body: {
          alert_type: alert.alert_type,
          model_id: alert.model_id,
          metric_value: alert.metric_value,
          threshold: alert.threshold,
          message: alert.message,
        },
      });
    } catch { /* non-fatal */ }
  }

  return alerts;
}

/**
 * Get recent drift alerts from database.
 */
export function getRecentDriftAlerts(limit: number = 50): DriftAlert[] {
  const rows = dbGetRecentDriftAlerts(limit);
  return rows.map((row) => ({
    id: row.id,
    alert_type: row.alert_type as "accuracy_low" | "calibration_high" | "regime_shift",
    model_id: row.model_id,
    metric_value: row.metric_value,
    threshold: row.threshold,
    message: row.message,
    timestamp: row.timestamp,
    created_at: row.created_at,
  }));
}
