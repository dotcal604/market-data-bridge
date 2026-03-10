"""
Script 78 -- Fetch Benzinga Analyst Ratings, Earnings & Guidance
================================================================
Fetches structured data from three Massive.com Benzinga endpoints:

1. /benzinga/v1/ratings — Analyst ratings (upgrades, downgrades, price targets)
2. /benzinga/v1/earnings — Earnings announcements (EPS, revenue, surprise %)
3. /benzinga/v1/guidance — Corporate guidance (EPS/revenue guidance ranges)

All three use the same auth (POLYGON_API_KEY), same pagination (next_url),
and same date-based filtering. Fetches month-by-month across full date range.

Output: Parquet files in data/reference/ + DuckDB tables.

Usage:
    python scripts/78_fetch_benzinga_ratings_earnings.py              # All 3
    python scripts/78_fetch_benzinga_ratings_earnings.py --type ratings
    python scripts/78_fetch_benzinga_ratings_earnings.py --type earnings
    python scripts/78_fetch_benzinga_ratings_earnings.py --type guidance
    python scripts/78_fetch_benzinga_ratings_earnings.py --smoke       # 1 month test
    python scripts/78_fetch_benzinga_ratings_earnings.py --since 2024-01-01
"""

import argparse
import asyncio
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import POLYGON_API_KEY, DATA_DIR, DUCKDB_PATH

MASSIVE_BASE = "https://api.massive.com"
REF_DIR = DATA_DIR / "reference"

# Endpoint configs
ENDPOINTS = {
    "ratings": {
        "path": "/benzinga/v1/ratings",
        "parquet": "benzinga_ratings.parquet",
        "progress": "benzinga_ratings_progress.json",
        "table": "benzinga_ratings",
        "date_param": "date",
        "id_field": "benzinga_id",
    },
    "earnings": {
        "path": "/benzinga/v1/earnings",
        "parquet": "benzinga_earnings.parquet",
        "progress": "benzinga_earnings_progress.json",
        "table": "benzinga_earnings",
        "date_param": "date",
        "id_field": "benzinga_id",
    },
    "guidance": {
        "path": "/benzinga/v1/guidance",
        "parquet": "benzinga_guidance.parquet",
        "progress": "benzinga_guidance_progress.json",
        "table": "benzinga_guidance",
        "date_param": "date",
        "id_field": "benzinga_id",
    },
}


def load_progress(progress_file: Path) -> dict:
    if progress_file.exists():
        return json.loads(progress_file.read_text())
    return {"completed_months": [], "total_records": 0}


def save_progress(progress_file: Path, state: dict):
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    progress_file.parent.mkdir(parents=True, exist_ok=True)
    progress_file.write_text(json.dumps(state, indent=2))


def get_months(since: str = "2016-01-01", until: str | None = None) -> list[str]:
    """Generate YYYY-MM strings for each month in range."""
    start = date.fromisoformat(since)
    end = date.fromisoformat(until) if until else date.today()
    months = []
    current = start.replace(day=1)
    while current <= end:
        months.append(current.strftime("%Y-%m"))
        # Move to next month
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1)
        else:
            current = current.replace(month=current.month + 1)
    return months


def month_date_range(month_str: str) -> tuple[str, str]:
    """Return (first_day, first_day_next_month) for a YYYY-MM string."""
    y, m = month_str.split("-")
    y, m = int(y), int(m)
    start = date(y, m, 1)
    if m == 12:
        end = date(y + 1, 1, 1)
    else:
        end = date(y, m + 1, 1)
    return start.isoformat(), end.isoformat()


async def fetch_month(
    client: httpx.AsyncClient,
    endpoint_path: str,
    date_param: str,
    month_str: str,
) -> list[dict]:
    """Fetch all records for a single month from a Benzinga endpoint."""
    date_gte, date_lt = month_date_range(month_str)

    all_records = []
    params: list[tuple[str, str]] = [
        (f"{date_param}.gte", date_gte),
        (f"{date_param}.lt", date_lt),
        ("sort", f"{date_param}.asc"),
        ("limit", "50000"),
        ("apiKey", POLYGON_API_KEY),
    ]

    url: str | None = f"{MASSIVE_BASE}{endpoint_path}"
    use_params = True

    while url:
        for attempt in range(3):
            try:
                if use_params:
                    resp = await client.get(url, params=params, timeout=30)
                    use_params = False
                else:
                    resp = await client.get(url, timeout=30)

                if resp.status_code == 429:
                    wait = 2 ** (attempt + 1)
                    await asyncio.sleep(wait)
                    continue

                if resp.status_code == 403:
                    print(f"    ERROR: 403 Forbidden -- check Massive subscription")
                    return all_records

                if resp.status_code != 200:
                    print(f"    ERROR: HTTP {resp.status_code} for {month_str}")
                    url = None
                    break

                data = resp.json()
                results = data.get("results", [])
                all_records.extend(results)

                next_url = data.get("next_url")
                if next_url:
                    url = f"{next_url}&apiKey={POLYGON_API_KEY}"
                else:
                    url = None
                break

            except (httpx.TimeoutException, httpx.ConnectError) as e:
                if attempt < 2:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                print(f"    FAILED after 3 retries on {month_str}: {e}")
                url = None
                break

    return all_records


def flatten_record(record: dict, endpoint_type: str) -> dict:
    """Flatten a record, handling nested fields."""
    flat = {}
    for key, val in record.items():
        if isinstance(val, (list, dict)):
            flat[key] = json.dumps(val) if val else None
        else:
            flat[key] = val
    flat["_fetched_at"] = datetime.now(timezone.utc).isoformat()
    return flat


async def fetch_endpoint(args, endpoint_type: str):
    """Fetch all data for a single endpoint type."""
    config = ENDPOINTS[endpoint_type]

    parquet_path = REF_DIR / config["parquet"]
    progress_path = REF_DIR / config["progress"]

    print(f"\n{'=' * 60}")
    print(f"Fetching: {endpoint_type} ({config['path']})")
    print("=" * 60)

    # Generate months
    since = args.since or "2016-01-01"
    months = get_months(since=since)
    print(f"Total months: {len(months)} ({months[0]} to {months[-1]})")

    if args.smoke:
        months = months[-1:]
        print(f"SMOKE TEST: fetching only {months[0]}")

    # Load progress
    state = load_progress(progress_path)
    completed = set(state.get("completed_months", []))
    remaining = [m for m in months if m not in completed]
    print(f"Already completed: {len(completed)}")
    print(f"Remaining: {len(remaining)}")

    if not remaining:
        print("All months already fetched!")
        if parquet_path.exists():
            load_to_duckdb(parquet_path, config["table"])
        return

    # Load existing records for dedup
    existing_ids: set[str] = set()
    all_rows: list[dict] = []
    if parquet_path.exists():
        existing_df = pd.read_parquet(parquet_path)
        id_field = config["id_field"]
        if id_field in existing_df.columns:
            existing_ids = set(existing_df[id_field].dropna().astype(str))
        all_rows = existing_df.to_dict("records")
        print(f"Existing records: {len(existing_ids):,}")

    t0 = time.time()
    new_records = 0
    dupes_skipped = 0

    async with httpx.AsyncClient() as client:
        for i, month in enumerate(remaining):
            records = await fetch_month(
                client, config["path"], config["date_param"], month
            )

            month_new = 0
            id_field = config["id_field"]
            for rec in records:
                rid = str(rec.get(id_field, ""))
                if rid and rid in existing_ids:
                    dupes_skipped += 1
                    continue
                row = flatten_record(rec, endpoint_type)
                all_rows.append(row)
                if rid:
                    existing_ids.add(rid)
                month_new += 1

            new_records += month_new
            completed.add(month)

            elapsed = time.time() - t0
            pct = (i + 1) / len(remaining) * 100
            if (i + 1) % 10 == 0 or i == 0 or (i + 1) == len(remaining):
                print(
                    f"  [{i+1}/{len(remaining)}] {month} "
                    f"| +{month_new} records | total: {len(all_rows):,} "
                    f"| {pct:.0f}% | {elapsed:.0f}s"
                )

            # Save progress every 20 months
            if (i + 1) % 20 == 0:
                state["completed_months"] = sorted(completed)
                state["total_records"] = len(all_rows)
                save_progress(progress_path, state)

            await asyncio.sleep(0.3)

    # Final save
    state["completed_months"] = sorted(completed)
    state["total_records"] = len(all_rows)
    save_progress(progress_path, state)

    if not all_rows:
        print(f"No {endpoint_type} records fetched!")
        return

    # Write parquet
    df = pd.DataFrame(all_rows)
    id_field = config["id_field"]
    if id_field in df.columns:
        before = len(df)
        df = df.drop_duplicates(subset=[id_field], keep="last").reset_index(drop=True)
        final_dupes = before - len(df)
    else:
        final_dupes = 0

    pq.write_table(pa.Table.from_pandas(df), str(parquet_path), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n  {endpoint_type} fetch complete!")
    print(f"  New records: {new_records:,}")
    print(f"  Dupes skipped: {dupes_skipped + final_dupes:,}")
    print(f"  Total unique: {len(df):,}")
    print(f"  File: {parquet_path.name} ({parquet_path.stat().st_size / 1e6:.1f} MB)")
    print(f"  Elapsed: {elapsed:.0f}s")

    if "ticker" in df.columns:
        print(f"  Unique tickers: {df['ticker'].nunique():,}")
    if "date" in df.columns:
        print(f"  Date range: {df['date'].min()} to {df['date'].max()}")

    # Load to DuckDB
    load_to_duckdb(parquet_path, config["table"])


def load_to_duckdb(parquet_file: Path, table_name: str):
    """Load parquet into DuckDB."""
    import duckdb

    if not parquet_file.exists():
        return

    print(f"\n  Loading into DuckDB ({DUCKDB_PATH.name}) as {table_name}...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute(f"DROP TABLE IF EXISTS {table_name}")
    con.execute(f"""
        CREATE TABLE {table_name} AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)
    cnt = con.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
    print(f"  {table_name}: {cnt:,} rows")
    con.close()


async def main_async(args):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    types = args.type if args.type else ["ratings", "earnings", "guidance"]
    if isinstance(types, str):
        types = [types]

    for etype in types:
        await fetch_endpoint(args, etype)

    print(f"\n{'=' * 60}")
    print("All fetches complete!")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="Fetch Benzinga ratings, earnings & guidance via Massive.com"
    )
    parser.add_argument(
        "--type", choices=["ratings", "earnings", "guidance"],
        help="Fetch only this type (default: all three)"
    )
    parser.add_argument(
        "--smoke", action="store_true",
        help="Smoke test: fetch only most recent month"
    )
    parser.add_argument(
        "--since", default=None,
        help="Start date (YYYY-MM-DD, default: 2016-01-01)"
    )
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
