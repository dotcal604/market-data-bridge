"use client";

import { useOptimalExitSummary, useOptimalExitMeta, useReloadOptimizer } from "@/lib/hooks/use-exit-optimizer";
import { ExitOptimizerTable } from "@/components/holly/exit-optimizer-table";
import { ExitSuggestionPanel } from "@/components/holly/exit-suggestion-panel";
import { RefreshCw, ShieldCheck, ShieldAlert, BarChart3, Database } from "lucide-react";
import { cn } from "@/lib/utils";

export default function HollyExitsPage() {
  const { data: summary, isLoading: summaryLoading } = useOptimalExitSummary();
  const { data: meta, isLoading: metaLoading } = useOptimalExitMeta();
  const reload = useReloadOptimizer();

  const isLoading = summaryLoading || metaLoading;
  const strategies = summary?.strategies ?? [];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Exit Optimizer</h1>
          <p className="text-sm text-muted-foreground">
            Data-driven exit strategies with walk-forward validation.
          </p>
        </div>
        <button
          onClick={() => reload.mutate()}
          disabled={reload.isPending}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", reload.isPending && "animate-spin")} />
          Reload Data
        </button>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          Loading optimizer data...
        </div>
      ) : !meta ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          No optimizer data available. Run the Python optimizer pipeline first.
        </div>
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Database className="h-3.5 w-3.5" /> Trades Analyzed
              </div>
              <div className="text-2xl font-bold tabular-nums mt-1">{meta.total_trades.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">{meta.data_range}</div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <BarChart3 className="h-3.5 w-3.5" /> Strategies
              </div>
              <div className="text-2xl font-bold tabular-nums mt-1">{meta.strategies_count}</div>
              <div className="text-xs text-muted-foreground">{meta.profitable_count} profitable</div>
            </div>

            {meta.walk_forward ? (
              <>
                <div className="rounded-lg border border-emerald-500/30 bg-card p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5" /> Walk-Forward Robust
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-emerald-400 mt-1">
                    {meta.walk_forward.robust_count}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {meta.walk_forward.method} / {meta.walk_forward.n_folds} folds
                  </div>
                </div>

                <div className="rounded-lg border border-amber-500/30 bg-card p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-400">
                    <ShieldAlert className="h-3.5 w-3.5" /> Overfit
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-amber-400 mt-1">
                    {meta.walk_forward.overfit_count}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    of {meta.walk_forward.total_evaluated} evaluated
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="text-xs font-medium text-muted-foreground">Validation Rate</div>
                  <div className="text-2xl font-bold tabular-nums mt-1">
                    {meta.walk_forward.total_evaluated > 0
                      ? ((meta.walk_forward.robust_count / meta.walk_forward.total_evaluated) * 100).toFixed(0)
                      : 0}%
                  </div>
                  <div className="text-xs text-muted-foreground">robust / total</div>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-amber-500/30 bg-card p-4 sm:col-span-3">
                <div className="flex items-center gap-2 text-xs font-medium text-amber-400">
                  <ShieldAlert className="h-3.5 w-3.5" /> Walk-Forward Not Run
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Run <code className="text-xs bg-muted px-1 py-0.5 rounded">python scripts/11_walk_forward.py --rolling</code> to validate.
                </div>
              </div>
            )}
          </div>

          {/* Exit Suggestion Simulator */}
          <div className="space-y-3">
            <h2 className="text-lg font-medium">Exit Suggestion Simulator</h2>
            <p className="text-sm text-muted-foreground">
              Enter trade parameters to get the optimal exit policy based on historical optimization data.
            </p>
            <ExitSuggestionPanel strategies={strategies} />
          </div>

          {/* Strategy Leaderboard */}
          <div className="space-y-3">
            <h2 className="text-lg font-medium">Strategy Exit Leaderboard</h2>
            <p className="text-sm text-muted-foreground">
              All strategies ranked by optimizer performance. Filter to show only walk-forward validated strategies.
            </p>
            <ExitOptimizerTable strategies={strategies} />
          </div>
        </>
      )}
    </div>
  );
}
