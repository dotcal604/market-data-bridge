"use client";

import { Suspense, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, GitCompare } from "lucide-react";
import { useEvalHistory } from "@/lib/hooks/use-evals";
import { EvalTable } from "@/components/eval-table/eval-table";
import { EvalFilters } from "@/components/eval-table/eval-filters";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EvalTriggerForm } from "@/components/eval-form/eval-trigger-form";
import type { EvalResponse, Evaluation } from "@/lib/api/types";
import type { EvalFilterState } from "@/lib/stores/eval-filters";

export default function EvalsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <EvalsContent />
    </Suspense>
  );
}

function EvalsContent() {
  const router = useRouter();
  const { data, isLoading } = useEvalHistory(100);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<EvalFilterState>({
    symbol: "",
    dateFrom: null,
    dateTo: null,
    scoreMin: 0,
    scoreMax: 100,
    shouldTrade: null,
  });

  const handleEvalSuccess = (result: EvalResponse) => {
    setDialogOpen(false);
    router.push(`/evals/${result.id}`);
  };

  const handleCompare = () => {
    if (selectedIds.length >= 2) {
      router.push(`/evals/compare?ids=${selectedIds.join(",")}`);
    }
  };

  // Apply filters client-side
  const filteredEvaluations = useMemo(() => {
    if (!data?.evaluations) return [];

    return data.evaluations.filter((evaluation: Evaluation) => {
      // Symbol filter
      if (filters.symbol && !evaluation.symbol.toUpperCase().includes(filters.symbol.toUpperCase())) {
        return false;
      }

      // Date range filter
      if (filters.dateFrom) {
        const evalDate = new Date(evaluation.timestamp).toISOString().split("T")[0];
        if (evalDate < filters.dateFrom) return false;
      }
      if (filters.dateTo) {
        const evalDate = new Date(evaluation.timestamp).toISOString().split("T")[0];
        if (evalDate > filters.dateTo) return false;
      }

      // Score range filter
      if (
        evaluation.ensemble_trade_score < filters.scoreMin ||
        evaluation.ensemble_trade_score > filters.scoreMax
      ) {
        return false;
      }

      // Should trade filter
      if (filters.shouldTrade !== null) {
        const shouldTrade = evaluation.ensemble_should_trade === 1;
        if (shouldTrade !== filters.shouldTrade) return false;
      }

      return true;
    });
  }, [data?.evaluations, filters]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Evaluations</h1>
          <p className="text-sm text-muted-foreground">
            Full history of trade evaluations
          </p>
        </div>
        <div className="flex items-center gap-2">
          {compareMode ? (
            <>
              <Button variant="outline" onClick={() => {
                setCompareMode(false);
                setSelectedIds([]);
              }}>
                Cancel
              </Button>
              <Button
                onClick={handleCompare}
                disabled={selectedIds.length < 2}
              >
                Compare Selected ({selectedIds.length})
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setCompareMode(true)}>
                <GitCompare className="mr-2 h-4 w-4" />
                Compare
              </Button>
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    New Evaluation
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <EvalTriggerForm onSuccess={handleEvalSuccess} />
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      <EvalFilters onFilterChange={setFilters} />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : data ? (
        <EvalTable
          evaluations={filteredEvaluations}
          selectionMode={compareMode}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Failed to load evaluations</p>
      )}
    </div>
  );
}
