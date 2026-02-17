"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SymbolSearch } from "@/components/market/SymbolSearch";
import { QuoteCard } from "@/components/market/QuoteCard";
import { CompanyInfo } from "@/components/market/CompanyInfo";
import { PriceChart } from "@/components/market/PriceChart";
import { NewsFeed } from "@/components/market/NewsFeed";
import { EarningsCard } from "@/components/market/EarningsCard";
import { KeyStats } from "@/components/market/KeyStats";
import { RunEvalButton } from "@/components/market/RunEvalButton";
import { CompareView } from "@/components/market/CompareView";
import { useQuote, useStockDetails, useFinancials } from "@/lib/hooks/use-market";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown } from "lucide-react";

function MarketPageContent() {
  const searchParams = useSearchParams();
  const symbolParam = searchParams.get("symbol");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(symbolParam);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSymbols, setCompareSymbols] = useState<string[]>([]);

  // Update selected symbol when URL changes
  useEffect(() => {
    if (symbolParam) {
      setSelectedSymbol(symbolParam);
    }
  }, [symbolParam]);

  const { data: quote, isLoading: isLoadingQuote, error: quoteError } = useQuote(selectedSymbol);
  const { data: details, isLoading: isLoadingDetails, error: detailsError } = useStockDetails(selectedSymbol);
  const { data: financials, isLoading: isLoadingFinancials, error: financialsError } = useFinancials(selectedSymbol);

  const handleSymbolSelect = (symbol: string) => {
    if (compareMode) {
      if (!compareSymbols.includes(symbol)) {
        setCompareSymbols([...compareSymbols, symbol]);
      }
    } else {
      setSelectedSymbol(symbol);
    }
  };

  const handleRemoveSymbol = (symbol: string) => {
    setCompareSymbols(compareSymbols.filter((s) => s !== symbol));
  };

  const toggleCompareMode = () => {
    const newMode = !compareMode;
    setCompareMode(newMode);
    if (newMode && selectedSymbol && !compareSymbols.includes(selectedSymbol)) {
      setCompareSymbols([selectedSymbol]);
    } else if (!newMode) {
      setCompareSymbols([]);
    }
  };

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="border-b border-border bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Market Data</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {compareMode
                ? "Compare multiple symbols side by side"
                : "Search symbols and view live market quotes"}
            </p>
          </div>
          <Button
            onClick={toggleCompareMode}
            variant={compareMode ? "default" : "outline"}
            size="sm"
          >
            {compareMode ? (
              <>
                <TrendingDown className="mr-2 h-4 w-4" />
                Exit Compare
              </>
            ) : (
              <>
                <TrendingUp className="mr-2 h-4 w-4" />
                Compare Symbols
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          {/* Search Bar */}
          <SymbolSearch onSelect={handleSymbolSelect} />

          {compareMode ? (
            /* Comparison View */
            <CompareView
              symbols={compareSymbols}
              onRemoveSymbol={handleRemoveSymbol}
            />
          ) : (
            /* Single Symbol View */
            <>
              {/* Top Row: Quote Card + Key Stats */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <QuoteCard
                  quote={quote}
                  isLoading={isLoadingQuote}
                  error={quoteError}
                />
                <KeyStats
                  details={details}
                  isLoading={isLoadingDetails}
                  error={detailsError}
                />
              </div>

              {/* Run Eval Button */}
              {selectedSymbol && (
                <RunEvalButton symbol={selectedSymbol} />
              )}

              {/* Price Chart - Full Width */}
              {selectedSymbol && <PriceChart symbol={selectedSymbol} />}

              {/* Company Info */}
              {selectedSymbol && (
                <CompanyInfo
                  details={details}
                  financials={financials}
                  isLoadingDetails={isLoadingDetails}
                  isLoadingFinancials={isLoadingFinancials}
                  detailsError={detailsError}
                  financialsError={financialsError}
                />
              )}

              {/* Bottom Row: News Feed + Earnings */}
              {selectedSymbol && (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <NewsFeed symbol={selectedSymbol} />
                  <EarningsCard symbol={selectedSymbol} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MarketPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
      <MarketPageContent />
    </Suspense>
  );
}
