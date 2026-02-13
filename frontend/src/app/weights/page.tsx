"use client";

import { useEnsembleWeights } from "@/lib/hooks/use-evals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModelAvatar } from "@/components/shared/model-avatar";
import { Skeleton } from "@/components/ui/skeleton";

export default function WeightsPage() {
  const { data, isLoading } = useEnsembleWeights();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ensemble Weights</h1>
        <p className="text-sm text-muted-foreground">
          Current model weights used for ensemble scoring
        </p>
      </div>

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
                  <p className="text-xs text-muted-foreground">
                    Raw weight: {weight.toFixed(4)}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Failed to load weights</p>
      )}
    </div>
  );
}
