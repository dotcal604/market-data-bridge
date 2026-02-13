"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ModelEvaluation } from "@/lib/api/types";
import { ModelAvatar } from "@/components/shared/model-avatar";
import { ScoreBadge } from "@/components/shared/score-badge";
import { formatMs } from "@/lib/utils/formatters";
import { scoreColor } from "@/lib/utils/colors";
import { CheckCircle, XCircle } from "lucide-react";

interface Props {
  output: ModelEvaluation;
}

export function ModelCard({ output }: Props) {
  const compliant = !!output.compliant;

  return (
    <Card className="bg-card">
      <CardHeader className="flex flex-row items-center gap-3 pb-3">
        <ModelAvatar modelId={output.model_id} />
        <div className="flex-1">
          <p className="font-mono text-sm font-semibold">{output.model_id}</p>
          <p className="text-xs text-muted-foreground">{formatMs(output.latency_ms)}</p>
        </div>
        {compliant ? (
          <CheckCircle className="h-4 w-4 text-emerald-400" />
        ) : (
          <XCircle className="h-4 w-4 text-red-400" />
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {!compliant ? (
          <p className="text-sm text-red-400">{output.error ?? "Non-compliant response"}</p>
        ) : (
          <>
            {/* Score row */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Trade Score</span>
              {output.trade_score != null && <ScoreBadge score={output.trade_score} />}
            </div>

            {/* Metrics grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Metric label="Confidence" value={output.confidence != null ? `${(output.confidence * 100).toFixed(0)}%` : "—"} />
              <Metric label="E[R:R]" value={output.expected_rr?.toFixed(1) ?? "—"} />
              <Metric label="Extension" value={output.extension_risk?.toFixed(1) ?? "—"} />
              <Metric label="Exhaustion" value={output.exhaustion_risk?.toFixed(1) ?? "—"} />
              <Metric label="Float Rot." value={output.float_rotation_risk?.toFixed(1) ?? "—"} />
              <Metric label="Mkt Align" value={output.market_alignment_score?.toFixed(1) ?? "—"} />
            </div>

            {/* Should trade */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Should Trade:</span>
              <Badge
                variant={output.should_trade ? "default" : "destructive"}
                className="text-[10px]"
              >
                {output.should_trade ? "YES" : "NO"}
              </Badge>
            </div>

            {/* Reasoning */}
            {output.reasoning && (
              <div className="rounded-md bg-muted/50 p-2">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {output.reasoning}
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}
