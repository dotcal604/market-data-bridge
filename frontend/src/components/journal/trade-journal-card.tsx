"use client";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { directionBg } from "@/lib/utils/colors";
import { formatPrice, formatRMultiple, formatTimestamp } from "@/lib/utils/formatters";

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
  const directionLabel = direction === "long" ? "Long" : "Short";
  const rColor = rMultiple >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    <Card className="bg-card text-foreground border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-3">
            <span className="font-mono text-lg tracking-tight">{symbol}</span>
            <Badge
              variant="outline"
              className={directionBg(direction)}
            >
              {directionLabel}
            </Badge>
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(timestamp)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Prices row */}
        <div className="flex items-center gap-6">
          <div>
            <span className="text-xs text-muted-foreground">Entry</span>
            <p className="font-mono text-sm">{formatPrice(entryPrice)}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Exit</span>
            <p className="font-mono text-sm">{formatPrice(exitPrice)}</p>
          </div>
          <div className="ml-auto text-right">
            <span className="text-xs text-muted-foreground">R-Multiple</span>
            <p className={`font-mono text-xl font-semibold ${rColor}`}>
              {formatRMultiple(rMultiple)}
            </p>
          </div>
        </div>

        {/* Reasoning */}
        <div>
          <span className="text-xs text-muted-foreground">Reasoning</span>
          <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm leading-relaxed text-muted-foreground">
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
