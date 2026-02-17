"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useEnsembleWeights } from "@/lib/hooks/use-evals";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
import { WeightTunerSliders } from "@/components/weights/weight-tuner-sliders";
import { SimulationResultsPanel } from "@/components/weights/simulation-results-panel";
import { ApplyWeightsButton } from "@/components/weights/apply-weights-button";

export default function WeightTunePage() {
  const { data: serverWeights, isLoading } = useEnsembleWeights();

  const [weights, setWeights] = useState({
    claude: 0.34,
    gpt4o: 0.33,
    gemini: 0.33,
    k: 1.5,
  });

  useEffect(() => {
    if (serverWeights) {
      setWeights({
        claude: serverWeights.claude ?? 0.34,
        gpt4o: serverWeights["gpt-4o"] ?? 0.33,
        gemini: serverWeights["gemini-flash"] ?? 0.33,
        k: serverWeights.k ?? 1.5,
      });
    }
  }, [serverWeights]);

  const handleReset = () => {
    setWeights({
      claude: 0.34,
      gpt4o: 0.33,
      gemini: 0.33,
      k: 1.5,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Link href="/weights">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to Weights
              </Button>
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Weight Tuner</h1>
          <p className="text-sm text-muted-foreground">
            Adjust model weights, simulate impact, and apply changes
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleReset}>
            Reset to Defaults
          </Button>
          <ApplyWeightsButton weights={weights} />
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 rounded-lg" />
      ) : serverWeights ? (
        <Card className="bg-card/50 border-muted">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Current Weights</p>
                  <div className="flex items-center gap-4 font-mono text-sm">
                    <span>Claude: <span className="font-bold" style={{ color: "#8b5cf6" }}>{(serverWeights.claude * 100).toFixed(1)}%</span></span>
                    <span>GPT-4o: <span className="font-bold" style={{ color: "#10b981" }}>{(serverWeights["gpt-4o"] * 100).toFixed(1)}%</span></span>
                    <span>Gemini: <span className="font-bold" style={{ color: "#f59e0b" }}>{(serverWeights["gemini-flash"] * 100).toFixed(1)}%</span></span>
                    <span className="text-muted-foreground">k: <span className="font-bold text-foreground">{serverWeights.k?.toFixed(2) ?? "1.50"}</span></span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <WeightTunerSliders weights={weights} onChange={setWeights} />
        <SimulationResultsPanel weights={weights} />
      </div>

      <Card className="bg-card/50 border-muted">
        <CardContent className="pt-6">
          <div className="space-y-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">About Weight Tuning</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Model weights determine how much each model contributes to the ensemble score</li>
              <li>The k penalty parameter controls the disagreement penalty strength</li>
              <li>Simulation re-scores recent evaluations with your proposed weights</li>
              <li>Score delta shows the average change in trade scores (positive = higher scores)</li>
              <li>Trade rate delta shows change in % of evaluations passing the trade threshold</li>
              <li>Accuracy delta shows change in % of correct predictions (requires outcome data)</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
