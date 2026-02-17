"use client";

import type { Signal } from "@/lib/api/signal-client";
import { cn } from "@/lib/utils";

interface SignalTableProps {
  signals: Signal[];
}

function scoreColor(score: number | null, shouldTrade: number): string {
  if (score === null) return "text-muted-foreground";
  if (shouldTrade === 0) return "text-red-400";
  if (score >= 60) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

function rowBg(signal: Signal): string {
  if (signal.prefilter_passed === 0) return "bg-red-950/20";
  if (signal.should_trade === 1 && (signal.ensemble_score ?? 0) >= 60) return "bg-emerald-950/20";
  if (signal.should_trade === 0) return "bg-red-950/10";
  return "";
}

export function SignalTable({ signals }: SignalTableProps) {
  if (signals.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No signals yet. Enable auto-eval and import Holly alerts to generate signals.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Symbol</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Direction</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Strategy</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Score</th>
            <th className="px-3 py-2 text-center font-medium text-muted-foreground">Verdict</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Time</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((signal) => (
            <tr
              key={signal.id}
              className={cn("border-b border-border/50 transition-colors hover:bg-muted/20", rowBg(signal))}
            >
              <td className="px-3 py-2 font-mono font-semibold">{signal.symbol}</td>
              <td className="px-3 py-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                    signal.direction === "long"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-red-500/20 text-red-400"
                  )}
                >
                  {signal.direction.toUpperCase()}
                </span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{signal.strategy ?? "—"}</td>
              <td className={cn("px-3 py-2 text-right font-mono font-semibold", scoreColor(signal.ensemble_score, signal.should_trade))}>
                {signal.ensemble_score != null ? signal.ensemble_score.toFixed(1) : "—"}
              </td>
              <td className="px-3 py-2 text-center">
                {signal.prefilter_passed === 0 ? (
                  <span className="text-xs text-red-400">BLOCKED</span>
                ) : signal.should_trade === 1 ? (
                  <span className="text-xs text-emerald-400">TRADE</span>
                ) : (
                  <span className="text-xs text-amber-400">PASS</span>
                )}
              </td>
              <td className="px-3 py-2 text-right text-xs text-muted-foreground font-mono">
                {new Date(signal.created_at).toLocaleTimeString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
