"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useRiskConfig, useUpdateRiskConfig, useTuneRisk } from "@/lib/hooks/use-session";

const FIELDS = [
  { key: "max_position_pct", label: "Max Position %", step: 0.5 },
  { key: "max_daily_loss_pct", label: "Max Daily Loss %", step: 0.5 },
  { key: "max_concentration_pct", label: "Max Concentration %", step: 1 },
  { key: "volatility_scalar", label: "Volatility Scalar", step: 0.1 },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

export function RiskConfigCard() {
  const { data: config, isLoading } = useRiskConfig();
  const updateMutation = useUpdateRiskConfig();
  const tuneMutation = useTuneRisk();

  const [values, setValues] = useState<Record<FieldKey, string>>({
    max_position_pct: "",
    max_daily_loss_pct: "",
    max_concentration_pct: "",
    volatility_scalar: "",
  });

  // Sync form state when config loads
  useEffect(() => {
    if (config?.effective) {
      setValues({
        max_position_pct: String(config.effective.max_position_pct),
        max_daily_loss_pct: String(config.effective.max_daily_loss_pct),
        max_concentration_pct: String(config.effective.max_concentration_pct),
        volatility_scalar: String(config.effective.volatility_scalar),
      });
    }
  }, [config]);

  if (isLoading || !config) {
    return <Skeleton className="h-64 rounded-lg" />;
  }

  const handleSave = () => {
    const params: Record<string, number> = {};
    for (const field of FIELDS) {
      const num = parseFloat(values[field.key]);
      if (!isNaN(num)) params[field.key] = num;
    }
    updateMutation.mutate(params);
  };

  const handleTune = () => {
    tuneMutation.mutate(undefined, {
      onSuccess: (result) => {
        if (result.suggestions?.length) {
          const newValues = { ...values };
          for (const s of result.suggestions) {
            if (s.param in newValues) {
              newValues[s.param as FieldKey] = String(s.suggested);
            }
          }
          setValues(newValues);
        }
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Risk Parameters</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {FIELDS.map((field) => (
          <div key={field.key} className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {field.label}
            </label>
            <Input
              type="number"
              step={field.step}
              value={values[field.key]}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
              }
              className="font-mono"
            />
            <p className="text-[10px] text-muted-foreground">
              Floor: {config.floors[field.key]}
            </p>
          </div>
        ))}

        {/* Tune suggestions */}
        {tuneMutation.data?.suggestions?.length ? (
          <div className="rounded-md border border-amber-600/30 bg-amber-600/5 p-3 space-y-1">
            <p className="text-xs font-medium text-amber-400">Auto-Tune Suggestions</p>
            {tuneMutation.data.suggestions.map((s) => (
              <p key={s.param} className="text-xs text-muted-foreground">
                {s.param}: {s.current} → {s.suggested} — {s.reason}
              </p>
            ))}
          </div>
        ) : null}

        <div className="flex gap-2 pt-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateMutation.isPending}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-600 text-amber-400 hover:bg-amber-600/10"
            onClick={handleTune}
            disabled={tuneMutation.isPending}
          >
            {tuneMutation.isPending ? "Tuning..." : "Auto-Tune"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
