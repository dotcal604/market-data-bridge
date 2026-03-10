"""
46_fetch_agg_bars_massive.py — Fetch daily aggregate bars via Massive.com API.

Per-symbol per-date: for each Holly-traded symbol on each trade date, fetches
the daily OHLCV bar including VWAP and num_trades (not available in flat files).

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/46_fetch_agg_bars_massive.py
    python scripts/46_fetch_agg_bars_massive.py --smoke
    python scripts/46_fetch_agg_bars_massive.py --since 2021-01-01
    python scripts/46_fetch_agg_bars_massive.py --limit-dates 10
"""

import argparse
import asyncio
import json
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import POLYGON_API_KEY, DATA_DIR, DUCKDB_PATH, POLYGON_CONCURRENCY

MASSIVE_BASE = "https://api.massive.com"
REF_DIR = DATA_DIR / "reference"
PROGRESS_FILE = REF_DIR / "agg_bars_progress.json"
OUT_FILE = REF_DIR / "massive_daily_bars.parquet"

SEMAPHORE = asyncio.Semaphore(POLYGON_CONCURRENCY if POLYGON_CONCURRENCY else 10)


def load_progress() -> set[str]:
    if PROGRESS_FILE.exists():
        data = json.loads(PROGRESS_FILE.read_text())
        return set(data.get("completed_keys", []))
    return set()


def save_progress(completed: set[str]):
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(json.dumps({
        "completed_keys": sorted(completed),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2))


def load_trade_manifest(since: str | None = None) -> list[tuple[str, date]]:
    """Load unique (symbol, trade_date) pairs from DuckDB."""
    import duckdb
    db = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    where = "WHERE CAST(entry_time AS DATE) >= '2016-01-01'"
    if since:
        where = f"WHERE CAST(entry_time AS DATE) >= '{since}'"
    rows = db.execute(f"""
        SELECT DISTINCT symbol, CAST(entry_time AS DATE) AS trade_date
        FROM trades {where}
        ORDER BY trade_date, symbol
    """).fetchall()
    db.close()
    return [(r[0], r[1]) for r in rows]


async def fetch_bar(
    client: httpx.AsyncClient,
    symbol: str,
    bar_date: date,
) -> dict | None:
    """Fetch a single daily bar for symbol on date."""
    url = f"{MASSIVE_BASE}/v2/aggs/ticker/{symbol}/range/1/day/{bar_date.isoformat()}/{bar_date.isoformat()}"
    params = {"adjusted": "true", "apiKey": POLYGON_API_KEY}

    async with SEMAPHORE:
        for attempt in range(3):
            try:
                resp = await client.get(url, params=params, timeout=15)

                if resp.status_code == 429:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue

                if resp.status_code == 403:
                    return None

                if resp.status_code != 200:
                    return None

                data = resp.json()
                results = data.get("results", [])
                if not results:
                    return None

                bar = results[0]
                return {
                    "ticker": symbol,
                    "bar_date": bar_date.isoformat(),
                    "open": bar.get("o"),
                    "high": bar.get("h"),
                    "low": bar.get("l"),
                    "close": bar.get("c"),
                    "volume": bar.get("v"),
                    "vwap": bar.get("vw"),
                    "num_trades": bar.get("n"),
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

    print("Loading Holly trade manifest from DuckDB...")
    manifest = load_trade_manifest(since=args.since)
    print(f"  Total symbol-date pairs: {len(manifest):,}")

    if not manifest:
        print("No trades found!")
        return

    if args.smoke:
        manifest = manifest[:5]
        print(f"\n  SMOKE TEST: fetching only {len(manifest)} pairs")

    if args.limit_dates:
        # Limit by unique dates
        dates_seen = set()
        limited = []
        for sym, d in manifest:
            if len(dates_seen) >= args.limit_dates and d not in dates_seen:
                break
            dates_seen.add(d)
            limited.append((sym, d))
        manifest = limited
        print(f"  Limited to {args.limit_dates} dates ({len(manifest)} pairs)")

    completed = load_progress()
    remaining = [(s, d) for s, d in manifest if f"{s}:{d.isoformat()}" not in completed]
    print(f"  Already completed: {len(completed):,}")
    print(f"  Remaining: {len(remaining):,}")

    if not remaining:
        print("All bars already fetched!")
        if OUT_FILE.exists():
            load_to_duckdb(OUT_FILE)
        return

    # Load existing data
    all_rows: list[dict] = []
    if OUT_FILE.exists():
        existing_df = pd.read_parquet(OUT_FILE)
        all_rows = existing_df.to_dict("records")
        print(f"  Existing bars: {len(all_rows):,}")

    print(f"\n{'=' * 60}")
    print("Fetching daily bars from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()
    new_bars = 0
    failed = 0

    async with httpx.AsyncClient() as client:
        # Process in batches of 50 for concurrency
        batch_size = 50
        for batch_start in range(0, len(remaining), batch_size):
            batch = remaining[batch_start:batch_start + batch_size]
            tasks = [fetch_bar(client, sym, d) for sym, d in batch]
            results = await asyncio.gather(*tasks)

            for (sym, d), result in zip(batch, results):
                key = f"{sym}:{d.isoformat()}"
                if result:
                    all_rows.append(result)
                    new_bars += 1
                else:
                    failed += 1
                completed.add(key)

            elapsed = time.time() - t0
            done = batch_start + len(batch)
            pct = done / len(remaining) * 100
            if done % 250 == 0 or done == len(remaining) or batch_start == 0:
                print(
                    f"  [{done:,}/{len(remaining):,}] "
                    f"+{new_bars:,} bars | {failed:,} failed "
                    f"| {pct:.0f}% | {elapsed:.0f}s"
                )

            if done % 500 == 0:
                save_progress(completed)

    save_progress(completed)

    if not all_rows:
        print("No bars fetched!")
        return

    df = pd.DataFrame(all_rows)
    df = df.drop_duplicates(subset=["ticker", "bar_date"], keep="last").reset_index(drop=True)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Daily bars fetch complete!")
    print(f"{'=' * 60}")
    print(f"  New bars this run: {new_bars:,}")
    print(f"  Failed: {failed:,}")
    print(f"  Total bars: {len(df):,}")
    print(f"  File size: {OUT_FILE.stat().st_size / 1e6:.1f} MB")
    print(f"  Elapsed: {elapsed / 60:.1f} min")

    if not df.empty:
        has_vwap = df["vwap"].notna().sum()
        print(f"  Bars with VWAP: {has_vwap:,} ({has_vwap/len(df)*100:.0f}%)")

    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    import duckdb
    if not parquet_file.exists():
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS massive_daily_bars")
    con.execute(f"""
        CREATE TABLE massive_daily_bars AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)
    cnt = con.execute("SELECT COUNT(*) FROM massive_daily_bars").fetchone()[0]
    has_vwap = con.execute("SELECT COUNT(*) FROM massive_daily_bars WHERE vwap IS NOT NULL").fetchone()[0]
    print(f"  massive_daily_bars: {cnt:,} rows, {has_vwap:,} with VWAP")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch daily aggregate bars via Massive.com for Holly trade dates"
    )
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--since", default=None)
    parser.add_argument("--limit-dates", type=int, default=None)
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
