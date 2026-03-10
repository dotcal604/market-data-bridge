"""
35_fetch_sector_data.py — Backfill missing sector/industry data using yfinance.

The Silver layer has ~34% of trades missing sector data. The existing
`ticker_details` table (from Polygon) covers many symbols, but delisted
small-caps often have NULL sic_description. This script uses yfinance as a
supplementary source to fill the gap.

Creates a `sector_lookup` table in DuckDB with sector, industry, company name,
and market cap for every traded symbol.

Usage:
    python scripts/35_fetch_sector_data.py
    python scripts/35_fetch_sector_data.py --refresh    # re-fetch all symbols
    python scripts/35_fetch_sector_data.py --limit 100  # fetch only 100 symbols (testing)
"""

import argparse
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import DATA_DIR, DUCKDB_PATH

CACHE_FILE = DATA_DIR / "sector_lookup.parquet"


def get_trade_symbols(con: duckdb.DuckDBPyConnection) -> list[str]:
    """Get unique symbols from Holly trades."""
    result = con.execute("""
        SELECT DISTINCT symbol FROM trades ORDER BY symbol
    """).fetchall()
    return [r[0] for r in result]


def get_symbols_missing_sector(con: duckdb.DuckDBPyConnection) -> set[str]:
    """Find symbols missing from ticker_details or with NULL sic_description.

    Returns the set of symbols that need sector data backfill.
    """
    # Check if ticker_details table exists
    tables = [r[0] for r in con.execute("SHOW TABLES").fetchall()]

    if "ticker_details" not in tables:
        # All trade symbols are missing
        result = con.execute(
            "SELECT DISTINCT symbol FROM trades"
        ).fetchall()
        return {r[0] for r in result}

    # Symbols in trades but missing from ticker_details OR with NULL sic_description
    result = con.execute("""
        SELECT DISTINCT t.symbol
        FROM trades t
        LEFT JOIN ticker_details td ON td.symbol = t.symbol
        WHERE td.symbol IS NULL
           OR td.sic_description IS NULL
           OR TRIM(td.sic_description) = ''
    """).fetchall()
    return {r[0] for r in result}


def fetch_sector_data(
    symbols: list[str],
    missing_symbols: set[str],
    refresh: bool = False,
) -> pd.DataFrame:
    """Fetch sector/industry data for symbols using yfinance."""
    import yfinance as yf

    # Suppress noisy yfinance warnings for delisted/missing symbols
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)

    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)

    # ── Load cache ────────────────────────────────────────────
    cached = pd.DataFrame()
    cached_symbols: set[str] = set()
    if CACHE_FILE.exists() and not refresh:
        cached = pd.read_parquet(CACHE_FILE)
        cached_symbols = set(cached["symbol"].unique())
        print(f"  Cached: {len(cached_symbols)} symbols in {CACHE_FILE.name}")

    # ── Determine which symbols to fetch ──────────────────────
    # If refreshing, re-fetch everything; otherwise only fetch symbols that
    # are (a) missing sector data AND (b) not already in the parquet cache.
    if refresh:
        to_fetch = list(symbols)
    else:
        to_fetch = [s for s in symbols if s in missing_symbols and s not in cached_symbols]

    if not to_fetch:
        print(f"  All {len(symbols)} symbols already have sector data or are cached")
        # Still merge cached data with any existing data
        return cached

    print(f"  Symbols needing sector data: {len(missing_symbols)}")
    print(f"  Already cached: {len(cached_symbols & missing_symbols)}")
    print(f"  To fetch from yfinance: {len(to_fetch)}")

    # ── Fetch from yfinance ───────────────────────────────────
    new_rows: list[dict] = []
    errors = 0
    no_data = 0
    found = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for i, sym in enumerate(to_fetch):
        if i > 0 and i % 50 == 0:
            print(
                f"    Progress: {i}/{len(to_fetch)} "
                f"(found={found}, no_data={no_data}, errors={errors})"
            )

        try:
            ticker = yf.Ticker(sym)
            info = ticker.info

            if not info or info.get("trailingPegRatio") is None and info.get("sector") is None:
                # yfinance returns a mostly-empty dict for delisted symbols;
                # check if sector is present as the primary signal.
                sector = info.get("sector") if info else None
            else:
                sector = info.get("sector")

            industry = info.get("industry") if info else None
            company_name = info.get("shortName") or info.get("longName") if info else None
            market_cap = info.get("marketCap") if info else None

            row = {
                "symbol": sym,
                "sector": sector,
                "industry": industry,
                "company_name": company_name,
                "market_cap": market_cap,
                "source": "yfinance",
                "fetched_at": now_iso,
            }
            new_rows.append(row)

            if sector:
                found += 1
            else:
                no_data += 1

        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"    Error {sym}: {e}")

            # Still record the symbol so we don't retry it next run
            new_rows.append({
                "symbol": sym,
                "sector": None,
                "industry": None,
                "company_name": None,
                "market_cap": None,
                "source": "yfinance",
                "fetched_at": now_iso,
            })

        time.sleep(0.3)  # Rate limit

    print(
        f"\n  Fetch complete: {len(to_fetch)} symbols "
        f"(found={found}, no_data={no_data}, errors={errors})"
    )

    # ── Merge with cache and save ─────────────────────────────
    if new_rows:
        new_df = pd.DataFrame(new_rows)
        if not cached.empty:
            # Drop old entries for symbols we just re-fetched
            cached = cached[~cached["symbol"].isin(new_df["symbol"])]
            result = pd.concat([cached, new_df], ignore_index=True)
        else:
            result = new_df
    else:
        result = cached

    # Deduplicate by symbol (keep latest)
    result = result.drop_duplicates(subset=["symbol"], keep="last")
    result = result.sort_values("symbol").reset_index(drop=True)

    result.to_parquet(CACHE_FILE, index=False)
    print(f"  Saved: {len(result):,} symbols -> {CACHE_FILE.name}")

    return result


def load_to_duckdb(con: duckdb.DuckDBPyConnection, df: pd.DataFrame):
    """Load sector lookup data into DuckDB."""
    print("\n" + "=" * 60)
    print("Loading sector_lookup into DuckDB...")
    print("=" * 60)

    con.execute("DROP TABLE IF EXISTS sector_lookup")

    if len(df) == 0:
        print("  No sector data to load")
        return

    # Register the DataFrame and create table with explicit types
    con.register("sector_df", df)
    con.execute("""
        CREATE TABLE sector_lookup AS
        SELECT
            CAST(symbol AS VARCHAR) AS symbol,
            CAST(sector AS VARCHAR) AS sector,
            CAST(industry AS VARCHAR) AS industry,
            CAST(company_name AS VARCHAR) AS company_name,
            CAST(market_cap AS BIGINT) AS market_cap,
            CAST(source AS VARCHAR) AS source,
            CAST(fetched_at AS VARCHAR) AS fetched_at
        FROM sector_df
        ORDER BY symbol
    """)
    con.unregister("sector_df")

    total = con.execute("SELECT COUNT(*) FROM sector_lookup").fetchone()[0]
    with_sector = con.execute(
        "SELECT COUNT(*) FROM sector_lookup WHERE sector IS NOT NULL"
    ).fetchone()[0]
    without_sector = total - with_sector

    print(f"  sector_lookup: {total:,} symbols")
    print(f"    With sector:    {with_sector:,}")
    print(f"    Without sector: {without_sector:,} (delisted/unavailable)")

    # ── Coverage check against trades ─────────────────────────
    coverage = con.execute("""
        SELECT
            COUNT(*) AS total_trades,
            COUNT(sl.sector) AS with_sector,
            ROUND(COUNT(sl.sector) * 100.0 / NULLIF(COUNT(*), 0), 1) AS pct
        FROM trades t
        LEFT JOIN sector_lookup sl ON sl.symbol = t.symbol
    """).fetchone()
    print(
        f"\n  Trade coverage: {coverage[1]:,}/{coverage[0]:,} trades "
        f"have sector data ({coverage[2]}%)"
    )

    # ── Combined coverage: ticker_details + sector_lookup ─────
    tables = [r[0] for r in con.execute("SHOW TABLES").fetchall()]
    if "ticker_details" in tables:
        combined = con.execute("""
            SELECT
                COUNT(*) AS total_trades,
                COUNT(COALESCE(
                    NULLIF(TRIM(td.sic_description), ''),
                    sl.sector
                )) AS with_sector,
                ROUND(
                    COUNT(COALESCE(
                        NULLIF(TRIM(td.sic_description), ''),
                        sl.sector
                    )) * 100.0 / NULLIF(COUNT(*), 0), 1
                ) AS pct
            FROM trades t
            LEFT JOIN ticker_details td ON td.symbol = t.symbol
            LEFT JOIN sector_lookup sl ON sl.symbol = t.symbol
        """).fetchone()
        print(
            f"  Combined coverage (ticker_details + sector_lookup): "
            f"{combined[1]:,}/{combined[0]:,} ({combined[2]}%)"
        )

    # ── Top sectors ───────────────────────────────────────────
    top = con.execute("""
        SELECT sector, COUNT(*) AS cnt
        FROM sector_lookup
        WHERE sector IS NOT NULL
        GROUP BY sector
        ORDER BY cnt DESC
        LIMIT 10
    """).fetchall()
    if top:
        print("\n  Top sectors:")
        for sector, cnt in top:
            print(f"    {sector:<30} {cnt:>6,}")


def main():
    parser = argparse.ArgumentParser(
        description="Fetch sector/industry data for Holly symbols via yfinance"
    )
    parser.add_argument(
        "--refresh", action="store_true",
        help="Re-fetch all symbols (ignore cache)",
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Limit symbols to fetch (for testing)",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("Sector Data Fetch (yfinance)")
    print("=" * 60)

    t0 = time.time()

    con = duckdb.connect(str(DUCKDB_PATH))
    symbols = get_trade_symbols(con)
    print(f"  {len(symbols):,} unique symbols in trades")

    missing = get_symbols_missing_sector(con)
    print(f"  {len(missing):,} symbols missing sector data")

    if args.limit:
        symbols = symbols[: args.limit]
        print(f"  Limited to {len(symbols)} symbols (--limit)")

    df = fetch_sector_data(symbols, missing, refresh=args.refresh)
    load_to_duckdb(con, df)
    con.close()

    elapsed = time.time() - t0
    print(f"\nSector data fetch complete in {elapsed:.1f}s")

    # ── Summary ───────────────────────────────────────────────
    if not df.empty:
        total = len(df)
        with_sector = df["sector"].notna().sum()
        without_sector = total - with_sector
        print(f"\n{'=' * 60}")
        print("Summary")
        print(f"{'=' * 60}")
        print(f"  Total symbols:    {total:,}")
        print(f"  With sector:      {with_sector:,}")
        print(f"  Without sector:   {without_sector:,}")
        print(f"  Cache file:       {CACHE_FILE}")


if __name__ == "__main__":
    main()
