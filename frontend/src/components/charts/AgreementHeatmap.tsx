"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface AgreementHeatmapProps {
  data: Array<{
    evaluation_id: string;
    model_id: string;
    trade_score: number;
    r_multiple: number | null;
  }>;
}

interface AgreementStats {
  matrix: Array<{
    model1: string;
    model2: string;
    agreementRate: number;
    totalComparisons: number;
  }>;
  overallAgreement: number;
  winRateWhenAgree: number | null;
  winRateWhenDisagree: number | null;
}

/**
 * Agreement = both above 60 or both below 40 (same directional call)
 */
function calculateAgreement(score1: number, score2: number): boolean {
  const bullish1 = score1 >= 60;
  const bearish1 = score1 <= 40;
  const bullish2 = score2 >= 60;
  const bearish2 = score2 <= 40;

  // Both bullish or both bearish = agreement
  return (bullish1 && bullish2) || (bearish1 && bearish2);
}

/**
 * Map model_id to display name
 */
function modelDisplayName(modelId: string): string {
  if (modelId.includes("gpt")) return "GPT-4o";
  if (modelId.includes("claude")) return "Claude";
  if (modelId.includes("gemini")) return "Gemini";
  return modelId;
}

/**
 * Get color based on agreement percentage
 */
function getAgreementColor(percentage: number): string {
  if (percentage >= 80) return "bg-emerald-500";
  if (percentage >= 70) return "bg-green-500";
  if (percentage >= 60) return "bg-yellow-500";
  if (percentage >= 50) return "bg-orange-500";
  return "bg-red-500";
}

export function AgreementHeatmap({ data }: AgreementHeatmapProps) {
  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;

    // Group by evaluation_id
    const evalScores = new Map<string, Map<string, { score: number; r_multiple: number | null }>>();
    
    for (const row of data) {
      if (!evalScores.has(row.evaluation_id)) {
        evalScores.set(row.evaluation_id, new Map());
      }
      evalScores.get(row.evaluation_id)!.set(row.model_id, {
        score: row.trade_score,
        r_multiple: row.r_multiple,
      });
    }

    // Get unique model IDs
    const modelIds = Array.from(new Set(data.map(d => d.model_id))).sort();
    
    // Calculate pairwise agreement
    const matrix: AgreementStats["matrix"] = [];
    let totalAgreements = 0;
    let totalComparisons = 0;

    for (let i = 0; i < modelIds.length; i++) {
      for (let j = i + 1; j < modelIds.length; j++) {
        const model1 = modelIds[i];
        const model2 = modelIds[j];
        
        let agreements = 0;
        let comparisons = 0;

        for (const [evalId, scores] of evalScores.entries()) {
          const score1 = scores.get(model1);
          const score2 = scores.get(model2);

          if (score1 && score2) {
            comparisons++;
            if (calculateAgreement(score1.score, score2.score)) {
              agreements++;
            }
          }
        }

        const agreementRate = comparisons > 0 ? (agreements / comparisons) * 100 : 0;
        
        matrix.push({
          model1,
          model2,
          agreementRate,
          totalComparisons: comparisons,
        });

        totalAgreements += agreements;
        totalComparisons += comparisons;
      }
    }

    // Calculate overall agreement rate
    const overallAgreement = totalComparisons > 0 ? (totalAgreements / totalComparisons) * 100 : 0;

    // Calculate win rates when agree vs disagree
    let winsWhenAgree = 0;
    let totalWhenAgree = 0;
    let winsWhenDisagree = 0;
    let totalWhenDisagree = 0;

    for (const [evalId, scores] of evalScores.entries()) {
      const scoresArray = Array.from(scores.values());
      if (scoresArray.length < 2) continue;

      // Check if any pair agrees
      let hasAgreement = false;
      for (let i = 0; i < scoresArray.length; i++) {
        for (let j = i + 1; j < scoresArray.length; j++) {
          if (calculateAgreement(scoresArray[i].score, scoresArray[j].score)) {
            hasAgreement = true;
            break;
          }
        }
        if (hasAgreement) break;
      }

      // Get outcome
      const rMultiple = scoresArray[0].r_multiple;
      if (rMultiple !== null) {
        if (hasAgreement) {
          totalWhenAgree++;
          if (rMultiple > 0) winsWhenAgree++;
        } else {
          totalWhenDisagree++;
          if (rMultiple > 0) winsWhenDisagree++;
        }
      }
    }

    const winRateWhenAgree = totalWhenAgree > 0 ? (winsWhenAgree / totalWhenAgree) * 100 : null;
    const winRateWhenDisagree = totalWhenDisagree > 0 ? (winsWhenDisagree / totalWhenDisagree) * 100 : null;

    return {
      matrix,
      overallAgreement,
      winRateWhenAgree,
      winRateWhenDisagree,
    };
  }, [data]);

  if (!stats || stats.matrix.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Model Agreement Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-12 text-center">
            <p className="text-lg font-medium text-muted-foreground">No data available</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Model agreement analysis requires completed evaluations with outcomes
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Agreement Heatmap</CardTitle>
        <p className="text-sm text-muted-foreground">
          Agreement = both models make same directional call (both above 60 or both below 40)
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg bg-card p-4 border">
            <p className="text-sm text-muted-foreground">Overall Agreement</p>
            <p className="text-2xl font-bold font-mono">
              {stats.overallAgreement.toFixed(1)}%
            </p>
          </div>
          <div className="rounded-lg bg-card p-4 border">
            <p className="text-sm text-muted-foreground">Win Rate (Agree)</p>
            <p className="text-2xl font-bold font-mono">
              {stats.winRateWhenAgree !== null ? `${stats.winRateWhenAgree.toFixed(1)}%` : "N/A"}
            </p>
          </div>
          <div className="rounded-lg bg-card p-4 border">
            <p className="text-sm text-muted-foreground">Win Rate (Disagree)</p>
            <p className="text-2xl font-bold font-mono">
              {stats.winRateWhenDisagree !== null ? `${stats.winRateWhenDisagree.toFixed(1)}%` : "N/A"}
            </p>
          </div>
        </div>

        {/* 3x3 Heatmap Matrix */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Pairwise Agreement Rates</h3>
          <div className="grid gap-4">
            {stats.matrix.map((cell) => (
              <div
                key={`${cell.model1}-${cell.model2}`}
                className="flex items-center gap-4"
              >
                <div className="flex-1 flex items-center justify-between rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {modelDisplayName(cell.model1)}
                    </span>
                    <span className="text-muted-foreground">×</span>
                    <span className="font-medium">
                      {modelDisplayName(cell.model2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xl font-bold font-mono">
                        {cell.agreementRate.toFixed(1)}%
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {cell.totalComparisons} evaluations
                      </p>
                    </div>
                    <div
                      className={`h-12 w-12 rounded flex items-center justify-center ${getAgreementColor(cell.agreementRate)}`}
                    >
                      <span className="text-sm font-bold text-white">
                        {Math.round(cell.agreementRate)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Color Legend */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Color scale:</span>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-red-500" />
            <span>&lt;50%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-orange-500" />
            <span>50-60%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-yellow-500" />
            <span>60-70%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-green-500" />
            <span>70-80%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-emerald-500" />
            <span>≥80%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AgreementHeatmapSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Agreement Heatmap</CardTitle>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-64 w-full" />
      </CardContent>
    </Card>
  );
}
