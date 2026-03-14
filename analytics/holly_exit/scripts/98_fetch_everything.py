"""
Script 98 -- Fetch EVERYTHING from Massive.com/Polygon before canceling
========================================================================
Pulls down all unfetched API endpoints and saves to parquet.
No analysis — just hoarding raw data.

Endpoints to fetch:
  FUNDAMENTALS (new structured):
    1. /stocks/financials/v1/ratios
    2. /stocks/financials/v1/balance-sheets
    3. /stocks/financials/v1/income-statements
    4. /stocks/financials/v1/cash-flow-statements

  ECONOMY:
    5. /fed/v1/inflation
    6. /fed/v1/inflation-expectations
    7. /fed/v1/labor-market

  FILINGS:
    8. /stocks/filings/10-K/vX/sections
    9. /stocks/filings/8-K/vX/text

  BENZINGA (may 403):
    10. /benzinga/v1/ratings
    11. /benzinga/v1/earnings
    12. /benzinga/v1/guidance
    13. /benzinga/v1/consensus-ratings
    14. /benzinga/v1/analyst-insights

  FLAT FILES:
    15. Stocks Quotes flat files
    16. Stocks Trades flat files
    17. Options Day Aggregates flat files
    18. Indices Day Aggregates flat files

Usage:
    python scripts/98_fetch_everything.py                    # All
    python scripts/98_fetch_everything.py --group fundamentals
    python scripts/98_fetch_everything.py --group economy
    python scripts/98_fetch_everything.py --group filings
    python scripts/98_fetch_everything.py --group benzinga
    python scripts/98_fetch_everything.py --group flatfiles
    python scripts/98_fetch_everything.py --endpoint ratios
    python scripts/98_fetch_everything.py --smoke            # 1 page per endpoint
"""

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import POLYGON_API_KEY, DATA_DIR

REF_DIR = DATA_DIR / "reference"
PROGRESS_DIR = REF_DIR / "fetch_progress"
MASSIVE_BASE = "https://api.massive.com"
POLYGON_BASE = "https://api.polygon.io"
FLATFILES_BASE = "https://files.massive.com"

RATE_LIMIT = 0.15  # seconds between requests


# ══════════════════════════════════════════════════════════════════
#  GENERIC PAGINATED FETCHER
# ══════════════════════════════════════════════════════════════════

def fetch_paginated(url, params, label, max_pages=99999, smoke=False, timeout=30):
    """Fetch all pages from a paginated Massive/Polygon endpoint."""
    all_results = []
    page = 0
    max_p = 1 if smoke else max_pages

    while url and page < max_p:
        page += 1
        try:
            resp = requests.get(url, params=params, timeout=timeout)
        except requests.exceptions.RequestException as e:
            print(f"    [!] Request error on page {page}: {e}")
            break

        if resp.status_code == 403:
            print(f"    [!] 403 NOT_AUTHORIZED for {label} -- skipping")
            return None
        if resp.status_code == 429:
            print(f"    [!] Rate limited, sleeping 60s...")
            time.sleep(60)
            continue
        if resp.status_code != 200:
            print(f"    [!] HTTP {resp.status_code} on page {page}: {resp.text[:200]}")
            break

        data = resp.json()
        results = data.get("results", [])
        all_results.extend(results)

        if page % 10 == 0 or page == 1:
            print(f"    Page {page}: +{len(results)} rows (total: {len(all_results):,})")

        # Pagination
        next_url = data.get("next_url")
        if next_url:
            # next_url already includes apiKey for Polygon, need to check
            if "apiKey=" not in next_url and "apikey=" not in next_url:
                separator = "&" if "?" in next_url else "?"
                next_url = f"{next_url}{separator}apiKey={POLYGON_API_KEY}"
            url = next_url
            params = {}  # params are in next_url
        else:
            break

        time.sleep(RATE_LIMIT)

    return all_results


def save_parquet(data, filename, label):
    """Save list of dicts to parquet."""
    if not data:
        print(f"    [{label}] No data to save")
        return
    df = pd.DataFrame(data)
    path = REF_DIR / filename
    df.to_parquet(path, index=False)
    print(f"    [{label}] Saved {len(df):,} rows -> {path.name} ({path.stat().st_size/1024:.0f} KB)")


def save_progress(endpoint_name, count, status="complete"):
    """Save fetch progress."""
    PROGRESS_DIR.mkdir(parents=True, exist_ok=True)
    progress = {
        "endpoint": endpoint_name,
        "rows_fetched": count,
        "status": status,
        "timestamp": datetime.now().isoformat(),
    }
    (PROGRESS_DIR / f"{endpoint_name}.json").write_text(json.dumps(progress, indent=2))


# ══════════════════════════════════════════════════════════════════
#  FUNDAMENTALS
# ══════════════════════════════════════════════════════════════════

def fetch_ratios(smoke=False):
    """Fetch financial ratios for all tickers."""
    print("\n[1/14] Financial Ratios")
    url = f"{MASSIVE_BASE}/stocks/financials/v1/ratios"
    params = {"apiKey": POLYGON_API_KEY, "limit": 50000}
    results = fetch_paginated(url, params, "ratios", smoke=smoke)
    if results is not None:
        save_parquet(results, "massive_ratios.parquet", "ratios")
        save_progress("ratios", len(results))
    return results


def fetch_balance_sheets(smoke=False):
    """Fetch balance sheets."""
    print("\n[2/14] Balance Sheets")
    url = f"{MASSIVE_BASE}/stocks/financials/v1/balance-sheets"
    params = {"apiKey": POLYGON_API_KEY, "limit": 50000, "timeframe": "quarterly"}
    results = fetch_paginated(url, params, "balance_sheets", smoke=smoke)
    if results is not None:
        save_parquet(results, "massive_balance_sheets.parquet", "balance_sheets")
        save_progress("balance_sheets", len(results))
    return results


def fetch_income_statements(smoke=False):
    """Fetch income statements."""
    print("\n[3/14] Income Statements")
    url = f"{MASSIVE_BASE}/stocks/financials/v1/income-statements"
    params = {"apiKey": POLYGON_API_KEY, "limit": 50000, "timeframe": "quarterly"}
    results = fetch_paginated(url, params, "income_statements", smoke=smoke)
    if results is not None:
        save_parquet(results, "massive_income_statements.parquet", "income_statements")
        save_progress("income_statements", len(results))
    return results


def fetch_cash_flow(smoke=False):
    """Fetch cash flow statements."""
    print("\n[4/14] Cash Flow Statements")
    url = f"{MASSIVE_BASE}/stocks/financials/v1/cash-flow-statements"
    params = {"apiKey": POLYGON_API_KEY, "limit": 50000, "timeframe": "quarterly"}
    results = fetch_paginated(url, params, "cash_flow", smoke=smoke)
    if results is not None:
        save_parquet(results, "massive_cash_flow.parquet", "cash_flow")
        save_progress("cash_flow", len(results))
    return results


# ══════════════════════════════════════════════════════════════════
#  ECONOMY
# ══════════════════════════════════════════════════════════════════

def fetch_inflation(smoke=False):
    """Fetch inflation data."""
    print("\n[5/14] Inflation (CPI)")
    url = f"{MASSIVE_BASE}/fed/v1/inflation"
    params = {"apiKey": POLYGON_API_KEY, "limit": 50000}
    results = fetch_paginated(url, params, "inflation", smoke=smoke)
    if results is not None:
        save_parquet(results, "massive_inflation.parquet", "inflation")
        save_progress("inflation", len(results))
    return results


def fetch_inflation_expectations(smoke=False):
    """Fetch inflation expectations."""
    print("\n[6/14] Inflation Expectations")
    url = f"{MASSIVE_BASE}/fed/v1/inflation-expectations"
    params = {"apiKey": POLYGON_API_KEY, "limit": 50000}
    results = fetch_paginated(url, params, "inflation_expectations", smoke=smoke)
    if results is not None:
        save_parquet(results, "massive_inflation_expectations.parquet", "inflation_expectations")
        save_progress("inflation_expectations", len(results))
    return results


def fetch_labor_market(smoke=False):
    """Fetch labor market data."""
    print("\n[7/14] Labor Market")
    url = f"{MASSIVE_BASE}/fed/v1/labor-market"
    params = {"apiKey": POLYGON_API_KEY, "limit": 50000}
    results = fetch_paginated(url, params, "labor_market", smoke=smoke)
    if results is not None:
        save_parquet(results, "massive_labor_market.parquet", "labor_market")
        save_progress("labor_market", len(results))
    return results


# ══════════════════════════════════════════════════════════════════
#  FILINGS
# ══════════════════════════════════════════════════════════════════

def fetch_10k_sections(smoke=False):
    """Fetch 10-K filing sections (business + risk factors text)."""
    print("\n[8/14] 10-K Sections")
    url = f"{MASSIVE_BASE}/stocks/filings/10-K/vX/sections"
    params = {"apiKey": POLYGON_API_KEY, "limit": 999}
    results = fetch_paginated(url, params, "10k_sections", smoke=smoke, timeout=120)
    if results is not None:
        save_parquet(results, "massive_10k_sections.parquet", "10k_sections")
        save_progress("10k_sections", len(results))
    return results


def fetch_8k_text(smoke=False):
    """Fetch 8-K filing full text."""
    print("\n[9/14] 8-K Text")
    url = f"{MASSIVE_BASE}/stocks/filings/8-K/vX/text"
    params = {"apiKey": POLYGON_API_KEY, "limit": 999}
    results = fetch_paginated(url, params, "8k_text", smoke=smoke, timeout=120)
    if results is not None:
        save_parquet(results, "massive_8k_text.parquet", "8k_text")
        save_progress("8k_text", len(results))
    return results


# ══════════════════════════════════════════════════════════════════
#  BENZINGA (may 403)
# ══════════════════════════════════════════════════════════════════

def fetch_benzinga_endpoint(path, name, parquet_name, smoke=False):
    """Try a Benzinga endpoint — skip gracefully on 403."""
    url = f"{MASSIVE_BASE}{path}"
    params = {"apiKey": POLYGON_API_KEY, "limit": 1000}
    results = fetch_paginated(url, params, name, smoke=smoke)
    if results is not None:
        save_parquet(results, parquet_name, name)
        save_progress(name, len(results))
    return results


def fetch_benzinga_all(smoke=False):
    """Try all Benzinga endpoints."""
    endpoints = [
        ("/benzinga/v1/ratings", "benzinga_ratings", "massive_benzinga_ratings.parquet", "[10/14]"),
        ("/benzinga/v1/earnings", "benzinga_earnings", "massive_benzinga_earnings.parquet", "[11/14]"),
        ("/benzinga/v1/guidance", "benzinga_guidance", "massive_benzinga_guidance.parquet", "[12/14]"),
        ("/benzinga/v1/consensus-ratings", "benzinga_consensus", "massive_benzinga_consensus.parquet", "[13/14]"),
        ("/benzinga/v1/analyst-insights", "benzinga_insights", "massive_benzinga_insights.parquet", "[14/14]"),
    ]
    for path, name, pq_name, num in endpoints:
        print(f"\n{num} Benzinga: {name}")
        fetch_benzinga_endpoint(path, name, pq_name, smoke=smoke)


# ══════════════════════════════════════════════════════════════════
#  FLAT FILES (S3 download)
# ══════════════════════════════════════════════════════════════════

def list_flatfiles(asset_type, data_type):
    """List available flat files from Massive.com S3."""
    url = f"{FLATFILES_BASE}/flatfiles/v1/listing"
    params = {
        "apiKey": POLYGON_API_KEY,
        "feed": "delayed",  # or "standard"
        "asset_type": asset_type,
        "data_type": data_type,
    }
    try:
        resp = requests.get(url, params=params, timeout=30)
        if resp.status_code != 200:
            print(f"    [!] HTTP {resp.status_code}: {resp.text[:200]}")
            return []
        data = resp.json()
        return data.get("results", data.get("files", []))
    except Exception as e:
        print(f"    [!] Error listing flat files: {e}")
        return []


def fetch_flatfiles(asset_type, data_type, target_dir, smoke=False):
    """Download flat files from S3."""
    import gzip
    import io

    target_dir.mkdir(parents=True, exist_ok=True)

    print(f"  Listing {asset_type}/{data_type} flat files...")
    files = list_flatfiles(asset_type, data_type)
    if not files:
        print(f"    No files found or error listing")
        return

    # Check what's already downloaded
    existing = {f.stem.replace('.csv', '').replace('.gz', '') for f in target_dir.iterdir()}
    new_files = [f for f in files if f.get("date", f.get("name", "")) not in existing]

    total = len(files)
    new = len(new_files)
    print(f"  Total: {total}, Already have: {total - new}, New: {new}")

    if smoke:
        new_files = new_files[:1]
        print(f"  SMOKE: downloading only 1 file")

    for i, finfo in enumerate(new_files):
        file_url = finfo.get("url") or finfo.get("download_url")
        if not file_url:
            continue
        fname = finfo.get("date", finfo.get("name", f"file_{i}"))

        if "apiKey=" not in file_url:
            separator = "&" if "?" in file_url else "?"
            file_url = f"{file_url}{separator}apiKey={POLYGON_API_KEY}"

        try:
            resp = requests.get(file_url, timeout=120, stream=True)
            if resp.status_code != 200:
                print(f"    [{fname}] HTTP {resp.status_code}")
                continue

            out_path = target_dir / f"{fname}.csv.gz"
            with open(out_path, "wb") as fout:
                for chunk in resp.iter_content(chunk_size=8192):
                    fout.write(chunk)

            size_mb = out_path.stat().st_size / 1024 / 1024
            if (i + 1) % 50 == 0 or i == 0:
                print(f"    [{i+1}/{len(new_files)}] {fname} ({size_mb:.1f} MB)")

        except Exception as e:
            print(f"    [{fname}] Error: {e}")
            continue

        time.sleep(RATE_LIMIT)

    print(f"  Done: {asset_type}/{data_type}")


def fetch_all_flatfiles(smoke=False):
    """Fetch all unfetched flat file types."""
    flat_targets = [
        ("stocks", "quotes", DATA_DIR / "flat_quotes"),
        ("stocks", "trades", DATA_DIR / "flat_trades"),
        ("options", "day", DATA_DIR / "flat_options_day"),
        ("indices", "day", DATA_DIR / "flat_indices_day"),
        ("indices", "minute", DATA_DIR / "flat_indices_minute"),
    ]

    for asset_type, data_type, target_dir in flat_targets:
        print(f"\n--- Flat Files: {asset_type}/{data_type} ---")
        fetch_flatfiles(asset_type, data_type, target_dir, smoke=smoke)


# ══════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════

GROUPS = {
    "fundamentals": [fetch_ratios, fetch_balance_sheets, fetch_income_statements, fetch_cash_flow],
    "economy": [fetch_inflation, fetch_inflation_expectations, fetch_labor_market],
    "filings": [fetch_10k_sections, fetch_8k_text],
    "benzinga": [fetch_benzinga_all],
    "flatfiles": [fetch_all_flatfiles],
}

SINGLE_ENDPOINTS = {
    "ratios": fetch_ratios,
    "balance_sheets": fetch_balance_sheets,
    "income_statements": fetch_income_statements,
    "cash_flow": fetch_cash_flow,
    "inflation": fetch_inflation,
    "inflation_expectations": fetch_inflation_expectations,
    "labor_market": fetch_labor_market,
    "10k_sections": fetch_10k_sections,
    "8k_text": fetch_8k_text,
}


def main():
    parser = argparse.ArgumentParser(description="Fetch all unfetched API data")
    parser.add_argument("--group", choices=list(GROUPS.keys()), help="Fetch a specific group")
    parser.add_argument("--endpoint", choices=list(SINGLE_ENDPOINTS.keys()), help="Fetch a single endpoint")
    parser.add_argument("--smoke", action="store_true", help="Smoke test (1 page per endpoint)")
    args = parser.parse_args()

    print("=" * 70)
    print("  MEGA FETCH -- Pull Everything Before Canceling")
    print("=" * 70)
    print(f"  API Key: {'...' + POLYGON_API_KEY[-6:] if POLYGON_API_KEY else 'MISSING!'}")
    print(f"  Output: {REF_DIR}")
    t0 = time.time()

    smoke = args.smoke

    if args.endpoint:
        SINGLE_ENDPOINTS[args.endpoint](smoke=smoke)
    elif args.group:
        for fn in GROUPS[args.group]:
            fn(smoke=smoke)
    else:
        # Everything except flat files (those are huge, run separately)
        for group_name in ["fundamentals", "economy", "filings", "benzinga"]:
            print(f"\n{'='*70}")
            print(f"  GROUP: {group_name.upper()}")
            print(f"{'='*70}")
            for fn in GROUPS[group_name]:
                fn(smoke=smoke)

        print(f"\n{'='*70}")
        print(f"  NOTE: Flat files not included in default run.")
        print(f"  Run: python scripts/98_fetch_everything.py --group flatfiles")
        print(f"{'='*70}")

    elapsed = time.time() - t0
    print(f"\nAll done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
