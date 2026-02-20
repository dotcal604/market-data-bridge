"use client";

import { useTraderSyncTrades } from "@/lib/hooks/use-analytics";
import { useHollyTradeStats, useAutopsyForPerformance } from "@/lib/hooks/use-performance";
import { OverviewStats } from "@/components/analytics/overview-stats";
import { KeyInsights } from "@/components/analytics/key-insights";
import { DailyStreak } from "@/components/analytics/daily-streak";
import { MonthlyPnLChart } from "@/components/analytics/monthly-pnl-chart";
import { TimeHeatmap } from "@/components/analytics/time-heatmap";
import { LongVsShort } from "@/components/analytics/long-vs-short";
import { GivebackChart } from "@/components/analytics/giveback-chart";
import { StrategyRankings } from "@/components/analytics/strategy-rankings";
import { Skeleton } from "@/components/ui/skeleton";

export default function AnalyticsPage() {
  const { data: trades, isLoading: tradesLoading } = useTraderSyncTrades({ limit: 5000 });
  const { data: hollyStats } = useHollyTradeStats();
  const { data: autopsy, isLoading: autopsyLoading } = useAutopsyForPerformance();

  const isLoading = tradesLoading;
  const tradeList = trades ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Trading Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Your edge, exposed. Real data from {tradeList.length.toLocaleString()} TraderSync trades
          {hollyStats ? ` + ${hollyStats.total_trades.toLocaleString()} Holly trades` : ""}.
        </p>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-lg" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-72 rounded-lg" />
            <Skeleton className="h-72 rounded-lg" />
          </div>
        </div>
      ) : (
        <>
          {/* Overview Stats */}
          <OverviewStats trades={tradeList} hollyStats={hollyStats} />

          {/* Key Insights — the "buy-in" panel */}
          <KeyInsights trades={tradeList} autopsy={autopsy ?? null} />

          {/* Equity Curve */}
          <DailyStreak trades={tradeList} />

          {/* Monthly P&L + Time of Day */}
          <div className="grid gap-4 lg:grid-cols-2">
            <MonthlyPnLChart trades={tradeList} />
            <TimeHeatmap trades={tradeList} />
          </div>

          {/* Long vs Short */}
          <LongVsShort trades={tradeList} />

          {/* Holly-specific analytics */}
          {!autopsyLoading && autopsy && (
            <>
              <div className="border-t border-border pt-6">
                <h2 className="mb-1 text-lg font-semibold">Holly AI Analysis</h2>
                <p className="mb-4 text-sm text-muted-foreground">
                  Insights from {autopsy.overview.total_trades.toLocaleString()} Holly trades.
                  Where profits leak, which strategies work, and what to change.
                </p>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <GivebackChart report={autopsy} />
                <StrategyRankings strategies={autopsy.strategy_leaderboard} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
