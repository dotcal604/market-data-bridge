/**
 * Drift reconciliation — detect when model predictions diverge from outcomes.
 *
 * Compares per-model confidence buckets against actual win rates.
 * Flags models where any bucket deviates > DRIFT_THRESHOLD from expected.
 */

import { getModelOutcomesForDrift } from "../db/database.js";

const DRIFT_THRESHOLD = 0.15; // 15% deviation triggers a flag
const MIN_OUTCOMES_PER_MODEL = 30;
const MIN_BUCKET_SIZE = 5; // need at least 5 trades in a bucket to evaluate

interface BucketResult {
  bucket: string;
  range: [number, number];
  count: number;
  wins: number;
  expected_win_rate: number;
  actual_win_rate: number;
  deviation: number;
  drifting: boolean;
}

interface ModelDriftReport {
  model_id: string;
  drifting: boolean;
  total_outcomes: number;
  buckets: BucketResult[];
  worst_bucket: string | null;
  worst_deviation: number;
}

export interface DriftReport {
  models: Record<string, ModelDriftReport>;
  sample_size: number;
  min_required: number;
  recommendation: string | null;
  generated_at: string;
}

const BUCKETS: Array<{ label: string; range: [number, number]; expected: number }> = [
  { label: "0-25", range: [0, 25], expected: 0.125 },    // midpoint / 100
  { label: "25-50", range: [25, 50], expected: 0.375 },
  { label: "50-75", range: [50, 75], expected: 0.625 },
  { label: "75-100", range: [75, 100], expected: 0.875 },
];

function computeModelDrift(
  rows: Array<{ confidence: number; r_multiple: number }>,
  modelId: string,
): ModelDriftReport {
  const buckets: BucketResult[] = [];
  let worstBucket: string | null = null;
  let worstDeviation = 0;
  let anyDrifting = false;

  for (const { label, range, expected } of BUCKETS) {
    const inBucket = rows.filter(
      (r) => r.confidence >= range[0] && r.confidence < (range[1] === 100 ? 101 : range[1]),
    );
    const count = inBucket.length;
    const wins = inBucket.filter((r) => r.r_multiple > 0).length;
    const actual = count > 0 ? wins / count : 0;
    const deviation = count >= MIN_BUCKET_SIZE ? Math.abs(actual - expected) : 0;
    const drifting = count >= MIN_BUCKET_SIZE && deviation > DRIFT_THRESHOLD;

    if (drifting) anyDrifting = true;
    if (deviation > worstDeviation && count >= MIN_BUCKET_SIZE) {
      worstDeviation = deviation;
      worstBucket = label;
    }

    buckets.push({
      bucket: label,
      range,
      count,
      wins,
      expected_win_rate: expected,
      actual_win_rate: Math.round(actual * 1000) / 1000,
      deviation: Math.round(deviation * 1000) / 1000,
      drifting,
    });
  }

  return {
    model_id: modelId,
    drifting: rows.length >= MIN_OUTCOMES_PER_MODEL && anyDrifting,
    total_outcomes: rows.length,
    buckets,
    worst_bucket: worstBucket,
    worst_deviation: Math.round(worstDeviation * 1000) / 1000,
  };
}

export function generateDriftReport(days: number = 90): DriftReport {
  const allRows = getModelOutcomesForDrift(days);

  // Group by model_id
  const byModel = new Map<string, Array<{ confidence: number; r_multiple: number }>>();
  for (const row of allRows) {
    const modelId = row.model_id as string;
    if (!byModel.has(modelId)) byModel.set(modelId, []);
    byModel.get(modelId)!.push({
      confidence: row.confidence as number,
      r_multiple: row.r_multiple as number,
    });
  }

  const models: Record<string, ModelDriftReport> = {};
  const driftingModels: string[] = [];

  for (const [modelId, rows] of byModel) {
    const report = computeModelDrift(rows, modelId);
    models[modelId] = report;
    if (report.drifting) driftingModels.push(modelId);
  }

  let recommendation: string | null = null;
  if (driftingModels.length > 0) {
    recommendation = `Consider recalibrating ${driftingModels.join(", ")} weights — confidence buckets deviate >15% from expected win rates`;
  }

  return {
    models,
    sample_size: allRows.length,
    min_required: MIN_OUTCOMES_PER_MODEL,
    recommendation,
    generated_at: new Date().toISOString(),
  };
}
