"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEdgeReport } from "@/lib/hooks/use-edge";
import { cn } from "@/lib/utils";
import { TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

function sharpeColor(value: number): string {
  if (value >= 1.5) return "text-emerald-400";
  if (value >= 0.5) return "text-yellow-400";
  return "text-red-400";
}

function sortinoColor(value: number): string {
  if (value >= 2.0) return "text-emerald-400";
  if (value >= 1.0) return "text-yellow-400";
  return "text-red-400";
}

export function SessionEdgeCard() {
  const { data, isLoading, isError } = useEdgeReport(90, false);

  if (isLoading) {
    return <Skeleton className="h-48 rounded-lg" />;
  }

  if (isError || !data) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg">Risk-Adjusted Returns</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Failed to load edge metrics</div>
        </CardContent>
      </Card>
    );
  }

  const stats = data.current;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">Risk-Adjusted Returns (90d)</CardTitle>
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Rolling Sharpe */}
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Rolling Sharpe Ratio</p>
          <p className={cn("font-mono text-3xl font-bold", sharpeColor(stats.sharpe))}>
            {stats.sharpe.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground">
            Return per unit of total risk
          </p>
        </div>

        {/* Rolling Sortino */}
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Rolling Sortino Ratio</p>
          <p className={cn("font-mono text-3xl font-bold", sortinoColor(stats.sortino))}>
            {stats.sortino.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground">
            Return per unit of downside risk
          </p>
        </div>

        {/* Additional Context */}
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Avg R-Multiple</p>
            <p className={cn("font-mono text-lg font-bold", stats.avg_r >= 0 ? "text-emerald-400" : "text-red-400")}>
              {stats.avg_r.toFixed(2)}R
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Max Drawdown</p>
            <p className="font-mono text-lg font-bold text-red-400">
              {(stats.max_drawdown * 100).toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Sample Size */}
        <div className="border-t border-border pt-3">
          <div className="flex items-baseline justify-between">
            <p className="text-xs text-muted-foreground">Sample Size</p>
            <p className={cn("font-mono text-sm font-medium", stats.total_trades >= 50 ? "text-emerald-400" : stats.total_trades >= 20 ? "text-yellow-400" : "text-red-400")}>
              {stats.total_trades} trades
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
