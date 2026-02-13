"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TimeOfDayChartProps {
  data: Array<{
    time_of_day: string;
    avg_score: number;
    count: number;
  }>;
}

// Map full time_of_day values to short labels
const TIME_LABELS: Record<string, string> = {
  pre_market: "Pre",
  market_open: "Open",
  morning: "AM",
  midday: "Mid",
  afternoon: "PM",
  market_close: "Close",
  after_hours: "AH",
};

// Map short labels back to full names for tooltip
const TIME_FULL_NAMES: Record<string, string> = {
  Pre: "Pre-Market",
  Open: "Market Open",
  AM: "Morning",
  Mid: "Midday",
  PM: "Afternoon",
  Close: "Market Close",
  AH: "After Hours",
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: {
      time_of_day: string;
      avg_score: number;
      count: number;
      shortLabel: string;
    };
  }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0].payload;
  const fullName = TIME_FULL_NAMES[data.shortLabel] || data.shortLabel;

  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      <p className="font-semibold text-foreground">{fullName}</p>
      <p className="text-sm text-muted-foreground">
        Avg Score: {data.avg_score.toFixed(1)}
      </p>
      <p className="text-sm text-muted-foreground">
        Count: {data.count}
      </p>
    </div>
  );
}

export function TimeOfDayChart({ data }: TimeOfDayChartProps) {
  // Transform data to include short labels for display
  const chartData = data.map((item) => ({
    ...item,
    shortLabel: TIME_LABELS[item.time_of_day] || item.time_of_day,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance by Time of Day</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <XAxis
              dataKey="shortLabel"
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "transparent" }} />
            <Bar
              dataKey="avg_score"
              fill="rgb(52 211 153)"
              radius={[8, 8, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
