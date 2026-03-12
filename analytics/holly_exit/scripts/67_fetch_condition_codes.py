"""
67_fetch_condition_codes.py — Fetch trade/quote condition codes via Massive.com API.

One-time reference data pull: fetches all trade and quote condition codes
from various SIPs (CTA, UTP, OPRA, FINRA). Used for interpreting market data.

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/67_fetch_condition_codes.py
    python scripts/67_fetch_condition_codes.py --smoke
"""

import argparse
import asyncio
import json
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
OUT_FILE = REF_DIR / "massive_condition_codes.parquet"


async def fetch_condition_codes(
    client: httpx.AsyncClient,
    smoke: bool = False,
) -> list[dict]:
    """Fetch all condition codes with pagination."""
    url = f"{MASSIVE_BASE}/v3/reference/conditions"
    params = {
        "asset_class": "stocks",
        "limit": "10" if smoke else "1000",
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
                    print(f"  HTTP {resp.status_code}")
                    return all_rows

                data = resp.json()
                results = data.get("results", [])

                now_iso = datetime.now(timezone.utc).isoformat()
                for rec in results:
                    data_types = rec.get("data_types", [])
                    sip_mapping = rec.get("sip_mapping", {})
                    update_rules = rec.get("update_rules", {})

                    all_rows.append({
                        "condition_id": rec.get("id"),
                        "name": rec.get("name"),
                        "abbreviation": rec.get("abbreviation"),
                        "asset_class": rec.get("asset_class"),
                        "condition_type": rec.get("type"),
                        "data_types": ",".join(data_types) if data_types else None,
                        "description": rec.get("description"),
                        "exchange": rec.get("exchange"),
                        "legacy": rec.get("legacy"),
                        "sip_mapping_json": json.dumps(sip_mapping) if sip_mapping else None,
                        "update_rules_json": json.dumps(update_rules) if update_rules else None,
                        "fetched_at": now_iso,
                    })

                print(f"  Page {page}: +{len(results)} conditions (total: {len(all_rows):,})")

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
    print("Fetching condition codes from Massive.com...")
    print(f"{'=' * 60}")

    t0 = time.time()

    async with httpx.AsyncClient() as client:
        rows = await fetch_condition_codes(client, smoke=args.smoke)

    if not rows:
        print("No condition codes fetched!")
        return

    df = pd.DataFrame(rows)

    pq.write_table(pa.Table.from_pandas(df), str(OUT_FILE), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Condition codes fetch complete!")
    print(f"{'=' * 60}")
    print(f"  Total conditions: {len(df):,}")
    print(f"  Elapsed: {elapsed:.0f}s")

    if not df.empty:
        types = df["condition_type"].value_counts().to_dict()
        legacy = df["legacy"].sum() if "legacy" in df.columns else 0
        print(f"  Condition types: {types}")
        print(f"  Legacy conditions: {legacy}")

    load_to_duckdb(OUT_FILE)


def load_to_duckdb(parquet_file: Path):
    import duckdb
    if not parquet_file.exists():
        return

    print(f"\nLoading into DuckDB ({DUCKDB_PATH.name})...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS massive_condition_codes")
    con.execute(f"""
        CREATE TABLE massive_condition_codes AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)
    cnt = con.execute("SELECT COUNT(*) FROM massive_condition_codes").fetchone()[0]
    print(f"  massive_condition_codes: {cnt:,} rows")
    con.close()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch trade/quote condition codes via Massive.com"
    )
    parser.add_argument("--smoke", action="store_true",
                        help="Smoke test: fetch first page only (limit=10)")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
