"""
45_fetch_corporate_guidance.py — Fetch Benzinga corporate guidance via Massive.com API.

Daily-batched by Holly trade dates: for each trade date, fetches guidance
changes for traded symbols in a 60-day lookback window (date-60 to date).
Deduplicates on Benzinga guidance ID.

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/45_fetch_corporate_guidance.py
    python scripts/45_fetch_corporate_guidance.py --smoke
    python scripts/45_fetch_corporate_guidance.py --since 2021-01-01
    python scripts/45_fetch_corporate_guidance.py --limit-dates 10
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
PROGRESS_FILE = REF_DIR / "corporate_guidance_progress.json"
OUT_FILE = REF_DIR / "corporate_guidance.parquet"

MAX_TICKERS_PER_REQUEST = 50


def load_progress() -> set[str]:
    if PROGRESS_FILE.exists():
        data = json.loads(PROGRESS_FILE.read_text())
        return set(data.get("completed_dates", []))
    return set()


def save_progress(completed: set[str]):
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(json.dumps({
        "completed_dates": sorted(completed),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2))


def load_trade_date_manifest(since: str | None = None) -> list[tuple[date, list[str]]]:
    import duckdb
    db = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    where = "WHERE CAST(entry_time AS DATE) >= '2021-01-01'"
    if since:
        where = f"WHERE CAST(entry_time AS DATE) >= '{since}'"
    rows = db.execute(f"""
        SELECT CAST(entry_time AS DATE) AS trade_date,
               LIST(DISTINCT symbol ORDER BY symbol) AS symbols
        FROM trades {where}
        GROUP BY trade_date ORDER BY trade_date
    """).fetchall()
    db.close()
    return [(r[0], r[1]) for r in rows]


async def fetch_date_batch(
    client: httpx.AsyncClient,
    trade_date: date,
    symbols: list[str],
) -> list[dict]:
    """Fetch corporate guidance in 60-day lookback window."""
    date_gte = (trade_date - timedelta(days=60)).isoformat()
    date_lt = (trade_date + timedelta(days=1)).isoformat()

    all_guidance = []

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
        url: str | None = f"{MASSIVE_BASE}/benzinga/v2/corporate-guidance"

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
                        print("    ERROR: 403 Forbidden — check Massive Stocks Developer subscription")
                        return all_guidance

                    if resp.status_code != 200:
                        print(f"    ERROR: HTTP {resp.status_code} for {trade_date}")
                        url = None
                        break

                    data = resp.json()
                    results = data.get("results", [])
                    all_guidance.extend(results)

                    next_url = data.get("next_url")
                    url = f"{next_url}&apiKey={POLYGON_API_KEY}" if next_url else None
                    break

                except (httpx.TimeoutException, httpx.ConnectError) as e:
                    if attempt < 2:
                        await asyncio.sleep(2 ** (attempt + 1))
                        continue
                    print(f"    FAILED after 3 retries on {trade_date}: {e}")
                    url = None
                    break

    return all_guidance


def flatten_guidance(g: dict, request_date: date) -> dict:
    """Flatten a single corporate guidance response into a flat row."""
    current_value = g.get("current_value")
    prior_value = g.get("prior_value")
    change_pct = None
    direction = None

    if current_value is not None and prior_value is not None and prior_value != 0:
        change_pct = round((current_value - prior_value) / abs(prior_value) * 100, 2)
        if current_value > prior_value:
            direction = "raised"
        elif current_value < prior_value:
            direction = "lowered"
        else:
            direction = "maintained"

    if direction is None:
        direction = g.get("direction") or g.get("importance")

    return {
        "guidance_id": g.get("id"),
        "ticker": g.get("ticker"),
        "date": g.get("date"),
        "guidance_type": g.get("guidance_type") or g.get("type"),
        "period": g.get("period"),
        "fiscal_year": g.get("fiscal_year"),
        "current_value": current_value,
        "prior_value": prior_value,
        "change_pct": change_pct,
        "direction": direction,
        "url": g.get("url"),
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
        existing_ids = set(existing_df["guidance_id"].dropna().astype(str))
        all_rows = existing_df.to_dict("records")
        print(f"  Existing guidance records: {len(existing_ids):,}")

    print(f"\n{'=' * 60}")
    print("Fetching corporate guidance from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()
    new_records = 0
    dupes_skipped = 0

    async with httpx.AsyncClient() as client:
        for i, (trade_date, symbols) in enumerate(remaining):
            records = await fetch_date_batch(client, trade_date, symbols)

            date_new = 0
            for g in records:
                gid = str(g.get("id", ""))
                if gid and gid in existing_ids:
                    dupes_skipped += 1
                    continue
                row = flatten_guidance(g, trade_date)
                all_rows.append(row)
                if gid:
                    existing_ids.add(gid)
                date_new += 1

            new_records += date_new
            completed.add(trade_date.isoformat())

            elapsed = time.time() - t0
            pct = (i + 1) / len(remaining) * 100
            if (i + 1) % 25 == 0 or i == 0 or (i + 1) == len(remaining):
                print(
                    f"  [{i+1}/{len(remaining)}] {trade_date} "
                    f"| {len(symbols)} syms | +{date_new} guidance "
                    f"| total: {len(all_rows):,} | {pct:.0f}% | {elapsed:.0f}s"
                )

            if (i + 1) % 50 == 0:
                save_progress(completed)

    save_progress(completed)

    if not all_rows:
        print("No guidance records fetched!")
        return

    df = pd.DataFrame(all_rows)
    before = len(df)
    df = df.drop_duplicates(subset=["guidance_id"], keep="last").reset_index(drop=True)
    final_dupes = before - len(df)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Corporate guidance fetch complete!")
    print(f"{'=' * 60}")
    print(f"  New records this run: {new_records:,}")
    print(f"  Dupes skipped: {dupes_skipped + final_dupes:,}")
    print(f"  Total unique records: {len(df):,}")
    print(f"  File size: {OUT_FILE.stat().st_size / 1e6:.1f} MB")
    print(f"  Elapsed: {elapsed / 60:.1f} min")

    if not df.empty:
        print(f"  Date range: {df['date'].min()} to {df['date'].max()}")
        unique_tickers = df["ticker"].nunique()
        print(f"  Unique tickers: {unique_tickers:,}")
        if "direction" in df.columns:
            print(f"  Direction breakdown: {df['direction'].value_counts().to_dict()}")

    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    import duckdb
    if not parquet_file.exists():
        print("  No parquet file to load")
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS corporate_guidance")
    con.execute(f"""
        CREATE TABLE corporate_guidance AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)
    cnt = con.execute("SELECT COUNT(*) FROM corporate_guidance").fetchone()[0]
    unique_ids = con.execute("SELECT COUNT(DISTINCT guidance_id) FROM corporate_guidance").fetchone()[0]
    print(f"  corporate_guidance: {cnt:,} rows, {unique_ids:,} unique IDs")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch Benzinga corporate guidance via Massive.com for Holly trade dates"
    )
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--since", default=None)
    parser.add_argument("--limit-dates", type=int, default=None)
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
