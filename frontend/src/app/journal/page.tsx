"use client";

import { useState, useEffect } from "react";
import { useJournalEntries } from "@/lib/hooks/use-journal";
import { JournalTable } from "@/components/journal/journal-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight } from "lucide-react";

const ITEMS_PER_PAGE = 25;

export default function JournalPage() {
  const [symbolFilter, setSymbolFilter] = useState("");
  const [debouncedSymbol, setDebouncedSymbol] = useState("");
  const [currentPage, setCurrentPage] = useState(0);

  // Debounce symbol filter
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSymbol(symbolFilter);
      setCurrentPage(0); // Reset to first page on filter change
    }, 300);
    return () => clearTimeout(timer);
  }, [symbolFilter]);

  const { data: entries, isLoading, error } = useJournalEntries({
    symbol: debouncedSymbol || undefined,
    limit: ITEMS_PER_PAGE,
    offset: currentPage * ITEMS_PER_PAGE,
  });

  const handlePrevPage = () => {
    if (currentPage > 0) {
      setCurrentPage((prev) => prev - 1);
    }
  };

  const handleNextPage = () => {
    if (entries && entries.length === ITEMS_PER_PAGE) {
      setCurrentPage((prev) => prev + 1);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Journal</h1>
          <p className="text-sm text-muted-foreground">
            Trade journal entries and post-trade reflections
          </p>
        </div>
      </div>

      {/* Search Filter */}
      <div className="flex items-end gap-4">
        <div className="w-64 space-y-2">
          <Label htmlFor="symbol" className="text-sm">
            Filter by Symbol
          </Label>
          <Input
            id="symbol"
            type="text"
            placeholder="e.g., AAPL"
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
            className="font-mono"
          />
        </div>
        {symbolFilter && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSymbolFilter("")}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-destructive">
            Error loading journal entries: {error.message}
          </p>
        </div>
      ) : entries ? (
        <>
          <JournalTable entries={entries} />

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Page {currentPage + 1}
              {entries.length === ITEMS_PER_PAGE && " of many"}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrevPage}
                disabled={currentPage === 0}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={!entries || entries.length < ITEMS_PER_PAGE}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
