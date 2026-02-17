"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import type { TimeOfDayBucket } from "@/lib/api/autopsy-client";

interface TimeOfDayHeatmapProps {
  buckets: TimeOfDayBucket[];
}

function getWinRateColor(winRate: number): string {
  if (winRate >= 0.6) return "#10b981"; // emerald
  if (winRate >= 0.5) return "#22c55e"; // green
  if (winRate >= 0.4) return "#eab308"; // yellow
  if (winRate >= 0.3) return "#f97316"; // orange
  return "#ef4444"; // red
}

export function TimeOfDayHeatmap({ buckets }: TimeOfDayHeatmapProps) {
  if (buckets.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No time-of-day data available.
      </div>
    );
  }

  const chartData = buckets.map((b) => ({
    hour: b.hour,
    label: b.label,
    winRate: b.win_rate,
    totalTrades: b.total_trades,
    avgProfit: b.avg_profit,
    color: getWinRateColor(b.win_rate),
  }));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        Win Rate by Time of Day
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Performance varies throughout the trading day. Green = higher win rate, Red = lower win rate.
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            dataKey="label"
            tick={{ fill: "#888", fontSize: 11 }}
            label={{
              value: "Time of Day (ET)",
              position: "insideBottom",
              offset: -3,
              fill: "#666",
              fontSize: 11,
            }}
          />
          <YAxis
            tick={{ fill: "#888", fontSize: 11 }}
            label={{
              value: "Win Rate",
              angle: -90,
              position: "insideLeft",
              fill: "#666",
              fontSize: 11,
            }}
            domain={[0, 1]}
            tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
          />
          <Tooltip
            contentStyle={{
              background: "#1a1a2e",
              border: "1px solid #333",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value, name) => {
              if (name === "winRate") return [`${(Number(value) * 100).toFixed(1)}%`, "Win Rate"];
              return [value, name];
            }}
            labelFormatter={(_, payload) => {
              if (payload && payload.length > 0) {
                const data = payload[0].payload;
                return `${data.label} — ${data.totalTrades} trades, Avg P/L $${data.avgProfit.toFixed(0)}`;
              }
              return "";
            }}
          />
          <Bar dataKey="winRate">
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
