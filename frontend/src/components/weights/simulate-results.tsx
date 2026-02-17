"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSimulateWeights, useUpdateWeights } from "@/lib/hooks/use-evals";

interface SimulateResultsProps {
  weights: Record<string, number>;
}

// Map slider model keys → backend weight keys
function toBackendWeights(w: Record<string, number>) {
  return {
    claude: w["claude-sonnet"] ?? 0,
    gpt4o: w["gpt-4o"] ?? 0,
    gemini: w["gemini-flash"] ?? 0,
  };
}

function DeltaCell({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  const color = value > 0 ? "text-emerald-400" : value < 0 ? "text-red-400" : "text-muted-foreground";
  const sign = value > 0 ? "+" : "";
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-mono text-sm font-bold ${color}`}>
        {sign}{value.toFixed(2)}{suffix}
      </p>
    </div>
  );
}

export function SimulateResults({ weights }: SimulateResultsProps) {
  const simMutation = useSimulateWeights();
  const updateMutation = useUpdateWeights();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-fire simulation on weight change (debounced 500ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const bw = toBackendWeights(weights);
      if (bw.claude + bw.gpt4o + bw.gemini > 0) {
        simMutation.mutate(bw);
      }
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights]);

  const handleApply = () => {
    updateMutation.mutate(weights);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Simulation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {simMutation.isPending ? (
          <Skeleton className="h-20 rounded-md" />
        ) : simMutation.data ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <DeltaCell label="Avg Score Delta" value={simMutation.data.avg_score_delta} />
              <DeltaCell label="Trade Rate Delta" value={simMutation.data.trade_rate_delta} suffix="%" />
              <DeltaCell label="Accuracy Delta" value={simMutation.data.accuracy_delta} suffix="%" />
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Decisions Changed</p>
                <p className="font-mono text-sm font-bold">{simMutation.data.decisions_changed}</p>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Sample size: {simMutation.data.sample_size} evaluations
            </p>
            <Button
              size="sm"
              className="w-full"
              onClick={handleApply}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving..." : "Apply These Weights"}
            </Button>
          </>
        ) : simMutation.isError ? (
          <p className="text-xs text-red-400">
            {simMutation.error instanceof Error ? simMutation.error.message : "Simulation failed"}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Drag sliders to see impact</p>
        )}
      </CardContent>
    </Card>
  );
}
