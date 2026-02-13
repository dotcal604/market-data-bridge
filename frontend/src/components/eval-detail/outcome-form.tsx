"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { evalClient } from "@/lib/api/eval-client";
import type { Outcome } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { formatPrice, formatRMultiple, formatTimestamp } from "@/lib/utils/formatters";
import { rMultipleColor } from "@/lib/utils/colors";
import { cn } from "@/lib/utils";

interface OutcomeFormProps {
  evaluationId: string;
  entryPrice: number | null;
  stopPrice: number | null;
  existingOutcome: Outcome | null;
  onSuccess?: () => void;
}

const EXIT_REASONS = [
  { value: "target_hit", label: "Target Hit" },
  { value: "stopped_out", label: "Stopped Out" },
  { value: "time_stop", label: "Time Stop" },
  { value: "manual_close", label: "Manual Close" },
  { value: "breakeven", label: "Breakeven" },
  { value: "partial", label: "Partial" },
] as const;

export function OutcomeForm({
  evaluationId,
  entryPrice,
  stopPrice,
  existingOutcome,
  onSuccess,
}: OutcomeFormProps) {
  // If outcome already exists, show read-only display
  if (existingOutcome) {
    return (
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-base">Trade Outcome</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-6">
          <div>
            <p className="text-xs text-muted-foreground">Trade Taken</p>
            <Badge variant={existingOutcome.trade_taken ? "default" : "secondary"}>
              {existingOutcome.trade_taken ? "YES" : "NO"}
            </Badge>
          </div>

          {existingOutcome.actual_entry_price != null && (
            <div>
              <p className="text-xs text-muted-foreground">Entry</p>
              <p className="font-mono text-sm font-medium">
                {formatPrice(existingOutcome.actual_entry_price)}
              </p>
            </div>
          )}

          {existingOutcome.actual_exit_price != null && (
            <div>
              <p className="text-xs text-muted-foreground">Exit</p>
              <p className="font-mono text-sm font-medium">
                {formatPrice(existingOutcome.actual_exit_price)}
              </p>
            </div>
          )}

          {existingOutcome.r_multiple != null && (
            <div>
              <p className="text-xs text-muted-foreground">R-Multiple</p>
              <p className={cn("font-mono text-lg font-bold", rMultipleColor(existingOutcome.r_multiple))}>
                {formatRMultiple(existingOutcome.r_multiple)}
              </p>
            </div>
          )}

          {existingOutcome.exit_reason && (
            <div>
              <p className="text-xs text-muted-foreground">Reason</p>
              <Badge variant="outline" className="text-xs">
                {existingOutcome.exit_reason}
              </Badge>
            </div>
          )}

          <div className="ml-auto text-right">
            <p className="text-xs text-muted-foreground">Recorded</p>
            <p className="text-xs">{formatTimestamp(existingOutcome.recorded_at)}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Form state
  const [tradeTaken, setTradeTaken] = useState(true);
  const [actualEntryPrice, setActualEntryPrice] = useState(entryPrice?.toString() ?? "");
  const [actualExitPrice, setActualExitPrice] = useState("");
  const [exitReason, setExitReason] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate R-multiple
  const calculateRMultiple = (): number | null => {
    if (!tradeTaken) return null;
    
    const entry = parseFloat(actualEntryPrice);
    const exit = parseFloat(actualExitPrice);
    const stop = stopPrice;

    if (isNaN(entry) || isNaN(exit) || !stop) {
      return null;
    }

    const risk = Math.abs(entry - stop);
    if (risk === 0) return null;

    const profit = exit - entry;
    return profit / risk;
  };

  const rMultiple = calculateRMultiple();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const data: Parameters<typeof evalClient.recordOutcome>[1] = {
        trade_taken: tradeTaken,
      };

      if (tradeTaken) {
        const entry = parseFloat(actualEntryPrice);
        const exit = parseFloat(actualExitPrice);

        if (isNaN(entry) || isNaN(exit)) {
          throw new Error("Entry and exit prices must be valid numbers");
        }

        if (!exitReason) {
          throw new Error("Exit reason is required");
        }

        data.actual_entry_price = entry;
        data.actual_exit_price = exit;
        data.r_multiple = rMultiple ?? undefined;
        data.exit_reason = exitReason;
      }

      if (notes.trim()) {
        data.notes = notes.trim();
      }

      await evalClient.recordOutcome(evaluationId, data);
      
      // Call onSuccess callback to trigger refetch
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record outcome");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="bg-card">
      <CardHeader>
        <CardTitle className="text-base">Record Trade Outcome</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Trade Taken Switch */}
          <div className="flex items-center justify-between">
            <Label htmlFor="trade-taken" className="text-sm font-medium">
              Trade Taken
            </Label>
            <Switch
              id="trade-taken"
              checked={tradeTaken}
              onCheckedChange={setTradeTaken}
            />
          </div>

          {/* Show price fields only if trade was taken */}
          {tradeTaken && (
            <>
              <div className="grid grid-cols-2 gap-4">
                {/* Entry Price */}
                <div className="space-y-2">
                  <Label htmlFor="entry-price">Entry Price</Label>
                  <Input
                    id="entry-price"
                    type="number"
                    step="0.01"
                    value={actualEntryPrice}
                    onChange={(e) => setActualEntryPrice(e.target.value)}
                    placeholder="0.00"
                    required
                    className="font-mono"
                  />
                </div>

                {/* Exit Price */}
                <div className="space-y-2">
                  <Label htmlFor="exit-price">Exit Price</Label>
                  <Input
                    id="exit-price"
                    type="number"
                    step="0.01"
                    value={actualExitPrice}
                    onChange={(e) => setActualExitPrice(e.target.value)}
                    placeholder="0.00"
                    required
                    className="font-mono"
                  />
                </div>
              </div>

              {/* R-Multiple Display */}
              {rMultiple !== null && (
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Calculated R-Multiple</p>
                  <p className={cn("font-mono text-xl font-bold", rMultipleColor(rMultiple))}>
                    {formatRMultiple(rMultiple)}
                  </p>
                </div>
              )}

              {/* Exit Reason */}
              <div className="space-y-2">
                <Label htmlFor="exit-reason">Exit Reason</Label>
                <Select value={exitReason} onValueChange={setExitReason} required>
                  <SelectTrigger id="exit-reason" className="w-full">
                    <SelectValue placeholder="Select exit reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXIT_REASONS.map((reason) => (
                      <SelectItem key={reason.value} value={reason.value}>
                        {reason.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* Notes - always visible */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about the trade..."
              rows={3}
            />
          </div>

          {/* Error Display */}
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full"
          >
            {isSubmitting ? "Recording..." : "Record Outcome"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
