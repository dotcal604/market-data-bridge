"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import type { ExitAutopsyReport } from "@/lib/api/autopsy-client";

interface GivebackChartProps {
  report: ExitAutopsyReport;
}

interface GivebackBucket {
  range: string;
  count: number;
  pct: number;
}

function bucketGiveback(profiles: ExitAutopsyReport["mfe_mae_profiles"]): GivebackBucket[] {
  // We'll show the avg_giveback_ratio distribution across strategies
  const ranges = [
    { range: "0–20%", min: 0, max: 0.2, count: 0 },
    { range: "20–40%", min: 0.2, max: 0.4, count: 0 },
    { range: "40–60%", min: 0.4, max: 0.6, count: 0 },
    { range: "60–80%", min: 0.6, max: 0.8, count: 0 },
    { range: "80–100%", min: 0.8, max: 1.01, count: 0 },
  ];

  let total = 0;
  for (const p of profiles) {
    for (const r of ranges) {
      if (p.avg_giveback_ratio >= r.min && p.avg_giveback_ratio < r.max) {
        r.count += p.total_trades;
        total += p.total_trades;
        break;
      }
    }
  }

  return ranges.map((r) => ({
    range: r.range,
    count: r.count,
    pct: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0,
  }));
}

const BUCKET_COLORS = ["#10b981", "#34d399", "#fbbf24", "#f97316", "#ef4444"];

export function GivebackChart({ report }: GivebackChartProps) {
  const profiles = report.mfe_mae_profiles;
  const overview = report.overview;

  if (profiles.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No giveback data available.
      </div>
    );
  }

  const buckets = bucketGiveback(profiles);
  const overallGiveback = overview.overall_avg_giveback_ratio;

  // Find the worst offender
  const worstStrategy = [...profiles].sort((a, b) => b.avg_giveback_ratio - a.avg_giveback_ratio)[0];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Profit Giveback Distribution</h3>
        <span className={cn(
          "rounded-full px-2 py-0.5 text-[10px] font-medium",
          overallGiveback > 0.5 ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"
        )}>
          Avg: {(overallGiveback * 100).toFixed(0)}% giveback
        </span>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        How much of peak profit (MFE) you give back before exit. Lower is better.
        {worstStrategy && (
          <span className="ml-1 text-red-400">
            Worst: {worstStrategy.strategy} ({(worstStrategy.avg_giveback_ratio * 100).toFixed(0)}%)
          </span>
        )}
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={buckets} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis dataKey="range" tick={{ fill: "#888", fontSize: 11 }} />
          <YAxis tick={{ fill: "#888", fontSize: 11 }} label={{ value: "Trades", angle: -90, position: "insideLeft", fill: "#666", fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              background: "#1a1a2e",
              border: "1px solid #333",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value, name) => {
              if (name === "count") return [`${value} trades`, "Count"];
              return [value, name];
            }}
            labelFormatter={(label, payload) => {
              if (payload?.[0]?.payload) {
                return `Giveback ${label} — ${payload[0].payload.pct}% of trades`;
              }
              return label;
            }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {buckets.map((_, index) => (
              <Cell key={index} fill={BUCKET_COLORS[index]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
