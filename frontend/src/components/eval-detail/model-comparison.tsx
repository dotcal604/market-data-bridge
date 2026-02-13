"use client";

import type { ModelEvaluation } from "@/lib/api/types";
import { ModelCard } from "./model-card";

interface Props {
  modelOutputs: ModelEvaluation[];
}

export function ModelComparison({ modelOutputs }: Props) {
  if (modelOutputs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No model outputs recorded</p>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      {modelOutputs.map((output) => (
        <ModelCard key={output.model_id} output={output} />
      ))}
    </div>
  );
}
