"""
47_fetch_ticker_details_massive.py — Fetch ticker details via Massive.com API.

Per unique Holly symbol: fetches company details including market cap,
shares outstanding, SIC code, total employees, and listing info.
One request per symbol (no pagination needed).

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/47_fetch_ticker_details_massive.py
    python scripts/47_fetch_ticker_details_massive.py --smoke
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
OUT_FILE = REF_DIR / "massive_ticker_details.parquet"

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


async def fetch_details(
    client: httpx.AsyncClient,
    symbol: str,
) -> dict | None:
    """Fetch ticker details for a single symbol."""
    url = f"{MASSIVE_BASE}/v3/reference/tickers/{symbol}"
    params = {"apiKey": POLYGON_API_KEY}

    async with SEMAPHORE:
        for attempt in range(3):
            try:
                resp = await client.get(url, params=params, timeout=15)

                if resp.status_code == 429:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue

                if resp.status_code in (403, 404):
                    return None

                if resp.status_code != 200:
                    return None

                data = resp.json()
                result = data.get("results", data)

                return {
                    "ticker": symbol,
                    "name": result.get("name"),
                    "description": (result.get("description") or "")[:500],
                    "market_cap": result.get("market_cap"),
                    "sic_code": result.get("sic_code"),
                    "sic_description": result.get("sic_description"),
                    "primary_exchange": result.get("primary_exchange"),
                    "shares_outstanding": result.get("share_class_shares_outstanding"),
                    "weighted_shares_outstanding": result.get("weighted_shares_outstanding"),
                    "list_date": result.get("list_date"),
                    "homepage_url": result.get("homepage_url"),
                    "total_employees": result.get("total_employees"),
                    "locale": result.get("locale"),
                    "active": result.get("active"),
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                }

            except (httpx.TimeoutException, httpx.ConnectError):
                if attempt < 2:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                return None

    return None


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

    # Load existing to skip already-fetched
    existing_tickers: set[str] = set()
    all_rows: list[dict] = []
    if OUT_FILE.exists():
        existing_df = pd.read_parquet(OUT_FILE)
        existing_tickers = set(existing_df["ticker"])
        all_rows = existing_df.to_dict("records")
        print(f"  Existing ticker details: {len(existing_tickers):,}")

    remaining = [s for s in symbols if s not in existing_tickers]
    print(f"  Remaining: {len(remaining)}")

    if not remaining:
        print("All tickers already fetched!")
        if OUT_FILE.exists():
            load_to_duckdb(OUT_FILE)
        return

    print(f"\n{'=' * 60}")
    print("Fetching ticker details from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()
    new_details = 0
    failed = 0

    async with httpx.AsyncClient() as client:
        batch_size = 50
        for batch_start in range(0, len(remaining), batch_size):
            batch = remaining[batch_start:batch_start + batch_size]
            tasks = [fetch_details(client, sym) for sym in batch]
            results = await asyncio.gather(*tasks)

            for sym, result in zip(batch, results):
                if result:
                    all_rows.append(result)
                    new_details += 1
                else:
                    failed += 1

            done = batch_start + len(batch)
            elapsed = time.time() - t0
            if done % 100 == 0 or done == len(remaining):
                print(f"  [{done}/{len(remaining)}] +{new_details} details | {failed} failed | {elapsed:.0f}s")

    if not all_rows:
        print("No ticker details fetched!")
        return

    df = pd.DataFrame(all_rows)
    df = df.drop_duplicates(subset=["ticker"], keep="last").reset_index(drop=True)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Ticker details fetch complete!")
    print(f"{'=' * 60}")
    print(f"  New details this run: {new_details:,}")
    print(f"  Failed: {failed:,}")
    print(f"  Total tickers: {len(df):,}")
    print(f"  File size: {OUT_FILE.stat().st_size / 1e6:.1f} MB")
    print(f"  Elapsed: {elapsed:.0f}s")

    if not df.empty:
        has_market_cap = df["market_cap"].notna().sum()
        has_employees = df["total_employees"].notna().sum()
        print(f"  With market cap: {has_market_cap:,}")
        print(f"  With employees: {has_employees:,}")

    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    import duckdb
    if not parquet_file.exists():
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS massive_ticker_details")
    con.execute(f"""
        CREATE TABLE massive_ticker_details AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)
    cnt = con.execute("SELECT COUNT(*) FROM massive_ticker_details").fetchone()[0]
    print(f"  massive_ticker_details: {cnt:,} tickers")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch ticker details via Massive.com for Holly symbols"
    )
    parser.add_argument("--smoke", action="store_true")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
