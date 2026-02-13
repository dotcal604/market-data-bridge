"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown } from "lucide-react";
import { formatPrice, formatDecimalPercent } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils";
import type { Quote } from "@/lib/api/market-client";

interface QuoteCardProps {
  quote: Quote | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function QuoteCard({ quote, isLoading, error }: QuoteCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Skeleton className="h-6 w-32" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-12 w-48" />
            <Skeleton className="h-5 w-32" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">
            Failed to load quote: {error.message}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!quote) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">
            Select a symbol to view live quotes
          </p>
        </CardContent>
      </Card>
    );
  }

  const isPositive = (quote.change ?? 0) >= 0;
  const changeColor = isPositive ? "text-emerald-400" : "text-red-400";
  const ChangeTrendIcon = isPositive ? TrendingUp : TrendingDown;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <span className="font-mono text-xl">{quote.symbol}</span>
            <Badge variant="outline" className="text-xs">
              {quote.source.toUpperCase()}
            </Badge>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Price & Change */}
        <div>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-4xl font-bold">
              {formatPrice(quote.last)}
            </span>
            <div className={cn("flex items-center gap-1 text-lg font-medium", changeColor)}>
              <ChangeTrendIcon className="h-5 w-5" />
              <span className="font-mono">
                {isPositive ? "+" : ""}
                {formatPrice(quote.change)}
              </span>
              <span className="font-mono">
                ({isPositive ? "+" : ""}
                {formatDecimalPercent(quote.changePercent ?? 0)})
              </span>
            </div>
          </div>
        </div>

        {/* Quote Stats Grid */}
        <div className="grid grid-cols-2 gap-4">
          {/* Bid */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Bid</div>
            <div className="mt-1 font-mono text-lg font-semibold">
              {formatPrice(quote.bid)}
            </div>
          </div>

          {/* Ask */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Ask</div>
            <div className="mt-1 font-mono text-lg font-semibold">
              {formatPrice(quote.ask)}
            </div>
          </div>

          {/* Volume */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Volume</div>
            <div className="mt-1 font-mono text-lg font-semibold">
              {quote.volume != null
                ? quote.volume.toLocaleString()
                : "—"}
            </div>
          </div>

          {/* Day Range */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Day Range</div>
            <div className="mt-1 font-mono text-sm font-semibold">
              {formatPrice(quote.dayLow)} - {formatPrice(quote.dayHigh)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
