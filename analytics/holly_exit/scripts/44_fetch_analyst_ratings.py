"""
44_fetch_analyst_ratings.py — Fetch Benzinga analyst ratings via Massive.com API.

Daily-batched by Holly trade dates: for each trade date, fetches analyst
ratings for traded symbols in a 30-day lookback window (date-30 to date).
Deduplicates on Benzinga rating ID.

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/44_fetch_analyst_ratings.py
    python scripts/44_fetch_analyst_ratings.py --smoke
    python scripts/44_fetch_analyst_ratings.py --since 2021-01-01
    python scripts/44_fetch_analyst_ratings.py --limit-dates 10
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
PROGRESS_FILE = REF_DIR / "analyst_ratings_progress.json"
OUT_FILE = REF_DIR / "analyst_ratings.parquet"

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
    """Load Holly trades from DuckDB, group by trade date -> unique symbol list."""
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
    return [(r[0], r[1]) for r in rows]


async def fetch_date_batch(
    client: httpx.AsyncClient,
    trade_date: date,
    symbols: list[str],
) -> list[dict]:
    """
    Fetch analyst ratings for symbols in a 30-day lookback window.
    Follows next_url pagination until exhausted.
    """
    date_gte = (trade_date - timedelta(days=30)).isoformat()
    date_lt = (trade_date + timedelta(days=1)).isoformat()

    all_ratings = []

    for i in range(0, len(symbols), MAX_TICKERS_PER_REQUEST):
        batch = symbols[i:i + MAX_TICKERS_PER_REQUEST]

        params: list[tuple[str, str]] = [("tickers", s) for s in batch]
        params.extend([
            ("date.gte", date_gte),
            ("date.lt", date_lt),
            ("sort", "date.asc"),
            ("limit", "50000"),
            ("apiKey", POLYGON_API_KEY),
        ])

        use_params = True
        url: str | None = f"{MASSIVE_BASE}/benzinga/v2/analyst-ratings"

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
                        print(f"    ERROR: 403 Forbidden — check Massive Stocks Developer subscription")
                        return all_ratings

                    if resp.status_code != 200:
                        print(f"    ERROR: HTTP {resp.status_code} for {trade_date}")
                        url = None
                        break

                    data = resp.json()
                    results = data.get("results", [])
                    all_ratings.extend(results)

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
                    print(f"    FAILED after 3 retries on {trade_date}: {e}")
                    url = None
                    break

    return all_ratings


def flatten_rating(r: dict, request_date: date) -> dict:
    """Flatten a single analyst rating response into a flat row."""
    pt_current = r.get("pt_current")
    pt_prior = r.get("pt_prior")
    pt_change_pct = None
    if pt_current and pt_prior and pt_prior > 0:
        pt_change_pct = round((pt_current - pt_prior) / pt_prior * 100, 2)

    return {
        "rating_id": r.get("id"),
        "ticker": r.get("ticker"),
        "date": r.get("date"),
        "analyst_name": r.get("analyst_name") or r.get("analyst"),
        "firm": r.get("analyst_firm") or r.get("firm"),
        "action_type": r.get("action_type") or r.get("type"),
        "rating_current": r.get("rating_current"),
        "rating_prior": r.get("rating_prior"),
        "pt_current": pt_current,
        "pt_prior": pt_prior,
        "pt_change_pct": pt_change_pct,
        "url": r.get("url"),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "request_date": request_date.isoformat(),
    }


async def main_async(args):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading Holly trade dates from DuckDB...")
    manifest = load_trade_date_manifest(since=args.since)
    print(f"  Total trade dates: {len(manifest)}")

    if not manifest:
        print("No trade dates found!")
        return

    if args.smoke:
        manifest = manifest[:1]
        print(f"\n  SMOKE TEST: fetching only {manifest[0][0]} ({len(manifest[0][1])} symbols)")

    if args.limit_dates:
        manifest = manifest[:args.limit_dates]
        print(f"  Limited to first {args.limit_dates} dates")

    completed = load_progress()
    remaining = [(d, s) for d, s in manifest if d.isoformat() not in completed]
    print(f"  Already completed: {len(completed)}")
    print(f"  Remaining: {len(remaining)}")

    if not remaining:
        print("All trade dates already fetched!")
        if OUT_FILE.exists():
            load_to_duckdb(OUT_FILE)
        return

    existing_ids: set[str] = set()
    all_rows: list[dict] = []
    if OUT_FILE.exists():
        existing_df = pd.read_parquet(OUT_FILE)
        existing_ids = set(existing_df["rating_id"].dropna().astype(str))
        all_rows = existing_df.to_dict("records")
        print(f"  Existing ratings: {len(existing_ids):,}")

    print(f"\n{'=' * 60}")
    print("Fetching analyst ratings from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()
    new_ratings = 0
    dupes_skipped = 0

    async with httpx.AsyncClient() as client:
        for i, (trade_date, symbols) in enumerate(remaining):
            ratings = await fetch_date_batch(client, trade_date, symbols)

            date_new = 0
            for r in ratings:
                rid = str(r.get("id", ""))
                if rid and rid in existing_ids:
                    dupes_skipped += 1
                    continue
                row = flatten_rating(r, trade_date)
                all_rows.append(row)
                if rid:
                    existing_ids.add(rid)
                date_new += 1

            new_ratings += date_new
            completed.add(trade_date.isoformat())

            elapsed = time.time() - t0
            pct = (i + 1) / len(remaining) * 100
            if (i + 1) % 25 == 0 or i == 0 or (i + 1) == len(remaining):
                print(
                    f"  [{i+1}/{len(remaining)}] {trade_date} "
                    f"| {len(symbols)} syms | +{date_new} ratings "
                    f"| total: {len(all_rows):,} | {pct:.0f}% | {elapsed:.0f}s"
                )

            if (i + 1) % 50 == 0:
                save_progress(completed)

    save_progress(completed)

    if not all_rows:
        print("No ratings fetched!")
        return

    df = pd.DataFrame(all_rows)

    before = len(df)
    df = df.drop_duplicates(subset=["rating_id"], keep="last").reset_index(drop=True)
    final_dupes = before - len(df)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Analyst ratings fetch complete!")
    print(f"{'=' * 60}")
    print(f"  New ratings this run: {new_ratings:,}")
    print(f"  Dupes skipped: {dupes_skipped + final_dupes:,}")
    print(f"  Total unique ratings: {len(df):,}")
    print(f"  File size: {OUT_FILE.stat().st_size / 1e6:.1f} MB")
    print(f"  Trade dates completed: {len(completed)}/{len(manifest)}")
    print(f"  Elapsed: {elapsed / 60:.1f} min")

    if not df.empty:
        print(f"  Date range: {df['date'].min()} to {df['date'].max()}")
        unique_tickers = df["ticker"].nunique()
        print(f"  Unique tickers: {unique_tickers:,}")

    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    """Load analyst ratings into DuckDB."""
    import duckdb

    if not parquet_file.exists():
        print("  No parquet file to load")
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")

    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS analyst_ratings")
    con.execute(f"""
        CREATE TABLE analyst_ratings AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)

    cnt = con.execute("SELECT COUNT(*) FROM analyst_ratings").fetchone()[0]
    unique_ids = con.execute("SELECT COUNT(DISTINCT rating_id) FROM analyst_ratings").fetchone()[0]
    unique_tickers = con.execute("SELECT COUNT(DISTINCT ticker) FROM analyst_ratings").fetchone()[0]
    print(f"  analyst_ratings: {cnt:,} rows, {unique_ids:,} unique IDs, {unique_tickers:,} tickers")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch Benzinga analyst ratings via Massive.com for Holly trade dates"
    )
    parser.add_argument("--smoke", action="store_true",
                        help="Smoke test: fetch only the first trade date")
    parser.add_argument("--since", default=None,
                        help="Earliest trade date (YYYY-MM-DD, default: 2021-01-01)")
    parser.add_argument("--limit-dates", type=int, default=None,
                        help="Limit to first N trade dates (for testing)")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
