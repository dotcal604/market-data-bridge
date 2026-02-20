"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { TraderSyncTrade } from "@/lib/api/analytics-client";

interface LongVsShortProps {
  trades: TraderSyncTrade[];
}

interface SideStats {
  side: string;
  pnl: number;
  trades: number;
  winRate: number;
  avgWinner: number;
  avgLoser: number;
  commissions: number;
  avgR: number;
}

function computeSideStats(trades: TraderSyncTrade[]): { long: SideStats; short: SideStats } {
  const sides = { long: "LONG" as const, short: "SHORT" as const };

  function stats(side: "LONG" | "SHORT"): SideStats {
    const filtered = trades.filter((t) => t.side === side);
    const wins = filtered.filter((t) => t.status === "WIN");
    const losses = filtered.filter((t) => t.status === "LOSS");
    const pnl = filtered.reduce((s, t) => s + (t.return_dollars ?? 0), 0);
    const comm = filtered.reduce((s, t) => s + (t.commission ?? 0), 0);
    const rValues = filtered.filter((t) => t.r_multiple != null).map((t) => t.r_multiple!);
    const avgR = rValues.length > 0 ? rValues.reduce((s, r) => s + r, 0) / rValues.length : 0;
    const avgWinner = wins.length > 0 ? wins.reduce((s, t) => s + (t.return_dollars ?? 0), 0) / wins.length : 0;
    const avgLoser = losses.length > 0 ? losses.reduce((s, t) => s + (t.return_dollars ?? 0), 0) / losses.length : 0;

    return {
      side: side === "LONG" ? "Long" : "Short",
      pnl: Math.round(pnl * 100) / 100,
      trades: filtered.length,
      winRate: filtered.length > 0 ? Math.round((wins.length / filtered.length) * 1000) / 10 : 0,
      avgWinner: Math.round(avgWinner * 100) / 100,
      avgLoser: Math.round(avgLoser * 100) / 100,
      commissions: Math.round(comm * 100) / 100,
      avgR: Math.round(avgR * 1000) / 1000,
    };
  }

  return { long: stats(sides.long), short: stats(sides.short) };
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function SideCard({ data, icon: Icon, accent }: { data: SideStats; icon: typeof TrendingUp; accent: string }) {
  const positive = data.pnl >= 0;

  return (
    <div className={cn(
      "flex-1 rounded-lg border p-5",
      positive ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"
    )}>
      <div className="mb-4 flex items-center gap-2">
        <Icon className={cn("h-5 w-5", accent)} />
        <h4 className="text-lg font-semibold">{data.side}</h4>
        <span className="ml-auto text-xs text-muted-foreground">{data.trades} trades</span>
      </div>

      <div className="mb-4">
        <div className="text-xs text-muted-foreground">Net P&L</div>
        <div className={cn("text-2xl font-bold tabular-nums", positive ? "text-emerald-400" : "text-red-400")}>
          ${fmt(data.pnl)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Win Rate</div>
          <div className={cn("text-sm font-semibold tabular-nums",
            data.winRate >= 55 ? "text-emerald-400" : data.winRate >= 45 ? "text-yellow-400" : "text-red-400"
          )}>
            {data.winRate}%
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Avg R</div>
          <div className={cn("text-sm font-semibold tabular-nums",
            data.avgR > 0 ? "text-emerald-400" : "text-red-400"
          )}>
            {data.avgR.toFixed(3)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Avg Winner</div>
          <div className="text-sm font-semibold tabular-nums text-emerald-400">
            +${fmt(data.avgWinner)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Avg Loser</div>
          <div className="text-sm font-semibold tabular-nums text-red-400">
            ${fmt(data.avgLoser)}
          </div>
        </div>
        <div className="col-span-2">
          <div className="text-xs text-muted-foreground">Commissions</div>
          <div className="text-sm font-semibold tabular-nums text-muted-foreground">
            ${fmt(data.commissions)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LongVsShort({ trades }: LongVsShortProps) {
  if (trades.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No trades for long vs short comparison.
      </div>
    );
  }

  const { long, short } = computeSideStats(trades);

  // Determine the verdict
  const verdict = short.pnl > long.pnl
    ? { text: "Shorts outperform longs", color: "text-emerald-400", detail: `+$${fmt(short.pnl - long.pnl)} edge` }
    : long.pnl > short.pnl
    ? { text: "Longs outperform shorts", color: "text-emerald-400", detail: `+$${fmt(long.pnl - short.pnl)} edge` }
    : { text: "Even performance", color: "text-yellow-400", detail: "" };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Long vs Short</h3>
        <span className={cn("text-xs font-medium", verdict.color)}>
          {verdict.text} {verdict.detail && `(${verdict.detail})`}
        </span>
      </div>
      <div className="flex gap-4">
        <SideCard data={long} icon={TrendingUp} accent="text-emerald-400" />
        <SideCard data={short} icon={TrendingDown} accent="text-red-400" />
      </div>
    </div>
  );
}
