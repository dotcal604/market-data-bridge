"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useModelAgreement } from "@/lib/hooks/use-evals";
import { cn } from "@/lib/utils";

// Model display names
const MODEL_LABELS: Record<string, string> = {
  "claude-sonnet": "Claude",
  "gpt-4o": "GPT-4o",
  "gemini-flash": "Gemini",
};

// Color scale for agreement rate (0-1)
function getAgreementColor(rate: number): string {
  if (rate >= 0.8) return "bg-emerald-500/90";
  if (rate >= 0.7) return "bg-green-500/80";
  if (rate >= 0.6) return "bg-yellow-500/70";
  if (rate >= 0.5) return "bg-orange-500/70";
  return "bg-red-500/70";
}

// Text color for contrast
function getTextColor(rate: number): string {
  if (rate >= 0.6) return "text-white";
  return "text-white";
}

export function ModelAgreementHeatmap() {
  const { data, isLoading, isError } = useModelAgreement();

  const models = useMemo(() => {
    return data?.models ?? ["claude-sonnet", "gpt-4o", "gemini-flash"];
  }, [data?.models]);

  const agreement = data?.agreement ?? {};

  const hasData = models.length > 0 && Object.keys(agreement).length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Agreement Heatmap</CardTitle>
        <p className="text-sm text-muted-foreground">
          Pairwise agreement on trade direction (bull/bear/neutral)
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading agreement data…</p>
        ) : isError ? (
          <p className="text-sm text-red-400">Failed to load model agreement data.</p>
        ) : !hasData ? (
          <p className="text-sm text-muted-foreground">
            Insufficient evaluation data for agreement analysis.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Heatmap grid */}
            <div className="grid grid-cols-4 gap-2">
              {/* Top-left corner (empty) */}
              <div className="flex items-center justify-center" />
              
              {/* Column headers */}
              {models.map((model) => (
                <div
                  key={`col-${model}`}
                  className="flex items-center justify-center font-mono text-xs font-semibold text-muted-foreground"
                >
                  {MODEL_LABELS[model] || model}
                </div>
              ))}

              {/* Rows */}
              {models.map((rowModel) => (
                <>
                  {/* Row header */}
                  <div
                    key={`row-${rowModel}`}
                    className="flex items-center justify-end pr-2 font-mono text-xs font-semibold text-muted-foreground"
                  >
                    {MODEL_LABELS[rowModel] || rowModel}
                  </div>
                  
                  {/* Cells */}
                  {models.map((colModel) => {
                    const rate = agreement[rowModel]?.[colModel] ?? 0;
                    const isDiagonal = rowModel === colModel;
                    
                    return (
                      <div
                        key={`${rowModel}-${colModel}`}
                        className={cn(
                          "flex h-16 items-center justify-center rounded-lg border",
                          isDiagonal
                            ? "border-muted bg-muted/20"
                            : `${getAgreementColor(rate)} ${getTextColor(rate)} border-transparent`
                        )}
                      >
                        {isDiagonal ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <span className="font-mono text-sm font-bold">
                            {(rate * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-red-500/70" />
                <span>&lt;50%</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-orange-500/70" />
                <span>50-60%</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-yellow-500/70" />
                <span>60-70%</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-green-500/80" />
                <span>70-80%</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-emerald-500/90" />
                <span>≥80%</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
