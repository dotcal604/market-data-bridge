"""
16_load_benchmarks_to_ddb.py — Load ETF minute bars + grouped daily bars into DuckDB.

Creates two new tables:
  - etf_bars       — 1-min OHLCV for SPY/QQQ/IWM/DIA + 11 sector ETFs
  - market_daily   — Grouped daily OHLCV for ALL US stocks (10K+ tickers/day)

Usage:
    python scripts/16_load_benchmarks_to_ddb.py
"""

import sys
import time
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import DATA_DIR, DUCKDB_PATH

ETF_MINUTE_DIR = DATA_DIR / "parquet" / "etf_minutes"
GROUPED_DIR = DATA_DIR / "parquet" / "grouped_daily"


def load_etf_minutes(con: duckdb.DuckDBPyConnection):
    """Load ETF minute-bar parquet files into etf_bars table."""
    print("=" * 60)
    print("Loading ETF minute bars...")
    print("=" * 60)

    files = sorted(ETF_MINUTE_DIR.glob("*.parquet"))
    if not files:
        print("  No ETF minute parquet files found!")
        return

    print(f"  Parquet files: {len(files):,}")
    t0 = time.time()

    # Drop and recreate
    con.execute("DROP TABLE IF EXISTS etf_bars")
    con.execute("""
        CREATE TABLE etf_bars AS
        SELECT
            -- Extract symbol from filename (e.g., SPY_2024-01-02.parquet -> SPY)
            split_part(split_part(regexp_extract(filename, '[^/\\\\]+$'), '.', 1), '_', 1) AS symbol,
            timestamp AS bar_time,
            open, high, low, close, volume,
            CASE WHEN vwap IS NOT NULL THEN vwap ELSE 0.0 END AS vwap,
            CASE WHEN num_trades IS NOT NULL THEN num_trades ELSE 0 END AS num_trades
        FROM read_parquet(?, filename=true, union_by_name=true)
        ORDER BY symbol, bar_time
    """, [str(ETF_MINUTE_DIR / "*.parquet")])

    count = con.execute("SELECT COUNT(*) FROM etf_bars").fetchone()[0]
    symbols = con.execute("SELECT COUNT(DISTINCT symbol) FROM etf_bars").fetchone()[0]
    date_range = con.execute("SELECT MIN(CAST(bar_time AS DATE)), MAX(CAST(bar_time AS DATE)) FROM etf_bars").fetchone()

    elapsed = time.time() - t0
    print(f"  Loaded: {count:,} rows, {symbols} ETFs")
    print(f"  Range: {date_range[0]} to {date_range[1]}")
    print(f"  Time: {elapsed:.1f}s")

    # Show per-ETF counts
    etf_counts = con.execute("""
        SELECT symbol, COUNT(*) as bars,
               MIN(CAST(bar_time AS DATE)) as first_date,
               MAX(CAST(bar_time AS DATE)) as last_date
        FROM etf_bars
        GROUP BY symbol
        ORDER BY symbol
    """).fetchdf()
    print()
    print(etf_counts.to_string(index=False))


def load_grouped_daily(con: duckdb.DuckDBPyConnection):
    """Load grouped daily bar parquet files into market_daily table."""
    print("\n" + "=" * 60)
    print("Loading grouped daily bars...")
    print("=" * 60)

    files = sorted(GROUPED_DIR.glob("*.parquet"))
    if not files:
        print("  No grouped daily parquet files found!")
        return

    print(f"  Parquet files: {len(files):,}")
    t0 = time.time()

    # Drop and recreate
    con.execute("DROP TABLE IF EXISTS market_daily")
    con.execute("""
        CREATE TABLE market_daily AS
        SELECT
            symbol,
            CAST(bar_date AS DATE) AS bar_date,
            open, high, low, close, volume
        FROM read_parquet(?, union_by_name=true)
        ORDER BY symbol, bar_date
    """, [str(GROUPED_DIR / "*.parquet")])

    count = con.execute("SELECT COUNT(*) FROM market_daily").fetchone()[0]
    symbols = con.execute("SELECT COUNT(DISTINCT symbol) FROM market_daily").fetchone()[0]
    dates = con.execute("SELECT COUNT(DISTINCT bar_date) FROM market_daily").fetchone()[0]
    date_range = con.execute("SELECT MIN(bar_date), MAX(bar_date) FROM market_daily").fetchone()

    elapsed = time.time() - t0
    print(f"  Loaded: {count:,} rows")
    print(f"  Unique symbols: {symbols:,}")
    print(f"  Trading days: {dates}")
    print(f"  Range: {date_range[0]} to {date_range[1]}")
    print(f"  Time: {elapsed:.1f}s")


def print_summary(con: duckdb.DuckDBPyConnection):
    """Print full database summary."""
    print("\n" + "=" * 60)
    print("DuckDB Summary")
    print("=" * 60)

    for r in con.execute("SHOW TABLES").fetchall():
        t = r[0]
        cnt = con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        print(f"  {t:<25} {cnt:>15,} rows")

    # DB file size
    db_size = DUCKDB_PATH.stat().st_size / 1e6
    print(f"\n  Database file: {db_size:,.1f} MB")


def main():
    DUCKDB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DUCKDB_PATH))

    load_etf_minutes(con)
    load_grouped_daily(con)
    print_summary(con)

    con.close()
    print("\nDone!")


if __name__ == "__main__":
    main()
