"""
20_fetch_options_reference.py — Fetch options contract reference data from Polygon.

Paginated bulk endpoint — fetches options contracts for Holly-traded underlyings.
Provides strike, expiry, type, exercise style for each listed contract.

Usage:
    python scripts/20_fetch_options_reference.py
    python scripts/20_fetch_options_reference.py --underlying AAPL
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


async def fetch_options_contracts(
    client: httpx.AsyncClient,
    underlying: str | None = None,
) -> pd.DataFrame:
    """Fetch options contract reference via paginated bulk endpoint."""
    label = "options_contracts"
    if underlying:
        label += f"_{underlying}"

    out_file = REF_DIR / f"{label}.parquet"
    if out_file.exists():
        df = pd.read_parquet(out_file)
        print(f"  Cached: {len(df):,} contracts -> {out_file.name}")
        return df

    print("=" * 60)
    print(f"Fetching options contracts (paginated bulk)...")
    if underlying:
        print(f"  Underlying: {underlying}")
    else:
        print("  All underlyings (Holly-traded symbols)")
    print("=" * 60)

    # If no specific underlying, get symbols from DuckDB
    symbols = [underlying] if underlying else []
    if not symbols:
        import duckdb
        con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
        symbols = con.execute(
            "SELECT DISTINCT symbol FROM trades ORDER BY symbol"
        ).fetchdf()["symbol"].tolist()
        con.close()
        print(f"  Symbols from trades table: {len(symbols):,}")

    all_results = []
    t0 = time.time()
    total_symbols = len(symbols)

    for si, sym in enumerate(symbols):
        url = (
            f"{POLYGON_BASE}/v3/reference/options/contracts"
            f"?underlying_ticker={sym}&limit=1000"
            f"&apiKey={POLYGON_API_KEY}"
        )
        sym_count = 0

        while url:
            for attempt in range(3):
                try:
                    resp = await client.get(url, timeout=30)

                    if resp.status_code == 429:
                        await asyncio.sleep(2 ** (attempt + 1))
                        continue
                    if resp.status_code in (404, 403):
                        url = None
                        break
                    if resp.status_code != 200:
                        url = None
                        break

                    data = resp.json()
                    results = data.get("results", [])
                    all_results.extend(results)
                    sym_count += len(results)

                    next_url = data.get("next_url")
                    if next_url:
                        url = f"{next_url}&apiKey={POLYGON_API_KEY}"
                    else:
                        url = None

                    break  # success

                except (httpx.TimeoutException, httpx.ConnectError):
                    if attempt < 2:
                        await asyncio.sleep(2 ** (attempt + 1))
                        continue
                    url = None
                    break

        if (si + 1) % 100 == 0 or si <= 2 or si == total_symbols - 1:
            elapsed = time.time() - t0
            rate = (si + 1) / max(elapsed, 0.1)
            eta = (total_symbols - si - 1) / max(rate, 0.01)
            print(
                f"  [{si+1}/{total_symbols}] {sym}: {sym_count} contracts "
                f"(total: {len(all_results):,}, ETA {eta/60:.1f}m)",
                flush=True,
            )

    if not all_results:
        print("  No options contracts found!")
        return pd.DataFrame()

    df = pd.DataFrame(all_results)

    # Keep useful columns
    keep = [
        "ticker", "underlying_ticker", "contract_type", "exercise_style",
        "expiration_date", "strike_price", "shares_per_contract",
        "primary_exchange", "cfi",
    ]
    df = df[[c for c in keep if c in df.columns]]
    df = df.sort_values(["underlying_ticker", "expiration_date", "strike_price"]).reset_index(drop=True)

    REF_DIR.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pandas(df), str(out_file))

    elapsed = time.time() - t0
    print(f"\n  Saved: {len(df):,} contracts in {elapsed / 60:.1f}m -> {out_file.name}")
    print(f"  Size: {out_file.stat().st_size / 1e6:.1f} MB")
    print(f"  Underlyings: {df['underlying_ticker'].nunique():,}")
    print(f"  Contract types: {df['contract_type'].value_counts().to_dict()}")
    print(f"  Expiry range: {df['expiration_date'].min()} to {df['expiration_date'].max()}")
    return df


def load_to_duckdb(parquet_file: Path):
    """Load options contracts into DuckDB."""
    import duckdb

    if not parquet_file.exists():
        print("  No parquet file to load")
        return

    print("\n" + "=" * 60)
    print("Loading options contracts into DuckDB...")
    print("=" * 60)

    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS options_contracts")
    con.execute(f"""
        CREATE TABLE options_contracts AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)

    cnt = con.execute("SELECT COUNT(*) FROM options_contracts").fetchone()[0]
    underlyings = con.execute("SELECT COUNT(DISTINCT underlying_ticker) FROM options_contracts").fetchone()[0]
    print(f"  options_contracts: {cnt:,} rows, {underlyings:,} underlyings")
    con.close()


async def main_async(underlying: str | None):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient() as client:
        df = await fetch_options_contracts(client, underlying=underlying)

    if not df.empty:
        label = "options_contracts"
        if underlying:
            label += f"_{underlying}"
        load_to_duckdb(REF_DIR / f"{label}.parquet")

    print("\n" + "=" * 60)
    print("Options reference fetch complete!")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="Fetch Polygon options contract reference")
    parser.add_argument("--underlying", default=None, help="Filter by underlying ticker")
    args = parser.parse_args()
    asyncio.run(main_async(underlying=args.underlying))


if __name__ == "__main__":
    main()
