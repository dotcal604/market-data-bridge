"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { evalClient } from "@/lib/api/eval-client";
import type { EvalResponse } from "@/lib/api/types";

interface EvalTriggerFormProps {
  onSuccess?: (result: EvalResponse) => void;
}

export function EvalTriggerForm({ onSuccess }: EvalTriggerFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [notes, setNotes] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!symbol.trim()) {
      setError("Symbol is required");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await evalClient.evaluate(
        symbol.toUpperCase(),
        direction,
        entryPrice ? parseFloat(entryPrice) : undefined,
        stopPrice ? parseFloat(stopPrice) : undefined,
        notes.trim() || undefined
      );

      // Call onSuccess if provided
      if (onSuccess) {
        onSuccess(result);
      } else {
        // Default behavior: redirect to eval detail page
        router.push(`/evals/${result.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run evaluation");
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Trade Evaluation</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Symbol Input */}
          <div className="space-y-2">
            <Label htmlFor="symbol">Symbol *</Label>
            <Input
              id="symbol"
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="AAPL"
              required
              disabled={isLoading}
            />
          </div>

          {/* Direction Picker */}
          <div className="space-y-2">
            <Label>Direction</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={direction === "long" ? "default" : "outline"}
                onClick={() => setDirection("long")}
                disabled={isLoading}
                className={direction === "long" ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""}
              >
                Long
              </Button>
              <Button
                type="button"
                variant={direction === "short" ? "default" : "outline"}
                onClick={() => setDirection("short")}
                disabled={isLoading}
                className={direction === "short" ? "bg-red-500 hover:bg-red-600 text-white" : ""}
              >
                Short
              </Button>
            </div>
          </div>

          {/* Entry Price */}
          <div className="space-y-2">
            <Label htmlFor="entry-price">Entry Price (optional)</Label>
            <Input
              id="entry-price"
              type="number"
              step="0.01"
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              placeholder="195.50"
              disabled={isLoading}
            />
          </div>

          {/* Stop Price */}
          <div className="space-y-2">
            <Label htmlFor="stop-price">Stop Price (optional)</Label>
            <Input
              id="stop-price"
              type="number"
              step="0.01"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              placeholder="193.00"
              disabled={isLoading}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Breakout from consolidation"
              disabled={isLoading}
              rows={3}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/50 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isLoading || !symbol.trim()}
            className="w-full"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running Evaluation...
              </>
            ) : (
              "Run Evaluation"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
