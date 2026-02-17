"use client";

import { useState } from "react";
import type { StrategyOptimization } from "@/lib/api/performance-client";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown } from "lucide-react";

interface PerformanceLeaderboardProps {
  strategies: StrategyOptimization[];
}

type SortKey = "holly_strategy" | "total_trades" | "sharpe" | "win_rate" | "avg_r" | "profit_factor" | "pnl_improvement";

function scoreColor(value: number, thresholds: [number, number]): string {
  if (value >= thresholds[1]) return "text-emerald-400";
  if (value >= thresholds[0]) return "text-yellow-400";
  return "text-red-400";
}

export function PerformanceLeaderboard({ strategies }: PerformanceLeaderboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>("pnl_improvement");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  if (strategies.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No strategy data available. Import Holly trades to view performance leaderboard.
      </div>
    );
  }

  const sortedStrategies = [...strategies].sort((a, b) => {
    let aVal: number | string;
    let bVal: number | string;

    switch (sortKey) {
      case "holly_strategy":
        aVal = a.holly_strategy;
        bVal = b.holly_strategy;
        break;
      case "total_trades":
        aVal = a.total_trades;
        bVal = b.total_trades;
        break;
      case "sharpe":
        aVal = a.best_trailing.simulated.sharpe;
        bVal = b.best_trailing.simulated.sharpe;
        break;
      case "win_rate":
        aVal = a.best_trailing.simulated.win_rate;
        bVal = b.best_trailing.simulated.win_rate;
        break;
      case "avg_r":
        aVal = a.best_trailing.original.avg_pnl; // Use avg_pnl as proxy for avg R
        bVal = b.best_trailing.original.avg_pnl;
        break;
      case "profit_factor":
        // Calculate profit factor from win rate and avg pnl
        aVal = a.best_trailing.simulated.win_rate > 0 ? a.best_trailing.simulated.avg_pnl : 0;
        bVal = b.best_trailing.simulated.win_rate > 0 ? b.best_trailing.simulated.avg_pnl : 0;
        break;
      case "pnl_improvement":
        aVal = a.best_trailing.pnl_improvement;
        bVal = b.best_trailing.pnl_improvement;
        break;
      default:
        aVal = 0;
        bVal = 0;
    }

    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }

    const aNum = typeof aVal === "number" ? aVal : 0;
    const bNum = typeof bVal === "number" ? bVal : 0;
    return sortDir === "asc" ? aNum - bNum : bNum - aNum;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ colKey }: { colKey: SortKey }) => {
    if (sortKey !== colKey) return null;
    return sortDir === "desc" ? (
      <ArrowDown className="h-3 w-3" />
    ) : (
      <ArrowUp className="h-3 w-3" />
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th
              className="px-3 py-2 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              onClick={() => handleSort("holly_strategy")}
            >
              <div className="flex items-center gap-1">
                Strategy <SortIcon colKey="holly_strategy" />
              </div>
            </th>
            <th
              className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              onClick={() => handleSort("total_trades")}
            >
              <div className="flex items-center justify-end gap-1">
                Trades <SortIcon colKey="total_trades" />
              </div>
            </th>
            <th
              className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              onClick={() => handleSort("sharpe")}
            >
              <div className="flex items-center justify-end gap-1">
                Sharpe <SortIcon colKey="sharpe" />
              </div>
            </th>
            <th
              className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              onClick={() => handleSort("win_rate")}
            >
              <div className="flex items-center justify-end gap-1">
                Win Rate <SortIcon colKey="win_rate" />
              </div>
            </th>
            <th
              className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              onClick={() => handleSort("avg_r")}
            >
              <div className="flex items-center justify-end gap-1">
                Avg P/L <SortIcon colKey="avg_r" />
              </div>
            </th>
            <th
              className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              onClick={() => handleSort("pnl_improvement")}
            >
              <div className="flex items-center justify-end gap-1">
                P/L Improvement <SortIcon colKey="pnl_improvement" />
              </div>
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              Best Trailing
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedStrategies.map((s) => (
            <tr key={s.holly_strategy} className="border-b border-border/50 transition-colors hover:bg-muted/20">
              <td className="px-3 py-2 font-medium">{s.holly_strategy}</td>
              <td className="px-3 py-2 text-right font-mono text-xs">{s.total_trades}</td>
              <td className={cn("px-3 py-2 text-right font-mono text-xs", scoreColor(s.best_trailing.simulated.sharpe, [0.5, 1.5]))}>
                {s.best_trailing.simulated.sharpe.toFixed(2)}
              </td>
              <td className={cn("px-3 py-2 text-right font-mono text-xs", scoreColor(s.best_trailing.simulated.win_rate, [0.45, 0.55]))}>
                {(s.best_trailing.simulated.win_rate * 100).toFixed(1)}%
              </td>
              <td className={cn("px-3 py-2 text-right font-mono text-xs", s.best_trailing.simulated.avg_pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                ${s.best_trailing.simulated.avg_pnl.toFixed(0)}
              </td>
              <td className={cn("px-3 py-2 text-right font-mono text-xs font-bold", s.best_trailing.pnl_improvement >= 0 ? "text-emerald-400" : "text-red-400")}>
                ${s.best_trailing.pnl_improvement.toFixed(0)}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {s.best_trailing.params.name}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
