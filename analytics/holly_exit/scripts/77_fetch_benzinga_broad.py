"""
Script 77 -- Broad Benzinga News Fetch (no ticker filter)
==========================================================
The existing script 43 fetches Benzinga articles ONLY for Holly trade
symbols, yielding just 4,846 articles (3.5% trade coverage). This script
fetches ALL Benzinga articles by date range to maximize coverage.

Strategy: Fetch day-by-day without ticker filter. This gets all articles
for all stocks, not just Holly trade symbols. Expected yield: 50-200
articles/day = 50K-250K total articles over 5 years.

Uses the same Massive.com /benzinga/v2/news endpoint but without tickers param.
Targets key financial channels: earnings, movers, price target, analyst ratings.

Usage:
    python scripts/77_fetch_benzinga_broad.py                    # Full fetch
    python scripts/77_fetch_benzinga_broad.py --smoke            # Single day test
    python scripts/77_fetch_benzinga_broad.py --since 2024-01-01 # Recent only
    python scripts/77_fetch_benzinga_broad.py --channels         # Channel-filtered only
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
PROGRESS_FILE = REF_DIR / "benzinga_broad_progress.json"
OUT_FILE = REF_DIR / "benzinga_news_broad.parquet"

# Key financial channels that matter for Holly trade prediction
KEY_CHANNELS = [
    "earnings", "movers", "price target", "analyst ratings",
    "news", "markets", "trading ideas",
]


def load_progress() -> dict:
    """Load progress state."""
    if PROGRESS_FILE.exists():
        return json.loads(PROGRESS_FILE.read_text())
    return {"completed_dates": [], "total_articles": 0, "updated_at": None}


def save_progress(state: dict):
    """Persist progress state."""
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(json.dumps(state, indent=2))


def get_trading_days(since: str = "2021-01-01", until: str | None = None) -> list[date]:
    """Generate weekday dates as proxy for trading days."""
    start = date.fromisoformat(since)
    end = date.fromisoformat(until) if until else date.today() - timedelta(days=1)
    days = []
    current = start
    while current <= end:
        if current.weekday() < 5:  # Mon-Fri
            days.append(current)
        current += timedelta(days=1)
    return days


async def fetch_day(
    client: httpx.AsyncClient,
    day: date,
    use_channels: bool = False,
) -> list[dict]:
    """
    Fetch all Benzinga articles for a single day.
    Without ticker filter to get maximum coverage.
    """
    pub_gte = day.isoformat()
    pub_lt = (day + timedelta(days=1)).isoformat()

    all_articles = []

    params: list[tuple[str, str]] = [
        ("published.gte", pub_gte),
        ("published.lt", pub_lt),
        ("sort", "published.asc"),
        ("limit", "50000"),
        ("apiKey", POLYGON_API_KEY),
    ]

    # Optionally filter to key financial channels only
    if use_channels:
        for ch in KEY_CHANNELS:
            params.append(("channels.any_of", ch))

    url: str | None = f"{MASSIVE_BASE}/benzinga/v2/news"
    use_params = True

    while url:
        for attempt in range(3):
            try:
                if use_params:
                    resp = await client.get(url, params=params, timeout=30)
                    use_params = False
                else:
                    resp = await client.get(url, timeout=30)

                if resp.status_code == 429:
                    wait = 2 ** (attempt + 1)
                    print(f"    Rate limited, waiting {wait}s...")
                    await asyncio.sleep(wait)
                    continue

                if resp.status_code == 403:
                    print(f"    ERROR: 403 Forbidden -- check Massive subscription")
                    return all_articles

                if resp.status_code != 200:
                    print(f"    ERROR: HTTP {resp.status_code} for {day}")
                    url = None
                    break

                data = resp.json()
                results = data.get("results", [])
                all_articles.extend(results)

                next_url = data.get("next_url")
                if next_url:
                    url = f"{next_url}&apiKey={POLYGON_API_KEY}"
                else:
                    url = None
                break

            except (httpx.TimeoutException, httpx.ConnectError) as e:
                if attempt < 2:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                print(f"    FAILED after 3 retries on {day}: {e}")
                url = None
                break

    return all_articles


def flatten_article(art: dict, request_date: date) -> dict:
    """Flatten a Benzinga article into a flat row."""
    tickers_list = art.get("tickers", [])
    channels_list = art.get("channels", [])
    tags_list = art.get("tags", [])

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
        "image_count": len(art.get("images", [])),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "request_date": request_date.isoformat(),
    }


async def main_async(args):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    # Generate all trading days
    since = args.since or "2021-01-01"
    all_days = get_trading_days(since=since)
    print(f"Total trading days: {len(all_days)}")
    print(f"Range: {all_days[0]} to {all_days[-1]}")

    if args.smoke:
        all_days = all_days[-1:]  # Most recent day
        print(f"\nSMOKE TEST: fetching only {all_days[0]}")

    if args.limit:
        all_days = all_days[:args.limit]
        print(f"Limited to {args.limit} days")

    # Load progress
    state = load_progress()
    completed = set(state.get("completed_dates", []))
    remaining = [d for d in all_days if d.isoformat() not in completed]
    print(f"Already completed: {len(completed)}")
    print(f"Remaining: {len(remaining)}")

    if not remaining:
        print("All days already fetched!")
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
        print(f"Existing articles: {len(existing_ids):,}")

    # Fetch
    print(f"\n{'=' * 60}")
    print(f"Fetching Benzinga news (BROAD - no ticker filter)...")
    if args.channels:
        print(f"Channel filter: {KEY_CHANNELS}")
    print("=" * 60)

    t0 = time.time()
    new_articles = 0
    dupes_skipped = 0
    zero_days = 0

    async with httpx.AsyncClient() as client:
        for i, day in enumerate(remaining):
            articles = await fetch_day(client, day, use_channels=args.channels)

            day_new = 0
            for art in articles:
                bid = art.get("benzinga_id")
                if bid and int(bid) in existing_ids:
                    dupes_skipped += 1
                    continue
                row = flatten_article(art, day)
                all_rows.append(row)
                if bid:
                    existing_ids.add(int(bid))
                day_new += 1

            new_articles += day_new
            completed.add(day.isoformat())
            if day_new == 0:
                zero_days += 1

            # Progress logging
            elapsed = time.time() - t0
            pct = (i + 1) / len(remaining) * 100
            if (i + 1) % 50 == 0 or i == 0 or (i + 1) == len(remaining):
                rate = (i + 1) / max(elapsed, 0.1)
                eta_min = (len(remaining) - i - 1) / max(rate, 0.01) / 60
                print(
                    f"  [{i+1}/{len(remaining)}] {day} "
                    f"| +{day_new} articles | total: {len(all_rows):,} "
                    f"| {pct:.0f}% | {elapsed:.0f}s | ETA: {eta_min:.0f}m"
                )

            # Save progress every 100 days
            if (i + 1) % 100 == 0:
                state["completed_dates"] = sorted(completed)
                state["total_articles"] = len(all_rows)
                save_progress(state)

            # Rate limit: ~2 requests/sec to be safe
            await asyncio.sleep(0.5)

    # Final save
    state["completed_dates"] = sorted(completed)
    state["total_articles"] = len(all_rows)
    save_progress(state)

    if not all_rows:
        print("No articles fetched!")
        return

    # Write parquet
    df = pd.DataFrame(all_rows)
    before = len(df)
    df = df.drop_duplicates(subset=["benzinga_id"], keep="last").reset_index(drop=True)
    final_dupes = before - len(df)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Benzinga broad fetch complete!")
    print("=" * 60)
    print(f"  New articles this run: {new_articles:,}")
    print(f"  Dupes skipped: {dupes_skipped + final_dupes:,}")
    print(f"  Zero-article days: {zero_days}")
    print(f"  Total unique articles: {len(df):,}")
    print(f"  File size: {OUT_FILE.stat().st_size / 1e6:.1f} MB")
    print(f"  Days completed: {len(completed)}/{len(all_days)}")
    print(f"  Elapsed: {elapsed / 60:.1f} min")

    if not df.empty:
        print(f"  Date range: {df['published'].min()} to {df['published'].max()}")
        has_body = df["body"].notna().sum()
        print(f"  Articles with body: {has_body:,} ({has_body/len(df)*100:.0f}%)")
        # Ticker coverage
        all_tickers = df["tickers"].dropna().str.split(",").explode().str.strip()
        print(f"  Unique tickers mentioned: {all_tickers.nunique():,}")

    # Load to DuckDB
    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    """Load broad benzinga news into DuckDB."""
    import duckdb

    if not parquet_file.exists():
        print("  No parquet file to load")
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")

    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS benzinga_news_broad")
    con.execute(f"""
        CREATE TABLE benzinga_news_broad AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)

    cnt = con.execute("SELECT COUNT(*) FROM benzinga_news_broad").fetchone()[0]
    unique_ids = con.execute(
        "SELECT COUNT(DISTINCT benzinga_id) FROM benzinga_news_broad"
    ).fetchone()[0]
    with_tickers = con.execute(
        "SELECT COUNT(*) FROM benzinga_news_broad WHERE tickers IS NOT NULL"
    ).fetchone()[0]
    print(f"  benzinga_news_broad: {cnt:,} rows, {unique_ids:,} unique IDs, {with_tickers:,} with tickers")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch ALL Benzinga news (no ticker filter) via Massive.com"
    )
    parser.add_argument(
        "--smoke", action="store_true",
        help="Smoke test: fetch only one day"
    )
    parser.add_argument(
        "--since", default=None,
        help="Start date (YYYY-MM-DD, default: 2021-01-01)"
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Limit to first N days"
    )
    parser.add_argument(
        "--channels", action="store_true",
        help="Filter to key financial channels only"
    )
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
