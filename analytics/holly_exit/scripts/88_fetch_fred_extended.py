"""
Script 88 -- Fetch Extended FRED Macro Series
===============================================
Adds credit spreads, jobless claims, and inflation to the macro regime picture.

New series:
  1. BAMLH0A0HYM2 — ICE BofA US High Yield Option-Adjusted Spread (daily)
     Risk-off regime indicator. Spikes during credit stress.
  2. ICSA          — Initial Jobless Claims (weekly, Thursday release)
     Labor market pulse. Rising = economic weakness.
  3. T10YIE        — 10-Year Breakeven Inflation Rate (daily)
     Market-implied inflation expectations.
  4. TEDRATE       — TED Spread (3M LIBOR - 3M T-Bill, daily, ended 2023)
     Banking stress indicator (historical only).
  5. DTWEXBGS      — Trade Weighted US Dollar Index (broad, daily)
     Dollar strength affects multinational earnings.

Loads into DuckDB as individual tables + extends fred_macro_daily.

Usage:
    python scripts/88_fetch_fred_extended.py
    python scripts/88_fetch_fred_extended.py --refresh
"""

import argparse
import sys
import time
from pathlib import Path

import duckdb
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DATA_DIR, DUCKDB_PATH

FRED_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv"
REF_DIR = DATA_DIR / "reference"

START_DATE = "2015-01-01"
END_DATE = "2026-12-31"

SERIES = {
    "hy_spread": {
        "id": "BAMLH0A0HYM2",
        "desc": "ICE BofA US HY OAS (daily)",
        "table": "fred_hy_spread",
    },
    "icsa": {
        "id": "ICSA",
        "desc": "Initial Jobless Claims (weekly)",
        "table": "fred_icsa",
    },
    "t10yie": {
        "id": "T10YIE",
        "desc": "10Y Breakeven Inflation Rate (daily)",
        "table": "fred_t10yie",
    },
    "tedrate": {
        "id": "TEDRATE",
        "desc": "TED Spread (ended 2023, daily)",
        "table": "fred_tedrate",
    },
    "dtwexbgs": {
        "id": "DTWEXBGS",
        "desc": "Trade Weighted USD Index (daily)",
        "table": "fred_usd_index",
    },
}


def fetch_fred_csv(key: str, refresh: bool = False) -> Path:
    """Download a FRED series to CSV."""
    info = SERIES[key]
    out_file = REF_DIR / f"fred_{key}.csv"

    if out_file.exists() and not refresh:
        df = pd.read_csv(out_file)
        print(f"  Cached: {key} ({len(df):,} rows) -> {out_file.name}")
        return out_file

    url = f"{FRED_BASE}?id={info['id']}&cosd={START_DATE}&coed={END_DATE}"
    print(f"  Fetching {info['id']} ({info['desc']})...")

    try:
        df = pd.read_csv(url)
        df.columns = ["date", "value"]
        df["value"] = pd.to_numeric(df["value"], errors="coerce")
        df = df.dropna(subset=["value"])

        REF_DIR.mkdir(parents=True, exist_ok=True)
        df.to_csv(out_file, index=False)
        print(f"    Saved: {len(df):,} observations -> {out_file.name}")
        return out_file

    except Exception as e:
        print(f"    ERROR fetching {info['id']}: {e}")
        if out_file.exists():
            print(f"    Using existing cached file")
            return out_file
        raise


def load_to_duckdb(con: duckdb.DuckDBPyConnection):
    """Load new FRED series into DuckDB + rebuild extended macro table."""
    print("\nLoading extended FRED data into DuckDB...")

    # Load raw series
    for key, info in SERIES.items():
        csv_file = REF_DIR / f"fred_{key}.csv"
        if not csv_file.exists():
            print(f"  {key}: no CSV file, skipping")
            continue

        table = info["table"]
        con.execute(f"DROP TABLE IF EXISTS {table}")
        con.execute(f"""
            CREATE TABLE {table} AS
            SELECT CAST(date AS DATE) AS date, value
            FROM read_csv('{csv_file}')
            WHERE value IS NOT NULL
        """)
        cnt = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        min_d, max_d = con.execute(
            f"SELECT MIN(date), MAX(date) FROM {table}"
        ).fetchone()
        print(f"  {table}: {cnt:,} rows ({min_d} to {max_d})")

    # Forward-fill weekly ICSA to daily
    con.execute("DROP TABLE IF EXISTS fred_icsa_daily")
    con.execute("""
        CREATE TABLE fred_icsa_daily AS
        WITH date_range AS (
            SELECT CAST('2015-01-01' AS DATE) + (i * INTERVAL 1 DAY) AS date
            FROM generate_series(0, 4500) t(i)
            WHERE CAST('2015-01-01' AS DATE) + (i * INTERVAL 1 DAY) <= CURRENT_DATE
        ),
        filled AS (
            SELECT d.date,
                   (SELECT f.value
                    FROM fred_icsa f
                    WHERE f.date <= d.date
                    ORDER BY f.date DESC LIMIT 1) AS value
            FROM date_range d
        )
        SELECT date, value FROM filled WHERE value IS NOT NULL
    """)
    cnt = con.execute("SELECT COUNT(*) FROM fred_icsa_daily").fetchone()[0]
    print(f"  fred_icsa_daily: {cnt:,} rows (forward-filled)")

    # Rebuild extended macro table
    print("\n  Rebuilding fred_macro_extended...")
    con.execute("DROP TABLE IF EXISTS fred_macro_extended")
    con.execute("""
        CREATE TABLE fred_macro_extended AS
        SELECT
            m.*,
            -- New series
            hy.value AS hy_spread,
            ic.value AS initial_claims,
            inf.value AS breakeven_inflation_10y,
            ted.value AS ted_spread,
            usd.value AS usd_index,
            -- HY spread regime
            CASE
                WHEN hy.value > 6.0 THEN 'distressed'
                WHEN hy.value > 4.5 THEN 'stressed'
                WHEN hy.value > 3.5 THEN 'normal'
                ELSE 'tight'
            END AS credit_regime,
            -- HY spread momentum (5d change)
            hy.value - LAG(hy.value, 5) OVER (ORDER BY m.date) AS hy_spread_5d_change,
            -- Claims regime (relative to 4-week avg)
            CASE
                WHEN ic.value > 300000 THEN 'elevated'
                WHEN ic.value > 225000 THEN 'normal'
                ELSE 'low'
            END AS claims_regime,
            -- USD strength
            CASE
                WHEN usd.value - LAG(usd.value, 20) OVER (ORDER BY m.date) > 2.0 THEN 'strengthening'
                WHEN usd.value - LAG(usd.value, 20) OVER (ORDER BY m.date) < -2.0 THEN 'weakening'
                ELSE 'stable'
            END AS usd_direction
        FROM fred_macro_daily m
        LEFT JOIN fred_hy_spread hy ON hy.date = m.date
        LEFT JOIN fred_icsa_daily ic ON ic.date = m.date
        LEFT JOIN fred_t10yie inf ON inf.date = m.date
        LEFT JOIN fred_tedrate ted ON ted.date = m.date
        LEFT JOIN fred_usd_index usd ON usd.date = m.date
        ORDER BY m.date
    """)
    cnt = con.execute("SELECT COUNT(*) FROM fred_macro_extended").fetchone()[0]
    min_d, max_d = con.execute(
        "SELECT MIN(date), MAX(date) FROM fred_macro_extended"
    ).fetchone()
    print(f"  fred_macro_extended: {cnt:,} rows ({min_d} to {max_d})")

    # Coverage check
    coverage = con.execute("""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN me.hy_spread IS NOT NULL THEN 1 ELSE 0 END) AS has_hy,
            SUM(CASE WHEN me.initial_claims IS NOT NULL THEN 1 ELSE 0 END) AS has_claims,
            SUM(CASE WHEN me.breakeven_inflation_10y IS NOT NULL THEN 1 ELSE 0 END) AS has_infl,
            SUM(CASE WHEN me.usd_index IS NOT NULL THEN 1 ELSE 0 END) AS has_usd
        FROM trades t
        LEFT JOIN fred_macro_extended me ON me.date = CAST(t.entry_time AS DATE)
    """).fetchone()
    print(f"\n  Trade coverage:")
    print(f"    HY spread: {coverage[1]:,}/{coverage[0]:,} ({100*coverage[1]/coverage[0]:.1f}%)")
    print(f"    Initial claims: {coverage[2]:,}/{coverage[0]:,} ({100*coverage[2]/coverage[0]:.1f}%)")
    print(f"    Breakeven infl: {coverage[3]:,}/{coverage[0]:,} ({100*coverage[3]/coverage[0]:.1f}%)")
    print(f"    USD index: {coverage[4]:,}/{coverage[0]:,} ({100*coverage[4]/coverage[0]:.1f}%)")


def main():
    parser = argparse.ArgumentParser(
        description="Fetch extended FRED macro data"
    )
    parser.add_argument(
        "--refresh", action="store_true",
        help="Re-download all series even if cached",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("Extended FRED Macro Fetch")
    print("=" * 60)

    t0 = time.time()

    for key in SERIES:
        fetch_fred_csv(key, refresh=args.refresh)

    con = duckdb.connect(str(DUCKDB_PATH))
    load_to_duckdb(con)
    con.close()

    elapsed = time.time() - t0
    print(f"\nExtended FRED fetch complete in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
