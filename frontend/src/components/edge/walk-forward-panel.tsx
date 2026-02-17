"use client";

import type { WalkForwardResult } from "@/lib/api/edge-client";
import { cn } from "@/lib/utils";

interface WalkForwardPanelProps {
  result: WalkForwardResult | null | undefined;
}

export function WalkForwardPanel({ result }: WalkForwardPanelProps) {
  if (!result) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        Walk-forward requires 40+ trades with outcomes. Keep recording.
      </div>
    );
  }

  if (result.windows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        Not enough data for walk-forward windows. Need at least {30 + 10} trades with outcomes.
      </div>
    );
  }

  const agg = result.aggregate;

  return (
    <div className="space-y-3">
      {/* Aggregate */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <AggCard
          label="OOS Win Rate"
          value={`${(agg.oos_win_rate * 100).toFixed(1)}%`}
          good={agg.oos_win_rate > 0.5}
        />
        <AggCard
          label="OOS Avg R"
          value={agg.oos_avg_r.toFixed(3)}
          good={agg.oos_avg_r > 0}
        />
        <AggCard
          label="OOS Sharpe"
          value={agg.oos_sharpe.toFixed(2)}
          good={agg.oos_sharpe > 0.5}
        />
        <AggCard
          label="Windows"
          value={`${agg.total_windows}`}
          good={agg.total_windows >= 3}
        />
      </div>

      {/* Status badges */}
      <div className="flex gap-2">
        <span className={cn(
          "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
          agg.edge_stable
            ? "bg-emerald-500/20 text-emerald-400"
            : "bg-red-500/20 text-red-400"
        )}>
          {agg.edge_stable ? "Edge Stable" : "Edge Unstable"}
        </span>
        {agg.edge_decay_detected && (
          <span className="inline-flex items-center rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-400">
            Edge Decay Detected
          </span>
        )}
      </div>

      {/* Windows table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">#</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Test Period</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Win Rate</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Avg R</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Sharpe</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Best Weight</th>
            </tr>
          </thead>
          <tbody>
            {result.windows.map((w, i) => (
              <tr
                key={i}
                className="border-b border-border/50 transition-colors hover:bg-muted/20"
              >
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2 text-xs">
                  {w.test_start.slice(5, 10)} — {w.test_end.slice(5, 10)}
                </td>
                <td className={cn(
                  "px-3 py-2 text-right font-mono text-xs",
                  w.test_win_rate > 0.5 ? "text-emerald-400" : "text-red-400"
                )}>
                  {(w.test_win_rate * 100).toFixed(1)}%
                </td>
                <td className={cn(
                  "px-3 py-2 text-right font-mono text-xs",
                  w.test_avg_r > 0 ? "text-emerald-400" : "text-red-400"
                )}>
                  {w.test_avg_r.toFixed(3)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {w.test_sharpe.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[10px] text-muted-foreground">
                  C:{w.optimal_weights.claude.toFixed(1)} G:{w.optimal_weights.gpt4o.toFixed(1)} Ge:{w.optimal_weights.gemini.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AggCard({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-bold tabular-nums", good ? "text-emerald-400" : "text-red-400")}>
        {value}
      </div>
    </div>
  );
}
