"use client";

import { useState, useEffect } from "react";
import { TrendingUp, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { marketClient } from "@/lib/api/market-client";
import type { TrendingSymbol } from "@/lib/api/types";

interface TrendingSymbolsProps {
  onSymbolClick: (symbol: string) => void;
}

export function TrendingSymbols({ onSymbolClick }: TrendingSymbolsProps) {
  const [trending, setTrending] = useState<TrendingSymbol[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTrending = () => {
    setLoading(true);
    setError(null);

    marketClient
      .getTrending()
      .then((data) => {
        setTrending(data || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load trending symbols");
        setLoading(false);
      });
  };

  useEffect(() => {
    loadTrending();
  }, []);

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-yellow-400" />
            <h3 className="text-sm font-semibold">Trending</h3>
          </div>
          <RefreshCw className="h-3 w-3 text-muted-foreground animate-spin" />
        </div>
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-8 bg-muted rounded"></div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-yellow-400" />
            <h3 className="text-sm font-semibold">Trending</h3>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={loadTrending}
            className="h-6 w-6 p-0"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
        <div className="text-xs text-red-400">{error}</div>
      </Card>
    );
  }

  if (trending.length === 0) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-yellow-400" />
            <h3 className="text-sm font-semibold">Trending</h3>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={loadTrending}
            className="h-6 w-6 p-0"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">No trending symbols</div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-yellow-400" />
          <h3 className="text-sm font-semibold">Trending</h3>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={loadTrending}
          className="h-6 w-6 p-0"
          title="Refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      <div className="space-y-1">
        {trending.map((item) => (
          <button
            key={item.symbol}
            onClick={() => onSymbolClick(item.symbol)}
            className="w-full px-3 py-2 text-left text-sm font-mono font-medium rounded-md bg-card hover:bg-accent transition-colors"
          >
            {item.symbol}
          </button>
        ))}
      </div>
    </Card>
  );
}
