"""Fetch Benzinga-equivalent data from free sources for backtesting.

Benzinga via Massive.com ($99/mo) provides:
  1. Timestamped news with categories (FDA, earnings, M&A, etc.)
  2. Analyst ratings + price targets (already tested via upgrades_downgrades)
  3. Insider transactions
  4. Short interest
  5. Institutional ownership changes
  6. Pre-market movers/sentiment

Free proxies via yfinance:
  - insider_transactions -> insider buy/sell activity
  - major_holders -> institutional vs insider ownership %
  - analyst_price_targets -> consensus price targets
  - news (yfinance news count as proxy for Benzinga news volume)

Usage:
    python -m holly_tearsheets.fetch_benzinga_proxies
    python -m holly_tearsheets.fetch_benzinga_proxies --top 100
"""

import argparse
import json
import time
import warnings
from pathlib import Path

import pandas as pd
import numpy as np
import yfinance as yf

from .config import PACKAGE_ROOT, HOLLY_CSV

warnings.filterwarnings("ignore")

CATALYST_DIR = PACKAGE_ROOT / "output" / "catalysts"
INSIDER_FILE = CATALYST_DIR / "insider_transactions.parquet"
PRICE_TARGETS_FILE = CATALYST_DIR / "price_targets.parquet"
HOLDERS_FILE = CATALYST_DIR / "holders.parquet"
NEWS_VOLUME_FILE = CATALYST_DIR / "news_volume.parquet"
PROGRESS_FILE = CATALYST_DIR / "benzinga_proxy_progress.json"

BATCH_SIZE = 5
SLEEP_BETWEEN_BATCHES = 2.5
SLEEP_BETWEEN_SYMBOLS = 0.4


def get_holly_symbols(top_n: int = None) -> list[str]:
    df = pd.read_csv(HOLLY_CSV, usecols=["symbol"])
    counts = df["symbol"].value_counts()
    symbols = counts.index.tolist()
    return symbols[:top_n] if top_n else symbols


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        return json.loads(PROGRESS_FILE.read_text())
    return {"completed": [], "failed": [], "no_data": []}


def save_progress(progress: dict):
    PROGRESS_FILE.write_text(json.dumps(progress, indent=2))


def fetch_insider_transactions(symbol: str) -> pd.DataFrame | None:
    """Fetch insider buys/sells."""
    try:
        ticker = yf.Ticker(symbol)
        it = ticker.insider_transactions
        if it is None or it.empty:
            return None
        it = it.copy()
        it["symbol"] = symbol
        # Standardize columns
        if "Start Date" in it.columns:
            it = it.rename(columns={"Start Date": "date"})
        elif "startDate" in it.columns:
            it = it.rename(columns={"startDate": "date"})
        return it
    except Exception:
        return None


def fetch_price_targets(symbol: str) -> dict | None:
    """Fetch analyst price target summary."""
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        if not info:
            return None

        result = {"symbol": symbol}
        for key in ["targetHighPrice", "targetLowPrice", "targetMeanPrice",
                     "targetMedianPrice", "numberOfAnalystOpinions",
                     "recommendationMean", "recommendationKey",
                     "currentPrice", "previousClose",
                     "shortRatio", "shortPercentOfFloat",
                     "heldPercentInsiders", "heldPercentInstitutions",
                     "floatShares", "sharesShort",
                     "beta", "trailingPE", "forwardPE",
                     "fiftyDayAverage", "twoHundredDayAverage",
                     "averageVolume", "averageVolume10days",
                     "marketCap"]:
            result[key] = info.get(key)

        # Compute price target upside
        if result.get("targetMeanPrice") and result.get("currentPrice"):
            result["pt_upside_pct"] = (
                (result["targetMeanPrice"] - result["currentPrice"])
                / result["currentPrice"] * 100
            )
        return result
    except Exception:
        return None


def fetch_news_count(symbol: str) -> dict | None:
    """Get news article count as proxy for Benzinga news volume."""
    try:
        ticker = yf.Ticker(symbol)
        news = ticker.news
        if not news:
            return {"symbol": symbol, "news_count": 0, "news_titles": []}

        return {
            "symbol": symbol,
            "news_count": len(news),
            "news_titles": [n.get("title", "") for n in news[:5]],
        }
    except Exception:
        return None


def run_fetch(top_n: int = 100, resume: bool = True):
    CATALYST_DIR.mkdir(parents=True, exist_ok=True)

    symbols = get_holly_symbols(top_n=top_n)
    print(f"Fetching Benzinga-proxy data for {len(symbols)} symbols...")

    progress = load_progress() if resume else {"completed": [], "failed": [], "no_data": []}
    done = set(progress["completed"] + progress["failed"] + progress["no_data"])
    remaining = [s for s in symbols if s not in done]
    print(f"  Already processed: {len(done)}, remaining: {len(remaining)}")

    all_insider = []
    all_targets = []
    all_news = []

    # Load existing
    if resume and INSIDER_FILE.exists():
        all_insider.append(pd.read_parquet(INSIDER_FILE))
    if resume and PRICE_TARGETS_FILE.exists():
        all_targets.append(pd.read_parquet(PRICE_TARGETS_FILE))
    if resume and NEWS_VOLUME_FILE.exists():
        all_news.append(pd.read_parquet(NEWS_VOLUME_FILE))

    batch_count = 0
    for i, symbol in enumerate(remaining):
        got_data = False

        # 1. Insider transactions
        insider = fetch_insider_transactions(symbol)
        if insider is not None and not insider.empty:
            all_insider.append(insider)
            got_data = True

        # 2. Price targets + holdings + short interest (from .info)
        targets = fetch_price_targets(symbol)
        if targets is not None:
            all_targets.append(pd.DataFrame([targets]))
            got_data = True

        # 3. News volume
        news = fetch_news_count(symbol)
        if news is not None:
            all_news.append(pd.DataFrame([{
                "symbol": news["symbol"],
                "news_count": news["news_count"],
            }]))
            got_data = True

        if got_data:
            progress["completed"].append(symbol)
        else:
            progress["no_data"].append(symbol)

        total_done = len(progress["completed"]) + len(progress["failed"]) + len(progress["no_data"])
        if (i + 1) % 20 == 0:
            print(f"  [{total_done}/{len(symbols)}] {symbol}")

        time.sleep(SLEEP_BETWEEN_SYMBOLS)
        batch_count += 1
        if batch_count >= BATCH_SIZE:
            batch_count = 0
            time.sleep(SLEEP_BETWEEN_BATCHES)
            save_progress(progress)

    # Save
    save_progress(progress)

    if all_insider:
        insider_df = pd.concat(all_insider, ignore_index=True)
        insider_df.to_parquet(INSIDER_FILE)
        print(f"\nInsider transactions: {len(insider_df):,} rows, "
              f"{insider_df['symbol'].nunique()} symbols -> {INSIDER_FILE}")
    else:
        print("\nNo insider data.")

    if all_targets:
        targets_df = pd.concat(all_targets, ignore_index=True).drop_duplicates(subset=["symbol"])
        targets_df.to_parquet(PRICE_TARGETS_FILE)
        print(f"Price targets/info: {len(targets_df):,} rows -> {PRICE_TARGETS_FILE}")
    else:
        print("No price target data.")

    if all_news:
        news_df = pd.concat(all_news, ignore_index=True).drop_duplicates(subset=["symbol"])
        news_df.to_parquet(NEWS_VOLUME_FILE)
        print(f"News volume: {len(news_df):,} rows -> {NEWS_VOLUME_FILE}")

    print(f"\nDone. {len(progress['completed'])} with data, "
          f"{len(progress['no_data'])} no data, {len(progress['failed'])} failed.")


def main():
    parser = argparse.ArgumentParser(description="Fetch Benzinga-proxy data")
    parser.add_argument("--top", type=int, default=150,
                        help="Top N symbols by trade count")
    parser.add_argument("--no-resume", action="store_true")
    args = parser.parse_args()
    run_fetch(top_n=args.top, resume=not args.no_resume)


if __name__ == "__main__":
    main()
