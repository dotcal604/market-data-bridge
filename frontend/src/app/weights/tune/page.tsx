"use client";

import { useEnsembleWeights } from "@/lib/hooks/use-evals";
import { useWeightTuner } from "@/lib/hooks/useWeightTuner";
import { WeightSliders } from "@/components/weights/WeightSliders";
import { SimulationResults } from "@/components/weights/SimulationResults";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function WeightsTunePage() {
  const { data: currentWeights, isLoading } = useEnsembleWeights();

  const initialWeights = {
    claude: currentWeights?.["claude-sonnet"] ?? 0.35,
    gpt4o: currentWeights?.["gpt-4o"] ?? 0.4,
    gemini: currentWeights?.["gemini-flash"] ?? 0.25,
    k: 0.5, // Default k value
  };

  const {
    weights,
    updateWeights,
    simulationResult,
    isSimulating,
    error,
  } = useWeightTuner(initialWeights);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Link
            href="/weights"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Weight Tuning</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Simulate ensemble performance with different model weights and disagreement penalties
        </p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: Sliders */}
        <div>
          <WeightSliders weights={weights} onChange={updateWeights} />
        </div>

        {/* Right: Results */}
        <div>
          <SimulationResults
            result={simulationResult}
            isSimulating={isSimulating}
            error={error}
          />
        </div>
      </div>

      {/* Info section */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold mb-2">How it works</h2>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>• Adjust model weights and penalty factor using the sliders</li>
          <li>• The simulation re-scores historical evaluations (last 90 days by default)</li>
          <li>• Score delta shows the average change in ensemble scores compared to current weights</li>
          <li>• Positive delta means these weights would have performed better historically</li>
          <li>• This is for analysis only — weights are not automatically updated</li>
        </ul>
      </div>
    </div>
  );
}
