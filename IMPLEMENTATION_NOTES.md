# Intraday Equity Curve Implementation

## Visual Overview

The component displays a real-time line chart showing session P&L:

```
┌─────────────────────────────────────────────────────────────────┐
│ Intraday Equity Curve          Current: $2,450.75  High: $2,680 │
├─────────────────────────────────────────────────────────────────┤
│  $3.0k ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ High Water Mark (dashed emerald line)    │
│  $2.0k         ╱╲                                                │
│  $1.0k      ╱╱  ╲╲╲                                              │
│  $0.0k ────────────────────────────── (zero line)                │
│ -$1.0k                                                           │
│        9:30   11:00   12:30   2:00   3:30   Time (ET)           │
└─────────────────────────────────────────────────────────────────┘
```

## Key Features

✅ **Dynamic Color**: Green line for positive P&L, red for negative
✅ **High-Water Mark**: Dashed reference line showing peak P&L
✅ **Zero Line**: Horizontal reference at $0
✅ **Time Labels**: ET timezone (market hours)
✅ **Auto-Refresh**: Polls every 30 seconds
✅ **Loading State**: Skeleton loader during data fetch
✅ **Error Handling**: Graceful error messages
✅ **Header Stats**: Shows current P&L and high-water mark

## Component States

1. **Loading**: Shows skeleton placeholder
2. **No Data**: "No intraday data yet. Snapshots are taken every 5 minutes..."
3. **Error**: Displays error message in muted card
4. **Success**: Renders full chart with data

## Data Flow

1. Scheduler captures snapshots every 5 min (market hours 4 AM - 8 PM ET)
2. Backend endpoint `/api/account/pnl/intraday` filters today's snapshots
3. Frontend polls every 30s via `useIntradayPnL()` hook
4. Chart updates automatically with latest data

## Files Modified

- `src/rest/routes.ts` - Added `/api/account/pnl/intraday` endpoint
- `src/scheduler.ts` - Enhanced to capture P&L data
- `frontend/src/lib/api/types.ts` - Added `AccountSnapshot`, `IntradayPnLResponse`
- `frontend/src/lib/hooks/use-account.ts` - Added `useIntradayPnL()` hook
- `frontend/src/components/dashboard/equity-curve.tsx` - New component (160 lines)
- `frontend/src/app/page.tsx` - Integrated component

## Testing Notes

The component requires:
- IBKR connection for live P&L data
- Market hours for snapshot collection
- At least 2+ snapshots for meaningful curve

When no data is available, displays a helpful empty state message.
