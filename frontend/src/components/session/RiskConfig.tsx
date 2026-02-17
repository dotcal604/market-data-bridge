"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Settings, TrendingUp, DollarSign, Target, Activity } from "lucide-react";
import { useRiskConfig } from "@/lib/hooks/useSession";
import { formatPercent } from "@/lib/utils/formatters";

export function RiskConfig() {
  const { data: config, isLoading, error } = useRiskConfig();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-red-500/50 bg-red-500/10">
        <CardContent className="flex items-center gap-3 py-4">
          <AlertCircle className="h-5 w-5 text-red-400" />
          <div>
            <p className="text-sm font-medium text-red-400">Failed to load risk configuration</p>
            <p className="text-xs text-red-400/80">{String(error)}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!config) {
    return null;
  }

  const { effective } = config;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Settings className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Risk Configuration</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Effective risk limits (minimum of floors, manual overrides, and DB values)
        </p>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {/* Max Position % */}
          <Card className="bg-card/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Max Position %
              </CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold font-mono">
                {formatPercent(effective.max_position_pct, 2)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Per position
              </p>
            </CardContent>
          </Card>

          {/* Max Daily Loss % */}
          <Card className="bg-card/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Max Daily Loss %
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold font-mono">
                {formatPercent(effective.max_daily_loss_pct, 2)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Per session
              </p>
            </CardContent>
          </Card>

          {/* Max Concentration % */}
          <Card className="bg-card/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Max Concentration %
              </CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold font-mono">
                {formatPercent(effective.max_concentration_pct, 2)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Portfolio limit
              </p>
            </CardContent>
          </Card>

          {/* Volatility Scalar */}
          <Card className="bg-card/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Volatility Scalar
              </CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold font-mono">
                {effective.volatility_scalar.toFixed(2)}×
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Size adjustment
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Config sources note */}
        <div className="mt-6 rounded-lg border border-border bg-muted/50 p-4">
          <p className="text-xs text-muted-foreground">
            <strong>Note:</strong> Effective values are the minimum of three sources: 
            system floors (hardcoded safe limits), manual overrides (env vars), 
            and database values (user-tuned or auto-tuned). This ensures the strictest 
            risk control is always applied.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
