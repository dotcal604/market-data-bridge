"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  ReferenceLine,
} from "recharts";
import type { RollingMetrics } from "@/lib/api/edge-client";

interface RollingMetricsChartProps {
  data: RollingMetrics[];
}

export function RollingMetricsChart({ data }: RollingMetricsChartProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        Not enough data for rolling metrics.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">Rolling Win Rate & Sharpe</h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            dataKey="cumulative_trades"
            tick={{ fill: "#888", fontSize: 11 }}
          />
          <YAxis yAxisId="left" tick={{ fill: "#888", fontSize: 11 }} domain={[0, 1]} />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: "#888", fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: 8, fontSize: 12 }}
            labelFormatter={(v) => `Trade #${v}`}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "#888" }} />
          <ReferenceLine yAxisId="left" y={0.5} stroke="#555" strokeDasharray="3 3" />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="rolling_win_rate"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
            name="Win Rate"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="rolling_sharpe"
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={false}
            name="Sharpe"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
