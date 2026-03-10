"""
38_compute_daily_from_bars.py
------------------------------
Compute daily OHLCV bars from existing 1-minute bars in the `bars` table.
Fills the `daily_bars_flat` table for dates NOT already covered (pre-2021).

This bridges the gap where Polygon flat files only cover 2021+, but Alpaca
minute bars cover 2016-2021.

Usage:
    python scripts/38_compute_daily_from_bars.py                # Fill gaps only
    python scripts/38_compute_daily_from_bars.py --force-all    # Recompute everything
"""

import argparse
import sys
import time
from pathlib import Path

import duckdb

# ── project paths ──
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent))
from config.settings import DUCKDB_PATH


def main():
    parser = argparse.ArgumentParser(description="Compute daily bars from minute bars")
    parser.add_argument("--force-all", action="store_true",
                        help="Recompute all dates (not just gaps)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be inserted without doing it")
    args = parser.parse_args()

    con = duckdb.connect(str(DUCKDB_PATH))
    print(f"Connected to {DUCKDB_PATH}")

    # Check existing coverage
    existing = con.execute("""
        SELECT MIN(CAST(bar_time AS DATE)) as min_d,
               MAX(CAST(bar_time AS DATE)) as max_d,
               COUNT(*) as cnt
        FROM daily_bars_flat
    """).fetchone()
    print(f"daily_bars_flat current: {existing[0]} to {existing[1]}, {existing[2]:,} rows")

    bars_range = con.execute("""
        SELECT MIN(CAST(bar_time AS DATE)), MAX(CAST(bar_time AS DATE)), COUNT(*)
        FROM bars
    """).fetchone()
    print(f"bars (minute) current:   {bars_range[0]} to {bars_range[1]}, {bars_range[2]:,} rows")

    # Build the gap-fill query
    if args.force_all:
        where_clause = "WHERE 1=1"
        print("\n--force-all: recomputing ALL daily bars from minutes...")
    else:
        # Only compute for dates NOT already in daily_bars_flat
        where_clause = """
        WHERE NOT EXISTS (
            SELECT 1 FROM daily_bars_flat dbf
            WHERE dbf.ticker = agg.symbol
            AND CAST(dbf.bar_time AS DATE) = agg.trade_date
        )
        """
        print("\nFilling gaps (dates not in daily_bars_flat)...")

    # Aggregate minute bars to daily OHLCV
    agg_sql = f"""
        WITH daily_agg AS (
            SELECT
                symbol,
                CAST(bar_time AS DATE) AS trade_date,
                FIRST(open ORDER BY bar_time ASC) AS day_open,
                MAX(high) AS day_high,
                MIN(low) AS day_low,
                LAST(close ORDER BY bar_time ASC) AS day_close,
                SUM(volume) AS day_volume,
                COUNT(*) AS bar_count
            FROM bars
            GROUP BY symbol, CAST(bar_time AS DATE)
        )
        SELECT
            symbol AS ticker,
            day_volume AS volume,
            day_open AS open,
            day_close AS close,
            day_high AS high,
            day_low AS low,
            CAST(trade_date AS TIMESTAMP) AS bar_time,
            bar_count AS transactions
        FROM daily_agg agg
        {where_clause}
    """

    if args.dry_run:
        count = con.execute(f"SELECT COUNT(*) FROM ({agg_sql})").fetchone()[0]
        print(f"\nDry run: would insert {count:,} daily bar rows")
        con.close()
        return

    t0 = time.time()
    # Insert into daily_bars_flat
    result = con.execute(f"""
        INSERT INTO daily_bars_flat (ticker, volume, open, close, high, low, bar_time, transactions)
        {agg_sql}
    """)
    inserted = result.fetchone()
    # DuckDB doesn't return row count from INSERT...SELECT, so query the new count
    new_count = con.execute("SELECT COUNT(*) FROM daily_bars_flat").fetchone()[0]
    elapsed = time.time() - t0

    print(f"\nDone in {elapsed:.1f}s")
    print(f"daily_bars_flat now has {new_count:,} rows (was {existing[2]:,})")

    # Verify coverage
    new_range = con.execute("""
        SELECT MIN(CAST(bar_time AS DATE)), MAX(CAST(bar_time AS DATE)),
               COUNT(DISTINCT ticker)
        FROM daily_bars_flat
    """).fetchone()
    print(f"Range: {new_range[0]} to {new_range[1]}, {new_range[2]:,} symbols")

    con.close()
    print("Done!")


if __name__ == "__main__":
    main()
