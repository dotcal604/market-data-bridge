"""
22_fetch_small_reference.py — Fetch small reference datasets from Polygon.

Three tiny datasets:
  1. Conditions  — trade/quote condition codes (/v3/reference/conditions)
  2. Exchanges   — exchange metadata (/v3/reference/exchanges)
  3. Related Companies — peer tickers for Holly-traded symbols (/v1/related-companies/{ticker})

Usage:
    python scripts/22_fetch_small_reference.py
    python scripts/22_fetch_small_reference.py --only conditions
    python scripts/22_fetch_small_reference.py --only exchanges
    python scripts/22_fetch_small_reference.py --only related
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


async def fetch_conditions(client: httpx.AsyncClient) -> pd.DataFrame:
    """Fetch trade/quote condition codes — single non-paginated call."""
    out_file = REF_DIR / "conditions.parquet"
    if out_file.exists():
        df = pd.read_parquet(out_file)
        print(f"  Cached: {len(df):,} conditions -> {out_file.name}")
        return df

    print("=" * 60)
    print("Fetching condition codes...")
    print("=" * 60)

    all_results = []
    for asset_class in ["stocks", "options", "crypto", "fx"]:
        url = (
            f"{POLYGON_BASE}/v3/reference/conditions"
            f"?asset_class={asset_class}"
            f"&apiKey={POLYGON_API_KEY}"
        )
        try:
            resp = await client.get(url, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                results = data.get("results", [])
                for r in results:
                    r["asset_class"] = asset_class
                all_results.extend(results)
                print(f"  {asset_class}: {len(results)} conditions")
        except Exception as e:
            print(f"  {asset_class}: FAILED - {e}")

    if not all_results:
        print("  No conditions found!")
        return pd.DataFrame()

    df = pd.DataFrame(all_results)
    # Keep useful columns
    keep = ["id", "type", "name", "asset_class", "sip_mapping",
            "data_types", "legacy", "description"]
    df = df[[c for c in keep if c in df.columns]]

    # Flatten list columns to strings
    for col in ["sip_mapping", "data_types"]:
        if col in df.columns:
            df[col] = df[col].apply(
                lambda x: str(x) if isinstance(x, (dict, list)) else x
            )

    REF_DIR.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pandas(df), str(out_file))
    print(f"\n  Saved: {len(df):,} conditions -> {out_file.name}")
    print(f"  Size: {out_file.stat().st_size / 1e3:.1f} KB")
    return df


async def fetch_exchanges(client: httpx.AsyncClient) -> pd.DataFrame:
    """Fetch exchange metadata — single non-paginated call."""
    out_file = REF_DIR / "exchanges.parquet"
    if out_file.exists():
        df = pd.read_parquet(out_file)
        print(f"  Cached: {len(df):,} exchanges -> {out_file.name}")
        return df

    print("=" * 60)
    print("Fetching exchanges...")
    print("=" * 60)

    url = (
        f"{POLYGON_BASE}/v3/reference/exchanges"
        f"?asset_class=stocks&apiKey={POLYGON_API_KEY}"
    )
    try:
        resp = await client.get(url, timeout=30)
        if resp.status_code != 200:
            print(f"  ERROR: HTTP {resp.status_code}")
            return pd.DataFrame()
        data = resp.json()
        results = data.get("results", [])
    except Exception as e:
        print(f"  FAILED: {e}")
        return pd.DataFrame()

    if not results:
        print("  No exchanges found!")
        return pd.DataFrame()

    df = pd.DataFrame(results)
    REF_DIR.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pandas(df), str(out_file))
    print(f"  Saved: {len(df):,} exchanges -> {out_file.name}")
    print(f"  Size: {out_file.stat().st_size / 1e3:.1f} KB")
    print(f"  Columns: {list(df.columns)}")
    return df


async def fetch_related_companies(client: httpx.AsyncClient) -> pd.DataFrame:
    """Fetch related/peer companies for Holly-traded symbols."""
    out_file = REF_DIR / "related_companies.parquet"
    if out_file.exists():
        df = pd.read_parquet(out_file)
        print(f"  Cached: {len(df):,} relationships -> {out_file.name}")
        return df

    print("=" * 60)
    print("Fetching related companies for Holly-traded symbols...")
    print("=" * 60)

    # Get symbols from DuckDB
    import duckdb
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    symbols = con.execute(
        "SELECT DISTINCT symbol FROM trades ORDER BY symbol"
    ).fetchdf()["symbol"].tolist()
    con.close()
    print(f"  Symbols to fetch: {len(symbols):,}")

    all_rows = []
    t0 = time.time()
    errors = 0
    total = len(symbols)

    for si, sym in enumerate(symbols):
        url = (
            f"{POLYGON_BASE}/v1/related-companies/{sym}"
            f"?apiKey={POLYGON_API_KEY}"
        )

        for attempt in range(3):
            try:
                resp = await client.get(url, timeout=15)

                if resp.status_code == 429:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                if resp.status_code in (404, 403):
                    break  # No data for this ticker
                if resp.status_code != 200:
                    errors += 1
                    break

                data = resp.json()
                results = data.get("results", [])
                for r in results:
                    all_rows.append({
                        "symbol": sym,
                        "related_ticker": r.get("ticker"),
                    })
                break  # success

            except (httpx.TimeoutException, httpx.ConnectError):
                if attempt < 2:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                errors += 1
                break

        if (si + 1) % 500 == 0 or si <= 2 or si == total - 1:
            elapsed = time.time() - t0
            rate = (si + 1) / max(elapsed, 0.1)
            eta = (total - si - 1) / max(rate, 0.01)
            print(
                f"  [{si+1}/{total}] {sym}: {len(all_rows):,} relationships "
                f"({errors} errors, ETA {eta/60:.1f}m)",
                flush=True,
            )

    if not all_rows:
        print("  No related companies found!")
        return pd.DataFrame()

    df = pd.DataFrame(all_rows)

    # Drop exact dupes
    before = len(df)
    df = df.drop_duplicates().reset_index(drop=True)
    dupes = before - len(df)
    if dupes:
        print(f"  Dropped {dupes:,} duplicates")

    REF_DIR.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pandas(df), str(out_file))

    elapsed = time.time() - t0
    print(f"\n  Saved: {len(df):,} relationships in {elapsed / 60:.1f}m -> {out_file.name}")
    print(f"  Size: {out_file.stat().st_size / 1e3:.1f} KB")
    print(f"  Symbols with peers: {df['symbol'].nunique():,}")
    print(f"  Avg peers per symbol: {df.groupby('symbol').size().mean():.1f}")
    print(f"  Errors: {errors}")
    return df


def load_to_duckdb():
    """Load all small reference tables into DuckDB."""
    import duckdb

    print("\n" + "=" * 60)
    print("Loading small reference data into DuckDB...")
    print("=" * 60)

    con = duckdb.connect(str(DUCKDB_PATH))

    for table, filename in [
        ("conditions", "conditions.parquet"),
        ("exchanges", "exchanges.parquet"),
        ("related_companies", "related_companies.parquet"),
    ]:
        pf = REF_DIR / filename
        if not pf.exists():
            print(f"  {table}: no parquet file, skipping")
            continue

        con.execute(f"DROP TABLE IF EXISTS {table}")
        con.execute(f"""
            CREATE TABLE {table} AS
            SELECT * FROM read_parquet('{pf}')
        """)
        cnt = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table}: {cnt:,} rows")

    con.close()


async def main_async(only: str | None):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient() as client:
        if only is None or only == "conditions":
            await fetch_conditions(client)
        if only is None or only == "exchanges":
            await fetch_exchanges(client)
        if only is None or only == "related":
            await fetch_related_companies(client)

    load_to_duckdb()

    print("\n" + "=" * 60)
    print("Small reference fetch complete!")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="Fetch small Polygon reference data")
    parser.add_argument(
        "--only",
        choices=["conditions", "exchanges", "related"],
        default=None,
        help="Fetch only one dataset",
    )
    args = parser.parse_args()
    asyncio.run(main_async(only=args.only))


if __name__ == "__main__":
    main()
