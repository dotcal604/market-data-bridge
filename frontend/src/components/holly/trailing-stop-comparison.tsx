"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { TrailingStopSummary } from "@/lib/api/performance-client";

interface TrailingStopComparisonProps {
  summary: TrailingStopSummary[];
}

export function TrailingStopComparison({ summary }: TrailingStopComparisonProps) {
  if (summary.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No trailing stop data available.
      </div>
    );
  }

  // Take top 8 strategies by P/L improvement
  const topStrategies = [...summary]
    .sort((a, b) => b.pnl_improvement - a.pnl_improvement)
    .slice(0, 8);

  const chartData = topStrategies.map((s) => ({
    name: s.name.length > 20 ? s.name.substring(0, 20) + "..." : s.name,
    original: Math.round(s.total_pnl_original),
    optimized: Math.round(s.total_pnl_simulated),
    improvement: Math.round(s.pnl_improvement),
  }));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        Trailing Stop P/L Comparison
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Original Holly exits vs optimized trailing stops. Top 8 strategies by P/L improvement.
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={chartData} margin={{ top: 10, right: 20, left: 20, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            dataKey="name"
            tick={{ fill: "#888", fontSize: 10 }}
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis
            tick={{ fill: "#888", fontSize: 11 }}
            label={{
              value: "P/L ($)",
              angle: -90,
              position: "insideLeft",
              fill: "#666",
              fontSize: 11,
            }}
          />
          <Tooltip
            contentStyle={{
              background: "#1a1a2e",
              border: "1px solid #333",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => [`$${Number(value).toFixed(0)}`, ""]}
            labelFormatter={(label) => `Strategy: ${label}`}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 10 }}
            formatter={(value) => <span style={{ color: "#888" }}>{value}</span>}
          />
          <Bar dataKey="original" fill="#f59e0b" name="Original Holly" />
          <Bar dataKey="optimized" fill="#10b981" name="Optimized Trailing" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
