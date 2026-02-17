"use client";

import { LineChart, Line, ResponsiveContainer } from "recharts";
import { useHistoricalBars } from "@/lib/hooks/use-market";
import { Skeleton } from "@/components/ui/skeleton";

interface SparklineChartProps {
  symbol: string;
  className?: string;
}

export function SparklineChart({ symbol, className }: SparklineChartProps) {
  const { data, isLoading } = useHistoricalBars(symbol, "5d", "1d");

  if (isLoading) {
    return <Skeleton className={className || "h-8 w-20"} />;
  }

  if (!data || data.bars.length === 0) {
    return <div className={className || "h-8 w-20"} />;
  }

  const chartData = data.bars.map((bar) => ({ value: bar.close }));
  const firstClose = chartData[0].value;
  const lastClose = chartData[chartData.length - 1].value;
  const isPositive = lastClose >= firstClose;
  const strokeColor = isPositive ? "#10b981" : "#ef4444";

  return (
    <ResponsiveContainer width="100%" height="100%" className={className}>
      <LineChart data={chartData}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={strokeColor}
          strokeWidth={1.5}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
