"""
24_fetch_fred_macro.py — Fetch FRED macro time series for regime analysis.

Downloads free CSV data from FRED (no API key needed):
  1. VIXCLS     — CBOE VIX (daily)
  2. FEDFUNDS   — Federal Funds Rate (monthly → forward-filled to daily)
  3. T10Y2Y     — 10Y-2Y Treasury Spread (daily, yield curve proxy)
  4. DGS10      — 10-Year Treasury Yield (daily)
  5. DGS2       — 2-Year Treasury Yield (daily)

Downloads from CBOE directly (not on FRED):
  6. PCCE       — CBOE Equity Put/Call Ratio (daily, 2006-2019)
  7. PCCA       — CBOE Total Put/Call Ratio (daily, includes index options, 2006-2019)

Derived tables:
  - fred_fedfunds_daily — monthly fed funds forward-filled to daily
  - fred_macro_daily    — single wide table joining all series by date

Analysis shows macro features add 3-4pp win rate spread to Holly trades
with 100% trade coverage (vs news at 33% coverage). Key findings:
  - VIX Momentum (5d change): +4.1pp WR spread (strongest single factor)
  - Yield Curve (10Y-2Y):     +3.3pp WR spread
  - Rate Cycle Direction:      +3.1pp WR spread
  - Put/Call Ratio (PCCE):     Equity P/C > 1.0 = bearish sentiment,
                                < 0.7 = bullish sentiment (contrarian)

Usage:
    python scripts/24_fetch_fred_macro.py
    python scripts/24_fetch_fred_macro.py --refresh     # re-download even if cached
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

SERIES = {
    "vixcls":   {"id": "VIXCLS",   "desc": "CBOE VIX Index"},
    "fedfunds": {"id": "FEDFUNDS", "desc": "Federal Funds Rate (monthly)"},
    "t10y2y":   {"id": "T10Y2Y",   "desc": "10Y-2Y Treasury Spread"},
    "dgs10":    {"id": "DGS10",    "desc": "10-Year Treasury Yield"},
    "dgs2":     {"id": "DGS2",     "desc": "2-Year Treasury Yield"},
}

# CBOE put/call ratio CSVs (not on FRED — downloaded directly from CBOE)
CBOE_BASE = "https://cdn.cboe.com/resources/options/volume_and_call_put_ratios"
CBOE_SERIES = {
    "pcce": {
        "url": f"{CBOE_BASE}/equitypc.csv",
        "desc": "CBOE Equity Put/Call Ratio",
        "pc_col": "P/C Ratio",
    },
    "pcca": {
        "url": f"{CBOE_BASE}/totalpc.csv",
        "desc": "CBOE Total Put/Call Ratio",
        "pc_col": "P/C Ratio",
    },
}

# Union of all series keys for DuckDB loading
ALL_SERIES_KEYS = list(SERIES.keys()) + list(CBOE_SERIES.keys())

START_DATE = "2015-01-01"
END_DATE = "2026-12-31"


def fetch_fred_csv(series_key: str, refresh: bool = False) -> Path:
    """Download a FRED series to CSV. Returns path to saved file."""
    info = SERIES[series_key]
    out_file = REF_DIR / f"fred_{series_key}.csv"

    if out_file.exists() and not refresh:
        df = pd.read_csv(out_file)
        print(f"  Cached: {series_key} ({len(df):,} rows) -> {out_file.name}")
        return out_file

    url = f"{FRED_BASE}?id={info['id']}&cosd={START_DATE}&coed={END_DATE}"
    print(f"  Fetching {info['id']} ({info['desc']})...")

    try:
        df = pd.read_csv(url)
        # FRED uses "DATE" and series ID as column names
        df.columns = ["date", "value"]
        # FRED uses "." for missing values
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


def fetch_cboe_csv(series_key: str, refresh: bool = False) -> Path:
    """Download a CBOE put/call ratio CSV, extract date + P/C Ratio,
    and save in the same date,value format as FRED series."""
    info = CBOE_SERIES[series_key]
    out_file = REF_DIR / f"fred_{series_key}.csv"  # same naming convention

    if out_file.exists() and not refresh:
        df = pd.read_csv(out_file)
        print(f"  Cached: {series_key} ({len(df):,} rows) -> {out_file.name}")
        return out_file

    print(f"  Fetching {series_key.upper()} ({info['desc']}) from CBOE...")

    try:
        # CBOE CSVs have 2 header lines (disclaimer + product label)
        df = pd.read_csv(info["url"], skiprows=2)
        # Normalise column names (strip whitespace)
        df.columns = [c.strip() for c in df.columns]
        # Keep only DATE and P/C Ratio
        df = df[["DATE", info["pc_col"]]].copy()
        df.columns = ["date", "value"]
        # Parse dates (M/D/YYYY with possible whitespace)
        df["date"] = pd.to_datetime(df["date"].str.strip(), format="%m/%d/%Y")
        df["value"] = pd.to_numeric(df["value"], errors="coerce")
        df = df.dropna(subset=["value"])
        # Format date as YYYY-MM-DD for consistency with FRED CSVs
        df["date"] = df["date"].dt.strftime("%Y-%m-%d")

        REF_DIR.mkdir(parents=True, exist_ok=True)
        df.to_csv(out_file, index=False)
        print(f"    Saved: {len(df):,} observations -> {out_file.name}")
        return out_file

    except Exception as e:
        print(f"    ERROR fetching {series_key.upper()}: {e}")
        if out_file.exists():
            print(f"    Using existing cached file")
            return out_file
        raise


def load_to_duckdb(con: duckdb.DuckDBPyConnection):
    """Load FRED CSVs into DuckDB tables + build derived tables."""
    print("\n" + "=" * 60)
    print("Loading FRED data into DuckDB...")
    print("=" * 60)

    # ── Load raw series ──────────────────────────────────────────
    for key in ALL_SERIES_KEYS:
        csv_file = REF_DIR / f"fred_{key}.csv"
        if not csv_file.exists():
            print(f"  {key}: no CSV file, skipping")
            continue

        table = f"fred_{key}"
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

    # ── Derived: forward-fill monthly fed funds to daily ─────────
    con.execute("DROP TABLE IF EXISTS fred_fedfunds_daily")
    con.execute("""
        CREATE TABLE fred_fedfunds_daily AS
        WITH date_range AS (
            SELECT CAST('2015-01-01' AS DATE) + (i * INTERVAL 1 DAY) AS date
            FROM generate_series(0, 4500) t(i)
            WHERE CAST('2015-01-01' AS DATE) + (i * INTERVAL 1 DAY) <= CURRENT_DATE
        ),
        filled AS (
            SELECT d.date,
                   (SELECT f.value
                    FROM fred_fedfunds f
                    WHERE f.date <= d.date
                    ORDER BY f.date DESC LIMIT 1) AS value
            FROM date_range d
        )
        SELECT date, value FROM filled WHERE value IS NOT NULL
    """)
    cnt = con.execute("SELECT COUNT(*) FROM fred_fedfunds_daily").fetchone()[0]
    print(f"  fred_fedfunds_daily: {cnt:,} rows (forward-filled)")

    # ── Derived: single wide macro table ─────────────────────────
    con.execute("DROP TABLE IF EXISTS fred_macro_daily")
    con.execute("""
        CREATE TABLE fred_macro_daily AS
        WITH base_dates AS (
            SELECT DISTINCT date FROM fred_vixcls
        )
        SELECT
            d.date,
            v.value  AS vix,
            s.value  AS yield_spread_10y2y,
            y10.value AS yield_10y,
            y2.value  AS yield_2y,
            ff.value  AS fed_funds_rate,
            -- VIX momentum (5-day change)
            v.value - LAG(v.value, 5) OVER (ORDER BY d.date) AS vix_5d_change,
            -- VIX regime bucket
            CASE
                WHEN v.value < 15 THEN 'low'
                WHEN v.value < 20 THEN 'normal'
                WHEN v.value < 30 THEN 'elevated'
                ELSE 'high'
            END AS vix_regime,
            -- Yield curve regime
            CASE
                WHEN s.value < -0.5 THEN 'deep_inversion'
                WHEN s.value < 0    THEN 'inverted'
                WHEN s.value < 0.5  THEN 'flat'
                ELSE 'normal'
            END AS yield_curve_regime,
            -- Fed funds rate regime
            CASE
                WHEN ff.value < 1   THEN 'near_zero'
                WHEN ff.value < 3   THEN 'low'
                WHEN ff.value < 5   THEN 'moderate'
                ELSE 'restrictive'
            END AS rate_regime,
            -- Rate direction (3-month change in fed funds)
            CASE
                WHEN ff.value - LAG(ff.value, 63) OVER (ORDER BY d.date) > 0.25
                    THEN 'hiking'
                WHEN ff.value - LAG(ff.value, 63) OVER (ORDER BY d.date) < -0.25
                    THEN 'cutting'
                ELSE 'holding'
            END AS rate_direction,
            -- Put/call ratios
            pcce.value AS put_call_equity,
            pcca.value AS put_call_total,
            -- Put/call sentiment
            CASE
                WHEN pcce.value > 1.0 THEN 'bearish'
                WHEN pcce.value > 0.7 THEN 'neutral'
                ELSE 'bullish'
            END AS put_call_regime,
            -- Put/call momentum (5-day change)
            pcce.value - LAG(pcce.value, 5) OVER (ORDER BY d.date) AS put_call_5d_change
        FROM base_dates d
        LEFT JOIN fred_vixcls v ON v.date = d.date
        LEFT JOIN fred_t10y2y s ON s.date = d.date
        LEFT JOIN fred_dgs10 y10 ON y10.date = d.date
        LEFT JOIN fred_dgs2 y2 ON y2.date = d.date
        LEFT JOIN fred_fedfunds_daily ff ON ff.date = d.date
        LEFT JOIN fred_pcce pcce ON pcce.date = d.date
        LEFT JOIN fred_pcca pcca ON pcca.date = d.date
        WHERE v.value IS NOT NULL
        ORDER BY d.date
    """)
    cnt = con.execute("SELECT COUNT(*) FROM fred_macro_daily").fetchone()[0]
    min_d, max_d = con.execute(
        "SELECT MIN(date), MAX(date) FROM fred_macro_daily"
    ).fetchone()
    print(f"  fred_macro_daily: {cnt:,} rows ({min_d} to {max_d})")

    # ── Coverage check against trades ────────────────────────────
    coverage = con.execute("""
        SELECT
            COUNT(*) AS total_trades,
            COUNT(m.date) AS with_macro,
            ROUND(COUNT(m.date) * 100.0 / COUNT(*), 1) AS coverage_pct
        FROM trades t
        LEFT JOIN fred_macro_daily m ON m.date = CAST(t.entry_time AS DATE)
    """).fetchone()
    print(f"\n  Trade coverage: {coverage[1]:,}/{coverage[0]:,} "
          f"({coverage[2]}%)")


def main():
    parser = argparse.ArgumentParser(
        description="Fetch FRED macro data for Holly trade analysis"
    )
    parser.add_argument(
        "--refresh", action="store_true",
        help="Re-download all series even if cached",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("FRED Macro Data Fetch")
    print("=" * 60)

    t0 = time.time()

    # ── Download FRED CSV files ─────────────────────────────────
    for key in SERIES:
        fetch_fred_csv(key, refresh=args.refresh)

    # ── Download CBOE put/call ratio CSVs ─────────────────────
    for key in CBOE_SERIES:
        fetch_cboe_csv(key, refresh=args.refresh)

    # ── Load into DuckDB ─────────────────────────────────────────
    con = duckdb.connect(str(DUCKDB_PATH))
    load_to_duckdb(con)
    con.close()

    elapsed = time.time() - t0
    print(f"\nFRED macro fetch complete in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
