"""
54_fetch_splits.py — Fetch stock splits via Massive.com API.

Per unique Holly symbol: fetches all historical splits for each ticker.
Provides execution dates, split ratios, and adjustment types to enrich
trade context with corporate action data.

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/54_fetch_splits.py
    python scripts/54_fetch_splits.py --smoke
    python scripts/54_fetch_splits.py --since 2021-01-01
    python scripts/54_fetch_splits.py --limit-dates 10
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
PROGRESS_FILE = REF_DIR / "massive_splits_progress.json"
OUT_FILE = REF_DIR / "massive_splits.parquet"

SEMAPHORE = asyncio.Semaphore(POLYGON_CONCURRENCY if POLYGON_CONCURRENCY else 10)


def load_unique_symbols() -> list[str]:
    """Load all unique Holly-traded symbols from DuckDB."""
    import duckdb
    db = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    rows = db.execute("""
        SELECT DISTINCT symbol FROM trades
        WHERE CAST(entry_time AS DATE) >= '2016-01-01'
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
        "total_completed": len(completed),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2))


async def fetch_splits(
    client: httpx.AsyncClient,
    symbol: str,
) -> list[dict]:
    """
    Fetch all historical splits for a single symbol.
    Follows next_url pagination until exhausted.
    """
    all_splits = []

    params = {
        "ticker": symbol,
        "limit": "5000",
        "sort": "execution_date.desc",
        "apiKey": POLYGON_API_KEY,
    }

    use_params = True
    url: str | None = f"{MASSIVE_BASE}/stocks/v1/splits"

    async with SEMAPHORE:
        while url:
            for attempt in range(3):
                try:
                    if use_params:
                        resp = await client.get(url, params=params, timeout=15)
                        use_params = False
                    else:
                        resp = await client.get(url, timeout=15)

                    if resp.status_code == 429:
                        await asyncio.sleep(2 ** (attempt + 1))
                        continue

                    if resp.status_code in (403, 404):
                        return all_splits

                    if resp.status_code != 200:
                        return all_splits

                    data = resp.json()
                    results = data.get("results", [])
                    all_splits.extend(results)

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
                    print(f"    FAILED after 3 retries on {symbol}: {e}")
                    url = None
                    break

    return all_splits


def flatten_split(s: dict) -> dict:
    """Flatten a single split response into a flat row."""
    return {
        "ticker": s.get("ticker"),
        "execution_date": s.get("execution_date"),
        "split_from": s.get("split_from"),
        "split_to": s.get("split_to"),
        "adjustment_type": s.get("adjustment_type"),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def dedup_key(row: dict) -> str:
    """Generate dedup key from ticker + execution_date."""
    return f"{row.get('ticker')}:{row.get('execution_date')}"


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

    if args.limit_dates:
        symbols = symbols[:args.limit_dates]
        print(f"  Limited to first {args.limit_dates} symbols")

    completed = load_progress()
    remaining = [s for s in symbols if s not in completed]
    print(f"  Already completed: {len(completed)}")
    print(f"  Remaining: {len(remaining)}")

    if not remaining:
        print("All symbols already fetched!")
        if OUT_FILE.exists():
            load_to_duckdb(OUT_FILE)
        return

    existing_keys: set[str] = set()
    all_rows: list[dict] = []
    if OUT_FILE.exists():
        existing_df = pd.read_parquet(OUT_FILE)
        for _, r in existing_df.iterrows():
            existing_keys.add(dedup_key(r.to_dict()))
        all_rows = existing_df.to_dict("records")
        print(f"  Existing splits: {len(existing_keys):,}")

    print(f"\n{'=' * 60}")
    print("Fetching stock splits from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()
    new_splits = 0
    dupes_skipped = 0
    failed = 0
    symbols_with_data = 0

    async with httpx.AsyncClient() as client:
        batch_size = 50
        for batch_start in range(0, len(remaining), batch_size):
            batch = remaining[batch_start:batch_start + batch_size]
            tasks = [fetch_splits(client, sym) for sym in batch]
            results = await asyncio.gather(*tasks)

            for sym, splits in zip(batch, results):
                sym_new = 0
                for s in splits:
                    row = flatten_split(s)
                    key = dedup_key(row)
                    if key in existing_keys:
                        dupes_skipped += 1
                        continue
                    all_rows.append(row)
                    existing_keys.add(key)
                    sym_new += 1

                if sym_new > 0:
                    symbols_with_data += 1
                new_splits += sym_new
                completed.add(sym)

            done = batch_start + len(batch)
            elapsed = time.time() - t0
            if done % 100 == 0 or done == len(remaining) or batch_start == 0:
                print(
                    f"  [{done}/{len(remaining)}] "
                    f"+{new_splits:,} splits | {dupes_skipped:,} dupes "
                    f"| total: {len(all_rows):,} | {done/len(remaining)*100:.0f}% | {elapsed:.0f}s"
                )

            if done % 200 == 0:
                save_progress(completed)

    save_progress(completed)

    if not all_rows:
        print("No splits fetched! (This is normal — most stocks don't split.)")
        # Still mark progress as saved — no data is valid data
        return

    df = pd.DataFrame(all_rows)

    before = len(df)
    df = df.drop_duplicates(
        subset=["ticker", "execution_date"],
        keep="last",
    ).reset_index(drop=True)
    final_dupes = before - len(df)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Stock splits fetch complete!")
    print(f"{'=' * 60}")
    print(f"  New splits this run: {new_splits:,}")
    print(f"  Dupes skipped: {dupes_skipped + final_dupes:,}")
    print(f"  Total unique splits: {len(df):,}")
    print(f"  Symbols with splits: {symbols_with_data:,}")
    print(f"  File size: {OUT_FILE.stat().st_size / 1e6:.1f} MB")
    print(f"  Symbols completed: {len(completed)}/{len(symbols)}")
    print(f"  Elapsed: {elapsed:.0f}s")

    if not df.empty:
        unique_tickers = df["ticker"].nunique()
        print(f"  Unique tickers: {unique_tickers:,}")
        print(f"  Date range: {df['execution_date'].min()} to {df['execution_date'].max()}")
        if "split_from" in df.columns and "split_to" in df.columns:
            common_ratios = (
                df.dropna(subset=["split_from", "split_to"])
                .apply(lambda r: f"{int(r['split_to'])}:{int(r['split_from'])}", axis=1)
                .value_counts()
                .head(5)
            )
            print(f"  Top split ratios: {dict(common_ratios)}")

    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    """Load splits into DuckDB."""
    import duckdb

    if not parquet_file.exists():
        print("  No parquet file to load")
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")

    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS massive_splits")
    con.execute(f"""
        CREATE TABLE massive_splits AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)

    cnt = con.execute("SELECT COUNT(*) FROM massive_splits").fetchone()[0]
    unique_tickers = con.execute("SELECT COUNT(DISTINCT ticker) FROM massive_splits").fetchone()[0]
    print(f"  massive_splits: {cnt:,} rows, {unique_tickers:,} tickers")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch stock splits via Massive.com for Holly symbols"
    )
    parser.add_argument(
        "--smoke", action="store_true",
        help="Smoke test: fetch only the first 5 symbols"
    )
    parser.add_argument(
        "--since", default=None,
        help="Earliest trade date for symbol selection (YYYY-MM-DD, default: 2021-01-01)"
    )
    parser.add_argument(
        "--limit-dates", type=int, default=None,
        help="Limit to first N symbols (for testing)"
    )
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
