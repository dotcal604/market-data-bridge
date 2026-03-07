"""
18_fetch_financials.py — Fetch company financial statements from Polygon /vX/reference/financials.

Paginated bulk endpoint — fetches quarterly + annual filings for ALL companies.
Extracts key income statement, balance sheet, and cash flow fields into a flat table.

Polygon Stocks Starter plan — full history access, daily recency.

Usage:
    python scripts/18_fetch_financials.py
    python scripts/18_fetch_financials.py --timeframe quarterly
    python scripts/18_fetch_financials.py --timeframe annual
    python scripts/18_fetch_financials.py --ticker AAPL
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


def extract_value(financials: dict, section: str, field: str) -> float | None:
    """Safely extract a value from nested financials structure."""
    try:
        return financials[section][field]["value"]
    except (KeyError, TypeError):
        return None


def flatten_filing(item: dict) -> dict:
    """Flatten one financials result into a flat row."""
    fin = item.get("financials", {})
    inc = "income_statement"
    bs = "balance_sheet"
    cf = "cash_flow_statement"

    tickers = item.get("tickers", [])
    ticker = tickers[0] if tickers else None

    return {
        # Filing metadata
        "ticker": ticker,
        "cik": item.get("cik"),
        "company_name": item.get("company_name"),
        "sic": item.get("sic"),
        "filing_date": item.get("filing_date"),
        "start_date": item.get("start_date"),
        "end_date": item.get("end_date"),
        "fiscal_period": item.get("fiscal_period"),
        "fiscal_year": item.get("fiscal_year"),
        "timeframe": item.get("timeframe"),
        "source_filing_url": item.get("source_filing_url"),
        # Income statement
        "revenues": extract_value(fin, inc, "revenues"),
        "cost_of_revenue": extract_value(fin, inc, "cost_of_revenue"),
        "gross_profit": extract_value(fin, inc, "gross_profit"),
        "operating_expenses": extract_value(fin, inc, "operating_expenses"),
        "operating_income": extract_value(fin, inc, "operating_income_loss"),
        "net_income": extract_value(fin, inc, "net_income_loss"),
        "net_income_to_parent": extract_value(fin, inc, "net_income_loss_attributable_to_parent"),
        "eps_basic": extract_value(fin, inc, "basic_earnings_per_share"),
        "eps_diluted": extract_value(fin, inc, "diluted_earnings_per_share"),
        "interest_expense": extract_value(fin, inc, "interest_expense_operating"),
        "income_tax": extract_value(fin, inc, "income_tax_expense_benefit"),
        # Balance sheet
        "total_assets": extract_value(fin, bs, "assets"),
        "current_assets": extract_value(fin, bs, "current_assets"),
        "noncurrent_assets": extract_value(fin, bs, "noncurrent_assets"),
        "total_liabilities": extract_value(fin, bs, "liabilities"),
        "current_liabilities": extract_value(fin, bs, "current_liabilities"),
        "noncurrent_liabilities": extract_value(fin, bs, "noncurrent_liabilities"),
        "total_equity": extract_value(fin, bs, "equity"),
        "equity_to_parent": extract_value(fin, bs, "equity_attributable_to_parent"),
        # Cash flow
        "operating_cash_flow": extract_value(fin, cf, "net_cash_flow_from_operating_activities"),
        "investing_cash_flow": extract_value(fin, cf, "net_cash_flow_from_investing_activities"),
        "financing_cash_flow": extract_value(fin, cf, "net_cash_flow_from_financing_activities"),
        "net_cash_flow": extract_value(fin, cf, "net_cash_flow"),
    }


async def fetch_financials(
    client: httpx.AsyncClient,
    timeframe: str | None = None,
    ticker: str | None = None,
) -> pd.DataFrame:
    """Fetch financial statements via paginated bulk endpoint."""
    label = f"financials"
    if ticker:
        label += f"_{ticker}"
    if timeframe:
        label += f"_{timeframe}"

    out_file = REF_DIR / f"{label}.parquet"
    if out_file.exists():
        df = pd.read_parquet(out_file)
        print(f"  Cached: {len(df):,} filings -> {out_file.name}")
        return df

    print("=" * 60)
    print(f"Fetching financials (paginated bulk)...")
    if timeframe:
        print(f"  Timeframe: {timeframe}")
    if ticker:
        print(f"  Ticker: {ticker}")
    print("=" * 60)

    all_rows = []

    # Build initial URL with all params baked in
    base = f"{POLYGON_BASE}/vX/reference/financials?limit=100&order=asc&sort=filing_date&apiKey={POLYGON_API_KEY}"
    if timeframe:
        base += f"&timeframe={timeframe}"
    if ticker:
        base += f"&ticker={ticker}"
    url: str | None = base

    page = 0
    t0 = time.time()
    errors = 0

    while url:
        page += 1

        for attempt in range(3):
            try:
                resp = await client.get(url, timeout=30)

                if resp.status_code == 429:
                    wait = 2 ** (attempt + 1)
                    print(f"  Rate limited, waiting {wait}s...")
                    await asyncio.sleep(wait)
                    continue

                if resp.status_code != 200:
                    print(f"  ERROR: HTTP {resp.status_code} on page {page}")
                    errors += 1
                    if errors > 10:
                        print("  Too many errors, stopping.")
                        url = None
                    break

                data = resp.json()
                results = data.get("results", [])

                for item in results:
                    row = flatten_filing(item)
                    all_rows.append(row)

                elapsed = time.time() - t0
                if page % 50 == 0 or page <= 3 or len(results) < 100:
                    print(
                        f"  Page {page}: {len(results)} filings "
                        f"(total: {len(all_rows):,}, {elapsed:.0f}s)",
                        flush=True,
                    )

                # Pagination — next_url contains cursor
                next_url = data.get("next_url")
                if next_url:
                    url = f"{next_url}&apiKey={POLYGON_API_KEY}"
                else:
                    url = None

                break  # success, exit retry loop

            except (httpx.TimeoutException, httpx.ConnectError) as e:
                if attempt < 2:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                print(f"  TIMEOUT on page {page}: {e}")
                errors += 1
                if errors > 10:
                    url = None
                break

    if not all_rows:
        print("  No financials found!")
        return pd.DataFrame()

    df = pd.DataFrame(all_rows)

    # Drop rows without a ticker
    before = len(df)
    df = df.dropna(subset=["ticker"])
    if before != len(df):
        print(f"  Dropped {before - len(df)} rows without ticker")

    # Sort
    df = df.sort_values(["ticker", "filing_date", "fiscal_period"]).reset_index(drop=True)

    # Save
    REF_DIR.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pandas(df), str(out_file))

    elapsed = time.time() - t0
    print(f"\n  Saved: {len(df):,} filings in {elapsed / 60:.1f}m -> {out_file.name}")
    print(f"  Size: {out_file.stat().st_size / 1e6:.1f} MB")
    print(f"  Tickers: {df['ticker'].nunique():,}")
    dates = df['filing_date'].dropna()
    if len(dates):
        print(f"  Date range: {dates.min()} to {dates.max()}")
    print(f"  Timeframes: {df['timeframe'].value_counts().to_dict()}")

    return df


def load_to_duckdb(parquet_file: Path):
    """Load financials into DuckDB."""
    import duckdb

    if not parquet_file.exists():
        print("  No parquet file to load")
        return

    print("\n" + "=" * 60)
    print("Loading financials into DuckDB...")
    print("=" * 60)

    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS financials")
    con.execute(f"""
        CREATE TABLE financials AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)

    cnt = con.execute("SELECT COUNT(*) FROM financials").fetchone()[0]
    tickers = con.execute("SELECT COUNT(DISTINCT ticker) FROM financials").fetchone()[0]
    print(f"  financials: {cnt:,} rows, {tickers:,} tickers")

    # Show date range
    row = con.execute("""
        SELECT MIN(filing_date), MAX(filing_date),
               COUNT(CASE WHEN timeframe='quarterly' THEN 1 END) as quarterly,
               COUNT(CASE WHEN timeframe='annual' THEN 1 END) as annual
        FROM financials
    """).fetchone()
    print(f"  Range: {row[0]} to {row[1]}")
    print(f"  Quarterly: {row[2]:,}, Annual: {row[3]:,}")

    # Quick sanity — top tickers by filing count
    top = con.execute("""
        SELECT ticker, COUNT(*) as n FROM financials
        GROUP BY ticker ORDER BY n DESC LIMIT 5
    """).fetchdf()
    print(f"  Top tickers: {dict(zip(top['ticker'], top['n']))}")

    con.close()


async def main_async(timeframe: str | None, ticker: str | None):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient() as client:
        df = await fetch_financials(client, timeframe=timeframe, ticker=ticker)

    if not df.empty:
        label = "financials"
        if ticker:
            label += f"_{ticker}"
        if timeframe:
            label += f"_{timeframe}"
        load_to_duckdb(REF_DIR / f"{label}.parquet")

    print("\n" + "=" * 60)
    print("Financials fetch complete!")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="Fetch Polygon company financials")
    parser.add_argument("--timeframe", choices=["quarterly", "annual", "ttm"], default=None,
                        help="Filter by timeframe (default: all)")
    parser.add_argument("--ticker", default=None,
                        help="Filter by ticker (default: all)")
    args = parser.parse_args()
    asyncio.run(main_async(timeframe=args.timeframe, ticker=args.ticker))


if __name__ == "__main__":
    main()
