"""Fetch historical news + sentiment from Polygon/Massive Stocks News API.

This uses the BASE Stocks News endpoint (/v2/reference/news) which is
already included in the Starter plan. Tests whether news volume,
sentiment, and timing predict Holly trade outcomes BEFORE paying $99/mo
for the Benzinga News expansion pack.

Usage:
    python -m holly_tearsheets.fetch_polygon_news
    python -m holly_tearsheets.fetch_polygon_news --top 100
"""

import argparse
import json
import os
import time
import warnings
from pathlib import Path

import httpx
import pandas as pd

from .config import PACKAGE_ROOT, HOLLY_CSV

warnings.filterwarnings("ignore")

CATALYST_DIR = PACKAGE_ROOT / "output" / "catalysts"
NEWS_HIST_FILE = CATALYST_DIR / "polygon_news_history.parquet"
PROGRESS_FILE = CATALYST_DIR / "polygon_news_progress.json"

# Load API key from holly_exit .env
ENV_FILE = PACKAGE_ROOT.parent / "holly_exit" / ".env"
API_KEY = None
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith("POLYGON_API_KEY="):
            API_KEY = line.split("=", 1)[1].strip()
            break

if not API_KEY:
    API_KEY = os.getenv("POLYGON_API_KEY", "")

BASE_URL = "https://api.polygon.io"
RATE_LIMIT_SLEEP = 12.5  # Starter = 5 req/min => 12s between requests


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


def fetch_news_for_symbol(symbol: str, limit: int = 100) -> list[dict]:
    """Fetch news articles for a symbol from Polygon base Stocks News API.

    Returns list of article dicts with: published_utc, title, ticker,
    sentiment, sentiment_reasoning, source, keyword count.
    """
    url = f"{BASE_URL}/v2/reference/news"
    params = {
        "ticker": symbol,
        "limit": min(limit, 1000),
        "sort": "published_utc",
        "order": "desc",
        "apiKey": API_KEY,
    }

    try:
        resp = httpx.get(url, params=params, timeout=30)
        if resp.status_code == 429:
            print(f"    Rate limited on {symbol}, waiting 60s...")
            time.sleep(60)
            resp = httpx.get(url, params=params, timeout=30)

        if resp.status_code != 200:
            print(f"    {symbol}: HTTP {resp.status_code}")
            return []

        data = resp.json()
        results = data.get("results", [])

        articles = []
        for article in results:
            # Extract sentiment for this specific ticker from insights
            sentiment = None
            sentiment_reasoning = None
            insights = article.get("insights", [])
            for insight in insights:
                if insight.get("ticker") == symbol:
                    sentiment = insight.get("sentiment")
                    sentiment_reasoning = insight.get("sentiment_reasoning")
                    break

            articles.append({
                "symbol": symbol,
                "published_utc": article.get("published_utc"),
                "title": article.get("title", ""),
                "source": article.get("publisher", {}).get("name", ""),
                "sentiment": sentiment,
                "sentiment_reasoning": sentiment_reasoning,
                "num_tickers": len(article.get("tickers", [])),
                "num_keywords": len(article.get("keywords", [])),
                "article_id": article.get("id"),
            })

        return articles

    except Exception as e:
        print(f"    {symbol}: Error - {e}")
        return []


def run_fetch(top_n: int = 80, resume: bool = True):
    CATALYST_DIR.mkdir(parents=True, exist_ok=True)

    if not API_KEY:
        print("ERROR: No POLYGON_API_KEY found. Check holly_exit/.env")
        return

    print(f"API Key: {API_KEY[:8]}...{API_KEY[-4:]}")

    symbols = get_holly_symbols(top_n=top_n)
    print(f"Fetching Polygon news for {len(symbols)} symbols...")

    progress = load_progress() if resume else {"completed": [], "failed": [], "no_data": []}
    done = set(progress["completed"] + progress["failed"] + progress["no_data"])
    remaining = [s for s in symbols if s not in done]
    print(f"  Already processed: {len(done)}, remaining: {len(remaining)}")

    all_news = []
    if resume and NEWS_HIST_FILE.exists():
        all_news.append(pd.read_parquet(NEWS_HIST_FILE))

    for i, symbol in enumerate(remaining):
        articles = fetch_news_for_symbol(symbol)

        if articles:
            all_news.append(pd.DataFrame(articles))
            progress["completed"].append(symbol)
        else:
            progress["no_data"].append(symbol)

        total_done = len(progress["completed"]) + len(progress["failed"]) + len(progress["no_data"])
        if (i + 1) % 10 == 0:
            total_articles = sum(len(n) for n in all_news)
            print(f"  [{total_done}/{len(symbols)}] {symbol} - {total_articles:,} total articles")

            # Checkpoint
            save_progress(progress)
            if all_news:
                pd.concat(all_news, ignore_index=True).to_parquet(NEWS_HIST_FILE)

        # Rate limit: Starter = 5 req/min
        time.sleep(RATE_LIMIT_SLEEP)

    # Final save
    save_progress(progress)
    if all_news:
        news_df = pd.concat(all_news, ignore_index=True).drop_duplicates(
            subset=["symbol", "article_id"]
        )
        news_df.to_parquet(NEWS_HIST_FILE)
        print(f"\nNews: {len(news_df):,} articles, "
              f"{news_df['symbol'].nunique()} symbols -> {NEWS_HIST_FILE}")

        # Sentiment breakdown
        if "sentiment" in news_df.columns:
            sent_counts = news_df["sentiment"].value_counts(dropna=False)
            print(f"\nSentiment coverage:")
            for sent, count in sent_counts.items():
                print(f"  {str(sent):<12} {count:>6,} ({count/len(news_df):.0%})")
    else:
        print("\nNo news data fetched.")

    print(f"\nDone. {len(progress['completed'])} with data, "
          f"{len(progress['no_data'])} no data, {len(progress['failed'])} failed.")


def main():
    parser = argparse.ArgumentParser(description="Fetch Polygon news + sentiment")
    parser.add_argument("--top", type=int, default=80,
                        help="Top N symbols by trade count")
    parser.add_argument("--no-resume", action="store_true")
    args = parser.parse_args()
    run_fetch(top_n=args.top, resume=not args.no_resume)


if __name__ == "__main__":
    main()
