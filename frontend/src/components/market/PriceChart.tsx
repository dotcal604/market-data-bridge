"use client";

import { useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useHistoricalBars } from "@/lib/hooks/use-market-data";
import type { BarData } from "@/lib/api/types";

interface PriceChartProps {
  symbol: string;
}

type Period = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "ytd";

const PERIODS: { label: string; value: Period }[] = [
  { label: "1D", value: "1d" },
  { label: "5D", value: "5d" },
  { label: "1M", value: "1mo" },
  { label: "3M", value: "3mo" },
  { label: "6M", value: "6mo" },
  { label: "1Y", value: "1y" },
  { label: "YTD", value: "ytd" },
];

// Auto-select interval based on period
function getInterval(period: Period): string {
  if (period === "1d") return "5m";
  if (period === "5d") return "15m";
  return "1d";
}

interface ChartDataPoint extends BarData {
  formattedTime: string;
  color: string;
}

interface PriceTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: ChartDataPoint;
  }>;
}

function PriceTooltip({ active, payload }: PriceTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0].payload;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      <p className="font-mono text-xs text-muted-foreground mb-2">{data.formattedTime}</p>
      <div className="space-y-1">
        <p className="text-sm text-foreground">
          <span className="text-muted-foreground">O:</span>{" "}
          <span className="font-mono">${data.open.toFixed(2)}</span>
        </p>
        <p className="text-sm text-foreground">
          <span className="text-muted-foreground">H:</span>{" "}
          <span className="font-mono">${data.high.toFixed(2)}</span>
        </p>
        <p className="text-sm text-foreground">
          <span className="text-muted-foreground">L:</span>{" "}
          <span className="font-mono">${data.low.toFixed(2)}</span>
        </p>
        <p className="text-sm text-foreground">
          <span className="text-muted-foreground">C:</span>{" "}
          <span className="font-mono">${data.close.toFixed(2)}</span>
        </p>
        <p className="text-sm text-foreground">
          <span className="text-muted-foreground">V:</span>{" "}
          <span className="font-mono">{(data.volume / 1_000_000).toFixed(2)}M</span>
        </p>
      </div>
    </div>
  );
}

interface VolumeTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: ChartDataPoint;
  }>;
}

function VolumeTooltip({ active, payload }: VolumeTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0].payload;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      <p className="font-mono text-xs text-muted-foreground mb-1">{data.formattedTime}</p>
      <p className="text-sm text-foreground">
        <span className="text-muted-foreground">Volume:</span>{" "}
        <span className="font-mono">{(data.volume / 1_000_000).toFixed(2)}M</span>
      </p>
    </div>
  );
}

export function PriceChart({ symbol }: PriceChartProps) {
  const [period, setPeriod] = useState<Period>("3mo");
  const interval = getInterval(period);

  const { data, isLoading, error } = useHistoricalBars(symbol, period, interval);

  // Transform data for charts
  const chartData = useMemo(() => {
    if (!data?.bars || data.bars.length === 0) return [];

    return data.bars.map((bar) => {
      const date = new Date(bar.time);
      const formattedTime =
        interval === "5m" || interval === "15m"
          ? date.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })
          : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

      return {
        ...bar,
        formattedTime,
        color: bar.close >= bar.open ? "rgb(34 197 94)" : "rgb(239 68 68)", // green-500 : red-500
      };
    });
  }, [data, interval]);

  // Calculate price domain with padding
  const priceDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100];
    const prices = chartData.flatMap((d) => [d.low, d.high]);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const padding = (max - min) * 0.1;
    return [min - padding, max + padding];
  }, [chartData]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle>{symbol} Price Chart</CardTitle>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <Button
              key={p.value}
              variant={period === p.value ? "default" : "outline"}
              size="sm"
              onClick={() => setPeriod(p.value)}
              className="h-8 px-3"
            >
              {p.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-96">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-96">
            <p className="text-sm text-red-400">
              Error loading chart: {error instanceof Error ? error.message : String(error)}
            </p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-96">
            <p className="text-sm text-muted-foreground">No data available for {symbol}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Price Chart */}
            <ResponsiveContainer width="100%" height={350}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="rgb(34 197 94)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="rgb(34 197 94)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" opacity={0.3} />
                <XAxis
                  dataKey="formattedTime"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={50}
                />
                <YAxis
                  domain={priceDomain}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `$${value.toFixed(2)}`}
                  width={65}
                />
                <Tooltip content={<PriceTooltip />} />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke="rgb(34 197 94)"
                  strokeWidth={2}
                  fill="url(#priceGradient)"
                  animationDuration={300}
                />
              </AreaChart>
            </ResponsiveContainer>

            {/* Volume Chart */}
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={chartData}>
                <XAxis
                  dataKey="formattedTime"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  hide
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${(value / 1_000_000).toFixed(0)}M`}
                  width={50}
                />
                <Tooltip content={<VolumeTooltip />} />
                <Bar dataKey="volume" radius={[2, 2, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <rect key={`bar-${index}`} fill={entry.color} opacity={0.6} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
