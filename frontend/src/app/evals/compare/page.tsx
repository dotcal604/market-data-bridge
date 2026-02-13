"use client";

import { use, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useMultipleEvals } from "@/lib/hooks/use-evals";
import { CompareView } from "@/components/eval-table/compare-view";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

function CompareContent() {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get("ids");
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : [];

  const { data, isLoading, error } = useMultipleEvals(ids);

  if (ids.length < 2 || ids.length > 5) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <p className="text-sm text-muted-foreground">
          Please select 2-5 evaluations to compare
        </p>
        <Link href="/evals">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Evaluations
          </Button>
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: ids.length }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <p className="text-sm text-red-400">
          {error ? `Error: ${error.message}` : "Failed to load evaluations"}
        </p>
        <Link href="/evals">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Evaluations
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/evals" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Compare Evaluations
          </h1>
          <p className="text-sm text-muted-foreground">
            Comparing {ids.length} evaluation{ids.length > 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Comparison View */}
      <CompareView evaluations={data} />
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-lg" />
            ))}
          </div>
        </div>
      }
    >
      <CompareContent />
    </Suspense>
  );
}
