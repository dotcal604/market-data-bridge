"use client";

import type { DriftReport } from "@/lib/api/drift-client";
import { cn } from "@/lib/utils";

interface ModelHealthCardsProps {
  report: DriftReport | undefined;
}

const MODEL_LABELS: Record<string, string> = {
  "claude-sonnet": "Claude Sonnet",
  "gpt-4o": "GPT-4o",
  "gemini-flash": "Gemini Flash",
};

function accuracyColor(accuracy: number | null): string {
  if (accuracy === null) return "text-muted-foreground";
  if (accuracy >= 0.6) return "text-emerald-400";
  if (accuracy >= 0.5) return "text-amber-400";
  return "text-red-400";
}

function calibrationColor(error: number): string {
  if (error < 0.10) return "text-emerald-400";
  if (error < 0.15) return "text-amber-400";
  return "text-red-400";
}

function formatPct(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export function ModelHealthCards({ report }: ModelHealthCardsProps) {
  if (!report) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4 animate-pulse">
            <div className="h-4 w-24 bg-muted rounded" />
            <div className="mt-3 h-8 w-16 bg-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  // Overall card + per-model cards
  const modelIds = Object.keys(report.models);

  return (
    <div className="space-y-4">
      {/* Overall */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-medium text-muted-foreground">Ensemble Overall</div>
        <div className="mt-2 grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Last 50</div>
            <div className={cn("text-lg font-mono font-semibold", accuracyColor(report.overall.accuracy_last_50))}>
              {formatPct(report.overall.accuracy_last_50)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Last 20</div>
            <div className={cn("text-lg font-mono font-semibold", accuracyColor(report.overall.accuracy_last_20))}>
              {formatPct(report.overall.accuracy_last_20)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Last 10</div>
            <div className={cn("text-lg font-mono font-semibold", accuracyColor(report.overall.accuracy_last_10))}>
              {formatPct(report.overall.accuracy_last_10)}
            </div>
          </div>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          {report.overall.evals_with_outcomes} / {report.overall.total_evals} evals with outcomes
        </div>
      </div>

      {/* Per-model cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {modelIds.map((modelId) => {
          const m = report.models[modelId];
          return (
            <div key={modelId} className="rounded-lg border border-border bg-card p-4">
              <div className="text-sm font-medium">{MODEL_LABELS[modelId] ?? modelId}</div>
              <div className="mt-2 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Last 50</span>
                  <span className={cn("font-mono", accuracyColor(m.accuracy_last_50))}>{formatPct(m.accuracy_last_50)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Last 20</span>
                  <span className={cn("font-mono", accuracyColor(m.accuracy_last_20))}>{formatPct(m.accuracy_last_20)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Last 10</span>
                  <span className={cn("font-mono", accuracyColor(m.accuracy_last_10))}>{formatPct(m.accuracy_last_10)}</span>
                </div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {m.with_outcomes} / {m.total} evals
              </div>
            </div>
          );
        })}
      </div>

      {/* Calibration */}
      {Object.keys(report.calibration).length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-medium text-muted-foreground mb-2">Calibration by Score Decile</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {Object.entries(report.calibration).map(([decile, cal]) => (
              <div key={decile} className="text-center">
                <div className="text-xs text-muted-foreground">{decile}</div>
                <div className={cn("text-sm font-mono", calibrationColor(cal.error))}>
                  {(cal.error * 100).toFixed(1)}%
                </div>
                <div className="text-[10px] text-muted-foreground">{cal.count} evals</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
