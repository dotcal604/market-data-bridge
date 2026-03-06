"""
03_fetch_bars.py — Pull 1-min bars from Polygon for all Holly trades.

Fast async mode for paid API key (unlimited rate):
- 10 concurrent connections
- Resume support via existing parquet files
- One parquet per symbol-date
- Scoped to 5-year lookback (Stocks Starter plan)

Usage:
    python scripts/03_fetch_bars.py
"""

import asyncio
import json
import sys
import time
from pathlib import Path

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import (
    POLYGON_API_KEY,
    PARQUET_DIR,
    DATA_DIR,
    POLYGON_CONCURRENCY,
    POLYGON_RETRY_MAX,
    POLYGON_RETRY_BACKOFF,
)
from engine.data_loader import get_db

POLYGON_BASE = "https://api.polygon.io"
AUDIT_FILE = DATA_DIR / "ticker_audit.json"

# ~5yr lookback from today (Polygon Stocks Starter plan limit)
MIN_DATE = "2020-03-05"


async def fetch_one(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    symbol: str,
    date_str: str,
    out_dir: Path,
) -> tuple[str, bool, str]:
    """Fetch 1-min bars for one symbol-date. Returns (key, success, message)."""
    key = f"{symbol}_{date_str}"
    out_file = out_dir / f"{key}.parquet"

    if out_file.exists():
        return key, True, "cached"

    url = f"{POLYGON_BASE}/v2/aggs/ticker/{symbol}/range/1/minute/{date_str}/{date_str}"
    params = {
        "adjusted": "true",
        "sort": "asc",
        "limit": "50000",
        "apiKey": POLYGON_API_KEY,
    }

    for attempt in range(POLYGON_RETRY_MAX):
        async with sem:
            try:
                resp = await client.get(url, params=params, timeout=30)

                if resp.status_code == 429:
                    wait = POLYGON_RETRY_BACKOFF ** (attempt + 1)
                    await asyncio.sleep(wait)
                    continue

                if resp.status_code == 404:
                    return key, False, "404"

                if resp.status_code == 403:
                    return key, False, "403"

                if resp.status_code != 200:
                    return key, False, f"HTTP {resp.status_code}"

                data = resp.json()
                results = data.get("results", [])

                if not results:
                    return key, False, "empty"

                df = pd.DataFrame(results)
                df = df.rename(columns={
                    "t": "timestamp", "o": "open", "h": "high",
                    "l": "low", "c": "close", "v": "volume",
                    "vw": "vwap", "n": "num_trades",
                })

                df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
                df["timestamp"] = df["timestamp"].dt.tz_convert("America/New_York").dt.tz_localize(None)

                cols = ["timestamp", "open", "high", "low", "close", "volume", "vwap", "num_trades"]
                for c in cols:
                    if c not in df.columns:
                        df[c] = 0
                df = df[cols]
                df["volume"] = df["volume"].astype("int64")
                df["num_trades"] = df["num_trades"].astype("int64")

                out_dir.mkdir(parents=True, exist_ok=True)
                table = pa.Table.from_pandas(df)
                pq.write_table(table, str(out_file))

                bar_count = len(df)
                return key, True, f"{bar_count} bars"

            except httpx.TimeoutException:
                if attempt < POLYGON_RETRY_MAX - 1:
                    await asyncio.sleep(POLYGON_RETRY_BACKOFF ** (attempt + 1))
                    continue
                return key, False, "timeout"

            except Exception as e:
                return key, False, str(e)

    return key, False, "max retries"


async def main_async():
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env", flush=True)
        sys.exit(1)

    db = get_db()

    pairs = db.execute(f"""
        SELECT DISTINCT symbol, CAST(entry_time AS DATE) AS trade_date
        FROM trades
        WHERE CAST(entry_time AS DATE) >= '{MIN_DATE}'
        ORDER BY trade_date, symbol
    """).fetchdf()

    print(f"Scope: trades from {MIN_DATE} onward (5-year lookback)", flush=True)

    # Exclude missing tickers from audit
    missing_tickers = set()
    if AUDIT_FILE.exists():
        audit = json.loads(AUDIT_FILE.read_text(encoding="utf-8"))
        missing_tickers = set(audit.get("missing", []))
        if missing_tickers:
            print(f"Excluding {len(missing_tickers)} missing tickers from audit.", flush=True)

    # ── Build 20-day minute lookback pairs ────────────────────────────
    # For each trade, we need minute bars for the 20 trading days before
    # the trade date (regime context at minute resolution).
    # Use daily_bars (from Yahoo) to find actual trading days.
    LOOKBACK_TRADING_DAYS = 20

    tasks_set = set()
    lookback_count = 0

    for _, row in pairs.iterrows():
        sym = row["symbol"]
        if sym in missing_tickers:
            continue
        date_str = str(row["trade_date"])[:10]
        tasks_set.add((sym, date_str))  # trade day itself

        # Get 20 trading days before trade date from daily_bars
        lookback = db.execute("""
            SELECT DISTINCT bar_date
            FROM daily_bars
            WHERE symbol = ? AND bar_date < ? AND bar_date >= ?
            ORDER BY bar_date DESC
            LIMIT ?
        """, [sym, date_str, MIN_DATE, LOOKBACK_TRADING_DAYS]).fetchdf()

        for _, d in lookback.iterrows():
            lb_date = str(d["bar_date"])[:10]
            if (sym, lb_date) not in tasks_set:
                lookback_count += 1
            tasks_set.add((sym, lb_date))

    db.close()

    tasks_list = sorted(tasks_set)
    print(f"Trade-day pairs: {len(pairs):,}", flush=True)
    print(f"Lookback pairs added: {lookback_count:,}", flush=True)
    print(f"Total unique pairs: {len(tasks_list):,}", flush=True)

    # Check cached
    PARQUET_DIR.mkdir(parents=True, exist_ok=True)
    cached = sum(1 for sym, dt in tasks_list if (PARQUET_DIR / f"{sym}_{dt}.parquet").exists())
    to_fetch = len(tasks_list) - cached

    print(f"Total symbol-date pairs: {len(tasks_list)}", flush=True)
    print(f"Already cached:          {cached}", flush=True)
    print(f"To fetch:                {to_fetch}", flush=True)
    print(f"Concurrency:             {POLYGON_CONCURRENCY}", flush=True)
    print(flush=True)

    if to_fetch == 0:
        print("All bars already fetched!", flush=True)
        return

    sem = asyncio.Semaphore(POLYGON_CONCURRENCY)
    success = 0
    fail = 0
    t0 = time.time()

    async with httpx.AsyncClient() as client:
        tasks = [
            fetch_one(client, sem, sym, dt, PARQUET_DIR)
            for sym, dt in tasks_list
        ]

        total = len(tasks)
        for i, coro in enumerate(asyncio.as_completed(tasks)):
            key, ok, msg = await coro
            if ok:
                success += 1
            else:
                fail += 1

            done = success + fail
            if done % 200 == 0 or done == total or done <= 5:
                elapsed = time.time() - t0
                rate = done / max(elapsed, 0.1)
                eta = (total - done) / max(rate, 0.01)
                print(
                    f"  [{done}/{total}] {key}: {msg}  "
                    f"| ok={success} fail={fail}  "
                    f"| {rate:.1f}/s, ETA {eta / 60:.1f}m",
                    flush=True,
                )

    elapsed = time.time() - t0
    total_bytes = sum(f.stat().st_size for f in PARQUET_DIR.glob("*.parquet"))

    print(f"\nDone in {elapsed / 60:.1f} minutes ({elapsed / 3600:.1f} hours)", flush=True)
    print(f"  Fetched: {success}", flush=True)
    print(f"  Failed:  {fail}", flush=True)
    print(f"  Disk:    {total_bytes / 1e6:.1f} MB", flush=True)


def main():
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
