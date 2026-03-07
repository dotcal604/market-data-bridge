"""
21_fetch_news.py — Fetch historical news articles from Polygon.

Paginated bulk endpoint — fetches ALL news articles with ticker tags,
timestamps, publisher, and keywords. Enables catalyst analysis for
Holly trades by matching news to trade entry times.

Usage:
    python scripts/21_fetch_news.py
    python scripts/21_fetch_news.py --ticker AAPL
    python scripts/21_fetch_news.py --since 2021-01-01
"""

import argparse
import asyncio
import sys
import time
from pathlib import Path

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import POLYGON_API_KEY, DATA_DIR, DUCKDB_PATH

POLYGON_BASE = "https://api.polygon.io"
REF_DIR = DATA_DIR / "reference"


async def fetch_news(
    client: httpx.AsyncClient,
    ticker: str | None = None,
    since: str | None = None,
) -> pd.DataFrame:
    """Fetch news articles via paginated bulk endpoint."""
    label = "news"
    if ticker:
        label += f"_{ticker}"

    out_file = REF_DIR / f"{label}.parquet"
    if out_file.exists():
        df = pd.read_parquet(out_file)
        print(f"  Cached: {len(df):,} articles -> {out_file.name}")
        return df

    print("=" * 60)
    print("Fetching news articles (paginated bulk)...")
    if ticker:
        print(f"  Ticker filter: {ticker}")
    if since:
        print(f"  Since: {since}")
    print("=" * 60)

    # Build initial URL with all params baked in
    url: str | None = (
        f"{POLYGON_BASE}/v2/reference/news"
        f"?limit=1000&order=asc&sort=published_utc"
        f"&apiKey={POLYGON_API_KEY}"
    )
    if ticker:
        url += f"&ticker={ticker}"
    if since:
        url += f"&published_utc.gte={since}"

    all_results = []
    page = 0
    t0 = time.time()

    while url:
        page += 1

        for attempt in range(3):
            try:
                resp = await client.get(url, timeout=30)

                if resp.status_code == 429:
                    wait = 2 ** (attempt + 1)
                    print(f"  Rate limited, waiting {wait}s...")
                    await asyncio.sleep(wait)
                    continue
                if resp.status_code != 200:
                    print(f"  ERROR: HTTP {resp.status_code} on page {page}")
                    url = None
                    break

                data = resp.json()
                results = data.get("results", [])
                all_results.extend(results)

                if page % 50 == 0 or page <= 3:
                    elapsed = time.time() - t0
                    print(
                        f"  Page {page}: {len(results)} articles "
                        f"(total: {len(all_results):,}, {elapsed:.0f}s)",
                        flush=True,
                    )

                next_url = data.get("next_url")
                url = f"{next_url}&apiKey={POLYGON_API_KEY}" if next_url else None
                break  # success

            except (httpx.TimeoutException, httpx.ConnectError) as e:
                if attempt < 2:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                print(f"  FAILED after 3 retries: {e}")
                url = None
                break

    if not all_results:
        print("  No news articles found!")
        return pd.DataFrame()

    # Flatten results — tickers is a list, join as comma-separated
    rows = []
    for art in all_results:
        tickers_list = art.get("tickers", [])
        keywords_list = art.get("keywords", [])
        publisher = art.get("publisher", {})

        rows.append({
            "id": art.get("id"),
            "published_utc": art.get("published_utc"),
            "title": art.get("title"),
            "author": art.get("author"),
            "article_url": art.get("article_url"),
            "tickers": ",".join(tickers_list) if tickers_list else None,
            "ticker_count": len(tickers_list),
            "keywords": ",".join(keywords_list) if keywords_list else None,
            "description": art.get("description"),
            "publisher_name": publisher.get("name"),
            "publisher_url": publisher.get("homepage_url"),
            "image_url": art.get("image_url"),
        })

    df = pd.DataFrame(rows)
    df = df.sort_values("published_utc").reset_index(drop=True)

    # Drop exact duplicates by id
    before = len(df)
    df = df.drop_duplicates(subset=["id"], keep="first").reset_index(drop=True)
    dupes = before - len(df)
    if dupes:
        print(f"  Dropped {dupes:,} duplicate articles")

    REF_DIR.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pandas(df), str(out_file))

    elapsed = time.time() - t0
    print(f"\n  Saved: {len(df):,} articles in {elapsed / 60:.1f}m -> {out_file.name}")
    print(f"  Size: {out_file.stat().st_size / 1e6:.1f} MB")
    print(f"  Date range: {df['published_utc'].min()} to {df['published_utc'].max()}")
    print(f"  Publishers: {df['publisher_name'].nunique():,}")
    top_pubs = df['publisher_name'].value_counts().head(5)
    for pub, cnt in top_pubs.items():
        print(f"    {pub}: {cnt:,}")
    print(f"  Articles with tickers: {(df['ticker_count'] > 0).sum():,}")
    return df


def load_to_duckdb(parquet_file: Path):
    """Load news into DuckDB."""
    import duckdb

    if not parquet_file.exists():
        print("  No parquet file to load")
        return

    print("\n" + "=" * 60)
    print("Loading news into DuckDB...")
    print("=" * 60)

    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS news")
    con.execute(f"""
        CREATE TABLE news AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)

    cnt = con.execute("SELECT COUNT(*) FROM news").fetchone()[0]
    pubs = con.execute("SELECT COUNT(DISTINCT publisher_name) FROM news").fetchone()[0]
    with_tickers = con.execute("SELECT COUNT(*) FROM news WHERE ticker_count > 0").fetchone()[0]
    print(f"  news: {cnt:,} rows, {pubs:,} publishers, {with_tickers:,} with tickers")
    con.close()


async def main_async(ticker: str | None, since: str | None):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient() as client:
        df = await fetch_news(client, ticker=ticker, since=since)

    if not df.empty:
        label = "news"
        if ticker:
            label += f"_{ticker}"
        load_to_duckdb(REF_DIR / f"{label}.parquet")

    print("\n" + "=" * 60)
    print("News fetch complete!")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="Fetch Polygon historical news")
    parser.add_argument("--ticker", default=None, help="Filter by ticker")
    parser.add_argument("--since", default=None, help="Earliest date (YYYY-MM-DD)")
    args = parser.parse_args()
    asyncio.run(main_async(ticker=args.ticker, since=args.since))


if __name__ == "__main__":
    main()
