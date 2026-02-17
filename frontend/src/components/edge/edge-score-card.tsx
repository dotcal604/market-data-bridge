"use client";

import type { CurrentStats } from "@/lib/api/edge-client";
import { cn } from "@/lib/utils";

interface EdgeScoreCardProps {
  stats: CurrentStats | undefined;
}

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

export function EdgeScoreCard({ stats }: EdgeScoreCardProps) {
  if (!stats) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-muted-foreground">
        Loading edge metrics...
      </div>
    );
  }

  const grade = scoreGrade(stats.edge_score);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {/* Edge Score - hero card */}
      <div className="col-span-2 rounded-lg border border-border bg-card p-4 sm:col-span-1">
        <div className="text-xs font-medium text-muted-foreground">Edge Score</div>
        <div className={cn("text-3xl font-bold tabular-nums", grade.className)}>
          {stats.edge_score}
        </div>
        <div className={cn("text-xs font-medium", grade.className)}>{grade.label}</div>
      </div>

      <StatCard
        label="Win Rate"
        value={`${(stats.win_rate * 100).toFixed(1)}%`}
        colorClass={metricColor(stats.win_rate, [0.45, 0.55])}
      />
      <StatCard
        label="Avg R"
        value={stats.avg_r.toFixed(2)}
        colorClass={metricColor(stats.avg_r, [0, 0.3])}
      />
      <StatCard
        label="Sharpe"
        value={stats.sharpe.toFixed(2)}
        colorClass={metricColor(stats.sharpe, [0.5, 1.5])}
      />
      <StatCard
        label="Sortino"
        value={stats.sortino.toFixed(2)}
        colorClass={metricColor(stats.sortino, [0.5, 2.0])}
      />
      <StatCard
        label="Profit Factor"
        value={stats.profit_factor === Infinity ? "Inf" : stats.profit_factor.toFixed(2)}
        colorClass={metricColor(Math.min(stats.profit_factor, 10), [1.0, 1.5])}
      />
      <StatCard
        label="Max Drawdown"
        value={`${(stats.max_drawdown * 100).toFixed(1)}%`}
        colorClass={stats.max_drawdown < 0.1 ? "text-emerald-400" : stats.max_drawdown < 0.2 ? "text-yellow-400" : "text-red-400"}
      />
      <StatCard
        label="Expectancy"
        value={stats.expectancy.toFixed(3)}
        colorClass={metricColor(stats.expectancy, [0, 0.2])}
      />
      <StatCard
        label="Total Trades"
        value={String(stats.total_trades)}
        colorClass={stats.total_trades >= 50 ? "text-emerald-400" : stats.total_trades >= 20 ? "text-yellow-400" : "text-red-400"}
      />
    </div>
  );
}

function StatCard({ label, value, colorClass }: { label: string; value: string; colorClass: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("text-xl font-bold tabular-nums", colorClass)}>{value}</div>
    </div>
  );
}
