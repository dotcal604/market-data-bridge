# Holly Performance Dashboard - Manual Setup Step

## Directory Creation Required

Due to tooling limitations, the performance page directory needs to be created manually.

## Quick Setup (Recommended):

```bash
chmod +x setup-performance-page.sh
./setup-performance-page.sh
```

This script will:
1. Create the `frontend/src/app/holly/performance` directory
2. Move `HOLLY_PERFORMANCE_PAGE.tsx` to `frontend/src/app/holly/performance/page.tsx`
3. Clean up temporary files

## Manual Steps (Alternative):

1. Create the directory:
```bash
mkdir -p frontend/src/app/holly/performance
```

2. Move the page file:
```bash
mv HOLLY_PERFORMANCE_PAGE.tsx frontend/src/app/holly/performance/page.tsx
```

3. Clean up:
```bash
rm HOLLY_PERFORMANCE_SETUP.md setup-performance-page.sh
```

## What This Page Does:

The Holly Performance Dashboard (`/holly/performance`) displays:
- Strategy Leaderboard: sortable table by Sharpe, win rate, avg R, profit factor
- MFE/MAE Scatter Plot: visualize risk/reward by strategy
- Trailing Stop Comparison Chart: original vs optimized P/L
- Time-of-Day Heatmap: win rate by hour
- Per-Strategy Detail Cards: optimal params, trade count, P/L curves

## API Endpoints Used:

- `POST /api/agent` with action `holly_exit_autopsy`
- `POST /api/agent` with action `trailing_stop_summary`
- `POST /api/agent` with action `trailing_stop_per_strategy`
- `POST /api/agent` with action `holly_trade_stats`

All components and hooks are already created and committed.
