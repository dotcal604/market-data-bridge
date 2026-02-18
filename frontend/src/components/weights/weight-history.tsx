"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWeightHistory } from "@/lib/hooks/use-evals";

export function WeightHistory() {
  const { data, isLoading } = useWeightHistory();

  if (isLoading) {
    return <Skeleton className="h-48 rounded-lg" />;
  }

  if (!data?.history?.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Weight History</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No history yet</p>
        </CardContent>
      </Card>
    );
  }

  // Show newest first, limit to 20
  const rows = data.history.slice(0, 20);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Weight History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4">Timestamp</th>
                <th className="pb-2 pr-4 text-right">Claude %</th>
                <th className="pb-2 pr-4 text-right">GPT-4o %</th>
                <th className="pb-2 pr-4 text-right">Gemini %</th>
                <th className="pb-2 text-right">k</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: { created_at: string; weights: { claude: number; gpt4o: number; gemini: number; k: number } }, i: number) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pr-4 font-mono text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono">
                    {(row.weights.claude * 100).toFixed(1)}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono">
                    {(row.weights.gpt4o * 100).toFixed(1)}
                  </td>
                  <td className="py-1.5 pr-4 text-right font-mono">
                    {(row.weights.gemini * 100).toFixed(1)}
                  </td>
                  <td className="py-1.5 text-right font-mono">
                    {row.weights.k.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
