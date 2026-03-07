"""
34_fetch_earnings_calendar.py — Fetch historical earnings dates for Holly-traded symbols.

Downloads earnings dates from Yahoo Finance for all unique symbols in the Holly
trades database. Creates a lookup table for Silver layer enrichment.

Features added to Silver:
  - is_earnings_day (trade happened on earnings release day)
  - days_to_earnings (trading days until next earnings)
  - days_from_earnings (trading days since last earnings)
  - earnings_proximity (pre_earnings_3d, earnings_day, post_earnings_3d, normal)

Usage:
    python scripts/34_fetch_earnings_calendar.py
    python scripts/34_fetch_earnings_calendar.py --refresh   # re-fetch all symbols
    python scripts/34_fetch_earnings_calendar.py --limit 100 # fetch only 100 symbols (testing)
"""

import argparse
import logging
import sys
import time
from pathlib import Path

import duckdb
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import DATA_DIR, DUCKDB_PATH

EARNINGS_DIR = DATA_DIR / "earnings"
CACHE_FILE = EARNINGS_DIR / "earnings_dates.parquet"


def get_trade_symbols(con: duckdb.DuckDBPyConnection) -> list[str]:
    """Get unique symbols from Holly trades."""
    result = con.execute("""
        SELECT DISTINCT symbol FROM trades ORDER BY symbol
    """).fetchall()
    return [r[0] for r in result]


def fetch_earnings_dates(
    symbols: list[str], refresh: bool = False
) -> pd.DataFrame:
    """Fetch earnings dates for given symbols using yfinance."""
    import yfinance as yf

    # Suppress noisy yfinance warnings for delisted/missing symbols
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)

    EARNINGS_DIR.mkdir(parents=True, exist_ok=True)

    # ── Load cache ────────────────────────────────────────────
    cached = pd.DataFrame()
    cached_symbols: set[str] = set()
    if CACHE_FILE.exists() and not refresh:
        cached = pd.read_parquet(CACHE_FILE)
        cached_symbols = set(cached["symbol"].unique())
        print(f"  Cached: {len(cached_symbols)} symbols, {len(cached):,} dates")

    # ── Find symbols needing fetch ────────────────────────────
    to_fetch = [s for s in symbols if s not in cached_symbols]
    if not to_fetch:
        print(f"  All {len(symbols)} symbols cached")
        return cached

    print(f"  Fetching earnings for {len(to_fetch)} symbols...")

    new_rows: list[dict] = []
    errors = 0
    no_data = 0

    for i, sym in enumerate(to_fetch):
        if i > 0 and i % 50 == 0:
            print(
                f"    Progress: {i}/{len(to_fetch)} "
                f"({len(new_rows)} dates, {errors} errors, {no_data} no-data)"
            )

        try:
            ticker = yf.Ticker(sym)

            # Try earnings_dates first (returns DataFrame with dates as index)
            dates_found = False
            try:
                ed = ticker.earnings_dates
                if ed is not None and len(ed) > 0:
                    for dt in ed.index:
                        ts = pd.Timestamp(dt)
                        if pd.notna(ts):
                            new_rows.append({
                                "symbol": sym,
                                "earnings_date": ts.normalize().date(),
                            })
                    dates_found = True
            except Exception:
                pass

            # Fallback: try get_earnings_dates with limit
            if not dates_found:
                try:
                    ed = ticker.get_earnings_dates(limit=20)
                    if ed is not None and len(ed) > 0:
                        for dt in ed.index:
                            ts = pd.Timestamp(dt)
                            if pd.notna(ts):
                                new_rows.append({
                                    "symbol": sym,
                                    "earnings_date": ts.normalize().date(),
                                })
                        dates_found = True
                except Exception:
                    pass

            if not dates_found:
                no_data += 1

        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"    Error {sym}: {e}")

        time.sleep(0.3)  # Rate limit

    print(
        f"  Fetched {len(new_rows):,} earnings dates for "
        f"{len(to_fetch)} symbols ({errors} errors, {no_data} no-data)"
    )

    # ── Merge with cache and save ─────────────────────────────
    if new_rows:
        new_df = pd.DataFrame(new_rows)
        result = pd.concat([cached, new_df], ignore_index=True)
    else:
        result = cached

    # Deduplicate and save
    result = result.drop_duplicates(subset=["symbol", "earnings_date"])
    result.to_parquet(CACHE_FILE, index=False)
    print(f"  Saved: {len(result):,} total earnings dates -> {CACHE_FILE.name}")

    return result


def load_to_duckdb(con: duckdb.DuckDBPyConnection, df: pd.DataFrame):
    """Load earnings dates into DuckDB."""
    print("\n" + "=" * 60)
    print("Loading earnings dates into DuckDB...")
    print("=" * 60)

    con.execute("DROP TABLE IF EXISTS earnings_calendar")

    if len(df) == 0:
        print("  No earnings data to load")
        return

    # Register the DataFrame and create table
    con.register("earnings_df", df)
    con.execute("""
        CREATE TABLE earnings_calendar AS
        SELECT
            symbol,
            CAST(earnings_date AS DATE) AS earnings_date
        FROM earnings_df
        WHERE earnings_date IS NOT NULL
        ORDER BY symbol, earnings_date
    """)
    con.unregister("earnings_df")

    cnt = con.execute("SELECT COUNT(*) FROM earnings_calendar").fetchone()[0]
    syms = con.execute(
        "SELECT COUNT(DISTINCT symbol) FROM earnings_calendar"
    ).fetchone()[0]
    min_d, max_d = con.execute(
        "SELECT MIN(earnings_date), MAX(earnings_date) FROM earnings_calendar"
    ).fetchone()
    print(
        f"  earnings_calendar: {cnt:,} dates for "
        f"{syms:,} symbols ({min_d} to {max_d})"
    )

    # ── Coverage check against trades ─────────────────────────
    coverage = con.execute("""
        SELECT
            COUNT(*) AS total_trades,
            COUNT(e.earnings_date) AS on_earnings_day,
            ROUND(COUNT(e.earnings_date) * 100.0 / NULLIF(COUNT(*), 0), 1) AS pct
        FROM trades t
        LEFT JOIN earnings_calendar e
            ON e.symbol = t.symbol
            AND e.earnings_date = CAST(t.entry_time AS DATE)
    """).fetchone()
    print(
        f"\n  Trades on earnings day: {coverage[1]:,}/{coverage[0]:,} "
        f"({coverage[2]}%)"
    )

    # ── Symbols with earnings data vs total traded ────────────
    total_syms = con.execute(
        "SELECT COUNT(DISTINCT symbol) FROM trades"
    ).fetchone()[0]
    print(
        f"  Symbols with earnings data: {syms:,}/{total_syms:,} "
        f"({round(syms * 100.0 / max(total_syms, 1), 1)}%)"
    )


def main():
    parser = argparse.ArgumentParser(
        description="Fetch earnings calendar for Holly symbols"
    )
    parser.add_argument(
        "--refresh", action="store_true",
        help="Re-fetch all symbols (ignore cache)",
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Limit symbols to fetch (for testing)",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("Earnings Calendar Fetch")
    print("=" * 60)

    t0 = time.time()

    con = duckdb.connect(str(DUCKDB_PATH))
    symbols = get_trade_symbols(con)
    print(f"  {len(symbols):,} unique symbols in trades")

    if args.limit:
        symbols = symbols[: args.limit]
        print(f"  Limited to {len(symbols)} symbols (--limit)")

    df = fetch_earnings_dates(symbols, refresh=args.refresh)
    load_to_duckdb(con, df)
    con.close()

    elapsed = time.time() - t0
    print(f"\nEarnings calendar fetch complete in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
