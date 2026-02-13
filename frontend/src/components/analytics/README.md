# TimeOfDayChart Component

A Recharts-based bar chart component for visualizing average trade scores grouped by time of day.

## Location
`frontend/src/components/analytics/time-of-day-chart.tsx`

## Usage

```tsx
import { TimeOfDayChart } from "@/components/analytics/time-of-day-chart";

const data = [
  { time_of_day: "pre_market", avg_score: 45.2, count: 12 },
  { time_of_day: "market_open", avg_score: 62.8, count: 34 },
  { time_of_day: "morning", avg_score: 58.3, count: 45 },
  { time_of_day: "midday", avg_score: 51.7, count: 38 },
  { time_of_day: "afternoon", avg_score: 65.4, count: 42 },
  { time_of_day: "market_close", avg_score: 70.1, count: 29 },
  { time_of_day: "after_hours", avg_score: 48.9, count: 15 },
];

<TimeOfDayChart data={data} />
```

## Props Interface

```typescript
interface TimeOfDayChartProps {
  data: Array<{
    time_of_day: string;      // One of: pre_market, market_open, morning, midday, afternoon, market_close, after_hours
    avg_score: number;        // Average score value for the time period
    count: number;            // Number of evaluations in this time period
  }>;
}
```

## Features

- **Recharts BarChart**: Uses `BarChart`, `Bar`, `XAxis`, `YAxis`, `Tooltip`, and `ResponsiveContainer`
- **Emerald-400 bars**: Filled with `rgb(52 211 153)` (Tailwind emerald-400)
- **Rounded top corners**: Bar radius `[8, 8, 0, 0]`
- **Short X-axis labels**: Pre, Open, AM, Mid, PM, Close, AH
- **Custom tooltip**: Displays full period name (e.g., "Market Open"), average score, and count
- **Dark theme compatible**: Uses CSS variables for colors (`hsl(var(--muted-foreground))`)
- **Card wrapper**: Wrapped in `Card` component with title "Performance by Time of Day"
- **Client component**: Uses `"use client"` directive for Next.js

## Time Period Mapping

| time_of_day value | Short Label | Full Name (Tooltip) |
|-------------------|-------------|---------------------|
| pre_market        | Pre         | Pre-Market          |
| market_open       | Open        | Market Open         |
| morning           | AM          | Morning             |
| midday            | Mid         | Midday              |
| afternoon         | PM          | Afternoon           |
| market_close      | Close       | Market Close        |
| after_hours       | AH          | After Hours         |

## Responsive Design

The chart uses `ResponsiveContainer` with:
- Width: 100% (fills container)
- Height: 300px

## Dependencies

- `recharts`: ^3.7.0 (already installed)
- `@/components/ui/card`: Card components
- Next.js with React 19
