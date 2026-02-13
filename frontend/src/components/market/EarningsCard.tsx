"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useEarnings } from "@/lib/hooks/use-market";
import { TrendingUp } from "lucide-react";

interface EarningsCardProps {
  symbol: string | null;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: {
      quarter: string;
      actual: number | null;
      estimate: number | null;
      beat: boolean;
      surprise: number;
    };
  }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (active && payload && payload.length > 0) {
    const data = payload[0].payload;
    const beatColor = data.beat ? "text-emerald-400" : "text-red-400";

    return (
      <div className="rounded-lg border border-border bg-background p-3 shadow-lg">
        <p className="font-semibold text-foreground">{data.quarter}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Actual: <span className="font-mono">${data.actual?.toFixed(2) ?? "N/A"}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Estimate: <span className="font-mono">${data.estimate?.toFixed(2) ?? "N/A"}</span>
        </p>
        <p className={`mt-1 font-mono text-sm ${beatColor}`}>
          {data.beat ? "Beat" : "Miss"} by ${Math.abs(data.surprise).toFixed(2)}
        </p>
      </div>
    );
  }
  return null;
}

export function EarningsCard({ symbol }: EarningsCardProps) {
  const { data, isLoading, error } = useEarnings(symbol);

  if (!symbol) {
    return null;
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Earnings History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Failed to load earnings: {error.message}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Earnings History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.earningsChart.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Earnings History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center">
            <p className="text-sm text-muted-foreground">No earnings data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Prepare chart data with beat/miss indicators
  const chartData = data.earningsChart
    .map((q) => {
      if (q.actual === null || q.estimate === null) return null;
      const surprise = q.actual - q.estimate;
      const beat = surprise >= 0;
      return {
        quarter: q.quarter,
        actual: q.actual,
        estimate: q.estimate,
        surprise,
        beat,
      };
    })
    .filter(Boolean)
    .reverse(); // Show most recent on the right

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Earnings History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Insufficient earnings data (need both actual and estimate)
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate beats and misses
  const beats = chartData.filter((d) => d?.beat).length;
  const misses = chartData.length - beats;
  const beatRate = ((beats / chartData.length) * 100).toFixed(0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Earnings History
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Quarterly EPS: {beats} beats, {misses} misses ({beatRate}% beat rate)
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="quarter"
              stroke="#888"
              tick={{ fill: "#888", fontSize: 12 }}
            />
            <YAxis
              label={{ value: "EPS ($)", angle: -90, position: "insideLeft", fill: "#888" }}
              stroke="#888"
              tick={{ fill: "#888", fontSize: 12 }}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
            <Bar dataKey="actual" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry?.beat ? "#10b981" : "#ef4444"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* Recent earnings table */}
        <div className="mt-4 rounded-lg border border-border">
          <div className="grid grid-cols-4 gap-2 border-b border-border bg-muted/50 p-3 text-sm font-medium text-muted-foreground">
            <div>Quarter</div>
            <div className="text-right">Actual</div>
            <div className="text-right">Estimate</div>
            <div className="text-right">Surprise</div>
          </div>
          {chartData.slice(-4).reverse().map((q, idx) => {
            const beatColor = q?.beat ? "text-emerald-400" : "text-red-400";
            return (
              <div
                key={idx}
                className="grid grid-cols-4 gap-2 border-b border-border p-3 text-sm last:border-b-0"
              >
                <div className="text-foreground">{q?.quarter}</div>
                <div className="font-mono text-right text-foreground">
                  ${q?.actual?.toFixed(2)}
                </div>
                <div className="font-mono text-right text-muted-foreground">
                  ${q?.estimate?.toFixed(2)}
                </div>
                <div className={`font-mono text-right ${beatColor}`}>
                  {q?.surprise && q.surprise >= 0 ? "+" : ""}
                  ${q?.surprise?.toFixed(2)}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
