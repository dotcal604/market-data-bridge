"use client";

import { cn } from "@/lib/utils";
import type { TraderSyncTrade } from "@/lib/api/analytics-client";
import type { HollyTradeStats } from "@/lib/api/performance-client";

interface OverviewStatsProps {
  trades: TraderSyncTrade[];
  hollyStats?: HollyTradeStats | null;
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function OverviewStats({ trades, hollyStats }: OverviewStatsProps) {
  const totalPnl = trades.reduce((s, t) => s + (t.return_dollars ?? 0), 0);
  const totalComm = trades.reduce((s, t) => s + (t.commission ?? 0), 0);
  const wins = trades.filter((t) => t.status === "WIN").length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const rValues = trades.filter((t) => t.r_multiple != null).map((t) => t.r_multiple!);
  const avgR = rValues.length > 0 ? rValues.reduce((s, r) => s + r, 0) / rValues.length : 0;

  // Last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentTrades = trades.filter((t) => t.open_date && new Date(t.open_date) >= thirtyDaysAgo);
  const recentPnl = recentTrades.reduce((s, t) => s + (t.return_dollars ?? 0), 0);
  const recentWins = recentTrades.filter((t) => t.status === "WIN").length;
  const recentWinRate = recentTrades.length > 0 ? (recentWins / recentTrades.length) * 100 : 0;

  const pnlColor = totalPnl >= 0 ? "text-emerald-400" : "text-red-400";
  const recentColor = recentPnl >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Net P&L (All Time)</p>
        <p className={cn("mt-1 text-xl font-bold tabular-nums", pnlColor)}>
          ${fmt(totalPnl)}
        </p>
        <p className="text-[10px] text-muted-foreground">{trades.length} trades</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Last 30 Days</p>
        <p className={cn("mt-1 text-xl font-bold tabular-nums", recentColor)}>
          ${fmt(recentPnl)}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {recentTrades.length} trades · {recentWinRate.toFixed(0)}% win
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Win Rate</p>
        <p className={cn("mt-1 text-xl font-bold tabular-nums",
          winRate >= 55 ? "text-emerald-400" : winRate >= 45 ? "text-yellow-400" : "text-red-400"
        )}>
          {winRate.toFixed(1)}%
        </p>
        <p className="text-[10px] text-muted-foreground">{wins}W / {trades.length - wins}L</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Avg R-Multiple</p>
        <p className={cn("mt-1 text-xl font-bold tabular-nums",
          avgR > 0 ? "text-emerald-400" : avgR < 0 ? "text-red-400" : "text-foreground"
        )}>
          {avgR.toFixed(3)}
        </p>
        <p className="text-[10px] text-muted-foreground">{rValues.length} w/ R data</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Commissions</p>
        <p className="mt-1 text-xl font-bold tabular-nums text-yellow-400">
          ${fmt(totalComm)}
        </p>
        <p className={cn("text-[10px]",
          totalComm > Math.abs(totalPnl) ? "text-red-400" : "text-muted-foreground"
        )}>
          {totalPnl !== 0 ? `${(totalComm / Math.max(1, Math.abs(totalPnl)) * 100).toFixed(0)}% of gross` : ""}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Holly Trades</p>
        <p className="mt-1 text-xl font-bold tabular-nums">
          {hollyStats ? fmt(hollyStats.total_trades) : "—"}
        </p>
        {hollyStats && (
          <p className="text-[10px] text-muted-foreground">
            {(hollyStats.win_rate * 100).toFixed(0)}% win · PF {hollyStats.profit_factor.toFixed(2)}
          </p>
        )}
      </div>
    </div>
  );
}
