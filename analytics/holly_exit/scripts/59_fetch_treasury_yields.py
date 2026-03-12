"""
59_fetch_treasury_yields.py — Fetch U.S. Treasury yield data via Massive.com API.

Date-range fetch: pulls ALL historical Treasury yields (1962–present).
Not per-symbol — this is a macro/market-wide dataset.

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/59_fetch_treasury_yields.py
    python scripts/59_fetch_treasury_yields.py --smoke
"""

import argparse
import asyncio
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import POLYGON_API_KEY, DATA_DIR, DUCKDB_PATH

MASSIVE_BASE = "https://api.massive.com"
REF_DIR = DATA_DIR / "reference"
OUT_FILE = REF_DIR / "massive_treasury_yields.parquet"


async def fetch_treasury_yields(
    client: httpx.AsyncClient,
    smoke: bool = False,
) -> list[dict]:
    """Fetch all Treasury yield records, following next_url pagination."""
    url = f"{MASSIVE_BASE}/fed/v1/treasury-yields"
    params = {
        "date.gte": "2016-01-01",
        "sort": "date.asc",
        "limit": "10" if smoke else "50000",
        "apiKey": POLYGON_API_KEY,
    }

    all_rows: list[dict] = []
    page = 0

    while True:
        page += 1

        for attempt in range(3):
            try:
                resp = await client.get(url, params=params, timeout=30)

                if resp.status_code == 429:
                    wait = 2 ** (attempt + 1)
                    print(f"  Rate limited, waiting {wait}s...")
                    await asyncio.sleep(wait)
                    continue

                if resp.status_code in (403, 404):
                    print(f"  HTTP {resp.status_code} — endpoint not available")
                    return all_rows

                if resp.status_code != 200:
                    print(f"  HTTP {resp.status_code} — stopping")
                    return all_rows

                data = resp.json()
                results = data.get("results", [])

                now_iso = datetime.now(timezone.utc).isoformat()
                for rec in results:
                    all_rows.append({
                        "date": rec.get("date"),
                        "yield_1_month": rec.get("yield_1_month"),
                        "yield_3_month": rec.get("yield_3_month"),
                        "yield_6_month": rec.get("yield_6_month"),
                        "yield_1_year": rec.get("yield_1_year"),
                        "yield_2_year": rec.get("yield_2_year"),
                        "yield_3_year": rec.get("yield_3_year"),
                        "yield_5_year": rec.get("yield_5_year"),
                        "yield_7_year": rec.get("yield_7_year"),
                        "yield_10_year": rec.get("yield_10_year"),
                        "yield_20_year": rec.get("yield_20_year"),
                        "yield_30_year": rec.get("yield_30_year"),
                        "fetched_at": now_iso,
                    })

                print(f"  Page {page}: +{len(results)} records (total: {len(all_rows):,})")

                next_url = data.get("next_url")
                if not next_url or smoke:
                    return all_rows

                url = next_url
                if "apiKey=" not in url:
                    separator = "&" if "?" in url else "?"
                    url = f"{url}{separator}apiKey={POLYGON_API_KEY}"
                params = {}
                break

            except (httpx.TimeoutException, httpx.ConnectError) as e:
                if attempt < 2:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                print(f"  Failed after 3 attempts: {e}")
                return all_rows
        else:
            print("  Exhausted retries, stopping")
            return all_rows

    return all_rows


async def main_async(args):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    if args.smoke:
        print("\n  SMOKE TEST: fetching first page only (limit=10)")

    print(f"\n{'=' * 60}")
    print("Fetching Treasury yields from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()

    async with httpx.AsyncClient() as client:
        rows = await fetch_treasury_yields(client, smoke=args.smoke)

    if not rows:
        print("No Treasury yield data fetched!")
        return

    df = pd.DataFrame(rows)

    before = len(df)
    df = df.drop_duplicates(subset=["date"], keep="last").reset_index(drop=True)
    dupes = before - len(df)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Treasury yields fetch complete!")
    print(f"{'=' * 60}")
    print(f"  Total records: {len(df):,}")
    print(f"  Duplicates removed: {dupes:,}")
    print(f"  File size: {OUT_FILE.stat().st_size / 1e6:.1f} MB")
    print(f"  Elapsed: {elapsed:.0f}s")

    if not df.empty:
        print(f"  Date range: {df['date'].min()} to {df['date'].max()}")
        has_10yr = df["yield_10_year"].notna().sum()
        print(f"  Records with 10yr yield: {has_10yr:,}")

    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    import duckdb
    if not parquet_file.exists():
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS massive_treasury_yields")
    con.execute(f"""
        CREATE TABLE massive_treasury_yields AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)
    cnt = con.execute("SELECT COUNT(*) FROM massive_treasury_yields").fetchone()[0]
    print(f"  massive_treasury_yields: {cnt:,} rows")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch U.S. Treasury yields via Massive.com API"
    )
    parser.add_argument("--smoke", action="store_true",
                        help="Smoke test: fetch first page only (limit=10)")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
