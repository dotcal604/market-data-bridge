"""
historical_scraper.py - Bulk fetch ALL available 1-min bars from Polygon.

Subscribe-Scrape-Dump Strategy:
  For every symbol in our trade universe, fetch ALL trading days within
  Polygon's lookback window. Oldest-first so expiring data is captured
  before it ages out of the 5yr window.

Modes:
  --mode=full     Fetch ALL weekdays for ALL trade symbols (default)
  --mode=context  Fetch +/- N days around each trade entry
  --mode=gap      Only fetch symbol-dates that are missing bars

  --window=N      Context window days for --mode=context (default: 10)
  --symbols=N     Limit to top N symbols by trade count (default: all)
  --start-date    Override earliest date (default: 5yr lookback)
  --end-date      Override latest date (default: today)
  --concurrency=N Override concurrent connections (default: 10)
  --batch=N       Process N dates at a time (default: 5, keeps memory low)
  --dry-run       Show what would be fetched without fetching

Resume:
  Automatically skips existing parquet files. Safe to Ctrl+C and restart.

Output:
  Same parquet format as 03_fetch_bars.py -- one file per symbol-date
  in data/parquet/bars/{SYMBOL}_{YYYY-MM-DD}.parquet

Usage:
  python scripts/historical_scraper.py                          # full scrape
  python scripts/historical_scraper.py --mode=context --window=5
  python scripts/historical_scraper.py --symbols=100 --dry-run
  python scripts/historical_scraper.py --mode=full --concurrency=20
"""

import argparse
import asyncio
import json
import sys
import time
from datetime import datetime, timedelta, date
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
SCRAPE_LOG = DATA_DIR / "scrape_log.json"


def parse_args():
    p = argparse.ArgumentParser(description="Bulk Polygon bar scraper")
    p.add_argument("--mode", choices=["full", "context", "gap"], default="full")
    p.add_argument("--window", type=int, default=10, help="Context window days")
    p.add_argument("--symbols", type=int, default=0, help="Limit to top N symbols")
    p.add_argument("--start-date", type=str, default=None)
    p.add_argument("--end-date", type=str, default=None)
    p.add_argument("--concurrency", type=int, default=POLYGON_CONCURRENCY)
    p.add_argument("--batch", type=int, default=5, help="Days per batch")
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()


def get_trading_weekdays(start: date, end: date) -> list[date]:
    """Generate all weekdays (Mon-Fri) between start and end inclusive."""
    days = []
    current = start
    while current <= end:
        if current.weekday() < 5:
            days.append(current)
        current += timedelta(days=1)
    return days


def get_cached_set(parquet_dir: Path) -> set[str]:
    """Pre-build set of all existing parquet file stems for O(1) lookups."""
    return {f.stem for f in parquet_dir.glob("*.parquet")}


# ── Stats tracker ────────────────────────────────────────────────
class ScrapeStats:
    def __init__(self):
        self.success = 0
        self.cached = 0
        self.empty = 0
        self.forbidden = 0
        self.not_found = 0
        self.errors = 0
        self.bars_fetched = 0
        self.bytes_written = 0
        self.t0 = time.time()

    @property
    def total_done(self):
        return self.success + self.cached + self.empty + self.forbidden + self.not_found + self.errors

    def rate(self):
        elapsed = max(time.time() - self.t0, 0.1)
        return (self.success + self.empty + self.forbidden + self.not_found + self.errors) / elapsed

    def summary(self):
        elapsed = time.time() - self.t0
        return (
            f"Done in {elapsed/60:.1f}m | "
            f"new={self.success:,} cached={self.cached:,} empty={self.empty:,} "
            f"403={self.forbidden:,} 404={self.not_found:,} err={self.errors:,} | "
            f"bars={self.bars_fetched:,} written={self.bytes_written/1e6:.1f}MB"
        )


# ── Fetcher (same parquet format as 03_fetch_bars.py) ────────────
async def fetch_one(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    symbol: str,
    date_str: str,
    out_dir: Path,
    stats: ScrapeStats,
) -> tuple[str, str]:
    """Fetch 1-min bars for one symbol-date. Returns (key, status)."""
    key = f"{symbol}_{date_str}"
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

                if resp.status_code == 403:
                    stats.forbidden += 1
                    return key, "403"

                if resp.status_code == 404:
                    stats.not_found += 1
                    return key, "404"

                if resp.status_code != 200:
                    stats.errors += 1
                    return key, f"HTTP {resp.status_code}"

                data = resp.json()
                results = data.get("results", [])

                if not results:
                    stats.empty += 1
                    return key, "empty"

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
                pq.write_table(table, str(out_file := out_dir / f"{key}.parquet"))

                bar_count = len(df)
                file_size = out_file.stat().st_size
                stats.success += 1
                stats.bars_fetched += bar_count
                stats.bytes_written += file_size
                return key, f"{bar_count} bars"

            except httpx.TimeoutException:
                if attempt < POLYGON_RETRY_MAX - 1:
                    await asyncio.sleep(POLYGON_RETRY_BACKOFF ** (attempt + 1))
                    continue
                stats.errors += 1
                return key, "timeout"

            except Exception as e:
                stats.errors += 1
                return key, str(e)[:60]

    stats.errors += 1
    return key, "max retries"


async def scrape_batch(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    pairs: list[tuple[str, str]],
    stats: ScrapeStats,
    global_total: int,
):
    """Scrape a batch of symbol-date pairs."""
    tasks = [
        fetch_one(client, sem, sym, dt, PARQUET_DIR, stats)
        for sym, dt in pairs
    ]

    last_report = time.time()
    for coro in asyncio.as_completed(tasks):
        key, status = await coro
        now = time.time()

        if (now - last_report >= 5) or stats.total_done <= 3:
            last_report = now
            done = stats.total_done
            rate = stats.rate()
            remaining = global_total - done
            eta_min = remaining / max(rate, 0.01) / 60
            pct = done / global_total * 100
            print(
                f"  [{done:,}/{global_total:,}] ({pct:.1f}%) {key}: {status}  "
                f"| {rate:.1f}/s ETA {eta_min:.0f}m  "
                f"| ok={stats.success:,} 403={stats.forbidden:,} empty={stats.empty:,}",
                flush=True,
            )


def main():
    args = parse_args()

    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env", file=sys.stderr)
        sys.exit(1)

    # Date range: default to 5yr lookback from today
    today = date.today()
    start_dt = date.fromisoformat(args.start_date) if args.start_date else today - timedelta(days=5 * 365)
    end_dt = date.fromisoformat(args.end_date) if args.end_date else today

    print(f"Polygon Historical Scraper", flush=True)
    print(f"  Mode:       {args.mode}", flush=True)
    print(f"  Date range: {start_dt} to {end_dt}", flush=True)

    # Get symbol universe from trades
    db = get_db()

    if args.symbols > 0:
        sym_df = db.execute(f"""
            SELECT symbol, COUNT(*) as cnt
            FROM trades
            GROUP BY 1
            ORDER BY cnt DESC
            LIMIT {args.symbols}
        """).fetchdf()
    else:
        sym_df = db.execute("""
            SELECT symbol, COUNT(*) as cnt
            FROM trades
            GROUP BY 1
            ORDER BY cnt DESC
        """).fetchdf()

    symbols = sym_df["symbol"].tolist()
    print(f"  Symbols:    {len(symbols):,}", flush=True)

    # Load missing tickers audit
    missing_tickers = set()
    if AUDIT_FILE.exists():
        audit = json.loads(AUDIT_FILE.read_text(encoding="utf-8"))
        missing_tickers = set(audit.get("missing", []))
        if missing_tickers:
            symbols = [s for s in symbols if s not in missing_tickers]
            print(f"  After audit: {len(symbols):,} (excluded {len(missing_tickers)} missing)", flush=True)

    # Build all weekdays in range
    all_weekdays = get_trading_weekdays(start_dt, end_dt)
    print(f"  Weekdays:   {len(all_weekdays):,}", flush=True)

    # Pre-build cached file set for fast lookups
    PARQUET_DIR.mkdir(parents=True, exist_ok=True)
    cached_files = get_cached_set(PARQUET_DIR)
    print(f"  Cached files: {len(cached_files):,}", flush=True)

    # Determine which dates to fetch based on mode
    if args.mode == "full":
        # All weekdays x all symbols, oldest first
        target_dates = all_weekdays  # already sorted oldest-first
    elif args.mode == "context":
        # Only dates near trades
        trade_dates_df = db.execute("""
            SELECT DISTINCT symbol, CAST(entry_time AS DATE) AS trade_date
            FROM trades
            ORDER BY trade_date
        """).fetchdf()

        target_date_set = set()
        sym_set = set(symbols)
        for _, row in trade_dates_df.iterrows():
            if row["symbol"] not in sym_set:
                continue
            td = row["trade_date"]
            if hasattr(td, "date"):
                td = td.date()
            for offset in range(-args.window, args.window + 1):
                d = td + timedelta(days=offset)
                if d.weekday() < 5 and start_dt <= d <= end_dt:
                    target_date_set.add(d)
        target_dates = sorted(target_date_set)
        print(f"  Context window: +/- {args.window} days -> {len(target_dates):,} unique dates", flush=True)
    elif args.mode == "gap":
        gap_df = db.execute("""
            SELECT DISTINCT t.symbol, CAST(t.entry_time AS DATE) AS trade_date
            FROM trades t
            LEFT JOIN (
                SELECT DISTINCT symbol, CAST(bar_time AS DATE) AS bar_date FROM bars
            ) b ON b.symbol = t.symbol AND b.bar_date = CAST(t.entry_time AS DATE)
            WHERE b.symbol IS NULL
            ORDER BY trade_date
        """).fetchdf()
        # Gap mode is different - specific symbol-date pairs, not all symbols per date
        gap_pairs = []
        sym_set = set(symbols)
        for _, row in gap_df.iterrows():
            sym = row["symbol"]
            if sym not in sym_set:
                continue
            d_str = str(row["trade_date"])[:10]
            key = f"{sym}_{d_str}"
            if key not in cached_files:
                gap_pairs.append((sym, d_str))

        print(f"  Gap pairs to fetch: {len(gap_pairs):,}", flush=True)
        db.close()

        if args.dry_run:
            print("\n  DRY RUN - no fetches performed", flush=True)
            return
        if not gap_pairs:
            print("\n  No gaps to fill!", flush=True)
            return

        stats = ScrapeStats()

        async def _run():
            sem = asyncio.Semaphore(args.concurrency)
            async with httpx.AsyncClient() as client:
                await scrape_batch(client, sem, gap_pairs, stats, len(gap_pairs))

        asyncio.run(_run())
        print(f"\n{stats.summary()}", flush=True)
        return

    db.close()

    # For full and context modes: calculate total scope
    sym_set = set(symbols)
    total_pairs = 0
    to_fetch = 0

    print(f"\n  Scanning scope...", flush=True)
    date_summary = {}
    for d in target_dates:
        d_str = d.isoformat()
        yr = d_str[:4]
        yr_total = 0
        yr_new = 0
        for sym in symbols:
            key = f"{sym}_{d_str}"
            yr_total += 1
            if key not in cached_files:
                yr_new += 1
        if yr not in date_summary:
            date_summary[yr] = {"total": 0, "new": 0}
        date_summary[yr]["total"] += yr_total
        date_summary[yr]["new"] += yr_new
        total_pairs += yr_total
        to_fetch += yr_new

    print(f"\n  Total pairs:    {total_pairs:,}", flush=True)
    print(f"  Already cached: {total_pairs - to_fetch:,}", flush=True)
    print(f"  To fetch:       {to_fetch:,}", flush=True)

    if to_fetch > 0:
        est_rate = 40
        est_hours = to_fetch / est_rate / 3600
        print(f"  Est. time:      {est_hours:.1f} hours @ ~{est_rate} req/s", flush=True)

    print(f"\n  By year:", flush=True)
    for yr in sorted(date_summary):
        s = date_summary[yr]
        print(f"    {yr}: {s['total']:>10,} total, {s['total']-s['new']:>8,} cached, {s['new']:>8,} to fetch", flush=True)

    if args.dry_run:
        print("\n  DRY RUN - no fetches performed", flush=True)
        return

    if to_fetch == 0:
        print("\nAll pairs already cached!", flush=True)
        return

    # Run in date batches (oldest first, batch_size days at a time)
    stats = ScrapeStats()

    async def _run():
        sem = asyncio.Semaphore(args.concurrency)
        async with httpx.AsyncClient() as client:
            batch_dates = []
            for d in target_dates:
                batch_dates.append(d)
                if len(batch_dates) >= args.batch:
                    # Build pairs for this batch, skip cached
                    batch_pairs = []
                    for bd in batch_dates:
                        d_str = bd.isoformat()
                        for sym in symbols:
                            key = f"{sym}_{d_str}"
                            if key not in cached_files:
                                batch_pairs.append((sym, d_str))

                    if batch_pairs:
                        print(
                            f"\n  Batch: {batch_dates[0]} to {batch_dates[-1]} "
                            f"({len(batch_pairs):,} pairs)",
                            flush=True,
                        )
                        await scrape_batch(client, sem, batch_pairs, stats, to_fetch)
                        # Add newly fetched to cached set
                        for sym, dt in batch_pairs:
                            cached_files.add(f"{sym}_{dt}")

                    batch_dates = []

            # Final partial batch
            if batch_dates:
                batch_pairs = []
                for bd in batch_dates:
                    d_str = bd.isoformat()
                    for sym in symbols:
                        key = f"{sym}_{d_str}"
                        if key not in cached_files:
                            batch_pairs.append((sym, d_str))
                if batch_pairs:
                    print(
                        f"\n  Batch: {batch_dates[0]} to {batch_dates[-1]} "
                        f"({len(batch_pairs):,} pairs)",
                        flush=True,
                    )
                    await scrape_batch(client, sem, batch_pairs, stats, to_fetch)

    asyncio.run(_run())

    print(f"\n{stats.summary()}", flush=True)

    # Save scrape log
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "mode": args.mode,
        "total_pairs": total_pairs,
        "to_fetch": to_fetch,
        "success": stats.success,
        "cached": stats.cached,
        "empty": stats.empty,
        "forbidden": stats.forbidden,
        "not_found": stats.not_found,
        "errors": stats.errors,
        "bars_fetched": stats.bars_fetched,
        "mb_written": round(stats.bytes_written / 1e6, 1),
        "duration_min": round((time.time() - stats.t0) / 60, 1),
    }

    log_data = []
    if SCRAPE_LOG.exists():
        log_data = json.loads(SCRAPE_LOG.read_text(encoding="utf-8"))
    log_data.append(log_entry)
    SCRAPE_LOG.write_text(json.dumps(log_data, indent=2), encoding="utf-8")
    print(f"Log saved to {SCRAPE_LOG}", flush=True)


if __name__ == "__main__":
    main()
