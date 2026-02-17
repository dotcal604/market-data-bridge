"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { evalClient } from "@/lib/api/eval-client";

interface SimulationResultsPanelProps {
  weights: {
    claude: number;
    gpt4o: number;
    gemini: number;
    k: number;
  };
}

interface SimulationResult {
  simulated_weights: { claude: number; gpt4o: number; gemini: number; k: number };
  current_weights: { claude: number; gpt4o: number; gemini: number; k: number };
  evaluations_count: number;
  outcomes_with_trades: number;
  comparison: {
    current: {
      avg_score: number;
      trade_rate: number;
      accuracy: number | null;
    };
    simulated: {
      avg_score: number;
      trade_rate: number;
      accuracy: number | null;
    };
    delta: {
      avg_score: number;
      trade_rate: number;
      accuracy: number | null;
      decisions_changed: number;
      decisions_changed_pct: number;
    };
  };
}

function DeltaCell({ label, value, suffix = "", format = "decimal" }: {
  label: string;
  value: number | null;
  suffix?: string;
  format?: "decimal" | "percent";
}) {
  if (value === null) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-mono text-sm text-muted-foreground">N/A</p>
      </div>
    );
  }

  const color = value > 0 ? "text-emerald-400" : value < 0 ? "text-red-400" : "text-muted-foreground";
  const sign = value > 0 ? "+" : "";
  const formatted = format === "percent" ? (value * 100).toFixed(1) : value.toFixed(2);
  
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-mono text-sm font-bold ${color}`}>
        {sign}{formatted}{suffix}
      </p>
    </div>
  );
}

export function SimulationResultsPanel({ weights }: SimulationResultsPanelProps) {
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(90);
  const [symbol, setSymbol] = useState<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-fire simulation on weight change (debounced 300ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    
    debounceRef.current = setTimeout(async () => {
      const { claude, gpt4o, gemini, k } = weights;
      if (claude + gpt4o + gemini === 0) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        const data = await evalClient.simulateWeights({
          claude,
          gpt4o,
          gemini,
          k,
          days,
          symbol: symbol || undefined,
        });
        setResult(data as SimulationResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Simulation failed");
        setResult(null);
      } finally {
        setIsLoading(false);
      }
    }, 300);
    
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [weights, days, symbol]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Live Simulation</CardTitle>
        <p className="text-xs text-muted-foreground">
          Re-scoring recent evaluations with proposed weights
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Lookback Days</label>
            <Input
              type="number"
              value={days}
              onChange={(e) => setDays(Math.max(1, parseInt(e.target.value) || 90))}
              min={1}
              max={365}
              className="h-8 font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Symbol Filter (optional)</label>
            <Input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="e.g., AAPL"
              className="h-8 font-mono text-sm uppercase"
            />
          </div>
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 rounded-md" />
            <Skeleton className="h-6 rounded-md" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        ) : result ? (
          <>
            {/* Sample size badge */}
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs">
                {result.evaluations_count} evaluations
              </Badge>
              {result.outcomes_with_trades > 0 && (
                <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                  {result.outcomes_with_trades} with outcomes
                </Badge>
              )}
            </div>

            {/* Delta metrics */}
            <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-card/50 p-3">
              <DeltaCell label="Score Delta" value={result.comparison.delta.avg_score} />
              <DeltaCell label="Trade Rate Δ" value={result.comparison.delta.trade_rate} format="percent" suffix="%" />
              <DeltaCell label="Accuracy Δ" value={result.comparison.delta.accuracy} format="percent" suffix="%" />
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Decisions Changed</p>
                <p className="font-mono text-sm font-bold">
                  {result.comparison.delta.decisions_changed}
                  <span className="text-xs text-muted-foreground ml-1">
                    ({(result.comparison.delta.decisions_changed_pct * 100).toFixed(1)}%)
                  </span>
                </p>
              </div>
            </div>

            {/* Comparison table */}
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Metric</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Current</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Simulated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="px-3 py-2 text-muted-foreground">Avg Score</td>
                    <td className="px-3 py-2 text-right font-mono">{result.comparison.current.avg_score.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{result.comparison.simulated.avg_score.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-muted-foreground">Trade Rate</td>
                    <td className="px-3 py-2 text-right font-mono">{(result.comparison.current.trade_rate * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{(result.comparison.simulated.trade_rate * 100).toFixed(1)}%</td>
                  </tr>
                  {result.comparison.current.accuracy !== null && (
                    <tr>
                      <td className="px-3 py-2 text-muted-foreground">Accuracy</td>
                      <td className="px-3 py-2 text-right font-mono">{(result.comparison.current.accuracy * 100).toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{(result.comparison.simulated.accuracy! * 100).toFixed(1)}%</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="rounded-md border border-muted bg-card/50 p-4">
            <p className="text-xs text-muted-foreground text-center">
              Adjust sliders to see simulation results
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
