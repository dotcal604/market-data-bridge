"""
37_fetch_alpaca_bars.py — Backfill missing 1-min bars from Alpaca Markets (free tier).

Alpaca free tier: 200 calls/min, IEX data, history since 2016.
Targets the pre-2021 gap that the Massive.com/Polygon key can't serve.

Features:
- Resumable: tracks completed pairs in a JSON progress file
- Concurrent: ThreadPoolExecutor with configurable workers (default 8)
- Rate-limited: token bucket at 190 calls/min (headroom below 200 limit)
- CLI filters: --limit, --symbol, --dry-run, --workers, --date-before
- Dual output: parquet files + DuckDB batch insert

Usage:
    python scripts/37_fetch_alpaca_bars.py --dry-run
    python scripts/37_fetch_alpaca_bars.py
    python scripts/37_fetch_alpaca_bars.py --symbol AAPL --date-before 2021-03-08
    python scripts/37_fetch_alpaca_bars.py --workers 4 --limit 500
"""

import argparse
import json
import os
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from config.settings import DUCKDB_PATH, PARQUET_DIR
from engine.data_loader import ensure_schema, get_db

# ── Constants ─────────────────────────────────────────────────────
ALPACA_BASE = "https://data.alpaca.markets/v2/stocks"
ALPACA_API_KEY = os.environ.get("ALPACA_API_KEY", "")
ALPACA_API_SECRET = os.environ.get("ALPACA_API_SECRET", "")
DEFAULT_WORKERS = 8
CALLS_PER_MIN = 190  # headroom below 200 limit

# Progress file
PROGRESS_FILE = DUCKDB_PATH.parent / "alpaca_backfill_progress.json"

# Bar columns (match Polygon schema for DuckDB compatibility)
BAR_COLUMNS = ["open", "high", "low", "close", "volume", "vwap", "num_trades"]


# ── Rate Limiter (token bucket) ───────────────────────────────────
class TokenBucketRateLimiter:
    """Thread-safe token bucket rate limiter."""

    def __init__(self, calls_per_min: int = CALLS_PER_MIN):
        self._lock = threading.Lock()
        self._tokens = float(calls_per_min)
        self._max_tokens = float(calls_per_min)
        self._refill_rate = calls_per_min / 60.0  # tokens per second
        self._last_refill = time.monotonic()

    def acquire(self) -> float:
        """Block until a token is available. Returns wait time."""
        while True:
            with self._lock:
                now = time.monotonic()
                elapsed = now - self._last_refill
                self._tokens = min(self._max_tokens, self._tokens + elapsed * self._refill_rate)
                self._last_refill = now

                if self._tokens >= 1.0:
                    self._tokens -= 1.0
                    return 0.0

            # No tokens — sleep briefly and retry
            time.sleep(0.05)


# ── Progress persistence ──────────────────────────────────────────
def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        try:
            return json.loads(PROGRESS_FILE.read_text())
        except Exception:
            pass
    return {"completed": [], "failed": []}


def save_progress(progress: dict):
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(json.dumps(progress, indent=2))


# ── Fetch single symbol-date pair ─────────────────────────────────
rate_limiter = TokenBucketRateLimiter()


def fetch_bars(client: httpx.Client, symbol: str, date_str: str, retry_max: int = 3):
    """
    Fetch 1-min bars for a single symbol on a single date from Alpaca.
    Returns (success: bool, message: str, df: pd.DataFrame | None)
    """
    # Alpaca expects RFC-3339 or YYYY-MM-DD
    start = f"{date_str}T09:30:00-05:00"  # market open ET
    end = f"{date_str}T16:00:00-05:00"    # market close ET

    url = f"{ALPACA_BASE}/{symbol}/bars"
    params = {
        "timeframe": "1Min",
        "start": start,
        "end": end,
        "limit": 10000,
        "adjustment": "all",
        "feed": "sip",
        "sort": "asc",
    }
    headers = {
        "APCA-API-KEY-ID": ALPACA_API_KEY,
        "APCA-API-SECRET-KEY": ALPACA_API_SECRET,
    }

    all_bars = []

    for attempt in range(retry_max):
        rate_limiter.acquire()

        try:
            resp = client.get(url, params=params, headers=headers, timeout=30)

            if resp.status_code == 429:
                # Rate limited — back off
                retry_after = int(resp.headers.get("Retry-After", "5"))
                time.sleep(retry_after)
                continue

            if resp.status_code == 404:
                return False, "404 not found", None

            if resp.status_code == 403:
                return False, "403 forbidden (check API keys)", None

            if resp.status_code == 422:
                return False, f"422 unprocessable ({symbol} may be invalid)", None

            if resp.status_code != 200:
                return False, f"HTTP {resp.status_code}", None

            data = resp.json()
            bars = data.get("bars", [])

            if not bars:
                return False, "empty (no bars returned)", None

            all_bars.extend(bars)

            # Handle pagination
            next_token = data.get("next_page_token")
            while next_token:
                rate_limiter.acquire()
                params["page_token"] = next_token
                resp = client.get(url, params=params, headers=headers, timeout=30)
                if resp.status_code != 200:
                    break
                data = resp.json()
                page_bars = data.get("bars", [])
                if page_bars:
                    all_bars.extend(page_bars)
                next_token = data.get("next_page_token")

            # Remove page_token for next call
            params.pop("page_token", None)

            # Convert to DataFrame
            df = pd.DataFrame(all_bars)
            df = df.rename(columns={
                "t": "timestamp", "o": "open", "h": "high",
                "l": "low", "c": "close", "v": "volume",
                "vw": "vwap", "n": "num_trades",
            })

            # Convert timestamp to Eastern Time (tz-naive)
            df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
            df["timestamp"] = df["timestamp"].dt.tz_convert("America/New_York").dt.tz_localize(None)

            # Ensure all expected columns exist
            for col in BAR_COLUMNS:
                if col not in df.columns:
                    df[col] = None

            df = df[["timestamp"] + BAR_COLUMNS]
            return True, f"{len(df)} bars", df

        except httpx.TimeoutException:
            if attempt < retry_max - 1:
                time.sleep(2 ** attempt)
                continue
            return False, "timeout", None
        except Exception as e:
            return False, str(e)[:80], None

    return False, "max retries", None


# ── DuckDB insert ─────────────────────────────────────────────────
def insert_bars_to_duckdb(db, df: pd.DataFrame, symbol: str) -> int:
    """Insert bars into the DuckDB bars table. Returns rows inserted."""
    if df.empty:
        return 0

    insert_df = df.copy()
    insert_df.insert(0, "symbol", symbol)
    insert_df = insert_df.rename(columns={"timestamp": "bar_time"})

    db.execute("""
        INSERT OR REPLACE INTO bars (symbol, bar_time, open, high, low, close, volume, vwap, num_trades)
        SELECT symbol, bar_time, open, high, low, close, volume, vwap, num_trades
        FROM insert_df
    """)
    return len(insert_df)


# ── Discovery: find missing pairs ─────────────────────────────────
def find_missing_pairs(db) -> list[tuple[str, str]]:
    """Find (symbol, trade_date) pairs with no bars."""
    all_pairs = db.execute("""
        SELECT DISTINCT symbol, CAST(entry_time AS DATE) AS trade_date
        FROM trades
        ORDER BY trade_date, symbol
    """).fetchdf()

    # Existing bars in DuckDB
    existing_in_db = set()
    try:
        existing_db_rows = db.execute("""
            SELECT DISTINCT symbol, CAST(bar_time AS DATE) AS bar_date
            FROM bars
        """).fetchdf()
        for _, row in existing_db_rows.iterrows():
            existing_in_db.add((row["symbol"], str(row["bar_date"])[:10]))
    except Exception:
        pass

    missing = []
    for _, row in all_pairs.iterrows():
        sym = row["symbol"]
        date_str = str(row["trade_date"])[:10]
        if (sym, date_str) not in existing_in_db:
            parquet_path = PARQUET_DIR / f"{sym}_{date_str}.parquet"
            if not parquet_path.exists():
                missing.append((sym, date_str))

    return missing


# ── Main ──────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Backfill missing 1-min bars from Alpaca Markets (free tier)"
    )
    parser.add_argument("--limit", type=int, default=0, help="Max pairs to fetch (0 = all)")
    parser.add_argument("--symbol", type=str, default=None, help="Fetch only this symbol")
    parser.add_argument("--dry-run", action="store_true", help="Show plan without fetching")
    parser.add_argument("--force", action="store_true", help="Ignore progress file")
    parser.add_argument("--reset-progress", action="store_true", help="Delete progress and start fresh")
    parser.add_argument(
        "--date-before", type=str, default="2021-03-08",
        help="Only fetch dates before this cutoff (default: 2021-03-08, the Polygon gap)"
    )
    parser.add_argument(
        "--date-after", type=str, default="2016-01-01",
        help="Only fetch dates after this (default: 2016-01-01, Alpaca's earliest)"
    )
    parser.add_argument(
        "--workers", type=int, default=DEFAULT_WORKERS,
        help=f"Concurrent fetch workers (default: {DEFAULT_WORKERS})"
    )
    args = parser.parse_args()

    # ── Validate API keys ─────────────────────────────────────────
    if not ALPACA_API_KEY or not ALPACA_API_SECRET:
        print("ERROR: ALPACA_API_KEY and ALPACA_API_SECRET are not set.")
        print()
        print("  Set them in your .env file:")
        print("    ALPACA_API_KEY=your_key_id")
        print("    ALPACA_API_SECRET=your_secret_key")
        print()
        print("  Get free API keys at: https://app.alpaca.markets/")
        sys.exit(1)

    # ── Progress management ───────────────────────────────────────
    if args.reset_progress and PROGRESS_FILE.exists():
        PROGRESS_FILE.unlink()
        print(f"Deleted progress file: {PROGRESS_FILE}")

    progress = load_progress()
    completed_set = set(progress["completed"])

    # ── Find missing pairs ────────────────────────────────────────
    db = get_db()
    ensure_schema(db)

    print("Scanning for missing (symbol, trade_date) pairs...", flush=True)
    missing_pairs = find_missing_pairs(db)

    # Apply date window filter (target the Polygon gap)
    before = len(missing_pairs)
    missing_pairs = [
        (s, d) for s, d in missing_pairs
        if args.date_after <= d < args.date_before
    ]
    filtered_out = before - len(missing_pairs)
    if filtered_out > 0:
        print(f"Filtered to dates [{args.date_after}, {args.date_before}): {filtered_out} pairs outside window", flush=True)

    # Filter by symbol
    if args.symbol:
        missing_pairs = [(s, d) for s, d in missing_pairs if s == args.symbol]
        print(f"Filtered to symbol: {args.symbol}", flush=True)

    # Exclude completed pairs
    if not args.force:
        before = len(missing_pairs)
        missing_pairs = [(s, d) for s, d in missing_pairs if f"{s}_{d}" not in completed_set]
        skipped = before - len(missing_pairs)
        if skipped > 0:
            print(f"Skipping {skipped} pairs already in progress tracker", flush=True)

    # Apply limit
    if args.limit > 0:
        missing_pairs = missing_pairs[:args.limit]

    # ── Summary ───────────────────────────────────────────────────
    total_trades = db.execute("SELECT COUNT(*) FROM trades").fetchone()[0]
    trades_with_bars = db.execute("""
        SELECT COUNT(DISTINCT t.trade_id)
        FROM trades t
        WHERE EXISTS (
            SELECT 1 FROM bars b
            WHERE b.symbol = t.symbol
            AND CAST(b.bar_time AS DATE) = CAST(t.entry_time AS DATE)
        )
    """).fetchone()[0]

    est_minutes = len(missing_pairs) / CALLS_PER_MIN
    print(flush=True)
    print("=" * 60, flush=True)
    print("  Alpaca Free Tier Bar Backfill", flush=True)
    print("=" * 60, flush=True)
    print(f"  Total trades in DB:        {total_trades:,}", flush=True)
    print(f"  Trades with bar data:      {trades_with_bars:,} ({trades_with_bars/total_trades*100:.1f}%)", flush=True)
    print(f"  Missing trade-day pairs:   {len(missing_pairs):,}", flush=True)
    print(f"  Date window:               [{args.date_after}, {args.date_before})", flush=True)
    print(f"  Workers:                   {args.workers}", flush=True)
    print(f"  Rate limit:                {CALLS_PER_MIN} calls/min", flush=True)
    print(f"  Estimated time:            {est_minutes:.0f} min ({est_minutes/60:.1f} hours)", flush=True)
    print(f"  Progress file:             {PROGRESS_FILE}", flush=True)
    print(f"  Parquet output:            {PARQUET_DIR}", flush=True)
    print("=" * 60, flush=True)

    if not missing_pairs:
        print("\nNothing to fetch — all pairs covered!", flush=True)
        return

    if args.dry_run:
        # Show sample
        from collections import defaultdict
        by_sym = defaultdict(list)
        for s, d in missing_pairs:
            by_sym[s].append(d)
        print(f"\nDRY RUN: Would fetch {len(missing_pairs)} symbol-date pairs:\n", flush=True)
        for sym in sorted(by_sym)[:20]:
            dates = sorted(by_sym[sym])
            print(f"  {sym}: {len(dates)} dates ({dates[0]} to {dates[-1]})", flush=True)
        if len(by_sym) > 20:
            print(f"  ... and {len(by_sym) - 20} more symbols", flush=True)
        unique_syms = len(by_sym)
        print(f"\nTotal: {unique_syms} symbols, {len(missing_pairs)} pairs", flush=True)
        return

    # ── Concurrent fetch ──────────────────────────────────────────
    print(f"\nStarting concurrent fetch of {len(missing_pairs)} pairs ({args.workers} workers)...", flush=True)
    print("  (Ctrl+C to stop — progress is saved periodically)\n", flush=True)

    PARQUET_DIR.mkdir(parents=True, exist_ok=True)

    success_count = 0
    fail_count = 0
    total_bars = 0
    counter_lock = threading.Lock()
    start_time = time.monotonic()
    processed = 0

    def fetch_worker(client, sym, date_str):
        return fetch_bars(client, sym, date_str)

    try:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            client = httpx.Client(http2=False)
            futures = {}
            for sym, date_str in missing_pairs:
                fut = executor.submit(fetch_worker, client, sym, date_str)
                futures[fut] = (sym, date_str)

            for fut in as_completed(futures):
                sym, date_str = futures[fut]
                try:
                    ok, msg, df = fut.result()
                except Exception as e:
                    ok, msg, df = False, str(e)[:80], None

                with counter_lock:
                    processed += 1
                    if ok and df is not None and not df.empty:
                        success_count += 1
                        bars_inserted = insert_bars_to_duckdb(db, df, sym)
                        total_bars += bars_inserted

                        # Save parquet
                        pq_path = PARQUET_DIR / f"{sym}_{date_str}.parquet"
                        table = pa.Table.from_pandas(df)
                        pq.write_table(table, pq_path)

                        progress["completed"].append(f"{sym}_{date_str}")
                    else:
                        fail_count += 1
                        progress["failed"].append(f"{sym}_{date_str}")
                        progress["completed"].append(f"{sym}_{date_str}")  # don't retry

                    # Progress report every 50 pairs
                    if processed % 50 == 0:
                        elapsed = time.monotonic() - start_time
                        rate = processed / elapsed if elapsed > 0 else 0
                        remaining = len(missing_pairs) - processed
                        eta = remaining / rate / 60 if rate > 0 else 0
                        print(
                            f"  [{processed}/{len(missing_pairs)}] "
                            f"ok={success_count} skip={fail_count} "
                            f"bars={total_bars:,} rate={rate:.1f}/s ETA={eta:.1f}m",
                            flush=True,
                        )

                    # Save progress every 200 pairs
                    if processed % 200 == 0:
                        save_progress(progress)

            client.close()

    except KeyboardInterrupt:
        print("\n\nInterrupted! Saving progress...", flush=True)
    finally:
        save_progress(progress)

    # ── Final summary ─────────────────────────────────────────────
    elapsed = time.monotonic() - start_time
    trades_with_bars_after = db.execute("""
        SELECT COUNT(DISTINCT t.trade_id)
        FROM trades t
        WHERE EXISTS (
            SELECT 1 FROM bars b
            WHERE b.symbol = t.symbol
            AND CAST(b.bar_time AS DATE) = CAST(t.entry_time AS DATE)
        )
    """).fetchone()[0]

    print(flush=True)
    print("=" * 60, flush=True)
    print("  Backfill Complete", flush=True)
    print("=" * 60, flush=True)
    print(f"  Duration:                {elapsed/60:.1f} min ({elapsed/3600:.1f} hours)", flush=True)
    print(f"  Pairs fetched (OK):      {success_count:,}", flush=True)
    print(f"  Pairs failed/empty:      {fail_count:,}", flush=True)
    print(f"  Bars inserted to DuckDB: {total_bars:,}", flush=True)
    print(f"  Coverage before:         {trades_with_bars:,}/{total_trades:,} ({trades_with_bars/total_trades*100:.1f}%)", flush=True)
    print(f"  Coverage after:          {trades_with_bars_after:,}/{total_trades:,} ({trades_with_bars_after/total_trades*100:.1f}%)", flush=True)
    print(f"  Progress file:           {PROGRESS_FILE}", flush=True)
    print("=" * 60, flush=True)


if __name__ == "__main__":
    main()
