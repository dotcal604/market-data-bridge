"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Outcome } from "@/lib/api/types";
import { formatPrice, formatRMultiple, formatTimestamp } from "@/lib/utils/formatters";
import { rMultipleColor } from "@/lib/utils/colors";
import { cn } from "@/lib/utils";

interface Props {
  outcome: Outcome | null;
  evaluationId: string;
}

export function OutcomePanel({ outcome }: Props) {
  if (!outcome) {
    return (
      <Card className="bg-card">
        <CardContent className="flex items-center justify-center py-8">
          <p className="text-sm text-muted-foreground">
            No outcome recorded yet. Use POST /api/eval/outcome to record one.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card">
      <CardHeader>
        <CardTitle className="text-base">Trade Outcome</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-6">
        <div>
          <p className="text-xs text-muted-foreground">Trade Taken</p>
          <Badge variant={outcome.trade_taken ? "default" : "secondary"}>
            {outcome.trade_taken ? "YES" : "NO"}
          </Badge>
        </div>

        {outcome.actual_entry_price != null && (
          <div>
            <p className="text-xs text-muted-foreground">Entry</p>
            <p className="font-mono text-sm font-medium">{formatPrice(outcome.actual_entry_price)}</p>
          </div>
        )}

        {outcome.actual_exit_price != null && (
          <div>
            <p className="text-xs text-muted-foreground">Exit</p>
            <p className="font-mono text-sm font-medium">{formatPrice(outcome.actual_exit_price)}</p>
          </div>
        )}

        {outcome.r_multiple != null && (
          <div>
            <p className="text-xs text-muted-foreground">R-Multiple</p>
            <p className={cn("font-mono text-lg font-bold", rMultipleColor(outcome.r_multiple))}>
              {formatRMultiple(outcome.r_multiple)}
            </p>
          </div>
        )}

        {outcome.exit_reason && (
          <div>
            <p className="text-xs text-muted-foreground">Reason</p>
            <Badge variant="outline" className="text-xs">{outcome.exit_reason}</Badge>
          </div>
        )}

        <div className="ml-auto text-right">
          <p className="text-xs text-muted-foreground">Recorded</p>
          <p className="text-xs">{formatTimestamp(outcome.recorded_at)}</p>
        </div>
      </CardContent>
    </Card>
  );
}
