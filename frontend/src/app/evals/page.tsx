"use client";

import { useEvalHistory } from "@/lib/hooks/use-evals";
import { EvalTable } from "@/components/eval-table/eval-table";
import { Skeleton } from "@/components/ui/skeleton";

export default function EvalsPage() {
  const { data, isLoading } = useEvalHistory(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Evaluations</h1>
        <p className="text-sm text-muted-foreground">
          Full history of trade evaluations
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : data ? (
        <EvalTable evaluations={data.evaluations} />
      ) : (
        <p className="text-sm text-muted-foreground">Failed to load evaluations</p>
      )}
    </div>
  );
}
