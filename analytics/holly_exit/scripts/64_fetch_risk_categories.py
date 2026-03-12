"""
64_fetch_risk_categories.py — Fetch risk factor taxonomy via Massive.com API.

One-time reference data pull: fetches the full taxonomy used to classify
risk factors in the Risk Factors API. Small dataset (~200 categories).

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/64_fetch_risk_categories.py
    python scripts/64_fetch_risk_categories.py --smoke
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
OUT_FILE = REF_DIR / "massive_risk_categories.parquet"


async def fetch_risk_categories(
    client: httpx.AsyncClient,
    smoke: bool = False,
) -> list[dict]:
    """Fetch all risk factor taxonomy categories."""
    url = f"{MASSIVE_BASE}/stocks/taxonomies/vX/risk-factors"
    params = {
        "limit": "10" if smoke else "999",
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
                    await asyncio.sleep(2 ** (attempt + 1))
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
                        "taxonomy": rec.get("taxonomy"),
                        "primary_category": rec.get("primary_category"),
                        "secondary_category": rec.get("secondary_category"),
                        "tertiary_category": rec.get("tertiary_category"),
                        "description": rec.get("description"),
                        "fetched_at": now_iso,
                    })

                print(f"  Page {page}: +{len(results)} categories (total: {len(all_rows):,})")

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
                print(f"  Failed: {e}")
                return all_rows
        else:
            return all_rows

    return all_rows


async def main_async(args):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\n{'=' * 60}")
    print("Fetching risk factor taxonomy from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()

    async with httpx.AsyncClient() as client:
        rows = await fetch_risk_categories(client, smoke=args.smoke)

    if not rows:
        print("No risk categories fetched!")
        return

    df = pd.DataFrame(rows)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Risk categories fetch complete!")
    print(f"{'=' * 60}")
    print(f"  Total categories: {len(df):,}")
    print(f"  Elapsed: {elapsed:.0f}s")

    if not df.empty:
        primary = df["primary_category"].nunique()
        secondary = df["secondary_category"].nunique()
        tertiary = df["tertiary_category"].nunique()
        print(f"  Primary categories: {primary}")
        print(f"  Secondary categories: {secondary}")
        print(f"  Tertiary categories: {tertiary}")

    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    import duckdb
    if not parquet_file.exists():
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS massive_risk_categories")
    con.execute(f"""
        CREATE TABLE massive_risk_categories AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)
    cnt = con.execute("SELECT COUNT(*) FROM massive_risk_categories").fetchone()[0]
    print(f"  massive_risk_categories: {cnt:,} rows")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch risk factor taxonomy via Massive.com"
    )
    parser.add_argument("--smoke", action="store_true",
                        help="Smoke test: fetch first page only (limit=10)")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
