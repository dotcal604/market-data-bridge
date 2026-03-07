"""
32_fetch_indicators.py — Fetch pre-computed technical indicators from Polygon.

Endpoints:
  - /v1/indicators/sma/{ticker}
  - /v1/indicators/ema/{ticker}
  - /v1/indicators/rsi/{ticker}
  - /v1/indicators/macd/{ticker}

Fetches for all unique Holly-traded symbols. Stores as parquet per indicator type.

Usage:
    python scripts/32_fetch_indicators.py                  # Fetch all indicators
    python scripts/32_fetch_indicators.py --only sma,rsi   # Specific indicators
    python scripts/32_fetch_indicators.py --force           # Overwrite existing
"""

import argparse
import asyncio
import sys
import time
from datetime import datetime
from pathlib import Path

import duckdb
import httpx
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import POLYGON_API_KEY, DATA_DIR, DUCKDB_PATH

POLYGON_BASE = "https://api.polygon.io"
INDICATOR_DIR = DATA_DIR / "indicators"
CONCURRENCY = 10

# Indicator configs: (name, endpoint_path, extra_params)
INDICATORS = {
    "sma_20": {
        "endpoint": "/v1/indicators/sma",
        "params": {"window": 20, "timespan": "day", "series_type": "close", "limit": 5000},
    },
    "sma_50": {
        "endpoint": "/v1/indicators/sma",
        "params": {"window": 50, "timespan": "day", "series_type": "close", "limit": 5000},
    },
    "ema_9": {
        "endpoint": "/v1/indicators/ema",
        "params": {"window": 9, "timespan": "day", "series_type": "close", "limit": 5000},
    },
    "ema_21": {
        "endpoint": "/v1/indicators/ema",
        "params": {"window": 21, "timespan": "day", "series_type": "close", "limit": 5000},
    },
    "rsi_14": {
        "endpoint": "/v1/indicators/rsi",
        "params": {"window": 14, "timespan": "day", "series_type": "close", "limit": 5000},
    },
    "macd": {
        "endpoint": "/v1/indicators/macd",
        "params": {"timespan": "day", "series_type": "close", "limit": 5000},
    },
}


def get_holly_symbols() -> list[str]:
    """Get unique symbols from Holly trades."""
    db = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    result = db.execute("SELECT DISTINCT symbol FROM trades ORDER BY symbol").fetchall()
    db.close()
    return [r[0] for r in result]


async def fetch_indicator_for_symbol(
    client: httpx.AsyncClient,
    ticker: str,
    indicator_name: str,
    endpoint: str,
    params: dict,
    semaphore: asyncio.Semaphore,
) -> list[dict]:
    """Fetch one indicator for one symbol."""
    async with semaphore:
        url = f"{POLYGON_BASE}{endpoint}/{ticker}"
        query = {**params, "apiKey": POLYGON_API_KEY, "adjusted": "true"}

        try:
            resp = await client.get(url, params=query, timeout=30)
            if resp.status_code == 403:
                return []  # Not available on plan
            if resp.status_code == 429:
                await asyncio.sleep(5)
                resp = await client.get(url, params=query, timeout=30)
            if resp.status_code != 200:
                return []

            data = resp.json()
            values = data.get("results", {}).get("values", [])
            rows = []
            for v in values:
                row = {"ticker": ticker, "indicator": indicator_name}
                row["timestamp"] = v.get("timestamp")
                row["value"] = v.get("value")
                # MACD has extra fields
                if "signal" in v:
                    row["signal"] = v.get("signal")
                if "histogram" in v:
                    row["histogram"] = v.get("histogram")
                rows.append(row)
            return rows
        except Exception:
            return []


async def fetch_indicator(indicator_name: str, config: dict, symbols: list[str], force: bool = False) -> None:
    """Fetch one indicator type for all symbols."""
    out_file = INDICATOR_DIR / f"{indicator_name}.parquet"

    if out_file.exists() and not force:
        df = pd.read_parquet(out_file)
        print(f"  Cached: {indicator_name} — {len(df):,} rows ({df['ticker'].nunique()} symbols)")
        return

    print(f"\n  Fetching {indicator_name} for {len(symbols)} symbols...")
    t0 = time.time()
    semaphore = asyncio.Semaphore(CONCURRENCY)

    async with httpx.AsyncClient() as client:
        tasks = [
            fetch_indicator_for_symbol(
                client, sym, indicator_name, config["endpoint"], config["params"], semaphore,
            )
            for sym in symbols
        ]
        results = await asyncio.gather(*tasks)

    all_rows = [r for batch in results for r in batch]

    if not all_rows:
        elapsed = time.time() - t0
        print(f"  [WARN] No data returned for {indicator_name} ({elapsed:.1f}s)")
        if elapsed < 5:
            print(f"  [NOTE] May not be available on Starter plan")
        return

    df = pd.DataFrame(all_rows)

    # Convert timestamp (ms epoch) to datetime
    if "timestamp" in df.columns:
        df["date"] = pd.to_datetime(df["timestamp"], unit="ms").dt.date
        df = df.drop(columns=["timestamp"])

    df.to_parquet(out_file, index=False)
    elapsed = time.time() - t0
    print(f"  {indicator_name}: {len(df):,} rows, {df['ticker'].nunique()} symbols -> {out_file.name} ({elapsed:.1f}s)")


async def run(only: set[str] | None, force: bool):
    INDICATOR_DIR.mkdir(parents=True, exist_ok=True)

    symbols = get_holly_symbols()
    print(f"\n{'='*60}")
    print(f"  Polygon Technical Indicators")
    print(f"  {len(symbols)} Holly-traded symbols")
    print(f"{'='*60}")

    for name, config in INDICATORS.items():
        short_name = name.split("_")[0] if "_" in name else name
        if only and short_name not in only and name not in only:
            continue
        await fetch_indicator(name, config, symbols, force)


def main():
    parser = argparse.ArgumentParser(description="Fetch Polygon technical indicators")
    parser.add_argument("--only", type=str, default=None,
                        help="Comma-separated indicator names to fetch (e.g. sma,rsi)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing data")
    args = parser.parse_args()

    only = set(args.only.split(",")) if args.only else None
    asyncio.run(run(only, args.force))


if __name__ == "__main__":
    main()
