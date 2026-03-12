"""
68_fetch_trades_tick.py — Fetch tick-level trade data via Massive.com API.

Per Holly trade date: for each unique (symbol, trade_date) pair in the Holly
trades table, fetches ALL individual trade executions for that symbol on that
trading day. This captures full intraday microstructure — price, size, exchange,
conditions, nanosecond timestamps.

Data is saved as per-date parquet files in a partitioned directory to manage
the large volume (~16 GB total). DuckDB reads the directory via read_parquet
glob pattern.

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/68_fetch_trades_tick.py
    python scripts/68_fetch_trades_tick.py --smoke
    python scripts/68_fetch_trades_tick.py --since 2021-01-01
    python scripts/68_fetch_trades_tick.py --limit-dates 10
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
OUT_DIR = REF_DIR / "trades_tick"
PROGRESS_FILE = REF_DIR / "trades_tick_progress.json"

SEMAPHORE = asyncio.Semaphore(POLYGON_CONCURRENCY if POLYGON_CONCURRENCY else 10)


def load_progress() -> set[str]:
    """Load completed symbol:date keys."""
    if PROGRESS_FILE.exists():
        data = json.loads(PROGRESS_FILE.read_text())
        return set(data.get("completed_keys", []))
    return set()


def save_progress(completed: set[str]):
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(json.dumps({
        "completed_keys": sorted(list(completed)[-50000:]),
        "total_completed": len(completed),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2))


def get_10yr_cutoff() -> date:
    """
    Trades endpoint has a rolling 10-year window.
    Returns the earliest date that should work.
    """
    return date.today() - timedelta(days=3652)


def load_trade_date_manifest(since: str | None = None) -> list[tuple[date, list[str]]]:
    """
    Load Holly trades, group by trade date -> unique symbol list.
    Returns sorted list of (trade_date, [symbols]) tuples.
    Automatically clips to the 10-year API window.
    """
    import duckdb
    db = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    cutoff = get_10yr_cutoff().isoformat()
    if since and since > cutoff:
        cutoff = since

    rows = db.execute(f"""
        SELECT
            CAST(entry_time AS DATE) AS trade_date,
            LIST(DISTINCT symbol ORDER BY symbol) AS symbols
        FROM trades
        WHERE CAST(entry_time AS DATE) >= '{cutoff}'
        GROUP BY trade_date
        ORDER BY trade_date
    """).fetchall()
    db.close()
    return [(r[0], r[1]) for r in rows]


async def fetch_symbol_day_trades(
    client: httpx.AsyncClient,
    symbol: str,
    trade_date: date,
) -> list[dict]:
    """
    Fetch ALL individual trade executions for a symbol on a single trading day.
    Follows next_url pagination until exhausted.
    Uses date strings (API handles market hours automatically).
    """
    next_day = (trade_date + timedelta(days=1)).isoformat()

    url = f"{MASSIVE_BASE}/v3/trades/{symbol}"
    params = {
        "timestamp.gte": trade_date.isoformat(),
        "timestamp.lt": next_day,
        "order": "asc",
        "limit": "50000",
        "apiKey": POLYGON_API_KEY,
    }

    all_trades: list[dict] = []
    use_params = True

    async with SEMAPHORE:
        while True:
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

                    if resp.status_code in (403, 404):
                        return all_trades

                    if resp.status_code != 200:
                        return all_trades

                    data = resp.json()
                    results = data.get("results", [])

                    for t in results:
                        conditions = t.get("conditions")
                        all_trades.append({
                            "ticker": symbol,
                            "trade_date": trade_date.isoformat(),
                            "sip_timestamp": t.get("sip_timestamp"),
                            "participant_timestamp": t.get("participant_timestamp"),
                            "trf_timestamp": t.get("trf_timestamp"),
                            "price": t.get("price"),
                            "size": t.get("size"),
                            "decimal_size": t.get("decimal_size"),
                            "exchange": t.get("exchange"),
                            "tape": t.get("tape"),
                            "conditions": json.dumps(conditions) if conditions else None,
                            "sequence_number": t.get("sequence_number"),
                            "id": t.get("id"),
                        })

                    next_url = data.get("next_url")
                    if not next_url:
                        return all_trades

                    url = f"{next_url}&apiKey={POLYGON_API_KEY}"
                    break

                except (httpx.TimeoutException, httpx.ConnectError):
                    if attempt < 2:
                        await asyncio.sleep(2 ** (attempt + 1))
                        continue
                    return all_trades
            else:
                # All 3 attempts rate-limited
                return all_trades

    return all_trades


async def process_trade_date(
    client: httpx.AsyncClient,
    trade_date: date,
    symbols: list[str],
    completed: set[str],
) -> tuple[int, int, int]:
    """
    Fetch tick trades for all symbols on a single trade date.
    Saves per-date parquet file. Returns (new_trades, symbols_fetched, symbols_empty).
    """
    # Filter to symbols not yet completed for this date
    remaining = [s for s in symbols if f"{s}:{trade_date.isoformat()}" not in completed]
    if not remaining:
        return 0, 0, 0

    # Fetch all symbols for this date concurrently (bounded by semaphore)
    tasks = [fetch_symbol_day_trades(client, sym, trade_date) for sym in remaining]
    results = await asyncio.gather(*tasks)

    all_rows: list[dict] = []
    fetched = 0
    empty = 0

    for sym, trades in zip(remaining, results):
        if trades:
            all_rows.extend(trades)
            fetched += 1
        else:
            empty += 1
        completed.add(f"{sym}:{trade_date.isoformat()}")

    if all_rows:
        # Load existing date file if present (for merge)
        date_file = OUT_DIR / f"trades_{trade_date.isoformat()}.parquet"
        if date_file.exists():
            existing_df = pd.read_parquet(date_file)
            existing_rows = existing_df.to_dict("records")
            all_rows = existing_rows + all_rows

        df = pd.DataFrame(all_rows)
        # Dedup on ticker + sip_timestamp + sequence_number
        dedup_cols = ["ticker", "sip_timestamp", "sequence_number"]
        available = [c for c in dedup_cols if c in df.columns]
        if available:
            df = df.drop_duplicates(subset=available, keep="last").reset_index(drop=True)

        pq.write_table(
            pa.Table.from_pandas(df), str(date_file), compression="zstd"
        )

    return len(all_rows), fetched, empty


def load_to_duckdb():
    """Load all per-date parquet files into DuckDB as a single table."""
    import duckdb

    parquet_files = sorted(OUT_DIR.glob("trades_*.parquet"))
    if not parquet_files:
        print("  No parquet files to load")
        return

    print(f"\nLoading {len(parquet_files)} parquet files into DuckDB ({DUCKDB_PATH.name})...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS massive_trades_tick")

    # Use glob pattern to read all files
    glob_path = str(OUT_DIR / "trades_*.parquet").replace("\\", "/")
    con.execute(f"""
        CREATE TABLE massive_trades_tick AS
        SELECT * FROM read_parquet('{glob_path}')
    """)

    cnt = con.execute("SELECT COUNT(*) FROM massive_trades_tick").fetchone()[0]
    tickers = con.execute("SELECT COUNT(DISTINCT ticker) FROM massive_trades_tick").fetchone()[0]
    dates = con.execute("SELECT COUNT(DISTINCT trade_date) FROM massive_trades_tick").fetchone()[0]
    print(f"  massive_trades_tick: {cnt:,} rows, {tickers:,} tickers, {dates:,} trade dates")

    # Summary stats
    if cnt > 0:
        avg_per_date = con.execute(
            "SELECT AVG(cnt) FROM (SELECT trade_date, COUNT(*) as cnt FROM massive_trades_tick GROUP BY trade_date)"
        ).fetchone()[0]
        print(f"  Avg trades per date: {avg_per_date:,.0f}")

    con.close()


async def main_async(args):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading Holly trade date manifest from DuckDB...")
    manifest = load_trade_date_manifest(since=args.since)
    print(f"  Total trade dates: {len(manifest)}")
    total_symbol_dates = sum(len(syms) for _, syms in manifest)
    print(f"  Total symbol-date pairs: {total_symbol_dates:,}")

    if not manifest:
        print("No trade dates found!")
        return

    if args.smoke:
        manifest = manifest[:2]
        print(f"\n  SMOKE TEST: fetching only {len(manifest)} dates")

    if args.limit_dates:
        manifest = manifest[:args.limit_dates]
        print(f"  Limited to first {args.limit_dates} dates")

    completed = load_progress()
    # Count remaining
    remaining_pairs = sum(
        1 for d, syms in manifest
        for s in syms
        if f"{s}:{d.isoformat()}" not in completed
    )
    print(f"  Already completed: {len(completed):,}")
    print(f"  Remaining symbol-date pairs: {remaining_pairs:,}")

    if remaining_pairs == 0:
        print("All symbol-date pairs already fetched!")
        load_to_duckdb()
        return

    print(f"\n{'=' * 60}")
    print("Fetching tick-level trades from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()
    total_trades = 0
    total_fetched = 0
    total_empty = 0
    total_disk_mb = 0

    async with httpx.AsyncClient() as client:
        for i, (trade_date, symbols) in enumerate(manifest):
            new_trades, fetched, empty = await process_trade_date(
                client, trade_date, symbols, completed
            )
            total_trades += new_trades
            total_fetched += fetched
            total_empty += empty

            elapsed = time.time() - t0
            pct = (i + 1) / len(manifest) * 100

            if (i + 1) % 10 == 0 or i == 0 or (i + 1) == len(manifest):
                # Check disk usage
                disk_bytes = sum(f.stat().st_size for f in OUT_DIR.glob("trades_*.parquet"))
                total_disk_mb = disk_bytes / 1e6
                print(
                    f"  [{i+1}/{len(manifest)}] {trade_date} "
                    f"| +{new_trades:,} trades ({fetched} sym, {empty} empty) "
                    f"| total: {total_trades:,} | {total_disk_mb:.0f} MB "
                    f"| {pct:.0f}% | {elapsed:.0f}s"
                )

            if (i + 1) % 25 == 0:
                save_progress(completed)

    save_progress(completed)

    # Final disk usage
    disk_bytes = sum(f.stat().st_size for f in OUT_DIR.glob("trades_*.parquet"))
    total_disk_mb = disk_bytes / 1e6

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Tick trades fetch complete!")
    print(f"{'=' * 60}")
    print(f"  Total trades: {total_trades:,}")
    print(f"  Symbols fetched: {total_fetched:,}")
    print(f"  Symbols empty: {total_empty:,}")
    print(f"  Parquet files: {len(list(OUT_DIR.glob('trades_*.parquet')))}")
    print(f"  Total disk: {total_disk_mb:.0f} MB ({total_disk_mb/1000:.1f} GB)")
    print(f"  Elapsed: {elapsed / 60:.1f} min")

    load_to_duckdb()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch tick-level trades via Massive.com for Holly trade dates"
    )
    parser.add_argument("--smoke", action="store_true",
                        help="Smoke test: first 2 trade dates only")
    parser.add_argument("--since", default=None,
                        help="Earliest trade date (YYYY-MM-DD)")
    parser.add_argument("--limit-dates", type=int, default=None,
                        help="Limit to first N trade dates")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
