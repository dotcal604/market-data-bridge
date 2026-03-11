"""
Script 90 -- Fetch SEC Insider Transactions (Form 4)
=====================================================
Downloads quarterly bulk TSV files from SEC EDGAR containing all
Form 3/4/5 insider transaction filings. Filters for open-market
purchases (TRANS_CODE = 'P') and builds trade-correlated features.

Data source: SEC EDGAR Structured Data
  https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/

Tables created:
  1. sec_insider_raw      — All open-market insider purchases (TRANS_CODE=P)
  2. trade_insider_features — Per-trade insider activity features:
     - insider_buys_30d: count of insider buys in 30 days before trade
     - insider_buy_value_30d: total $ value of insider buys
     - insider_buys_7d: count in 7 days before trade
     - any_insider_buy_30d: binary flag
     - insider_buyer_roles: officer/director/10pct owner breakdown

Usage:
    python scripts/90_fetch_sec_insider.py
    python scripts/90_fetch_sec_insider.py --refresh
"""

import argparse
import io
import sys
import time
import zipfile
from pathlib import Path

import duckdb
import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DATA_DIR, DUCKDB_PATH

REF_DIR = DATA_DIR / "reference"
INSIDER_DIR = REF_DIR / "insider"

SEC_BASE = (
    "https://www.sec.gov/files/structureddata/"
    "data/insider-transactions-data-sets"
)
HEADERS = {
    "User-Agent": "HollyAnalytics admin@example.com",
    "Accept-Encoding": "gzip, deflate",
}

# Quarters to download (2015Q1 through 2026Q1)
QUARTERS = []
for year in range(2015, 2027):
    for q in range(1, 5):
        if year == 2026 and q > 1:
            break
        QUARTERS.append(f"{year}q{q}")


def fetch_quarter(quarter: str, refresh: bool = False) -> Path | None:
    """Download and extract a quarterly insider transactions ZIP."""
    out_dir = INSIDER_DIR / quarter
    marker = out_dir / ".done"

    if marker.exists() and not refresh:
        print(f"  Cached: {quarter}")
        return out_dir

    url = f"{SEC_BASE}/{quarter}_form345.zip"
    print(f"  Fetching {quarter}...")

    try:
        resp = requests.get(url, headers=HEADERS, timeout=60)
        if resp.status_code == 404:
            print(f"    Not available yet (404)")
            return None
        resp.raise_for_status()

        out_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            zf.extractall(out_dir)

        # Create marker
        marker.write_text("ok")
        files = list(out_dir.glob("*.tsv"))
        print(f"    Extracted: {len(files)} TSV files")
        return out_dir

    except Exception as e:
        print(f"    ERROR: {e}")
        return None


def parse_insider_buys(quarter_dir: Path) -> pd.DataFrame | None:
    """Parse NONDERIV_TRANS + SUBMISSION + REPORTING_OWNER from a quarter,
    filter for open-market purchases (TRANS_CODE='P')."""

    # Find the relevant TSV files
    trans_file = None
    sub_file = None
    owner_file = None

    for f in quarter_dir.glob("*.tsv"):
        name = f.name.upper()
        if "NONDERIV_TRANS" in name:
            trans_file = f
        elif "SUBMISSION" in name:
            sub_file = f
        elif "REPORTING_OWNER" in name:
            owner_file = f

    if not trans_file or not sub_file:
        return None

    try:
        # Read transactions
        trans = pd.read_csv(
            trans_file, sep="\t", encoding="utf-8",
            low_memory=False, on_bad_lines="skip",
        )
        trans.columns = [c.strip().upper() for c in trans.columns]

        # Filter for purchases only
        if "TRANS_CODE" not in trans.columns:
            return None
        purchases = trans[trans["TRANS_CODE"] == "P"].copy()

        if len(purchases) == 0:
            return None

        # Read submissions for ticker mapping
        sub = pd.read_csv(
            sub_file, sep="\t", encoding="utf-8",
            low_memory=False, on_bad_lines="skip",
        )
        sub.columns = [c.strip().upper() for c in sub.columns]

        # Merge to get ticker
        # SUBMISSION has ACCESSION_NUMBER and ISSUERTRADINGSYMBOL
        ticker_col = None
        for col in ["ISSUERTRADINGSYMBOL", "ISSUER_TRADING_SYMBOL"]:
            if col in sub.columns:
                ticker_col = col
                break

        if not ticker_col:
            return None

        merged = purchases.merge(
            sub[["ACCESSION_NUMBER", ticker_col]].drop_duplicates(),
            on="ACCESSION_NUMBER",
            how="left",
        )
        merged = merged.rename(columns={ticker_col: "SYMBOL"})

        # Read owner info for role classification
        if owner_file and owner_file.exists():
            owner = pd.read_csv(
                owner_file, sep="\t", encoding="utf-8",
                low_memory=False, on_bad_lines="skip",
            )
            owner.columns = [c.strip().upper() for c in owner.columns]
            role_cols = []
            for col in ["ISDIRECTOR", "ISOFFICER", "ISTENPERCENTOWNER"]:
                if col in owner.columns:
                    role_cols.append(col)
            if role_cols:
                owner_sub = owner[
                    ["ACCESSION_NUMBER"] + role_cols
                ].drop_duplicates()
                merged = merged.merge(
                    owner_sub, on="ACCESSION_NUMBER", how="left",
                )

        # Extract relevant columns
        result_cols = {
            "SYMBOL": "symbol",
            "TRANS_DATE": "trans_date",
            "TRANS_SHARES": "shares",
            "TRANS_PRICEPERSHARE": "price_per_share",
        }
        # Add role columns if present
        for col in ["ISDIRECTOR", "ISOFFICER", "ISTENPERCENTOWNER"]:
            if col in merged.columns:
                result_cols[col] = col.lower()

        available = {k: v for k, v in result_cols.items()
                     if k in merged.columns}
        result = merged[list(available.keys())].rename(columns=available)

        # Clean up
        result["trans_date"] = pd.to_datetime(
            result["trans_date"], errors="coerce"
        )
        result["shares"] = pd.to_numeric(result["shares"], errors="coerce")
        result["price_per_share"] = pd.to_numeric(
            result["price_per_share"], errors="coerce"
        )
        result = result.dropna(subset=["symbol", "trans_date"])
        result["symbol"] = result["symbol"].str.strip().str.upper()
        result["value"] = result["shares"] * result["price_per_share"]

        return result

    except Exception as e:
        print(f"    Parse error: {e}")
        return None


def load_to_duckdb(con: duckdb.DuckDBPyConnection):
    """Load insider data into DuckDB + build trade features."""
    print("\nLoading insider data into DuckDB...")

    # Combine all quarters
    all_dfs = []
    for quarter in QUARTERS:
        quarter_dir = INSIDER_DIR / quarter
        if not quarter_dir.exists():
            continue
        df = parse_insider_buys(quarter_dir)
        if df is not None and len(df) > 0:
            all_dfs.append(df)

    if not all_dfs:
        print("  No insider data found!")
        return

    combined = pd.concat(all_dfs, ignore_index=True)
    combined = combined.drop_duplicates(
        subset=["symbol", "trans_date", "shares", "price_per_share"]
    )

    # Filter out bad dates (before 2010 or after 2027)
    combined = combined[
        (combined["trans_date"] >= "2010-01-01")
        & (combined["trans_date"] <= "2027-01-01")
    ].copy()

    # Ensure role columns exist
    for col in ["isdirector", "isofficer", "istenpercentowner"]:
        if col not in combined.columns:
            combined[col] = 0

    print(f"  Combined: {len(combined):,} insider purchases across "
          f"{combined['symbol'].nunique():,} symbols")
    print(f"    Date range: {combined['trans_date'].min().date()} to "
          f"{combined['trans_date'].max().date()}")

    # Load raw table
    con.execute("DROP TABLE IF EXISTS sec_insider_raw")
    con.register("insider_df", combined)
    con.execute("""
        CREATE TABLE sec_insider_raw AS
        SELECT
            symbol,
            CAST(trans_date AS DATE) AS trans_date,
            CAST(shares AS DOUBLE) AS shares,
            CAST(price_per_share AS DOUBLE) AS price_per_share,
            CAST(value AS DOUBLE) AS value,
            COALESCE(CAST(isdirector AS INT), 0) AS is_director,
            COALESCE(CAST(isofficer AS INT), 0) AS is_officer,
            COALESCE(CAST(istenpercentowner AS INT), 0) AS is_10pct_owner
        FROM insider_df
        WHERE symbol IS NOT NULL
    """)
    cnt = con.execute("SELECT COUNT(*) FROM sec_insider_raw").fetchone()[0]
    print(f"  sec_insider_raw: {cnt:,} rows")

    # Build trade-level insider features
    print("\n  Building trade-level insider features...")
    con.execute("DROP TABLE IF EXISTS trade_insider_features")
    con.execute("""
        CREATE TABLE trade_insider_features AS
        WITH trade_dates AS (
            SELECT
                trade_id,
                symbol,
                CAST(entry_time AS DATE) AS trade_date
            FROM trades
        ),
        -- Insider buys in 30 days before trade
        buys_30d AS (
            SELECT
                t.trade_id,
                COUNT(*) AS insider_buys_30d,
                SUM(i.value) AS insider_buy_value_30d,
                SUM(i.shares) AS insider_buy_shares_30d,
                MAX(i.is_officer) AS has_officer_buy_30d,
                MAX(i.is_director) AS has_director_buy_30d,
                MAX(i.is_10pct_owner) AS has_10pct_buy_30d
            FROM trade_dates t
            JOIN sec_insider_raw i
                ON i.symbol = t.symbol
                AND i.trans_date < t.trade_date
                AND i.trans_date >= t.trade_date - INTERVAL 30 DAY
            GROUP BY t.trade_id
        ),
        -- Insider buys in 7 days before trade
        buys_7d AS (
            SELECT
                t.trade_id,
                COUNT(*) AS insider_buys_7d,
                SUM(i.value) AS insider_buy_value_7d
            FROM trade_dates t
            JOIN sec_insider_raw i
                ON i.symbol = t.symbol
                AND i.trans_date < t.trade_date
                AND i.trans_date >= t.trade_date - INTERVAL 7 DAY
            GROUP BY t.trade_id
        ),
        -- Insider buys in 90 days (for frequency context)
        buys_90d AS (
            SELECT
                t.trade_id,
                COUNT(*) AS insider_buys_90d,
                SUM(i.value) AS insider_buy_value_90d
            FROM trade_dates t
            JOIN sec_insider_raw i
                ON i.symbol = t.symbol
                AND i.trans_date < t.trade_date
                AND i.trans_date >= t.trade_date - INTERVAL 90 DAY
            GROUP BY t.trade_id
        )
        SELECT
            td.trade_id,
            td.symbol,
            td.trade_date,
            COALESCE(b30.insider_buys_30d, 0) AS insider_buys_30d,
            COALESCE(b30.insider_buy_value_30d, 0) AS insider_buy_value_30d,
            COALESCE(b30.insider_buy_shares_30d, 0) AS insider_buy_shares_30d,
            COALESCE(b30.has_officer_buy_30d, 0) AS has_officer_buy_30d,
            COALESCE(b30.has_director_buy_30d, 0) AS has_director_buy_30d,
            COALESCE(b30.has_10pct_buy_30d, 0) AS has_10pct_buy_30d,
            COALESCE(b7.insider_buys_7d, 0) AS insider_buys_7d,
            COALESCE(b7.insider_buy_value_7d, 0) AS insider_buy_value_7d,
            COALESCE(b90.insider_buys_90d, 0) AS insider_buys_90d,
            COALESCE(b90.insider_buy_value_90d, 0) AS insider_buy_value_90d,
            -- Derived features
            CASE WHEN b30.insider_buys_30d > 0 THEN 1 ELSE 0 END
                AS any_insider_buy_30d,
            CASE WHEN b7.insider_buys_7d > 0 THEN 1 ELSE 0 END
                AS any_insider_buy_7d,
            -- Cluster buying (>= 3 insiders in 30d)
            CASE WHEN b30.insider_buys_30d >= 3 THEN 1 ELSE 0 END
                AS cluster_buying_30d,
            -- Insider buy intensity (buys per 30d relative to 90d baseline)
            CASE
                WHEN b90.insider_buys_90d > 0
                THEN b30.insider_buys_30d * 3.0 / b90.insider_buys_90d
                ELSE NULL
            END AS insider_buy_intensity
        FROM trade_dates td
        LEFT JOIN buys_30d b30 ON b30.trade_id = td.trade_id
        LEFT JOIN buys_7d b7 ON b7.trade_id = td.trade_id
        LEFT JOIN buys_90d b90 ON b90.trade_id = td.trade_id
    """)

    cnt = con.execute(
        "SELECT COUNT(*) FROM trade_insider_features"
    ).fetchone()[0]
    stats = con.execute("""
        SELECT
            COUNT(*) AS total,
            SUM(any_insider_buy_30d) AS has_buy_30d,
            SUM(any_insider_buy_7d) AS has_buy_7d,
            SUM(cluster_buying_30d) AS has_cluster,
            AVG(CASE WHEN insider_buys_30d > 0
                THEN insider_buy_value_30d END) AS avg_buy_value
        FROM trade_insider_features
    """).fetchone()
    print(f"  trade_insider_features: {cnt:,} rows")
    print(f"    Trades with insider buy (30d): "
          f"{stats[1]:,.0f}/{stats[0]:,} ({100*stats[1]/stats[0]:.1f}%)")
    print(f"    Trades with insider buy (7d): "
          f"{stats[2]:,.0f}/{stats[0]:,} ({100*stats[2]/stats[0]:.1f}%)")
    print(f"    Trades with cluster buying (>=3 in 30d): "
          f"{stats[3]:,.0f}/{stats[0]:,} ({100*stats[3]/stats[0]:.1f}%)")
    if stats[4]:
        print(f"    Avg buy value (when present): ${stats[4]:,.0f}")


def main():
    parser = argparse.ArgumentParser(
        description="Fetch SEC insider transaction data"
    )
    parser.add_argument(
        "--refresh", action="store_true",
        help="Re-download all quarters even if cached",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("SEC Insider Transactions Fetch (Form 4)")
    print("=" * 60)

    t0 = time.time()

    # Download quarterly ZIPs
    for quarter in QUARTERS:
        fetch_quarter(quarter, refresh=args.refresh)
        time.sleep(0.5)  # Be polite to SEC servers

    # Load into DuckDB
    con = duckdb.connect(str(DUCKDB_PATH))
    load_to_duckdb(con)
    con.close()

    elapsed = time.time() - t0
    print(f"\nSEC insider fetch complete in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
