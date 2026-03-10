"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePositions, useAccountSummary } from "@/lib/hooks/use-account";
import { useSession } from "@/lib/hooks/use-session";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface RiskAlert {
  severity: "warning" | "danger";
  message: string;
}

export function RiskAlertsCard() {
  const positions = usePositions(10_000);
  const summary = useAccountSummary(10_000);
  const session = useSession();

  const isLoading =
    positions.isLoading || summary.isLoading || session.isLoading;

  const alerts = useMemo<RiskAlert[]>(() => {
    const result: RiskAlert[] = [];

    // Check position concentration
    const netLiq = summary.data?.netLiquidation;
    const positionsList = positions.data?.positions;

    if (netLiq && netLiq > 0 && positionsList && positionsList.length > 0) {
      for (const pos of positionsList) {
        const notional = Math.abs(pos.position * pos.avgCost);
        const weight = (notional / netLiq) * 100;
        if (weight > 25) {
          result.push({
            severity: "danger",
            message: `${pos.symbol} is ${weight.toFixed(0)}% of portfolio (>25%)`,
          });
        } else if (weight > 15) {
          result.push({
            severity: "warning",
            message: `${pos.symbol} is ${weight.toFixed(0)}% of portfolio (>15%)`,
          });
        }
      }
    }

    // Check session proximity to max trades
    const sessionData = session.data;
    if (sessionData) {
      const { tradeCount, limits, locked, consecutiveLosses } = sessionData;
      const maxTrades = limits?.maxDailyTrades ?? 0;

      if (locked) {
        result.push({
          severity: "danger",
          message: `Session locked: ${sessionData.lockReason ?? "manual lock"}`,
        });
      } else if (maxTrades > 0 && tradeCount >= maxTrades - 1) {
        result.push({
          severity: "warning",
          message: `${tradeCount}/${maxTrades} trades used -- near daily limit`,
        });
      }

      const lossLimit = limits?.consecutiveLossLimit ?? 3;
      if (consecutiveLosses >= lossLimit - 1 && consecutiveLosses > 0) {
        result.push({
          severity: "warning",
          message: `${consecutiveLosses} consecutive losses -- near limit of ${lossLimit}`,
        });
      }
    }

    // Check gross position value vs buying power
    const grossPos = summary.data?.grossPositionValue;
    if (netLiq && grossPos && grossPos > netLiq * 0.9) {
      result.push({
        severity: "warning",
        message: `High exposure: gross position ${((grossPos / netLiq) * 100).toFixed(0)}% of net liq`,
      });
    }

    return result;
  }, [positions.data, summary.data, session.data]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Risk Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        alerts.some((a) => a.severity === "danger") && "border-red-500/40",
        alerts.some((a) => a.severity === "warning") &&
          !alerts.some((a) => a.severity === "danger") &&
          "border-yellow-500/40"
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Risk Alerts
        </CardTitle>
        {alerts.length > 0 ? (
          <AlertTriangle
            className={cn(
              "h-4 w-4",
              alerts.some((a) => a.severity === "danger")
                ? "text-red-400"
                : "text-yellow-400"
            )}
          />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        )}
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <p className="text-sm text-emerald-400">All clear</p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((alert, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-2 text-xs",
                  alert.severity === "danger"
                    ? "text-red-400"
                    : "text-yellow-400"
                )}
              >
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>{alert.message}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
