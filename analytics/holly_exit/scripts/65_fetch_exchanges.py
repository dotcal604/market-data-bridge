"""
65_fetch_exchanges.py — Fetch exchange reference data via Massive.com API.

One-time reference data pull: fetches all known exchanges with their
identifiers, names, market types, MICs, and other attributes.
Small dataset (~20-30 exchanges).

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/65_fetch_exchanges.py
    python scripts/65_fetch_exchanges.py --smoke
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
OUT_FILE = REF_DIR / "massive_exchanges.parquet"


async def fetch_exchanges(client: httpx.AsyncClient) -> list[dict]:
    """Fetch all exchanges. No pagination needed — small dataset."""
    url = f"{MASSIVE_BASE}/v3/reference/exchanges"
    params = {
        "asset_class": "stocks",
        "locale": "us",
        "apiKey": POLYGON_API_KEY,
    }

    for attempt in range(3):
        try:
            resp = await client.get(url, params=params, timeout=30)

            if resp.status_code == 429:
                await asyncio.sleep(2 ** (attempt + 1))
                continue

            if resp.status_code in (403, 404):
                print(f"  HTTP {resp.status_code} — endpoint not available")
                return []

            if resp.status_code != 200:
                print(f"  HTTP {resp.status_code}")
                return []

            data = resp.json()
            results = data.get("results", [])

            now_iso = datetime.now(timezone.utc).isoformat()
            rows = []
            for rec in results:
                sip_mapping = rec.get("sip_mapping", {})
                rows.append({
                    "exchange_id": rec.get("id"),
                    "name": rec.get("name"),
                    "acronym": rec.get("acronym"),
                    "mic": rec.get("mic"),
                    "operating_mic": rec.get("operating_mic"),
                    "participant_id": rec.get("participant_id"),
                    "asset_class": rec.get("asset_class"),
                    "locale": rec.get("locale"),
                    "exchange_type": rec.get("type"),
                    "url": rec.get("url"),
                    "fetched_at": now_iso,
                })

            return rows

        except (httpx.TimeoutException, httpx.ConnectError) as e:
            if attempt < 2:
                await asyncio.sleep(2 ** (attempt + 1))
                continue
            print(f"  Failed: {e}")
            return []

    return []


async def main_async(args):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\n{'=' * 60}")
    print("Fetching exchange reference data from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()

    async with httpx.AsyncClient() as client:
        rows = await fetch_exchanges(client)

    if not rows:
        print("No exchange data fetched!")
        return

    df = pd.DataFrame(rows)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Exchanges fetch complete!")
    print(f"{'=' * 60}")
    print(f"  Total exchanges: {len(df):,}")
    print(f"  Elapsed: {elapsed:.0f}s")

    if not df.empty:
        types = df["exchange_type"].value_counts().to_dict()
        print(f"  Exchange types: {types}")

    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    import duckdb
    if not parquet_file.exists():
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS massive_exchanges")
    con.execute(f"""
        CREATE TABLE massive_exchanges AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)
    cnt = con.execute("SELECT COUNT(*) FROM massive_exchanges").fetchone()[0]
    print(f"  massive_exchanges: {cnt:,} rows")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch exchange reference data via Massive.com"
    )
    parser.add_argument("--smoke", action="store_true",
                        help="Smoke test (same as full run — small dataset)")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
