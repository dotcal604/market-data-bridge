"use client";

import { useState } from "react";
import { WeightSliders } from "@/components/weights/weight-sliders";

export default function WeightsDemoPage() {
  const [weights, setWeights] = useState<Record<string, number>>({
    "gpt-4o": 0.4,
    "claude-sonnet": 0.35,
    "gemini-flash": 0.25,
  });

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Weight Sliders Demo</h1>
        <p className="text-sm text-muted-foreground">
          Interactive demo of the ensemble model weight adjustment component
        </p>
      </div>

      <div className="max-w-2xl">
        <WeightSliders 
          weights={weights} 
          onChange={setWeights} 
        />
      </div>

      <div className="max-w-2xl rounded-lg border border-border bg-muted/30 p-4">
        <h2 className="text-sm font-semibold mb-2">Current State:</h2>
        <pre className="text-xs font-mono">
          {JSON.stringify(weights, null, 2)}
        </pre>
      </div>
    </main>
  );
}
