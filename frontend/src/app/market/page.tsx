"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SymbolSearch } from "@/components/market/SymbolSearch";
import { QuoteCard } from "@/components/market/QuoteCard";
import { CompanyInfo } from "@/components/market/CompanyInfo";
import { useQuote, useStockDetails, useFinancials } from "@/lib/hooks/use-market";

function MarketPageContent() {
  const searchParams = useSearchParams();
  const symbolParam = searchParams.get("symbol");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(symbolParam);

  // Update selected symbol when URL changes
  useEffect(() => {
    if (symbolParam) {
      setSelectedSymbol(symbolParam);
    }
  }, [symbolParam]);

  const { data: quote, isLoading: isLoadingQuote, error: quoteError } = useQuote(selectedSymbol);
  const { data: details, isLoading: isLoadingDetails, error: detailsError } = useStockDetails(selectedSymbol);
  const { data: financials, isLoading: isLoadingFinancials, error: financialsError } = useFinancials(selectedSymbol);

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="border-b border-border bg-background px-6 py-4">
        <h1 className="text-2xl font-bold">Market Data</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search symbols and view live market quotes
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Search Bar */}
          <SymbolSearch onSelect={setSelectedSymbol} />

          {/* Quote Card */}
          <QuoteCard
            quote={quote}
            isLoading={isLoadingQuote}
            error={quoteError}
          />

          {/* Company Info */}
          <CompanyInfo
            details={details}
            financials={financials}
            isLoadingDetails={isLoadingDetails}
            isLoadingFinancials={isLoadingFinancials}
            detailsError={detailsError}
            financialsError={financialsError}
          />
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
