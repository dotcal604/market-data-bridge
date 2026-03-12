"""
70_fetch_1min_bars.py — Fetch 1-minute intraday bars and pre-aggregate into
daily microstructure metrics via Massive.com API.

Same pre-aggregation pattern as script 69 (5-min bars) but with finer-grained
features enabled by 1-minute resolution:

  - First 5-min candle (open/high/low/close/volume)
  - Opening 15-min range
  - Minute-level VWAP accuracy
  - Volume spike detection (single-minute max)
  - Price reversal count (direction changes per day)
  - Time of day high/low (minute precision)
  - Gap fill timing (minutes to fill opening gap)

Uses quarterly API chunking to work around ~13K result cap per request.
~390 1-min bars/day × ~63 trading days/quarter ≈ 24K per quarter chunk,
so we use MONTHLY chunking instead (390 × 21 ≈ 8,190 per month).

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/70_fetch_1min_bars.py
    python scripts/70_fetch_1min_bars.py --smoke
    python scripts/70_fetch_1min_bars.py --symbols AAPL MSFT TSLA
"""

import argparse
import asyncio
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import POLYGON_API_KEY, DATA_DIR, DUCKDB_PATH, POLYGON_CONCURRENCY

MASSIVE_BASE = "https://api.massive.com"
REF_DIR = DATA_DIR / "reference"
OUT_DIR = REF_DIR / "intraday_1min_stats"
PROGRESS_FILE = REF_DIR / "intraday_1min_progress.json"

SEMAPHORE = asyncio.Semaphore(POLYGON_CONCURRENCY if POLYGON_CONCURRENCY else 10)


def load_progress() -> set[str]:
    if PROGRESS_FILE.exists():
        data = json.loads(PROGRESS_FILE.read_text())
        return set(data.get("completed_symbols", []))
    return set()


def save_progress(completed: set[str]):
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(json.dumps({
        "completed_symbols": sorted(completed),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2))


def load_unique_symbols() -> list[str]:
    """Load ALL unique Holly-traded symbols from DuckDB."""
    import duckdb
    db = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    rows = db.execute("""
        SELECT DISTINCT symbol FROM trades
        ORDER BY symbol
    """).fetchall()
    db.close()
    return [r[0] for r in rows]


def build_monthly_ranges() -> list[tuple[str, str]]:
    """Build monthly date ranges from 2016-01-01 to today.

    Monthly instead of quarterly because 1-min bars produce ~8K rows/month
    (within the ~13K API cap), vs ~24K rows/quarter which would exceed it.
    """
    ranges = []
    current = date(2016, 1, 1)
    end_date = date.today()

    while current <= end_date:
        # Last day of the month
        if current.month == 12:
            month_end = date(current.year + 1, 1, 1) - timedelta(days=1)
        else:
            month_end = date(current.year, current.month + 1, 1) - timedelta(days=1)

        if month_end > end_date:
            month_end = end_date

        ranges.append((current.isoformat(), month_end.isoformat()))

        # Move to next month
        if current.month == 12:
            current = date(current.year + 1, 1, 1)
        else:
            current = date(current.year, current.month + 1, 1)

    return ranges


async def fetch_month_bars(
    client: httpx.AsyncClient,
    symbol: str,
    date_from: str,
    date_to: str,
) -> list[dict]:
    """Fetch 1-min bars for one symbol over one month."""
    url = (
        f"{MASSIVE_BASE}/v2/aggs/ticker/{symbol}"
        f"/range/1/minute/{date_from}/{date_to}"
    )
    params = {
        "adjusted": "true",
        "sort": "asc",
        "limit": "50000",
        "apiKey": POLYGON_API_KEY,
    }

    all_bars: list[dict] = []

    async with SEMAPHORE:
        for attempt in range(3):
            try:
                resp = await client.get(url, params=params, timeout=60)

                if resp.status_code == 429:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue

                if resp.status_code in (403, 404):
                    return all_bars

                if resp.status_code != 200:
                    return all_bars

                data = resp.json()
                results = data.get("results", [])

                for bar in results:
                    ts_ms = bar.get("t")
                    if not ts_ms:
                        continue
                    all_bars.append({
                        "ts_ms": ts_ms,
                        "o": bar.get("o"),
                        "h": bar.get("h"),
                        "l": bar.get("l"),
                        "c": bar.get("c"),
                        "v": bar.get("v", 0),
                        "vw": bar.get("vw"),
                        "n": bar.get("n", 0),
                    })

                return all_bars

            except (httpx.TimeoutException, httpx.ConnectError, json.JSONDecodeError):
                if attempt < 2:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                return all_bars

    return all_bars


def aggregate_1min_to_daily(symbol: str, raw_bars: list[dict]) -> pd.DataFrame:
    """
    Aggregate 1-minute bars into daily microstructure metrics.
    Returns one row per trading day with 1-min-specific features.
    """
    if not raw_bars:
        return pd.DataFrame()

    df = pd.DataFrame(raw_bars)
    df["dt"] = pd.to_datetime(df["ts_ms"], unit="ms", utc=True)
    df["bar_date"] = df["dt"].dt.date.astype(str)

    # Sort by time
    df = df.sort_values(["bar_date", "ts_ms"]).reset_index(drop=True)

    daily_rows = []

    for bar_date, day_df in df.groupby("bar_date"):
        if len(day_df) < 5:
            continue  # skip days with too few bars (pre/post-market fragments)

        d = day_df.sort_values("ts_ms").reset_index(drop=True)

        day_open = d.iloc[0]["o"]
        day_high = d["h"].max()
        day_low = d["l"].min()
        day_close = d.iloc[-1]["c"]
        day_volume = d["v"].sum()
        day_trades = d["n"].sum()
        bar_count = len(d)

        # VWAP
        vw = d["vw"].dropna()
        vol_for_vw = d.loc[vw.index, "v"]
        if vol_for_vw.sum() > 0:
            day_vwap = (vw * vol_for_vw).sum() / vol_for_vw.sum()
        else:
            day_vwap = None

        # ── 1-MIN SPECIFIC FEATURES ──

        # First 5-minute candle (bars 0-4)
        first_5 = d.head(5)
        m1_5min_open = first_5.iloc[0]["o"]
        m1_5min_high = first_5["h"].max()
        m1_5min_low = first_5["l"].min()
        m1_5min_close = first_5.iloc[-1]["c"]
        m1_5min_volume = first_5["v"].sum()
        m1_5min_range = m1_5min_high - m1_5min_low if m1_5min_high and m1_5min_low else None

        # Opening 15-min range (bars 0-14)
        first_15 = d.head(15)
        m1_15min_high = first_15["h"].max()
        m1_15min_low = first_15["l"].min()
        m1_15min_range = m1_15min_high - m1_15min_low if m1_15min_high and m1_15min_low else None
        m1_15min_volume = first_15["v"].sum()

        # Opening 30-min range (bars 0-29)
        first_30 = d.head(30)
        m1_30min_high = first_30["h"].max()
        m1_30min_low = first_30["l"].min()
        m1_30min_range = m1_30min_high - m1_30min_low if m1_30min_high and m1_30min_low else None
        m1_30min_volume = first_30["v"].sum()

        # First hour (bars 0-59)
        first_60 = d.head(60)
        m1_first_hour_high = first_60["h"].max()
        m1_first_hour_low = first_60["l"].min()
        m1_first_hour_volume = first_60["v"].sum()

        # Volume spike: single-minute max volume
        max_1min_volume = d["v"].max()
        vol_spike_ratio = max_1min_volume / (day_volume / bar_count) if day_volume > 0 and bar_count > 0 else None

        # Time of day high/low (bar index as proxy for minutes from open)
        high_bar_idx = d["h"].idxmax()
        low_bar_idx = d["l"].idxmin()
        # Normalize to 0-1 (0=open, 1=close)
        tod_high = (high_bar_idx - d.index[0]) / max(bar_count - 1, 1)
        tod_low = (low_bar_idx - d.index[0]) / max(bar_count - 1, 1)

        # Price reversal count (direction changes)
        closes = d["c"].values
        if len(closes) > 2:
            diffs = np.diff(closes)
            signs = np.sign(diffs)
            signs = signs[signs != 0]  # remove flat bars
            if len(signs) > 1:
                reversals = np.sum(np.diff(signs) != 0)
            else:
                reversals = 0
        else:
            reversals = 0

        # Gap fill detection
        # If day_open > prior close (gap up), how many minutes to fill?
        # We approximate using close_vs_open direction within the day
        if bar_count > 1 and day_open and m1_5min_close:
            gap_direction = 1 if m1_5min_close > day_open else -1
            gap_filled_bar = None
            for i in range(1, len(d)):
                if gap_direction > 0 and d.iloc[i]["l"] <= day_open:
                    gap_filled_bar = i
                    break
                elif gap_direction < 0 and d.iloc[i]["h"] >= day_open:
                    gap_filled_bar = i
                    break
            m1_gap_fill_minutes = gap_filled_bar if gap_filled_bar is not None else None
        else:
            m1_gap_fill_minutes = None

        # Volume by 30-min periods (for first 2 hours = 4 periods)
        vol_period_1 = d.head(30)["v"].sum()
        vol_period_2 = d.iloc[30:60]["v"].sum() if len(d) > 30 else 0
        vol_period_3 = d.iloc[60:90]["v"].sum() if len(d) > 60 else 0
        vol_period_4 = d.iloc[90:120]["v"].sum() if len(d) > 90 else 0

        # Close position in day range
        intraday_range = day_high - day_low if day_high and day_low else None
        close_position = (
            (day_close - day_low) / intraday_range
            if intraday_range and intraday_range > 0
            else None
        )

        # Close vs VWAP
        close_vs_vwap = (
            (day_close - day_vwap) / day_vwap * 100
            if day_close and day_vwap and day_vwap > 0
            else None
        )

        daily_rows.append({
            "ticker": symbol,
            "bar_date": bar_date,
            # General
            "m1_bar_count": bar_count,
            "m1_day_volume": int(day_volume),
            "m1_day_trades": int(day_trades),
            "m1_day_vwap": round(day_vwap, 4) if day_vwap else None,
            # First 5-min candle
            "m1_5min_open": round(m1_5min_open, 4) if m1_5min_open else None,
            "m1_5min_high": round(m1_5min_high, 4) if m1_5min_high else None,
            "m1_5min_low": round(m1_5min_low, 4) if m1_5min_low else None,
            "m1_5min_close": round(m1_5min_close, 4) if m1_5min_close else None,
            "m1_5min_volume": int(m1_5min_volume),
            "m1_5min_range": round(m1_5min_range, 4) if m1_5min_range else None,
            # 15-min opening range
            "m1_15min_high": round(m1_15min_high, 4) if m1_15min_high else None,
            "m1_15min_low": round(m1_15min_low, 4) if m1_15min_low else None,
            "m1_15min_range": round(m1_15min_range, 4) if m1_15min_range else None,
            "m1_15min_volume": int(m1_15min_volume),
            # 30-min opening range
            "m1_30min_high": round(m1_30min_high, 4) if m1_30min_high else None,
            "m1_30min_low": round(m1_30min_low, 4) if m1_30min_low else None,
            "m1_30min_range": round(m1_30min_range, 4) if m1_30min_range else None,
            "m1_30min_volume": int(m1_30min_volume),
            # First hour
            "m1_first_hour_high": round(m1_first_hour_high, 4) if m1_first_hour_high else None,
            "m1_first_hour_low": round(m1_first_hour_low, 4) if m1_first_hour_low else None,
            "m1_first_hour_volume": int(m1_first_hour_volume),
            # Volume spike
            "m1_max_1min_volume": int(max_1min_volume) if max_1min_volume else None,
            "m1_vol_spike_ratio": round(vol_spike_ratio, 2) if vol_spike_ratio else None,
            # Time of day
            "m1_tod_high": round(tod_high, 4),
            "m1_tod_low": round(tod_low, 4),
            # Reversals
            "m1_reversal_count": int(reversals),
            # Gap fill
            "m1_gap_fill_minutes": m1_gap_fill_minutes,
            # 30-min volume periods
            "m1_vol_period_1": int(vol_period_1),
            "m1_vol_period_2": int(vol_period_2),
            "m1_vol_period_3": int(vol_period_3),
            "m1_vol_period_4": int(vol_period_4),
            # Position & VWAP
            "m1_close_position": round(close_position, 4) if close_position else None,
            "m1_close_vs_vwap_pct": round(close_vs_vwap, 4) if close_vs_vwap else None,
        })

    return pd.DataFrame(daily_rows) if daily_rows else pd.DataFrame()


async def fetch_and_aggregate_symbol(
    client: httpx.AsyncClient,
    symbol: str,
    months: list[tuple[str, str]],
) -> tuple[str, pd.DataFrame, int]:
    """Fetch all monthly chunks and aggregate for one symbol."""
    all_bars: list[dict] = []

    for m_start, m_end in months:
        bars = await fetch_month_bars(client, symbol, m_start, m_end)
        all_bars.extend(bars)

    total_raw = len(all_bars)
    daily_df = aggregate_1min_to_daily(symbol, all_bars)
    return symbol, daily_df, total_raw


async def main_async(args):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading unique Holly symbols from DuckDB...")
    if args.symbols:
        symbols = args.symbols
    else:
        symbols = load_unique_symbols()
    print(f"  Total unique symbols: {len(symbols):,}")

    if not symbols:
        print("No symbols found!")
        return

    if args.smoke:
        symbols = symbols[:3]
        print(f"\n  SMOKE TEST: fetching only {len(symbols)} symbols")

    completed = load_progress()
    existing_files = list(OUT_DIR.glob("*.parquet"))
    print(f"  Existing parquet files: {len(existing_files):,}")

    remaining = [s for s in symbols if s not in completed]
    print(f"  Already completed: {len(completed):,}")
    print(f"  Remaining: {len(remaining):,}")

    if not remaining:
        print("All symbols already fetched!")
        load_to_duckdb()
        return

    months = build_monthly_ranges()
    print(f"  Monthly chunks per symbol: {len(months)}")

    print(f"\n{'=' * 60}")
    print(f"Fetching 1-minute intraday bars from Massive.com...")
    print(f"  Pre-aggregating into daily microstructure metrics")
    print(f"  Total API calls est: ~{len(remaining) * len(months):,}")
    print(f"{'=' * 60}")

    t0 = time.time()
    new_raw_bars = 0
    new_daily_rows = 0
    empty_symbols = 0

    async with httpx.AsyncClient() as client:
        batch_size = 3  # fewer concurrent since each makes ~120 monthly API calls
        for batch_start in range(0, len(remaining), batch_size):
            batch = remaining[batch_start:batch_start + batch_size]
            tasks = [
                fetch_and_aggregate_symbol(client, sym, months)
                for sym in batch
            ]
            results = await asyncio.gather(*tasks)

            for sym, daily_df, raw_count in results:
                new_raw_bars += raw_count
                if not daily_df.empty:
                    out_file = OUT_DIR / f"{sym}.parquet"
                    pq.write_table(
                        pa.Table.from_pandas(daily_df),
                        str(out_file),
                        compression="zstd",
                    )
                    new_daily_rows += len(daily_df)
                else:
                    empty_symbols += 1
                completed.add(sym)

            done = batch_start + len(batch)
            elapsed = time.time() - t0

            if done % 15 == 0 or done == len(remaining) or batch_start == 0:
                rate = done / elapsed if elapsed > 0 else 0
                eta = (len(remaining) - done) / rate / 60 if rate > 0 else 0
                print(
                    f"  [{done:,}/{len(remaining):,}] "
                    f"raw={new_raw_bars:,.0f} agg={new_daily_rows:,.0f} "
                    f"| {empty_symbols:,} empty "
                    f"| {done/len(remaining)*100:.0f}% | {elapsed:.0f}s "
                    f"| ETA {eta:.0f}m"
                )

            if done % 50 == 0:
                save_progress(completed)

    save_progress(completed)

    # Final stats
    elapsed = time.time() - t0
    all_files = list(OUT_DIR.glob("*.parquet"))
    total_size = sum(f.stat().st_size for f in all_files)

    print(f"\n{'=' * 60}")
    print(f"1-minute intraday stats complete!")
    print(f"{'=' * 60}")
    print(f"  Raw 1-min bars processed: {new_raw_bars:,.0f}")
    print(f"  Daily aggregated rows: {new_daily_rows:,.0f}")
    print(f"  Empty symbols: {empty_symbols:,}")
    print(f"  Total parquet files: {len(all_files):,}")
    print(f"  Total size: {total_size / 1e6:.1f} MB")
    print(f"  Elapsed: {elapsed / 60:.1f} min")
    print(f"  Compression ratio: {new_raw_bars / max(new_daily_rows, 1):.0f}x")

    load_to_duckdb()


def load_to_duckdb():
    """Load all per-symbol parquet files into DuckDB via glob."""
    import duckdb

    parquet_glob = str(OUT_DIR / "*.parquet").replace("\\", "/")
    all_files = list(OUT_DIR.glob("*.parquet"))
    if not all_files:
        print("No parquet files to load!")
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS massive_1min_stats")
    con.execute(f"""
        CREATE TABLE massive_1min_stats AS
        SELECT * FROM read_parquet('{parquet_glob}')
    """)

    cnt = con.execute("SELECT COUNT(*) FROM massive_1min_stats").fetchone()[0]
    tickers = con.execute(
        "SELECT COUNT(DISTINCT ticker) FROM massive_1min_stats"
    ).fetchone()[0]
    dates = con.execute(
        "SELECT COUNT(DISTINCT bar_date) FROM massive_1min_stats"
    ).fetchone()[0]

    print(f"  massive_1min_stats: {cnt:,} rows, {tickers:,} tickers, {dates:,} dates")

    avg_rows = con.execute(
        "SELECT AVG(cnt) FROM (SELECT COUNT(*) as cnt FROM massive_1min_stats GROUP BY ticker)"
    ).fetchone()[0]
    print(f"  Avg days per ticker: {avg_rows:,.0f}")

    min_date = con.execute("SELECT MIN(bar_date) FROM massive_1min_stats").fetchone()[0]
    max_date = con.execute("SELECT MAX(bar_date) FROM massive_1min_stats").fetchone()[0]
    print(f"  Date range: {min_date} to {max_date}")

    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch 1-min intraday bars and pre-aggregate into daily metrics"
    )
    parser.add_argument("--smoke", action="store_true",
                        help="Smoke test: first 3 symbols only")
    parser.add_argument("--symbols", nargs="+",
                        help="Fetch specific symbols only")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
