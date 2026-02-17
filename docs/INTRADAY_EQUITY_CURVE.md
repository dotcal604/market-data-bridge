# Intraday Equity Curve Chart

## Overview
Real-time P&L chart on the dashboard showing the session equity curve with automatic 30-second polling.

## Features
- **Line chart** showing cumulative P&L over the trading day
- **X-axis**: Time in ET (9:30 AM - 4:00 PM ET)
- **Y-axis**: Cumulative P&L in dollars
- **Dynamic coloring**: Green line when positive, red when negative
- **High-water mark**: Dashed reference line showing maximum P&L achieved
- **Auto-refresh**: Polls data every 30 seconds via React Query
- **Loading states**: Skeleton loader while fetching data
- **Error handling**: Graceful error messages if data unavailable

## Implementation Details

### Backend (src/rest/routes.ts)
```typescript
GET /api/account/pnl/intraday
```
Returns today's account snapshots filtered by Eastern Time date. The scheduler automatically captures snapshots every 5 minutes during market hours (4 AM - 8 PM ET).

Response format:
```json
{
  "snapshots": [
    {
      "id": 1,
      "net_liquidation": 100000.00,
      "total_cash_value": 50000.00,
      "buying_power": 200000.00,
      "daily_pnl": 1250.50,
      "unrealized_pnl": 750.25,
      "realized_pnl": 500.25,
      "created_at": "2026-02-17T09:35:00.000Z"
    }
  ],
  "count": 1
}
```

### Frontend Component (frontend/src/components/dashboard/equity-curve.tsx)
- Uses `useIntradayPnL()` hook with 30s polling
- Transforms snapshots into chart data with ET time labels
- Calculates high-water mark (maximum P&L)
- Dynamic gradient based on positive/negative P&L
- Recharts LineChart with:
  - ReferenceLine for high-water mark (dashed emerald)
  - ReferenceLine at y=0 (zero line)
  - Dark theme tooltips
  - Time labels formatted in ET timezone

### Data Flow
1. **Scheduler** (src/scheduler.ts) captures account snapshots every 5 minutes
   - Runs during market hours (4 AM - 8 PM ET weekdays)
   - Stores in `account_snapshots` SQLite table
   - Now includes daily_pnl, unrealized_pnl, realized_pnl

2. **API Endpoint** filters snapshots to today (ET date)
   - Queries last 300 snapshots (25 hours worth)
   - Filters by ET date to ensure correct trading day

3. **React Component** polls endpoint every 30 seconds
   - Displays line chart with cumulative P&L
   - Shows current P&L and high-water mark
   - Updates automatically throughout the session

## Usage
The component is automatically included on the dashboard page below the stats cards and edge summary.

## Requirements Met
✅ New component: `frontend/src/components/dashboard/equity-curve.tsx`
✅ Line chart (Recharts) showing cumulative P&L over the trading day
✅ Data source: `GET /api/account/pnl/intraday` polled every 30s
✅ X-axis: time (ET), Y-axis: cumulative P&L ($)
✅ Green line when positive, red when negative
✅ High-water mark as dashed line
✅ Added to dashboard page below stats cards
