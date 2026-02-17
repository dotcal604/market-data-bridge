"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { modelColor } from "@/lib/utils/colors";

interface WeightTunerSlidersProps {
  weights: {
    claude: number;
    gpt4o: number;
    gemini: number;
    k: number;
  };
  onChange: (weights: { claude: number; gpt4o: number; gemini: number; k: number }) => void;
}

const MODEL_CONFIGS = [
  { key: "claude", label: "Claude Sonnet", color: "#8b5cf6" },
  { key: "gpt4o", label: "GPT-4o", color: "#10b981" },
  { key: "gemini", label: "Gemini Flash", color: "#f59e0b" },
] as const;

export function WeightTunerSliders({ weights, onChange }: WeightTunerSlidersProps) {
  const [isDragging, setIsDragging] = useState<string | null>(null);

  // Handle model weight change with auto-normalization
  const handleWeightChange = (modelKey: string, newValue: number) => {
    setIsDragging(modelKey);
    
    type WeightKey = "claude" | "gpt4o" | "gemini";
    const otherModels = MODEL_CONFIGS.filter((m) => m.key !== modelKey);
    const otherSum = otherModels.reduce((sum, m) => sum + weights[m.key as WeightKey], 0);
    
    // If new value is 1, set others to 0
    if (newValue >= 0.99) {
      const newWeights = { ...weights };
      newWeights[modelKey as keyof typeof weights] = 1;
      otherModels.forEach((m) => {
        newWeights[m.key as WeightKey] = 0;
      });
      onChange(newWeights);
      return;
    }
    
    // Calculate remaining weight to distribute
    const remaining = 1 - newValue;
    
    // Distribute remaining weight proportionally among other models
    const newWeights = { ...weights };
    newWeights[modelKey as keyof typeof weights] = newValue;
    
    if (otherSum > 0) {
      // Proportional distribution
      otherModels.forEach((m) => {
        newWeights[m.key as WeightKey] = (weights[m.key as WeightKey] / otherSum) * remaining;
      });
    } else {
      // Equal distribution if others are zero
      const equalShare = remaining / otherModels.length;
      otherModels.forEach((m) => {
        newWeights[m.key as WeightKey] = equalShare;
      });
    }
    
    onChange(newWeights);
  };

  // Handle k penalty change
  const handleKChange = (newValue: number) => {
    onChange({ ...weights, k: newValue });
  };

  const handleSliderEnd = () => {
    setIsDragging(null);
  };

  const totalWeight = weights.claude + weights.gpt4o + weights.gemini;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Weights</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Model weight sliders */}
        <div className="space-y-5">
          {MODEL_CONFIGS.map(({ key, label, color }) => {
            const weight = weights[key];
            const percentage = (weight * 100).toFixed(1);
            
            return (
              <div key={key} className="space-y-2">
                {/* Label and value */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{label}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-mono text-muted-foreground">
                      {weight.toFixed(3)}
                    </span>
                    <span className="font-mono font-semibold" style={{ color }}>
                      {percentage}%
                    </span>
                  </div>
                </div>
                
                {/* Slider */}
                <div className="flex items-center gap-3">
                  <Slider
                    value={[weight]}
                    onValueChange={(values) => handleWeightChange(key, values[0])}
                    onValueCommit={handleSliderEnd}
                    min={0}
                    max={1}
                    step={0.01}
                    className="flex-1"
                    style={{
                      // @ts-ignore - custom CSS property
                      "--slider-color": color,
                    }}
                  />
                  
                  {/* Visual bar indicator */}
                  <div className="h-8 w-20 rounded border border-border bg-muted/30">
                    <div
                      className="h-full rounded-l transition-all duration-150"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: color,
                        opacity: isDragging === key ? 0.8 : 1,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Total validation */}
        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Model Weights Total:</span>
            <span className={`font-mono font-semibold ${Math.abs(totalWeight - 1) < 0.001 ? "text-emerald-400" : "text-yellow-400"}`}>
              {(totalWeight * 100).toFixed(1)}%
            </span>
          </div>
        </div>

        {/* k penalty slider */}
        <div className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium">Disagreement Penalty (k)</span>
              <p className="text-xs text-muted-foreground">Higher k = stronger penalty for model disagreement</p>
            </div>
            <span className="font-mono font-semibold text-sm">{weights.k.toFixed(2)}</span>
          </div>
          
          <Slider
            value={[weights.k]}
            onValueChange={(values) => handleKChange(values[0])}
            min={0}
            max={5}
            step={0.1}
            className="w-full"
          />
          
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>0.0 (no penalty)</span>
            <span>5.0 (max penalty)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
