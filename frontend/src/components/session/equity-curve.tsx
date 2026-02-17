"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useIntradayPnL } from "@/lib/hooks/use-account";
import { formatPrice } from "@/lib/utils/formatters";

interface DataPoint {
  time: string;
  pnl: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    payload: DataPoint;
  }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0];
  const pnl = data.value;
  const isPositive = pnl >= 0;

  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      <p className="text-sm text-muted-foreground">{data.payload.time}</p>
      <p className={`font-mono text-sm font-semibold ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
        {formatPrice(pnl)}
      </p>
    </div>
  );
}

export function EquityCurve() {
  const { data, isLoading } = useIntradayPnL(30_000);

  // Transform snapshots into chart data points
  const chartData: DataPoint[] = [];
  let startingEquity: number | null = null;

  if (data?.snapshots && data.snapshots.length > 0) {
    // Sort by created_at ascending
    const sorted = [...data.snapshots].sort((a, b) => 
      a.created_at.localeCompare(b.created_at)
    );

    // First snapshot establishes baseline
    startingEquity = sorted[0].net_liquidation;

    for (const snapshot of sorted) {
      if (snapshot.net_liquidation == null || startingEquity == null) continue;

      const pnl = snapshot.net_liquidation - startingEquity;
      const timestamp = new Date(snapshot.created_at);
      const time = timestamp.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      chartData.push({ time, pnl });
    }
  }

  // Calculate current P&L and high watermark
  const currentPnL = chartData.length > 0 ? chartData[chartData.length - 1].pnl : 0;
  const maxPnL = chartData.length > 0 ? Math.max(...chartData.map((d) => d.pnl)) : 0;
  const showHighWatermark = maxPnL > 0;

  // Empty state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Intraday Equity Curve</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            Loading...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Intraday Equity Curve</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            No trades today
          </div>
        </CardContent>
      </Card>
    );
  }

  const isPositive = currentPnL >= 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Intraday Equity Curve</CardTitle>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Current P&amp;L</div>
            <div
              className={`font-mono text-2xl font-bold ${
                isPositive ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {formatPrice(currentPnL)}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorPnL" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={isPositive ? "#10b981" : "#ef4444"} stopOpacity={0.3} />
                <stop offset="95%" stopColor={isPositive ? "#10b981" : "#ef4444"} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="time"
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `$${value.toFixed(0)}`}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
            {showHighWatermark && (
              <ReferenceLine
                y={maxPnL}
                stroke="rgb(52 211 153)"
                strokeDasharray="5 5"
                strokeWidth={2}
                label={{
                  value: "High",
                  position: "right",
                  fill: "rgb(52 211 153)",
                  fontSize: 12,
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey="pnl"
              stroke={isPositive ? "rgb(16 185 129)" : "rgb(239 68 68)"}
              strokeWidth={2}
              fill="url(#colorPnL)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
