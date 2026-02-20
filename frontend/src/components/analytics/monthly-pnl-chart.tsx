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

interface MonthlyPnLChartProps {
  trades: TraderSyncTrade[];
}

interface MonthBucket {
  month: string;
  pnl: number;
  trades: number;
  winRate: number;
  commissions: number;
}

function aggregateByMonth(trades: TraderSyncTrade[]): MonthBucket[] {
  const map = new Map<string, { pnl: number; wins: number; total: number; comm: number }>();

  for (const t of trades) {
    const month = t.open_date?.slice(0, 7); // "2024-11"
    if (!month) continue;

    const bucket = map.get(month) ?? { pnl: 0, wins: 0, total: 0, comm: 0 };
    bucket.pnl += t.return_dollars ?? 0;
    bucket.total += 1;
    if (t.status === "WIN") bucket.wins += 1;
    bucket.comm += t.commission ?? 0;
    map.set(month, bucket);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month: formatMonth(month),
      pnl: Math.round(data.pnl * 100) / 100,
      trades: data.total,
      winRate: data.total > 0 ? Math.round((data.wins / data.total) * 1000) / 10 : 0,
      commissions: Math.round(data.comm * 100) / 100,
    }));
}

function formatMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m) - 1]} '${y.slice(2)}`;
}

export function MonthlyPnLChart({ trades }: MonthlyPnLChartProps) {
  const data = aggregateByMonth(trades);

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No trade data for monthly P&L chart.
      </div>
    );
  }

  const cumulative = data.reduce((acc, d) => {
    const last = acc.length > 0 ? acc[acc.length - 1].cumPnl : 0;
    acc.push({ ...d, cumPnl: Math.round((last + d.pnl) * 100) / 100 });
    return acc;
  }, [] as (MonthBucket & { cumPnl: number })[]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium text-muted-foreground">Monthly P&L</h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Net profit by month after commissions. Red = losing month. Green = winning month.
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={cumulative} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 10 }} />
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
                return `${label} — ${p.trades} trades, ${p.winRate}% win rate`;
              }
              return label;
            }}
          />
          <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
            {cumulative.map((entry, index) => (
              <Cell key={index} fill={entry.pnl >= 0 ? "#10b981" : "#ef4444"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
