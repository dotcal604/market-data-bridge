# Holly Performance Dashboard - Manual Setup Step

## Directory Creation Required

Due to tooling limitations, the performance page directory needs to be created manually.

## Steps:

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
rm HOLLY_PERFORMANCE_SETUP.md
```

## Or Use Git:

```bash
# Create directory and move file in one go
mkdir -p frontend/src/app/holly/performance && \
mv HOLLY_PERFORMANCE_PAGE.tsx frontend/src/app/holly/performance/page.tsx && \
rm HOLLY_PERFORMANCE_SETUP.md
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
