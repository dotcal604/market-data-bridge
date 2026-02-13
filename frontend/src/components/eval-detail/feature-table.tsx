"use client";

import { Card } from "@/components/ui/card";
import type { FeatureVector } from "@/lib/api/types";

interface Props {
  features: FeatureVector;
}

const FEATURE_GROUPS = [
  {
    label: "Price & Volume",
    keys: ["last", "bid", "ask", "volume", "avg_volume", "rvol", "vwap", "vwap_deviation_pct", "spread_pct"],
  },
  {
    label: "Volatility & Range",
    keys: ["atr", "atr_pct", "high_of_day", "low_of_day", "prev_close", "price_extension_pct", "gap_pct", "range_position_pct", "volatility_regime"],
  },
  {
    label: "Float & Market",
    keys: ["float_shares", "float_rotation_est", "volume_acceleration", "liquidity_bucket", "spy_change_pct", "qqq_change_pct", "market_alignment"],
  },
  {
    label: "Time",
    keys: ["time_of_day", "minutes_since_open"],
  },
] as const;

function formatVal(val: unknown): string {
  if (val == null) return "—";
  if (typeof val === "number") {
    if (Number.isInteger(val) && val > 1000) return val.toLocaleString();
    return val.toFixed(4).replace(/\.?0+$/, "");
  }
  return String(val);
}

export function FeatureTable({ features }: Props) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {FEATURE_GROUPS.map((group) => (
        <Card key={group.label} className="bg-card p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </h3>
          <div className="space-y-1">
            {group.keys.map((key) => (
              <div key={key} className="flex justify-between text-xs">
                <span className="font-mono text-muted-foreground">{key}</span>
                <span className="font-mono font-medium">
                  {formatVal((features as unknown as Record<string, unknown>)[key])}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
