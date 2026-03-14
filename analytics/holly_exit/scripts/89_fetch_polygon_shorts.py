"""
Script 89 -- Fetch Polygon Short Interest + Short Volume
=========================================================
Downloads short interest (bi-monthly FINRA) and daily short volume
from Polygon.io for all Holly trade symbols.

New tables:
  1. polygon_short_interest — bi-monthly short interest (shares short,
     days to cover, avg daily volume) per FINRA settlement date.
  2. polygon_short_volume  — daily short volume breakdown (total volume,
     short volume, short volume ratio, venue-level splits).

Both are joined to trades by symbol + most-recent-date-before-entry.

Endpoints:
  - /stocks/v1/short-interest?ticker=X&limit=50000
  - /stocks/v1/short-volume?ticker=X&limit=50000

Usage:
    python scripts/89_fetch_polygon_shorts.py
    python scripts/89_fetch_polygon_shorts.py --refresh
    python scripts/89_fetch_polygon_shorts.py --volume-only
    python scripts/89_fetch_polygon_shorts.py --interest-only
"""

import argparse
import json
import sys
import time
from pathlib import Path

import duckdb
import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DATA_DIR, DUCKDB_PATH

POLYGON_API_KEY = None
REF_DIR = DATA_DIR / "reference"
SHORT_DIR = REF_DIR / "shorts"

BASE_URL = "https://api.polygon.io"
RATE_LIMIT_SLEEP = 0.15  # ~6-7 req/sec to stay safe


def get_api_key() -> str:
    """Load Polygon API key from env."""
    global POLYGON_API_KEY
    if POLYGON_API_KEY:
        return POLYGON_API_KEY

    import os
    from dotenv import load_dotenv

    # Try project .env first, then analytics .env
    for env_path in [
        Path(__file__).parent.parent / ".env",
        Path(__file__).parent.parent.parent.parent / ".env",
    ]:
        if env_path.exists():
            load_dotenv(env_path)

    POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")
    if not POLYGON_API_KEY:
        raise ValueError("POLYGON_API_KEY not found in environment")
    return POLYGON_API_KEY


def fetch_paginated(url: str, params: dict, max_pages: int = 200) -> list:
    """Fetch all pages from a Polygon paginated endpoint."""
    all_results = []
    api_key = get_api_key()
    params["apiKey"] = api_key

    for page in range(max_pages):
        try:
            resp = requests.get(url, params=params, timeout=30)
            if resp.status_code == 429:
                print("    Rate limited, sleeping 60s...")
                time.sleep(60)
                resp = requests.get(url, params=params, timeout=30)

            if resp.status_code != 200:
                print(f"    HTTP {resp.status_code}: {resp.text[:200]}")
                break

            data = resp.json()
            results = data.get("results", [])
            all_results.extend(results)

            # Check for next page
            next_url = data.get("next_url")
            if not next_url or not results:
                break

            # Next page uses full URL with cursor
            url = next_url
            params = {"apiKey": api_key}
            time.sleep(RATE_LIMIT_SLEEP)

        except Exception as e:
            print(f"    Error: {e}")
            break

    return all_results


def fetch_short_interest(symbols: list, refresh: bool = False) -> Path:
    """Fetch bi-monthly short interest for all trade symbols."""
    out_file = SHORT_DIR / "short_interest.parquet"

    if out_file.exists() and not refresh:
        df = pd.read_parquet(out_file)
        print(f"  Cached: short_interest ({len(df):,} rows)")
        return out_file

    SHORT_DIR.mkdir(parents=True, exist_ok=True)

    # Process symbols in batches
    batch_size = 30
    all_data = []
    total_batches = (len(symbols) + batch_size - 1) // batch_size

    print(f"  Fetching short interest for {len(symbols):,} symbols "
          f"in {total_batches} batches...")

    for i in range(0, len(symbols), batch_size):
        batch = symbols[i:i + batch_size]
        batch_num = i // batch_size + 1

        # Use ticker.any_of for batch query
        ticker_filter = ",".join(batch)

        results = fetch_paginated(
            f"{BASE_URL}/stocks/v1/short-interest",
            {
                "ticker.any_of": ticker_filter,
                "settlement_date.gte": "2015-01-01",
                "limit": 50000,
                "sort": "settlement_date",
                "order": "asc",
            },
        )

        all_data.extend(results)

        if batch_num % 20 == 0 or batch_num == total_batches:
            print(f"    Batch {batch_num}/{total_batches}: "
                  f"{len(all_data):,} records total")

        time.sleep(RATE_LIMIT_SLEEP)

    if not all_data:
        print("  WARNING: No short interest data fetched")
        return out_file

    df = pd.DataFrame(all_data)
    # Keep only relevant columns
    keep_cols = [
        "ticker", "settlement_date", "short_interest",
        "avg_daily_volume", "days_to_cover",
    ]
    df = df[[c for c in keep_cols if c in df.columns]]
    df["settlement_date"] = pd.to_datetime(df["settlement_date"])

    df.to_parquet(out_file, index=False)
    print(f"  Saved: {len(df):,} short interest records -> {out_file.name}")

    # Summary
    n_syms = df["ticker"].nunique()
    min_d = df["settlement_date"].min()
    max_d = df["settlement_date"].max()
    print(f"    {n_syms:,} symbols, {min_d.date()} to {max_d.date()}")

    return out_file


def fetch_short_volume(symbols: list, refresh: bool = False) -> Path:
    """Fetch daily short volume for all trade symbols."""
    out_file = SHORT_DIR / "short_volume.parquet"

    if out_file.exists() and not refresh:
        df = pd.read_parquet(out_file)
        print(f"  Cached: short_volume ({len(df):,} rows)")
        return out_file

    SHORT_DIR.mkdir(parents=True, exist_ok=True)

    # Short volume is daily — much more data. Batch by symbol groups.
    batch_size = 20
    all_data = []
    total_batches = (len(symbols) + batch_size - 1) // batch_size

    print(f"  Fetching short volume for {len(symbols):,} symbols "
          f"in {total_batches} batches...")

    for i in range(0, len(symbols), batch_size):
        batch = symbols[i:i + batch_size]
        batch_num = i // batch_size + 1

        ticker_filter = ",".join(batch)

        results = fetch_paginated(
            f"{BASE_URL}/stocks/v1/short-volume",
            {
                "ticker.any_of": ticker_filter,
                "date.gte": "2015-01-01",
                "limit": 50000,
                "sort": "date",
                "order": "asc",
            },
        )

        all_data.extend(results)

        if batch_num % 20 == 0 or batch_num == total_batches:
            print(f"    Batch {batch_num}/{total_batches}: "
                  f"{len(all_data):,} records total")

        # Save checkpoint every 100 batches
        if batch_num % 100 == 0 and all_data:
            checkpoint = SHORT_DIR / "short_volume_checkpoint.parquet"
            pd.DataFrame(all_data).to_parquet(checkpoint, index=False)
            print(f"    Checkpoint saved: {len(all_data):,} records")

        time.sleep(RATE_LIMIT_SLEEP)

    if not all_data:
        print("  WARNING: No short volume data fetched")
        return out_file

    df = pd.DataFrame(all_data)
    # Keep core columns (skip venue-level breakdowns to save space)
    keep_cols = [
        "ticker", "date", "total_volume", "short_volume",
        "exempt_volume", "non_exempt_volume", "short_volume_ratio",
    ]
    df = df[[c for c in keep_cols if c in df.columns]]
    df["date"] = pd.to_datetime(df["date"])

    df.to_parquet(out_file, index=False)
    print(f"  Saved: {len(df):,} short volume records -> {out_file.name}")

    # Clean up checkpoint
    checkpoint = SHORT_DIR / "short_volume_checkpoint.parquet"
    if checkpoint.exists():
        checkpoint.unlink()

    n_syms = df["ticker"].nunique()
    min_d = df["date"].min()
    max_d = df["date"].max()
    print(f"    {n_syms:,} symbols, {min_d.date()} to {max_d.date()}")

    return out_file


def load_to_duckdb(con: duckdb.DuckDBPyConnection):
    """Load short data into DuckDB + build trade-joined views."""
    print("\nLoading short data into DuckDB...")

    # Load short interest
    si_file = SHORT_DIR / "short_interest.parquet"
    if si_file.exists():
        con.execute("DROP TABLE IF EXISTS polygon_short_interest")
        con.execute(f"""
            CREATE TABLE polygon_short_interest AS
            SELECT
                ticker AS symbol,
                CAST(settlement_date AS DATE) AS settlement_date,
                CAST(short_interest AS BIGINT) AS short_interest,
                CAST(avg_daily_volume AS BIGINT) AS avg_daily_volume,
                CAST(days_to_cover AS DOUBLE) AS days_to_cover
            FROM read_parquet('{si_file}')
        """)
        cnt = con.execute(
            "SELECT COUNT(*) FROM polygon_short_interest"
        ).fetchone()[0]
        n_syms = con.execute(
            "SELECT COUNT(DISTINCT symbol) FROM polygon_short_interest"
        ).fetchone()[0]
        min_d, max_d = con.execute(
            "SELECT MIN(settlement_date), MAX(settlement_date) "
            "FROM polygon_short_interest"
        ).fetchone()
        print(f"  polygon_short_interest: {cnt:,} rows, "
              f"{n_syms:,} symbols ({min_d} to {max_d})")

    # Load short volume
    sv_file = SHORT_DIR / "short_volume.parquet"
    if sv_file.exists():
        con.execute("DROP TABLE IF EXISTS polygon_short_volume")
        con.execute(f"""
            CREATE TABLE polygon_short_volume AS
            SELECT
                ticker AS symbol,
                CAST(date AS DATE) AS date,
                CAST(total_volume AS BIGINT) AS total_volume,
                CAST(short_volume AS BIGINT) AS short_volume,
                CAST(short_volume_ratio AS DOUBLE) AS short_volume_ratio
            FROM read_parquet('{sv_file}')
        """)
        cnt = con.execute(
            "SELECT COUNT(*) FROM polygon_short_volume"
        ).fetchone()[0]
        n_syms = con.execute(
            "SELECT COUNT(DISTINCT symbol) FROM polygon_short_volume"
        ).fetchone()[0]
        min_d, max_d = con.execute(
            "SELECT MIN(date), MAX(date) FROM polygon_short_volume"
        ).fetchone()
        print(f"  polygon_short_volume: {cnt:,} rows, "
              f"{n_syms:,} symbols ({min_d} to {max_d})")

    # Check which tables exist
    tables = [r[0] for r in con.execute(
        "SELECT table_name FROM information_schema.tables"
    ).fetchall()]
    has_si = "polygon_short_interest" in tables
    has_sv = "polygon_short_volume" in tables

    # Build trade-level short features
    print("\n  Building trade-level short features...")
    con.execute("DROP TABLE IF EXISTS trade_short_features")

    # Build CTE parts conditionally
    sv_ctes = ""
    sv_selects = """
            NULL::BIGINT AS short_volume,
            NULL::BIGINT AS sv_total_volume,
            NULL::DOUBLE AS short_volume_ratio,
            NULL::DOUBLE AS short_vol_ratio_5d,
            NULL::DOUBLE AS short_vol_ratio_5d_std,
            NULL::DOUBLE AS short_vol_ratio_rel,"""
    sv_joins = ""

    if has_sv:
        sv_ctes = """
        -- Prior day short volume
        sv_prior AS (
            SELECT
                t.trade_id,
                sv.short_volume,
                sv.total_volume AS sv_total_volume,
                sv.short_volume_ratio,
                sv.date AS sv_date,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id
                    ORDER BY sv.date DESC
                ) AS rn
            FROM trade_dates t
            JOIN polygon_short_volume sv
                ON sv.symbol = t.symbol
                AND sv.date < t.trade_date
                AND sv.date >= t.trade_date - INTERVAL 5 DAY
        ),
        -- 5-day avg short volume ratio
        sv_5d AS (
            SELECT
                t.trade_id,
                AVG(sv.short_volume_ratio) AS short_vol_ratio_5d,
                STDDEV(sv.short_volume_ratio) AS short_vol_ratio_5d_std
            FROM trade_dates t
            JOIN polygon_short_volume sv
                ON sv.symbol = t.symbol
                AND sv.date < t.trade_date
                AND sv.date >= t.trade_date - INTERVAL 10 DAY
            GROUP BY t.trade_id
        ),"""
        sv_selects = """
            sv.short_volume,
            sv.sv_total_volume,
            sv.short_volume_ratio,
            sv5.short_vol_ratio_5d,
            sv5.short_vol_ratio_5d_std,
            CASE
                WHEN sv5.short_vol_ratio_5d > 0
                THEN sv.short_volume_ratio / sv5.short_vol_ratio_5d
                ELSE NULL
            END AS short_vol_ratio_rel,"""
        sv_joins = """
        LEFT JOIN sv_prior sv ON sv.trade_id = td.trade_id AND sv.rn = 1
        LEFT JOIN sv_5d sv5 ON sv5.trade_id = td.trade_id"""

    query = f"""
        CREATE TABLE trade_short_features AS
        WITH trade_dates AS (
            SELECT
                trade_id,
                symbol,
                CAST(entry_time AS DATE) AS trade_date
            FROM trades
        ),
        -- Most recent short interest before each trade
        si_latest AS (
            SELECT
                t.trade_id,
                si.short_interest,
                si.avg_daily_volume AS si_avg_daily_volume,
                si.days_to_cover,
                si.settlement_date,
                t.trade_date - si.settlement_date AS si_staleness_days,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id
                    ORDER BY si.settlement_date DESC
                ) AS rn
            FROM trade_dates t
            JOIN polygon_short_interest si
                ON si.symbol = t.symbol
                AND si.settlement_date <= t.trade_date
                AND si.settlement_date >= t.trade_date - INTERVAL 60 DAY
        ),
        {sv_ctes}
        dummy AS (SELECT 1)
        SELECT
            td.trade_id,
            td.symbol,
            td.trade_date,
            -- Short interest features
            si.short_interest,
            si.si_avg_daily_volume,
            si.days_to_cover,
            si.si_staleness_days,
            -- Short volume features
            {sv_selects}
            -- Short squeeze potential
            CASE
                WHEN si.days_to_cover > 5.0 THEN 'high'
                WHEN si.days_to_cover > 2.5 THEN 'moderate'
                WHEN si.days_to_cover > 1.0 THEN 'normal'
                ELSE 'low'
            END AS short_squeeze_regime
        FROM trade_dates td
        LEFT JOIN si_latest si ON si.trade_id = td.trade_id AND si.rn = 1
        {sv_joins}
    """
    con.execute(query)

    cnt = con.execute("SELECT COUNT(*) FROM trade_short_features").fetchone()[0]
    coverage = con.execute("""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN short_interest IS NOT NULL THEN 1 ELSE 0 END) AS has_si,
            SUM(CASE WHEN short_volume_ratio IS NOT NULL THEN 1 ELSE 0 END) AS has_sv
        FROM trade_short_features
    """).fetchone()
    print(f"  trade_short_features: {cnt:,} rows")
    print(f"    Short interest coverage: "
          f"{coverage[1]:,}/{coverage[0]:,} "
          f"({100*coverage[1]/coverage[0]:.1f}%)")
    print(f"    Short volume coverage: "
          f"{coverage[2]:,}/{coverage[0]:,} "
          f"({100*coverage[2]/coverage[0]:.1f}%)")


def main():
    parser = argparse.ArgumentParser(
        description="Fetch Polygon short interest + volume data"
    )
    parser.add_argument(
        "--refresh", action="store_true",
        help="Re-download all data even if cached",
    )
    parser.add_argument(
        "--interest-only", action="store_true",
        help="Only fetch short interest (bi-monthly)",
    )
    parser.add_argument(
        "--volume-only", action="store_true",
        help="Only fetch short volume (daily)",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("Polygon Short Interest + Volume Fetch")
    print("=" * 60)

    t0 = time.time()

    # Get unique trade symbols
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    symbols = con.execute(
        "SELECT DISTINCT symbol FROM trades ORDER BY symbol"
    ).fetchdf()["symbol"].tolist()
    con.close()
    print(f"  {len(symbols):,} unique trade symbols")

    # Fetch data
    do_interest = not args.volume_only
    do_volume = not args.interest_only

    if do_interest:
        fetch_short_interest(symbols, refresh=args.refresh)

    if do_volume:
        fetch_short_volume(symbols, refresh=args.refresh)

    # Load into DuckDB
    con = duckdb.connect(str(DUCKDB_PATH))
    load_to_duckdb(con)
    con.close()

    elapsed = time.time() - t0
    print(f"\nPolygon shorts fetch complete in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
