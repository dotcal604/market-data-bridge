"""
69_fetch_intraday_bars.py — Fetch 5-minute intraday bars and pre-aggregate into
daily intraday metrics via Massive.com API.

Per-symbol: fetches full 5-minute bar history (quarterly chunks to work around
API result cap of ~13K per request), then aggregates into one row per symbol
per trading day with intraday microstructure features:

  - Opening range (first 30 min high/low/volume)
  - Morning vs afternoon volume split
  - Intraday VWAP, range, bar count
  - Volume-at-price concentration (max 5-min bar volume)
  - Close position relative to opening range and day range

Saved as per-symbol parquet files in intraday_stats/ directory.
DuckDB loads via glob: read_parquet('intraday_stats/*.parquet')

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/69_fetch_intraday_bars.py
    python scripts/69_fetch_intraday_bars.py --smoke
    python scripts/69_fetch_intraday_bars.py --symbols AAPL MSFT TSLA
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
OUT_DIR = REF_DIR / "intraday_stats"
PROGRESS_FILE = REF_DIR / "intraday_stats_progress.json"

SEMAPHORE = asyncio.Semaphore(POLYGON_CONCURRENCY if POLYGON_CONCURRENCY else 10)

# Regular session hours (ET): 9:30-16:00 → UTC: 14:30-21:00 (EST) or 13:30-20:00 (EDT)
# We'll use bar_hour/bar_minute from UTC timestamps and filter dynamically
REGULAR_SESSION_START_MINUTES = 9 * 60 + 30  # 9:30 ET = 570 min
REGULAR_SESSION_END_MINUTES = 16 * 60         # 16:00 ET = 960 min


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


def build_quarterly_ranges() -> list[tuple[str, str]]:
    """Build quarterly date ranges from 2016-01-01 to today."""
    ranges = []
    start_year = 2016
    end_date = date.today()

    for year in range(start_year, end_date.year + 1):
        quarters = [
            (f"{year}-01-01", f"{year}-03-31"),
            (f"{year}-04-01", f"{year}-06-30"),
            (f"{year}-07-01", f"{year}-09-30"),
            (f"{year}-10-01", f"{year}-12-31"),
        ]
        for q_start, q_end in quarters:
            q_start_date = date.fromisoformat(q_start)
            q_end_date = date.fromisoformat(q_end)
            if q_start_date > end_date:
                break
            if q_end_date > end_date:
                q_end = end_date.isoformat()
            ranges.append((q_start, q_end))

    return ranges


async def fetch_quarter_bars(
    client: httpx.AsyncClient,
    symbol: str,
    date_from: str,
    date_to: str,
) -> list[dict]:
    """Fetch 5-min bars for one symbol over one quarter."""
    url = (
        f"{MASSIVE_BASE}/v2/aggs/ticker/{symbol}"
        f"/range/5/minute/{date_from}/{date_to}"
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


def aggregate_bars_to_daily(symbol: str, raw_bars: list[dict]) -> pd.DataFrame:
    """
    Aggregate 5-minute bars into daily intraday metrics.
    Returns one row per trading day.
    """
    if not raw_bars:
        return pd.DataFrame()

    df = pd.DataFrame(raw_bars)
    df["dt"] = pd.to_datetime(df["ts_ms"], unit="ms", utc=True)
    df["bar_date"] = df["dt"].dt.date.astype(str)
    df["bar_hour_utc"] = df["dt"].dt.hour
    df["bar_minute_utc"] = df["dt"].dt.minute
    df["minutes_utc"] = df["bar_hour_utc"] * 60 + df["bar_minute_utc"]

    # Sort by time within each day
    df = df.sort_values(["bar_date", "ts_ms"]).reset_index(drop=True)

    daily_rows = []

    for bar_date, day_df in df.groupby("bar_date"):
        if len(day_df) == 0:
            continue

        day_sorted = day_df.sort_values("ts_ms")

        # All bars
        day_open = day_sorted.iloc[0]["o"]
        day_high = day_sorted["h"].max()
        day_low = day_sorted["l"].min()
        day_close = day_sorted.iloc[-1]["c"]
        day_volume = day_sorted["v"].sum()
        day_trades = day_sorted["n"].sum()
        bar_count = len(day_sorted)

        # VWAP (volume-weighted average price)
        vw_vals = day_sorted["vw"].dropna()
        vol_vals = day_sorted.loc[vw_vals.index, "v"]
        if vol_vals.sum() > 0:
            day_vwap = (vw_vals * vol_vals).sum() / vol_vals.sum()
        else:
            day_vwap = None

        # Opening range: first 30 min (first 6 bars of the day)
        first_6 = day_sorted.head(6)
        or_high = first_6["h"].max()
        or_low = first_6["l"].min()
        or_volume = first_6["v"].sum()
        or_range = or_high - or_low if or_high and or_low else None

        # First hour (12 bars)
        first_12 = day_sorted.head(12)
        first_hour_high = first_12["h"].max()
        first_hour_low = first_12["l"].min()
        first_hour_volume = first_12["v"].sum()

        # Morning (first half of bars) vs afternoon (second half)
        midpoint = len(day_sorted) // 2
        morning_df = day_sorted.iloc[:midpoint]
        afternoon_df = day_sorted.iloc[midpoint:]
        morning_volume = morning_df["v"].sum()
        afternoon_volume = afternoon_df["v"].sum()

        # Volume concentration: max single-bar volume vs total
        max_bar_volume = day_sorted["v"].max()
        volume_concentration = (
            max_bar_volume / day_volume if day_volume > 0 else None
        )

        # Price range metrics
        intraday_range = day_high - day_low if day_high and day_low else None
        intraday_range_pct = (
            intraday_range / day_open * 100
            if intraday_range and day_open and day_open > 0
            else None
        )

        # Close position relative to day range (0 = at low, 1 = at high)
        close_position = (
            (day_close - day_low) / intraday_range
            if intraday_range and intraday_range > 0
            else None
        )

        # Close vs opening range
        if or_high and or_low:
            if day_close > or_high:
                close_vs_or = "above"
            elif day_close < or_low:
                close_vs_or = "below"
            else:
                close_vs_or = "inside"
        else:
            close_vs_or = None

        # Close vs VWAP
        close_vs_vwap = (
            (day_close - day_vwap) / day_vwap * 100
            if day_close and day_vwap and day_vwap > 0
            else None
        )

        # Volume profile: which portion of total volume happened in each third
        n_bars = len(day_sorted)
        third = max(n_bars // 3, 1)
        vol_third_1 = day_sorted.iloc[:third]["v"].sum()
        vol_third_2 = day_sorted.iloc[third:2*third]["v"].sum()
        vol_third_3 = day_sorted.iloc[2*third:]["v"].sum()

        vol_pct_1 = vol_third_1 / day_volume * 100 if day_volume > 0 else None
        vol_pct_2 = vol_third_2 / day_volume * 100 if day_volume > 0 else None
        vol_pct_3 = vol_third_3 / day_volume * 100 if day_volume > 0 else None

        # Price momentum: close of first vs last third
        price_first_third_close = day_sorted.iloc[third - 1]["c"]
        price_last_third_open = day_sorted.iloc[2 * third]["o"] if 2 * third < n_bars else None

        daily_rows.append({
            "ticker": symbol,
            "bar_date": bar_date,
            "id_bar_count": bar_count,
            "id_day_open": round(day_open, 4) if day_open else None,
            "id_day_high": round(day_high, 4) if day_high else None,
            "id_day_low": round(day_low, 4) if day_low else None,
            "id_day_close": round(day_close, 4) if day_close else None,
            "id_day_volume": int(day_volume),
            "id_day_trades": int(day_trades),
            "id_day_vwap": round(day_vwap, 4) if day_vwap else None,
            # Opening range (30 min)
            "id_or30_high": round(or_high, 4) if or_high else None,
            "id_or30_low": round(or_low, 4) if or_low else None,
            "id_or30_range": round(or_range, 4) if or_range else None,
            "id_or30_volume": int(or_volume),
            # First hour
            "id_first_hour_high": round(first_hour_high, 4) if first_hour_high else None,
            "id_first_hour_low": round(first_hour_low, 4) if first_hour_low else None,
            "id_first_hour_volume": int(first_hour_volume),
            # Volume distribution
            "id_morning_volume": int(morning_volume),
            "id_afternoon_volume": int(afternoon_volume),
            "id_volume_ratio_am_pm": (
                round(morning_volume / afternoon_volume, 4)
                if afternoon_volume > 0 else None
            ),
            "id_max_bar_volume": int(max_bar_volume) if max_bar_volume else None,
            "id_volume_concentration": (
                round(volume_concentration, 4) if volume_concentration else None
            ),
            # Volume by thirds
            "id_vol_pct_first_third": round(vol_pct_1, 2) if vol_pct_1 is not None else None,
            "id_vol_pct_mid_third": round(vol_pct_2, 2) if vol_pct_2 is not None else None,
            "id_vol_pct_last_third": round(vol_pct_3, 2) if vol_pct_3 is not None else None,
            # Range & position
            "id_intraday_range": round(intraday_range, 4) if intraday_range else None,
            "id_intraday_range_pct": round(intraday_range_pct, 4) if intraday_range_pct else None,
            "id_close_position": round(close_position, 4) if close_position else None,
            "id_close_vs_or": close_vs_or,
            "id_close_vs_vwap_pct": round(close_vs_vwap, 4) if close_vs_vwap else None,
        })

    return pd.DataFrame(daily_rows) if daily_rows else pd.DataFrame()


async def fetch_and_aggregate_symbol(
    client: httpx.AsyncClient,
    symbol: str,
    quarters: list[tuple[str, str]],
) -> tuple[str, pd.DataFrame, int]:
    """Fetch all quarterly chunks and aggregate for one symbol."""
    all_bars: list[dict] = []

    for q_start, q_end in quarters:
        bars = await fetch_quarter_bars(client, symbol, q_start, q_end)
        all_bars.extend(bars)

    total_raw = len(all_bars)
    daily_df = aggregate_bars_to_daily(symbol, all_bars)
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
        symbols = symbols[:5]
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

    quarters = build_quarterly_ranges()
    print(f"  Quarterly chunks per symbol: {len(quarters)}")

    print(f"\n{'=' * 60}")
    print(f"Fetching 5-minute intraday bars from Massive.com...")
    print(f"  Pre-aggregating into daily intraday metrics")
    print(f"  Total API calls est: ~{len(remaining) * len(quarters):,}")
    print(f"{'=' * 60}")

    t0 = time.time()
    new_raw_bars = 0
    new_daily_rows = 0
    empty_symbols = 0

    async with httpx.AsyncClient() as client:
        # Process symbols one at a time (each symbol makes many API calls)
        batch_size = 5
        for batch_start in range(0, len(remaining), batch_size):
            batch = remaining[batch_start:batch_start + batch_size]
            tasks = [
                fetch_and_aggregate_symbol(client, sym, quarters)
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

            if done % 25 == 0 or done == len(remaining) or batch_start == 0:
                rate = done / elapsed if elapsed > 0 else 0
                eta = (len(remaining) - done) / rate / 60 if rate > 0 else 0
                print(
                    f"  [{done:,}/{len(remaining):,}] "
                    f"raw={new_raw_bars:,.0f} agg={new_daily_rows:,.0f} "
                    f"| {empty_symbols:,} empty "
                    f"| {done/len(remaining)*100:.0f}% | {elapsed:.0f}s "
                    f"| ETA {eta:.0f}m"
                )

            if done % 100 == 0:
                save_progress(completed)

    save_progress(completed)

    # Final stats
    elapsed = time.time() - t0
    all_files = list(OUT_DIR.glob("*.parquet"))
    total_size = sum(f.stat().st_size for f in all_files)

    print(f"\n{'=' * 60}")
    print(f"Intraday stats aggregation complete!")
    print(f"{'=' * 60}")
    print(f"  Raw 5-min bars processed: {new_raw_bars:,.0f}")
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
    con.execute("DROP TABLE IF EXISTS massive_intraday_stats")
    con.execute(f"""
        CREATE TABLE massive_intraday_stats AS
        SELECT * FROM read_parquet('{parquet_glob}')
    """)

    cnt = con.execute("SELECT COUNT(*) FROM massive_intraday_stats").fetchone()[0]
    tickers = con.execute(
        "SELECT COUNT(DISTINCT ticker) FROM massive_intraday_stats"
    ).fetchone()[0]
    dates = con.execute(
        "SELECT COUNT(DISTINCT bar_date) FROM massive_intraday_stats"
    ).fetchone()[0]

    print(f"  massive_intraday_stats: {cnt:,} rows, {tickers:,} tickers, {dates:,} dates")

    avg_rows = con.execute(
        "SELECT AVG(cnt) FROM (SELECT COUNT(*) as cnt FROM massive_intraday_stats GROUP BY ticker)"
    ).fetchone()[0]
    print(f"  Avg days per ticker: {avg_rows:,.0f}")

    min_date = con.execute("SELECT MIN(bar_date) FROM massive_intraday_stats").fetchone()[0]
    max_date = con.execute("SELECT MAX(bar_date) FROM massive_intraday_stats").fetchone()[0]
    print(f"  Date range: {min_date} to {max_date}")

    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch 5-min intraday bars and pre-aggregate into daily metrics"
    )
    parser.add_argument("--smoke", action="store_true",
                        help="Smoke test: first 5 symbols only")
    parser.add_argument("--symbols", nargs="+",
                        help="Fetch specific symbols only")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
