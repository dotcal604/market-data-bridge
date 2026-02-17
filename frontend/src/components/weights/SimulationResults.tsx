"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface SimulationResultsProps {
  result: {
    simulated_weights: {
      claude: number;
      gpt4o: number;
      gemini: number;
      k: number;
    };
    evaluations_count: number;
    average_score_delta: number;
  } | null;
  isSimulating: boolean;
  error: string | null;
}

export function SimulationResults({ result, isSimulating, error }: SimulationResultsProps) {
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Simulation Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isSimulating) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Simulation Results</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Simulation Results</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Adjust the sliders to simulate ensemble performance with different weights
          </p>
        </CardContent>
      </Card>
    );
  }

  const delta = result.average_score_delta;
  const deltaColor = delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-muted-foreground";
  const deltaBg = delta > 0 ? "bg-emerald-400/10" : delta < 0 ? "bg-red-400/10" : "bg-muted/30";
  const deltaSign = delta > 0 ? "+" : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Simulation Results</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Score Delta */}
        <div className={`rounded-lg border border-border p-4 ${deltaBg}`}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Average Score Delta</span>
            <span className={`font-mono text-3xl font-bold ${deltaColor}`}>
              {deltaSign}{delta.toFixed(2)}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {delta > 0 
              ? "These weights would have increased average scores" 
              : delta < 0 
              ? "These weights would have decreased average scores"
              : "These weights would have no effect on average scores"}
          </p>
        </div>

        {/* Metadata */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Evaluations analyzed:</span>
            <span className="font-mono font-semibold">{result.evaluations_count}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Simulated weights:</span>
            <span className="font-mono text-xs">
              claude={result.simulated_weights.claude.toFixed(2)},
              gpt4o={result.simulated_weights.gpt4o.toFixed(2)},
              gemini={result.simulated_weights.gemini.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Penalty factor (k):</span>
            <span className="font-mono font-semibold">
              {result.simulated_weights.k.toFixed(3)}
            </span>
          </div>
        </div>

        {/* Warning for non-normalized weights */}
        {Math.abs((result.simulated_weights.claude + result.simulated_weights.gpt4o + result.simulated_weights.gemini) - 1) > 0.01 && (
          <div className="rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-3">
            <p className="text-xs text-yellow-400">
              ⚠️ Warning: Model weights do not sum to 1.0. Results may not be comparable to current ensemble.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
