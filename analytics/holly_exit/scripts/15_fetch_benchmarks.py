"""
15_fetch_benchmarks.py — Fetch 5yr minute bars for benchmark & sector ETFs,
                          plus grouped daily bars for the full market.

Polygon Stocks Starter plan — unlimited rate, 5yr lookback.

Usage:
    python scripts/15_fetch_benchmarks.py
    python scripts/15_fetch_benchmarks.py --only minutes     # ETFs only
    python scripts/15_fetch_benchmarks.py --only grouped     # Grouped daily only
"""

import argparse
import asyncio
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import POLYGON_API_KEY, DATA_DIR, POLYGON_CONCURRENCY, POLYGON_RETRY_MAX, POLYGON_RETRY_BACKOFF

POLYGON_BASE = "https://api.polygon.io"

# 5yr lookback from today (Polygon Stocks Starter plan limit)
MIN_DATE = date(2021, 3, 5)
MAX_DATE = date(2026, 3, 5)

# ── Symbols to fetch ──────────────────────────────────────────
BENCHMARK_ETFS = ["SPY", "QQQ", "IWM", "DIA"]

SECTOR_ETFS = [
    "XLF",   # Financials
    "XLK",   # Technology
    "XLE",   # Energy
    "XLV",   # Healthcare
    "XLI",   # Industrials
    "XLP",   # Consumer Staples
    "XLU",   # Utilities
    "XLB",   # Materials
    "XLRE",  # Real Estate
    "XLC",   # Communication Services
    "XLY",   # Consumer Discretionary
]

ALL_ETFS = BENCHMARK_ETFS + SECTOR_ETFS

# ── Output dirs ───────────────────────────────────────────────
MINUTE_DIR = DATA_DIR / "parquet" / "etf_minutes"
GROUPED_DIR = DATA_DIR / "parquet" / "grouped_daily"


def trading_days(start: date, end: date) -> list[str]:
    """Generate approximate trading days (Mon-Fri, no holiday filtering)."""
    days = []
    d = start
    while d <= end:
        if d.weekday() < 5:  # Mon=0 ... Fri=4
            days.append(d.isoformat())
        d += timedelta(days=1)
    return days


# ── Minute bar fetcher (reuse pattern from 03) ────────────────

async def fetch_minute_bar(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    symbol: str,
    date_str: str,
    out_dir: Path,
) -> tuple[str, bool, str]:
    """Fetch 1-min bars for one symbol-date."""
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
                    await asyncio.sleep(POLYGON_RETRY_BACKOFF ** (attempt + 1))
                    continue
                if resp.status_code in (404, 403):
                    return key, False, str(resp.status_code)
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
                pq.write_table(pa.Table.from_pandas(df), str(out_file))
                return key, True, f"{len(df)} bars"

            except httpx.TimeoutException:
                if attempt < POLYGON_RETRY_MAX - 1:
                    await asyncio.sleep(POLYGON_RETRY_BACKOFF ** (attempt + 1))
                    continue
                return key, False, "timeout"
            except Exception as e:
                return key, False, str(e)

    return key, False, "max retries"


# ── Grouped daily bar fetcher ─────────────────────────────────

async def fetch_grouped_daily(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    date_str: str,
    out_dir: Path,
) -> tuple[str, bool, str]:
    """Fetch grouped daily bars (all tickers for one date)."""
    out_file = out_dir / f"grouped_{date_str}.parquet"

    if out_file.exists():
        return date_str, True, "cached"

    url = f"{POLYGON_BASE}/v2/aggs/grouped/locale/us/market/stocks/{date_str}"
    params = {
        "adjusted": "true",
        "apiKey": POLYGON_API_KEY,
    }

    for attempt in range(POLYGON_RETRY_MAX):
        async with sem:
            try:
                resp = await client.get(url, params=params, timeout=60)

                if resp.status_code == 429:
                    await asyncio.sleep(POLYGON_RETRY_BACKOFF ** (attempt + 1))
                    continue
                if resp.status_code in (404, 403):
                    return date_str, False, str(resp.status_code)
                if resp.status_code != 200:
                    return date_str, False, f"HTTP {resp.status_code}"

                data = resp.json()
                results = data.get("results", [])
                if not results:
                    return date_str, False, "empty (holiday?)"

                df = pd.DataFrame(results)
                # Rename Polygon fields
                rename_map = {
                    "T": "symbol", "o": "open", "h": "high", "l": "low",
                    "c": "close", "v": "volume", "vw": "vwap", "n": "num_trades",
                    "t": "timestamp",
                }
                df = df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns})

                # Add date column
                df["bar_date"] = date_str

                cols = ["symbol", "bar_date", "open", "high", "low", "close", "volume"]
                for c in ["vwap", "num_trades"]:
                    if c in df.columns:
                        cols.append(c)
                for c in cols:
                    if c not in df.columns:
                        df[c] = 0
                df = df[cols]

                if "volume" in df.columns:
                    df["volume"] = df["volume"].fillna(0).astype("int64")
                if "num_trades" in df.columns:
                    df["num_trades"] = df["num_trades"].fillna(0).astype("int64")

                out_dir.mkdir(parents=True, exist_ok=True)
                pq.write_table(pa.Table.from_pandas(df), str(out_file))
                return date_str, True, f"{len(df)} tickers"

            except httpx.TimeoutException:
                if attempt < POLYGON_RETRY_MAX - 1:
                    await asyncio.sleep(POLYGON_RETRY_BACKOFF ** (attempt + 1))
                    continue
                return date_str, False, "timeout"
            except Exception as e:
                return date_str, False, str(e)

    return date_str, False, "max retries"


# ── Progress printer ──────────────────────────────────────────

def print_progress(done: int, total: int, key: str, msg: str, success: int, fail: int, t0: float):
    if done % 100 == 0 or done == total or done <= 3:
        elapsed = time.time() - t0
        rate = done / max(elapsed, 0.1)
        eta = (total - done) / max(rate, 0.01)
        print(
            f"  [{done}/{total}] {key}: {msg}  "
            f"| ok={success} fail={fail}  "
            f"| {rate:.1f}/s, ETA {eta / 60:.1f}m",
            flush=True,
        )


# ── Main ──────────────────────────────────────────────────────

async def run_etf_minutes():
    """Fetch 5yr minute bars for all benchmark + sector ETFs."""
    print("=" * 60)
    print("ETF Minute Bars — Benchmark + Sector ETFs")
    print("=" * 60)

    days = trading_days(MIN_DATE, MAX_DATE)
    pairs = [(sym, d) for sym in ALL_ETFS for d in days]

    MINUTE_DIR.mkdir(parents=True, exist_ok=True)
    cached = sum(1 for sym, d in pairs if (MINUTE_DIR / f"{sym}_{d}.parquet").exists())
    to_fetch = len(pairs) - cached

    print(f"  ETFs: {len(ALL_ETFS)} ({', '.join(ALL_ETFS)})")
    print(f"  Date range: {MIN_DATE} to {MAX_DATE}")
    print(f"  Trading days: {len(days)}")
    print(f"  Total pairs: {len(pairs):,}")
    print(f"  Cached: {cached:,}")
    print(f"  To fetch: {to_fetch:,}")
    print(flush=True)

    if to_fetch == 0:
        print("All ETF minute bars already fetched!")
        return

    sem = asyncio.Semaphore(POLYGON_CONCURRENCY)
    success = fail = 0
    t0 = time.time()

    async with httpx.AsyncClient() as client:
        tasks = [
            fetch_minute_bar(client, sem, sym, d, MINUTE_DIR)
            for sym, d in pairs
        ]
        total = len(tasks)
        for coro in asyncio.as_completed(tasks):
            key, ok, msg = await coro
            if ok:
                success += 1
            else:
                fail += 1
            print_progress(success + fail, total, key, msg, success, fail, t0)

    elapsed = time.time() - t0
    total_bytes = sum(f.stat().st_size for f in MINUTE_DIR.glob("*.parquet"))
    print(f"\nETF minutes done in {elapsed / 60:.1f}m — ok={success}, fail={fail}, {total_bytes / 1e6:.1f} MB")


async def run_grouped_daily():
    """Fetch grouped daily bars for the entire market."""
    print("\n" + "=" * 60)
    print("Grouped Daily Bars — All US Stocks")
    print("=" * 60)

    days = trading_days(MIN_DATE, MAX_DATE)

    GROUPED_DIR.mkdir(parents=True, exist_ok=True)
    cached = sum(1 for d in days if (GROUPED_DIR / f"grouped_{d}.parquet").exists())
    to_fetch = len(days) - cached

    print(f"  Date range: {MIN_DATE} to {MAX_DATE}")
    print(f"  Trading days: {len(days)}")
    print(f"  Cached: {cached}")
    print(f"  To fetch: {to_fetch}")
    print(flush=True)

    if to_fetch == 0:
        print("All grouped daily bars already fetched!")
        return

    # Lower concurrency for grouped (each response is large)
    sem = asyncio.Semaphore(5)
    success = fail = 0
    t0 = time.time()

    async with httpx.AsyncClient() as client:
        tasks = [
            fetch_grouped_daily(client, sem, d, GROUPED_DIR)
            for d in days
        ]
        total = len(tasks)
        for coro in asyncio.as_completed(tasks):
            key, ok, msg = await coro
            if ok:
                success += 1
            else:
                fail += 1
            print_progress(success + fail, total, key, msg, success, fail, t0)

    elapsed = time.time() - t0
    total_bytes = sum(f.stat().st_size for f in GROUPED_DIR.glob("*.parquet"))
    print(f"\nGrouped daily done in {elapsed / 60:.1f}m — ok={success}, fail={fail}, {total_bytes / 1e6:.1f} MB")


async def main_async(only: str | None = None):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    if only in (None, "minutes"):
        await run_etf_minutes()

    if only in (None, "grouped"):
        await run_grouped_daily()

    print("\n" + "=" * 60)
    print("All fetches complete!")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="Fetch benchmark/sector ETFs + grouped daily bars")
    parser.add_argument("--only", choices=["minutes", "grouped"], default=None,
                        help="Run only one fetch type")
    args = parser.parse_args()
    asyncio.run(main_async(only=args.only))


if __name__ == "__main__":
    main()
