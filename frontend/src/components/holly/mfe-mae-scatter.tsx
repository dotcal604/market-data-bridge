"use client";

import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from "recharts";
import type { MFEMAEProfile } from "@/lib/api/autopsy-client";

interface MFEMAEScatterProps {
  profiles: MFEMAEProfile[];
}

const STRATEGY_COLORS: Record<string, string> = {
  "Holly Grail": "#10b981",
  "Holly Neo": "#8b5cf6",
  "Holly Classic": "#f59e0b",
  "Holly Pro": "#3b82f6",
};

function getStrategyColor(strategy: string): string {
  return STRATEGY_COLORS[strategy] ?? "#6b7280";
}

export function MFEMAEScatter({ profiles }: MFEMAEScatterProps) {
  if (profiles.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No MFE/MAE data available.
      </div>
    );
  }

  // Prepare data for scatter plot
  const scatterData = profiles.map((p) => ({
    strategy: p.strategy,
    segment: p.segment,
    time_to_mfe_min: p.avg_time_to_mfe_min,
    giveback_ratio: p.avg_giveback_ratio,
    total_trades: p.total_trades,
    color: getStrategyColor(p.strategy),
  }));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        Exit Timing Analysis
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Time to peak vs giveback ratio by strategy. Early peakers with high giveback need faster exits.
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            type="number"
            dataKey="time_to_mfe_min"
            name="Time to MFE"
            unit="min"
            tick={{ fill: "#888", fontSize: 11 }}
            label={{
              value: "Time to Peak (minutes)",
              position: "insideBottom",
              offset: -3,
              fill: "#666",
              fontSize: 11,
            }}
          />
          <YAxis
            type="number"
            dataKey="giveback_ratio"
            name="Giveback Ratio"
            tick={{ fill: "#888", fontSize: 11 }}
            label={{
              value: "Giveback Ratio",
              angle: -90,
              position: "insideLeft",
              fill: "#666",
              fontSize: 11,
            }}
            domain={[0, 1]}
          />
          <Tooltip
            contentStyle={{
              background: "#1a1a2e",
              border: "1px solid #333",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value, name) => {
              if (name === "time_to_mfe_min") return [`${Number(value).toFixed(1)} min`, "Time to Peak"];
              if (name === "giveback_ratio") return [`${(Number(value) * 100).toFixed(0)}%`, "Giveback"];
              return [value, name];
            }}
            labelFormatter={(_, payload) => {
              if (payload && payload.length > 0) {
                const data = payload[0].payload;
                return `${data.strategy}${data.segment ? ` - ${data.segment}` : ""} (n=${data.total_trades})`;
              }
              return "";
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(value) => <span style={{ color: "#888" }}>{value}</span>}
          />
          <Scatter name="Strategies" data={scatterData}>
            {scatterData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
