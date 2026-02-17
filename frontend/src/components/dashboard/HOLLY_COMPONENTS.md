# Holly AI Alerts Widget Components

This directory contains React components for displaying Holly AI alert data in the Market Data Bridge dashboard.

## Components

### HollyStats
**Path**: `frontend/src/components/dashboard/holly-stats.tsx`

Displays summary statistics for Holly AI alerts:
- Total alerts count
- Unique symbols tracked
- Number of strategies
- Latest alert timestamp

Auto-refreshes every 30 seconds via React Query.

**Usage**:
```tsx
import { HollyStats } from "@/components/dashboard/holly-stats";

export default function MyPage() {
  return <HollyStats />;
}
```

### HollyAlerts
**Path**: `frontend/src/components/dashboard/holly-alerts.tsx`

Displays a sortable table of recent Holly alerts with:
- Alert timestamp
- Symbol (clickable link to market data page)
- Strategy name (color-coded badges)
- Entry price
- Stop price
- Share quantity
- Last price
- Market segment

Auto-refreshes every 30 seconds via React Query.

**Usage**:
```tsx
import { HollyAlerts } from "@/components/dashboard/holly-alerts";

export default function MyPage() {
  return <HollyAlerts limit={50} />;
}
```

**Props**:
- `limit` (optional): Number of alerts to fetch (default: 50)

## API Integration

The components use the Holly API client (`frontend/src/lib/api/holly-client.ts`) which calls:
- `POST /api/agent` with action `holly_alerts`
- `POST /api/agent` with action `holly_stats`

## React Query Hooks

Custom hooks are available in `frontend/src/lib/hooks/use-holly.ts`:

```tsx
import { useHollyAlerts, useHollyStats, useHollySymbols } from "@/lib/hooks/use-holly";

// Fetch alerts with optional filters
const { data, isLoading, error } = useHollyAlerts({
  symbol: "AAPL",      // optional
  strategy: "Gap Scanner",  // optional
  limit: 100,          // optional
  since: "2024-01-01T00:00:00Z",  // optional
});

// Fetch stats
const stats = useHollyStats();

// Fetch latest symbols
const symbols = useHollySymbols(20);
```

## Creating a Holly Page

To create a dedicated Holly page at `/holly`:

1. Create directory: `frontend/src/app/holly/`
2. Create file: `frontend/src/app/holly/page.tsx`

```tsx
"use client";

import { HollyStats } from "@/components/dashboard/holly-stats";
import { HollyAlerts } from "@/components/dashboard/holly-alerts";

export default function HollyPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Holly AI Alerts</h1>
        <p className="text-sm text-muted-foreground">
          Trade Ideas Holly AI alert watcher feed
        </p>
      </div>

      <HollyStats />

      <HollyAlerts limit={100} />
    </div>
  );
}
```

3. Add to sidebar navigation in `frontend/src/components/layout/sidebar.tsx`:

```tsx
import { Bell } from "lucide-react";

const NAV_ITEMS = [
  // ... existing items
  { href: "/holly", label: "Holly Alerts", icon: Bell },
  // ... rest of items
];
```

## Color Scheme

Strategy badges are color-coded for quick visual identification:
- **BOP Signal**: emerald
- **Gap Scanner**: blue
- **Momentum Scanner**: purple
- **Unusual Volume**: yellow
- **Breakout Scanner**: red
- **Unknown/Other**: muted gray

All colors follow the dark theme palette with oklch color space for consistency.

## Data Flow

```
Backend (SQLite holly_alerts table)
  ↓
REST API (/api/agent with action dispatcher)
  ↓
Holly API Client (holly-client.ts)
  ↓
React Query Hooks (use-holly.ts)
  ↓
React Components (HollyStats, HollyAlerts)
  ↓
Dashboard UI
```

## Testing

Components can be verified with TypeScript compilation:

```bash
cd frontend
npx tsc --noEmit
```

Live data requires:
1. Backend server running on port 3000
2. Holly watcher enabled with CSV imports
3. Valid API key configured

## Future Enhancements

Potential improvements:
- Filter alerts by strategy or date range
- Export alerts to CSV
- Symbol watchlist from frequent Holly alerts
- Alert volume heatmap by time of day
- Integration with eval engine for Holly signal backtesting
