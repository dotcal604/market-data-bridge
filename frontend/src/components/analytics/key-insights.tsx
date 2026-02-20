"use client";

import { AlertTriangle, CheckCircle, Target, Clock, TrendingDown, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TraderSyncTrade } from "@/lib/api/analytics-client";
import type { ExitAutopsyReport } from "@/lib/api/autopsy-client";

interface KeyInsightsProps {
  trades: TraderSyncTrade[];
  autopsy: ExitAutopsyReport | null;
}

interface Insight {
  type: "danger" | "edge" | "action";
  icon: typeof AlertTriangle;
  title: string;
  detail: string;
  metric?: string;
}

function generateInsights(trades: TraderSyncTrade[], autopsy: ExitAutopsyReport | null): Insight[] {
  const insights: Insight[] = [];

  // ─── 9AM leak ─────────────────────────────────────────────
  const nineAmTrades = trades.filter((t) => t.open_time && parseInt(t.open_time.split(":")[0]) === 9);
  if (nineAmTrades.length > 10) {
    const nineAmPnl = nineAmTrades.reduce((s, t) => s + (t.return_dollars ?? 0), 0);
    const nineAmWinRate = nineAmTrades.filter((t) => t.status === "WIN").length / nineAmTrades.length;
    if (nineAmPnl < -100) {
      insights.push({
        type: "danger",
        icon: Clock,
        title: "9 AM is your biggest leak",
        detail: `${nineAmTrades.length} trades at 9AM with ${(nineAmWinRate * 100).toFixed(0)}% win rate.`,
        metric: `-$${Math.abs(nineAmPnl).toFixed(0)}`,
      });
    }
  }

  // ─── Short vs Long edge ───────────────────────────────────
  const longs = trades.filter((t) => t.side === "LONG");
  const shorts = trades.filter((t) => t.side === "SHORT");
  const longPnl = longs.reduce((s, t) => s + (t.return_dollars ?? 0), 0);
  const shortPnl = shorts.reduce((s, t) => s + (t.return_dollars ?? 0), 0);

  if (shorts.length > 20 && shortPnl > longPnl + 500) {
    insights.push({
      type: "edge",
      icon: TrendingDown,
      title: "Your shorts outperform longs",
      detail: `Shorts: +$${shortPnl.toFixed(0)} vs Longs: $${longPnl.toFixed(0)}. Lean into your strength.`,
      metric: `+$${(shortPnl - longPnl).toFixed(0)}`,
    });
  }

  // ─── Commission drag ──────────────────────────────────────
  const totalPnl = trades.reduce((s, t) => s + (t.return_dollars ?? 0), 0);
  const totalComm = trades.reduce((s, t) => s + (t.commission ?? 0), 0);
  if (totalComm > totalPnl * 2 && totalComm > 500) {
    insights.push({
      type: "danger",
      icon: AlertTriangle,
      title: "Commissions exceed profits",
      detail: `$${totalComm.toFixed(0)} in commissions vs $${totalPnl.toFixed(0)} net P&L. Reduce trade frequency.`,
      metric: `${(totalComm / Math.max(1, Math.abs(totalPnl))).toFixed(1)}x`,
    });
  }

  // ─── Giveback problem ─────────────────────────────────────
  if (autopsy && autopsy.overview.overall_avg_giveback_ratio > 0.5) {
    const gb = autopsy.overview.overall_avg_giveback_ratio;
    insights.push({
      type: "danger",
      icon: Target,
      title: "Giving back too much profit",
      detail: `Average ${(gb * 100).toFixed(0)}% of peak profit returned to market. Tighten exits.`,
      metric: `${(gb * 100).toFixed(0)}%`,
    });
  }

  // ─── Holly segment edge ───────────────────────────────────
  if (autopsy?.segment_comparison) {
    const grail = autopsy.segment_comparison.find((s) => s.segment.includes("Grail"));
    const neo = autopsy.segment_comparison.find((s) => s.segment.includes("Neo"));
    if (grail && neo && grail.win_rate > neo.win_rate + 0.03) {
      insights.push({
        type: "edge",
        icon: Zap,
        title: "Holly Grail > Holly Neo",
        detail: `Grail: ${(grail.win_rate * 100).toFixed(1)}% win rate vs Neo: ${(neo.win_rate * 100).toFixed(1)}%. Prioritize Grail signals.`,
        metric: `+${((grail.win_rate - neo.win_rate) * 100).toFixed(1)}pp`,
      });
    }
  }

  // ─── Best trading hours ───────────────────────────────────
  const hourMap = new Map<number, { pnl: number; count: number }>();
  for (const t of trades) {
    if (!t.open_time) continue;
    const hr = parseInt(t.open_time.split(":")[0]);
    if (isNaN(hr)) continue;
    const b = hourMap.get(hr) ?? { pnl: 0, count: 0 };
    b.pnl += t.return_dollars ?? 0;
    b.count += 1;
    hourMap.set(hr, b);
  }
  const bestHours = [...hourMap.entries()]
    .filter(([, v]) => v.count >= 10 && v.pnl > 100)
    .sort(([, a], [, b]) => b.pnl - a.pnl)
    .slice(0, 2);
  if (bestHours.length > 0) {
    const labels = bestHours.map(([h]) => `${h > 12 ? h - 12 : h}${h >= 12 ? "PM" : "AM"}`);
    const totalBestPnl = bestHours.reduce((s, [, v]) => s + v.pnl, 0);
    insights.push({
      type: "action",
      icon: CheckCircle,
      title: `Your best hours: ${labels.join(", ")}`,
      detail: `Combined +$${totalBestPnl.toFixed(0)}. Concentrate trades in these windows.`,
      metric: `+$${totalBestPnl.toFixed(0)}`,
    });
  }

  return insights;
}

const TYPE_STYLES = {
  danger: { bg: "bg-red-500/10 border-red-500/30", iconColor: "text-red-400", badgeBg: "bg-red-500/20 text-red-400" },
  edge: { bg: "bg-emerald-500/10 border-emerald-500/30", iconColor: "text-emerald-400", badgeBg: "bg-emerald-500/20 text-emerald-400" },
  action: { bg: "bg-blue-500/10 border-blue-500/30", iconColor: "text-blue-400", badgeBg: "bg-blue-500/20 text-blue-400" },
};

export function KeyInsights({ trades, autopsy }: KeyInsightsProps) {
  const insights = generateInsights(trades, autopsy);

  if (insights.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">Key Insights</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {insights.map((insight, i) => {
          const styles = TYPE_STYLES[insight.type];
          const Icon = insight.icon;
          return (
            <div key={i} className={cn("rounded-lg border p-4", styles.bg)}>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className={cn("h-4 w-4", styles.iconColor)} />
                  <span className="text-sm font-semibold">{insight.title}</span>
                </div>
                {insight.metric && (
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", styles.badgeBg)}>
                    {insight.metric}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{insight.detail}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
