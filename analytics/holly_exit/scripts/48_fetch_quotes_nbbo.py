"""
48_fetch_quotes_nbbo.py — Fetch NBBO quotes at Holly trade entry times via Massive.com.

Per Holly trade: fetches the most recent NBBO quote at or before the trade
entry time. Provides bid/ask/spread quality at actual execution time.

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/48_fetch_quotes_nbbo.py
    python scripts/48_fetch_quotes_nbbo.py --smoke
    python scripts/48_fetch_quotes_nbbo.py --since 2021-01-01
    python scripts/48_fetch_quotes_nbbo.py --limit-dates 10
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
PROGRESS_FILE = REF_DIR / "nbbo_quotes_progress.json"
OUT_FILE = REF_DIR / "trade_nbbo_quotes.parquet"

SEMAPHORE = asyncio.Semaphore(POLYGON_CONCURRENCY if POLYGON_CONCURRENCY else 10)


def load_progress() -> set[str]:
    if PROGRESS_FILE.exists():
        data = json.loads(PROGRESS_FILE.read_text())
        return set(data.get("completed_keys", []))
    return set()


def save_progress(completed: set[str]):
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(json.dumps({
        "completed_keys": sorted(list(completed)[-10000:]),  # keep last 10K to avoid huge file
        "total_completed": len(completed),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2))


def load_trade_manifest(since: str | None = None) -> list[tuple[str, str, date]]:
    """Load (symbol, entry_time, trade_date) from DuckDB for NBBO lookups."""
    import duckdb
    db = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    where = "WHERE CAST(entry_time AS DATE) >= '2021-01-01'"
    if since:
        where = f"WHERE CAST(entry_time AS DATE) >= '{since}'"
    rows = db.execute(f"""
        SELECT symbol, entry_time, CAST(entry_time AS DATE) AS trade_date
        FROM trades {where}
        ORDER BY entry_time
    """).fetchall()
    db.close()
    return [(r[0], str(r[1]), r[2]) for r in rows]


def entry_time_to_nanos(entry_time_str: str) -> str | None:
    """Convert entry_time string to nanosecond timestamp for Massive API."""
    try:
        dt = pd.Timestamp(entry_time_str)
        if dt.tz is None:
            dt = dt.tz_localize("America/New_York")
        return str(int(dt.value))  # nanoseconds since epoch
    except Exception:
        return None


async def fetch_nbbo(
    client: httpx.AsyncClient,
    symbol: str,
    entry_time: str,
    trade_date: date,
) -> dict | None:
    """Fetch the most recent NBBO quote at or before entry_time."""
    # Use the quotes endpoint with timestamp filter
    nanos = entry_time_to_nanos(entry_time)
    if not nanos:
        return None

    url = f"{MASSIVE_BASE}/v3/quotes/{symbol}"
    params = {
        "timestamp.lte": nanos,
        "order": "desc",
        "limit": "1",
        "apiKey": POLYGON_API_KEY,
    }

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

                q = results[0]
                bid = q.get("bid_price", 0)
                ask = q.get("ask_price", 0)
                midpoint = (bid + ask) / 2 if bid and ask else 0
                spread = ask - bid if bid and ask else 0
                spread_pct = (spread / midpoint * 100) if midpoint > 0 else None

                return {
                    "ticker": symbol,
                    "trade_date": trade_date.isoformat(),
                    "entry_time": entry_time,
                    "quote_sip_timestamp": q.get("sip_timestamp"),
                    "bid": bid,
                    "ask": ask,
                    "bid_size": q.get("bid_size"),
                    "ask_size": q.get("ask_size"),
                    "spread": round(spread, 4),
                    "spread_pct": round(spread_pct, 4) if spread_pct else None,
                    "midpoint": round(midpoint, 4),
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
    print(f"  Total trades: {len(manifest):,}")

    if not manifest:
        print("No trades found!")
        return

    if args.smoke:
        manifest = manifest[:5]
        print(f"\n  SMOKE TEST: fetching only {len(manifest)} trades")

    if args.limit_dates:
        dates_seen = set()
        limited = []
        for sym, et, d in manifest:
            if len(dates_seen) >= args.limit_dates and d not in dates_seen:
                break
            dates_seen.add(d)
            limited.append((sym, et, d))
        manifest = limited
        print(f"  Limited to {args.limit_dates} dates ({len(manifest)} trades)")

    completed = load_progress()
    remaining = [(s, et, d) for s, et, d in manifest
                 if f"{s}:{et}" not in completed]
    print(f"  Already completed: {len(completed):,}")
    print(f"  Remaining: {len(remaining):,}")

    if not remaining:
        print("All NBBO quotes already fetched!")
        if OUT_FILE.exists():
            load_to_duckdb(OUT_FILE)
        return

    all_rows: list[dict] = []
    if OUT_FILE.exists():
        existing_df = pd.read_parquet(OUT_FILE)
        all_rows = existing_df.to_dict("records")
        print(f"  Existing quotes: {len(all_rows):,}")

    print(f"\n{'=' * 60}")
    print("Fetching NBBO quotes from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()
    new_quotes = 0
    failed = 0

    async with httpx.AsyncClient() as client:
        batch_size = 50
        for batch_start in range(0, len(remaining), batch_size):
            batch = remaining[batch_start:batch_start + batch_size]
            tasks = [fetch_nbbo(client, sym, et, d) for sym, et, d in batch]
            results = await asyncio.gather(*tasks)

            for (sym, et, d), result in zip(batch, results):
                key = f"{sym}:{et}"
                if result:
                    all_rows.append(result)
                    new_quotes += 1
                else:
                    failed += 1
                completed.add(key)

            done = batch_start + len(batch)
            elapsed = time.time() - t0
            if done % 250 == 0 or done == len(remaining) or batch_start == 0:
                print(
                    f"  [{done:,}/{len(remaining):,}] "
                    f"+{new_quotes:,} quotes | {failed:,} failed "
                    f"| {done/len(remaining)*100:.0f}% | {elapsed:.0f}s"
                )

            if done % 500 == 0:
                save_progress(completed)

    save_progress(completed)

    if not all_rows:
        print("No NBBO quotes fetched!")
        return

    df = pd.DataFrame(all_rows)
    df = df.drop_duplicates(subset=["ticker", "entry_time"], keep="last").reset_index(drop=True)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"NBBO quotes fetch complete!")
    print(f"{'=' * 60}")
    print(f"  New quotes this run: {new_quotes:,}")
    print(f"  Failed: {failed:,}")
    print(f"  Total quotes: {len(df):,}")
    print(f"  File size: {OUT_FILE.stat().st_size / 1e6:.1f} MB")
    print(f"  Elapsed: {elapsed / 60:.1f} min")

    if not df.empty:
        avg_spread = df["spread_pct"].dropna().mean()
        print(f"  Avg spread %: {avg_spread:.3f}%")

    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    import duckdb
    if not parquet_file.exists():
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS trade_nbbo_quotes")
    con.execute(f"""
        CREATE TABLE trade_nbbo_quotes AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)
    cnt = con.execute("SELECT COUNT(*) FROM trade_nbbo_quotes").fetchone()[0]
    print(f"  trade_nbbo_quotes: {cnt:,} rows")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch NBBO quotes at Holly trade entry times via Massive.com"
    )
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--since", default=None)
    parser.add_argument("--limit-dates", type=int, default=None)
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
