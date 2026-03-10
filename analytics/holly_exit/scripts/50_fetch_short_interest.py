"""
50_fetch_short_interest.py -- Fetch short interest data via Massive.com API.

Per unique Holly symbol: fetches historical short interest including
short_interest shares, avg_daily_volume, and days_to_cover.

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/50_fetch_short_interest.py
    python scripts/50_fetch_short_interest.py --smoke
"""

import argparse
import asyncio
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import POLYGON_API_KEY, DATA_DIR, DUCKDB_PATH, POLYGON_CONCURRENCY

MASSIVE_BASE = "https://api.massive.com"
REF_DIR = DATA_DIR / "reference"
PROGRESS_FILE = REF_DIR / "short_interest_progress.json"
OUT_FILE = REF_DIR / "massive_short_interest.parquet"

SEMAPHORE = asyncio.Semaphore(POLYGON_CONCURRENCY if POLYGON_CONCURRENCY else 10)


def load_unique_symbols() -> list[str]:
    """Load all unique Holly-traded symbols from DuckDB."""
    import duckdb
    db = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    rows = db.execute("""
        SELECT DISTINCT symbol FROM trades
        WHERE CAST(entry_time AS DATE) >= '2021-01-01'
        ORDER BY symbol
    """).fetchall()
    db.close()
    return [r[0] for r in rows]


def load_progress() -> set[str]:
    """Load set of completed symbols."""
    if PROGRESS_FILE.exists():
        data = json.loads(PROGRESS_FILE.read_text())
        return set(data.get("completed_symbols", []))
    return set()


def save_progress(completed: set[str]):
    """Persist completed symbols."""
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(json.dumps({
        "completed_symbols": sorted(completed),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2))


async def fetch_short_interest_for_symbol(
    client: httpx.AsyncClient,
    symbol: str,
) -> list[dict]:
    """
    Fetch all short interest records for a single symbol.
    Follows next_url pagination until exhausted.
    """
    url = f"{MASSIVE_BASE}/stocks/v1/short-interest"
    params = {
        "ticker": symbol,
        "limit": "50000",
        "sort": "settlement_date.desc",
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
                            "settlement_date": rec.get("settlement_date"),
                            "short_interest": rec.get("short_interest"),
                            "avg_daily_volume": rec.get("avg_daily_volume"),
                            "days_to_cover": rec.get("days_to_cover"),
                            "fetched_at": now_iso,
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

    print("Loading unique Holly symbols from DuckDB...")
    symbols = load_unique_symbols()
    print(f"  Total unique symbols: {len(symbols)}")

    if not symbols:
        print("No symbols found!")
        return

    if args.smoke:
        symbols = symbols[:5]
        print(f"\n  SMOKE TEST: fetching only {len(symbols)} symbols")

    # Load progress to skip completed symbols
    completed = load_progress()

    # Load existing data for merge
    all_rows: list[dict] = []
    if OUT_FILE.exists():
        existing_df = pd.read_parquet(OUT_FILE)
        all_rows = existing_df.to_dict("records")
        print(f"  Existing short interest records: {len(all_rows):,}")

    remaining = [s for s in symbols if s not in completed]
    print(f"  Already completed: {len(completed):,}")
    print(f"  Remaining: {len(remaining)}")

    if not remaining:
        print("All symbols already fetched!")
        if OUT_FILE.exists():
            load_to_duckdb(OUT_FILE)
        return

    print(f"\n{'=' * 60}")
    print("Fetching short interest data from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()
    new_records = 0
    failed = 0

    async with httpx.AsyncClient() as client:
        batch_size = 50
        for batch_start in range(0, len(remaining), batch_size):
            batch = remaining[batch_start:batch_start + batch_size]
            tasks = [fetch_short_interest_for_symbol(client, sym) for sym in batch]
            results = await asyncio.gather(*tasks)

            for sym, records in zip(batch, results):
                if records:
                    all_rows.extend(records)
                    new_records += len(records)
                else:
                    failed += 1
                completed.add(sym)

            done = batch_start + len(batch)
            elapsed = time.time() - t0
            if done % 100 == 0 or done == len(remaining) or batch_start == 0:
                print(
                    f"  [{done}/{len(remaining)}] "
                    f"+{new_records:,} records | {failed} empty/failed "
                    f"| {elapsed:.0f}s"
                )

            if done % 500 == 0:
                save_progress(completed)

    save_progress(completed)

    if not all_rows:
        print("No short interest data fetched!")
        return

    df = pd.DataFrame(all_rows)

    before = len(df)
    df = df.drop_duplicates(
        subset=["ticker", "settlement_date"], keep="last"
    ).reset_index(drop=True)
    final_dupes = before - len(df)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Short interest fetch complete!")
    print(f"{'=' * 60}")
    print(f"  New records this run: {new_records:,}")
    print(f"  Empty/failed symbols: {failed:,}")
    print(f"  Dupes removed: {final_dupes:,}")
    print(f"  Total unique records: {len(df):,}")
    print(f"  File size: {OUT_FILE.stat().st_size / 1e6:.1f} MB")
    print(f"  Elapsed: {elapsed:.0f}s")

    if not df.empty:
        unique_tickers = df["ticker"].nunique()
        print(f"  Unique tickers: {unique_tickers:,}")
        has_dtc = df["days_to_cover"].notna().sum()
        print(f"  Records with days_to_cover: {has_dtc:,}")

    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    """Load short interest data into DuckDB."""
    import duckdb

    if not parquet_file.exists():
        print("  No parquet file to load")
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")

    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS massive_short_interest")
    con.execute(f"""
        CREATE TABLE massive_short_interest AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)

    cnt = con.execute("SELECT COUNT(*) FROM massive_short_interest").fetchone()[0]
    unique_tickers = con.execute(
        "SELECT COUNT(DISTINCT ticker) FROM massive_short_interest"
    ).fetchone()[0]
    print(f"  massive_short_interest: {cnt:,} rows, {unique_tickers:,} tickers")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch short interest data via Massive.com for Holly symbols"
    )
    parser.add_argument(
        "--smoke", action="store_true",
        help="Smoke test: fetch only first 5 symbols"
    )
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
