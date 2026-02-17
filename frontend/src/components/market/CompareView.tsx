"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QuoteCard } from "./QuoteCard";
import { KeyStats } from "./KeyStats";
import { PriceChart } from "./PriceChart";
import { useQuote, useStockDetails } from "@/lib/hooks/use-market";
import { SparklineChart } from "./SparklineChart";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CompareViewProps {
  symbols: string[];
  onRemoveSymbol: (symbol: string) => void;
}

export function CompareView({ symbols, onRemoveSymbol }: CompareViewProps) {
  if (symbols.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Symbol Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Search for multiple symbols to compare them side by side
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Symbol Comparison ({symbols.length} symbols)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {symbols.map((symbol) => (
              <SymbolComparisonCard
                key={symbol}
                symbol={symbol}
                onRemove={() => onRemoveSymbol(symbol)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Full-width charts for each symbol */}
      <div className="space-y-4">
        {symbols.map((symbol) => (
          <PriceChart key={symbol} symbol={symbol} />
        ))}
      </div>
    </div>
  );
}

interface SymbolComparisonCardProps {
  symbol: string;
  onRemove: () => void;
}

function SymbolComparisonCard({ symbol, onRemove }: SymbolComparisonCardProps) {
  const { data: quote, isLoading: isLoadingQuote, error: quoteError } = useQuote(symbol);
  const { data: details, isLoading: isLoadingDetails, error: detailsError } = useStockDetails(symbol);

  return (
    <div className="relative rounded-lg border border-border bg-card p-4">
      {/* Remove button */}
      <button
        onClick={onRemove}
        className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Symbol and sparkline */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-mono text-lg font-bold">{symbol}</h3>
        <div className="h-8 w-20">
          <SparklineChart symbol={symbol} className="h-full w-full" />
        </div>
      </div>

      {/* Quote info */}
      {quote && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Price</span>
            <span className="font-mono text-lg font-semibold">
              ${quote.last?.toFixed(2) || "—"}
            </span>
          </div>
          {quote.changePercent != null && (
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Change</span>
              <span
                className={`font-mono text-sm font-semibold ${
                  quote.changePercent >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {quote.changePercent >= 0 ? "+" : ""}
                {quote.changePercent.toFixed(2)}%
              </span>
            </div>
          )}
          {quote.volume != null && (
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Volume</span>
              <span className="font-mono text-xs">
                {quote.volume.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Key stats */}
      {details && (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">P/E</span>
            <span className="font-mono text-xs">
              {details.trailingPE?.toFixed(2) || "—"}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Market Cap</span>
            <span className="font-mono text-xs">
              {details.marketCap
                ? `$${(details.marketCap / 1e9).toFixed(2)}B`
                : "—"}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Beta</span>
            <span className="font-mono text-xs">
              {details.beta?.toFixed(2) || "—"}
            </span>
          </div>
        </div>
      )}

      {(isLoadingQuote || isLoadingDetails) && (
        <div className="mt-4 text-center text-xs text-muted-foreground">
          Loading...
        </div>
      )}

      {(quoteError || detailsError) && (
        <div className="mt-4 text-center text-xs text-red-400">
          Failed to load data
        </div>
      )}
    </div>
  );
}
