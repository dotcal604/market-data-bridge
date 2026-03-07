"""
31_fetch_snapshots.py — Fetch full-market stock snapshots from Polygon.

Endpoint: GET /v2/snapshot/locale/us/markets/stocks/tickers
Returns: day bar, prevDay bar, min bar, todaysChange, todaysChangePerc for ALL tickers.

On Starter plan: lastTrade/lastQuote may be excluded; day/prevDay/min always included.
Stores one parquet per date in data/snapshots/YYYY-MM-DD.parquet.

Usage:
    python scripts/31_fetch_snapshots.py                  # Fetch today's snapshot
    python scripts/31_fetch_snapshots.py --force           # Overwrite if exists
"""

import argparse
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import POLYGON_API_KEY, DATA_DIR

POLYGON_BASE = "https://api.polygon.io"
SNAPSHOT_DIR = DATA_DIR / "snapshots"


def fetch_snapshot(force: bool = False) -> None:
    today = datetime.now().strftime("%Y-%m-%d")
    out_file = SNAPSHOT_DIR / f"{today}.parquet"

    if out_file.exists() and not force:
        df = pd.read_parquet(out_file)
        print(f"  Already fetched: {len(df):,} tickers -> {out_file.name}")
        return

    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print(f"  Fetching full-market snapshot ({today})")
    print("=" * 60)

    url = (
        f"{POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers"
        f"?include_otc=false"
        f"&apiKey={POLYGON_API_KEY}"
    )

    t0 = time.time()
    with httpx.Client(timeout=60) as client:
        resp = client.get(url)

    if resp.status_code == 403:
        print(f"  [403] Snapshots not available on current plan. Skipping.")
        return
    if resp.status_code != 200:
        print(f"  [ERROR] HTTP {resp.status_code}: {resp.text[:200]}")
        return

    data = resp.json()
    tickers = data.get("tickers", [])
    if not tickers:
        print("  [WARN] No tickers in response")
        return

    # Flatten nested objects
    rows = []
    for t in tickers:
        row = {
            "ticker": t.get("ticker"),
            "updated": t.get("updated"),
            "todays_change": t.get("todaysChange"),
            "todays_change_pct": t.get("todaysChangePerc"),
        }
        # Day bar
        day = t.get("day", {})
        for k in ["o", "h", "l", "c", "v", "vw"]:
            row[f"day_{k}"] = day.get(k)

        # Previous day bar
        prev = t.get("prevDay", {})
        for k in ["o", "h", "l", "c", "v", "vw"]:
            row[f"prev_{k}"] = prev.get(k)

        # Latest minute bar
        minute = t.get("min", {})
        for k in ["o", "h", "l", "c", "v", "vw", "av", "t", "n"]:
            row[f"min_{k}"] = minute.get(k)

        # Last trade (may be null on Starter)
        trade = t.get("lastTrade", {})
        if trade:
            row["last_trade_price"] = trade.get("p")
            row["last_trade_size"] = trade.get("s")
            row["last_trade_ts"] = trade.get("t")

        # Last quote (may be null on Starter)
        quote = t.get("lastQuote", {})
        if quote:
            row["last_bid"] = quote.get("p") or quote.get("P")
            row["last_ask"] = quote.get("P") if quote.get("p") else None
            row["last_bid_size"] = quote.get("s") or quote.get("S")
            row["last_ask_size"] = quote.get("S") if quote.get("s") else None

        rows.append(row)

    df = pd.DataFrame(rows)
    df.to_parquet(out_file, index=False)

    elapsed = time.time() - t0
    print(f"  {len(df):,} tickers saved -> {out_file.name} ({elapsed:.1f}s)")

    # Summary stats
    has_trade = df["last_trade_price"].notna().sum() if "last_trade_price" in df.columns else 0
    has_quote = df["last_bid"].notna().sum() if "last_bid" in df.columns else 0
    print(f"  day bars: {df['day_c'].notna().sum():,} | prevDay: {df['prev_c'].notna().sum():,}")
    print(f"  lastTrade: {has_trade:,} | lastQuote: {has_quote:,}")
    if has_trade == 0 and has_quote == 0:
        print(f"  [NOTE] No trade/quote data — expected on Starter plan")


def main():
    parser = argparse.ArgumentParser(description="Fetch full-market snapshot from Polygon")
    parser.add_argument("--force", action="store_true", help="Overwrite existing snapshot")
    args = parser.parse_args()
    fetch_snapshot(force=args.force)


if __name__ == "__main__":
    main()
