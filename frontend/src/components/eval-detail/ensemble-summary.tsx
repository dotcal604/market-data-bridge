"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Evaluation } from "@/lib/api/types";
import { formatScore } from "@/lib/utils/formatters";
import { scoreColor } from "@/lib/utils/colors";
import { cn } from "@/lib/utils";

interface Props {
  evaluation: Evaluation;
}

export function EnsembleSummary({ evaluation: ev }: Props) {
  const metrics = [
    { label: "Trade Score", value: formatScore(ev.ensemble_trade_score), color: scoreColor(ev.ensemble_trade_score) },
    { label: "Median", value: formatScore(ev.ensemble_trade_score_median), color: scoreColor(ev.ensemble_trade_score_median) },
    { label: "E[R:R]", value: ev.ensemble_expected_rr.toFixed(1), color: "" },
    { label: "Confidence", value: `${(ev.ensemble_confidence * 100).toFixed(0)}%`, color: "" },
    { label: "Score Spread", value: ev.ensemble_score_spread.toFixed(1), color: "" },
    { label: "Disagree Penalty", value: ev.ensemble_disagreement_penalty.toFixed(2), color: "" },
  ];

  return (
    <Card className="bg-card">
      <CardContent className="flex items-center gap-6 py-4">
        {metrics.map((m) => (
          <div key={m.label} className="text-center">
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p className={cn("font-mono text-lg font-bold", m.color)}>{m.value}</p>
          </div>
        ))}

        <div className="ml-auto flex gap-2">
          <Badge variant={ev.ensemble_should_trade ? "default" : "secondary"} className="text-xs">
            {ev.ensemble_should_trade ? "TRADE" : "NO TRADE"}
          </Badge>
          {!!ev.ensemble_unanimous && (
            <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/30">
              UNANIMOUS
            </Badge>
          )}
          {!!ev.ensemble_majority_trade && (
            <Badge variant="outline" className="text-xs">MAJORITY</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
