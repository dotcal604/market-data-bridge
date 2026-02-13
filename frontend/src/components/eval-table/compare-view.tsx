"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { EvalDetail, FeatureVector } from "@/lib/api/types";
import { ScoreBadge } from "@/components/shared/score-badge";
import { DirectionBadge } from "@/components/shared/direction-badge";
import { ModelAvatar } from "@/components/shared/model-avatar";
import { formatTimestamp, formatPrice } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils";
import { scoreColor } from "@/lib/utils/colors";

interface Props {
  evaluations: EvalDetail[];
}

const FEATURE_KEYS = [
  "last",
  "rvol",
  "vwap_deviation_pct",
  "spread_pct",
  "gap_pct",
  "range_position_pct",
  "atr_pct",
  "price_extension_pct",
  "float_rotation_est",
  "volume_acceleration",
  "volatility_regime",
  "liquidity_bucket",
  "market_alignment",
] as const;

type FeatureKey = typeof FEATURE_KEYS[number];

function getFeatureDifference(
  values: (number | string | null)[],
  key: FeatureKey
): boolean {
  // For string features, just check if all values are the same
  if (typeof values[0] === "string") {
    return !values.every((v) => v === values[0]);
  }

  // For numeric features, check if difference > 10%
  const numericValues = values.filter(
    (v): v is number => typeof v === "number"
  );
  if (numericValues.length < 2) return false;

  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  const avg = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;

  // Calculate percentage difference from average
  const maxDiff = Math.max(Math.abs(max - avg), Math.abs(min - avg));
  return avg !== 0 && (maxDiff / Math.abs(avg)) > 0.1;
}

function formatFeatureValue(val: unknown): string {
  if (val == null) return "—";
  if (typeof val === "number") {
    if (Number.isInteger(val) && val > 1000) return val.toLocaleString();
    return val.toFixed(4).replace(/\.?0+$/, "");
  }
  return String(val);
}

export function CompareView({ evaluations }: Props) {
  if (evaluations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No evaluations to compare</p>
    );
  }

  const features = evaluations.map(
    (ev) => JSON.parse(ev.evaluation.features_json) as FeatureVector
  );

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className={cn(
        "grid gap-4",
        evaluations.length === 2 && "grid-cols-2",
        evaluations.length === 3 && "grid-cols-3",
        evaluations.length === 4 && "grid-cols-2 lg:grid-cols-4",
        evaluations.length === 5 && "grid-cols-2 lg:grid-cols-5"
      )}>
        {evaluations.map(({ evaluation: ev, outcome }) => (
          <Card key={ev.id} className="bg-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-lg font-bold">{ev.symbol}</span>
                <DirectionBadge direction={ev.direction} />
              </div>
              <p className="text-xs text-muted-foreground">
                {formatTimestamp(ev.timestamp)}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Score</span>
                <ScoreBadge score={ev.ensemble_trade_score} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Confidence</span>
                <span className="font-mono font-medium">
                  {(ev.ensemble_confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Should Trade</span>
                <Badge
                  variant={ev.ensemble_should_trade ? "default" : "destructive"}
                  className="text-[10px]"
                >
                  {ev.ensemble_should_trade ? "YES" : "NO"}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Price</span>
                <span className="font-mono font-medium">
                  {formatPrice(ev.last_price)}
                </span>
              </div>
              {outcome && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">R-Multiple</span>
                  <span className="font-mono font-medium text-emerald-400">
                    {outcome.r_multiple?.toFixed(2) ?? "—"}R
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Model Score Comparison */}
      <Card className="bg-card">
        <CardHeader>
          <h3 className="text-sm font-semibold">Model Scores</h3>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {["gpt-4o", "claude-sonnet", "gemini-flash"].map((modelId) => (
              <div key={modelId} className="flex items-center gap-4">
                <div className="flex items-center gap-2 w-32">
                  <ModelAvatar modelId={modelId} />
                  <span className="font-mono text-xs">{modelId}</span>
                </div>
                <div className="flex flex-1 items-center gap-2">
                  {evaluations.map(({ evaluation: ev, modelOutputs }) => {
                    const output = modelOutputs.find((m) => m.model_id === modelId);
                    const score = output?.trade_score ?? null;
                    return (
                      <div
                        key={ev.id}
                        className="flex-1 text-center"
                      >
                        {score != null ? (
                          <span className={cn("font-mono text-sm font-semibold", scoreColor(score))}>
                            {score.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Feature Comparison */}
      <Card className="bg-card">
        <CardHeader>
          <h3 className="text-sm font-semibold">Feature Comparison</h3>
          <p className="text-xs text-muted-foreground">
            Values differing &gt;10% are highlighted
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {FEATURE_KEYS.map((key) => {
              const values = features.map((f) => (f as unknown as Record<string, unknown>)[key]);
              const hasDifference = getFeatureDifference(values as (number | string | null)[], key);

              return (
                <div
                  key={key}
                  className={cn(
                    "flex items-center gap-4 py-1 text-xs",
                    hasDifference && "bg-yellow-400/10"
                  )}
                >
                  <span className={cn(
                    "font-mono w-40 text-muted-foreground",
                    hasDifference && "font-semibold text-yellow-400"
                  )}>
                    {key}
                  </span>
                  <div className="flex flex-1 items-center gap-2">
                    {values.map((val, idx) => (
                      <div
                        key={idx}
                        className="flex-1 text-center"
                      >
                        <span className={cn(
                          "font-mono",
                          hasDifference && "font-bold"
                        )}>
                          {formatFeatureValue(val)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
