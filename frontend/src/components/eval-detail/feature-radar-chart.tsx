"use client";

import { Card } from "@/components/ui/card";
import type { FeatureVector } from "@/lib/api/types";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface Props {
  features: FeatureVector;
}

interface RadarDatum {
  readonly feature: string;
  readonly value: number;
  readonly rawValue: number;
  readonly description: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeLinear(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  const normalized = ((value - min) / (max - min)) * 100;
  return clamp(normalized, 0, 100);
}

function buildRadarData(features: FeatureVector): readonly RadarDatum[] {
  return [
    {
      feature: "Relative Vol",
      value: normalizeLinear(features.rvol, 0, 5),
      rawValue: features.rvol,
      description: "Relative volume vs 20-day average",
    },
    {
      feature: "ATR %",
      value: normalizeLinear(features.atr_pct, 0, 8),
      rawValue: features.atr_pct,
      description: "Volatility as percent of price",
    },
    {
      feature: "Range Pos",
      value: normalizeLinear(features.range_position_pct, 0, 100),
      rawValue: features.range_position_pct,
      description: "Position inside day range",
    },
    {
      feature: "VWAP Dev",
      value: normalizeLinear(Math.abs(features.vwap_deviation_pct), 0, 5),
      rawValue: features.vwap_deviation_pct,
      description: "Distance from VWAP (%)",
    },
    {
      feature: "Extension",
      value: normalizeLinear(Math.abs(features.price_extension_pct), 0, 10),
      rawValue: features.price_extension_pct,
      description: "Price extension from prior close (%)",
    },
    {
      feature: "Spread",
      value: 100 - normalizeLinear(features.spread_pct, 0, 2),
      rawValue: features.spread_pct,
      description: "Tighter spread is better",
    },
  ];
}

interface TooltipProps {
  readonly active?: boolean;
  readonly payload?: ReadonlyArray<{ payload: RadarDatum }>;
}

function FeatureTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-md border bg-card p-2 text-xs shadow-sm">
      <p className="font-semibold">{point.feature}</p>
      <p className="text-muted-foreground">{point.description}</p>
      <p className="font-mono">Raw: {point.rawValue.toFixed(3)}</p>
      <p className="font-mono">Normalized: {point.value.toFixed(1)}/100</p>
    </div>
  );
}

export function FeatureRadarChart({ features }: Props) {
  const data = buildRadarData(features);

  return (
    <Card className="bg-card p-4">
      <h3 className="mb-1 text-sm font-semibold">Feature Radar</h3>
      <p className="mb-3 text-xs text-muted-foreground">Quick normalized view (0-100) of key market conditions.</p>
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="hsl(var(--muted-foreground) / 0.25)" />
            <PolarAngleAxis dataKey="feature" tick={{ fontSize: 12 }} />
            <PolarRadiusAxis domain={[0, 100]} tickCount={6} tick={{ fontSize: 10 }} />
            <Radar
              name="Feature score"
              dataKey="value"
              stroke="hsl(var(--primary))"
              fill="hsl(var(--primary))"
              fillOpacity={0.24}
            />
            <Tooltip content={<FeatureTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
