"use client";

import { cn } from "@/lib/utils";
import type { StrategyLeaderboard } from "@/lib/api/autopsy-client";

interface StrategyRankingsProps {
  strategies: StrategyLeaderboard[];
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function StrategyRankings({ strategies }: StrategyRankingsProps) {
  if (strategies.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No strategy data available.
      </div>
    );
  }

  // Top 8 by total profit
  const ranked = [...strategies]
    .sort((a, b) => b.total_profit - a.total_profit)
    .slice(0, 8);

  const maxProfit = Math.max(...ranked.map((s) => Math.abs(s.total_profit)));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium text-muted-foreground">Holly Strategy Rankings</h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Top strategies by total P&L. Focus on high-profit, high-Sharpe strategies with low giveback.
      </p>
      <div className="space-y-2">
        {ranked.map((s, i) => {
          const positive = s.total_profit >= 0;
          const barWidth = maxProfit > 0 ? Math.abs(s.total_profit) / maxProfit * 100 : 0;

          return (
            <div key={s.strategy} className="group relative rounded-md border border-border/50 bg-card px-3 py-2.5 hover:border-border">
              {/* Background bar */}
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-l-md opacity-10",
                  positive ? "bg-emerald-400" : "bg-red-400"
                )}
                style={{ width: `${barWidth}%` }}
              />

              {/* Content */}
              <div className="relative flex items-center gap-3">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">{s.strategy}</span>
                    <span className={cn(
                      "ml-2 font-mono text-sm font-bold tabular-nums",
                      positive ? "text-emerald-400" : "text-red-400"
                    )}>
                      ${fmt(s.total_profit, 0)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>{s.total_trades} trades</span>
                    <span className={cn(s.win_rate >= 0.5 ? "text-emerald-400/70" : "text-red-400/70")}>
                      {(s.win_rate * 100).toFixed(0)}% win
                    </span>
                    <span>Sharpe {fmt(s.sharpe)}</span>
                    <span className={cn(
                      s.avg_giveback_ratio > 0.5 ? "text-red-400/70" : "text-yellow-400/70"
                    )}>
                      {(s.avg_giveback_ratio * 100).toFixed(0)}% giveback
                    </span>
                    {s.avg_r_multiple != null && (
                      <span>Avg R: {fmt(s.avg_r_multiple, 3)}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
