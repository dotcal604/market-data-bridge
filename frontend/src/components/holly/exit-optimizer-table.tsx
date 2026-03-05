"use client";

import { useState } from "react";
import type { StrategyExitSummary, OptimizerParams } from "@/lib/api/exit-optimizer-client";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, ShieldCheck, ShieldAlert, Clock } from "lucide-react";

interface ExitOptimizerTableProps {
  strategies: StrategyExitSummary[];
}

type SortKey =
  | "strategy"
  | "exit_rule"
  | "trade_count"
  | "win_rate"
  | "profit_factor"
  | "sharpe"
  | "avg_hold_minutes"
  | "walk_forward_validated"
  | "walk_forward_sharpe";

function scoreColor(value: number, thresholds: [number, number]): string {
  if (value >= thresholds[1]) return "text-emerald-400";
  if (value >= thresholds[0]) return "text-yellow-400";
  return "text-red-400";
}

function formatExitRule(rule: string): string {
  return rule
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatParams(params: OptimizerParams): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
    .join(", ");
}

export function ExitOptimizerTable({ strategies }: ExitOptimizerTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("sharpe");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterValidated, setFilterValidated] = useState(false);

  const filtered = filterValidated
    ? strategies.filter((s) => s.walk_forward_validated)
    : strategies;

  const sorted = [...filtered].sort((a, b) => {
    let aVal: number | string = 0;
    let bVal: number | string = 0;

    switch (sortKey) {
      case "strategy": aVal = a.strategy; bVal = b.strategy; break;
      case "exit_rule": aVal = a.exit_rule; bVal = b.exit_rule; break;
      case "trade_count": aVal = a.trade_count; bVal = b.trade_count; break;
      case "win_rate": aVal = a.win_rate; bVal = b.win_rate; break;
      case "profit_factor": aVal = a.profit_factor; bVal = b.profit_factor; break;
      case "sharpe": aVal = a.sharpe; bVal = b.sharpe; break;
      case "avg_hold_minutes": aVal = a.avg_hold_minutes; bVal = b.avg_hold_minutes; break;
      case "walk_forward_validated": aVal = a.walk_forward_validated ? 1 : 0; bVal = b.walk_forward_validated ? 1 : 0; break;
      case "walk_forward_sharpe": aVal = a.walk_forward_sharpe ?? -999; bVal = b.walk_forward_sharpe ?? -999; break;
    }

    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortDir === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? <ArrowUp className="inline h-3 w-3" /> : <ArrowDown className="inline h-3 w-3" />;
  };

  const validatedCount = strategies.filter((s) => s.walk_forward_validated).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {filtered.length} strategies ({validatedCount} walk-forward validated)
        </div>
        <button
          onClick={() => setFilterValidated((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
            filterValidated
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
              : "border-border bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {filterValidated ? "Showing Validated Only" : "Show Validated Only"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {([
                ["strategy", "Strategy"],
                ["exit_rule", "Exit Rule"],
                ["trade_count", "Trades"],
                ["win_rate", "Win Rate"],
                ["profit_factor", "PF"],
                ["sharpe", "Sharpe"],
                ["avg_hold_minutes", "Avg Hold"],
                ["walk_forward_validated", "WF"],
                ["walk_forward_sharpe", "WF Sharpe"],
              ] as [SortKey, string][]).map(([key, label]) => (
                <th
                  key={key}
                  onClick={() => handleSort(key)}
                  className="cursor-pointer px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground whitespace-nowrap"
                >
                  {label} <SortIcon col={key} />
                </th>
              ))}
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Params</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.strategy} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2 font-medium whitespace-nowrap">{s.strategy}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{formatExitRule(s.exit_rule)}</span>
                </td>
                <td className="px-3 py-2 tabular-nums text-right">{s.trade_count}</td>
                <td className={cn("px-3 py-2 tabular-nums text-right", scoreColor(s.win_rate, [0.5, 0.65]))}>
                  {(s.win_rate * 100).toFixed(1)}%
                </td>
                <td className={cn("px-3 py-2 tabular-nums text-right", scoreColor(s.profit_factor, [1.0, 2.0]))}>
                  {s.profit_factor > 100 ? ">100" : s.profit_factor.toFixed(2)}
                </td>
                <td className={cn("px-3 py-2 tabular-nums text-right", scoreColor(s.sharpe, [0, 2.0]))}>
                  {s.sharpe.toFixed(2)}
                </td>
                <td className="px-3 py-2 tabular-nums text-right whitespace-nowrap">
                  <Clock className="inline h-3 w-3 mr-1 text-muted-foreground" />
                  {s.avg_hold_minutes.toFixed(0)}m
                </td>
                <td className="px-3 py-2 text-center">
                  {s.walk_forward_validated ? (
                    <ShieldCheck className="inline h-4 w-4 text-emerald-400" />
                  ) : (
                    <ShieldAlert className="inline h-4 w-4 text-amber-400/60" />
                  )}
                </td>
                <td className={cn(
                  "px-3 py-2 tabular-nums text-right",
                  s.walk_forward_sharpe != null ? scoreColor(s.walk_forward_sharpe, [0, 5]) : "text-muted-foreground",
                )}>
                  {s.walk_forward_sharpe != null ? s.walk_forward_sharpe.toFixed(2) : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate" title={formatParams(s.params)}>
                  {formatParams(s.params)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
