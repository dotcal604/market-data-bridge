"""
51_fetch_short_volume.py -- Fetch short volume data via Massive.com API.

Per symbol x trade date: for each Holly-traded symbol on each trade date,
fetches short volume in a 5-day lookback window (trade_date-5d to trade_date).
Includes short_volume, total_volume, short_volume_ratio, exempt and non-exempt.

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/51_fetch_short_volume.py
    python scripts/51_fetch_short_volume.py --smoke
    python scripts/51_fetch_short_volume.py --since 2021-01-01
    python scripts/51_fetch_short_volume.py --limit-dates 10
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

from config.settings import POLYGON_API_KEY, DATA_DIR, DUCKDB_PATH, POLYGON_CONCURRENCY

MASSIVE_BASE = "https://api.massive.com"
REF_DIR = DATA_DIR / "reference"
PROGRESS_FILE = REF_DIR / "short_volume_progress.json"
OUT_FILE = REF_DIR / "massive_short_volume.parquet"

SEMAPHORE = asyncio.Semaphore(POLYGON_CONCURRENCY if POLYGON_CONCURRENCY else 10)


def load_progress() -> set[str]:
    """Load set of completed date keys (YYYY-MM-DD strings)."""
    if PROGRESS_FILE.exists():
        data = json.loads(PROGRESS_FILE.read_text())
        return set(data.get("completed_dates", []))
    return set()


def save_progress(completed: set[str]):
    """Persist completed dates."""
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(json.dumps({
        "completed_dates": sorted(completed),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2))


def load_trade_date_manifest(since: str | None = None) -> list[tuple[date, list[str]]]:
    """Load Holly trades from DuckDB, group by trade date -> unique symbol list."""
    import duckdb

    db = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    where = "WHERE CAST(entry_time AS DATE) >= '2021-01-01'"
    if since:
        where = f"WHERE CAST(entry_time AS DATE) >= '{since}'"

    rows = db.execute(f"""
        SELECT
            CAST(entry_time AS DATE) AS trade_date,
            LIST(DISTINCT symbol ORDER BY symbol) AS symbols
        FROM trades
        {where}
        GROUP BY trade_date
        ORDER BY trade_date
    """).fetchall()

    db.close()
    return [(r[0], r[1]) for r in rows]


async def fetch_short_volume_for_symbol(
    client: httpx.AsyncClient,
    symbol: str,
    trade_date: date,
) -> list[dict]:
    """
    Fetch short volume for a single symbol in a 5-day lookback window.
    Follows next_url pagination until exhausted.
    """
    date_gte = (trade_date - timedelta(days=5)).isoformat()
    date_lte = trade_date.isoformat()

    url = f"{MASSIVE_BASE}/stocks/v1/short-volume"
    params = {
        "ticker": symbol,
        "date.gte": date_gte,
        "date.lte": date_lte,
        "limit": "50000",
        "sort": "date.desc",
        "apiKey": POLYGON_API_KEY,
    }

    all_records: list[dict] = []
    use_params = True
    current_url: str | None = url

    async with SEMAPHORE:
        while current_url:
            for attempt in range(3):
                try:
                    if use_params:
                        resp = await client.get(current_url, params=params, timeout=15)
                        use_params = False
                    else:
                        resp = await client.get(current_url, timeout=15)

                    if resp.status_code == 429:
                        await asyncio.sleep(2 ** (attempt + 1))
                        continue

                    if resp.status_code in (403, 404):
                        return all_records

                    if resp.status_code != 200:
                        return all_records

                    data = resp.json()
                    results = data.get("results", [])

                    now_iso = datetime.now(timezone.utc).isoformat()
                    for rec in results:
                        all_records.append({
                            "ticker": symbol,
                            "date": rec.get("date"),
                            "short_volume": rec.get("short_volume"),
                            "total_volume": rec.get("total_volume"),
                            "short_volume_ratio": rec.get("short_volume_ratio"),
                            "exempt_volume": rec.get("exempt_volume"),
                            "non_exempt_volume": rec.get("non_exempt_volume"),
                            "fetched_at": now_iso,
                            "request_date": trade_date.isoformat(),
                        })

                    next_url = data.get("next_url")
                    if next_url:
                        current_url = f"{next_url}&apiKey={POLYGON_API_KEY}"
                    else:
                        current_url = None
                    break

                except (httpx.TimeoutException, httpx.ConnectError):
                    if attempt < 2:
                        await asyncio.sleep(2 ** (attempt + 1))
                        continue
                    return all_records

    return all_records


async def main_async(args):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading Holly trade date manifest from DuckDB...")
    manifest = load_trade_date_manifest(since=args.since)
    print(f"  Total trade dates: {len(manifest)}")

    if not manifest:
        print("No trade dates found!")
        return

    if args.smoke:
        manifest = manifest[:1]
        print(f"\n  SMOKE TEST: fetching only {manifest[0][0]} ({len(manifest[0][1])} symbols)")

    if args.limit_dates:
        manifest = manifest[:args.limit_dates]
        print(f"  Limited to first {args.limit_dates} dates")

    # Load progress to skip completed dates
    completed = load_progress()
    remaining = [(d, s) for d, s in manifest if d.isoformat() not in completed]
    print(f"  Already completed: {len(completed)}")
    print(f"  Remaining: {len(remaining)}")

    if not remaining:
        print("All trade dates already fetched!")
        if OUT_FILE.exists():
            load_to_duckdb(OUT_FILE)
        return

    # Load existing data for merge
    all_rows: list[dict] = []
    if OUT_FILE.exists():
        existing_df = pd.read_parquet(OUT_FILE)
        all_rows = existing_df.to_dict("records")
        print(f"  Existing short volume records: {len(all_rows):,}")

    print(f"\n{'=' * 60}")
    print("Fetching short volume data from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()
    new_records = 0
    failed = 0

    async with httpx.AsyncClient() as client:
        for i, (trade_date, symbols) in enumerate(remaining):
            # Fetch all symbols for this date concurrently via semaphore
            tasks = [
                fetch_short_volume_for_symbol(client, sym, trade_date)
                for sym in symbols
            ]
            results = await asyncio.gather(*tasks)

            date_new = 0
            for sym, records in zip(symbols, results):
                if records:
                    all_rows.extend(records)
                    date_new += len(records)
                else:
                    failed += 1

            new_records += date_new
            completed.add(trade_date.isoformat())

            elapsed = time.time() - t0
            pct = (i + 1) / len(remaining) * 100
            if (i + 1) % 25 == 0 or i == 0 or (i + 1) == len(remaining):
                print(
                    f"  [{i+1}/{len(remaining)}] {trade_date} "
                    f"| {len(symbols)} syms | +{date_new} records "
                    f"| total: {len(all_rows):,} | {pct:.0f}% | {elapsed:.0f}s"
                )

            if (i + 1) % 50 == 0:
                save_progress(completed)

    save_progress(completed)

    if not all_rows:
        print("No short volume data fetched!")
        return

    df = pd.DataFrame(all_rows)

    before = len(df)
    df = df.drop_duplicates(
        subset=["ticker", "date"], keep="last"
    ).reset_index(drop=True)
    final_dupes = before - len(df)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Short volume fetch complete!")
    print(f"{'=' * 60}")
    print(f"  New records this run: {new_records:,}")
    print(f"  Empty/failed: {failed:,}")
    print(f"  Dupes removed: {final_dupes:,}")
    print(f"  Total unique records: {len(df):,}")
    print(f"  File size: {OUT_FILE.stat().st_size / 1e6:.1f} MB")
    print(f"  Trade dates completed: {len(completed)}/{len(manifest)}")
    print(f"  Elapsed: {elapsed / 60:.1f} min")

    if not df.empty:
        unique_tickers = df["ticker"].nunique()
        print(f"  Unique tickers: {unique_tickers:,}")
        has_ratio = df["short_volume_ratio"].notna().sum()
        print(f"  Records with short_volume_ratio: {has_ratio:,} ({has_ratio/len(df)*100:.0f}%)")

    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    """Load short volume data into DuckDB."""
    import duckdb

    if not parquet_file.exists():
        print("  No parquet file to load")
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")

    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS massive_short_volume")
    con.execute(f"""
        CREATE TABLE massive_short_volume AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)

    cnt = con.execute("SELECT COUNT(*) FROM massive_short_volume").fetchone()[0]
    unique_tickers = con.execute(
        "SELECT COUNT(DISTINCT ticker) FROM massive_short_volume"
    ).fetchone()[0]
    unique_dates = con.execute(
        "SELECT COUNT(DISTINCT date) FROM massive_short_volume"
    ).fetchone()[0]
    print(f"  massive_short_volume: {cnt:,} rows, {unique_tickers:,} tickers, {unique_dates:,} dates")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch short volume data via Massive.com for Holly trade dates"
    )
    parser.add_argument(
        "--smoke", action="store_true",
        help="Smoke test: fetch only the first trade date"
    )
    parser.add_argument(
        "--since", default=None,
        help="Earliest trade date (YYYY-MM-DD, default: 2021-01-01)"
    )
    parser.add_argument(
        "--limit-dates", type=int, default=None,
        help="Limit to first N trade dates (for testing)"
    )
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
