"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { modelColor } from "@/lib/utils/colors";
import type { EvalOutcome } from "@/lib/api/types";

interface CalibrationCurveProps {
  outcomes: EvalOutcome[];
}

interface BucketData {
  bucket: number; // midpoint (5, 15, 25, ..., 95)
  bucketLabel: string; // "0-10", "10-20", etc.
  count: number;
  wins: number;
  winRate: number; // 0-100
}

interface ModelCalibrationData {
  modelId: string;
  buckets: BucketData[];
}

interface ChartDataPoint {
  bucket: number;
  ensemble?: number;
  "claude-sonnet"?: number;
  "gpt-4o"?: number;
  "gemini-flash"?: number;
  ensembleCount?: number;
  claudeCount?: number;
  gptCount?: number;
  geminiCount?: number;
}

const MIN_SAMPLES = 5;

// Bucket confidence values (0-100) into 10% bins
function bucketConfidence(confidence: number): number {
  const pct = confidence * 100;
  const bucket = Math.floor(pct / 10) * 10;
  return Math.min(bucket, 90); // max bucket is 90-100
}

// Compute win rate for a bucket (r_multiple > 0 = win)
function computeCalibration(
  outcomes: Array<{ confidence: number; r_multiple: number | null }>,
  modelId: string,
): ModelCalibrationData {
  const bucketMap = new Map<number, { wins: number; total: number }>();

  for (const outcome of outcomes) {
    if (outcome.confidence == null || outcome.r_multiple == null) continue;
    const bucket = bucketConfidence(outcome.confidence);
    if (!bucketMap.has(bucket)) {
      bucketMap.set(bucket, { wins: 0, total: 0 });
    }
    const entry = bucketMap.get(bucket)!;
    entry.total += 1;
    if (outcome.r_multiple > 0) {
      entry.wins += 1;
    }
  }

  const buckets: BucketData[] = [];
  for (let bucket = 0; bucket < 100; bucket += 10) {
    const entry = bucketMap.get(bucket);
    if (entry && entry.total >= MIN_SAMPLES) {
      buckets.push({
        bucket: bucket + 5, // midpoint
        bucketLabel: `${bucket}-${bucket + 10}`,
        count: entry.total,
        wins: entry.wins,
        winRate: (entry.wins / entry.total) * 100,
      });
    }
  }

  return { modelId, buckets };
}

// Process outcomes to get calibration data for all models + ensemble
function processCalibrationData(outcomes: EvalOutcome[]): {
  chartData: ChartDataPoint[];
  hasData: boolean;
} {
  // Need to get model-level outcomes
  // For now, we'll use ensemble data from the outcomes
  // TODO: Need to modify backend to include model outputs in outcomes endpoint

  const ensembleData = outcomes
    .filter((o) => o.r_multiple != null && o.ensemble_confidence != null)
    .map((o) => ({
      confidence: o.ensemble_confidence,
      r_multiple: o.r_multiple,
    }));

  const ensembleCalibration = computeCalibration(ensembleData, "ensemble");

  // Convert to chart format
  const chartData: ChartDataPoint[] = [];
  for (const bucket of ensembleCalibration.buckets) {
    chartData.push({
      bucket: bucket.bucket,
      ensemble: bucket.winRate,
      ensembleCount: bucket.count,
    });
  }

  // Sort by bucket
  chartData.sort((a, b) => a.bucket - b.bucket);

  return {
    chartData,
    hasData: chartData.length > 0,
  };
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    value: number;
    payload: ChartDataPoint;
  }>;
  label?: number;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0].payload;
  const bucketStart = label != null ? label - 5 : 0;
  const bucketEnd = bucketStart + 10;

  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      <p className="font-semibold text-foreground">
        Confidence: {bucketStart}%-{bucketEnd}%
      </p>
      {payload.map((entry, idx) => {
        const modelName = entry.dataKey === "ensemble" ? "Ensemble" : entry.dataKey;
        const count =
          entry.dataKey === "ensemble"
            ? data.ensembleCount
            : entry.dataKey === "claude-sonnet"
              ? data.claudeCount
              : entry.dataKey === "gpt-4o"
                ? data.gptCount
                : data.geminiCount;

        return (
          <div key={idx}>
            <p className="text-sm" style={{ color: entry.dataKey === "ensemble" ? "#888" : modelColor(entry.dataKey) }}>
              {modelName}: {entry.value.toFixed(1)}%
            </p>
            {count != null && (
              <p className="text-xs text-muted-foreground">n={count}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CalibrationCurve({ outcomes }: CalibrationCurveProps) {
  const { chartData, hasData } = processCalibrationData(outcomes);

  if (!hasData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Calibration Curve</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[400px] items-center justify-center">
            <div className="text-center">
              <p className="text-lg font-medium text-muted-foreground">
                Insufficient data
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                At least {MIN_SAMPLES} outcomes per confidence bucket required
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calibration Curve</CardTitle>
        <p className="text-sm text-muted-foreground">
          Predicted confidence vs actual win rate — diagonal = perfect calibration
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground) / 0.2)" />
            <XAxis
              dataKey="bucket"
              type="number"
              domain={[0, 100]}
              ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
              label={{
                value: "Predicted Confidence (%)",
                position: "insideBottom",
                offset: -10,
              }}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            />
            <YAxis
              domain={[0, 100]}
              label={{
                value: "Actual Win Rate (%)",
                angle: -90,
                position: "insideLeft",
              }}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{
                paddingTop: "20px",
              }}
            />
            {/* Perfect calibration reference line */}
            <ReferenceLine
              segment={[
                { x: 0, y: 0 },
                { x: 100, y: 100 },
              ]}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="5 5"
              strokeWidth={2}
              label={{
                value: "Perfect",
                position: "insideTopRight",
                fill: "hsl(var(--muted-foreground))",
                fontSize: 11,
              }}
            />
            {/* Ensemble line */}
            <Line
              type="monotone"
              dataKey="ensemble"
              name="Ensemble"
              stroke="#888888"
              strokeWidth={3}
              dot={{ r: 6, fill: "#888888" }}
              activeDot={{ r: 8 }}
            />
            {/* Individual model lines (will be added when backend provides data) */}
            {/* <Line
              type="monotone"
              dataKey="claude-sonnet"
              name="Claude"
              stroke={modelColor("claude-sonnet")}
              strokeWidth={2}
              dot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="gpt-4o"
              name="GPT-4o"
              stroke={modelColor("gpt-4o")}
              strokeWidth={2}
              dot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="gemini-flash"
              name="Gemini"
              stroke={modelColor("gemini-flash")}
              strokeWidth={2}
              dot={{ r: 5 }}
            /> */}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
