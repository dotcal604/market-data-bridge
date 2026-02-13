"use client";

import { useState } from "react";
import { useScreenerFilters, useRunScreener } from "@/lib/hooks/use-screeners";
import { ScreenerSelector } from "@/components/screener/screener-selector";
import { ResultsTable } from "@/components/screener/results-table";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";

export default function ScreenerPage() {
  const [selectedScreener, setSelectedScreener] = useState("day_gainers");
  const [count, setCount] = useState(20);

  const filters = useScreenerFilters();
  const results = useRunScreener(selectedScreener, count);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Stock Screener</h1>
        <p className="text-sm text-muted-foreground">
          Run pre-built screeners and view results
        </p>
      </div>

      {filters.isLoading ? (
        <Skeleton className="h-24 rounded-lg" />
      ) : filters.error ? (
        <Card className="border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            Failed to load screener filters
          </div>
        </Card>
      ) : filters.data ? (
        <Card className="p-4">
          <ScreenerSelector
            filters={filters.data}
            selectedScreener={selectedScreener}
            onScreenerChange={setSelectedScreener}
            count={count}
            onCountChange={setCount}
          />
        </Card>
      ) : null}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Results
            {results.data && (
              <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">
                ({results.data.count})
              </span>
            )}
          </h2>
          {results.isFetching && (
            <span className="text-xs text-muted-foreground">Loading...</span>
          )}
        </div>

        {results.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : results.error ? (
          <Card className="border-destructive/50 bg-destructive/10 p-4">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              Failed to load screener results
            </div>
          </Card>
        ) : results.data ? (
          results.data.results.length > 0 ? (
            <ResultsTable results={results.data.results} />
          ) : (
            <Card className="p-8">
              <p className="text-center text-sm text-muted-foreground">
                No results found for this screener
              </p>
            </Card>
          )
        ) : null}
      </div>
    </div>
  );
}
