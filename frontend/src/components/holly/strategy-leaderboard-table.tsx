"use client";

import { useState } from "react";
import type { StrategyLeaderboard } from "@/lib/api/autopsy-client";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown } from "lucide-react";

interface StrategyLeaderboardTableProps {
  strategies: StrategyLeaderboard[];
}

type SortKey = keyof StrategyLeaderboard;

function scoreColor(value: number, thresholds: [number, number]): string {
  if (value >= thresholds[1]) return "text-emerald-400";
  if (value >= thresholds[0]) return "text-yellow-400";
  return "text-red-400";
}

export function StrategyLeaderboardTable({ strategies }: StrategyLeaderboardTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("total_profit");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  if (strategies.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No strategy data available. Import Holly trades to view leaderboard.
      </div>
    );
  }

  const sortedStrategies = [...strategies].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
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
              onClick={() => handleSort("strategy")}
            >
              <div className="flex items-center gap-1">
                Strategy <SortIcon colKey="strategy" />
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
              onClick={() => handleSort("win_rate")}
            >
              <div className="flex items-center justify-end gap-1">
                Win Rate <SortIcon colKey="win_rate" />
              </div>
            </th>
            <th
              className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              onClick={() => handleSort("avg_r_multiple")}
            >
              <div className="flex items-center justify-end gap-1">
                Avg R <SortIcon colKey="avg_r_multiple" />
              </div>
            </th>
            <th
              className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              onClick={() => handleSort("total_profit")}
            >
              <div className="flex items-center justify-end gap-1">
                Total P/L <SortIcon colKey="total_profit" />
              </div>
            </th>
            <th
              className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              onClick={() => handleSort("giveback_ratio")}
            >
              <div className="flex items-center justify-end gap-1">
                Giveback % <SortIcon colKey="avg_giveback_ratio" />
              </div>
            </th>
            <th
              className="px-3 py-2 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              onClick={() => handleSort("avg_hold_minutes")}
            >
              <div className="flex items-center justify-end gap-1">
                Hold Time <SortIcon colKey="avg_hold_minutes" />
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
              onClick={() => handleSort("profit_factor")}
            >
              <div className="flex items-center justify-end gap-1">
                PF <SortIcon colKey="profit_factor" />
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedStrategies.map((s) => (
            <tr key={s.strategy} className="border-b border-border/50 transition-colors hover:bg-muted/20">
              <td className="px-3 py-2 font-medium">{s.strategy}</td>
              <td className="px-3 py-2 text-right font-mono text-xs">{s.total_trades}</td>
              <td className={cn("px-3 py-2 text-right font-mono text-xs", scoreColor(s.win_rate, [0.45, 0.55]))}>
                {(s.win_rate * 100).toFixed(1)}%
              </td>
              <td className={cn("px-3 py-2 text-right font-mono text-xs", scoreColor(s.avg_r_multiple ?? 0, [0, 0.3]))}>
                {s.avg_r_multiple?.toFixed(2) ?? "N/A"}
              </td>
              <td className={cn("px-3 py-2 text-right font-mono text-xs font-bold", s.total_profit >= 0 ? "text-emerald-400" : "text-red-400")}>
                ${s.total_profit.toFixed(0)}
              </td>
              <td className={cn("px-3 py-2 text-right font-mono text-xs", s.avg_giveback_ratio > 0.5 ? "text-red-400" : s.avg_giveback_ratio > 0.3 ? "text-yellow-400" : "text-emerald-400")}>
                {(s.avg_giveback_ratio * 100).toFixed(0)}%
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                {Math.round(s.avg_hold_minutes)}m
              </td>
              <td className={cn("px-3 py-2 text-right font-mono text-xs", scoreColor(s.sharpe, [0.5, 1.5]))}>
                {s.sharpe.toFixed(2)}
              </td>
              <td className={cn("px-3 py-2 text-right font-mono text-xs", scoreColor(s.profit_factor, [1.0, 1.5]))}>
                {s.profit_factor === 999 ? "Inf" : s.profit_factor.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
