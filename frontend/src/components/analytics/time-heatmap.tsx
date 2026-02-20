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
} from "recharts";
import type { TraderSyncTrade } from "@/lib/api/analytics-client";

interface TimeHeatmapProps {
  trades: TraderSyncTrade[];
}

interface HourBucket {
  hour: number;
  label: string;
  pnl: number;
  trades: number;
  winRate: number;
  avgR: number;
}

const HOUR_LABELS: Record<number, string> = {
  4: "4 AM",
  5: "5 AM",
  6: "6 AM",
  7: "7 AM",
  8: "8 AM",
  9: "9 AM",
  10: "10 AM",
  11: "11 AM",
  12: "12 PM",
  13: "1 PM",
  14: "2 PM",
  15: "3 PM",
  16: "4 PM",
};

function aggregateByHour(trades: TraderSyncTrade[]): HourBucket[] {
  const map = new Map<number, { pnl: number; wins: number; total: number; rSum: number; rCount: number }>();

  for (const t of trades) {
    if (!t.open_time) continue;
    // open_time format: "HH:MM:SS" or "HH:MM"
    const hour = parseInt(t.open_time.split(":")[0]);
    if (isNaN(hour)) continue;

    const bucket = map.get(hour) ?? { pnl: 0, wins: 0, total: 0, rSum: 0, rCount: 0 };
    bucket.pnl += t.return_dollars ?? 0;
    bucket.total += 1;
    if (t.status === "WIN") bucket.wins += 1;
    if (t.r_multiple != null) {
      bucket.rSum += t.r_multiple;
      bucket.rCount += 1;
    }
    map.set(hour, bucket);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([hour, data]) => ({
      hour,
      label: HOUR_LABELS[hour] ?? `${hour}:00`,
      pnl: Math.round(data.pnl * 100) / 100,
      trades: data.total,
      winRate: data.total > 0 ? Math.round((data.wins / data.total) * 1000) / 10 : 0,
      avgR: data.rCount > 0 ? Math.round((data.rSum / data.rCount) * 1000) / 1000 : 0,
    }));
}

function barColor(pnl: number, hour: number): string {
  // Special highlight for the 9AM danger zone
  if (hour === 9 && pnl < 0) return "#dc2626"; // bright red for the danger hour
  if (pnl >= 0) return "#10b981";
  return "#ef4444";
}

export function TimeHeatmap({ trades }: TimeHeatmapProps) {
  const data = aggregateByHour(trades);

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No time-of-day data available.
      </div>
    );
  }

  // Find the 9AM bucket for callout
  const nineAm = data.find((d) => d.hour === 9);
  const bestHour = data.reduce((best, d) => (d.pnl > best.pnl ? d : best), data[0]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Time of Day P&L</h3>
        {nineAm && nineAm.pnl < 0 && (
          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-400">
            9AM: −${Math.abs(nineAm.pnl).toFixed(0)} leak
          </span>
        )}
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Net P&L by entry hour. Identifies when you trade well vs. when to sit out.
        {bestHour.pnl > 0 && (
          <span className="ml-1 text-emerald-400">Best: {bestHour.label} (+${bestHour.pnl.toFixed(0)})</span>
        )}
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis dataKey="label" tick={{ fill: "#888", fontSize: 10 }} />
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
              if (name === "pnl") return [`$${Number(value).toFixed(2)}`, "Net P&L"];
              return [value, name];
            }}
            labelFormatter={(label, payload) => {
              if (payload?.[0]?.payload) {
                const p = payload[0].payload;
                return `${label} — ${p.trades} trades, ${p.winRate}% win rate, avg R: ${p.avgR.toFixed(3)}`;
              }
              return label;
            }}
          />
          <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={index} fill={barColor(entry.pnl, entry.hour)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
