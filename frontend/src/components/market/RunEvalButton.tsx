"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp } from "lucide-react";
import { evalClient } from "@/lib/api/eval-client";
import { useRouter } from "next/navigation";

interface RunEvalButtonProps {
  symbol: string | null;
  disabled?: boolean;
  className?: string;
}

export function RunEvalButton({ symbol, disabled, className }: RunEvalButtonProps) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRunEval = async () => {
    if (!symbol) return;

    setIsRunning(true);
    setError(null);

    try {
      const result = await evalClient.evaluate(symbol, "long");
      router.push(`/evals/${result.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to run evaluation";
      setError(message);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className={className}>
      <Button
        onClick={handleRunEval}
        disabled={!symbol || disabled || isRunning}
        className="w-full"
      >
        {isRunning ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Running Evaluation...
          </>
        ) : (
          <>
            <TrendingUp className="mr-2 h-4 w-4" />
            Run Eval
          </>
        )}
      </Button>
      {error && (
        <p className="mt-2 text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
