"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useEvalHistory } from "@/lib/hooks/use-evals";
import { EvalTable } from "@/components/eval-table/eval-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EvalTriggerForm } from "@/components/eval-form/eval-trigger-form";
import type { EvalResponse } from "@/lib/api/types";

export default function EvalsPage() {
  const router = useRouter();
  const { data, isLoading } = useEvalHistory(100);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleEvalSuccess = (result: EvalResponse) => {
    setDialogOpen(false);
    router.push(`/evals/${result.id}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Evaluations</h1>
          <p className="text-sm text-muted-foreground">
            Full history of trade evaluations
          </p>
        </div>
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
