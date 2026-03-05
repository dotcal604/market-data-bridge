"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BarChart3, Loader2 } from "lucide-react";
import { useDivoomContent, useDivoomSetContent } from "@/lib/hooks/use-divoom";
import type { ContentSettings } from "@/lib/api/types";

const TIMEFRAMES = ["1d", "5d", "1mo", "3mo"] as const;

const COLOR_FIELDS: {
  key: keyof Pick<ContentSettings, "accentUp" | "accentDown" | "accentNeutral">;
  label: string;
}[] = [
  { key: "accentUp", label: "Up" },
  { key: "accentDown", label: "Down" },
  { key: "accentNeutral", label: "Neutral" },
];

export function ContentControl() {
  const { data: content, isLoading } = useDivoomContent();
  const mutation = useDivoomSetContent();

  const [ticker, setTicker] = useState("SPY");
  const [timeframe, setTimeframe] = useState("1mo");
  const [bars, setBars] = useState(22);
  const [fontId, setFontId] = useState(52);
  const [colors, setColors] = useState({
    accentUp: "#00CC44",
    accentDown: "#CC2200",
    accentNeutral: "#00BBDD",
  });

  // Sync from server state
  useEffect(() => {
    if (!content) return;
    setTicker(content.sparklineTicker);
    setTimeframe(content.sparklineTimeframe);
    setBars(content.sparklineBars);
    setFontId(content.fontId);
    setColors({
      accentUp: content.accentUp,
      accentDown: content.accentDown,
      accentNeutral: content.accentNeutral,
    });
  }, [content]);

  function commitTicker() {
    const upper = ticker.trim().toUpperCase();
    if (!upper) return;
    setTicker(upper);
    mutation.mutate({ sparklineTicker: upper });
  }

  function commitTimeframe(tf: string) {
    setTimeframe(tf);
    mutation.mutate({ sparklineTimeframe: tf });
  }

  function commitBars() {
    const clamped = Math.min(200, Math.max(5, bars));
    setBars(clamped);
    mutation.mutate({ sparklineBars: clamped });
  }

  function commitFontId() {
    const clamped = Math.min(255, Math.max(0, Math.round(fontId)));
    setFontId(clamped);
    mutation.mutate({ fontId: clamped });
  }

  function commitColor(
    key: "accentUp" | "accentDown" | "accentNeutral",
    hex: string,
  ) {
    setColors((prev) => ({ ...prev, [key]: hex }));
    mutation.mutate({ [key]: hex });
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BarChart3 className="h-4 w-4" />
          Content Feed
          <Badge variant="outline" className="ml-auto font-mono text-xs">
            {ticker}
          </Badge>
          {mutation.isPending && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sparkline Ticker */}
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">
            Sparkline Ticker
          </div>
          <Input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            onBlur={commitTicker}
            onKeyDown={(e) => e.key === "Enter" && commitTicker()}
            placeholder="SPY"
            className="font-mono text-xs uppercase"
            disabled={mutation.isPending}
          />
        </div>

        {/* Sparkline Timeframe */}
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">
            Timeframe
          </div>
          <div className="flex gap-2">
            {TIMEFRAMES.map((tf) => (
              <Button
                key={tf}
                variant="outline"
                size="sm"
                onClick={() => commitTimeframe(tf)}
                disabled={mutation.isPending}
                className={
                  timeframe === tf
                    ? "border-primary bg-primary/10 text-primary"
                    : ""
                }
              >
                {tf}
              </Button>
            ))}
          </div>
        </div>

        {/* Sparkline Bars */}
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">
            Bars (5–200)
          </div>
          <Input
            type="number"
            min={5}
            max={200}
            value={bars}
            onChange={(e) => setBars(Number(e.target.value))}
            onBlur={commitBars}
            onKeyDown={(e) => e.key === "Enter" && commitBars()}
            className="font-mono text-xs w-24"
            disabled={mutation.isPending}
          />
        </div>

        {/* Direction Colors */}
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">
            Direction Colors
          </div>
          <div className="flex gap-4">
            {COLOR_FIELDS.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{label}</span>
                <div className="relative">
                  <div
                    className="h-6 w-6 rounded border border-white/20"
                    style={{ backgroundColor: colors[key] }}
                  />
                  <input
                    type="color"
                    value={colors[key]}
                    onChange={(e) => commitColor(key, e.target.value)}
                    disabled={mutation.isPending}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    title={`${label} color`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Font ID */}
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">
            Font ID (0–255)
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={255}
              value={fontId}
              onChange={(e) => setFontId(Number(e.target.value))}
              onBlur={commitFontId}
              onKeyDown={(e) => e.key === "Enter" && commitFontId()}
              className="font-mono text-xs w-20"
              disabled={mutation.isPending}
            />
            <span className="text-xs text-muted-foreground">
              52 = sans-serif · others untested
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
