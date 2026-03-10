"""
36_fetch_polygon_bars.py — Backfill missing 1-min bars from Polygon.io.

The Silver layer has ~77% of trades missing minute bar data. This script
identifies missing (symbol, trade_date) pairs and fetches them from Polygon
with concurrent requests (up to 10 workers).

Features:
- Resumable: tracks completed pairs in a JSON progress file
- Concurrent: ThreadPoolExecutor with configurable workers (default 10)
- Rate-limited: adaptive — backs off on 429s, otherwise runs full speed
- CLI filters: --limit, --symbol, --dry-run, --workers
- Dual output: parquet files + DuckDB batch insert

Usage:
    python scripts/36_fetch_polygon_bars.py
    python scripts/36_fetch_polygon_bars.py --dry-run
    python scripts/36_fetch_polygon_bars.py --symbol AAPL
    python scripts/36_fetch_polygon_bars.py --limit 50
    python scripts/36_fetch_polygon_bars.py --workers 5
"""

import argparse
import json
import sys
import time
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import DUCKDB_PATH, PARQUET_DIR, POLYGON_API_KEY
from engine.data_loader import ensure_schema, get_db

# ── Constants ─────────────────────────────────────────────────────
POLYGON_BASE = "https://api.polygon.io"
DEFAULT_WORKERS = 10

# Progress file lives next to the DuckDB file
PROGRESS_FILE = DUCKDB_PATH.parent / "polygon_backfill_progress.json"

# Columns expected in parquet files (must match 03_fetch_bars.py convention)
BAR_COLUMNS = [
    "timestamp", "open", "high", "low", "close",
    "volume", "vwap", "num_trades",
]


# ── Progress tracker ──────────────────────────────────────────────
def load_progress() -> dict:
    """Load the progress tracker from disk."""
    if PROGRESS_FILE.exists():
        try:
            return json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {"completed": [], "failed": {}, "started_at": None}
    return {"completed": [], "failed": {}, "started_at": None}


def save_progress(progress: dict) -> None:
    """Persist progress tracker to disk."""
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(
        json.dumps(progress, indent=2, default=str),
        encoding="utf-8",
    )


# ── Adaptive rate limiter (thread-safe) ──────────────────────────
class AdaptiveRateLimiter:
    """
    Adaptive rate limiter for concurrent Polygon requests.

    Runs at full speed by default. On 429 responses, introduces
    a global cooldown that all threads respect.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._cooldown_until = 0.0
        self._consecutive_429s = 0

    def wait_if_needed(self) -> float:
        """Block if we're in a cooldown period."""
        with self._lock:
            now = time.monotonic()
            if now < self._cooldown_until:
                wait = self._cooldown_until - now
            else:
                wait = 0.0

        if wait > 0:
            time.sleep(wait)
        return wait

    def on_429(self) -> None:
        """Called when a 429 is received — backs off all threads."""
        with self._lock:
            self._consecutive_429s += 1
            backoff = min(2 ** self._consecutive_429s, 30)
            self._cooldown_until = time.monotonic() + backoff
            print(f"    429 rate limited — global cooldown {backoff}s", flush=True)

    def on_success(self) -> None:
        """Called on success — resets backoff counter."""
        with self._lock:
            self._consecutive_429s = 0


# ── Fetch logic ───────────────────────────────────────────────────
def fetch_one_pair(
    client: httpx.Client,
    rate_limiter: AdaptiveRateLimiter,
    symbol: str,
    date_str: str,
    retry_max: int = 3,
) -> tuple[bool, str, pd.DataFrame | None]:
    """
    Fetch 1-minute bars for a single symbol-date pair.

    Returns:
        (success, message, dataframe_or_none)
    """
    url = f"{POLYGON_BASE}/v2/aggs/ticker/{symbol}/range/1/minute/{date_str}/{date_str}"
    params = {
        "adjusted": "true",
        "sort": "asc",
        "limit": "50000",
        "apiKey": POLYGON_API_KEY,
    }

    for attempt in range(retry_max):
        rate_limiter.wait_if_needed()

        try:
            resp = client.get(url, params=params, timeout=30)

            if resp.status_code == 429:
                rate_limiter.on_429()
                continue

            rate_limiter.on_success()

            if resp.status_code == 404:
                return False, "404 not found", None

            if resp.status_code == 403:
                return False, "403 forbidden (check API key)", None

            if resp.status_code != 200:
                return False, f"HTTP {resp.status_code}", None

            data = resp.json()
            results = data.get("results", [])

            if not results:
                return False, "empty (no bars returned)", None

            df = pd.DataFrame(results)
            df = df.rename(columns={
                "t": "timestamp", "o": "open", "h": "high",
                "l": "low", "c": "close", "v": "volume",
                "vw": "vwap", "n": "num_trades",
            })

            # Convert epoch ms to Eastern Time (tz-naive), matching 03_fetch_bars.py
            df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
            df["timestamp"] = df["timestamp"].dt.tz_convert("America/New_York").dt.tz_localize(None)

            # Ensure all expected columns exist
            for col in BAR_COLUMNS:
                if col not in df.columns:
                    df[col] = 0

            df = df[BAR_COLUMNS]
            df["volume"] = df["volume"].astype("int64")
            df["num_trades"] = df["num_trades"].astype("int64")

            return True, f"{len(df)} bars", df

        except httpx.TimeoutException:
            if attempt < retry_max - 1:
                time.sleep(retry_backoff ** (attempt + 1))
                continue
            return False, "timeout after retries", None

        except Exception as e:
            return False, f"error: {e}", None

    return False, "max retries exhausted", None


def save_parquet(df: pd.DataFrame, symbol: str, date_str: str) -> Path:
    """Save bars DataFrame to parquet, matching 03_fetch_bars.py naming convention."""
    PARQUET_DIR.mkdir(parents=True, exist_ok=True)
    # Flat file convention: {SYMBOL}_{YYYY-MM-DD}.parquet
    out_file = PARQUET_DIR / f"{symbol}_{date_str}.parquet"
    table = pa.Table.from_pandas(df)
    pq.write_table(table, str(out_file))
    return out_file


def insert_bars_to_duckdb(db, df: pd.DataFrame, symbol: str) -> int:
    """Insert bars into the DuckDB bars table. Returns rows inserted."""
    if df.empty:
        return 0

    insert_df = df.copy()
    insert_df.insert(0, "symbol", symbol)
    insert_df = insert_df.rename(columns={"timestamp": "bar_time"})

    # Use INSERT OR REPLACE to handle any existing rows (dedup by PK)
    db.execute("""
        INSERT OR REPLACE INTO bars (symbol, bar_time, open, high, low, close, volume, vwap, num_trades)
        SELECT symbol, bar_time, open, high, low, close, volume, vwap, num_trades
        FROM insert_df
    """)
    return len(insert_df)


# ── Discovery: find missing pairs ─────────────────────────────────
def find_missing_pairs(db) -> list[tuple[str, str]]:
    """
    Find all (symbol, trade_date) pairs from trades that have no
    corresponding bars in either the bars table or parquet files.
    """
    # Get all unique trade-day pairs from trades table
    all_pairs = db.execute("""
        SELECT DISTINCT
            symbol,
            CAST(entry_time AS DATE) AS trade_date
        FROM trades
        ORDER BY trade_date, symbol
    """).fetchdf()

    # Get pairs that already have bars in DuckDB
    existing_in_db = set()
    try:
        existing_db_rows = db.execute("""
            SELECT DISTINCT
                symbol,
                CAST(bar_time AS DATE) AS bar_date
            FROM bars
        """).fetchdf()
        for _, row in existing_db_rows.iterrows():
            existing_in_db.add((row["symbol"], str(row["bar_date"])[:10]))
    except Exception:
        pass  # bars table might be empty

    missing = []
    for _, row in all_pairs.iterrows():
        sym = row["symbol"]
        date_str = str(row["trade_date"])[:10]
        key = (sym, date_str)

        # Check DuckDB
        if key in existing_in_db:
            continue

        # Check parquet file on disk
        parquet_path = PARQUET_DIR / f"{sym}_{date_str}.parquet"
        if parquet_path.exists():
            continue

        missing.append(key)

    return missing


# ── Main ──────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Backfill missing 1-min bars from Polygon.io free tier"
    )
    parser.add_argument(
        "--limit", type=int, default=0,
        help="Max number of symbol-date pairs to fetch (0 = all)",
    )
    parser.add_argument(
        "--symbol", type=str, default=None,
        help="Fetch only this symbol",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Show what would be fetched without making API calls",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-fetch even if already in progress tracker (ignore progress file)",
    )
    parser.add_argument(
        "--reset-progress", action="store_true",
        help="Delete progress file and start fresh",
    )
    parser.add_argument(
        "--workers", type=int, default=DEFAULT_WORKERS,
        help=f"Number of concurrent fetch workers (default: {DEFAULT_WORKERS})",
    )
    args = parser.parse_args()

    # ── Validate API key ──────────────────────────────────────────
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY is not set.")
        print()
        print("  Set it in your .env file at the project root:")
        print("    POLYGON_API_KEY=your_key_here")
        print()
        print("  Get a free API key at: https://polygon.io/")
        sys.exit(1)

    # ── Progress file management ──────────────────────────────────
    if args.reset_progress and PROGRESS_FILE.exists():
        PROGRESS_FILE.unlink()
        print(f"Deleted progress file: {PROGRESS_FILE}")

    progress = load_progress()
    completed_set = set(progress["completed"])

    # ── Connect to DuckDB and find missing pairs ──────────────────
    db = get_db()
    ensure_schema(db)

    print("Scanning for missing (symbol, trade_date) pairs...", flush=True)
    missing_pairs = find_missing_pairs(db)

    # Filter by API key date cutoff (Massive.com/Polygon free key: data from 2021-03-08+)
    API_DATE_CUTOFF = "2021-03-08"
    before_cutoff_count = len(missing_pairs)
    missing_pairs = [(s, d) for s, d in missing_pairs if d >= API_DATE_CUTOFF]
    skipped_cutoff = before_cutoff_count - len(missing_pairs)
    if skipped_cutoff > 0:
        print(f"Skipping {skipped_cutoff} pairs before API cutoff ({API_DATE_CUTOFF})", flush=True)

    # Filter by symbol if requested
    if args.symbol:
        missing_pairs = [(s, d) for s, d in missing_pairs if s == args.symbol]
        print(f"Filtered to symbol: {args.symbol}", flush=True)

    # Exclude already-completed pairs from progress tracker (unless --force)
    if not args.force:
        before = len(missing_pairs)
        missing_pairs = [
            (s, d) for s, d in missing_pairs
            if f"{s}_{d}" not in completed_set
        ]
        skipped = before - len(missing_pairs)
        if skipped > 0:
            print(f"Skipping {skipped} pairs already in progress tracker", flush=True)

    # Apply --limit
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

    print()
    print("=" * 60)
    print("  Polygon.io Free Tier Bar Backfill")
    print("=" * 60)
    print(f"  Total trades in DB:        {total_trades:,}")
    print(f"  Trades with bar data:      {trades_with_bars:,} ({trades_with_bars / max(total_trades, 1) * 100:.1f}%)")
    print(f"  Missing trade-day pairs:   {len(missing_pairs):,}")
    print(f"  Workers:                   {args.workers}")
    if missing_pairs:
        # Estimate ~5 pairs/sec with 10 workers
        est_rate = args.workers * 0.5  # conservative: 0.5 pairs/sec/worker
        est_seconds = len(missing_pairs) / est_rate
        print(f"  Estimated time:            {est_seconds / 60:.0f} min ({est_seconds / 3600:.1f} hours)")
    print(f"  Progress file:             {PROGRESS_FILE}")
    print(f"  Parquet output:            {PARQUET_DIR}")
    print("=" * 60)
    print()

    if not missing_pairs:
        print("Nothing to fetch. All trade-day pairs have bar data.")
        db.close()
        return

    # ── Dry run: show what would be fetched ───────────────────────
    if args.dry_run:
        print(f"DRY RUN: Would fetch {len(missing_pairs)} symbol-date pairs:")
        print()

        # Group by symbol for readability
        by_symbol: dict[str, list[str]] = {}
        for sym, dt in missing_pairs:
            by_symbol.setdefault(sym, []).append(dt)

        for sym in sorted(by_symbol):
            dates = sorted(by_symbol[sym])
            print(f"  {sym}: {len(dates)} dates ({dates[0]} to {dates[-1]})")

        print()
        print(f"Total: {len(by_symbol)} symbols, {len(missing_pairs)} pairs")
        db.close()
        return

    # ── Concurrent fetch loop ─────────────────────────────────────
    rate_limiter = AdaptiveRateLimiter()

    if not progress.get("started_at"):
        progress["started_at"] = datetime.now().isoformat()

    success_count = 0
    fail_count = 0
    total_bars_inserted = 0
    counter_lock = threading.Lock()
    progress_lock = threading.Lock()
    t0 = time.time()

    print(f"Starting concurrent fetch of {len(missing_pairs)} pairs ({args.workers} workers)...")
    print(f"  (Ctrl+C to stop — progress is saved periodically)")
    print()

    # DuckDB inserts happen on main thread via queue to avoid concurrent writes
    pending_inserts: list[tuple[pd.DataFrame, str]] = []
    insert_lock = threading.Lock()

    def fetch_worker(client: httpx.Client, symbol: str, date_str: str) -> tuple[str, str, bool, str, pd.DataFrame | None]:
        """Worker function for concurrent fetch."""
        ok, msg, df = fetch_one_pair(client, rate_limiter, symbol, date_str)
        if ok and df is not None:
            save_parquet(df, symbol, date_str)
        return symbol, date_str, ok, msg, df

    try:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            # Submit all tasks
            futures = {}
            client = httpx.Client()
            for sym, date_str in missing_pairs:
                fut = executor.submit(fetch_worker, client, sym, date_str)
                futures[fut] = (sym, date_str)

            for fut in as_completed(futures):
                sym, date_str = futures[fut]
                key = f"{sym}_{date_str}"

                try:
                    _, _, ok, msg, df = fut.result()
                except Exception as e:
                    ok, msg, df = False, f"exception: {e}", None

                with counter_lock:
                    if ok and df is not None:
                        success_count += 1
                        rows_inserted = insert_bars_to_duckdb(db, df, sym)
                        total_bars_inserted += rows_inserted
                    else:
                        fail_count += 1
                        progress["failed"][key] = msg

                    done = success_count + fail_count
                    remaining = len(missing_pairs) - done

                    progress["completed"].append(key)
                    completed_set.add(key)

                # Print progress every 50 pairs
                if done % 50 == 0 or done == len(missing_pairs):
                    elapsed = time.time() - t0
                    rate = done / max(elapsed, 0.1)
                    eta_str = f"{remaining / max(rate, 0.001) / 60:.1f}m" if rate > 0 else "?"
                    print(
                        f"  [{done}/{len(missing_pairs)}] "
                        f"ok={success_count} skip={fail_count} "
                        f"bars={total_bars_inserted:,} "
                        f"rate={rate:.1f}/s ETA={eta_str}",
                        flush=True,
                    )

                # Save progress every 100 pairs
                if done % 100 == 0 or done == len(missing_pairs):
                    with progress_lock:
                        save_progress(progress)

            client.close()

    except KeyboardInterrupt:
        print("\n\nInterrupted by user. Saving progress...", flush=True)
        save_progress(progress)

    # ── Final summary ─────────────────────────────────────────────
    elapsed = time.time() - t0

    # Save final progress
    progress["last_run_at"] = datetime.now().isoformat()
    progress["last_run_stats"] = {
        "success": success_count,
        "failed": fail_count,
        "bars_inserted": total_bars_inserted,
        "elapsed_seconds": round(elapsed, 1),
    }
    save_progress(progress)

    # Re-check coverage
    trades_with_bars_after = db.execute("""
        SELECT COUNT(DISTINCT t.trade_id)
        FROM trades t
        WHERE EXISTS (
            SELECT 1 FROM bars b
            WHERE b.symbol = t.symbol
            AND CAST(b.bar_time AS DATE) = CAST(t.entry_time AS DATE)
        )
    """).fetchone()[0]

    db.close()

    print()
    print("=" * 60)
    print("  Backfill Complete")
    print("=" * 60)
    print(f"  Duration:                {elapsed / 60:.1f} min ({elapsed / 3600:.1f} hours)")
    print(f"  Pairs fetched (OK):      {success_count:,}")
    print(f"  Pairs failed/empty:      {fail_count:,}")
    print(f"  Bars inserted to DuckDB: {total_bars_inserted:,}")
    print(f"  Coverage before:         {trades_with_bars:,}/{total_trades:,} "
          f"({trades_with_bars / max(total_trades, 1) * 100:.1f}%)")
    print(f"  Coverage after:          {trades_with_bars_after:,}/{total_trades:,} "
          f"({trades_with_bars_after / max(total_trades, 1) * 100:.1f}%)")
    print(f"  Progress file:           {PROGRESS_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    main()
