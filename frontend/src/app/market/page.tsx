"use client";

import { useState } from "react";
import { PriceChart } from "@/components/market/PriceChart";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function MarketPage() {
  const [symbol, setSymbol] = useState("AAPL");
  const [inputValue, setInputValue] = useState("AAPL");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      setSymbol(inputValue.trim().toUpperCase());
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Market Data</h1>
        <p className="text-sm text-muted-foreground">
          Historical price charts and market data
        </p>
      </div>

      {/* Symbol Input */}
      <Card>
        <CardHeader>
          <CardTitle>Symbol Lookup</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              type="text"
              placeholder="Enter symbol (e.g., AAPL)"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="max-w-sm"
            />
            <Button type="submit">Load Chart</Button>
          </form>
        </CardContent>
      </Card>

      {/* Price Chart */}
      <PriceChart symbol={symbol} />
    </div>
  );
}
