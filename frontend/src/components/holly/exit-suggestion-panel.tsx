"use client";

import { useState } from "react";
import { useSuggestExits } from "@/lib/hooks/use-exit-optimizer";
import type { StrategyExitSummary } from "@/lib/api/exit-optimizer-client";
import { cn } from "@/lib/utils";
import { ShieldCheck, ShieldAlert, Target, TrendingDown, Zap, Info } from "lucide-react";

interface ExitSuggestionPanelProps {
  strategies: StrategyExitSummary[];
}

export function ExitSuggestionPanel({ strategies }: ExitSuggestionPanelProps) {
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [shares, setShares] = useState("100");
  const [strategy, setStrategy] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const params = submitted && symbol && entryPrice && stopPrice
    ? {
        symbol: symbol.toUpperCase(),
        direction,
        entry_price: parseFloat(entryPrice),
        stop_price: parseFloat(stopPrice),
        total_shares: parseInt(shares) || 100,
        strategy: strategy || undefined,
      }
    : null;

  const { data: suggestion, isLoading, error } = useSuggestExits(params);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  const strategyNames = [...new Set(strategies.map((s) => s.strategy))].sort();
  const riskPerShare = entryPrice && stopPrice ? Math.abs(parseFloat(entryPrice) - parseFloat(stopPrice)) : 0;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Symbol</label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => { setSymbol(e.target.value); setSubmitted(false); }}
            placeholder="AAPL"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Direction</label>
          <select
            value={direction}
            onChange={(e) => { setDirection(e.target.value as "long" | "short"); setSubmitted(false); }}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          >
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Entry Price</label>
          <input
            type="number"
            step="0.01"
            value={entryPrice}
            onChange={(e) => { setEntryPrice(e.target.value); setSubmitted(false); }}
            placeholder="150.00"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Stop Price</label>
          <input
            type="number"
            step="0.01"
            value={stopPrice}
            onChange={(e) => { setStopPrice(e.target.value); setSubmitted(false); }}
            placeholder="148.50"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Shares</label>
          <input
            type="number"
            value={shares}
            onChange={(e) => { setShares(e.target.value); setSubmitted(false); }}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Strategy</label>
          <select
            value={strategy}
            onChange={(e) => { setStrategy(e.target.value); setSubmitted(false); }}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          >
            <option value="">Auto-detect</option>
            {strategyNames.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            className="w-full rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Suggest Exits
          </button>
        </div>
      </form>

      {isLoading && (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-muted-foreground">
          Computing optimal exit policy...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-400">
          {(error as Error).message}
        </div>
      )}

      {suggestion && (
        <div className="space-y-4">
          {/* Source & Validation Badge */}
          <div className="flex items-center gap-3">
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
              suggestion.source === "holly_optimized"
                ? "bg-blue-500/10 text-blue-400 border border-blue-500/30"
                : "bg-amber-500/10 text-amber-400 border border-amber-500/30",
            )}>
              {suggestion.source === "holly_optimized" ? "Optimizer-Driven" : "Heuristic Fallback"}
            </span>
            {suggestion.walk_forward_validated ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-3 py-1 text-xs font-medium">
                <ShieldCheck className="h-3.5 w-3.5" /> Walk-Forward Validated
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 px-3 py-1 text-xs font-medium">
                <ShieldAlert className="h-3.5 w-3.5" /> Not Validated
              </span>
            )}
          </div>

          {/* Exit Policy Cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Stop Loss */}
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                <TrendingDown className="h-3.5 w-3.5 text-red-400" /> Hard Stop
              </div>
              <div className="text-xl font-bold tabular-nums text-red-400">
                ${suggestion.policy.hard_stop.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Risk: ${riskPerShare.toFixed(2)}/share
              </div>
            </div>

            {/* TP Ladder */}
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                <Target className="h-3.5 w-3.5 text-emerald-400" /> Take Profit
              </div>
              {suggestion.policy.tp_ladder.map((tp) => (
                <div key={tp.label} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{tp.label}</span>
                  <span className="tabular-nums text-emerald-400">
                    ${tp.price.toFixed(2)} ({(tp.qty_pct * 100).toFixed(0)}%)
                  </span>
                </div>
              ))}
            </div>

            {/* Runner */}
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                <Zap className="h-3.5 w-3.5 text-blue-400" /> Runner Policy
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Trail</span>
                  <span className="tabular-nums">{(suggestion.policy.runner.trail_pct * 100).toFixed(1)}%</span>
                </div>
                {suggestion.policy.runner.atr_multiple && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ATR</span>
                    <span className="tabular-nums">{suggestion.policy.runner.atr_multiple}x</span>
                  </div>
                )}
                {suggestion.policy.runner.time_stop_min && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Time Stop</span>
                    <span className="tabular-nums">{suggestion.policy.runner.time_stop_min}m</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">BE Trail</span>
                  <span>{suggestion.policy.runner.be_trail ? "Yes" : "No"}</span>
                </div>
              </div>
            </div>

            {/* Optimizer Stats */}
            {suggestion.optimizer_data && (
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                  <Info className="h-3.5 w-3.5 text-purple-400" /> Optimizer Stats
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rule</span>
                    <span className="text-xs">{suggestion.optimizer_data.exit_rule.replace(/_/g, " ")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Win Rate</span>
                    <span className={cn("tabular-nums", scoreColor(suggestion.optimizer_data.win_rate, [0.5, 0.65]))}>
                      {(suggestion.optimizer_data.win_rate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sharpe</span>
                    <span className={cn("tabular-nums", scoreColor(suggestion.optimizer_data.sharpe, [0, 2]))}>
                      {suggestion.optimizer_data.sharpe.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Trades</span>
                    <span className="tabular-nums">{suggestion.optimizer_data.trade_count}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Walk-Forward OOS Stats */}
          {suggestion.walk_forward && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="text-xs font-medium text-emerald-400 mb-2">
                Walk-Forward Out-of-Sample Results ({suggestion.walk_forward.method}, {suggestion.walk_forward.n_folds} folds)
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">OOS Sharpe: </span>
                  <span className="tabular-nums font-medium">{suggestion.walk_forward.test_sharpe.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">OOS PF: </span>
                  <span className="tabular-nums font-medium">{suggestion.walk_forward.test_pf.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">OOS Win Rate: </span>
                  <span className="tabular-nums font-medium">{(suggestion.walk_forward.test_wr * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          {suggestion.notes.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-1">
              {suggestion.notes.map((note, i) => (
                <div key={i} className={cn(
                  "text-xs",
                  note.includes("Warning") || note.includes("warning") ? "text-amber-400" : "text-muted-foreground",
                )}>
                  {note}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function scoreColor(value: number, thresholds: [number, number]): string {
  if (value >= thresholds[1]) return "text-emerald-400";
  if (value >= thresholds[0]) return "text-yellow-400";
  return "text-red-400";
}
