"""
39_fetch_etf_bars_alpaca.py
----------------------------
Fetch 1-minute bars for SPY + sector ETFs from Alpaca (SIP feed)
for the pre-2021 gap where Polygon data isn't available.

Fills the `etf_bars` table so build_silver.py can compute SPY context
for ALL 28,875 trades (not just the 22.7% covered by Polygon's 2021+ data).

ETFs fetched: SPY, QQQ, IWM, DIA + 11 SPDR sector ETFs
Date range: 2016-01-01 to 2021-03-07 (gap before Polygon coverage)

Usage:
    python scripts/39_fetch_etf_bars_alpaca.py                   # Fetch all
    python scripts/39_fetch_etf_bars_alpaca.py --symbol SPY      # Single ETF
    python scripts/39_fetch_etf_bars_alpaca.py --dry-run         # Preview
    python scripts/39_fetch_etf_bars_alpaca.py --reset-progress  # Re-fetch all
"""

import argparse
import json
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import duckdb
import httpx
import pandas as pd

# ── project paths ──
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent))
from config.settings import DUCKDB_PATH

# Load API keys from .env
from dotenv import load_dotenv
import os
load_dotenv(SCRIPT_DIR.parent / ".env")

ALPACA_API_KEY = os.getenv("ALPACA_API_KEY")
ALPACA_API_SECRET = os.getenv("ALPACA_API_SECRET")
ALPACA_DATA_URL = "https://data.alpaca.markets/v2"

# ETFs to fetch (same list as script 15)
ETF_SYMBOLS = [
    # Benchmarks
    "SPY", "QQQ", "IWM", "DIA",
    # SPDR Sector ETFs
    "XLF", "XLK", "XLE", "XLV", "XLI", "XLP", "XLU", "XLB", "XLRE", "XLC", "XLY",
]

# Gap period: before Polygon etf_bars coverage
GAP_START = "2016-01-01"
GAP_END = "2021-03-07"

PROGRESS_FILE = SCRIPT_DIR.parent / "data" / "progress" / "etf_bars_alpaca.json"


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        return json.loads(PROGRESS_FILE.read_text())
    return {"completed": [], "failed": []}


def save_progress(progress: dict):
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(json.dumps(progress, indent=2))


def fetch_bars_for_date(client: httpx.Client, symbol: str, date: str) -> list[dict]:
    """Fetch 1-minute bars for a single symbol-date from Alpaca."""
    url = f"{ALPACA_DATA_URL}/stocks/{symbol}/bars"
    params = {
        "timeframe": "1Min",
        "start": f"{date}T09:30:00Z",
        "end": f"{date}T20:00:00Z",
        "feed": "sip",
        "limit": 10000,
        "adjustment": "all",
    }
    headers = {
        "APCA-API-KEY-ID": ALPACA_API_KEY,
        "APCA-API-SECRET-KEY": ALPACA_API_SECRET,
    }

    all_bars = []
    while True:
        resp = client.get(url, params=params, headers=headers)
        if resp.status_code == 429:
            time.sleep(1)
            continue
        resp.raise_for_status()
        data = resp.json()
        bars = data.get("bars") or []
        all_bars.extend(bars)

        next_token = data.get("next_page_token")
        if not next_token:
            break
        params["page_token"] = next_token

    return all_bars


def get_trading_dates(start: str, end: str) -> list[str]:
    """Generate weekday dates between start and end."""
    dates = []
    current = datetime.strptime(start, "%Y-%m-%d")
    end_dt = datetime.strptime(end, "%Y-%m-%d")
    while current <= end_dt:
        if current.weekday() < 5:  # Mon-Fri
            dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return dates


def main():
    parser = argparse.ArgumentParser(description="Fetch ETF minute bars from Alpaca")
    parser.add_argument("--symbol", help="Fetch single ETF symbol")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--reset-progress", action="store_true")
    args = parser.parse_args()

    if not ALPACA_API_KEY or not ALPACA_API_SECRET:
        print("ERROR: ALPACA_API_KEY and ALPACA_API_SECRET must be set in .env")
        sys.exit(1)

    symbols = [args.symbol.upper()] if args.symbol else ETF_SYMBOLS
    dates = get_trading_dates(GAP_START, GAP_END)
    print(f"ETF symbols: {len(symbols)}")
    print(f"Date range: {GAP_START} to {GAP_END} ({len(dates)} weekdays)")

    # Build symbol-date pairs
    pairs = [(sym, d) for sym in symbols for d in dates]
    print(f"Total symbol-date pairs: {len(pairs):,}")

    # Load progress
    if args.reset_progress:
        progress = {"completed": [], "failed": []}
        save_progress(progress)
    else:
        progress = load_progress()

    completed_set = set(progress["completed"])
    remaining = [(s, d) for s, d in pairs if f"{s}_{d}" not in completed_set]
    print(f"Already completed: {len(completed_set):,}")
    print(f"Remaining: {len(remaining):,}")

    if args.dry_run:
        print(f"\nDry run: would fetch {len(remaining):,} symbol-date pairs")
        return

    if not remaining:
        print("Nothing to fetch!")
        return

    # Connect to DuckDB
    con = duckdb.connect(str(DUCKDB_PATH))

    # Ensure etf_bars exists with correct schema
    con.execute("""
        CREATE TABLE IF NOT EXISTS etf_bars (
            symbol VARCHAR,
            bar_time TIMESTAMP,
            open DOUBLE,
            high DOUBLE,
            low DOUBLE,
            close DOUBLE,
            volume BIGINT,
            vwap DOUBLE,
            num_trades BIGINT
        )
    """)

    client = httpx.Client(timeout=30)
    total_bars = 0
    batch = []
    batch_size = 50  # Insert every 50 symbol-dates

    t0 = time.time()
    for i, (symbol, date) in enumerate(remaining):
        try:
            bars = fetch_bars_for_date(client, symbol, date)
            for b in bars:
                batch.append({
                    "symbol": symbol,
                    "bar_time": b["t"],
                    "open": b["o"],
                    "high": b["h"],
                    "low": b["l"],
                    "close": b["c"],
                    "volume": b["v"],
                    "vwap": b.get("vw", 0),
                    "num_trades": b.get("n", 0),
                })
            total_bars += len(bars)
            progress["completed"].append(f"{symbol}_{date}")

            # Batch insert
            if len(batch) >= 1000 or (i + 1) % batch_size == 0:
                if batch:
                    df = pd.DataFrame(batch)
                    df["bar_time"] = pd.to_datetime(df["bar_time"])
                    con.execute("INSERT INTO etf_bars SELECT * FROM df")
                    batch = []
                save_progress(progress)

            if (i + 1) % 100 == 0:
                elapsed = time.time() - t0
                rate = (i + 1) / elapsed * 60
                eta = (len(remaining) - i - 1) / rate if rate > 0 else 0
                print(f"  [{i+1:,}/{len(remaining):,}] {symbol} {date} "
                      f"| {total_bars:,} bars | {rate:.0f} pairs/min | ETA {eta:.0f}min")

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 422:
                # Symbol not found on Alpaca
                progress["completed"].append(f"{symbol}_{date}")
            else:
                progress["failed"].append(f"{symbol}_{date}")
                print(f"  ERROR {symbol} {date}: {e.response.status_code}")
        except Exception as e:
            progress["failed"].append(f"{symbol}_{date}")
            print(f"  ERROR {symbol} {date}: {e}")

        # Rate limiting: 200 calls/min on free tier
        if (i + 1) % 190 == 0:
            time.sleep(2)

    # Final batch insert
    if batch:
        df = pd.DataFrame(batch)
        df["bar_time"] = pd.to_datetime(df["bar_time"])
        con.execute("INSERT INTO etf_bars SELECT * FROM df")
    save_progress(progress)

    elapsed = time.time() - t0

    # Summary
    etf_count = con.execute("SELECT COUNT(*) FROM etf_bars").fetchone()[0]
    etf_range = con.execute("""
        SELECT MIN(CAST(bar_time AS DATE)), MAX(CAST(bar_time AS DATE))
        FROM etf_bars
    """).fetchone()

    print(f"\nDone in {elapsed:.0f}s")
    print(f"Fetched {total_bars:,} bars")
    print(f"etf_bars total: {etf_count:,} rows")
    print(f"etf_bars range: {etf_range[0]} to {etf_range[1]}")
    print(f"Failed: {len(progress['failed']):,}")

    client.close()
    con.close()


if __name__ == "__main__":
    main()
