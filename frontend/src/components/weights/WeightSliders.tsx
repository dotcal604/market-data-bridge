"use client";

import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { modelColor } from "@/lib/utils/colors";

interface WeightSlidersProps {
  weights: {
    claude: number;
    gpt4o: number;
    gemini: number;
    k: number;
  };
  onChange: (weights: { claude: number; gpt4o: number; gemini: number; k: number }) => void;
}

const MODEL_CONFIG = [
  { id: "claude", label: "Claude Sonnet", min: 0, max: 1, step: 0.01 },
  { id: "gpt4o", label: "GPT-4o", min: 0, max: 1, step: 0.01 },
  { id: "gemini", label: "Gemini Flash", min: 0, max: 1, step: 0.01 },
] as const;

export function WeightSliders({ weights, onChange }: WeightSlidersProps) {
  const handleModelWeightChange = (modelId: "claude" | "gpt4o" | "gemini", value: number[]) => {
    onChange({
      ...weights,
      [modelId]: value[0],
    });
  };

  const handleKPenaltyChange = (value: number[]) => {
    onChange({
      ...weights,
      k: value[0],
    });
  };

  const getModelColor = (modelId: string): string => {
    const colorMap: Record<string, string> = {
      claude: "claude-sonnet",
      gpt4o: "gpt-4o",
      gemini: "gemini-flash",
    };
    return modelColor(colorMap[modelId]);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Model Weights</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {MODEL_CONFIG.map((model) => {
            const weight = weights[model.id];
            const color = getModelColor(model.id);
            
            return (
              <div key={model.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor={`slider-${model.id}`} className="text-sm font-medium">
                    {model.label}
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {weight.toFixed(3)}
                    </span>
                    <span 
                      className="font-mono text-sm font-semibold"
                      style={{ color }}
                    >
                      {(weight * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                <Slider
                  id={`slider-${model.id}`}
                  min={model.min}
                  max={model.max}
                  step={model.step}
                  value={[weight]}
                  onValueChange={(value) => handleModelWeightChange(model.id, value)}
                />
              </div>
            );
          })}
          
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Total:</span>
              <span className="font-mono font-semibold">
                {((weights.claude + weights.gpt4o + weights.gemini) * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Disagreement Penalty (k)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="slider-k" className="text-sm font-medium">
              Penalty Factor
            </label>
            <span className="font-mono text-sm font-semibold">
              {weights.k.toFixed(3)}
            </span>
          </div>
          <Slider
            id="slider-k"
            min={0}
            max={1}
            step={0.001}
            value={[weights.k]}
            onValueChange={handleKPenaltyChange}
          />
          <p className="text-xs text-muted-foreground">
            Higher values increase the penalty for model disagreement
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
