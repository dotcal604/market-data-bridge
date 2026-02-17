"use client";

import type { FeatureAttribution } from "@/lib/api/edge-client";
import { cn } from "@/lib/utils";

interface FeatureAttributionTableProps {
  features: FeatureAttribution[];
}

const FEATURE_LABELS: Record<string, string> = {
  rvol: "Relative Volume",
  vwap_deviation_pct: "VWAP Deviation",
  spread_pct: "Bid-Ask Spread",
  volume_acceleration: "Volume Accel",
  atr_pct: "ATR %",
  gap_pct: "Gap %",
  range_position_pct: "Range Position",
  price_extension_pct: "Price Extension",
  spy_change_pct: "SPY Change",
  qqq_change_pct: "QQQ Change",
  minutes_since_open: "Min Since Open",
  ensemble_trade_score: "Ensemble Score",
};

function liftBar(lift: number): string {
  const pct = Math.min(Math.abs(lift) * 200, 100); // scale: 50pp = full bar
  return `${pct}%`;
}

export function FeatureAttributionTable({ features }: FeatureAttributionTableProps) {
  if (features.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        Not enough outcome data for feature attribution. Need 20+ trades with outcomes.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Feature</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">High WR</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Low WR</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Lift</th>
            <th className="px-3 py-2 font-medium text-muted-foreground w-32">Impact</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">n</th>
          </tr>
        </thead>
        <tbody>
          {features.map((f) => {
            const isPositive = f.lift > 0;
            const barColor = isPositive ? "bg-emerald-500/60" : "bg-red-500/60";
            const liftColor = f.significant
              ? (isPositive ? "text-emerald-400" : "text-red-400")
              : "text-muted-foreground";
            return (
              <tr key={f.feature} className="border-b border-border/50 transition-colors hover:bg-muted/20">
                <td className="px-3 py-2">
                  <span className="font-mono text-xs">{FEATURE_LABELS[f.feature] ?? f.feature}</span>
                  {f.significant && (
                    <span className="ml-1.5 inline-flex items-center rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                      SIG
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {(f.win_rate_when_high * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {(f.win_rate_when_low * 100).toFixed(1)}%
                </td>
                <td className={cn("px-3 py-2 text-right font-mono text-xs font-bold", liftColor)}>
                  {f.lift > 0 ? "+" : ""}{(f.lift * 100).toFixed(1)}pp
                </td>
                <td className="px-3 py-2">
                  <div className="h-2 w-full rounded-full bg-muted/40">
                    <div
                      className={cn("h-full rounded-full", barColor)}
                      style={{ width: liftBar(f.lift) }}
                    />
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                  {f.sample_high + f.sample_low}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
