"use client";

import type { StrategyOptimization } from "@/lib/api/performance-client";
import { cn } from "@/lib/utils";

interface StrategyDetailCardsProps {
  strategies: StrategyOptimization[];
}

function formatTrailParams(params: StrategyOptimization["best_trailing"]["params"]): string {
  switch (params.type) {
    case "fixed_pct":
      return `Trail: ${(params.trail_pct ?? 0) * 100}%`;
    case "atr_multiple":
      return `ATR: ${params.atr_mult ?? 0}x`;
    case "time_decay":
      return `Target: ${(params.initial_target_pct ?? 0) * 100}%, Decay: ${params.decay_per_min ?? 0}/min`;
    case "mfe_escalation":
      return `MFE trigger: ${(params.mfe_trigger_pct ?? 0) * 100}%, Tight: ${(params.tight_trail_pct ?? 0) * 100}%`;
    case "breakeven_trail":
      return `BE @ ${params.be_trigger_r ?? 0}R, Trail: ${(params.post_be_trail_pct ?? 0) * 100}%`;
    default:
      return params.name;
  }
}

export function StrategyDetailCards({ strategies }: StrategyDetailCardsProps) {
  if (strategies.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No strategy details available.
      </div>
    );
  }

  // Take top 6 strategies by P/L improvement
  const topStrategies = [...strategies]
    .sort((a, b) => b.best_trailing.pnl_improvement - a.best_trailing.pnl_improvement)
    .slice(0, 6);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {topStrategies.map((s) => {
        const best = s.best_trailing;
        const improvement = best.pnl_improvement;
        const improvementPct = best.pnl_improvement_pct;

        return (
          <div key={s.holly_strategy} className="rounded-lg border border-border bg-card p-4">
            <h4 className="mb-3 text-sm font-semibold">{s.holly_strategy}</h4>
            
            <div className="mb-3 space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Trades</span>
                <span className="font-mono text-xs">{s.total_trades}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Best Trailing</span>
                <span className="font-mono text-xs text-emerald-400">{best.params.name}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Params</span>
                <span className="font-mono text-xs text-muted-foreground">{formatTrailParams(best.params)}</span>
              </div>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Original P/L</span>
                <span className={cn("font-mono text-xs", best.original.total_pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                  ${best.original.total_pnl.toFixed(0)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Optimized P/L</span>
                <span className={cn("font-mono text-xs font-bold", best.simulated.total_pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                  ${best.simulated.total_pnl.toFixed(0)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Improvement</span>
                <span className={cn("font-mono text-xs font-bold", improvement >= 0 ? "text-emerald-400" : "text-red-400")}>
                  ${improvement.toFixed(0)} ({improvementPct > 0 ? "+" : ""}{improvementPct.toFixed(1)}%)
                </span>
              </div>
            </div>

            <div className="mt-3 space-y-1 border-t border-border pt-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Win Rate</span>
                <span className="font-mono text-xs">
                  {(best.original.win_rate * 100).toFixed(1)}% → {(best.simulated.win_rate * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Sharpe</span>
                <span className="font-mono text-xs">
                  {best.original.sharpe.toFixed(2)} → {best.simulated.sharpe.toFixed(2)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Giveback</span>
                <span className="font-mono text-xs text-yellow-400">
                  {(best.original.avg_giveback_ratio * 100).toFixed(0)}% → {(best.simulated.avg_giveback_ratio * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
