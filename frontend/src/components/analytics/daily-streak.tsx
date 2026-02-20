"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { TraderSyncTrade } from "@/lib/api/analytics-client";

interface DailyStreakProps {
  trades: TraderSyncTrade[];
}

interface DayBucket {
  date: string;
  label: string;
  pnl: number;
  cumPnl: number;
  trades: number;
}

function aggregateByDay(trades: TraderSyncTrade[]): DayBucket[] {
  const map = new Map<string, { pnl: number; count: number }>();

  for (const t of trades) {
    if (!t.open_date) continue;
    const day = t.open_date;
    const bucket = map.get(day) ?? { pnl: 0, count: 0 };
    bucket.pnl += t.return_dollars ?? 0;
    bucket.count += 1;
    map.set(day, bucket);
  }

  const days = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b));

  let cumPnl = 0;
  return days.map(([date, data]) => {
    cumPnl += data.pnl;
    return {
      date,
      label: formatDate(date),
      pnl: Math.round(data.pnl * 100) / 100,
      cumPnl: Math.round(cumPnl * 100) / 100,
      trades: data.count,
    };
  });
}

function formatDate(d: string): string {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function DailyStreak({ trades }: DailyStreakProps) {
  const data = aggregateByDay(trades);

  if (data.length < 3) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        Not enough trading days for equity curve.
      </div>
    );
  }

  // Find max drawdown
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const d of data) {
    if (d.cumPnl > peak) peak = d.cumPnl;
    const dd = peak - d.cumPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const finalPnl = data[data.length - 1].cumPnl;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Equity Curve (Daily)</h3>
        <div className="flex items-center gap-3 text-xs">
          <span className={finalPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
            Total: ${finalPnl.toFixed(0)}
          </span>
          <span className="text-red-400">
            Max DD: -${maxDrawdown.toFixed(0)}
          </span>
        </div>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Cumulative P&L over time. Visualize the trajectory of your trading account.
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="equityGradAnalytics" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={finalPnl >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0.3} />
              <stop offset="95%" stopColor={finalPnl >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            dataKey="label"
            tick={{ fill: "#888", fontSize: 10 }}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis tick={{ fill: "#888", fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
          <ReferenceLine y={0} stroke="#555" strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{
              background: "#1a1a2e",
              border: "1px solid #333",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value, name) => {
              if (name === "cumPnl") return [`$${Number(value).toFixed(2)}`, "Cumulative P&L"];
              return [value, name];
            }}
            labelFormatter={(label, payload) => {
              if (payload?.[0]?.payload) {
                const p = payload[0].payload;
                return `${p.date} — ${p.trades} trades, day: $${p.pnl.toFixed(2)}`;
              }
              return label;
            }}
          />
          <Area
            type="monotone"
            dataKey="cumPnl"
            stroke={finalPnl >= 0 ? "#10b981" : "#ef4444"}
            fill="url(#equityGradAnalytics)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
