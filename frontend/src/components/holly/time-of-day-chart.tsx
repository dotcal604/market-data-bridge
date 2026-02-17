"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { TimeOfDayBucket } from "@/lib/api/autopsy-client";

interface TimeOfDayChartProps {
  buckets: TimeOfDayBucket[];
}

export function TimeOfDayChart({ buckets }: TimeOfDayChartProps) {
  if (buckets.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No time-of-day data available.
      </div>
    );
  }

  // Transform data for dual-axis display
  const chartData = buckets.map((b) => ({
    label: b.label,
    win_rate: b.win_rate * 100, // Convert to percentage
    avg_profit: b.avg_profit,
    total_trades: b.total_trades,
  }));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        Time of Day Performance
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Win rate and average profit by entry hour. Identifies optimal trading windows.
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            dataKey="label"
            tick={{ fill: "#888", fontSize: 10 }}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis
            yAxisId="left"
            tick={{ fill: "#888", fontSize: 11 }}
            label={{
              value: "Win Rate (%)",
              angle: -90,
              position: "insideLeft",
              fill: "#666",
              fontSize: 11,
            }}
            domain={[0, 100]}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: "#888", fontSize: 11 }}
            label={{
              value: "Avg Profit ($)",
              angle: 90,
              position: "insideRight",
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
            formatter={(value, name) => {
              if (name === "win_rate") return [`${Number(value).toFixed(1)}%`, "Win Rate"];
              if (name === "avg_profit") return [`$${Number(value).toFixed(2)}`, "Avg Profit"];
              return [value, name];
            }}
            labelFormatter={(label, payload) => {
              if (payload && payload.length > 0) {
                return `${label} (${payload[0].payload.total_trades} trades)`;
              }
              return label;
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(value) => {
              if (value === "win_rate") return "Win Rate (%)";
              if (value === "avg_profit") return "Avg Profit ($)";
              return value;
            }}
          />
          <Bar yAxisId="left" dataKey="win_rate" fill="#8b5cf6" name="win_rate" />
          <Bar yAxisId="right" dataKey="avg_profit" fill="#10b981" name="avg_profit" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
