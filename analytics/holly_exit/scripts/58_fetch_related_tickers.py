"""
58_fetch_related_tickers.py — Fetch related tickers via Massive.com API.

Per unique Holly symbol: fetches related companies/tickers from the
Massive.com related-companies endpoint. Flattens into one row per
(source_ticker, related_ticker) pair. Single result per symbol (no
pagination needed).

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/58_fetch_related_tickers.py
    python scripts/58_fetch_related_tickers.py --smoke
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
OUT_FILE = REF_DIR / "massive_related_tickers.parquet"

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


async def fetch_related(
    client: httpx.AsyncClient,
    symbol: str,
) -> list[dict] | None:
    """
    Fetch related tickers for a single symbol.
    Returns list of flattened rows: one per (source_ticker, related_ticker).
    """
    url = f"{MASSIVE_BASE}/v1/related-companies/{symbol}"
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
                results = data.get("results", [])

                if not results:
                    return None

                now_iso = datetime.now(timezone.utc).isoformat()
                rows = []

                for item in results:
                    # Each item may be a dict with a "ticker" key,
                    # or just a string ticker
                    if isinstance(item, dict):
                        related = item.get("ticker") or item.get("symbol")
                    elif isinstance(item, str):
                        related = item
                    else:
                        continue

                    if related:
                        rows.append({
                            "source_ticker": symbol,
                            "related_ticker": related,
                            "fetched_at": now_iso,
                        })

                return rows if rows else None

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

    # Load existing data for merge/dedup
    existing_keys: set[str] = set()
    all_rows: list[dict] = []
    if OUT_FILE.exists():
        existing_df = pd.read_parquet(OUT_FILE)
        for _, row in existing_df.iterrows():
            key = f"{row['source_ticker']}:{row['related_ticker']}"
            existing_keys.add(key)
        all_rows = existing_df.to_dict("records")
        existing_source_tickers = set(existing_df["source_ticker"])
        print(f"  Existing related pairs: {len(existing_keys):,}")
        print(f"  Existing source tickers: {len(existing_source_tickers):,}")
    else:
        existing_source_tickers = set()

    remaining = [s for s in symbols if s not in existing_source_tickers]
    print(f"  Remaining: {len(remaining)}")

    if not remaining:
        print("All symbols already fetched!")
        if OUT_FILE.exists():
            load_to_duckdb(OUT_FILE)
        return

    print(f"\n{'=' * 60}")
    print("Fetching related tickers from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()
    new_pairs = 0
    failed = 0
    symbols_with_data = 0

    async with httpx.AsyncClient() as client:
        batch_size = 50
        for batch_start in range(0, len(remaining), batch_size):
            batch = remaining[batch_start:batch_start + batch_size]
            tasks = [fetch_related(client, sym) for sym in batch]
            results = await asyncio.gather(*tasks)

            for sym, result in zip(batch, results):
                if result:
                    symbols_with_data += 1
                    for row in result:
                        key = f"{row['source_ticker']}:{row['related_ticker']}"
                        if key not in existing_keys:
                            all_rows.append(row)
                            existing_keys.add(key)
                            new_pairs += 1
                else:
                    failed += 1

            done = batch_start + len(batch)
            elapsed = time.time() - t0
            if done % 100 == 0 or done == len(remaining) or batch_start == 0:
                print(
                    f"  [{done}/{len(remaining)}] "
                    f"+{new_pairs:,} pairs | {symbols_with_data} with data "
                    f"| {failed} no data | {elapsed:.0f}s"
                )

    if not all_rows:
        print("No related tickers fetched!")
        return

    df = pd.DataFrame(all_rows)

    # Dedup on source_ticker + related_ticker
    before = len(df)
    df = df.drop_duplicates(
        subset=["source_ticker", "related_ticker"], keep="last"
    ).reset_index(drop=True)
    final_dupes = before - len(df)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Related tickers fetch complete!")
    print(f"{'=' * 60}")
    print(f"  New pairs this run: {new_pairs:,}")
    print(f"  Dupes removed: {final_dupes:,}")
    print(f"  Total unique pairs: {len(df):,}")
    print(f"  Unique source tickers: {df['source_ticker'].nunique():,}")
    print(f"  Unique related tickers: {df['related_ticker'].nunique():,}")
    print(f"  File size: {OUT_FILE.stat().st_size / 1e6:.1f} MB")
    print(f"  Failed (no data): {failed:,}")
    print(f"  Elapsed: {elapsed:.0f}s")

    if not df.empty:
        avg_related = df.groupby("source_ticker").size().mean()
        print(f"  Avg related tickers per source: {avg_related:.1f}")

    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    """Load related tickers into DuckDB."""
    import duckdb

    if not parquet_file.exists():
        print("  No parquet file to load")
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS massive_related_tickers")
    con.execute(f"""
        CREATE TABLE massive_related_tickers AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)
    cnt = con.execute("SELECT COUNT(*) FROM massive_related_tickers").fetchone()[0]
    unique_sources = con.execute(
        "SELECT COUNT(DISTINCT source_ticker) FROM massive_related_tickers"
    ).fetchone()[0]
    unique_related = con.execute(
        "SELECT COUNT(DISTINCT related_ticker) FROM massive_related_tickers"
    ).fetchone()[0]
    print(f"  massive_related_tickers: {cnt:,} rows, {unique_sources:,} source tickers, {unique_related:,} related tickers")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch related tickers via Massive.com for Holly symbols"
    )
    parser.add_argument(
        "--smoke", action="store_true",
        help="Smoke test: fetch only first 5 symbols"
    )
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
