"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession, useLockSession, useUnlockSession, useResetSession } from "@/lib/hooks/use-session";

function formatPnl(pnl: number): string {
  const sign = pnl >= 0 ? "+" : "";
  return `${sign}$${pnl.toFixed(2)}`;
}

function getCooldownRemaining(
  lastLossTime: number,
  cooldownMinutes: number,
  consecutiveLosses: number,
  consecutiveLossLimit: number,
): number | null {
  if (consecutiveLosses < consecutiveLossLimit || lastLossTime === 0) return null;
  const cooldownMs = cooldownMinutes * 60_000;
  const elapsed = Date.now() - lastLossTime;
  const remaining = cooldownMs - elapsed;
  return remaining > 0 ? remaining : null;
}

type SessionStatus = "trading" | "cooldown" | "locked" | "closed";

function getStatus(
  locked: boolean,
  cooldownMs: number | null,
): SessionStatus {
  if (locked) return "locked";
  if (cooldownMs != null) return "cooldown";
  return "trading";
}

const STATUS_CONFIG: Record<SessionStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  trading: { label: "Trading", variant: "default" },
  cooldown: { label: "Cooldown", variant: "secondary" },
  locked: { label: "LOCKED", variant: "destructive" },
  closed: { label: "Closed", variant: "outline" },
};

export function SessionStateCard() {
  const { data: session, isLoading } = useSession();
  const lockMutation = useLockSession();
  const unlockMutation = useUnlockSession();
  const resetMutation = useResetSession();

  const [lockDialogOpen, setLockDialogOpen] = useState(false);
  const [lockReason, setLockReason] = useState("");
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [, setTick] = useState(0);

  // Tick every second for cooldown countdown
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (isLoading || !session) {
    return <Skeleton className="h-64 rounded-lg" />;
  }

  const cooldownMs = getCooldownRemaining(
    session.lastLossTime,
    session.limits.cooldownMinutes,
    session.consecutiveLosses,
    session.limits.consecutiveLossLimit,
  );
  const status = getStatus(session.locked, cooldownMs);
  const statusConfig = STATUS_CONFIG[status];

  const pnlPct = session.limits.maxDailyLoss > 0
    ? Math.min(Math.abs(session.realizedPnl) / session.limits.maxDailyLoss, 1) * 100
    : 0;
  const tradePct = session.limits.maxDailyTrades > 0
    ? Math.min(session.tradeCount / session.limits.maxDailyTrades, 1) * 100
    : 0;

  const handleLock = () => {
    lockMutation.mutate(lockReason || undefined);
    setLockDialogOpen(false);
    setLockReason("");
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg">Session State</CardTitle>
          <Badge variant={statusConfig.variant}>
            {statusConfig.label}
            {status === "cooldown" && cooldownMs != null && (
              <span className="ml-1">{Math.ceil(cooldownMs / 60_000)}m</span>
            )}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Hero metrics */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Daily P&L</p>
              <p className={`font-mono text-2xl font-bold ${session.realizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {formatPnl(session.realizedPnl)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Trades Today</p>
              <p className="font-mono text-2xl font-bold">
                {session.tradeCount}
                <span className="text-sm text-muted-foreground">/{session.limits.maxDailyTrades}</span>
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Consec. Losses</p>
              <p className={`font-mono text-2xl font-bold ${session.consecutiveLosses >= session.limits.consecutiveLossLimit ? "text-red-400" : ""}`}>
                {session.consecutiveLosses}
                <span className="text-sm text-muted-foreground">/{session.limits.consecutiveLossLimit}</span>
              </p>
            </div>
          </div>

          {/* Progress bars */}
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Daily Loss</span>
                <span>${Math.abs(session.realizedPnl).toFixed(0)} / ${session.limits.maxDailyLoss.toFixed(0)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${session.realizedPnl < 0 ? "bg-red-400" : "bg-emerald-400"}`}
                  style={{ width: `${pnlPct}%` }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Trade Count</span>
                <span>{session.tradeCount} / {session.limits.maxDailyTrades}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-blue-400 transition-all"
                  style={{ width: `${tradePct}%` }}
                />
              </div>
            </div>
          </div>

          {/* Lock reason */}
          {session.locked && session.lockReason && (
            <p className="text-sm text-red-400">
              Reason: {session.lockReason}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            {session.locked ? (
              <Button
                size="sm"
                variant="outline"
                className="border-emerald-600 text-emerald-400 hover:bg-emerald-600/10"
                onClick={() => unlockMutation.mutate()}
                disabled={unlockMutation.isPending}
              >
                Unlock
              </Button>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setLockDialogOpen(true)}
                disabled={lockMutation.isPending}
              >
                Lock Session
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="border-amber-600 text-amber-400 hover:bg-amber-600/10"
              onClick={() => setResetDialogOpen(true)}
              disabled={resetMutation.isPending}
            >
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lock dialog */}
      <Dialog open={lockDialogOpen} onOpenChange={setLockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lock Trading Session</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will block all new orders until you unlock. Are you tilting?
          </p>
          <Input
            placeholder="Reason (optional)"
            value={lockReason}
            onChange={(e) => setLockReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleLock}>Lock Now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Session</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will zero out all session counters (P&L, trades, consecutive losses).
            Only do this at the start of a new trading day or if the data is incorrect.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => { resetMutation.mutate(); setResetDialogOpen(false); }}
            >
              Reset Session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
