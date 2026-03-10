"""
56_fetch_financials.py — Fetch financial statements via Massive.com API.

Fetches ALL 4 financial statement types for each unique Holly-traded symbol:
  1. Balance Sheets      -> massive_balance_sheets
  2. Income Statements   -> massive_income_statements
  3. Cash Flow Statements -> massive_cash_flow
  4. Financial Ratios     -> massive_ratios

Each type produces its own parquet file and DuckDB table. Use --type to run
one at a time or all at once (default: all).

Requires: Massive Stocks Developer plan.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/56_fetch_financials.py
    python scripts/56_fetch_financials.py --smoke
    python scripts/56_fetch_financials.py --type balance_sheets
    python scripts/56_fetch_financials.py --type income_statements --smoke
    python scripts/56_fetch_financials.py --type ratios
    python scripts/56_fetch_financials.py --type all
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

from config.settings import POLYGON_API_KEY, DATA_DIR, DUCKDB_PATH, POLYGON_CONCURRENCY

MASSIVE_BASE = "https://api.massive.com"
REF_DIR = DATA_DIR / "reference"

SEMAPHORE = asyncio.Semaphore(POLYGON_CONCURRENCY if POLYGON_CONCURRENCY else 10)

ENDPOINTS = {
    "balance_sheets": {
        "path": "/stocks/financials/v1/balance-sheets",
        "ticker_param": "tickers",
        "date_col": "period_end",
        "table": "massive_balance_sheets",
        "out_file": "massive_balance_sheets.parquet",
    },
    "income_statements": {
        "path": "/stocks/financials/v1/income-statements",
        "ticker_param": "tickers",
        "date_col": "period_end",
        "table": "massive_income_statements",
        "out_file": "massive_income_statements.parquet",
    },
    "cash_flow": {
        "path": "/stocks/financials/v1/cash-flow-statements",
        "ticker_param": "tickers",
        "date_col": "period_end",
        "table": "massive_cash_flow",
        "out_file": "massive_cash_flow.parquet",
    },
    "ratios": {
        "path": "/stocks/financials/v1/ratios",
        "ticker_param": "ticker",
        "date_col": "date",
        "table": "massive_ratios",
        "out_file": "massive_ratios.parquet",
    },
}


def load_unique_symbols() -> list[str]:
    """Load all unique Holly-traded symbols from DuckDB."""
    import duckdb
    db = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    rows = db.execute("""
        SELECT DISTINCT symbol FROM trades
        WHERE CAST(entry_time AS DATE) >= '2021-01-01'
        ORDER BY symbol
    """).fetchall()
    db.close()
    return [r[0] for r in rows]


async def fetch_symbol_financials(
    client: httpx.AsyncClient,
    symbol: str,
    endpoint_cfg: dict,
) -> list[dict]:
    """Fetch all financial records for a single symbol, following pagination."""
    url = f"{MASSIVE_BASE}{endpoint_cfg['path']}"
    ticker_param = endpoint_cfg["ticker_param"]
    params = {
        ticker_param: symbol,
        "limit": "100",
        "sort": f"{endpoint_cfg['date_col']}.desc",
        "apiKey": POLYGON_API_KEY,
    }

    all_records: list[dict] = []

    async with SEMAPHORE:
        while True:
            for attempt in range(3):
                try:
                    resp = await client.get(url, params=params, timeout=20)

                    if resp.status_code == 429:
                        wait = 2 ** (attempt + 1)
                        await asyncio.sleep(wait)
                        continue

                    if resp.status_code in (403, 404):
                        return all_records

                    if resp.status_code != 200:
                        return all_records

                    data = resp.json()
                    results = data.get("results", [])

                    now_ts = datetime.now(timezone.utc).isoformat()
                    for record in results:
                        # Flatten: extract all keys as columns
                        flat = {}
                        for key, value in record.items():
                            if isinstance(value, (dict, list)):
                                flat[key] = json.dumps(value)
                            else:
                                flat[key] = value
                        # Ensure ticker is always present
                        if "ticker" not in flat:
                            flat["ticker"] = symbol
                        flat["fetched_at"] = now_ts
                        all_records.append(flat)

                    # Check for next page
                    next_url = data.get("next_url")
                    if not next_url:
                        return all_records

                    # next_url is a full URL; use it directly, append apiKey
                    url = next_url
                    if "apiKey=" not in url:
                        separator = "&" if "?" in url else "?"
                        url = f"{url}{separator}apiKey={POLYGON_API_KEY}"
                    params = {}  # params are embedded in next_url
                    break

                except (httpx.TimeoutException, httpx.ConnectError):
                    if attempt < 2:
                        await asyncio.sleep(2 ** (attempt + 1))
                        continue
                    return all_records
            else:
                # All 3 attempts were rate-limited for this page
                return all_records

    return all_records


async def fetch_endpoint(
    client: httpx.AsyncClient,
    endpoint_name: str,
    symbols: list[str],
    smoke: bool = False,
) -> None:
    """Fetch one financial endpoint for all symbols, save parquet, load DuckDB."""
    cfg = ENDPOINTS[endpoint_name]
    out_file = REF_DIR / cfg["out_file"]
    table_name = cfg["table"]
    date_col = cfg["date_col"]

    print(f"\n{'=' * 60}")
    print(f"Fetching {endpoint_name} from Massive.com...")
    print(f"  Endpoint: {cfg['path']}")
    print(f"  Symbols: {len(symbols):,}")
    print(f"{'=' * 60}")

    # Load existing data for merge
    existing_tickers: set[str] = set()
    all_rows: list[dict] = []
    if out_file.exists():
        existing_df = pd.read_parquet(out_file)
        # Track which tickers already have data
        if "ticker" in existing_df.columns:
            existing_tickers = set(existing_df["ticker"])
        all_rows = existing_df.to_dict("records")
        print(f"  Existing records: {len(all_rows):,} ({len(existing_tickers):,} tickers)")

    remaining = [s for s in symbols if s not in existing_tickers]
    print(f"  Remaining symbols: {len(remaining):,}")

    if not remaining:
        print(f"  All tickers already fetched for {endpoint_name}!")
        if out_file.exists():
            load_to_duckdb(out_file, table_name)
        return

    t0 = time.time()
    new_records = 0
    failed = 0
    empty = 0

    batch_size = 50
    for batch_start in range(0, len(remaining), batch_size):
        batch = remaining[batch_start:batch_start + batch_size]
        tasks = [fetch_symbol_financials(client, sym, cfg) for sym in batch]
        results = await asyncio.gather(*tasks)

        for sym, records in zip(batch, results):
            if records:
                all_rows.extend(records)
                new_records += len(records)
            else:
                empty += 1

        done = batch_start + len(batch)
        elapsed = time.time() - t0
        if done % 100 == 0 or done == len(remaining) or batch_start == 0:
            print(
                f"  [{done:,}/{len(remaining):,}] "
                f"+{new_records:,} records | {empty:,} empty "
                f"| {done/len(remaining)*100:.0f}% | {elapsed:.0f}s"
            )

    if not all_rows:
        print(f"  No records fetched for {endpoint_name}!")
        return

    df = pd.DataFrame(all_rows)

    # Dedup on ticker + date_col (keep latest fetch)
    dedup_cols = ["ticker", date_col]
    # Only dedup if date_col exists in the dataframe
    available_dedup = [c for c in dedup_cols if c in df.columns]
    if available_dedup:
        before = len(df)
        df = df.drop_duplicates(subset=available_dedup, keep="last").reset_index(drop=True)
        dupes = before - len(df)
    else:
        dupes = 0

    pq.write_table(pa.Table.from_pandas(df), str(out_file), compression="zstd")

    elapsed = time.time() - t0
    print(f"\n  {endpoint_name} complete!")
    print(f"  New records this run: {new_records:,}")
    print(f"  Duplicates removed: {dupes:,}")
    print(f"  Total records: {len(df):,}")
    print(f"  Unique tickers: {df['ticker'].nunique():,}" if "ticker" in df.columns else "")
    print(f"  Columns: {len(df.columns)}")
    print(f"  File size: {out_file.stat().st_size / 1e6:.1f} MB")
    print(f"  Elapsed: {elapsed:.0f}s")

    if date_col in df.columns and not df[date_col].isna().all():
        date_range = f"{df[date_col].min()} to {df[date_col].max()}"
        print(f"  Date range: {date_range}")

    load_to_duckdb(out_file, table_name)


def load_to_duckdb(parquet_file: Path, table_name: str):
    import duckdb
    if not parquet_file.exists():
        return

    print(f"\n  Loading into DuckDB ({DUCKDB_PATH.name}) -> {table_name}...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute(f"DROP TABLE IF EXISTS {table_name}")
    con.execute(f"""
        CREATE TABLE {table_name} AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)
    cnt = con.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
    tickers = con.execute(f"SELECT COUNT(DISTINCT ticker) FROM {table_name}").fetchone()[0]
    print(f"  {table_name}: {cnt:,} rows, {tickers:,} unique tickers")
    con.close()


async def main_async(args):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading unique Holly symbols from DuckDB...")
    symbols = load_unique_symbols()
    print(f"  Total unique symbols: {len(symbols)}")

    if not symbols:
        print("No symbols found!")
        return

    if args.smoke:
        symbols = symbols[:5]
        print(f"\n  SMOKE TEST: fetching only {len(symbols)} symbols")

    # Determine which endpoints to run
    if args.type == "all":
        endpoint_names = list(ENDPOINTS.keys())
    else:
        if args.type not in ENDPOINTS:
            print(f"ERROR: Unknown type '{args.type}'. Valid: {list(ENDPOINTS.keys()) + ['all']}")
            sys.exit(1)
        endpoint_names = [args.type]

    print(f"\n  Endpoints to fetch: {endpoint_names}")

    t0 = time.time()

    async with httpx.AsyncClient() as client:
        for ep_name in endpoint_names:
            await fetch_endpoint(client, ep_name, symbols, smoke=args.smoke)

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Financials fetch complete!")
    print(f"{'=' * 60}")
    print(f"  Endpoints processed: {len(endpoint_names)}")
    print(f"  Total elapsed: {elapsed / 60:.1f} min")


def main():
    parser = argparse.ArgumentParser(
        description="Fetch financial statements via Massive.com for Holly symbols"
    )
    parser.add_argument("--smoke", action="store_true",
                        help="Smoke test: first 5 symbols only")
    parser.add_argument("--type", default="all",
                        choices=list(ENDPOINTS.keys()) + ["all"],
                        help="Which financial type to fetch (default: all)")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
