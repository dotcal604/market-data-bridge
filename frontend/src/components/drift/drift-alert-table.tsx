"use client";

import type { DriftAlert } from "@/lib/api/drift-client";
import { cn } from "@/lib/utils";

interface DriftAlertTableProps {
  alerts: DriftAlert[];
}

function alertBadge(type: string): { label: string; className: string } {
  switch (type) {
    case "accuracy_drop":
      return { label: "Accuracy Drop", className: "bg-red-500/20 text-red-400" };
    case "calibration_drift":
      return { label: "Calibration", className: "bg-amber-500/20 text-amber-400" };
    case "regime_shift":
      return { label: "Regime Shift", className: "bg-purple-500/20 text-purple-400" };
    default:
      return { label: type, className: "bg-muted text-muted-foreground" };
  }
}

export function DriftAlertTable({ alerts }: DriftAlertTableProps) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No drift alerts detected. Models are performing within expected thresholds.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Type</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Model</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Message</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Value</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Threshold</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Time</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => {
            const badge = alertBadge(alert.alert_type);
            return (
              <tr
                key={alert.id}
                className="border-b border-border/50 transition-colors hover:bg-muted/20"
              >
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                      badge.className
                    )}
                  >
                    {badge.label}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {alert.model_id ?? "ensemble"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{alert.message}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {(alert.metric_value * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                  {(alert.threshold * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground font-mono">
                  {new Date(alert.created_at).toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
