# Holly Alerts Dashboard Widget - Quick Start

## What Was Created

This PR adds a complete Holly AI Alerts dashboard widget to the Market Data Bridge frontend.

## Components

### 1. HollyStats Card Grid
```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ Total       │ Strategies  │ Import      │ Latest      │
│ Alerts      │             │ Batches     │ Alert       │
│             │             │             │             │
│ 1,234       │ 5           │ 12          │ 2m ago      │
│ 45 symbols  │ 30 days     │ Total       │ First: 15d  │
└─────────────┴─────────────┴─────────────┴─────────────┘
```

### 2. HollyAlerts Table
```
┌────────────┬────────┬──────────────────┬─────────┬────────┬────────┬────────┬─────────┐
│ Time       │ Symbol │ Strategy         │ Entry   │ Stop   │ Shares │ Last   │ Segment │
├────────────┼────────┼──────────────────┼─────────┼────────┼────────┼────────┼─────────┤
│ 9:31 AM    │ AAPL   │ Gap Scanner      │ $150.25 │ $148.0 │ 100    │ $151.0 │ Tech    │
│ 9:32 AM    │ TSLA   │ Momentum Scanner │ $230.50 │ $228.0 │ 50     │ $232.0 │ Auto    │
│ 9:35 AM    │ NVDA   │ BOP Signal       │ $450.75 │ $448.0 │ 75     │ $452.0 │ Tech    │
└────────────┴────────┴──────────────────┴─────────┴────────┴────────┴────────┴─────────┘
                       ↑
                  Color-coded badges
```

## Usage Examples

### 1. In Main Dashboard (Already Integrated)
The Holly section appears automatically when data exists:

```tsx
// frontend/src/app/page.tsx
import { HollyStats } from "@/components/dashboard/holly-stats";
import { HollyAlerts } from "@/components/dashboard/holly-alerts";

// Components auto-render when data exists
<HollyStats />
<HollyAlerts limit={10} />
```

### 2. Create Dedicated Holly Page (Optional)
```bash
# Create directory
mkdir -p frontend/src/app/holly

# Create page
cat > frontend/src/app/holly/page.tsx << 'EOF'
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
EOF
```

### 3. Add to Sidebar Navigation (Optional)
```tsx
// frontend/src/components/layout/sidebar.tsx
import { Bell } from "lucide-react";

const NAV_ITEMS = [
  // ... existing items
  { href: "/holly", label: "Holly Alerts", icon: Bell },
  // ... rest
];
```

## Features

✅ Auto-refresh every 30 seconds
✅ Sortable table (default: newest first)
✅ Color-coded strategy badges
✅ Clickable symbols → link to market page
✅ Loading skeletons
✅ Error handling
✅ Empty state messages
✅ Responsive design
✅ Dark theme
✅ TypeScript strict mode

## API Calls

```typescript
// Fetch alerts
POST /api/agent
{
  "action": "holly_alerts",
  "params": {
    "limit": 50,
    "symbol": "AAPL",       // optional
    "strategy": "Gap Scanner", // optional
    "since": "2024-01-01"   // optional
  }
}

// Fetch stats
POST /api/agent
{
  "action": "holly_stats"
}
```

## React Query Hooks

```typescript
import { useHollyAlerts, useHollyStats } from "@/lib/hooks/use-holly";

// With filters
const { data, isLoading, error } = useHollyAlerts({
  symbol: "AAPL",
  limit: 100
});

// Stats
const { data } = useHollyStats();
```

## Strategy Color Coding

| Strategy          | Color  | Badge Class                                      |
|-------------------|--------|--------------------------------------------------|
| BOP Signal        | 🟢 Emerald | `bg-emerald-500/10 text-emerald-400`         |
| Gap Scanner       | 🔵 Blue    | `bg-blue-500/10 text-blue-400`               |
| Momentum Scanner  | 🟣 Purple  | `bg-purple-500/10 text-purple-400`           |
| Unusual Volume    | 🟡 Yellow  | `bg-yellow-500/10 text-yellow-400`           |
| Breakout Scanner  | 🔴 Red     | `bg-red-500/10 text-red-400`                 |
| Unknown/Other     | ⚪ Gray    | `bg-muted/10 text-muted-foreground`          |

## Files Created

```
frontend/src/
├── lib/
│   ├── api/
│   │   ├── types.ts              (modified - added Holly types)
│   │   └── holly-client.ts       (new - API wrapper)
│   └── hooks/
│       └── use-holly.ts          (new - React Query hooks)
├── components/
│   └── dashboard/
│       ├── holly-alerts.tsx      (new - table component)
│       ├── holly-stats.tsx       (new - stats cards)
│       └── HOLLY_COMPONENTS.md   (new - detailed docs)
└── app/
    └── page.tsx                  (modified - integrated widgets)

HOLLY_IMPLEMENTATION.md           (new - this summary)
```

## Testing

### TypeScript Check
```bash
cd frontend
npx tsc --noEmit
```

### Live Data Test
1. Start backend: `npm start`
2. Import Holly CSV data
3. Open `http://localhost:3001`
4. Holly section appears on dashboard

## Acceptance Criteria ✅

- [x] Live alert feed table (symbol, strategy, entry price, time)
- [x] Stats summary (total alerts, unique symbols, top strategies)
- [x] Quick actions (click symbol → market page)
- [x] Auto-refresh every 30 seconds
- [x] Responsive table with sort by time (newest first)
- [x] Color-coded strategies
- [x] Matches existing dashboard style
- [x] API integration via `/api/agent`
- [x] TypeScript strict mode
- [x] Follows frontend patterns

## Next Steps

1. **Test with live data** - Import Holly CSV to see widgets in action
2. **Create dedicated page** (optional) - Follow instructions above
3. **Add filtering** (optional) - Filter by strategy or date range
4. **Export feature** (future) - Export alerts to CSV

## Documentation

- Component guide: `frontend/src/components/dashboard/HOLLY_COMPONENTS.md`
- Full implementation details: `HOLLY_IMPLEMENTATION.md`
