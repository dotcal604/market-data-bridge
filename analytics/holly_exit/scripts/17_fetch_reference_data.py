"""
17_fetch_reference_data.py — Fetch stock splits, dividends, and ticker details
                              from Polygon reference endpoints.

Splits & dividends use bulk paginated endpoints (very efficient).
Ticker details require per-symbol calls (~6K).

Usage:
    python scripts/17_fetch_reference_data.py
    python scripts/17_fetch_reference_data.py --only splits
    python scripts/17_fetch_reference_data.py --only dividends
    python scripts/17_fetch_reference_data.py --only tickers
"""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import POLYGON_API_KEY, DATA_DIR, DUCKDB_PATH, POLYGON_CONCURRENCY

POLYGON_BASE = "https://api.polygon.io"
REF_DIR = DATA_DIR / "reference"


# ═════════════════════════════════════════════════════════════
# 1. STOCK SPLITS (bulk paginated)
# ═════════════════════════════════════════════════════════════

async def fetch_splits(client: httpx.AsyncClient) -> pd.DataFrame:
    """Fetch all stock splits via paginated bulk endpoint."""
    print("=" * 60)
    print("Fetching stock splits (bulk paginated)...")
    print("=" * 60)

    out_file = REF_DIR / "splits.parquet"
    if out_file.exists():
        df = pd.read_parquet(out_file)
        print(f"  Cached: {len(df):,} splits")
        return df

    all_results = []
    url = f"{POLYGON_BASE}/v3/reference/splits"
    params = {"limit": 1000, "apiKey": POLYGON_API_KEY}
    page = 0

    while url:
        page += 1
        resp = await client.get(url, params=params, timeout=30)
        if resp.status_code != 200:
            print(f"  ERROR: HTTP {resp.status_code}")
            break

        data = resp.json()
        results = data.get("results", [])
        all_results.extend(results)
        print(f"  Page {page}: {len(results)} splits (total: {len(all_results):,})", flush=True)

        # Pagination — next_url contains full URL with cursor
        next_url = data.get("next_url")
        if next_url:
            # Append limit and apiKey to next_url
            sep = "&" if "?" in next_url else "?"
            url = f"{next_url}{sep}limit=1000&apiKey={POLYGON_API_KEY}"
            params = {}  # params are baked into url now
        else:
            url = None

    if not all_results:
        print("  No splits found!")
        return pd.DataFrame()

    df = pd.DataFrame(all_results)
    REF_DIR.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pandas(df), str(out_file))
    print(f"  Saved: {len(df):,} splits -> {out_file.name}")
    return df


# ═════════════════════════════════════════════════════════════
# 2. DIVIDENDS (bulk paginated)
# ═════════════════════════════════════════════════════════════

async def fetch_dividends(client: httpx.AsyncClient) -> pd.DataFrame:
    """Fetch all dividends via paginated bulk endpoint."""
    print("\n" + "=" * 60)
    print("Fetching dividends (bulk paginated)...")
    print("=" * 60)

    out_file = REF_DIR / "dividends.parquet"
    if out_file.exists():
        df = pd.read_parquet(out_file)
        print(f"  Cached: {len(df):,} dividends")
        return df

    all_results = []
    url = f"{POLYGON_BASE}/v3/reference/dividends"
    params = {"limit": 1000, "apiKey": POLYGON_API_KEY}
    page = 0

    while url:
        page += 1
        resp = await client.get(url, params=params, timeout=30)
        if resp.status_code != 200:
            print(f"  ERROR: HTTP {resp.status_code}")
            break

        data = resp.json()
        results = data.get("results", [])
        all_results.extend(results)

        if page % 10 == 0 or len(results) < 1000:
            print(f"  Page {page}: {len(results)} dividends (total: {len(all_results):,})", flush=True)

        next_url = data.get("next_url")
        if next_url:
            sep = "&" if "?" in next_url else "?"
            url = f"{next_url}{sep}limit=1000&apiKey={POLYGON_API_KEY}"
            params = {}
        else:
            url = None

    if not all_results:
        print("  No dividends found!")
        return pd.DataFrame()

    df = pd.DataFrame(all_results)
    REF_DIR.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pandas(df), str(out_file))
    print(f"  Saved: {len(df):,} dividends -> {out_file.name}")
    return df


# ═════════════════════════════════════════════════════════════
# 3. TICKER DETAILS (per-symbol, async)
# ═════════════════════════════════════════════════════════════

async def fetch_one_ticker(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    symbol: str,
) -> tuple[str, bool, dict | None]:
    """Fetch ticker details for one symbol."""
    url = f"{POLYGON_BASE}/v3/reference/tickers/{symbol}"
    params = {"apiKey": POLYGON_API_KEY}

    for attempt in range(3):
        async with sem:
            try:
                resp = await client.get(url, params=params, timeout=15)

                if resp.status_code == 429:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                if resp.status_code in (404, 403):
                    return symbol, False, None
                if resp.status_code != 200:
                    return symbol, False, None

                data = resp.json()
                result = data.get("results", {})
                if not result:
                    return symbol, False, None

                # Extract useful fields
                detail = {
                    "symbol": symbol,
                    "name": result.get("name", ""),
                    "type": result.get("type", ""),
                    "market": result.get("market", ""),
                    "locale": result.get("locale", ""),
                    "primary_exchange": result.get("primary_exchange", ""),
                    "currency_name": result.get("currency_name", ""),
                    "cik": result.get("cik", ""),
                    "composite_figi": result.get("composite_figi", ""),
                    "sic_code": result.get("sic_code", ""),
                    "sic_description": result.get("sic_description", ""),
                    "ticker_root": result.get("ticker_root", ""),
                    "homepage_url": result.get("homepage_url", ""),
                    "total_employees": result.get("total_employees"),
                    "list_date": result.get("list_date", ""),
                    "share_class_shares_outstanding": result.get("share_class_shares_outstanding"),
                    "weighted_shares_outstanding": result.get("weighted_shares_outstanding"),
                    "market_cap": result.get("market_cap"),
                    "phone_number": result.get("phone_number", ""),
                    "description": result.get("description", ""),
                    "round_lot": result.get("round_lot"),
                }

                # Branding
                branding = result.get("branding", {})
                detail["logo_url"] = branding.get("logo_url", "")
                detail["icon_url"] = branding.get("icon_url", "")

                # Address
                address = result.get("address", {})
                detail["address_city"] = address.get("city", "")
                detail["address_state"] = address.get("state", "")

                return symbol, True, detail

            except (httpx.TimeoutException, httpx.ConnectError):
                if attempt < 2:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                return symbol, False, None
            except Exception:
                return symbol, False, None

    return symbol, False, None


async def fetch_ticker_details(client: httpx.AsyncClient) -> pd.DataFrame:
    """Fetch ticker details for all traded symbols."""
    print("\n" + "=" * 60)
    print("Fetching ticker details (per-symbol)...")
    print("=" * 60)

    out_file = REF_DIR / "ticker_details.parquet"
    if out_file.exists():
        df = pd.read_parquet(out_file)
        print(f"  Cached: {len(df):,} tickers")
        return df

    # Get unique symbols from trades + market_daily
    import duckdb
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    symbols = con.execute("""
        SELECT DISTINCT symbol FROM trades
        UNION
        SELECT DISTINCT symbol FROM etf_bars
        ORDER BY 1
    """).fetchdf()["symbol"].tolist()
    con.close()

    print(f"  Symbols to fetch: {len(symbols):,}")

    sem = asyncio.Semaphore(POLYGON_CONCURRENCY)
    tasks = [fetch_one_ticker(client, sem, sym) for sym in symbols]

    success = fail = 0
    details = []
    t0 = time.time()
    total = len(tasks)

    for coro in asyncio.as_completed(tasks):
        sym, ok, detail = await coro
        if ok and detail:
            success += 1
            details.append(detail)
        else:
            fail += 1

        done = success + fail
        if done % 500 == 0 or done == total or done <= 3:
            elapsed = time.time() - t0
            rate = done / max(elapsed, 0.1)
            eta = (total - done) / max(rate, 0.01)
            print(
                f"  [{done}/{total}] {sym}: {'ok' if ok else 'fail'}  "
                f"| ok={success} fail={fail}  "
                f"| {rate:.1f}/s, ETA {eta / 60:.1f}m",
                flush=True,
            )

    if not details:
        print("  No ticker details fetched!")
        return pd.DataFrame()

    df = pd.DataFrame(details)
    REF_DIR.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pandas(df), str(out_file))

    elapsed = time.time() - t0
    print(f"\n  Saved: {len(df):,} tickers in {elapsed / 60:.1f}m -> {out_file.name}")
    return df


# ═════════════════════════════════════════════════════════════
# 4. LOAD INTO DUCKDB
# ═════════════════════════════════════════════════════════════

def load_to_duckdb():
    """Load reference data into DuckDB."""
    import duckdb

    print("\n" + "=" * 60)
    print("Loading reference data into DuckDB...")
    print("=" * 60)

    con = duckdb.connect(str(DUCKDB_PATH))

    # Splits
    splits_file = REF_DIR / "splits.parquet"
    if splits_file.exists():
        con.execute("DROP TABLE IF EXISTS stock_splits")
        con.execute(f"""
            CREATE TABLE stock_splits AS
            SELECT * FROM read_parquet('{splits_file}')
        """)
        cnt = con.execute("SELECT COUNT(*) FROM stock_splits").fetchone()[0]
        print(f"  stock_splits: {cnt:,} rows")

    # Dividends
    div_file = REF_DIR / "dividends.parquet"
    if div_file.exists():
        con.execute("DROP TABLE IF EXISTS dividends")
        con.execute(f"""
            CREATE TABLE dividends AS
            SELECT * FROM read_parquet('{div_file}')
        """)
        cnt = con.execute("SELECT COUNT(*) FROM dividends").fetchone()[0]
        print(f"  dividends: {cnt:,} rows")

    # Ticker details
    td_file = REF_DIR / "ticker_details.parquet"
    if td_file.exists():
        con.execute("DROP TABLE IF EXISTS ticker_details")
        con.execute(f"""
            CREATE TABLE ticker_details AS
            SELECT * FROM read_parquet('{td_file}')
        """)
        cnt = con.execute("SELECT COUNT(*) FROM ticker_details").fetchone()[0]
        print(f"  ticker_details: {cnt:,} rows")

    # Summary
    print("\n  DuckDB tables:")
    for r in con.execute("SHOW TABLES").fetchall():
        t = r[0]
        cnt = con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        print(f"    {t:<25} {cnt:>15,} rows")

    db_size = DUCKDB_PATH.stat().st_size / 1e6
    print(f"\n  Database file: {db_size:,.1f} MB")

    con.close()


# ═════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════

async def main_async(only: str | None = None):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient() as client:
        if only in (None, "splits"):
            await fetch_splits(client)

        if only in (None, "dividends"):
            await fetch_dividends(client)

        if only in (None, "tickers"):
            await fetch_ticker_details(client)

    # Load everything into DuckDB
    load_to_duckdb()

    print("\n" + "=" * 60)
    print("Reference data fetch complete!")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="Fetch Polygon reference data")
    parser.add_argument("--only", choices=["splits", "dividends", "tickers"], default=None)
    args = parser.parse_args()
    asyncio.run(main_async(only=args.only))


if __name__ == "__main__":
    main()
