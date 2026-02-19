"use client";

import { useExecutions } from "@/lib/hooks/use-executions";
import { ExecutionsTable } from "@/components/account/executions-table";

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ExecutionStats() {
  const { data } = useExecutions();
  const executions = data?.executions ?? [];

  if (executions.length === 0) return null;

  const totalPnL = executions.reduce((sum, e) => sum + (e.realizedPnL || 0), 0);
  const totalCommissions = executions.reduce((sum, e) => sum + (e.commission || 0), 0);
  const totalShares = executions.reduce((sum, e) => sum + e.shares, 0);
  const symbols = new Set(executions.map((e) => e.symbol)).size;

  const pnlColor = totalPnL > 0 ? "text-emerald-400" : totalPnL < 0 ? "text-red-400" : "text-foreground";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-xs text-muted-foreground">Realized P&L</p>
        <p className={`text-lg font-semibold tabular-nums ${pnlColor}`}>${fmt(totalPnL)}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-xs text-muted-foreground">Commissions</p>
        <p className="text-lg font-semibold tabular-nums">${fmt(totalCommissions)}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-xs text-muted-foreground">Fills</p>
        <p className="text-lg font-semibold tabular-nums">{executions.length}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-xs text-muted-foreground">Shares / Symbols</p>
        <p className="text-lg font-semibold tabular-nums">{totalShares.toLocaleString()} / {symbols}</p>
      </div>
    </div>
  );
}

export default function ExecutionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Executions</h1>
        <p className="text-sm text-muted-foreground">
          Trade execution history with real-time updates
        </p>
      </div>

      <ExecutionStats />

      <ExecutionsTable />
    </div>
  );
}
