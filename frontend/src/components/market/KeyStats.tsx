"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice, formatDecimalPercent } from "@/lib/utils/formatters";
import type { StockDetails } from "@/lib/api/market-client";

interface KeyStatsProps {
  details: StockDetails | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function KeyStats({ details, isLoading, error }: KeyStatsProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Key Statistics</CardTitle>
        </CardHeader>
        <CardContent>
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
        <CardHeader>
          <CardTitle>Key Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </CardContent>
      </Card>
    );
  }

  if (!details) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Key Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select a symbol to view key statistics
          </p>
        </CardContent>
      </Card>
    );
  }

  const formatLargeNumber = (num: number | null): string => {
    if (num == null) return "—";
    if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    return `$${num.toLocaleString()}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Key Statistics</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {/* P/E Ratio */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">P/E Ratio</div>
            <div className="mt-1 font-mono text-sm font-semibold">
              {details.trailingPE != null ? details.trailingPE.toFixed(2) : "—"}
            </div>
          </div>

          {/* Market Cap */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Market Cap</div>
            <div className="mt-1 font-mono text-sm font-semibold">
              {formatLargeNumber(details.marketCap)}
            </div>
          </div>

          {/* 52-Week Range */}
          <div className="col-span-2 rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">52-Week Range</div>
            <div className="mt-1 font-mono text-sm font-semibold">
              {formatPrice(details.fiftyTwoWeekLow)} - {formatPrice(details.fiftyTwoWeekHigh)}
            </div>
          </div>

          {/* Dividend Yield */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Dividend Yield</div>
            <div className="mt-1 font-mono text-sm font-semibold">
              {details.dividendYield != null
                ? formatDecimalPercent(details.dividendYield)
                : "—"}
            </div>
          </div>

          {/* Beta */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Beta</div>
            <div className="mt-1 font-mono text-sm font-semibold">
              {details.beta != null ? details.beta.toFixed(2) : "—"}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
