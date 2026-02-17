"use client";

import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { useIntradayPnL } from "@/lib/hooks/use-account";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils/formatters";
import type { AccountSnapshot } from "@/lib/api/types";

interface EquityDataPoint {
  time: string;
  timeLabel: string;
  cumulativePnL: number;
}

export function EquityCurve() {
  const { data, isLoading, error } = useIntradayPnL(30_000); // Poll every 30s

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">Intraday Equity Curve</h3>
        <Skeleton className="h-[260px] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">Intraday Equity Curve</h3>
        <div className="rounded-lg bg-muted/50 p-8 text-center text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Failed to load equity curve"}
        </div>
      </div>
    );
  }

  if (!data || data.snapshots.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">Intraday Equity Curve</h3>
        <div className="rounded-lg bg-muted/50 p-8 text-center text-sm text-muted-foreground">
          No intraday data yet. Snapshots are taken every 5 minutes during market hours.
        </div>
      </div>
    );
  }

  // Transform snapshots into chart data
  const chartData: EquityDataPoint[] = data.snapshots.map((snapshot: AccountSnapshot) => {
    const timestamp = new Date(snapshot.created_at);
    const timeLabel = timestamp.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    return {
      time: snapshot.created_at,
      timeLabel,
      cumulativePnL: snapshot.daily_pnl ?? 0,
    };
  });

  // Calculate high-water mark (maximum P&L achieved during the session)
  // Only show if there's at least one positive value
  const maxPnL = Math.max(...chartData.map((d) => d.cumulativePnL));
  const highWaterMark = maxPnL > 0 ? maxPnL : null;
  
  // Determine if overall P&L is positive or negative
  const currentPnL = chartData.length > 0 ? chartData[chartData.length - 1].cumulativePnL : 0;
  const isPositive = currentPnL >= 0;
  const lineColor = isPositive ? "#10b981" : "#ef4444"; // emerald-500 : red-500
  const gradientId = isPositive ? "equityGradPos" : "equityGradNeg";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Intraday Equity Curve</h3>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-muted-foreground">
            Current: <span className={`font-mono font-semibold ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
              {formatCurrency(currentPnL)}
            </span>
          </span>
          {highWaterMark && (
            <span className="text-muted-foreground">
              High: <span className="font-mono font-semibold text-emerald-400">
                {formatCurrency(highWaterMark)}
              </span>
            </span>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="equityGradPos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="equityGradNeg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            dataKey="timeLabel"
            tick={{ fill: "#888", fontSize: 11 }}
            label={{ value: "Time (ET)", position: "insideBottom", offset: -3, fill: "#666", fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: "#888", fontSize: 11 }}
            tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`}
          />
          <Tooltip
            contentStyle={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: 8, fontSize: 12 }}
            labelFormatter={(label) => `Time: ${label}`}
            formatter={(value) => [formatCurrency(Number(value ?? 0)), "P&L"]}
          />
          {highWaterMark && (
            <ReferenceLine
              y={highWaterMark}
              stroke="#10b981"
              strokeDasharray="5 5"
              strokeWidth={1.5}
              label={{
                value: "High Water Mark",
                position: "insideTopRight",
                fill: "#10b981",
                fontSize: 10,
              }}
            />
          )}
          <ReferenceLine y={0} stroke="#666" strokeWidth={1} />
          <Line
            type="monotone"
            dataKey="cumulativePnL"
            stroke={lineColor}
            fill={`url(#${gradientId})`}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
