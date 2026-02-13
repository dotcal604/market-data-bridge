"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { evalClient } from "@/lib/api/eval-client";

interface CalibrationPoint {
  bucketLabel: string;
  midpoint: number;
  actualWinRate: number | null;
  sampleSize: number;
}

interface BucketAccumulator {
  lower: number;
  upper: number;
  wins: number;
  total: number;
}

interface CalibrationTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: CalibrationPoint }>;
}

function CalibrationTooltip({ active, payload }: CalibrationTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      <p className="font-semibold text-foreground">{point.bucketLabel}</p>
      <p className="text-sm text-muted-foreground">
        Actual win rate: {point.actualWinRate === null ? "N/A" : `${(point.actualWinRate * 100).toFixed(1)}%`}
      </p>
      <p className="text-sm text-muted-foreground">Sample size: {point.sampleSize}</p>
    </div>
  );
}

export function CalibrationCurve() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["eval-outcomes", 500],
    queryFn: () => evalClient.getOutcomes(500),
    refetchInterval: 30_000,
  });

  const calibrationData = useMemo<CalibrationPoint[]>(() => {
    const buckets: BucketAccumulator[] = Array.from({ length: 10 }, (_, index) => ({
      lower: index * 10,
      upper: index * 10 + 10,
      wins: 0,
      total: 0,
    }));

    for (const outcome of data?.outcomes ?? []) {
      const score = Math.max(0, Math.min(100, outcome.ensemble_trade_score));
      const bucketIndex = Math.min(9, Math.floor(score / 10));
      const bucket = buckets[bucketIndex];

      if (!bucket) {
        continue;
      }

      bucket.total += 1;

      const isWin = (outcome.r_multiple ?? 0) > 0;
      if (isWin) {
        bucket.wins += 1;
      }
    }

    return buckets.map((bucket) => ({
      bucketLabel: `${bucket.lower}-${bucket.upper}`,
      midpoint: bucket.lower + 5,
      actualWinRate: bucket.total > 0 ? bucket.wins / bucket.total : null,
      sampleSize: bucket.total,
    }));
  }, [data?.outcomes]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calibration Curve</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading calibration data…</p>
        ) : isError ? (
          <p className="text-sm text-red-400">Failed to load outcomes for calibration.</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={calibrationData} margin={{ top: 16, right: 16, left: 4, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="midpoint"
                type="number"
                domain={[0, 100]}
                ticks={[5, 15, 25, 35, 45, 55, 65, 75, 85, 95]}
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Ensemble score bucket midpoint", position: "insideBottom", offset: -6 }}
              />
              <YAxis
                type="number"
                domain={[0, 1]}
                tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Actual win rate", angle: -90, position: "insideLeft" }}
              />
              <Tooltip content={<CalibrationTooltip />} />
              <ReferenceLine
                segment={[
                  { x: 0, y: 0 },
                  { x: 100, y: 1 },
                ]}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
              />
              <Line
                type="monotone"
                dataKey="actualWinRate"
                connectNulls={false}
                stroke="rgb(52 211 153)"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
