"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession, useRiskConfig } from "@/lib/hooks/use-session";
import { Shield, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

interface RiskCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export function RiskChecker() {
  const { data: session, isLoading: sessionLoading } = useSession();
  const { data: riskConfig, isLoading: configLoading } = useRiskConfig();

  if (sessionLoading || configLoading) {
    return <Skeleton className="h-96 rounded-lg" />;
  }

  if (!session || !riskConfig) {
    return null;
  }

  const checks: RiskCheck[] = [];

  // Session lock check
  if (session.locked) {
    checks.push({
      name: "Session Lock",
      status: "fail",
      message: `Session is locked: ${session.lockReason || "manual override"}`,
    });
  } else {
    checks.push({
      name: "Session Lock",
      status: "pass",
      message: "Session is unlocked and ready for trading",
    });
  }

  // Daily loss limit check
  const maxDailyLoss = session.limits.maxDailyLoss;
  const currentLoss = Math.abs(session.realizedPnl);
  const lossPercentage = maxDailyLoss > 0 ? (currentLoss / maxDailyLoss) * 100 : 0;
  
  if (session.realizedPnl <= -maxDailyLoss) {
    checks.push({
      name: "Daily Loss Limit",
      status: "fail",
      message: `Daily loss limit reached: $${currentLoss.toFixed(2)} / $${maxDailyLoss.toFixed(0)}`,
    });
  } else if (lossPercentage > 75) {
    checks.push({
      name: "Daily Loss Limit",
      status: "warn",
      message: `${lossPercentage.toFixed(0)}% of daily loss limit used`,
    });
  } else {
    checks.push({
      name: "Daily Loss Limit",
      status: "pass",
      message: `$${currentLoss.toFixed(2)} / $${maxDailyLoss.toFixed(0)} (${lossPercentage.toFixed(0)}%)`,
    });
  }

  // Daily trade count check
  const tradePercentage = session.limits.maxDailyTrades > 0
    ? (session.tradeCount / session.limits.maxDailyTrades) * 100
    : 0;

  if (session.tradeCount >= session.limits.maxDailyTrades) {
    checks.push({
      name: "Daily Trade Limit",
      status: "fail",
      message: `Daily trade limit reached: ${session.tradeCount} / ${session.limits.maxDailyTrades}`,
    });
  } else if (tradePercentage > 75) {
    checks.push({
      name: "Daily Trade Limit",
      status: "warn",
      message: `${tradePercentage.toFixed(0)}% of daily trades used`,
    });
  } else {
    checks.push({
      name: "Daily Trade Limit",
      status: "pass",
      message: `${session.tradeCount} / ${session.limits.maxDailyTrades} trades`,
    });
  }

  // Cooldown check
  if (session.consecutiveLosses >= session.limits.consecutiveLossLimit && session.lastLossTime > 0) {
    const cooldownMs = session.limits.cooldownMinutes * 60_000;
    const elapsed = Date.now() - session.lastLossTime;
    if (elapsed < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - elapsed) / 60_000);
      checks.push({
        name: "Cooldown Period",
        status: "fail",
        message: `In cooldown: ${remaining} minutes remaining`,
      });
    } else {
      checks.push({
        name: "Cooldown Period",
        status: "pass",
        message: "Cooldown period expired, ready to trade",
      });
    }
  } else if (session.consecutiveLosses > 0) {
    checks.push({
      name: "Consecutive Losses",
      status: "warn",
      message: `${session.consecutiveLosses} consecutive losses (limit: ${session.limits.consecutiveLossLimit})`,
    });
  } else {
    checks.push({
      name: "Consecutive Losses",
      status: "pass",
      message: "No consecutive losses",
    });
  }

  // Trading hours check (simplified - assumes regular session)
  const now = new Date();
  const etHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(now)
  );
  const etMinute = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      minute: "numeric",
    }).format(now)
  );

  const marketOpen = session.limits.marketOpenHour * 60 + session.limits.marketOpenMinute;
  const marketClose = session.limits.marketCloseHour * 60 + session.limits.marketCloseMinute;
  const currentTime = etHour * 60 + etMinute;
  const minutesToClose = marketClose - currentTime;

  if (currentTime < marketOpen || currentTime >= marketClose) {
    checks.push({
      name: "Trading Hours",
      status: "fail",
      message: "Outside regular trading hours",
    });
  } else if (minutesToClose <= session.limits.lateDayLockoutMinutes) {
    checks.push({
      name: "Trading Hours",
      status: "fail",
      message: `Late-day lockout: ${minutesToClose} min before close`,
    });
  } else {
    checks.push({
      name: "Trading Hours",
      status: "pass",
      message: `Market open, ${minutesToClose} min until lockout`,
    });
  }

  const passCount = checks.filter((c) => c.status === "pass").length;
  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-lg">Risk Gate Checks</CardTitle>
        <Shield className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="flex gap-2">
          <Badge variant="default" className="bg-emerald-600">
            {passCount} Pass
          </Badge>
          {warnCount > 0 && (
            <Badge variant="secondary" className="bg-yellow-600/30 text-yellow-400">
              {warnCount} Warn
            </Badge>
          )}
          {failCount > 0 && (
            <Badge variant="destructive">
              {failCount} Fail
            </Badge>
          )}
        </div>

        {/* Individual checks */}
        <div className="space-y-2">
          {checks.map((check, idx) => {
            const Icon =
              check.status === "pass"
                ? CheckCircle2
                : check.status === "warn"
                ? AlertTriangle
                : XCircle;
            const iconColor =
              check.status === "pass"
                ? "text-emerald-400"
                : check.status === "warn"
                ? "text-yellow-400"
                : "text-red-400";

            return (
              <div
                key={idx}
                className="flex items-start gap-3 rounded-md border border-border/50 bg-card p-3"
              >
                <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${iconColor}`} />
                <div className="flex-1 space-y-0.5">
                  <p className="text-sm font-medium">{check.name}</p>
                  <p className="text-xs text-muted-foreground">{check.message}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Risk Config Summary */}
        <div className="border-t border-border pt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Risk Parameters</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="space-y-1">
              <p className="text-muted-foreground">Max Position %</p>
              <p className="font-mono">{riskConfig.effective.max_position_pct}%</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground">Max Daily Loss %</p>
              <p className="font-mono">{riskConfig.effective.max_daily_loss_pct}%</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground">Max Concentration %</p>
              <p className="font-mono">{riskConfig.effective.max_concentration_pct}%</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground">Volatility Scalar</p>
              <p className="font-mono">{riskConfig.effective.volatility_scalar}x</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
