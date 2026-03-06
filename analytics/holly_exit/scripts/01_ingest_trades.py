"""
01_ingest_trades.py -- Parse Holly CSV + optional TraderSync CSV into DuckDB.

Supports two CSV formats:
  1. OLD (31 cols, header row, date fmt: "2020 Mar 31 10:54:02")
  2. NEW (41 cols, NO header, date fmt: "31-Mar-2020 10:54:02")
     The 41-col format has 10 ghost columns (always empty) inserted at
     positions [2,10,12,13,21,24,28,34,35,36]. Same 31 data fields.

Direction inference priority:
  1. stop_price vs entry_price (most reliable: stop < entry = Long)
  2. price movement vs profit sign
  3. strategy name keywords

Usage:
    python scripts/01_ingest_trades.py
    python scripts/01_ingest_trades.py --csv path/to/holly.csv
"""

import sys
import csv
from pathlib import Path
from datetime import timedelta

import pandas as pd
import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import RAW_DIR, EXCLUDE_STRATEGIES
from engine.data_loader import get_db, ensure_schema

HOLLY_CSV = RAW_DIR / "holly_trades.csv"
TRADERSYNC_CSV = RAW_DIR / "tradersync_fills.csv"

# Date formats: old = "2020 Mar 31 10:54:02", new = "31-Mar-2020 10:54:02"
HOLLY_DATE_FMTS = [
    "%d-%b-%Y %H:%M:%S",  # new format (try first)
    "%Y %b %d %H:%M:%S",  # old format
    "%Y-%m-%d %H:%M:%S",  # ISO fallback
]

# New 41-column layout: index -> field name (ghost columns omitted)
NEW_41_COL_MAP = {
    0: "Entry Time",
    1: "Exit Time",
    # 2: ghost
    3: "Symbol",
    4: "Shares",
    5: "Entry Price",
    6: "Last Price",
    7: "Change from Entry $",
    8: "Change from the Close $",
    9: "Change from the Close %",
    # 10: ghost
    11: "Strategy",
    # 12, 13: ghost
    14: "Exit Price",
    15: "Closed Profit",
    16: "Profit Change Last 15",
    17: "Profit Change Last 5",
    18: "Max Profit",
    19: "Profit Basis Points",
    20: "Open Profit",
    # 21: ghost
    22: "Stop Price",
    23: "Time Stop",
    # 24: ghost
    25: "Max Profit Time of Day",
    26: "Distance from Max Profit",
    27: "Min Profit",
    # 28: ghost
    29: "Min Profit Time of Day",
    30: "Distance from Stop Price",
    31: "Smart Stop",
    32: "% to Stop Price",
    33: "Time Until",
    # 34, 35, 36: ghost
    37: "Segment",
    38: "Change from Entry %",
    39: "Long Term Profit $",
    40: "Long Term Profit %",
}


def direction_from_stop(entry_price: float, stop_price: float) -> str:
    """Derive direction from stop_price vs entry_price (most reliable method).

    Long trades have stop BELOW entry. Short trades have stop ABOVE entry.
    """
    if not entry_price or not stop_price or entry_price == 0:
        return "Unknown"
    if stop_price < entry_price:
        return "Long"
    if stop_price > entry_price:
        return "Short"
    return "Unknown"


def direction_from_pnl(entry_price: float, exit_price: float, closed_profit: float) -> str:
    """Infer Long/Short from price movement vs profit sign."""
    if pd.isna(exit_price) or pd.isna(closed_profit) or closed_profit == 0:
        return "Unknown"
    price_delta = exit_price - entry_price
    if (price_delta >= 0 and closed_profit >= 0) or (price_delta < 0 and closed_profit < 0):
        return "Long"
    return "Short"


def direction_from_strategy(name: str) -> str:
    """Heuristic: infer direction from strategy name keywords."""
    lower = name.lower()
    short_keywords = ["short", "breakdown", "downward", "topping", "bear",
                      "bon shorty", "separation"]
    long_keywords = ["long", "bullish", "support", "pullback long", "sunrise",
                     "tailwind", "nice chart", "mighty mouse", "breakout"]
    for kw in short_keywords:
        if kw in lower:
            return "Short"
    for kw in long_keywords:
        if kw in lower:
            return "Long"
    return "Unknown"


def _parse_datetime(val: str):
    """Try multiple date formats."""
    if not val or val.lower() == "nan":
        return None
    val = val.strip()
    for fmt in HOLLY_DATE_FMTS:
        try:
            return pd.to_datetime(val, format=fmt)
        except (ValueError, TypeError):
            continue
    return None


def _safe_float(val) -> float | None:
    """Parse float, handling comma-separated thousands like '8,059.50'."""
    if val is None:
        return None
    try:
        s = str(val).strip().replace(",", "")
        if not s or s.lower() == "nan":
            return None
        v = float(s)
        return v if not np.isnan(v) else None
    except (ValueError, TypeError):
        return None


def _safe_int(val) -> int | None:
    try:
        s = str(val).strip().replace(",", "")
        return int(float(s))
    except (ValueError, TypeError):
        return None


def _detect_format(path: Path) -> str:
    """Detect whether CSV is old 31-col (with header) or new 41-col (headerless)."""
    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        first_row = next(reader)

    n_cols = len(first_row)

    # Old format has header row starting with "Entry Time"
    if first_row[0].strip() == "Entry Time":
        return "old_31"

    # New format: 41 cols, no header, first field is a date
    if n_cols == 41:
        return "new_41"

    # Could be old format without header (31 cols)
    if n_cols == 31:
        return "old_31_headerless"

    print(f"  [WARN] Unknown format: {n_cols} columns. Attempting new_41 parse.")
    return "new_41"


def parse_holly_csv(path: Path) -> pd.DataFrame:
    """Parse Holly trades CSV (auto-detects old 31-col or new 41-col format)."""
    print(f"Reading {path}...")

    fmt = _detect_format(path)
    print(f"  Detected format: {fmt}")

    if fmt == "old_31":
        return _parse_old_format(path, has_header=True)
    elif fmt == "old_31_headerless":
        return _parse_old_format(path, has_header=False)
    else:
        return _parse_new_41_format(path)


def _parse_old_format(path: Path, has_header: bool) -> pd.DataFrame:
    """Parse old 31-column format (with or without header)."""
    OLD_COLS = [
        "Entry Time", "Exit Time", "Symbol", "Shares", "Entry Price",
        "Last Price", "Change from Entry $", "Change from the Close $",
        "Change from the Close %", "Strategy", "Exit Price", "Closed Profit",
        "Profit Change Last 15", "Profit Change Last 5", "Max Profit",
        "Profit Basis Points", "Open Profit", "Stop Price", "Time Stop",
        "Max Profit Time of Day", "Distance from Max Profit", "Min Profit",
        "Min Profit Time of Day", "Distance from Stop Price", "Smart Stop",
        "% to Stop Price", "Time Until", "Segment", "Change from Entry %",
        "Long Term Profit $", "Long Term Profit %",
    ]

    if has_header:
        raw = pd.read_csv(path, dtype=str, encoding="utf-8-sig")
        raw.columns = [c.strip() for c in raw.columns]
    else:
        raw = pd.read_csv(path, dtype=str, encoding="utf-8-sig", header=None,
                          names=OLD_COLS)

    print(f"  Raw rows: {len(raw)}")
    return _extract_records(raw)


def _parse_new_41_format(path: Path) -> pd.DataFrame:
    """Parse new 41-column headerless format with ghost columns."""
    records_raw = []
    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for row in reader:
            if len(row) < 41:
                continue
            record = {name: row[idx] for idx, name in NEW_41_COL_MAP.items()}
            records_raw.append(record)

    raw = pd.DataFrame(records_raw)
    print(f"  Raw rows: {len(raw)}")
    return _extract_records(raw)


def _extract_records(raw: pd.DataFrame) -> pd.DataFrame:
    """Extract trade records from a DataFrame with named columns."""
    records = []
    errors = 0
    dir_sources = {"stop": 0, "pnl": 0, "strategy": 0, "unknown": 0}

    for idx, row in raw.iterrows():
        try:
            symbol = str(row.get("Symbol", "")).strip()
            strategy = str(row.get("Strategy", "")).strip()

            if not symbol or not strategy or symbol == "nan":
                errors += 1
                continue

            if strategy in EXCLUDE_STRATEGIES:
                continue

            entry_time = _parse_datetime(str(row.get("Entry Time", "")))
            if entry_time is None:
                errors += 1
                continue

            entry_price = _safe_float(row.get("Entry Price"))
            if not entry_price:
                errors += 1
                continue

            exit_time = _parse_datetime(str(row.get("Exit Time", "")))
            exit_price = _safe_float(row.get("Exit Price"))
            stop_price = _safe_float(row.get("Stop Price"))
            shares = _safe_int(row.get("Shares"))
            closed_profit = _safe_float(row.get("Closed Profit"))
            max_profit = _safe_float(row.get("Max Profit"))
            min_profit = _safe_float(row.get("Min Profit"))

            # Direction inference cascade: stop > pnl > strategy name
            direction = direction_from_stop(entry_price, stop_price)
            if direction != "Unknown":
                dir_sources["stop"] += 1
            else:
                direction = direction_from_pnl(entry_price, exit_price, closed_profit)
                if direction != "Unknown":
                    dir_sources["pnl"] += 1
                else:
                    direction = direction_from_strategy(strategy)
                    if direction != "Unknown":
                        dir_sources["strategy"] += 1
                    else:
                        dir_sources["unknown"] += 1

            # Compute stop buffer %
            stop_buffer_pct = None
            if stop_price and entry_price > 0:
                stop_buffer_pct = abs(entry_price - stop_price) / entry_price * 100

            records.append({
                "symbol": symbol,
                "strategy": strategy,
                "direction": direction,
                "entry_time": entry_time,
                "entry_price": entry_price,
                "exit_time": exit_time,
                "exit_price": exit_price,
                "stop_price": stop_price,
                "target_price": None,
                "mfe": max_profit,
                "mae": min_profit,
                "shares": shares,
                "holly_pnl": closed_profit,
                "stop_buffer_pct": stop_buffer_pct,
            })

        except Exception as e:
            errors += 1
            if errors <= 10:
                print(f"  [WARN] Row {idx}: {e}")

    if errors > 10:
        print(f"  ... and {errors - 10} more parse errors")

    print(f"  Parsed: {len(records):,} trades ({errors} errors)")
    print(f"  Excluded strategies: {EXCLUDE_STRATEGIES}")
    print(f"  Direction sources: stop={dir_sources['stop']:,}, "
          f"pnl={dir_sources['pnl']:,}, strategy={dir_sources['strategy']:,}, "
          f"unknown={dir_sources['unknown']:,}")
    return pd.DataFrame(records)


def match_tradersync(trades_df: pd.DataFrame, ts_path: Path) -> pd.DataFrame:
    """Match TraderSync fills to Holly trades by (symbol, direction, time +/- 5 min)."""
    trades_df["real_entry_price"] = None
    trades_df["real_entry_time"] = None
    trades_df["real_commission"] = None

    if not ts_path.exists():
        print("  TraderSync CSV not found — skipping real fill matching.")
        return trades_df

    print(f"  Reading TraderSync fills from {ts_path}...")
    ts = pd.read_csv(ts_path, dtype=str)
    ts.columns = [c.strip() for c in ts.columns]
    print(f"  TraderSync columns: {list(ts.columns)}")
    print(f"  TraderSync rows: {len(ts)}")

    ts_time_col = next((c for c in ts.columns if "date" in c.lower() or "time" in c.lower()), None)
    ts_price_col = next((c for c in ts.columns if "price" in c.lower() or "fill" in c.lower()), None)
    ts_sym_col = next((c for c in ts.columns if "symbol" in c.lower() or "ticker" in c.lower()), None)
    ts_dir_col = next((c for c in ts.columns if "side" in c.lower() or "direction" in c.lower() or "type" in c.lower()), None)
    ts_comm_col = next((c for c in ts.columns if "comm" in c.lower() or "fee" in c.lower()), None)

    if not all([ts_time_col, ts_price_col, ts_sym_col]):
        print(f"  [WARN] Could not identify TraderSync columns. Skipping.")
        return trades_df

    matched = 0
    window = timedelta(minutes=5)

    for _, ts_row in ts.iterrows():
        try:
            ts_sym = str(ts_row[ts_sym_col]).strip().upper()
            ts_price = float(ts_row[ts_price_col])
            ts_time = pd.to_datetime(ts_row[ts_time_col])

            ts_dir = None
            if ts_dir_col:
                raw_dir = str(ts_row[ts_dir_col]).strip().lower()
                if "long" in raw_dir or "buy" in raw_dir:
                    ts_dir = "Long"
                elif "short" in raw_dir or "sell" in raw_dir:
                    ts_dir = "Short"

            ts_comm = _safe_float(ts_row.get(ts_comm_col)) if ts_comm_col else None

            candidates = trades_df[
                (trades_df["symbol"] == ts_sym)
                & (trades_df["real_entry_price"].isna())
            ]
            if ts_dir:
                candidates = candidates[candidates["direction"] == ts_dir]

            for c_idx in candidates.index:
                holly_time = pd.Timestamp(trades_df.at[c_idx, "entry_time"])
                if abs(ts_time - holly_time) <= window:
                    trades_df.at[c_idx, "real_entry_price"] = ts_price
                    trades_df.at[c_idx, "real_entry_time"] = ts_time
                    trades_df.at[c_idx, "real_commission"] = ts_comm
                    matched += 1
                    break
        except Exception:
            continue

    print(f"  TraderSync matched: {matched}/{len(ts)} fills")
    return trades_df


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Ingest Holly trades into DuckDB")
    parser.add_argument("--csv", type=Path, default=HOLLY_CSV,
                        help="Path to Holly CSV (default: data/raw/holly_trades.csv)")
    args = parser.parse_args()

    csv_path = args.csv
    if not csv_path.exists():
        print(f"ERROR: Holly trades CSV not found at {csv_path}")
        sys.exit(1)

    db = get_db()
    ensure_schema(db)

    trades = parse_holly_csv(csv_path)
    trades = match_tradersync(trades, TRADERSYNC_CSV)

    # Assign trade IDs
    trades.insert(0, "trade_id", range(1, len(trades) + 1))

    # Load into DuckDB
    db.execute("DELETE FROM trades")
    db.register("trades_df", trades)
    db.execute("""
        INSERT INTO trades
        SELECT
            trade_id, symbol, strategy, direction,
            entry_time, entry_price, exit_time, exit_price,
            stop_price, target_price, mfe, mae, shares,
            holly_pnl, stop_buffer_pct,
            real_entry_price, real_entry_time, real_commission
        FROM trades_df
    """)

    count = db.execute("SELECT COUNT(*) FROM trades").fetchone()[0]
    print(f"\nLoaded {count} trades into DuckDB")

    # Direction distribution
    dir_dist = db.execute(
        "SELECT direction, COUNT(*) as n FROM trades GROUP BY direction ORDER BY n DESC"
    ).fetchdf()
    print(f"\nDirection distribution:")
    for _, r in dir_dist.iterrows():
        print(f"  {r['direction']}: {r['n']}")

    # Strategy summary
    summary = db.execute("SELECT * FROM trade_summary").fetchdf()
    print(f"\n--- Strategy Summary (top 15) ---")
    print(summary.head(15).to_string(index=False))

    date_range = db.execute(
        "SELECT MIN(entry_time), MAX(entry_time) FROM trades"
    ).fetchone()
    print(f"\nDate range: {date_range[0]} to {date_range[1]}")

    db.close()
    print("Done.")


if __name__ == "__main__":
    main()
