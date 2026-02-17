"use client";

import { useSignals, useSignalStats, useAutoEvalStatus, useToggleAutoEval } from "@/lib/hooks/use-signals";
import { SignalTable } from "@/components/signals/signal-table";
import { SignalStatsCard } from "@/components/signals/signal-stats-card";

export default function SignalsPage() {
  const { data: feed, isLoading } = useSignals();
  const { data: stats } = useSignalStats();
  const { data: autoEval } = useAutoEvalStatus();
  const toggleMutation = useToggleAutoEval();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Signal Feed</h1>
        <p className="text-sm text-muted-foreground">
          Auto-evaluated Holly alerts through the 3-model ensemble pipeline
        </p>
      </div>

      <SignalStatsCard
        stats={stats}
        autoEval={autoEval}
        onToggle={(enabled) => toggleMutation.mutate(enabled)}
        isToggling={toggleMutation.isPending}
      />

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          Loading signals...
        </div>
      ) : (
        <SignalTable signals={feed?.signals ?? []} />
      )}
    </div>
  );
}
