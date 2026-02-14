"use client";

import { useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useHistoricalBars } from "@/lib/hooks/use-market";
import type { BarData } from "@/lib/api/market-client";

interface PriceChartProps {
  symbol: string | null;
}

type Period = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "YTD";

const PERIOD_CONFIG: Record<Period, { period: string; interval: string }> = {
  "1D": { period: "1d", interval: "5m" },
  "5D": { period: "5d", interval: "15m" },
  "1M": { period: "1mo", interval: "1d" },
  "3M": { period: "3mo", interval: "1d" },
  "6M": { period: "6mo", interval: "1d" },
  "1Y": { period: "1y", interval: "1d" },
  "YTD": { period: "ytd", interval: "1d" },
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: BarData & { priceChange?: number };
  }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (active && payload && payload.length > 0) {
    const data = payload[0].payload;
    const change = data.priceChange ?? 0;
    const changeColor = change >= 0 ? "text-emerald-400" : "text-red-400";

    return (
      <div className="rounded-lg border border-border bg-background p-3 shadow-lg">
        <p className="text-sm font-mono text-muted-foreground">{formatTime(data.time)}</p>
        <p className="mt-1 font-mono text-foreground">
          O: ${data.open.toFixed(2)} H: ${data.high.toFixed(2)}
        </p>
        <p className="font-mono text-foreground">
          L: ${data.low.toFixed(2)} C: ${data.close.toFixed(2)}
        </p>
        <p className={`mt-1 font-mono text-sm ${changeColor}`}>
          {change >= 0 ? "+" : ""}
          {change.toFixed(2)}%
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Vol: {formatVolume(data.volume)}
        </p>
      </div>
    );
  }
  return null;
}

function formatTime(timeStr: string): string {
  const date = new Date(timeStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return vol.toString();
}

export function PriceChart({ symbol }: PriceChartProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("3M");
  const config = PERIOD_CONFIG[selectedPeriod];

  const { data, isLoading, error } = useHistoricalBars(
    symbol,
    config.period,
    config.interval
  );

  if (!symbol) {
    return null;
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Price Chart</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[400px] items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Failed to load chart data: {error.message}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Price Chart</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.bars.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Price Chart</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[400px] items-center justify-center">
            <p className="text-sm text-muted-foreground">No chart data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate price change % for each bar
  const chartData = data.bars.map((bar, idx) => {
    if (idx === 0) return { ...bar, priceChange: 0 };
    const prevClose = data.bars[idx - 1].close;
    const priceChange = ((bar.close - prevClose) / prevClose) * 100;
    return { ...bar, priceChange };
  });

  const firstClose = chartData[0].close;
  const lastClose = chartData[chartData.length - 1].close;
  const totalChange = ((lastClose - firstClose) / firstClose) * 100;
  const changeColor = totalChange >= 0 ? "text-emerald-400" : "text-red-400";

  // Determine min/max for Y-axis
  const prices = data.bars.flatMap((b) => [b.low, b.high]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const padding = (maxPrice - minPrice) * 0.1;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Price Chart</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-mono">{symbol}</span>
              <span className="mx-2">•</span>
              <span className="font-mono">${lastClose.toFixed(2)}</span>
              <span className={`ml-2 font-mono ${changeColor}`}>
                {totalChange >= 0 ? "+" : ""}
                {totalChange.toFixed(2)}%
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            {(Object.keys(PERIOD_CONFIG) as Period[]).map((period) => (
              <button
                key={period}
                onClick={() => setSelectedPeriod(period)}
                className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
                  selectedPeriod === period
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {period}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Price Area Chart */}
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={totalChange >= 0 ? "#10b981" : "#ef4444"}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor={totalChange >= 0 ? "#10b981" : "#ef4444"}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis
                dataKey="time"
                tickFormatter={(val) => {
                  const date = new Date(val);
                  if (selectedPeriod === "1D" || selectedPeriod === "5D") {
                    return date.toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    });
                  }
                  return date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  });
                }}
                stroke="#888"
                tick={{ fill: "#888", fontSize: 12 }}
              />
              <YAxis
                domain={[minPrice - padding, maxPrice + padding]}
                tickFormatter={(val) => `$${val.toFixed(2)}`}
                stroke="#888"
                tick={{ fill: "#888", fontSize: 12 }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="close"
                stroke={totalChange >= 0 ? "#10b981" : "#ef4444"}
                strokeWidth={2}
                fill="url(#priceGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>

          {/* Volume Bar Chart */}
          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis
                dataKey="time"
                tickFormatter={(val) => {
                  const date = new Date(val);
                  if (selectedPeriod === "1D" || selectedPeriod === "5D") {
                    return date.toLocaleTimeString("en-US", {
                      hour: "numeric",
                    });
                  }
                  return date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  });
                }}
                stroke="#888"
                tick={{ fill: "#888", fontSize: 12 }}
              />
              <YAxis
                tickFormatter={formatVolume}
                stroke="#888"
                tick={{ fill: "#888", fontSize: 12 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length > 0) {
                    const vol = payload[0].value as number;
                    return (
                      <div className="rounded-lg border border-border bg-background p-2 shadow-lg">
                        <p className="text-sm text-muted-foreground">
                          Volume: {formatVolume(vol)}
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="volume" fill="#888888" opacity={0.6} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
