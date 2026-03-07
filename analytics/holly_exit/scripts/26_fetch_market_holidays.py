"""
26_fetch_market_holidays.py — Fetch market holidays + build historical calendar.

Two data sources:
  1. Polygon /v1/marketstatus/upcoming — upcoming holidays with names + early-close info
  2. DuckDB daily_bars_flat — derive historical holidays from SPY trading day gaps

Produces:
  - market_holidays_upcoming (from Polygon API — names, status, open/close times)
  - market_holidays_historical (derived from SPY — all non-trading weekdays since 2015)

Usage:
    python scripts/26_fetch_market_holidays.py
    python scripts/26_fetch_market_holidays.py --refresh
"""

import argparse
import json
import sys
import time
from pathlib import Path

import duckdb
import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import POLYGON_API_KEY, DATA_DIR, DUCKDB_PATH

POLYGON_BASE = "https://api.polygon.io"
REF_DIR = DATA_DIR / "reference"

# Known US stock market holidays (for labeling historical gaps)
KNOWN_HOLIDAYS = {
    "New Year's Day": [(1, 1)],
    "Martin Luther King Jr. Day": [(1, "3rd_mon")],
    "Presidents' Day": [(2, "3rd_mon")],
    "Good Friday": [],  # Varies — derived from Easter
    "Memorial Day": [(5, "last_mon")],
    "Juneteenth": [(6, 19)],  # Since 2022
    "Independence Day": [(7, 4)],
    "Labor Day": [(9, "1st_mon")],
    "Thanksgiving": [(11, "4th_thu")],
    "Christmas": [(12, 25)],
}


def fetch_upcoming_holidays(refresh: bool = False) -> pd.DataFrame:
    """Fetch upcoming market holidays from Polygon API."""
    out_file = REF_DIR / "market_holidays_upcoming.parquet"

    if out_file.exists() and not refresh:
        df = pd.read_parquet(out_file)
        print(f"  Cached: {len(df):,} upcoming holidays -> {out_file.name}")
        return df

    print("=" * 60)
    print("Fetching upcoming market holidays from Polygon...")
    print("=" * 60)

    url = f"{POLYGON_BASE}/v1/marketstatus/upcoming"
    params = {"apiKey": POLYGON_API_KEY}

    try:
        resp = httpx.get(url, params=params, timeout=30)
        if resp.status_code != 200:
            print(f"  ERROR: HTTP {resp.status_code}")
            return pd.DataFrame()

        holidays = resp.json()
    except Exception as e:
        print(f"  ERROR: {e}")
        return pd.DataFrame()

    if not holidays:
        print("  No upcoming holidays returned!")
        return pd.DataFrame()

    # Normalize the response
    rows = []
    for h in holidays:
        rows.append({
            "date": h.get("date", ""),
            "exchange": h.get("exchange", ""),
            "name": h.get("name", ""),
            "status": h.get("status", ""),
            "open_time": h.get("open", ""),
            "close_time": h.get("close", ""),
        })

    df = pd.DataFrame(rows)

    REF_DIR.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pandas(df), str(out_file))

    print(f"  Saved: {len(df):,} upcoming holidays -> {out_file.name}")
    for _, row in df.iterrows():
        status_label = row["status"]
        if row["close_time"]:
            status_label += f" (close: {row['close_time']})"
        print(f"    {row['date']}  {row['name']:<30} {row['exchange']}  {status_label}")

    return df


def build_historical_holidays() -> pd.DataFrame:
    """Derive historical market holidays from SPY trading day gaps."""
    print("\n" + "=" * 60)
    print("Building historical holiday calendar from SPY gaps...")
    print("=" * 60)

    out_file = REF_DIR / "market_holidays_historical.parquet"

    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    # Check what table we have for daily bars
    tables = [r[0] for r in con.execute("SHOW TABLES").fetchall()]

    if "daily_bars_flat" in tables:
        daily_table = "daily_bars_flat"
        ticker_col = "ticker"
    elif "grouped_daily" in tables:
        daily_table = "grouped_daily"
        # Check column name
        cols = [r[0] for r in con.execute(f"DESCRIBE {daily_table}").fetchall()]
        ticker_col = "ticker" if "ticker" in cols else "symbol"
    else:
        print("  ERROR: No daily bars table found!")
        con.close()
        return pd.DataFrame()

    # Get all trading days from SPY
    result = con.execute(f"""
        WITH spy_days AS (
            SELECT DISTINCT CAST(bar_time AS DATE) AS td
            FROM {daily_table}
            WHERE {ticker_col} = 'SPY'
        ),
        -- Generate all weekdays in the range
        date_range AS (
            SELECT CAST(MIN(td) AS DATE) AS start_dt,
                   CAST(MAX(td) AS DATE) AS end_dt
            FROM spy_days
        ),
        all_days AS (
            SELECT CAST(dr.start_dt + (i * INTERVAL 1 DAY) AS DATE) AS dt
            FROM date_range dr, generate_series(0, 5000) t(i)
            WHERE CAST(dr.start_dt + (i * INTERVAL 1 DAY) AS DATE) <= dr.end_dt
        ),
        weekdays AS (
            SELECT dt FROM all_days
            WHERE EXTRACT(DOW FROM dt) BETWEEN 1 AND 5
        )
        -- Non-trading weekdays = holidays
        SELECT w.dt AS date,
               EXTRACT(MONTH FROM w.dt) AS month,
               EXTRACT(DAY FROM w.dt) AS day,
               EXTRACT(DOW FROM w.dt) AS dow,
               EXTRACT(YEAR FROM w.dt) AS year
        FROM weekdays w
        LEFT JOIN spy_days s ON s.td = w.dt
        WHERE s.td IS NULL
        ORDER BY w.dt
    """).fetchdf()

    con.close()

    if result.empty:
        print("  No holidays found!")
        return pd.DataFrame()

    # Try to label known holidays
    labels = []
    for _, row in result.iterrows():
        dt = pd.Timestamp(row["date"])
        m, d, dow = int(row["month"]), int(row["day"]), int(row["dow"])
        year = int(row["year"])
        label = "Unknown"

        # Fixed-date holidays (with observed day adjustment)
        if m == 1 and d <= 2:
            label = "New Year's Day"
        elif m == 12 and d >= 24 and d <= 26:
            label = "Christmas"
        elif m == 7 and d >= 3 and d <= 5:
            label = "Independence Day"
        elif m == 6 and d >= 18 and d <= 20 and year >= 2022:
            label = "Juneteenth"
        # Monday holidays (nth Monday of month)
        elif m == 1 and dow == 1 and 15 <= d <= 21:
            label = "MLK Jr. Day"
        elif m == 2 and dow == 1 and 15 <= d <= 21:
            label = "Presidents' Day"
        elif m == 5 and dow == 1 and d >= 25:
            label = "Memorial Day"
        elif m == 9 and dow == 1 and d <= 7:
            label = "Labor Day"
        # Thanksgiving (4th Thursday of November)
        elif m == 11 and dow == 4 and 22 <= d <= 28:
            label = "Thanksgiving"
        # Good Friday (varies — typically March/April, a Friday)
        elif m in (3, 4) and dow == 5:
            label = "Good Friday"
        # Day after Thanksgiving (often early close, sometimes full close)
        elif m == 11 and dow == 5 and 23 <= d <= 29:
            label = "Day After Thanksgiving"
        # Special closures
        elif m == 9 and year == 2022 and d == 19:
            label = "National Day of Mourning (Queen Elizabeth)"
        elif m == 12 and year == 2018 and d == 5:
            label = "National Day of Mourning (George H.W. Bush)"

        labels.append(label)

    result["holiday_name"] = labels
    result = result[["date", "year", "month", "day", "dow", "holiday_name"]]

    REF_DIR.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pandas(result), str(out_file))

    print(f"  Saved: {len(result):,} historical holidays -> {out_file.name}")
    print(f"  Date range: {result['date'].min()} to {result['date'].max()}")
    print(f"\n  Holiday breakdown:")
    for name, cnt in result["holiday_name"].value_counts().items():
        print(f"    {name:<35} {cnt:>3}")

    return result


def load_to_duckdb():
    """Load holiday tables into DuckDB."""
    print("\n" + "=" * 60)
    print("Loading market holidays into DuckDB...")
    print("=" * 60)

    con = duckdb.connect(str(DUCKDB_PATH))

    for table, filename in [
        ("market_holidays_upcoming", "market_holidays_upcoming.parquet"),
        ("market_holidays_historical", "market_holidays_historical.parquet"),
    ]:
        pf = REF_DIR / filename
        if not pf.exists():
            print(f"  {table}: no parquet file, skipping")
            continue

        con.execute(f"DROP TABLE IF EXISTS {table}")
        con.execute(f"""
            CREATE TABLE {table} AS
            SELECT * FROM read_parquet('{pf}')
        """)
        cnt = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table}: {cnt:,} rows")

    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch market holidays + build historical calendar"
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Re-fetch/rebuild even if cached",
    )
    args = parser.parse_args()

    if not POLYGON_API_KEY:
        print("WARNING: POLYGON_API_KEY not set — skipping API fetch")
        print("         Will still build historical calendar from DuckDB")
    else:
        fetch_upcoming_holidays(refresh=args.refresh)

    build_historical_holidays()
    load_to_duckdb()

    print("\n" + "=" * 60)
    print("Market holidays fetch complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
