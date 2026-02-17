# Holly Alerts Widget Architecture

## Component Hierarchy

```
Dashboard Page (/)
│
├─ Eval Stats Cards
│  └─ StatsCards Component
│
├─ Recent Evaluations
│  └─ RecentEvalsMini Component
│
└─ Holly AI Alerts (conditional - only if data exists)
   ├─ HollyStats Component
   │  ├─ Card: Total Alerts
   │  ├─ Card: Strategies
   │  ├─ Card: Import Batches
   │  └─ Card: Latest Alert
   │
   └─ HollyAlerts Component
      └─ TanStack Table
         ├─ Column: Time (sortable)
         ├─ Column: Symbol (clickable link)
         ├─ Column: Strategy (color badge)
         ├─ Column: Entry Price
         ├─ Column: Stop Price
         ├─ Column: Shares
         ├─ Column: Last Price
         └─ Column: Segment
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         Backend (Node.js)                        │
├─────────────────────────────────────────────────────────────────┤
│ SQLite Database                                                  │
│ └─ holly_alerts table                                           │
│    ├─ id, alert_time, symbol, strategy                         │
│    ├─ entry_price, stop_price, shares                          │
│    └─ last_price, segment, extra                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      REST API Dispatcher                         │
├─────────────────────────────────────────────────────────────────┤
│ POST /api/agent                                                  │
│ { action: "holly_alerts", params: { limit: 50 } }              │
│ { action: "holly_stats" }                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js 14)                         │
├─────────────────────────────────────────────────────────────────┤
│ API Client Layer                                                 │
│ └─ holly-client.ts                                              │
│    ├─ getAlerts(params)                                         │
│    ├─ getStats()                                                │
│    └─ getSymbols(limit)                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ React Query Layer (TanStack Query)                              │
│ └─ use-holly.ts                                                 │
│    ├─ useHollyAlerts() ──► refetchInterval: 30_000ms           │
│    ├─ useHollyStats() ──► refetchInterval: 30_000ms            │
│    └─ useHollySymbols()                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ React Components                                                 │
│ ├─ HollyStats (dashboard/holly-stats.tsx)                      │
│ │  └─ Displays 4 summary cards with icons                      │
│ │                                                               │
│ └─ HollyAlerts (dashboard/holly-alerts.tsx)                    │
│    └─ TanStack Table with sorting + color-coded badges         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Dashboard Page (app/page.tsx)                                   │
│ └─ Conditionally renders Holly section when data exists         │
└─────────────────────────────────────────────────────────────────┘
```

## Type System Flow

```typescript
// Backend Database
interface HollyAlertRow {
  id: number;
  alert_time: string;
  symbol: string;
  strategy: string | null;
  entry_price: number | null;
  // ...
}

// ↓ Exported via REST API

// Frontend Types (types.ts)
interface HollyAlert {
  id: number;
  alert_time: string;
  symbol: string;
  strategy: string | null;
  entry_price: number | null;
  // ...
}

interface HollyAlertsResponse {
  count: number;
  alerts: HollyAlert[];
}

interface HollyStats {
  total_alerts: number;
  unique_symbols: number;
  // ...
}

// ↓ Used by API Client

// API Client (holly-client.ts)
export const hollyClient = {
  getAlerts(): Promise<HollyAlertsResponse> { /* ... */ },
  getStats(): Promise<HollyStats> { /* ... */ }
}

// ↓ Wrapped by React Query

// Hooks (use-holly.ts)
useHollyAlerts(): UseQueryResult<HollyAlertsResponse>
useHollyStats(): UseQueryResult<HollyStats>

// ↓ Consumed by Components

// Components
function HollyAlerts() {
  const { data } = useHollyAlerts();
  return <Table data={data?.alerts} />;
}
```

## Auto-Refresh Mechanism

```
Time: 0s ──────► Initial page load
         │
         ├─► useHollyAlerts() fires query
         ├─► useHollyStats() fires query
         │
Time: 30s ──────► Auto-refresh triggered
         │
         ├─► useHollyAlerts() refetches (refetchInterval: 30_000)
         ├─► useHollyStats() refetches (refetchInterval: 30_000)
         │
Time: 60s ──────► Auto-refresh triggered
         │
         ├─► useHollyAlerts() refetches
         ├─► useHollyStats() refetches
         │
         ... continues every 30 seconds
```

## State Management

```
┌─────────────────────────────────────────────────────────────────┐
│ TanStack Query Cache                                             │
├─────────────────────────────────────────────────────────────────┤
│ queryKey: ["holly-alerts", { limit: 50 }]                      │
│ data: { count: 1234, alerts: [...] }                           │
│ isLoading: false                                                 │
│ error: null                                                      │
│ dataUpdatedAt: 1709780012345                                    │
│                                                                  │
│ queryKey: ["holly-stats"]                                       │
│ data: { total_alerts: 1234, unique_symbols: 45, ... }          │
│ isLoading: false                                                 │
│ error: null                                                      │
│ dataUpdatedAt: 1709780012345                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ React Component State                                            │
├─────────────────────────────────────────────────────────────────┤
│ HollyAlerts Component                                            │
│ ├─ sorting: [{ id: "alert_time", desc: true }]                 │
│ └─ table: TanStack Table instance                               │
│                                                                  │
│ HollyStats Component                                             │
│ └─ (stateless - just displays data)                            │
└─────────────────────────────────────────────────────────────────┘
```

## Color Mapping Logic

```typescript
const strategyColors: Record<string, string> = {
  "BOP Signal": "bg-emerald-500/10 text-emerald-400",    // 🟢
  "Gap Scanner": "bg-blue-500/10 text-blue-400",         // 🔵
  "Momentum Scanner": "bg-purple-500/10 text-purple-400",// 🟣
  "Unusual Volume": "bg-yellow-500/10 text-yellow-400",  // 🟡
  "Breakout Scanner": "bg-red-500/10 text-red-400",      // 🔴
};

function getStrategyColor(strategy: string | null): string {
  if (!strategy) return "bg-muted/10 text-muted-foreground"; // ⚪
  return strategyColors[strategy] ?? "bg-muted/10 text-muted-foreground";
}
```

## Conditional Rendering Logic

```typescript
// Dashboard Page (app/page.tsx)
export default function DashboardPage() {
  const hollyStatsQuery = useHollyStats();

  return (
    <div>
      {/* Always show eval stats */}
      <StatsCards />
      <RecentEvalsMini />

      {/* Only show Holly if data exists */}
      {hollyStatsQuery.data && hollyStatsQuery.data.total_alerts > 0 && (
        <>
          <h2>Holly AI Alerts</h2>
          <HollyStats />
          <HollyAlerts limit={10} />
        </>
      )}
    </div>
  );
}
```

## Performance Considerations

1. **Query Deduplication**: TanStack Query automatically deduplicates requests
2. **Stale-while-revalidate**: Shows cached data while refetching in background
3. **Automatic Garbage Collection**: Old queries cleaned up when components unmount
4. **Request Batching**: Multiple components using same query share single request
5. **Optimistic Updates**: Could be added for mutations (future enhancement)

## Error Handling Flow

```
API Call Fails
      │
      ├─► Network Error
      │   └─► TanStack Query retry (3 attempts with exponential backoff)
      │       └─► Component shows error message
      │
      ├─► 404 Not Found
      │   └─► Component shows "No data available"
      │
      ├─► 500 Server Error
      │   └─► Component shows "Error loading alerts: [message]"
      │
      └─► 401 Unauthorized
          └─► Component shows "API key required"
```

## File Structure

```
market-data-bridge/
├── frontend/
│   └── src/
│       ├── lib/
│       │   ├── api/
│       │   │   ├── types.ts ────────────► HollyAlert, HollyStats interfaces
│       │   │   └── holly-client.ts ─────► API wrapper functions
│       │   ├── hooks/
│       │   │   └── use-holly.ts ────────► React Query hooks
│       │   └── utils/
│       │       └── formatters.ts ───────► formatTimestamp, formatPrice
│       │
│       ├── components/
│       │   ├── dashboard/
│       │   │   ├── holly-alerts.tsx ────► Table component
│       │   │   ├── holly-stats.tsx ─────► Stats cards
│       │   │   └── HOLLY_COMPONENTS.md ─► Component docs
│       │   └── ui/
│       │       ├── card.tsx
│       │       ├── table.tsx
│       │       └── badge.tsx
│       │
│       └── app/
│           └── page.tsx ─────────────────► Dashboard integration
│
├── HOLLY_IMPLEMENTATION.md ──────────────► Implementation details
└── HOLLY_QUICKSTART.md ──────────────────► Quick start guide
```
