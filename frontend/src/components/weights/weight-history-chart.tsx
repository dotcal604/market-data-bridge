"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWeightHistory } from "@/lib/hooks/use-evals";
import { modelColor } from "@/lib/utils/colors";

interface WeightHistoryChartProps {
  days?: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    payload: {
      date: string;
      source?: string;
      sample_size?: number;
    };
  }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0].payload;

  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      <p className="mb-1 text-xs font-mono text-muted-foreground">{data.date}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <p className="text-sm text-foreground">
            <span className="font-medium">{entry.name}:</span>{" "}
            <span className="font-mono">{(entry.value * 100).toFixed(1)}%</span>
          </p>
        </div>
      ))}
      {data.source && (
        <p className="mt-1 text-xs text-muted-foreground">
          Source: {data.source}
        </p>
      )}
      {data.sample_size != null && (
        <p className="text-xs text-muted-foreground">
          Sample: {data.sample_size} evals
        </p>
      )}
    </div>
  );
}

export function WeightHistoryChart({ days = 90 }: WeightHistoryChartProps) {
  const { data, isLoading } = useWeightHistory(days);

  if (isLoading) {
    return <Skeleton className="h-96 rounded-lg" />;
  }

  if (!data?.history || data.history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Weight History</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No weight changes recorded
          </p>
        </CardContent>
      </Card>
    );
  }

  // Transform data for Recharts (reverse to show oldest to newest)
  const chartData = data.history
    .slice()
    .reverse()
    .map((item) => ({
      date: new Date(item.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      claude: item.weights.claude,
      "gpt-4o": item.weights.gpt4o,
      gemini: item.weights.gemini,
      source: item.weights.source ?? item.reason,
      sample_size: item.sample_size,
    }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          Weight History (Last {days} days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-muted"
              opacity={0.3}
            />
            <XAxis
              dataKey="date"
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[0, 1]}
              tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{
                paddingTop: "20px",
              }}
              iconType="line"
              formatter={(value) => (
                <span className="text-sm text-foreground">{value}</span>
              )}
            />
            <Line
              type="monotone"
              dataKey="claude"
              name="claude-sonnet"
              stroke={modelColor("claude-sonnet")}
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="gpt-4o"
              name="gpt-4o"
              stroke={modelColor("gpt-4o")}
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="gemini"
              name="gemini-flash"
              stroke={modelColor("gemini-flash")}
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
