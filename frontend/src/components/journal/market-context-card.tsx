"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/utils/formatters";

interface MarketContextData {
  spy_price: number | null;
  vix_level: number | null;
  symbol_quote: {
    bid: number | null;
    ask: number | null;
    last: number | null;
    volume: number | null;
  } | null;
  gap_pct: number | null;
  time_of_day: string;
}

interface MarketContextCardProps {
  data: MarketContextData | null;
  isLoading: boolean;
  error: string | null;
}

export function MarketContextCard({ data, isLoading, error }: MarketContextCardProps) {
  if (isLoading) {
    return (
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-base">Market Context</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading market data...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-base">Market Context</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-base">Market Context</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Enter a symbol to see market context</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card">
      <CardHeader>
        <CardTitle className="text-base">Market Context (Auto-Captured)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          {/* SPY Price */}
          <div>
            <p className="text-xs text-muted-foreground">SPY Price</p>
            <p className="font-mono text-sm font-medium">
              {data.spy_price !== null ? formatPrice(data.spy_price) : "N/A"}
            </p>
          </div>

          {/* VIX Level */}
          <div>
            <p className="text-xs text-muted-foreground">VIX Level</p>
            <p className="font-mono text-sm font-medium">
              {data.vix_level !== null ? data.vix_level.toFixed(2) : "N/A"}
            </p>
          </div>
        </div>

        {/* Symbol Quote */}
        {data.symbol_quote && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Symbol Quote</p>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground">Bid</p>
                <p className="font-mono text-xs">
                  {data.symbol_quote.bid !== null ? formatPrice(data.symbol_quote.bid) : "N/A"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Ask</p>
                <p className="font-mono text-xs">
                  {data.symbol_quote.ask !== null ? formatPrice(data.symbol_quote.ask) : "N/A"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Last</p>
                <p className="font-mono text-xs">
                  {data.symbol_quote.last !== null ? formatPrice(data.symbol_quote.last) : "N/A"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Volume</p>
                <p className="font-mono text-xs">
                  {data.symbol_quote.volume !== null
                    ? data.symbol_quote.volume.toLocaleString()
                    : "N/A"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Gap % and Time of Day */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Gap %</p>
            <p className="font-mono text-sm font-medium">
              {data.gap_pct !== null ? `${data.gap_pct >= 0 ? "+" : ""}${data.gap_pct.toFixed(2)}%` : "N/A"}
            </p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">Time of Day</p>
            <Badge variant="outline" className="text-xs">
              {data.time_of_day}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
