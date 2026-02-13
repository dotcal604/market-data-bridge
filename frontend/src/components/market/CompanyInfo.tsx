"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice, formatDecimalPercent } from "@/lib/utils/formatters";
import type { StockDetails, Financials } from "@/lib/api/market-client";

interface CompanyInfoProps {
  details: StockDetails | undefined;
  financials: Financials | undefined;
  isLoadingDetails: boolean;
  isLoadingFinancials: boolean;
  detailsError: Error | null;
  financialsError: Error | null;
}

export function CompanyInfo({
  details,
  financials,
  isLoadingDetails,
  isLoadingFinancials,
  detailsError,
  financialsError,
}: CompanyInfoProps) {
  const isLoading = isLoadingDetails || isLoadingFinancials;
  const hasError = detailsError || financialsError;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Company Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
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

  if (hasError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Company Information</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {detailsError?.message || financialsError?.message || "Failed to load company data"}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!details) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Company Information</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select a symbol to view company information
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
        <CardTitle>Company Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Company Overview */}
        {details.name && (
          <div>
            <h3 className="text-sm font-semibold text-foreground">{details.name}</h3>
            {details.description && (
              <p className="mt-2 text-sm text-muted-foreground line-clamp-3">
                {details.description}
              </p>
            )}
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4">
          {/* Sector */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Sector</div>
            <div className="mt-1 text-sm font-semibold">
              {details.sector || "—"}
            </div>
          </div>

          {/* Industry */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Industry</div>
            <div className="mt-1 text-sm font-semibold">
              {details.industry || "—"}
            </div>
          </div>

          {/* Market Cap */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Market Cap</div>
            <div className="mt-1 font-mono text-sm font-semibold">
              {formatLargeNumber(details.marketCap)}
            </div>
          </div>

          {/* PE Ratio */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">P/E Ratio</div>
            <div className="mt-1 font-mono text-sm font-semibold">
              {details.trailingPE != null 
                ? details.trailingPE.toFixed(2) 
                : "—"}
            </div>
          </div>

          {/* 52-Week Range */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">52-Week Range</div>
            <div className="mt-1 font-mono text-sm font-semibold">
              {formatPrice(details.fiftyTwoWeekLow)} - {formatPrice(details.fiftyTwoWeekHigh)}
            </div>
          </div>

          {/* Beta */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Beta</div>
            <div className="mt-1 font-mono text-sm font-semibold">
              {details.beta != null ? details.beta.toFixed(2) : "—"}
            </div>
          </div>

          {/* Dividend Yield */}
          {details.dividendYield != null && (
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-xs text-muted-foreground">Dividend Yield</div>
              <div className="mt-1 font-mono text-sm font-semibold">
                {formatDecimalPercent(details.dividendYield)}
              </div>
            </div>
          )}

          {/* Average Volume */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">Avg Volume</div>
            <div className="mt-1 font-mono text-sm font-semibold">
              {details.averageVolume != null
                ? details.averageVolume.toLocaleString()
                : "—"}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
