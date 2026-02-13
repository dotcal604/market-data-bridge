"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { EvalStats } from "@/lib/api/types";
import { modelColor } from "@/lib/utils/colors";
import { formatPercent, formatMs } from "@/lib/utils/formatters";

interface Props {
  stats: EvalStats;
}

const MODEL_LABELS: Record<string, string> = {
  "gpt-4o": "GPT-4o",
  "claude-sonnet": "Claude Sonnet",
  "gemini-flash": "Gemini Flash",
};

export function ModelComparison({ stats }: Props) {
  const modelIds = Object.keys(stats.model_compliance).sort();
  
  // Get detailed model stats if available (from backend's model_stats array)
  const modelDetails = (stats as any).model_stats as Array<{
    model_id: string;
    total: number;
    compliant: number;
    avg_score: number;
    avg_confidence: number;
    avg_latency_ms: number;
  }> || [];

  const modelMap = new Map(modelDetails.map(m => [m.model_id, m]));

  return (
    <div className="space-y-6">
      {/* Compliance Rates */}
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Model Compliance</CardTitle>
          <p className="text-sm text-muted-foreground">
            Percentage of valid (schema-compliant) responses
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {modelIds.length === 0 ? (
            <p className="text-sm text-muted-foreground">No model data available yet</p>
          ) : (
            modelIds.map((modelId) => {
              const compliance = stats.model_compliance[modelId];
              const color = modelColor(modelId);
              const label = MODEL_LABELS[modelId] || modelId;

              return (
                <div key={modelId} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-sm font-medium">{label}</span>
                    </div>
                    <span className="font-mono text-sm font-semibold">
                      {formatPercent(compliance)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${compliance * 100}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Average Latency */}
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Model Latency</CardTitle>
          <p className="text-sm text-muted-foreground">
            Average response time per model
          </p>
        </CardHeader>
        <CardContent>
          {modelIds.length === 0 ? (
            <p className="text-sm text-muted-foreground">No model data available yet</p>
          ) : (
            <div className="space-y-3">
              {modelIds.map((modelId) => {
                const color = modelColor(modelId);
                const label = MODEL_LABELS[modelId] || modelId;
                const details = modelMap.get(modelId);
                const latency = details?.avg_latency_ms ?? 0;

                return (
                  <div
                    key={modelId}
                    className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-sm font-medium">{label}</span>
                    </div>
                    <span className="font-mono text-sm font-semibold">
                      {formatMs(latency)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Guardrails Section */}
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Guardrails</CardTitle>
          <p className="text-sm text-muted-foreground">
            Post-ensemble behavioral filters
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Block Rate</span>
            <Badge
              variant="outline"
              className={
                stats.guardrail_block_rate > 0.2
                  ? "bg-yellow-400/15 text-yellow-400 border-yellow-400/30"
                  : "bg-emerald-400/15 text-emerald-400 border-emerald-400/30"
              }
            >
              {formatPercent(stats.guardrail_block_rate)}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Outcomes Recorded</span>
            <span className="font-mono text-sm font-semibold">
              {stats.outcomes_recorded}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
