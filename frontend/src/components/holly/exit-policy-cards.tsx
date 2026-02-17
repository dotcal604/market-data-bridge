"use client";

import type { ExitPolicyRec } from "@/lib/api/autopsy-client";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, AlertTriangle, Minus } from "lucide-react";

interface ExitPolicyCardsProps {
  recommendations: ExitPolicyRec[];
}

const ARCHETYPE_CONFIG = {
  early_peaker: {
    icon: TrendingDown,
    label: "Early Peaker",
    description: "Peaks quickly then gives back profit",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/30",
    iconClass: "text-red-400",
  },
  late_grower: {
    icon: TrendingUp,
    label: "Late Grower",
    description: "Profits grow over time",
    bgClass: "bg-emerald-500/10",
    borderClass: "border-emerald-500/30",
    iconClass: "text-emerald-400",
  },
  bleeder: {
    icon: AlertTriangle,
    label: "Bleeder",
    description: "High giveback, low win rate",
    bgClass: "bg-orange-500/10",
    borderClass: "border-orange-500/30",
    iconClass: "text-orange-400",
  },
  mixed: {
    icon: Minus,
    label: "Mixed",
    description: "No clear pattern",
    bgClass: "bg-muted/10",
    borderClass: "border-muted/30",
    iconClass: "text-muted-foreground",
  },
} as const;

export function ExitPolicyCards({ recommendations }: ExitPolicyCardsProps) {
  if (recommendations.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No exit policy recommendations available.
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {recommendations.map((rec) => {
        const config = ARCHETYPE_CONFIG[rec.archetype];
        const Icon = config.icon;

        return (
          <div
            key={rec.strategy}
            className={cn(
              "rounded-lg border p-4 transition-colors hover:bg-muted/5",
              config.bgClass,
              config.borderClass
            )}
          >
            <div className="mb-3 flex items-start gap-3">
              <div className={cn("rounded-md p-2", config.iconClass)}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-sm">{rec.strategy}</h4>
                <div className={cn("text-xs font-medium mt-0.5", config.iconClass)}>
                  {config.label}
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground mb-3">{config.description}</p>

            <div className="rounded-md bg-card/50 p-3 mb-3">
              <p className="text-xs leading-relaxed">{rec.recommendation}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">Peak Time</div>
                <div className="font-mono font-medium">
                  {Math.round(rec.supporting_data.avg_time_to_mfe_min)}min
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Giveback</div>
                <div className="font-mono font-medium">
                  {(rec.supporting_data.avg_giveback_ratio * 100).toFixed(0)}%
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Avg Hold</div>
                <div className="font-mono font-medium">
                  {Math.round(rec.supporting_data.avg_hold_minutes)}min
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Early→Late</div>
                <div className="font-mono font-medium">
                  {(rec.supporting_data.pct_peak_early_held_late * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
