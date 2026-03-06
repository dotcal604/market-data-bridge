"use client";

import { useState } from "react";
import { useHollyAnalytics } from "@/lib/hooks/use-holly-analytics";
import {
  AreaChart,
  Area,
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
  LineChart,
  Line,
} from "recharts";
import type {
  HollyAnalyticsDashboard,
  FilterImpact,
  StrategyRow,
} from "@/lib/api/holly-analytics-client";

// ── Shared chart styling ──

const CHART_TOOLTIP = {
  contentStyle: {
    background: "#1a1a2e",
    border: "1px solid #333",
    borderRadius: 8,
    fontSize: 12,
  },
};

const COLORS = {
  green: "#10b981",
  red: "#ef4444",
  yellow: "#eab308",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  orange: "#f59e0b",
  gray: "#94a3b8",
};

const CURVE_COLORS = [COLORS.gray, COLORS.blue, COLORS.orange, COLORS.purple, COLORS.green];

// ── Stat Card ──

function StatCard({
  label,
  value,
  color,
  prefix,
  suffix,
}: {
  label: string;
  value: string | number;
  color?: string;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${color ?? ""}`}>
        {prefix}
        {typeof value === "number" ? value.toLocaleString() : value}
        {suffix}
      </div>
    </div>
  );
}

// ── Filter Impact Table ──

function FilterImpactTable({ filters, baselineWR }: { filters: FilterImpact[]; baselineWR: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium text-muted-foreground">Filter Layer Impact</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Each filter applied independently. Baseline WR: {baselineWR}%
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="py-2 text-left font-medium">Filter</th>
              <th className="py-2 text-right font-medium">Trades</th>
              <th className="py-2 text-right font-medium">Retained</th>
              <th className="py-2 text-right font-medium">WR%</th>
              <th className="py-2 text-right font-medium">WR Lift</th>
              <th className="py-2 text-right font-medium">Avg P/L</th>
            </tr>
          </thead>
          <tbody>
            {filters.map((f) => (
              <tr key={f.key} className="border-b border-border/50">
                <td className="py-2 font-medium">{f.name}</td>
                <td className="py-2 text-right tabular-nums">{f.trades.toLocaleString()}</td>
                <td className="py-2 text-right tabular-nums">{f.retained_pct}%</td>
                <td className="py-2 text-right tabular-nums text-emerald-400">{f.wr}%</td>
                <td
                  className={`py-2 text-right tabular-nums font-medium ${
                    f.wr_lift > 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {f.wr_lift > 0 ? "+" : ""}
                  {f.wr_lift}pp
                </td>
                <td
                  className={`py-2 text-right tabular-nums ${
                    f.avg_pnl >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  ${f.avg_pnl.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Equity Curves Chart ──

function EquityCurvesChart({
  curves,
}: {
  curves: HollyAnalyticsDashboard["equity_curves"];
}) {
  const names = Object.keys(curves);
  if (names.length === 0) return null;

  // Build combined data: use Baseline x-axis, merge all series
  const baseline = curves["Baseline"];
  if (!baseline) return null;

  // Use index-based merge
  const maxLen = Math.max(...names.map((n) => curves[n].points.length));
  const data = Array.from({ length: maxLen }, (_, i) => {
    const row: Record<string, number> = { idx: i };
    for (const name of names) {
      const pts = curves[name].points;
      if (i < pts.length) row[name] = pts[i].pnl;
    }
    return row;
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium text-muted-foreground">
        Cumulative Filter Stacking -- Equity Curves
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Each layer stacks on top of the previous. Shows progressive refinement from baseline to full stack.
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            dataKey="idx"
            tick={{ fill: "#888", fontSize: 10 }}
            label={{ value: "Trade #", position: "insideBottomRight", fill: "#888", fontSize: 10, offset: -5 }}
          />
          <YAxis
            tick={{ fill: "#888", fontSize: 11 }}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`}
          />
          <ReferenceLine y={0} stroke="#555" strokeDasharray="3 3" />
          <Tooltip
            {...CHART_TOOLTIP}
            formatter={(value, name) => [`$${Number(value).toLocaleString()}`, String(name)]}
          />
          <Legend
            verticalAlign="top"
            height={36}
            formatter={(value: string) => {
              const c = curves[value];
              return c ? `${value} (n=${c.trades.toLocaleString()}, ${c.wr}% WR)` : value;
            }}
          />
          {names.map((name, i) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={CURVE_COLORS[i % CURVE_COLORS.length]}
              strokeWidth={name === "Baseline" ? 1 : 2}
              dot={false}
              strokeOpacity={name === "Baseline" ? 0.5 : 1}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── TOD Performance Bar Chart ──

function TODChart({ data }: { data: HollyAnalyticsDashboard["tod_performance"] }) {
  if (!data || data.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium text-muted-foreground">Win Rate by Time of Day</h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Performance by entry time bucket. Green = above 50% WR.
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis dataKey="bucket" tick={{ fill: "#888", fontSize: 10 }} />
          <YAxis tick={{ fill: "#888", fontSize: 11 }} domain={[30, 70]} tickFormatter={(v) => `${v}%`} />
          <ReferenceLine y={50} stroke="#555" strokeDasharray="3 3" />
          <Tooltip
            {...CHART_TOOLTIP}
            formatter={(value, name) => {
              if (name === "wr") return [`${Number(value)}%`, "Win Rate"];
              return [String(value), String(name)];
            }}
            labelFormatter={(label, payload) => {
              const p = payload?.[0]?.payload;
              return p ? `${label} -- ${p.trades.toLocaleString()} trades, avg $${p.avg_pnl}` : label;
            }}
          />
          <Bar dataKey="wr" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.wr >= 50 ? COLORS.green : COLORS.red} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Regime Performance Bar Chart ──

function RegimeChart({ data }: { data: HollyAnalyticsDashboard["regime_performance"] }) {
  if (!data || data.length === 0) return null;

  const sorted = [...data].sort((a, b) => b.wr - a.wr);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium text-muted-foreground">Win Rate by Market Regime</h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Performance in different market regimes (trend direction).
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={sorted} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis dataKey="regime" tick={{ fill: "#888", fontSize: 11 }} />
          <YAxis tick={{ fill: "#888", fontSize: 11 }} domain={[40, 60]} tickFormatter={(v) => `${v}%`} />
          <ReferenceLine y={50} stroke="#555" strokeDasharray="3 3" />
          <Tooltip
            {...CHART_TOOLTIP}
            formatter={(value, name) => {
              if (name === "wr") return [`${Number(value)}%`, "Win Rate"];
              return [String(value), String(name)];
            }}
            labelFormatter={(label, payload) => {
              const p = payload?.[0]?.payload;
              return p
                ? `${label} -- ${p.trades.toLocaleString()} trades, total $${p.total_pnl.toLocaleString()}`
                : label;
            }}
          />
          <Bar dataKey="wr" radius={[4, 4, 0, 0]}>
            {sorted.map((d, i) => (
              <Cell key={i} fill={d.wr >= 50 ? COLORS.green : COLORS.red} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Strategy Leaderboard ──

function StrategyLeaderboard({ strategies }: { strategies: StrategyRow[] }) {
  const [sortKey, setSortKey] = useState<keyof StrategyRow>("total_pnl");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = [...strategies].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    return sortDir === "desc" ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });

  const handleSort = (key: keyof StrategyRow) => {
    if (key === sortKey) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const arrow = (key: keyof StrategyRow) =>
    sortKey === key ? (sortDir === "desc" ? " \u25BC" : " \u25B2") : "";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium text-muted-foreground">Strategy Leaderboard</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Top 25 strategies by total P/L (min 30 trades). Click headers to sort.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="py-2 text-left font-medium">Strategy</th>
              <th className="cursor-pointer py-2 text-right font-medium" onClick={() => handleSort("trades")}>
                Trades{arrow("trades")}
              </th>
              <th className="cursor-pointer py-2 text-right font-medium" onClick={() => handleSort("wr")}>
                WR%{arrow("wr")}
              </th>
              <th className="cursor-pointer py-2 text-right font-medium" onClick={() => handleSort("avg_pnl")}>
                Avg P/L{arrow("avg_pnl")}
              </th>
              <th className="cursor-pointer py-2 text-right font-medium" onClick={() => handleSort("total_pnl")}>
                Total P/L{arrow("total_pnl")}
              </th>
              <th className="cursor-pointer py-2 text-right font-medium" onClick={() => handleSort("sharpe")}>
                Sharpe{arrow("sharpe")}
              </th>
              <th className="cursor-pointer py-2 text-right font-medium" onClick={() => handleSort("profit_factor")}>
                PF{arrow("profit_factor")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.strategy} className="border-b border-border/50 hover:bg-card/80">
                <td className="py-2 font-medium">{s.strategy}</td>
                <td className="py-2 text-right tabular-nums">{s.trades.toLocaleString()}</td>
                <td
                  className={`py-2 text-right tabular-nums ${s.wr >= 50 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {s.wr}%
                </td>
                <td
                  className={`py-2 text-right tabular-nums ${s.avg_pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
                >
                  ${s.avg_pnl.toLocaleString()}
                </td>
                <td
                  className={`py-2 text-right tabular-nums font-medium ${
                    s.total_pnl >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  ${s.total_pnl.toLocaleString()}
                </td>
                <td className="py-2 text-right tabular-nums">{s.sharpe}</td>
                <td className="py-2 text-right tabular-nums">{s.profit_factor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── YoY Performance ──

function YoYChart({ data }: { data: HollyAnalyticsDashboard["yoy_performance"] }) {
  if (!data || data.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium text-muted-foreground">Year-over-Year Performance</h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Annual P/L and win rate trends.
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis dataKey="year" tick={{ fill: "#888", fontSize: 11 }} />
          <YAxis tick={{ fill: "#888", fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
          <ReferenceLine y={0} stroke="#555" strokeDasharray="3 3" />
          <Tooltip
            {...CHART_TOOLTIP}
            formatter={(value, name) => {
              if (name === "total_pnl") return [`$${Number(value).toLocaleString()}`, "Total P/L"];
              return [String(value), String(name)];
            }}
            labelFormatter={(label, payload) => {
              const p = payload?.[0]?.payload;
              return p
                ? `${label} -- ${p.trades.toLocaleString()} trades, ${p.wr}% WR`
                : String(label);
            }}
          />
          <Bar dataKey="total_pnl" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.total_pnl >= 0 ? COLORS.green : COLORS.red} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Filter Distribution ──

function FilterDistChart({ data }: { data: HollyAnalyticsDashboard["filter_distribution"] }) {
  if (!data || data.length === 0) return null;

  const labeled = data.map((d) => ({
    ...d,
    label: `${d.passing}/4`,
    pct: 0,
  }));
  const total = labeled.reduce((s, d) => s + d.trades, 0);
  labeled.forEach((d) => (d.pct = Math.round((d.trades / total) * 1000) / 10));

  const distColors = [COLORS.red, COLORS.orange, COLORS.yellow, COLORS.blue, COLORS.green];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium text-muted-foreground">Filter Pass Distribution</h3>
      <p className="mb-4 text-xs text-muted-foreground">
        How many of the 4 filters each trade passes (edge, TOD, regime, sector).
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={labeled} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis dataKey="label" tick={{ fill: "#888", fontSize: 11 }} />
          <YAxis tick={{ fill: "#888", fontSize: 11 }} />
          <Tooltip
            {...CHART_TOOLTIP}
            formatter={(value) => [Number(value).toLocaleString(), "Trades"]}
            labelFormatter={(label, payload) => {
              const p = payload?.[0]?.payload;
              return p ? `${label} filters passing (${p.pct}%)` : String(label);
            }}
          />
          <Bar dataKey="trades" radius={[4, 4, 0, 0]}>
            {labeled.map((d, i) => (
              <Cell key={i} fill={distColors[d.passing] ?? COLORS.gray} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Full Stack Callout ──

function FullStackCallout({ fs, total }: { fs: HollyAnalyticsDashboard["full_stack"]; total: number }) {
  const pct = total > 0 ? ((fs.trades / total) * 100).toFixed(1) : "0";

  return (
    <div className="rounded-lg border-2 border-emerald-500/30 bg-emerald-950/20 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-2 w-2 rounded-full bg-emerald-400" />
        <h3 className="text-sm font-semibold text-emerald-400">Full Stack Filter (All 4 Passing)</h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">Trades</div>
          <div className="text-lg font-bold tabular-nums">
            {fs.trades.toLocaleString()}{" "}
            <span className="text-xs text-muted-foreground">({pct}%)</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Win Rate</div>
          <div className="text-lg font-bold tabular-nums text-emerald-400">{fs.wr}%</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Avg P/L</div>
          <div
            className={`text-lg font-bold tabular-nums ${fs.avg_pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
          >
            ${fs.avg_pnl.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Total P/L</div>
          <div
            className={`text-lg font-bold tabular-nums ${fs.total_pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
          >
            ${fs.total_pnl.toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──

export default function HollyAnalyticsPage() {
  const { data: dashboard, isLoading } = useHollyAnalytics();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Holly Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Probability engine, filter stacking, and conditional edge analysis across{" "}
          {dashboard
            ? `${dashboard.overview.total_trades.toLocaleString()} trades and ${dashboard.overview.strategies} strategies`
            : "28K+ trades"}
          .
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-card" />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-lg bg-card" />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-72 animate-pulse rounded-lg bg-card" />
            <div className="h-72 animate-pulse rounded-lg bg-card" />
          </div>
        </div>
      ) : !dashboard ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          No analytics data available. Run:{" "}
          <code className="rounded bg-muted px-2 py-1 text-xs">
            python analytics/output/generate_dashboard_json.py
          </code>
        </div>
      ) : (
        <>
          {/* Overview Stats */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <StatCard label="Total Trades" value={dashboard.overview.total_trades} />
            <StatCard
              label="Win Rate"
              value={`${dashboard.overview.win_rate}%`}
              color={dashboard.overview.win_rate >= 50 ? "text-emerald-400" : "text-red-400"}
            />
            <StatCard
              label="Avg P/L"
              value={`$${dashboard.overview.avg_pnl.toLocaleString()}`}
              color={dashboard.overview.avg_pnl >= 0 ? "text-emerald-400" : "text-red-400"}
            />
            <StatCard
              label="Total P/L"
              value={`$${dashboard.overview.total_pnl.toLocaleString()}`}
              color={dashboard.overview.total_pnl >= 0 ? "text-emerald-400" : "text-red-400"}
            />
            <StatCard label="Sharpe" value={dashboard.overview.sharpe} color="text-yellow-400" />
            <StatCard label="Profit Factor" value={dashboard.overview.profit_factor} color="text-yellow-400" />
          </div>

          {/* Full Stack Callout */}
          <FullStackCallout fs={dashboard.full_stack} total={dashboard.overview.total_trades} />

          {/* Filter Impact Table */}
          <FilterImpactTable filters={dashboard.filter_impact} baselineWR={dashboard.overview.win_rate} />

          {/* Equity Curves */}
          <EquityCurvesChart curves={dashboard.equity_curves} />

          {/* TOD + Regime side by side */}
          <div className="grid gap-4 lg:grid-cols-2">
            <TODChart data={dashboard.tod_performance} />
            <RegimeChart data={dashboard.regime_performance} />
          </div>

          {/* Strategy Leaderboard */}
          <StrategyLeaderboard strategies={dashboard.strategy_leaderboard} />

          {/* YoY + Filter Distribution side by side */}
          <div className="grid gap-4 lg:grid-cols-2">
            <YoYChart data={dashboard.yoy_performance} />
            <FilterDistChart data={dashboard.filter_distribution} />
          </div>

          {/* Footer */}
          <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
            <p>
              Data range: {dashboard.overview.date_range.start} to {dashboard.overview.date_range.end} ({dashboard.overview.years} years).
              {" "}Full stack: {dashboard.full_stack.trades.toLocaleString()} trades pass all 4 filters
              ({((dashboard.full_stack.trades / dashboard.overview.total_trades) * 100).toFixed(1)}%).
            </p>
            <p className="mt-1">
              Also available: Streamlit dashboard (interactive), Jupyter notebook (ad-hoc queries), Power BI parquet (114 columns).
            </p>
          </div>
        </>
      )}
    </div>
  );
}
