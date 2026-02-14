"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCalibration } from "@/lib/hooks/use-evals";
import { modelColor } from "@/lib/utils/colors";

interface CalibrationPoint {
  midpoint: number;
  claude?: number | null;
  gpt?: number | null;
  gemini?: number | null;
  perfect?: number;
}

interface CalibrationTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
}

function CalibrationTooltip({ active, payload, label }: CalibrationTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      <p className="mb-2 font-semibold text-foreground">
        Score: {label}-{(label ?? 0) + 10}
      </p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-sm" style={{ color: entry.color }}>
          {entry.name}: {(entry.value * 100).toFixed(1)}%
        </p>
      ))}
    </div>
  );
}

export function CalibrationCurve() {
  const { data, isLoading, isError } = useCalibration();

  const calibrationData = useMemo<CalibrationPoint[]>(() => {
    if (!data?.calibration) return [];

    // Create 10 buckets (0-10, 10-20, ..., 90-100)
    const points: CalibrationPoint[] = Array.from({ length: 10 }, (_, i) => ({
      midpoint: i * 10 + 5,
      perfect: (i * 10 + 5) / 100, // Perfect calibration diagonal
    }));

    // Add model data to corresponding buckets
    for (const model of data.calibration) {
      const modelKey =
        model.model_id.includes("claude") ? "claude" :
        model.model_id.includes("gpt") ? "gpt" :
        model.model_id.includes("gemini") ? "gemini" : null;

      if (!modelKey) continue;

      for (const bucket of model.buckets) {
        const bucketIndex = Math.floor(bucket.midpoint / 10);
        if (bucketIndex >= 0 && bucketIndex < 10) {
          points[bucketIndex][modelKey] = bucket.actual_win_rate;
        }
      }
    }

    return points;
  }, [data?.calibration]);

  const hasData = calibrationData.length > 0 && data?.calibration && data.calibration.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calibration Curve</CardTitle>
        <p className="text-sm text-muted-foreground">
          Model confidence vs actual win rate
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading calibration data…</p>
        ) : isError ? (
          <p className="text-sm text-red-400">Failed to load calibration data.</p>
        ) : !hasData ? (
          <p className="text-sm text-muted-foreground">
            Insufficient outcome data for calibration analysis.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={calibrationData} margin={{ top: 16, right: 16, left: 4, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="midpoint"
                type="number"
                domain={[0, 100]}
                ticks={[5, 15, 25, 35, 45, 55, 65, 75, 85, 95]}
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Score bucket midpoint", position: "insideBottom", offset: -6 }}
              />
              <YAxis
                type="number"
                domain={[0, 1]}
                tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Actual win rate", angle: -90, position: "insideLeft" }}
              />
              <Tooltip content={<CalibrationTooltip />} />
              <Legend 
                wrapperStyle={{ paddingTop: "16px" }}
                iconType="line"
              />
              {/* Perfect calibration diagonal */}
              <Line
                type="linear"
                dataKey="perfect"
                name="Perfect"
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                strokeWidth={1}
                dot={false}
              />
              {/* Model lines */}
              <Line
                type="monotone"
                dataKey="claude"
                name="Claude"
                stroke={modelColor("claude-sonnet")}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="gpt"
                name="GPT-4o"
                stroke={modelColor("gpt-4o")}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="gemini"
                name="Gemini"
                stroke={modelColor("gemini-flash")}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
