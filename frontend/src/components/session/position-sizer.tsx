"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSizePosition } from "@/lib/hooks/use-session";

export function PositionSizer() {
  const sizeMutation = useSizePosition();

  const [symbol, setSymbol] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [riskPercent, setRiskPercent] = useState("1");

  const handleCalculate = () => {
    const entry = parseFloat(entryPrice);
    const stop = parseFloat(stopPrice);
    const risk = parseFloat(riskPercent);
    if (!symbol || isNaN(entry) || isNaN(stop)) return;
    sizeMutation.mutate({
      symbol: symbol.toUpperCase(),
      entryPrice: entry,
      stopPrice: stop,
      riskPercent: isNaN(risk) ? undefined : risk,
    });
  };

  const result = sizeMutation.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Position Sizer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Symbol</label>
            <Input
              placeholder="AAPL"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="font-mono uppercase"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Risk %</label>
            <Input
              type="number"
              step={0.25}
              placeholder="1"
              value={riskPercent}
              onChange={(e) => setRiskPercent(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Entry Price</label>
            <Input
              type="number"
              step={0.01}
              placeholder="150.00"
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Stop Price</label>
            <Input
              type="number"
              step={0.01}
              placeholder="148.00"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              className="font-mono"
            />
          </div>
        </div>

        <Button
          size="sm"
          className="w-full"
          onClick={handleCalculate}
          disabled={sizeMutation.isPending || !symbol || !entryPrice || !stopPrice}
        >
          {sizeMutation.isPending ? "Calculating..." : "Calculate"}
        </Button>

        {result && (
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Shares</p>
                <p className="font-mono font-bold text-lg">{result.shares}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dollar Risk</p>
                <p className="font-mono font-bold text-lg text-red-400">
                  ${result.dollarRisk.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Notional Value</p>
                <p className="font-mono">${result.notionalValue.toFixed(0)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Risk/Share</p>
                <p className="font-mono">${result.riskPerShare.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">% of Account</p>
                <p className="font-mono">{result.pctOfAccount.toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Risk % Used</p>
                <p className="font-mono">{result.riskPctUsed.toFixed(2)}%</p>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground pt-1">
              Account equity: ${result.accountEquity.toFixed(0)}
            </p>
          </div>
        )}

        {sizeMutation.isError && (
          <p className="text-xs text-red-400">
            {sizeMutation.error instanceof Error ? sizeMutation.error.message : "Calculation failed"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
