"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MarketContextCard } from "./market-context-card";
import { X } from "lucide-react";

interface MarketContextData {
  spy_price: number | null;
  vix_level: number | null;
  symbol_quote: {
    bid: number | null;
    ask: number | null;
    last: number | null;
    volume: number | null;
    open: number | null;
    prev_close: number | null;
  } | null;
  gap_pct: number | null;
  time_of_day: string;
}

const PREDEFINED_TAGS = ["momentum", "mean-reversion", "breakout", "earnings", "news"] as const;
const SUGGESTION_BLUR_DELAY_MS = 200;

function getTimeOfDay(): string {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeInMinutes = hour * 60 + minute;

  // Market hours in ET (assuming we're running in ET or converting)
  // For client-side, this is a simplified version
  if (timeInMinutes < 9 * 60 + 30) return "pre-market";
  if (timeInMinutes < 10 * 60) return "morning";
  if (timeInMinutes < 12 * 60) return "midday";
  if (timeInMinutes < 15 * 60) return "afternoon";
  if (timeInMinutes < 16 * 60) return "close";
  return "after-hours";
}

export function JournalForm() {
  const router = useRouter();
  const [symbol, setSymbol] = useState("");
  const [strategyVersion, setStrategyVersion] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Market context state
  const [marketContext, setMarketContext] = useState<MarketContextData | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

  // Symbol autocomplete state
  const [symbolSuggestions, setSymbolSuggestions] = useState<Array<{ symbol: string; name: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Debounced symbol fetch for market context
  useEffect(() => {
    if (!symbol || symbol.length < 1) {
      setMarketContext(null);
      setSymbolSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      // Fetch autocomplete suggestions
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(symbol)}`);
        if (res.ok) {
          const data = await res.json();
          setSymbolSuggestions(data.results || []);
        }
      } catch {
        // Silent fail for suggestions
      }

      // Fetch market context if symbol looks valid (at least 1 char)
      if (symbol.length >= 1) {
        await fetchMarketContext(symbol.toUpperCase());
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [symbol]);

  const fetchMarketContext = async (sym: string) => {
    setIsLoadingContext(true);
    setContextError(null);

    try {
      // Fetch SPY, VIX, and symbol quote in parallel
      const [spyRes, vixRes, symbolRes] = await Promise.all([
        fetch("/api/quote/SPY"),
        fetch("/api/quote/%5EVIX"),
        fetch(`/api/quote/${sym}`),
      ]);

      const spy = spyRes.ok ? await spyRes.json() : null;
      const vix = vixRes.ok ? await vixRes.json() : null;
      const symbolQuote = symbolRes.ok ? await symbolRes.json() : null;

      if (!symbolQuote) {
        setContextError("Could not fetch symbol quote");
        return;
      }

      // Calculate gap %
      let gap_pct: number | null = null;
      if (symbolQuote.open !== null && symbolQuote.prev_close !== null && symbolQuote.prev_close !== 0) {
        gap_pct = ((symbolQuote.open - symbolQuote.prev_close) / symbolQuote.prev_close) * 100;
      }

      setMarketContext({
        spy_price: spy?.last ?? null,
        vix_level: vix?.last ?? null,
        symbol_quote: {
          bid: symbolQuote.bid ?? null,
          ask: symbolQuote.ask ?? null,
          last: symbolQuote.last ?? null,
          volume: symbolQuote.volume ?? null,
          open: symbolQuote.open ?? null,
          prev_close: symbolQuote.prev_close ?? null,
        },
        gap_pct,
        time_of_day: getTimeOfDay(),
      });
    } catch (err) {
      setContextError(err instanceof Error ? err.message : "Failed to fetch market data");
    } finally {
      setIsLoadingContext(false);
    }
  };

  const handleSymbolSelect = (selectedSymbol: string) => {
    setSymbol(selectedSymbol);
    setShowSuggestions(false);
    setSymbolSuggestions([]);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!symbol.trim()) {
      setError("Symbol is required");
      return;
    }

    const trimmedReasoning = reasoning.trim();
    if (!trimmedReasoning || trimmedReasoning.split("\n").length < 3) {
      setError("Reasoning must be at least 3 lines");
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        symbol: symbol.toUpperCase(),
        strategy_version: strategyVersion.trim() || undefined,
        reasoning: trimmedReasoning,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        spy_price: marketContext?.spy_price ?? undefined,
        vix_level: marketContext?.vix_level ?? undefined,
        gap_pct: marketContext?.gap_pct ?? undefined,
        time_of_day: marketContext?.time_of_day ?? undefined,
      };

      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errorData.error ?? `HTTP ${res.status}`);
      }

      // Success - redirect to journal history
      router.push("/journal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create journal entry");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-card">
        <CardHeader>
          <CardTitle>New Journal Entry</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Symbol with Autocomplete */}
            <div className="space-y-2 relative">
              <Label htmlFor="symbol">
                Symbol <span className="text-destructive">*</span>
              </Label>
              <Input
                id="symbol"
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), SUGGESTION_BLUR_DELAY_MS)}
                placeholder="AAPL"
                required
                className="uppercase"
              />
              {showSuggestions && symbolSuggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-card border border-border rounded-md shadow-lg max-h-60 overflow-auto">
                  {symbolSuggestions.slice(0, 10).map((item) => (
                    <button
                      key={item.symbol}
                      type="button"
                      onClick={() => handleSymbolSelect(item.symbol)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 flex items-center justify-between"
                    >
                      <span className="font-mono font-medium">{item.symbol}</span>
                      <span className="text-xs text-muted-foreground truncate ml-2">
                        {item.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Strategy Version */}
            <div className="space-y-2">
              <Label htmlFor="strategy-version">Strategy Version</Label>
              <Input
                id="strategy-version"
                value={strategyVersion}
                onChange={(e) => setStrategyVersion(e.target.value)}
                placeholder="momentum_v3"
              />
            </div>

            {/* Reasoning */}
            <div className="space-y-2">
              <Label htmlFor="reasoning">
                Reasoning <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="reasoning"
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                placeholder="Why this trade? Key drivers, risk factors..."
                rows={5}
                required
              />
              <p className="text-xs text-muted-foreground">Minimum 3 lines</p>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-2">
                {PREDEFINED_TAGS.map((tag) => (
                  <Badge
                    key={tag}
                    variant={selectedTags.includes(tag) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                    {selectedTags.includes(tag) && (
                      <X className="ml-1 h-3 w-3" />
                    )}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Error Display */}
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Creating..." : "Create Entry"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Market Context Card */}
      <MarketContextCard
        data={marketContext}
        isLoading={isLoadingContext}
        error={contextError}
      />
    </div>
  );
}
