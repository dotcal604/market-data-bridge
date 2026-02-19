import Database, { type Database as DatabaseType } from "better-sqlite3";
import { getDb } from "../db/database.js";

interface DriftRow {
  model_id: string;
  timestamp: string;
  trade_score: number;
  should_trade: number | null;
  r_multiple: number;
}

interface DecileCalibration {
  decile: number;
  count: number;
  predicted_win_rate: number;
  actual_win_rate: number;
  abs_error: number;
}

interface ModelDriftReport {
  model_id: string;
  sample_size: number;
  rolling_accuracy: {
    last_50: number;
    last_20: number;
    last_10: number;
  };
  calibration_error: number;
  calibration_by_decile: DecileCalibration[];
  regime_shift_detected: boolean;
}

export interface DriftReport {
  overall_accuracy: number;
  by_model: ModelDriftReport[];
  regime_shift_detected: boolean;
  recommendation: string;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function detectEvalTable(db: DatabaseType): "evals" | "evaluations" {
  const evals = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='evals'").get();
  return evals ? "evals" : "evaluations";
}

function detectOutcomeTable(db: DatabaseType): "eval_outcomes" | "outcomes" {
  const evalOutcomes = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='eval_outcomes'").get();
  return evalOutcomes ? "eval_outcomes" : "outcomes";
}

function loadDriftRows(db: DatabaseType): DriftRow[] {
  const evalTable = detectEvalTable(db);
  const outcomeTable = detectOutcomeTable(db);

  return db.prepare(`
    SELECT
      m.model_id,
      e.timestamp,
      m.trade_score,
      m.should_trade,
      o.r_multiple
    FROM model_outputs m
    JOIN ${evalTable} e ON e.id = m.evaluation_id
    JOIN ${outcomeTable} o ON o.evaluation_id = e.id
    WHERE m.compliant = 1
      AND m.trade_score IS NOT NULL
      AND o.trade_taken = 1
      AND o.r_multiple IS NOT NULL
    ORDER BY e.timestamp DESC
  `).all() as DriftRow[];
}

function computeAccuracy(rows: readonly DriftRow[], window: number): number {
  const sample = rows.slice(0, window);
  if (sample.length === 0) return 0;

  let correct = 0;
  for (const row of sample) {
    const predictedTrade = row.should_trade != null ? row.should_trade === 1 : row.trade_score >= 50;
    const actualWin = row.r_multiple > 0;
    if ((predictedTrade && actualWin) || (!predictedTrade && !actualWin)) {
      correct += 1;
    }
  }
  return correct / sample.length;
}

function computeCalibration(rows: readonly DriftRow[]): { error: number; buckets: DecileCalibration[] } {
  const buckets: DecileCalibration[] = [];
  let weightedError = 0;
  let totalCount = 0;

  for (let decile = 0; decile < 10; decile += 1) {
    const min = decile * 10;
    const max = decile === 9 ? 100 : (decile + 1) * 10;
    const inBucket = rows.filter((row) => row.trade_score >= min && row.trade_score < (decile === 9 ? 101 : max));

    const count = inBucket.length;
    const predicted = count > 0
      ? inBucket.reduce((sum, row) => sum + Math.min(1, Math.max(0, row.trade_score / 100)), 0) / count
      : 0;
    const actual = count > 0 ? inBucket.filter((row) => row.r_multiple > 0).length / count : 0;
    const absError = Math.abs(predicted - actual);

    weightedError += absError * count;
    totalCount += count;

    buckets.push({
      decile,
      count,
      predicted_win_rate: round3(predicted),
      actual_win_rate: round3(actual),
      abs_error: round3(absError),
    });
  }

  return {
    error: totalCount > 0 ? weightedError / totalCount : 0,
    buckets,
  };
}

/**
 * Analyze model performance drift using recent outcomes.
 * Computes accuracy, calibration error, and regime shift indicators.
 * @param db Database instance (optional)
 * @returns Drift report with per-model metrics
 */
export function computeDriftReport(db: DatabaseType = getDb()): DriftReport {
  const rows = loadDriftRows(db);
  if (rows.length === 0) {
    return {
      overall_accuracy: 0,
      by_model: [],
      regime_shift_detected: false,
      recommendation: "Insufficient outcome data for drift analysis.",
    };
  }

  const byModelMap = new Map<string, DriftRow[]>();
  for (const row of rows) {
    const existing = byModelMap.get(row.model_id) ?? [];
    existing.push(row);
    byModelMap.set(row.model_id, existing);
  }

  const byModel: ModelDriftReport[] = [];
  let anyRegimeShift = false;
  let totalCorrect = 0;
  let totalRows = 0;

  for (const [modelId, modelRows] of byModelMap.entries()) {
    const last50 = computeAccuracy(modelRows, 50);
    const last20 = computeAccuracy(modelRows, 20);
    const last10 = computeAccuracy(modelRows, 10);

    const calibration = computeCalibration(modelRows);
    const shift = modelRows.length >= 10 && (last50 - last10) > 0.15;

    if (shift) anyRegimeShift = true;

    const sampleCount = modelRows.length;
    totalRows += sampleCount;
    for (const row of modelRows) {
      const predictedTrade = row.should_trade != null ? row.should_trade === 1 : row.trade_score >= 50;
      const actualWin = row.r_multiple > 0;
      if ((predictedTrade && actualWin) || (!predictedTrade && !actualWin)) {
        totalCorrect += 1;
      }
    }

    byModel.push({
      model_id: modelId,
      sample_size: sampleCount,
      rolling_accuracy: {
        last_50: round3(last50),
        last_20: round3(last20),
        last_10: round3(last10),
      },
      calibration_error: round3(calibration.error),
      calibration_by_decile: calibration.buckets,
      regime_shift_detected: shift,
    });
  }

  byModel.sort((a, b) => a.model_id.localeCompare(b.model_id));

  const recommendation = anyRegimeShift
    ? "Regime shift detected. Reduce risk, review model weighting, and re-calibrate prompts before normal sizing."
    : "No major regime shift detected. Continue monitoring drift with each new outcome batch.";

  return {
    overall_accuracy: round3(totalRows > 0 ? totalCorrect / totalRows : 0),
    by_model: byModel,
    regime_shift_detected: anyRegimeShift,
    recommendation,
  };
}
