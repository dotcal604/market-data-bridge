"use client";

import { ExecutionsTable } from "@/components/account/executions-table";

export default function ExecutionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Executions</h1>
        <p className="text-sm text-muted-foreground">
          Trade execution history with real-time updates
        </p>
      </div>

      <ExecutionsTable />
    </div>
  );
}
