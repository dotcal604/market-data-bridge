"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImageIcon } from "lucide-react";

const CHART_TYPES = [
  { key: "spy-sparkline", label: "SPY Sparkline" },
  { key: "sector-heatmap", label: "Sector Heatmap" },
  { key: "pnl-curve", label: "PnL Curve" },
  { key: "rsi-gauge", label: "RSI Gauge" },
  { key: "vix-gauge", label: "VIX Gauge" },
  { key: "volume-bars", label: "Volume Bars" },
] as const;

interface ChartThumbnailsProps {
  chartBaseUrl?: string;
  refreshKey?: number;
}

export function ChartThumbnails({ chartBaseUrl, refreshKey }: ChartThumbnailsProps) {
  const base = chartBaseUrl || "/api/divoom/charts";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ImageIcon className="h-4 w-4" />
          Display Charts
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CHART_TYPES.map(({ key, label }) => (
            <div
              key={key}
              className="overflow-hidden rounded-md border border-border bg-[#0A0A0A]"
            >
              <img
                src={`${base}/${key}?t=${refreshKey ?? 0}`}
                alt={label}
                className="aspect-[3/1] w-full object-contain"
                loading="lazy"
              />
              <div className="px-1.5 py-1 text-center text-[9px] text-muted-foreground">
                {label}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
