"use client";

import type { SignalStats, AutoEvalStatus } from "@/lib/api/signal-client";
import { cn } from "@/lib/utils";

interface SignalStatsCardProps {
  stats: SignalStats | undefined;
  autoEval: AutoEvalStatus | undefined;
  onToggle: (enabled: boolean) => void;
  isToggling: boolean;
}

export function SignalStatsCard({ stats, autoEval, onToggle, isToggling }: SignalStatsCardProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {/* Auto-Eval Toggle */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="text-xs text-muted-foreground">Auto-Eval</div>
        <div className="mt-1 flex items-center gap-2">
          <button
            onClick={() => onToggle(!autoEval?.enabled)}
            disabled={isToggling}
            className={cn(
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
              autoEval?.enabled ? "bg-emerald-500" : "bg-muted-foreground/30",
              isToggling && "opacity-50"
            )}
          >
            <span
              className={cn(
                "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
                autoEval?.enabled ? "translate-x-4" : "translate-x-0.5"
              )}
            />
          </button>
          <span className="text-sm font-medium">
            {autoEval?.enabled ? "ON" : "OFF"}
          </span>
        </div>
      </div>

      {/* Running */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="text-xs text-muted-foreground">Running</div>
        <div className="mt-1 text-lg font-mono font-semibold">
          {autoEval?.running ?? 0}
          <span className="text-xs text-muted-foreground">/{autoEval?.maxConcurrent ?? 3}</span>
        </div>
      </div>

      {/* Total Signals */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="text-xs text-muted-foreground">Total</div>
        <div className="mt-1 text-lg font-mono font-semibold">{stats?.total_signals ?? 0}</div>
      </div>

      {/* Tradeable */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="text-xs text-muted-foreground">Tradeable</div>
        <div className="mt-1 text-lg font-mono font-semibold text-emerald-400">
          {stats?.tradeable_signals ?? 0}
        </div>
      </div>

      {/* Blocked */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="text-xs text-muted-foreground">Blocked</div>
        <div className="mt-1 text-lg font-mono font-semibold text-red-400">
          {stats?.blocked_signals ?? 0}
        </div>
      </div>

      {/* Directions */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="text-xs text-muted-foreground">Long / Short</div>
        <div className="mt-1 text-sm font-mono">
          <span className="text-emerald-400">{stats?.long_signals ?? 0}</span>
          {" / "}
          <span className="text-red-400">{stats?.short_signals ?? 0}</span>
        </div>
      </div>
    </div>
  );
}
