"use client";

import type { SegmentComparison } from "@/lib/api/autopsy-client";
import { cn } from "@/lib/utils";

interface SegmentComparisonProps {
  segments: SegmentComparison[];
}

function scoreColor(value: number, thresholds: [number, number]): string {
  if (value >= thresholds[1]) return "text-emerald-400";
  if (value >= thresholds[0]) return "text-yellow-400";
  return "text-red-400";
}

export function SegmentComparisonCards({ segments }: SegmentComparisonProps) {
  if (segments.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No segment comparison data available.
      </div>
    );
  }

  // Sort by total profit descending
  const sortedSegments = [...segments].sort((a, b) => b.total_profit - a.total_profit);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {sortedSegments.map((seg) => {
        const isPositive = seg.total_profit >= 0;
        return (
          <div
            key={seg.segment}
            className={cn(
              "rounded-lg border p-4 transition-colors hover:bg-muted/10",
              isPositive ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"
            )}
          >
            <div className="mb-3">
              <h4 className="font-semibold text-lg">{seg.segment}</h4>
              <div className="text-xs text-muted-foreground">{seg.total_trades} trades</div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Total P/L</span>
                <span
                  className={cn(
                    "font-mono text-sm font-bold",
                    isPositive ? "text-emerald-400" : "text-red-400"
                  )}
                >
                  ${seg.total_profit.toFixed(0)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Win Rate</span>
                <span className={cn("font-mono text-sm", scoreColor(seg.win_rate, [0.45, 0.55]))}>
                  {(seg.win_rate * 100).toFixed(1)}%
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Avg Profit</span>
                <span
                  className={cn(
                    "font-mono text-sm",
                    seg.avg_profit >= 0 ? "text-emerald-400" : "text-red-400"
                  )}
                >
                  ${seg.avg_profit.toFixed(2)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Avg R</span>
                <span
                  className={cn("font-mono text-sm", scoreColor(seg.avg_r_multiple ?? 0, [0, 0.3]))}
                >
                  {seg.avg_r_multiple?.toFixed(2) ?? "N/A"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Giveback %</span>
                <span
                  className={cn(
                    "font-mono text-sm",
                    seg.avg_giveback_ratio > 0.5
                      ? "text-red-400"
                      : seg.avg_giveback_ratio > 0.3
                      ? "text-yellow-400"
                      : "text-emerald-400"
                  )}
                >
                  {(seg.avg_giveback_ratio * 100).toFixed(0)}%
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Avg Hold</span>
                <span className="font-mono text-sm text-muted-foreground">
                  {Math.round(seg.avg_hold_minutes)}min
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
