"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDailySummary } from "@/lib/hooks/use-analytics";
import { formatCurrency } from "@/lib/utils/formatters";
import { pnlColor } from "@/lib/utils/colors";
import { cn } from "@/lib/utils";
import { BarChart3 } from "lucide-react";

export function TodayPerformanceCard() {
  const { data, isLoading, error } = useDailySummary(1);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Today&apos;s Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Today&apos;s Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Unable to load performance data</p>
        </CardContent>
      </Card>
    );
  }

  // Find today's session from the daily summary
  const today = new Date().toISOString().split("T")[0];
  const todaySession = data.sessions.find((s) => s.date === today);

  if (!todaySession) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Today&apos;s Performance
          </CardTitle>
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No trades yet today</p>
          {data.rolling && (
            <div className="mt-3 space-y-1 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">
                Rolling: {data.rolling.total_trades} trades |{" "}
                {(data.rolling.overall_win_rate * 100).toFixed(0)}% win rate
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Today&apos;s Performance
        </CardTitle>
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        {/* P&L */}
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">P&L</span>
          <span
            className={cn(
              "text-lg font-bold font-mono",
              pnlColor(todaySession.total_pnl)
            )}
          >
            {formatCurrency(todaySession.total_pnl)}
          </span>
        </div>

        {/* Trade Count */}
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Trades</span>
          <span className="text-sm font-mono font-semibold">
            {todaySession.trade_count}{" "}
            <span className="text-xs text-muted-foreground">
              ({todaySession.win_count}W / {todaySession.loss_count}L)
            </span>
          </span>
        </div>

        {/* Win Rate */}
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Win Rate</span>
          <span
            className={cn(
              "text-sm font-mono font-semibold",
              todaySession.win_rate >= 0.5
                ? "text-emerald-400"
                : "text-red-400"
            )}
          >
            {(todaySession.win_rate * 100).toFixed(0)}%
          </span>
        </div>

        {/* Avg R */}
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Avg R</span>
          <span
            className={cn(
              "text-sm font-mono font-semibold",
              todaySession.avg_r >= 0 ? "text-emerald-400" : "text-red-400"
            )}
          >
            {todaySession.avg_r >= 0 ? "+" : ""}
            {todaySession.avg_r.toFixed(2)}R
          </span>
        </div>

        {/* Best / Worst R */}
        <div className="flex items-baseline justify-between border-t border-border pt-2">
          <span className="text-xs text-muted-foreground">Range</span>
          <span className="text-xs font-mono">
            <span className="text-emerald-400">
              +{todaySession.best_r.toFixed(2)}R
            </span>
            {" / "}
            <span className="text-red-400">
              {todaySession.worst_r.toFixed(2)}R
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
