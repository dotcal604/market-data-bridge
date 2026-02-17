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

interface TradeMFEMAEScatterProps {
  profiles: MFEMAEProfile[];
}

const STRATEGY_COLORS: Record<string, string> = {
  "Holly Grail": "#10b981",
  "Holly Neo": "#8b5cf6",
  "Holly Classic": "#f59e0b",
  "Holly Pro": "#3b82f6",
  "Holly Momentum": "#ec4899",
  "Holly Breakout": "#06b6d4",
};

function getStrategyColor(strategy: string): string {
  return STRATEGY_COLORS[strategy] ?? "#6b7280";
}

export function TradeMFEMAEScatter({ profiles }: TradeMFEMAEScatterProps) {
  if (profiles.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No MFE/MAE data available.
      </div>
    );
  }

  // Prepare data for scatter plot: X=MAE, Y=MFE
  const scatterData = profiles.map((p) => ({
    strategy: p.strategy,
    segment: p.segment,
    mae: p.avg_mae,
    mfe: p.avg_mfe,
    giveback_ratio: p.avg_giveback_ratio,
    total_trades: p.total_trades,
    color: getStrategyColor(p.strategy),
  }));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        MFE vs MAE by Strategy
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Maximum Favorable Excursion (Y) vs Maximum Adverse Excursion (X). Higher MFE relative to MAE indicates better risk/reward profile.
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ top: 10, right: 20, left: 20, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            type="number"
            dataKey="mae"
            name="MAE"
            unit="$"
            tick={{ fill: "#888", fontSize: 11 }}
            label={{
              value: "Maximum Adverse Excursion ($)",
              position: "insideBottom",
              offset: -3,
              fill: "#666",
              fontSize: 11,
            }}
          />
          <YAxis
            type="number"
            dataKey="mfe"
            name="MFE"
            unit="$"
            tick={{ fill: "#888", fontSize: 11 }}
            label={{
              value: "Maximum Favorable Excursion ($)",
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
            formatter={(value, name) => {
              if (name === "mae") return [`$${Number(value).toFixed(0)}`, "MAE"];
              if (name === "mfe") return [`$${Number(value).toFixed(0)}`, "MFE"];
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
