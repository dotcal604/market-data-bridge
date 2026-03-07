"""
33_fetch_economic_events.py — Economic event calendar for Holly trade analysis.

Maintains a table of market-moving economic events:
  - FOMC meeting dates (announcement day, hardcoded from Fed calendar)
  - NFP release dates (first Friday of each month, algorithmic)

These are the two highest-impact events for day trading. The resulting
tables can be joined to Holly trades via date to study event-day effects
on win rate, hold time, and MFE/MAE profiles.

Usage:
    python scripts/33_fetch_economic_events.py
"""

import argparse
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import DUCKDB_PATH

# ── FOMC Meeting Dates ────────────────────────────────────────
# Announcement day (day 2 of 2-day meetings). Source:
# https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
FOMC_DATES = [
    # 2015
    "2015-01-28", "2015-03-18", "2015-04-29", "2015-06-17",
    "2015-07-29", "2015-09-17", "2015-10-28", "2015-12-16",
    # 2016
    "2016-01-27", "2016-03-16", "2016-04-27", "2016-06-15",
    "2016-07-27", "2016-09-21", "2016-11-02", "2016-12-14",
    # 2017
    "2017-02-01", "2017-03-15", "2017-05-03", "2017-06-14",
    "2017-07-26", "2017-09-20", "2017-11-01", "2017-12-13",
    # 2018
    "2018-01-31", "2018-03-21", "2018-05-02", "2018-06-13",
    "2018-08-01", "2018-09-26", "2018-11-08", "2018-12-19",
    # 2019
    "2019-01-30", "2019-03-20", "2019-05-01", "2019-06-19",
    "2019-07-31", "2019-09-18", "2019-10-30", "2019-12-11",
    # 2020 (includes emergency meetings)
    "2020-01-29", "2020-03-03", "2020-03-15", "2020-04-29", "2020-06-10",
    "2020-07-29", "2020-09-16", "2020-11-05", "2020-12-16",
    # 2021
    "2021-01-27", "2021-03-17", "2021-04-28", "2021-06-16",
    "2021-07-28", "2021-09-22", "2021-11-03", "2021-12-15",
    # 2022
    "2022-01-26", "2022-03-16", "2022-05-04", "2022-06-15",
    "2022-07-27", "2022-09-21", "2022-11-02", "2022-12-14",
    # 2023
    "2023-02-01", "2023-03-22", "2023-05-03", "2023-06-14",
    "2023-07-26", "2023-09-20", "2023-11-01", "2023-12-13",
    # 2024
    "2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12",
    "2024-07-31", "2024-09-18", "2024-11-07", "2024-12-18",
    # 2025
    "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18",
    "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-17",
    # 2026 (announced/projected)
    "2026-01-28", "2026-03-18", "2026-05-06", "2026-06-17",
    "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-16",
]


def generate_nfp_dates(start_year: int = 2015, end_year: int = 2026) -> list[str]:
    """Generate first Friday of each month (NFP release day).

    Nonfarm Payrolls are released at 8:30 AM ET on the first Friday
    of each month, covering the prior month's employment data.
    """
    dates = []
    for year in range(start_year, end_year + 1):
        for month in range(1, 13):
            d = date(year, month, 1)
            # Find first Friday: weekday() == 4 is Friday
            days_until_friday = (4 - d.weekday()) % 7
            first_friday = d + timedelta(days=days_until_friday)
            dates.append(first_friday.isoformat())
    return dates


def load_to_duckdb(con: duckdb.DuckDBPyConnection):
    """Create economic_events and economic_event_flags tables in DuckDB."""
    print("\n" + "=" * 60)
    print("Loading economic events into DuckDB...")
    print("=" * 60)

    # ── Build rows ────────────────────────────────────────────
    rows = []
    for d in FOMC_DATES:
        rows.append((d, "FOMC", "Federal Reserve FOMC Meeting"))
    for d in generate_nfp_dates():
        rows.append((d, "NFP", "Nonfarm Payrolls Release"))

    # ── economic_events: one row per event ────────────────────
    con.execute("DROP TABLE IF EXISTS economic_events")
    values_str = ", ".join(
        f"('{r[0]}', '{r[1]}', '{r[2]}')" for r in rows
    )
    con.execute(f"""
        CREATE TABLE economic_events AS
        SELECT
            CAST(col0 AS DATE) AS date,
            col1 AS event_type,
            col2 AS description
        FROM (VALUES {values_str})
        ORDER BY date, event_type
    """)

    cnt = con.execute("SELECT COUNT(*) FROM economic_events").fetchone()[0]
    min_d, max_d = con.execute(
        "SELECT MIN(date), MAX(date) FROM economic_events"
    ).fetchone()
    print(f"  economic_events: {cnt:,} events ({min_d} to {max_d})")

    # ── event breakdown ───────────────────────────────────────
    by_type = con.execute("""
        SELECT event_type, COUNT(*) AS cnt
        FROM economic_events GROUP BY event_type ORDER BY event_type
    """).fetchall()
    for et, ec in by_type:
        print(f"    {et}: {ec:,}")

    # ── economic_event_flags: date-level boolean flags ────────
    con.execute("DROP TABLE IF EXISTS economic_event_flags")
    con.execute("""
        CREATE TABLE economic_event_flags AS
        SELECT
            date,
            MAX(CASE WHEN event_type = 'FOMC' THEN 1 ELSE 0 END) AS is_fomc_day,
            MAX(CASE WHEN event_type = 'NFP' THEN 1 ELSE 0 END) AS is_nfp_day,
            1 AS is_event_day
        FROM economic_events
        GROUP BY date
        ORDER BY date
    """)

    flags = con.execute(
        "SELECT COUNT(*) FROM economic_event_flags"
    ).fetchone()[0]
    print(f"  economic_event_flags: {flags:,} unique event days")

    # ── Coverage check against trades ─────────────────────────
    coverage = con.execute("""
        SELECT
            COUNT(*) AS total_trades,
            COUNT(e.date) AS on_event_day,
            ROUND(COUNT(e.date) * 100.0 / COUNT(*), 1) AS pct
        FROM trades t
        LEFT JOIN economic_event_flags e ON e.date = CAST(t.entry_time AS DATE)
    """).fetchone()
    print(f"\n  Trade coverage: {coverage[1]:,}/{coverage[0]:,} "
          f"trades on event days ({coverage[2]}%)")


def main():
    parser = argparse.ArgumentParser(
        description="Economic Event Calendar for Holly trade analysis"
    )
    parser.parse_args()

    print("=" * 60)
    print("Economic Event Calendar")
    print("=" * 60)

    t0 = time.time()

    con = duckdb.connect(str(DUCKDB_PATH))
    load_to_duckdb(con)
    con.close()

    elapsed = time.time() - t0
    print(f"\nEconomic event calendar complete in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
