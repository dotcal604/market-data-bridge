"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEdgeReport } from "@/lib/hooks/use-edge";
import { cn } from "@/lib/utils";
import { TrendingUp } from "lucide-react";

function scoreGrade(score: number): { label: string; className: string } {
  if (score >= 80) return { label: "Strong Edge", className: "text-emerald-400" };
  if (score >= 60) return { label: "Moderate Edge", className: "text-green-400" };
  if (score >= 40) return { label: "Weak Edge", className: "text-yellow-400" };
  if (score >= 20) return { label: "Marginal", className: "text-orange-400" };
  return { label: "No Edge", className: "text-red-400" };
}

function metricColor(value: number, thresholds: [number, number]): string {
  if (value >= thresholds[1]) return "text-emerald-400";
  if (value >= thresholds[0]) return "text-yellow-400";
  return "text-red-400";
}

export function EdgeSummaryCard() {
  const { data, isLoading, isError } = useEdgeReport(90, false);

  if (isLoading) {
    return (
      <Card className="bg-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Edge Analysis
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading edge metrics...</div>
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className="bg-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Edge Analysis
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Failed to load edge metrics</div>
        </CardContent>
      </Card>
    );
  }

  const stats = data.current;
  const grade = scoreGrade(stats.edge_score);

  return (
    <Card className="bg-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Edge Analysis (90d)
        </CardTitle>
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Edge Score - Primary Metric */}
        <div className="flex items-baseline justify-between">
          <div className="text-xs font-medium text-muted-foreground">Edge Score</div>
          <div className="flex items-baseline gap-2">
            <div className={cn("text-2xl font-bold tabular-nums", grade.className)}>
              {stats.edge_score}
            </div>
            <div className={cn("text-xs font-medium", grade.className)}>{grade.label}</div>
          </div>
        </div>

        {/* Rolling Sharpe */}
        <div className="flex items-baseline justify-between">
          <div className="text-xs font-medium text-muted-foreground">Rolling Sharpe</div>
          <div className={cn("text-xl font-bold tabular-nums", metricColor(stats.sharpe, [0.5, 1.5]))}>
            {stats.sharpe.toFixed(2)}
          </div>
        </div>

        {/* Win Rate */}
        <div className="flex items-baseline justify-between">
          <div className="text-xs font-medium text-muted-foreground">Win Rate</div>
          <div className={cn("text-xl font-bold tabular-nums", metricColor(stats.win_rate, [0.45, 0.55]))}>
            {(stats.win_rate * 100).toFixed(1)}%
          </div>
        </div>

        {/* Profit Factor */}
        <div className="flex items-baseline justify-between">
          <div className="text-xs font-medium text-muted-foreground">Profit Factor</div>
          <div className={cn("text-xl font-bold tabular-nums", metricColor(Math.min(stats.profit_factor, 10), [1.0, 1.5]))}>
            {stats.profit_factor === Infinity ? "Inf" : stats.profit_factor.toFixed(2)}
          </div>
        </div>

        {/* Sample Size */}
        <div className="flex items-baseline justify-between border-t border-border pt-2">
          <div className="text-xs font-medium text-muted-foreground">Total Trades</div>
          <div className={cn("text-sm font-medium tabular-nums", stats.total_trades >= 50 ? "text-emerald-400" : stats.total_trades >= 20 ? "text-yellow-400" : "text-red-400")}>
            {stats.total_trades}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
