"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useUpdateWeights } from "@/lib/hooks/use-evals";
import { CheckCircle2, AlertCircle } from "lucide-react";

interface ApplyWeightsButtonProps {
  weights: {
    claude: number;
    gpt4o: number;
    gemini: number;
    k: number;
  };
}

export function ApplyWeightsButton({ weights }: ApplyWeightsButtonProps) {
  const [open, setOpen] = useState(false);
  const updateMutation = useUpdateWeights();

  const handleApply = () => {
    // Convert to backend format
    const backendWeights = {
      claude: weights.claude,
      gpt4o: weights.gpt4o,
      gemini: weights.gemini,
      k: weights.k,
    };
    
    updateMutation.mutate(backendWeights, {
      onSuccess: () => {
        setOpen(false);
      },
    });
  };

  const totalWeight = weights.claude + weights.gpt4o + weights.gemini;
  const isValid = Math.abs(totalWeight - 1) < 0.001;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          disabled={!isValid || updateMutation.isPending}
          className="min-w-[120px]"
        >
          {updateMutation.isPending ? "Saving..." : "Apply Weights"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm Weight Update</AlertDialogTitle>
          <AlertDialogDescription>
            This will save the new weights to <code className="text-xs bg-muted px-1 py-0.5 rounded">data/weights.json</code> and they will take effect immediately for all future evaluations.
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        {/* Preview of weights to be saved */}
        <div className="rounded-md border border-border bg-card/50 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">New Weights:</p>
          <div className="grid grid-cols-2 gap-2 text-sm font-mono">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Claude:</span>
              <span className="font-bold" style={{ color: "#8b5cf6" }}>
                {(weights.claude * 100).toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">GPT-4o:</span>
              <span className="font-bold" style={{ color: "#10b981" }}>
                {(weights.gpt4o * 100).toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Gemini:</span>
              <span className="font-bold" style={{ color: "#f59e0b" }}>
                {(weights.gemini * 100).toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">k penalty:</span>
              <span className="font-bold">{weights.k.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Validation status */}
        <div className="flex items-start gap-2 text-sm">
          {isValid ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5" />
              <p className="text-muted-foreground">
                Weights sum to 100% ({(totalWeight * 100).toFixed(1)}%)
              </p>
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5" />
              <p className="text-yellow-400">
                Warning: Weights sum to {(totalWeight * 100).toFixed(1)}% (should be 100%)
              </p>
            </>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={updateMutation.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleApply}
            disabled={!isValid || updateMutation.isPending}
          >
            {updateMutation.isPending ? "Saving..." : "Confirm & Apply"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
