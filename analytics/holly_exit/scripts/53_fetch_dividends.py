"""
53_fetch_dividends.py — Fetch stock dividends via Massive.com API.

Per unique Holly symbol: fetches all historical dividends for each ticker.
Provides ex-dividend dates, cash amounts, frequency, and distribution type
to enrich trade context with corporate action data.

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/53_fetch_dividends.py
    python scripts/53_fetch_dividends.py --smoke
    python scripts/53_fetch_dividends.py --since 2021-01-01
    python scripts/53_fetch_dividends.py --limit-dates 10
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
PROGRESS_FILE = REF_DIR / "massive_dividends_progress.json"
OUT_FILE = REF_DIR / "massive_dividends.parquet"

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
        "total_completed": len(completed),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2))


async def fetch_dividends(
    client: httpx.AsyncClient,
    symbol: str,
) -> list[dict]:
    """
    Fetch all historical dividends for a single symbol.
    Follows next_url pagination until exhausted.
    """
    all_dividends = []

    params = {
        "ticker": symbol,
        "limit": "5000",
        "sort": "ex_dividend_date.desc",
        "apiKey": POLYGON_API_KEY,
    }

    use_params = True
    url: str | None = f"{MASSIVE_BASE}/stocks/v1/dividends"

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
                        return all_dividends

                    if resp.status_code != 200:
                        return all_dividends

                    data = resp.json()
                    results = data.get("results", [])
                    all_dividends.extend(results)

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

    return all_dividends


def flatten_dividend(d: dict) -> dict:
    """Flatten a single dividend response into a flat row."""
    return {
        "ticker": d.get("ticker"),
        "ex_dividend_date": d.get("ex_dividend_date"),
        "declaration_date": d.get("declaration_date"),
        "record_date": d.get("record_date"),
        "pay_date": d.get("pay_date"),
        "cash_amount": d.get("cash_amount"),
        "currency": d.get("currency"),
        "frequency": d.get("frequency"),
        "distribution_type": d.get("distribution_type"),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def dedup_key(row: dict) -> str:
    """Generate dedup key from ticker + ex_dividend_date + distribution_type."""
    return (
        f"{row.get('ticker')}:"
        f"{row.get('ex_dividend_date')}:"
        f"{row.get('distribution_type')}"
    )


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
        print(f"  Existing dividends: {len(existing_keys):,}")

    print(f"\n{'=' * 60}")
    print("Fetching dividends from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()
    new_dividends = 0
    dupes_skipped = 0
    failed = 0
    symbols_with_data = 0

    async with httpx.AsyncClient() as client:
        batch_size = 50
        for batch_start in range(0, len(remaining), batch_size):
            batch = remaining[batch_start:batch_start + batch_size]
            tasks = [fetch_dividends(client, sym) for sym in batch]
            results = await asyncio.gather(*tasks)

            for sym, dividends in zip(batch, results):
                sym_new = 0
                for d in dividends:
                    row = flatten_dividend(d)
                    key = dedup_key(row)
                    if key in existing_keys:
                        dupes_skipped += 1
                        continue
                    all_rows.append(row)
                    existing_keys.add(key)
                    sym_new += 1

                if sym_new > 0:
                    symbols_with_data += 1
                new_dividends += sym_new
                completed.add(sym)

            done = batch_start + len(batch)
            elapsed = time.time() - t0
            if done % 100 == 0 or done == len(remaining) or batch_start == 0:
                print(
                    f"  [{done}/{len(remaining)}] "
                    f"+{new_dividends:,} dividends | {dupes_skipped:,} dupes "
                    f"| total: {len(all_rows):,} | {done/len(remaining)*100:.0f}% | {elapsed:.0f}s"
                )

            if done % 200 == 0:
                save_progress(completed)

    save_progress(completed)

    if not all_rows:
        print("No dividends fetched!")
        return

    df = pd.DataFrame(all_rows)

    before = len(df)
    df = df.drop_duplicates(
        subset=["ticker", "ex_dividend_date", "distribution_type"],
        keep="last",
    ).reset_index(drop=True)
    final_dupes = before - len(df)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Dividends fetch complete!")
    print(f"{'=' * 60}")
    print(f"  New dividends this run: {new_dividends:,}")
    print(f"  Dupes skipped: {dupes_skipped + final_dupes:,}")
    print(f"  Total unique dividends: {len(df):,}")
    print(f"  Symbols with dividends: {symbols_with_data:,}")
    print(f"  File size: {OUT_FILE.stat().st_size / 1e6:.1f} MB")
    print(f"  Symbols completed: {len(completed)}/{len(symbols)}")
    print(f"  Elapsed: {elapsed:.0f}s")

    if not df.empty:
        unique_tickers = df["ticker"].nunique()
        print(f"  Unique tickers: {unique_tickers:,}")
        print(f"  Date range: {df['ex_dividend_date'].min()} to {df['ex_dividend_date'].max()}")
        has_cash = df["cash_amount"].notna().sum()
        print(f"  With cash amount: {has_cash:,}")
        freq_counts = df["frequency"].value_counts().head(5)
        print(f"  Top frequencies: {dict(freq_counts)}")

    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    """Load dividends into DuckDB."""
    import duckdb

    if not parquet_file.exists():
        print("  No parquet file to load")
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")

    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS massive_dividends")
    con.execute(f"""
        CREATE TABLE massive_dividends AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)

    cnt = con.execute("SELECT COUNT(*) FROM massive_dividends").fetchone()[0]
    unique_tickers = con.execute("SELECT COUNT(DISTINCT ticker) FROM massive_dividends").fetchone()[0]
    print(f"  massive_dividends: {cnt:,} rows, {unique_tickers:,} tickers")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch stock dividends via Massive.com for Holly symbols"
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
