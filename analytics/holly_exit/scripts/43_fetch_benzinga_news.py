"""
43_fetch_benzinga_news.py — Fetch Benzinga news via Massive.com API.

Daily-batched by Holly trade dates: for each trade date, fetches all
articles mentioning that day's traded symbols in a 2-day window
(date-1 to date+1). Deduplicates on benzinga_id across overlapping
windows.

Requires: Massive Advanced plan ($199/mo) with Benzinga News expansion.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/43_fetch_benzinga_news.py
    python scripts/43_fetch_benzinga_news.py --smoke       # single date test
    python scripts/43_fetch_benzinga_news.py --since 2023-01-01
    python scripts/43_fetch_benzinga_news.py --limit-dates 10
"""

import argparse
import asyncio
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import POLYGON_API_KEY, DATA_DIR, DUCKDB_PATH

MASSIVE_BASE = "https://api.massive.com"
REF_DIR = DATA_DIR / "reference"
PROGRESS_FILE = REF_DIR / "benzinga_news_progress.json"
OUT_FILE = REF_DIR / "benzinga_news.parquet"

# Benzinga v2 max tickers per request
MAX_TICKERS_PER_REQUEST = 50


def load_progress() -> set[str]:
    """Load set of completed trade dates (YYYY-MM-DD strings)."""
    if PROGRESS_FILE.exists():
        data = json.loads(PROGRESS_FILE.read_text())
        return set(data.get("completed_dates", []))
    return set()


def save_progress(completed: set[str]):
    """Persist completed dates."""
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(json.dumps({
        "completed_dates": sorted(completed),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2))


def load_trade_date_manifest(since: str | None = None) -> list[tuple[date, list[str]]]:
    """
    Load Holly trades from DuckDB, group by trade date -> unique symbol list.
    Returns sorted list of (trade_date, [symbols]) tuples, 2021+ only.
    """
    import duckdb

    db = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    where = "WHERE CAST(entry_time AS DATE) >= '2021-01-01'"
    if since:
        where = f"WHERE CAST(entry_time AS DATE) >= '{since}'"

    rows = db.execute(f"""
        SELECT
            CAST(entry_time AS DATE) AS trade_date,
            LIST(DISTINCT symbol ORDER BY symbol) AS symbols
        FROM trades
        {where}
        GROUP BY trade_date
        ORDER BY trade_date
    """).fetchall()

    db.close()

    manifest = [(r[0], r[1]) for r in rows]
    return manifest


async def fetch_date_batch(
    client: httpx.AsyncClient,
    trade_date: date,
    symbols: list[str],
) -> list[dict]:
    """
    Fetch all Benzinga articles for a set of symbols in a 2-day window
    around trade_date. Follows next_url pagination until exhausted.
    """
    # 2-day window: date-1 to date+1
    pub_gte = (trade_date - timedelta(days=1)).isoformat()
    pub_lt = (trade_date + timedelta(days=1)).isoformat()

    all_articles = []

    # Batch symbols at 50 max (though Holly max is 22/day)
    for i in range(0, len(symbols), MAX_TICKERS_PER_REQUEST):
        batch = symbols[i:i + MAX_TICKERS_PER_REQUEST]

        # Massive.com requires repeated tickers= params, NOT comma-separated
        params: list[tuple[str, str]] = [("tickers", s) for s in batch]
        params.extend([
            ("published.gte", pub_gte),
            ("published.lt", pub_lt),
            ("sort", "published.asc"),
            ("limit", "50000"),
            ("apiKey", POLYGON_API_KEY),
        ])

        # First request uses params; subsequent pages use next_url directly
        use_params = True
        url: str | None = f"{MASSIVE_BASE}/benzinga/v2/news"

        while url:
            for attempt in range(3):
                try:
                    if use_params:
                        resp = await client.get(url, params=params, timeout=30)
                        use_params = False  # next_url includes all params
                    else:
                        resp = await client.get(url, timeout=30)

                    if resp.status_code == 429:
                        wait = 2 ** (attempt + 1)
                        print(f"    Rate limited, waiting {wait}s...")
                        await asyncio.sleep(wait)
                        continue

                    if resp.status_code == 403:
                        print(f"    ERROR: 403 Forbidden — check Massive Advanced subscription")
                        return all_articles

                    if resp.status_code != 200:
                        print(f"    ERROR: HTTP {resp.status_code} for {trade_date}")
                        url = None
                        break

                    data = resp.json()
                    results = data.get("results", [])
                    all_articles.extend(results)

                    # Follow next_url until exhausted
                    next_url = data.get("next_url")
                    if next_url:
                        # Append apiKey only; other params are baked into cursor
                        url = f"{next_url}&apiKey={POLYGON_API_KEY}"
                    else:
                        url = None
                    break  # success

                except (httpx.TimeoutException, httpx.ConnectError) as e:
                    if attempt < 2:
                        await asyncio.sleep(2 ** (attempt + 1))
                        continue
                    print(f"    FAILED after 3 retries on {trade_date}: {e}")
                    url = None
                    break

    return all_articles


def flatten_article(art: dict, request_date: date) -> dict:
    """Flatten a single Benzinga article response into a flat row."""
    tickers_list = art.get("tickers", [])
    channels_list = art.get("channels", [])
    tags_list = art.get("tags", [])
    images_list = art.get("images", [])

    return {
        "benzinga_id": art.get("benzinga_id"),
        "published": art.get("published"),
        "last_updated": art.get("last_updated"),
        "title": art.get("title"),
        "author": art.get("author"),
        "teaser": art.get("teaser"),
        "body": art.get("body"),
        "url": art.get("url"),
        "tickers": ",".join(tickers_list) if tickers_list else None,
        "channels": ",".join(
            c.get("name", c) if isinstance(c, dict) else str(c)
            for c in channels_list
        ) if channels_list else None,
        "tags": ",".join(
            t.get("name", t) if isinstance(t, dict) else str(t)
            for t in tags_list
        ) if tags_list else None,
        "image_count": len(images_list),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "request_date": request_date.isoformat(),
    }


async def main_async(args):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    # Load trade date manifest
    print("Loading Holly trade dates from DuckDB...")
    manifest = load_trade_date_manifest(since=args.since)
    print(f"  Total trade dates: {len(manifest)}")
    total_symbols = sum(len(syms) for _, syms in manifest)
    print(f"  Total symbol-date pairs: {total_symbols:,}")

    if not manifest:
        print("No trade dates found!")
        return

    # Smoke test: single date only
    if args.smoke:
        manifest = manifest[:1]
        print(f"\n  SMOKE TEST: fetching only {manifest[0][0]} ({len(manifest[0][1])} symbols)")

    # Limit dates for testing
    if args.limit_dates:
        manifest = manifest[:args.limit_dates]
        print(f"  Limited to first {args.limit_dates} dates")

    # Load progress
    completed = load_progress()
    remaining = [(d, s) for d, s in manifest if d.isoformat() not in completed]
    print(f"  Already completed: {len(completed)}")
    print(f"  Remaining: {len(remaining)}")

    if not remaining:
        print("All trade dates already fetched!")
        # Still load existing parquet to DuckDB
        if OUT_FILE.exists():
            load_to_duckdb(OUT_FILE)
        return

    # Load existing articles for dedup
    existing_ids: set[int] = set()
    all_rows: list[dict] = []
    if OUT_FILE.exists():
        existing_df = pd.read_parquet(OUT_FILE)
        existing_ids = set(existing_df["benzinga_id"].dropna().astype(int))
        all_rows = existing_df.to_dict("records")
        print(f"  Existing articles: {len(existing_ids):,}")

    # Fetch
    print("\n" + "=" * 60)
    print("Fetching Benzinga news from Massive.com...")
    print("=" * 60)

    t0 = time.time()
    new_articles = 0
    dupes_skipped = 0

    async with httpx.AsyncClient() as client:
        for i, (trade_date, symbols) in enumerate(remaining):
            articles = await fetch_date_batch(client, trade_date, symbols)

            date_new = 0
            for art in articles:
                bid = art.get("benzinga_id")
                if bid and int(bid) in existing_ids:
                    dupes_skipped += 1
                    continue
                row = flatten_article(art, trade_date)
                all_rows.append(row)
                if bid:
                    existing_ids.add(int(bid))
                date_new += 1

            new_articles += date_new
            completed.add(trade_date.isoformat())

            # Progress logging
            elapsed = time.time() - t0
            pct = (i + 1) / len(remaining) * 100
            if (i + 1) % 25 == 0 or i == 0 or (i + 1) == len(remaining):
                print(
                    f"  [{i+1}/{len(remaining)}] {trade_date} "
                    f"| {len(symbols)} syms | +{date_new} articles "
                    f"| total: {len(all_rows):,} | {pct:.0f}% | {elapsed:.0f}s"
                )

            # Save progress every 50 dates
            if (i + 1) % 50 == 0:
                save_progress(completed)

    # Final save
    save_progress(completed)

    if not all_rows:
        print("No articles fetched!")
        return

    # Write parquet
    df = pd.DataFrame(all_rows)

    # Ensure benzinga_id is deduplicated (belt and suspenders)
    before = len(df)
    df = df.drop_duplicates(subset=["benzinga_id"], keep="last").reset_index(drop=True)
    final_dupes = before - len(df)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Benzinga news fetch complete!")
    print(f"{'=' * 60}")
    print(f"  New articles this run: {new_articles:,}")
    print(f"  Dupes skipped (cross-window): {dupes_skipped + final_dupes:,}")
    print(f"  Total unique articles: {len(df):,}")
    print(f"  File size: {OUT_FILE.stat().st_size / 1e6:.1f} MB")
    print(f"  Trade dates completed: {len(completed)}/{len(manifest)}")
    print(f"  Elapsed: {elapsed / 60:.1f} min")

    if not df.empty:
        print(f"  Date range: {df['published'].min()} to {df['published'].max()}")
        has_body = df["body"].notna().sum()
        print(f"  Articles with body: {has_body:,} ({has_body/len(df)*100:.0f}%)")
        has_channels = df["channels"].notna().sum()
        print(f"  Articles with channels: {has_channels:,}")

    # Load to DuckDB
    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    """Load benzinga news into DuckDB."""
    import duckdb

    if not parquet_file.exists():
        print("  No parquet file to load")
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")

    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS benzinga_news")
    con.execute(f"""
        CREATE TABLE benzinga_news AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)

    cnt = con.execute("SELECT COUNT(*) FROM benzinga_news").fetchone()[0]
    unique_ids = con.execute(
        "SELECT COUNT(DISTINCT benzinga_id) FROM benzinga_news"
    ).fetchone()[0]
    with_body = con.execute(
        "SELECT COUNT(*) FROM benzinga_news WHERE body IS NOT NULL"
    ).fetchone()[0]
    print(f"  benzinga_news: {cnt:,} rows, {unique_ids:,} unique IDs, {with_body:,} with body")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch Benzinga news via Massive.com for Holly trade dates"
    )
    parser.add_argument(
        "--smoke", action="store_true",
        help="Smoke test: fetch only the first trade date"
    )
    parser.add_argument(
        "--since", default=None,
        help="Earliest trade date (YYYY-MM-DD, default: 2021-01-01)"
    )
    parser.add_argument(
        "--limit-dates", type=int, default=None,
        help="Limit to first N trade dates (for testing)"
    )
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
