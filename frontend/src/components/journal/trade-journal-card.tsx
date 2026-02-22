"use client";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { directionBg } from "@/lib/utils/colors";
import { formatPrice, formatRMultiple, formatTimestamp } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

interface TradeJournalCardProps {
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  rMultiple: number;
  reasoning: string;
  tags: string[];
  timestamp: string;
}

export function TradeJournalCard({
  symbol,
  direction,
  entryPrice,
  exitPrice,
  rMultiple,
  reasoning,
  tags,
  timestamp,
}: TradeJournalCardProps) {
  const DirectionIcon = direction === "long" ? ArrowUpRight : ArrowDownRight;
  const rColor = rMultiple >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="font-mono text-lg tracking-tight text-foreground">
              {symbol}
            </CardTitle>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold uppercase",
                directionBg(direction)
              )}
            >
              <DirectionIcon className="h-3 w-3" />
              {direction}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(timestamp)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* Prices row */}
        <div className="flex items-center gap-6">
          <div>
            <span className="text-xs text-muted-foreground">Entry</span>
            <p className="font-mono text-sm text-foreground">
              {formatPrice(entryPrice)}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Exit</span>
            <p className="font-mono text-sm text-foreground">
              {formatPrice(exitPrice)}
            </p>
          </div>
          <div className="ml-auto text-right">
            <span className="text-xs text-muted-foreground">R-Multiple</span>
            <p className={cn("font-mono text-xl font-bold", rColor)}>
              {formatRMultiple(rMultiple)}
            </p>
          </div>
        </div>

        {/* Reasoning */}
        <div>
          <span className="text-xs text-muted-foreground">Reasoning</span>
          <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            {reasoning}
          </p>
        </div>
      </CardContent>

      {/* Tags */}
      {tags.length > 0 && (
        <CardFooter className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </CardFooter>
      )}
    </Card>
  );
}
