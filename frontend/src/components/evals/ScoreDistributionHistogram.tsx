"use client";

import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { useEvalOutcomes, useMultipleEvals } from "@/lib/hooks/use-evals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EvalOutcome } from "@/lib/api/types";

type OutcomeFilter = "all" | "correct" | "incorrect";

interface HistogramBucket {
  bucket: string;
  claude: number;
  gpt: number;
  gemini: number;
}

const BUCKETS = Array.from({ length: 10 }, (_, index) => ({
  min: index * 10,
  max: index * 10 + 10,
  label: `${index * 10}-${index * 10 + 10}`,
}));

const MODEL_COLORS = {
  claude: "#8b5cf6",  // purple
  gpt: "#10b981",     // emerald/green
  gemini: "#f59e0b",  // amber/yellow
} as const;

function classifyOutcome(outcome: EvalOutcome): boolean | null {
  if (outcome.outcome === "correct") return true;
  if (outcome.outcome === "incorrect") return false;
  if (typeof outcome.r_multiple === "number") return outcome.r_multiple > 0;
  return null;
}

function getBucketIndex(score: number): number {
  if (score <= 0) return 0;
  if (score >= 100) return 9;
  return Math.floor(score / 10);
}

export function ScoreDistributionHistogram() {
  const [filter, setFilter] = useState<OutcomeFilter>("all");
  const outcomesQuery = useEvalOutcomes(1000);

  const filteredOutcomeIds = useMemo(() => {
    const outcomes = outcomesQuery.data?.outcomes ?? [];

    return outcomes
      .filter((outcome) => {
        if (filter === "all") return true;

        const classified = classifyOutcome(outcome);
        if (classified === null) return false;

        return filter === "correct" ? classified : !classified;
      })
      .map((outcome) => outcome.evaluation_id);
  }, [filter, outcomesQuery.data?.outcomes]);

  const detailsQuery = useMultipleEvals(filteredOutcomeIds);

  const chartData = useMemo(() => {
    const data: HistogramBucket[] = BUCKETS.map((bucket) => ({
      bucket: bucket.label,
      claude: 0,
      gpt: 0,
      gemini: 0,
    }));

    const details = detailsQuery.data ?? [];

    for (const detail of details) {
      for (const output of detail.modelOutputs) {
        if (output.trade_score == null) continue;
        const bucketIndex = getBucketIndex(output.trade_score);

        if (output.model_id.includes("claude")) {
          data[bucketIndex].claude += 1;
        } else if (output.model_id.includes("gpt")) {
          data[bucketIndex].gpt += 1;
        } else if (output.model_id.includes("gemini")) {
          data[bucketIndex].gemini += 1;
        }
      }
    }

    return data;
  }, [detailsQuery.data]);

  const totalBars = chartData.reduce((acc, bucket) => acc + bucket.claude + bucket.gpt + bucket.gemini, 0);
  const isLoading = outcomesQuery.isLoading || detailsQuery.isLoading;
  const hasError = outcomesQuery.isError || detailsQuery.isError;

  return (
    <Card className="bg-card">
      <CardHeader className="space-y-4">
        <div>
          <CardTitle className="text-lg font-semibold">Model Score Distribution</CardTitle>
          <p className="text-sm text-muted-foreground">
            Histogram of model scores across 10-point buckets
          </p>
        </div>

        <Tabs value={filter} onValueChange={(value) => setFilter(value as OutcomeFilter)}>
          <TabsList>
            <TabsTrigger value="all">All evals</TabsTrigger>
            <TabsTrigger value="correct">Correct only</TabsTrigger>
            <TabsTrigger value="incorrect">Incorrect only</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading score distribution…</p>
        ) : hasError ? (
          <p className="text-sm text-red-400">Failed to load score distribution.</p>
        ) : totalBars === 0 ? (
          <p className="text-sm text-muted-foreground">No outcome data available for this filter.</p>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="bucket"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                label={{ value: "Score Range", position: "insideBottom", offset: -6 }}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                label={{ value: "Count", angle: -90, position: "insideLeft" }}
              />
              <Tooltip
                cursor={{ fill: "transparent" }}
                contentStyle={{
                  background: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.5rem",
                }}
              />
              <Legend />
              <Bar dataKey="claude" name="Claude" fill={MODEL_COLORS.claude} fillOpacity={0.5} radius={[4, 4, 0, 0]} />
              <Bar dataKey="gpt" name="GPT" fill={MODEL_COLORS.gpt} fillOpacity={0.5} radius={[4, 4, 0, 0]} />
              <Bar dataKey="gemini" name="Gemini" fill={MODEL_COLORS.gemini} fillOpacity={0.5} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
