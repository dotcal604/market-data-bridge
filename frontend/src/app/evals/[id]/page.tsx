"use client";

import { use } from "react";
import { useEvalDetail } from "@/lib/hooks/use-evals";
import { ModelComparison } from "@/components/eval-detail/model-comparison";
import { EnsembleSummary } from "@/components/eval-detail/ensemble-summary";
import { GuardrailBadges } from "@/components/eval-detail/guardrail-badges";
import { FeatureTable } from "@/components/eval-detail/feature-table";
import { FeatureRadarChart } from "@/components/eval-detail/feature-radar-chart";
import { OutcomeForm } from "@/components/eval-detail/outcome-form";
import { DirectionBadge } from "@/components/shared/direction-badge";
import { ScoreBadge } from "@/components/shared/score-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimestamp, formatPrice, formatMs } from "@/lib/utils/formatters";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function EvalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, error, refetch } = useEvalDetail(id);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <p className="text-sm text-muted-foreground">
          {error ? `Error: ${error.message}` : "Evaluation not found"}
        </p>
        <Link href="/evals" className="text-sm text-primary hover:underline">
          Back to evaluations
        </Link>
      </div>
    );
  }

  const { evaluation: ev, modelOutputs, outcome } = data;
  const features = JSON.parse(ev.features_json);
  const guardrailFlags: string[] = JSON.parse(ev.guardrail_flags_json);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/evals" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-bold">{ev.symbol}</h1>
          <DirectionBadge direction={ev.direction} />
          <ScoreBadge score={ev.ensemble_trade_score} />
        </div>
        <div className="ml-auto text-right text-xs text-muted-foreground">
          <p>{formatTimestamp(ev.timestamp)}</p>
          <p className="font-mono">{formatPrice(ev.last_price)} &middot; {formatMs(ev.total_latency_ms)}</p>
        </div>
      </div>

      {/* Ensemble summary */}
      <EnsembleSummary evaluation={ev} />

      {/* Guardrails */}
      <GuardrailBadges
        allowed={!!ev.guardrail_allowed}
        prefilterPassed={!!ev.prefilter_passed}
        flags={guardrailFlags}
      />

      {/* 3-model comparison */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Model Comparison</h2>
        <ModelComparison modelOutputs={modelOutputs} />
      </div>

      {/* Features */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Features</h2>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <FeatureRadarChart features={features} />
          <FeatureTable features={features} />
        </div>
      </div>

      {/* Outcome */}
      <OutcomeForm
        evaluationId={ev.id}
        entryPrice={ev.entry_price}
        stopPrice={ev.stop_price}
        existingOutcome={outcome}
        onSuccess={() => refetch()}
      />
    </div>
  );
}
