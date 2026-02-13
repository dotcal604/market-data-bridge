"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { modelColor } from "@/lib/utils/colors";

interface WeightSlidersProps {
  weights: Record<string, number>; // e.g. { "gpt-4o": 0.4, "claude-sonnet": 0.35, "gemini-flash": 0.25 }
  onChange: (weights: Record<string, number>) => void;
}

const MODEL_NAMES = ["gpt-4o", "claude-sonnet", "gemini-flash"] as const;

const MODEL_LABELS: Record<string, string> = {
  "gpt-4o": "GPT-4o",
  "claude-sonnet": "Claude Sonnet",
  "gemini-flash": "Gemini Flash",
};

export function WeightSliders({ weights, onChange }: WeightSlidersProps) {
  const [isDragging, setIsDragging] = useState<string | null>(null);

  // Handle slider change with auto-normalization
  const handleSliderChange = (modelId: string, newValue: number) => {
    setIsDragging(modelId);
    
    // Calculate the sum of all other models
    const otherModels = MODEL_NAMES.filter(m => m !== modelId);
    const otherSum = otherModels.reduce((sum, m) => sum + (weights[m] || 0), 0);
    
    // If new value is 1, set others to 0
    if (newValue >= 0.99) {
      const newWeights = { ...weights };
      newWeights[modelId] = 1;
      otherModels.forEach(m => {
        newWeights[m] = 0;
      });
      onChange(newWeights);
      return;
    }
    
    // Calculate remaining weight to distribute
    const remaining = 1 - newValue;
    
    // Distribute remaining weight proportionally among other models
    const newWeights = { ...weights };
    newWeights[modelId] = newValue;
    
    if (otherSum > 0) {
      // Proportional distribution
      otherModels.forEach(m => {
        newWeights[m] = (weights[m] / otherSum) * remaining;
      });
    } else {
      // Equal distribution if others are zero
      const equalShare = remaining / otherModels.length;
      otherModels.forEach(m => {
        newWeights[m] = equalShare;
      });
    }
    
    onChange(newWeights);
  };

  const handleSliderEnd = () => {
    setIsDragging(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ensemble Model Weights</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {MODEL_NAMES.map((modelId) => {
          const weight = weights[modelId] || 0;
          const percentage = (weight * 100).toFixed(1);
          const color = modelColor(modelId);
          const label = MODEL_LABELS[modelId] || modelId;
          
          return (
            <div key={modelId} className="space-y-2">
              {/* Model name and values */}
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
              
              {/* Slider and bar chart container */}
              <div className="flex items-center gap-3">
                {/* Range slider */}
                <div className="relative flex-1">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={weight}
                    onChange={(e) => handleSliderChange(modelId, parseFloat(e.target.value))}
                    onMouseUp={handleSliderEnd}
                    onTouchEnd={handleSliderEnd}
                    aria-label={`${label} weight`}
                    aria-valuetext={`${percentage} percent`}
                    aria-valuenow={Math.round(weight * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-orientation="horizontal"
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted"
                    style={{
                      background: `linear-gradient(to right, ${color} 0%, ${color} ${percentage}%, hsl(var(--muted)) ${percentage}%, hsl(var(--muted)) 100%)`,
                    }}
                  />
                </div>
                
                {/* Bar chart preview */}
                <div className="h-8 w-24 rounded border border-border bg-muted/30">
                  <div
                    className="h-full rounded-l transition-all duration-150"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: color,
                      opacity: isDragging === modelId ? 0.8 : 1,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
        
        {/* Sum validation display */}
        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Total:</span>
            <span className="font-mono font-semibold">
              {(MODEL_NAMES.reduce((sum, m) => sum + (weights[m] || 0), 0) * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
