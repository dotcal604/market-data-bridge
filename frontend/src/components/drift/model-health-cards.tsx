"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ModelDriftReport } from "@/lib/api/types";
import { modelColor } from "@/lib/utils/colors";
import { Activity, AlertCircle } from "lucide-react";

const MODEL_LABELS: Record<string, string> = {
  "gpt-4o": "GPT-4o",
  "claude-sonnet": "Claude Sonnet",
  "gemini-flash": "Gemini Flash",
};

interface ModelHealthCardsProps {
  models: ModelDriftReport[];
}

function AccuracyGauge({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  const percentage = value * 100;
  const isLow = percentage < 55;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span
          className={`font-mono text-xs font-semibold ${
            isLow ? "text-red-400" : "text-foreground"
          }`}
        >
          {percentage.toFixed(1)}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${percentage}%`,
            backgroundColor: isLow ? "#f87171" : color,
          }}
        />
      </div>
    </div>
  );
}

export function ModelHealthCards({ models }: ModelHealthCardsProps) {
  if (models.length === 0) {
    return (
      <Card className="bg-card">
        <CardContent className="py-12 text-center">
          <p className="text-lg font-medium text-muted-foreground">
            No drift data available
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Requires outcome data for drift analysis
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {models.map((model) => {
        const color = modelColor(model.model_id);
        const label = MODEL_LABELS[model.model_id] || model.model_id;
        const { rolling_accuracy, calibration_error, regime_shift_detected, sample_size } = model;

        return (
          <Card key={model.model_id} className="bg-card">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span>{label}</span>
                </div>
                {regime_shift_detected && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Shift
                  </Badge>
                )}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Sample: {sample_size} evaluations
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Rolling Accuracy Gauges */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Rolling Accuracy</span>
                </div>
                <AccuracyGauge
                  value={rolling_accuracy.last_50}
                  label="Last 50"
                  color={color}
                />
                <AccuracyGauge
                  value={rolling_accuracy.last_20}
                  label="Last 20"
                  color={color}
                />
                <AccuracyGauge
                  value={rolling_accuracy.last_10}
                  label="Last 10"
                  color={color}
                />
              </div>

              {/* Calibration Error */}
              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Calibration Error
                  </span>
                  <span
                    className={`font-mono text-xs font-semibold ${
                      calibration_error > 0.15 ? "text-yellow-400" : "text-foreground"
                    }`}
                  >
                    {(calibration_error * 100).toFixed(1)}%
                  </span>
                </div>
                {calibration_error > 0.15 && (
                  <p className="text-xs text-yellow-400">
                    Above threshold (15%)
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
