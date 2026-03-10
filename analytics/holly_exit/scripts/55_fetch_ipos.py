"""
55_fetch_ipos.py — Fetch IPO listings via Massive.com API.

Fetches ALL IPOs from 2020-01-01 onward using the /vX/reference/ipos endpoint.
Paginates through all results (not per-symbol). Captures listing date, status,
final issue price, shares outstanding, issuer name, and announced date.

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/55_fetch_ipos.py
    python scripts/55_fetch_ipos.py --smoke
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
OUT_FILE = REF_DIR / "massive_ipos.parquet"

SEMAPHORE = asyncio.Semaphore(POLYGON_CONCURRENCY if POLYGON_CONCURRENCY else 10)


def flatten_ipo(record: dict) -> dict:
    """Flatten an IPO result record into a flat dict."""
    return {
        "ticker": record.get("ticker"),
        "listing_date": record.get("listing_date"),
        "ipo_status": record.get("ipo_status"),
        "final_issue_price": record.get("final_issue_price"),
        "shares_outstanding": record.get("shares_outstanding"),
        "issuer_name": record.get("issuer_name"),
        "announced_date": record.get("announced_date"),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


async def fetch_all_ipos(
    client: httpx.AsyncClient,
    smoke: bool = False,
) -> list[dict]:
    """Fetch all IPO records, following next_url pagination."""
    url = f"{MASSIVE_BASE}/vX/reference/ipos"
    params = {
        "listing_date.gte": "2020-01-01",
        "limit": "10" if smoke else "1000",
        "order": "desc",
        "apiKey": POLYGON_API_KEY,
    }

    all_rows: list[dict] = []
    page = 0

    while True:
        page += 1

        for attempt in range(3):
            try:
                resp = await client.get(url, params=params, timeout=30)

                if resp.status_code == 429:
                    wait = 2 ** (attempt + 1)
                    print(f"  Rate limited, waiting {wait}s...")
                    await asyncio.sleep(wait)
                    continue

                if resp.status_code in (403, 404):
                    print(f"  HTTP {resp.status_code} — stopping pagination")
                    return all_rows

                if resp.status_code != 200:
                    print(f"  HTTP {resp.status_code} — stopping pagination")
                    return all_rows

                data = resp.json()
                results = data.get("results", [])

                for record in results:
                    row = flatten_ipo(record)
                    all_rows.append(row)

                print(f"  Page {page}: +{len(results)} IPOs (total: {len(all_rows):,})")

                # Check for next page
                next_url = data.get("next_url")
                if not next_url or smoke:
                    return all_rows

                # next_url is a full URL; use it directly but append apiKey
                url = next_url
                if "apiKey=" not in url:
                    separator = "&" if "?" in url else "?"
                    url = f"{url}{separator}apiKey={POLYGON_API_KEY}"
                params = {}  # params are embedded in next_url
                break

            except (httpx.TimeoutException, httpx.ConnectError) as e:
                if attempt < 2:
                    wait = 2 ** (attempt + 1)
                    print(f"  Connection error ({e}), retrying in {wait}s...")
                    await asyncio.sleep(wait)
                    continue
                print(f"  Failed after 3 attempts: {e}")
                return all_rows
        else:
            # All 3 attempts for this page were rate-limited
            print("  Exhausted retries on rate limits, stopping")
            return all_rows

    return all_rows


async def main_async(args):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    if args.smoke:
        print("\n  SMOKE TEST: fetching first page only (limit=10)")

    # Load existing data for merge
    existing_rows: list[dict] = []
    if OUT_FILE.exists():
        existing_df = pd.read_parquet(OUT_FILE)
        existing_rows = existing_df.to_dict("records")
        print(f"  Existing IPO records: {len(existing_rows):,}")

    print(f"\n{'=' * 60}")
    print("Fetching IPO listings from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()

    async with httpx.AsyncClient() as client:
        new_rows = await fetch_all_ipos(client, smoke=args.smoke)

    if not new_rows and not existing_rows:
        print("No IPO records fetched!")
        return

    # Merge existing + new
    all_rows = existing_rows + new_rows

    df = pd.DataFrame(all_rows)

    # Dedup on ticker + listing_date (keep latest fetch)
    before = len(df)
    df = df.drop_duplicates(subset=["ticker", "listing_date"], keep="last").reset_index(drop=True)
    dupes = before - len(df)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"IPO fetch complete!")
    print(f"{'=' * 60}")
    print(f"  New records this run: {len(new_rows):,}")
    print(f"  Duplicates removed: {dupes:,}")
    print(f"  Total IPO records: {len(df):,}")
    print(f"  File size: {OUT_FILE.stat().st_size / 1e6:.1f} MB")
    print(f"  Elapsed: {elapsed:.0f}s")

    if not df.empty:
        unique_tickers = df["ticker"].nunique()
        has_price = df["final_issue_price"].notna().sum()
        statuses = df["ipo_status"].value_counts().to_dict()
        date_range = f"{df['listing_date'].min()} to {df['listing_date'].max()}"
        print(f"  Unique tickers: {unique_tickers:,}")
        print(f"  With issue price: {has_price:,}")
        print(f"  Date range: {date_range}")
        print(f"  Statuses: {statuses}")

    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    import duckdb
    if not parquet_file.exists():
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS massive_ipos")
    con.execute(f"""
        CREATE TABLE massive_ipos AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)
    cnt = con.execute("SELECT COUNT(*) FROM massive_ipos").fetchone()[0]
    tickers = con.execute("SELECT COUNT(DISTINCT ticker) FROM massive_ipos").fetchone()[0]
    print(f"  massive_ipos: {cnt:,} rows, {tickers:,} unique tickers")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch IPO listings via Massive.com API"
    )
    parser.add_argument("--smoke", action="store_true",
                        help="Smoke test: fetch first page only (limit=10)")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
