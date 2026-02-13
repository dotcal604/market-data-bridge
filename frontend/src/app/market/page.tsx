"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NewsFeed } from "@/components/market/NewsFeed";
import { EarningsTable } from "@/components/market/EarningsTable";
import { TrendingSymbols } from "@/components/market/TrendingSymbols";

export default function MarketPage() {
  const [symbol, setSymbol] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      setSymbol(searchInput.trim().toUpperCase());
    }
  };

  const handleTrendingClick = (trendingSymbol: string) => {
    setSymbol(trendingSymbol);
    setSearchInput(trendingSymbol);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold mb-1">Market Data</h1>
        <p className="text-sm text-muted-foreground">
          View news, earnings, and trending symbols
        </p>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 max-w-md">
        <Input
          type="text"
          placeholder="Enter symbol (e.g., AAPL)"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="font-mono"
        />
        <Button type="submit" disabled={!searchInput.trim()}>
          <Search className="h-4 w-4 mr-2" />
          Search
        </Button>
      </form>

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Content - News and Earnings */}
        <div className="lg:col-span-3 space-y-6">
          {!symbol ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-lg mb-2">No symbol selected</p>
              <p className="text-sm">
                Enter a symbol above or click a trending symbol to get started
              </p>
            </div>
          ) : (
            <>
              <NewsFeed symbol={symbol} />
              <EarningsTable symbol={symbol} />
            </>
          )}
        </div>

        {/* Sidebar - Trending */}
        <div className="lg:col-span-1">
          <TrendingSymbols onSymbolClick={handleTrendingClick} />
        </div>
      </div>
    </div>
  );
}
