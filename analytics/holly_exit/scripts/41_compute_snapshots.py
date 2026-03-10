"""
41_compute_snapshots.py
------------------------
Reconstruct daily snapshot data from minute bars and daily bars.
Fills the snapshot parquet files so build_silver.py can enrich trades
with intraday context (VWAP, day range, prev close, change %).

Since Polygon's snapshot API only provides current-day data (not historical),
we reconstruct the same fields from our existing bar data.

Output format matches Polygon snapshot schema expected by build_silver.py:
  ticker, day_vw, prev_c, prev_v, todays_change_pct, day_v, day_o, day_h, day_l, day_c

Usage:
    python scripts/41_compute_snapshots.py             # Compute all dates
    python scripts/41_compute_snapshots.py --dry-run   # Preview only
"""

import argparse
import sys
import time
from pathlib import Path

import duckdb
import pandas as pd

# ── project paths ──
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent))
from config.settings import DUCKDB_PATH

SNAPSHOT_DIR = SCRIPT_DIR.parent / "data" / "snapshots"


def main():
    parser = argparse.ArgumentParser(description="Compute snapshots from daily bars")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH}")

    # Get all trade dates we need snapshots for
    trade_dates = con.execute("""
        SELECT DISTINCT CAST(entry_time AS DATE) AS trade_date
        FROM trades
        ORDER BY trade_date
    """).fetchdf()["trade_date"].tolist()
    print(f"Trade dates: {len(trade_dates)}")

    # Check existing snapshot files
    existing_files = set(f.stem for f in SNAPSHOT_DIR.glob("*.parquet"))
    new_dates = [d for d in trade_dates if str(d) not in existing_files]
    print(f"Existing snapshot files: {len(existing_files)}")
    print(f"New dates to compute: {len(new_dates)}")

    if args.dry_run:
        print(f"\nDry run: would create {len(new_dates)} snapshot files")
        con.close()
        return

    # Build daily OHLCV from minute bars for ALL traded symbols on trade dates
    # This is more efficient than per-date queries
    print("\nComputing daily aggregates from minute bars...")
    t0 = time.time()

    # Get all trade symbols
    trade_symbols = con.execute("SELECT DISTINCT symbol FROM trades").fetchdf()["symbol"].tolist()

    # Compute daily OHLCV from minute bars
    daily_df = con.execute("""
        SELECT
            symbol AS ticker,
            CAST(bar_time AS DATE) AS trade_date,
            FIRST(open ORDER BY bar_time ASC) AS day_o,
            MAX(high) AS day_h,
            MIN(low) AS day_l,
            LAST(close ORDER BY bar_time ASC) AS day_c,
            SUM(volume) AS day_v,
            -- VWAP: volume-weighted average price
            CASE WHEN SUM(volume) > 0
                 THEN SUM(close * volume) / SUM(volume)
                 ELSE NULL END AS day_vw
        FROM bars
        GROUP BY symbol, CAST(bar_time AS DATE)
        ORDER BY symbol, trade_date
    """).fetchdf()

    print(f"  Computed {len(daily_df):,} daily bars in {time.time()-t0:.1f}s")

    # Also pull from daily_bars_flat for symbols NOT in bars table
    daily_flat_df = con.execute("""
        SELECT
            ticker,
            CAST(bar_time AS DATE) AS trade_date,
            open AS day_o,
            high AS day_h,
            low AS day_l,
            close AS day_c,
            volume AS day_v,
            NULL AS day_vw
        FROM daily_bars_flat
    """).fetchdf()

    # Combine, preferring minute-bar computation (has VWAP)
    combined = pd.concat([daily_df, daily_flat_df], ignore_index=True)
    combined = combined.sort_values(["ticker", "trade_date"])
    combined = combined.drop_duplicates(subset=["ticker", "trade_date"], keep="first")
    print(f"  Combined daily bars: {len(combined):,} rows")

    con.close()

    # Compute prev_c and prev_v using shift within each symbol
    print("Computing previous-day values...")
    combined = combined.sort_values(["ticker", "trade_date"])
    combined["prev_c"] = combined.groupby("ticker")["day_c"].shift(1)
    combined["prev_v"] = combined.groupby("ticker")["day_v"].shift(1)
    combined["todays_change_pct"] = (
        (combined["day_c"] - combined["prev_c"]) / combined["prev_c"] * 100
    ).round(4)

    # Write per-date parquet files (matching Polygon snapshot format)
    print(f"Writing snapshot parquets to {SNAPSHOT_DIR}...")
    written = 0
    for date in new_dates:
        date_str = str(date)
        day_data = combined[combined["trade_date"] == date].copy()
        if len(day_data) == 0:
            continue

        # Select columns matching Polygon snapshot schema
        out = day_data[["ticker", "day_vw", "prev_c", "prev_v",
                        "todays_change_pct", "day_v", "day_o", "day_h",
                        "day_l", "day_c"]].copy()

        out.to_parquet(SNAPSHOT_DIR / f"{date_str}.parquet", index=False)
        written += 1

        if written % 200 == 0:
            print(f"  Written {written:,}/{len(new_dates):,} files...")

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s")
    print(f"Created {written:,} snapshot parquet files")
    total_files = len(list(SNAPSHOT_DIR.glob("*.parquet")))
    print(f"Total snapshot files: {total_files:,}")


if __name__ == "__main__":
    main()
