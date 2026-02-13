"use client";

import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";

interface FeatureRadarProps {
  features: {
    rvol: number;
    spread_pct: number;
    volume_acceleration: number;
    atr_pct: number;
    price_extension_pct: number;
    gap_pct: number;
    range_position_pct: number;
    float_rotation_est: number;
    vwap_deviation_pct: number;
  };
}

interface RadarDataPoint {
  feature: string;
  value: number;
  rawValue: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: RadarDataPoint;
  }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0].payload;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      <p className="font-semibold text-foreground">{data.feature}</p>
      <p className="font-mono text-sm text-muted-foreground">
        Raw: {data.rawValue.toFixed(3)}
      </p>
      <p className="font-mono text-sm text-muted-foreground">
        Normalized: {data.value.toFixed(3)}
      </p>
    </div>
  );
}

export function FeatureRadar({ features }: FeatureRadarProps) {
  // Normalize values to 0-1 range per spec
  const data: RadarDataPoint[] = [
    {
      feature: "RVol",
      value: features.rvol / 20,
      rawValue: features.rvol,
    },
    {
      feature: "Spread %",
      value: features.spread_pct / 5,
      rawValue: features.spread_pct,
    },
    {
      feature: "Vol Accel",
      value: features.volume_acceleration / 10,
      rawValue: features.volume_acceleration,
    },
    {
      feature: "ATR %",
      value: features.atr_pct / 20,
      rawValue: features.atr_pct,
    },
    {
      feature: "Extension",
      value: Math.abs(features.price_extension_pct) / 50,
      rawValue: features.price_extension_pct,
    },
    {
      feature: "Gap %",
      value: Math.abs(features.gap_pct) / 20,
      rawValue: features.gap_pct,
    },
    {
      feature: "Range Pos",
      value: features.range_position_pct / 100,
      rawValue: features.range_position_pct,
    },
    {
      feature: "Float Rot",
      value: features.float_rotation_est / 5,
      rawValue: features.float_rotation_est,
    },
    {
      feature: "VWAP Dev",
      value: Math.abs(features.vwap_deviation_pct) / 10,
      rawValue: features.vwap_deviation_pct,
    },
  ];

  return (
    <Card>
      <CardContent>
        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data}>
              <PolarGrid stroke="rgba(255, 255, 255, 0.2)" />
              <PolarAngleAxis
                dataKey="feature"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              />
              <Radar
                name="Features"
                dataKey="value"
                stroke="rgb(52, 211, 153)"
                fill="rgb(52, 211, 153)"
                fillOpacity={0.2}
              />
              <Tooltip content={<CustomTooltip />} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
