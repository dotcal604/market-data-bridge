"use client";

import {
  usePerStrategyOptimization,
  useTrailingStopSummary,
  useHollyTradeStats,
  useAutopsyForPerformance,
} from "@/lib/hooks/use-performance";
import { PerformanceLeaderboard } from "@/components/holly/performance-leaderboard";
import { TrailingStopComparison } from "@/components/holly/trailing-stop-comparison";
import { TimeOfDayHeatmap } from "@/components/holly/time-of-day-heatmap";
import { StrategyDetailCards } from "@/components/holly/strategy-detail-cards";
import { TradeMFEMAEScatter } from "@/components/holly/trade-mfe-mae-scatter";

export default function HollyPerformancePage() {
  const { data: strategies, isLoading: strategiesLoading } = usePerStrategyOptimization();
  const { data: summary, isLoading: summaryLoading } = useTrailingStopSummary();
  const { data: stats, isLoading: statsLoading } = useHollyTradeStats();
  const { data: autopsy, isLoading: autopsyLoading } = useAutopsyForPerformance();

  const isLoading = strategiesLoading || summaryLoading || statsLoading || autopsyLoading;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Holly Strategy Performance</h1>
        <p className="text-sm text-muted-foreground">
          Trailing stop optimization results, MFE/MAE analysis, and per-strategy breakdowns.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          Loading performance data...
        </div>
      ) : !stats || !strategies || !summary || !autopsy ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          No data available. Import Holly trades to generate performance report.
        </div>
      ) : (
        <>
          {/* Overview Stats */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground">Total Trades</div>
              <div className="text-2xl font-bold tabular-nums">{stats.total_trades}</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground">Overall Win Rate</div>
              <div className="text-2xl font-bold tabular-nums text-emerald-400">
                {(stats.win_rate * 100).toFixed(1)}%
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground">Total P/L</div>
              <div
                className={`text-2xl font-bold tabular-nums ${
                  stats.total_pnl >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                ${stats.total_pnl.toFixed(0)}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground">Sharpe Ratio</div>
              <div className="text-2xl font-bold tabular-nums text-yellow-400">
                {stats.sharpe_ratio.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Strategy Leaderboard */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Strategy Leaderboard (Optimized)
            </h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Ranked by P/L improvement with optimized trailing stops. Click column headers to sort by Sharpe, win rate, avg R, or profit factor.
            </p>
            <PerformanceLeaderboard strategies={strategies} />
          </div>

          {/* Trailing Stop Comparison */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Trailing Stop Results
            </h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Comparing original Holly exits vs optimized trailing stop strategies.
            </p>
            <TrailingStopComparison summary={summary} />
          </div>

          {/* MFE/MAE Scatter + Time of Day Heatmap */}
          <div className="grid gap-4 lg:grid-cols-2">
            <TradeMFEMAEScatter profiles={autopsy.mfe_mae_profiles} />
            <TimeOfDayHeatmap buckets={autopsy.time_of_day} />
          </div>

          {/* Per-Strategy Detail Cards */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Top Strategy Details
            </h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Optimal trailing stop parameters, trade count, and P/L improvement for top 6 strategies.
            </p>
            <StrategyDetailCards strategies={strategies} />
          </div>
        </>
      )}
    </div>
  );
}
