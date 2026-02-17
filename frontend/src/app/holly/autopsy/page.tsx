"use client";

import { useAutopsyReport } from "@/lib/hooks/use-autopsy";
import { StrategyLeaderboardTable } from "@/components/holly/strategy-leaderboard-table";
import { MFEMAEScatter } from "@/components/holly/mfe-mae-scatter";
import { ExitPolicyCards } from "@/components/holly/exit-policy-cards";
import { TimeOfDayChart } from "@/components/holly/time-of-day-chart";
import { SegmentComparisonCards } from "@/components/holly/segment-comparison-cards";

export default function HollyAutopsyPage() {
  const { data: report, isLoading } = useAutopsyReport();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Holly Exit Autopsy</h1>
        <p className="text-sm text-muted-foreground">
          Reverse-engineering exit behavior from historical Holly trades. MFE/MAE analysis, strategy leaderboard, and exit policy recommendations.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          Loading autopsy report...
        </div>
      ) : !report ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          No data available. Import Holly trades to generate autopsy report.
        </div>
      ) : (
        <>
          {/* Overview Stats */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground">Total Trades</div>
              <div className="text-2xl font-bold tabular-nums">{report.overview.total_trades}</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground">Overall Win Rate</div>
              <div className="text-2xl font-bold tabular-nums text-emerald-400">
                {(report.overview.overall_win_rate * 100).toFixed(1)}%
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground">Total P/L</div>
              <div
                className={`text-2xl font-bold tabular-nums ${
                  report.overview.overall_total_profit >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                ${report.overview.overall_total_profit.toFixed(0)}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground">Avg Giveback</div>
              <div className="text-2xl font-bold tabular-nums text-yellow-400">
                {(report.overview.overall_avg_giveback_ratio * 100).toFixed(0)}%
              </div>
            </div>
          </div>

          {/* Strategy Leaderboard */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Strategy Leaderboard
            </h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Ranked by total P/L. Click column headers to sort. Sharpe, profit factor, and giveback metrics included.
            </p>
            <StrategyLeaderboardTable strategies={report.strategy_leaderboard} />
          </div>

          {/* Exit Policy Recommendations */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Exit Policy Recommendations
            </h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Archetype-based exit recommendations. Early peakers need faster exits, late growers need time.
            </p>
            <ExitPolicyCards recommendations={report.exit_policy_recs} />
          </div>

          {/* MFE/MAE Scatter + Time of Day */}
          <div className="grid gap-4 lg:grid-cols-2">
            <MFEMAEScatter profiles={report.mfe_mae_profiles} />
            <TimeOfDayChart buckets={report.time_of_day} />
          </div>

          {/* Segment Comparison */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Segment Comparison
            </h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Comparing Holly Grail vs Neo vs other segments. Which performs best?
            </p>
            <SegmentComparisonCards segments={report.segment_comparison} />
          </div>
        </>
      )}
    </div>
  );
}
