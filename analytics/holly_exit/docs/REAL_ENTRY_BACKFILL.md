# Real Entry Backfill — Pipeline Documentation

## What This Does

Joins your **actual IBKR execution data** (fills, prices, commissions) into the Holly
analytics fact table so you can compare theoretical Holly signals against what you
actually traded.

## The Problem

The `holly_analytics.csv` (and `holly_trades.duckdb`) has 28,875 Holly signal rows
with columns `real_entry_price`, `real_entry_time`, and `real_commission` — but they
were **always empty**. The schema planned for real execution joins, but the join never
ran because:

1. `tradersync_fills.csv` in `data/raw/` was actually a misnamed IBKR Flex export with
   only 17 rows from a single day
2. Script `01_ingest_trades.py` calls `match_tradersync()` but it found nothing to match
3. Script `29_map_ibkr_trades.py` does proper matching but writes to report CSVs, not
   back into the DuckDB `trades` table

## The Solution

**Script `42_backfill_real_entries.py`** — a 4-step pipeline:

```
Step 1: Parse & combine IBKR Flex exports
        (AllFields_TradeConfirmations CSVs from Downloads)

Step 2: Cluster partial fills -> VWAP round-trip positions
        (reuses 29's parse_fills + cluster_by_order + pair_round_trips)

Step 3: Match IBKR round trips to Holly trades
        (symbol + direction + 8-hour time window, confidence scoring)

Step 4: UPDATE trades.real_entry_price / real_entry_time / real_commission
        in DuckDB, then rebuild Silver layer
```

## How to Run

```bash
# From analytics/holly_exit/
python scripts/42_backfill_real_entries.py              # full run
python scripts/42_backfill_real_entries.py --dry-run    # report only
python scripts/42_backfill_real_entries.py --files a.csv b.csv  # custom files

# Then rebuild Silver:
python ../../analytics/build_silver.py

# Re-export CSV (optional):
python -c "
import duckdb
db = duckdb.connect('../../data/silver/holly_trades.duckdb', read_only=True)
db.execute('SELECT * FROM holly_trades').fetchdf().to_csv('holly_analytics.csv', index=False)
"
```

## Data Sources

| File | Period | Rows | Location |
|------|--------|------|----------|
| `AllFields_TradeConfirmations (1).csv` | 2024-09-04 to 2025-03-06 | 1,978 STK fills | Downloads |
| `AllFields_TradeConfirmations.csv` | 2025-03-06 to 2026-03-05 | 2,580 STK fills | Downloads |

Combined: **4,558 fills** -> 3,219 orders -> 1,674 round-trip positions.

## Match Results (2025-03-09 run)

| Category | Count | Description |
|----------|-------|-------------|
| **matched** | 89 | IBKR position matched to Holly signal (conf >= 0.40) |
| ibkr_only | 61 | Holly fired that day, but wrong direction or outside time window |
| review | 12 | Low confidence (0.06-0.38), mostly large time gaps |
| non_holly | 1,512 | No Holly signal that day (TSLA, NVDA, AAPL, etc.) |

**Why only 89?** Holly fires ~28,875 signals over 10 years. You've been trading since
Sep 2024. Of your 1,674 IBKR positions, only 162 happened on the same symbol + date
as a Holly signal. Of those, 89 also matched direction and fell within the 8-hour
time window. Most of your trading is non-Holly (your own scans, discretionary picks).

## Match Confidence Scoring

The match engine scores on [0, 1]:
- **Time proximity (60% weight)**: 1.0 at same minute, linear decay to 0 at 8h window edge
- **Price proximity (40% weight)**: 1.0 within 0.1%, decays to 0 at 5% difference
- **Direction**: hard reject if mismatched

Threshold: `MIN_CONFIDENCE = 0.40` (the 12 review trades are 0.06-0.38).

## Slippage Summary

On the 89 matched trades:
- **Shorts** (42 trades): avg -0.51% slippage (you entered slightly better than Holly)
- **Longs** (47 trades): avg +0.86% slippage (you entered slightly worse than Holly)
- Overall median: ~0.3% absolute slippage

## Increasing Coverage

To get more matches in the future:

1. **Export longer IBKR Flex history** — The current files only cover Sep 2024 to Mar 2026.
   If you traded Holly signals before Sep 2024, pull an older Flex report.

2. **Lower the confidence threshold** — The 12 review trades (conf 0.06-0.38) are
   mostly legitimate Holly-motivated entries with large time gaps (pre-market signal,
   afternoon entry). Setting `MIN_CONFIDENCE = 0.30` would recover ~10 more.

3. **Add TraderSync export** — If you use TraderSync, export fills CSV and either:
   - Place at `data/raw/tradersync_fills.csv` and re-run `01_ingest_trades.py`
   - Or pass to `42_backfill_real_entries.py --files tradersync.csv`
