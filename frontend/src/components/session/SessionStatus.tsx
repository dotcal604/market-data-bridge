"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSessionState, useLockSession, useUnlockSession, useResetSession } from "@/lib/hooks/useSession";
import { formatCurrency } from "@/lib/utils/formatters";
import { pnlColor } from "@/lib/utils/colors";
import { Shield, Lock, Unlock, RotateCcw, AlertCircle, CheckCircle2, TrendingDown, Hash, Timer } from "lucide-react";
import { useState } from "react";

export function SessionStatus() {
  const { data: session, isLoading, error } = useSessionState();
  const lockMutation = useLockSession();
  const unlockMutation = useUnlockSession();
  const resetMutation = useResetSession();
  const [lockReason, setLockReason] = useState("");

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
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
            <p className="text-sm font-medium text-red-400">Failed to load session state</p>
            <p className="text-xs text-red-400/80">{String(error)}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!session) {
    return null;
  }

  const isLocked = session.locked;
  const inCooldown = session.consecutiveLosses >= session.limits.consecutiveLossLimit && session.lastLossTime > 0;
  const cooldownRemaining = inCooldown
    ? Math.max(0, Math.ceil((session.limits.cooldownMinutes * 60_000 - (Date.now() - session.lastLossTime)) / 60_000))
    : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className={`h-5 w-5 ${isLocked ? "text-red-400" : "text-emerald-400"}`} />
            <CardTitle>Session Status</CardTitle>
          </div>
          <Badge variant={isLocked ? "destructive" : "default"} className="font-mono">
            {isLocked ? "LOCKED" : "ACTIVE"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Lock status banner */}
        {isLocked && (
          <div className="flex items-start gap-3 rounded-lg border border-red-500/50 bg-red-500/10 p-4">
            <Lock className="h-5 w-5 text-red-400 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-400">Session Locked</p>
              <p className="text-xs text-red-400/80 mt-1">
                {session.lockReason || "Manual lock active"}
              </p>
            </div>
          </div>
        )}

        {/* Cooldown banner */}
        {inCooldown && cooldownRemaining > 0 && !isLocked && (
          <div className="flex items-start gap-3 rounded-lg border border-orange-500/50 bg-orange-500/10 p-4">
            <Timer className="h-5 w-5 text-orange-400 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-orange-400">Cooldown Active</p>
              <p className="text-xs text-orange-400/80 mt-1">
                {session.consecutiveLosses} consecutive losses — {cooldownRemaining} min remaining
              </p>
            </div>
          </div>
        )}

        {/* Success state */}
        {!isLocked && !inCooldown && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-emerald-400">Trading Enabled</p>
              <p className="text-xs text-emerald-400/80 mt-1">
                Session active for {session.date}
              </p>
            </div>
          </div>
        )}

        {/* Session metrics */}
        <div className="grid grid-cols-3 gap-4">
          {/* Daily P&L */}
          <Card className="bg-card/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Daily P&L
              </CardTitle>
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-xl font-bold font-mono ${pnlColor(session.realizedPnl)}`}>
                {formatCurrency(session.realizedPnl)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Realized
              </p>
            </CardContent>
          </Card>

          {/* Trade Count */}
          <Card className="bg-card/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Trades Today
              </CardTitle>
              <Hash className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold font-mono">
                {session.tradeCount}
                <span className="text-sm text-muted-foreground"> / {session.limits.maxDailyTrades}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Limit: {session.limits.maxDailyTrades}
              </p>
            </CardContent>
          </Card>

          {/* Consecutive Losses */}
          <Card className="bg-card/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Consecutive Losses
              </CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-xl font-bold font-mono ${
                session.consecutiveLosses >= session.limits.consecutiveLossLimit 
                  ? "text-red-400" 
                  : session.consecutiveLosses > 0 
                    ? "text-yellow-400" 
                    : "text-muted-foreground"
              }`}>
                {session.consecutiveLosses}
                <span className="text-sm text-muted-foreground"> / {session.limits.consecutiveLossLimit}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Limit: {session.limits.consecutiveLossLimit}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          {isLocked ? (
            <Button
              onClick={() => unlockMutation.mutate()}
              disabled={unlockMutation.isPending}
              variant="outline"
              className="flex-1"
            >
              <Unlock className="h-4 w-4 mr-2" />
              Unlock Session
            </Button>
          ) : (
            <Button
              onClick={() => {
                const reason = prompt("Enter lock reason (optional):", "Manual override");
                if (reason !== null) {
                  lockMutation.mutate(reason || undefined);
                }
              }}
              disabled={lockMutation.isPending}
              variant="outline"
              className="flex-1"
            >
              <Lock className="h-4 w-4 mr-2" />
              Lock Session
            </Button>
          )}

          <Button
            onClick={() => {
              if (confirm("Reset session state? This will clear P&L, trade count, and consecutive losses.")) {
                resetMutation.mutate();
              }
            }}
            disabled={resetMutation.isPending}
            variant="outline"
            className="flex-1"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset Session
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
