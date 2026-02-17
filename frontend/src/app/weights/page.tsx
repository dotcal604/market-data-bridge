"use client";

import { useState, useEffect } from "react";
import { useEnsembleWeights } from "@/lib/hooks/use-evals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModelAvatar } from "@/components/shared/model-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { WeightSliders } from "@/components/weights/weight-sliders";
import { SimulateResults } from "@/components/weights/simulate-results";
import { WeightHistory } from "@/components/weights/weight-history";

export default function WeightsPage() {
  const { data, isLoading } = useEnsembleWeights();
  const [sliderWeights, setSliderWeights] = useState<Record<string, number>>({
    "gpt-4o": 0.33,
    "claude-sonnet": 0.34,
    "gemini-flash": 0.33,
  });

  // Sync slider state when server weights load
  useEffect(() => {
    if (data) {
      const mapped: Record<string, number> = {};
      for (const [key, value] of Object.entries(data)) {
        mapped[key] = value;
      }
      if (Object.keys(mapped).length > 0) {
        setSliderWeights((prev) => ({ ...prev, ...mapped }));
      }
    }
  }, [data]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ensemble Weights</h1>
        <p className="text-sm text-muted-foreground">
          Adjust model weights, simulate impact, and view history
        </p>
      </div>

      {/* Current weights hero cards */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : data ? (
        <div className="grid grid-cols-3 gap-4">
          {Object.entries(data).map(([modelId, weight]) => (
            <Card key={modelId} className="bg-card">
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <ModelAvatar modelId={modelId} />
                <CardTitle className="font-mono text-sm">{modelId}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-end gap-2">
                    <span className="font-mono text-3xl font-bold">
                      {(weight * 100).toFixed(0)}
                    </span>
                    <span className="mb-1 text-sm text-muted-foreground">%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-all"
                      style={{ width: `${weight * 100}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Failed to load weights</p>
      )}

      {/* Sliders + Simulation side by side */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <WeightSliders weights={sliderWeights} onChange={setSliderWeights} />
        <SimulateResults weights={sliderWeights} />
      </div>

      {/* History table */}
      <WeightHistory />
    </div>
  );
}
