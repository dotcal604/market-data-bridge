"""
29_map_ibkr_trades.py -- Map IBKR execution fills to Holly trades.

Groups raw IBKR Flex Query fills into round-trip trades via FIFO,
then joins to Holly trades by (symbol, direction, time +/- 5min).

Produces:
  - Entry/exit slippage (IBKR fill vs Holly price)
  - P&L comparison (actual vs Holly theoretical)
  - Coverage stats (what % of Holly alerts were traded)
  - Commission impact analysis
  - By-strategy breakdown

Usage:
    python scripts/29_map_ibkr_trades.py
    python scripts/29_map_ibkr_trades.py --fills path/to/ibkr_fills.csv
"""

import sys
import csv
import argparse
from pathlib import Path
from datetime import timedelta
from io import StringIO

import pandas as pd
import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import RAW_DIR, OUTPUT_DIR
from engine.data_loader import get_db

FILLS_CSV = RAW_DIR / "tradersync_fills.csv"
MATCH_WINDOW = timedelta(minutes=5)
REPORT_DIR = OUTPUT_DIR / "reports" / "trade_mapping"

# Multi-section record types (Format B)
SECTION_PREFIXES = {"BOF", "HEADER", "DATA", "TRAILER"}


# ---------------------------------------------------------------------------
# 1. Parse IBKR Flex Query fills (Format A: flat CSV, Format B: multi-section)
# ---------------------------------------------------------------------------

def _detect_ibkr_format(path: Path) -> str:
    """Detect whether CSV is Format A (flat) or Format B (multi-section).

    Format A: first row is column headers (ClientAccountID, Symbol, ...)
    Format B: rows prefixed with BOF/HEADER/DATA/TRAILER record types
    """
    with open(path, "r", encoding="utf-8-sig") as f:
        first_lines = [f.readline() for _ in range(5)]

    # Check if first column of any row is a section prefix
    record_types = set()
    for line in first_lines:
        if not line.strip():
            continue
        first_field = line.split(",")[0].strip().strip('"')
        if first_field in SECTION_PREFIXES:
            record_types.add(first_field)

    if len(record_types) >= 2:
        return "multi_section"
    return "flat"


def _parse_multi_section_csv(path: Path) -> pd.DataFrame:
    """Parse Format B: multi-section CSV with BOF/HEADER/DATA/TRAILER rows.

    Extracts column names from the HEADER row, then parses DATA rows,
    dropping the record-type prefix column.
    """
    headers = None
    data_rows = []

    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for row in reader:
            if not row:
                continue
            record_type = row[0].strip()

            if record_type == "HEADER" and headers is None:
                # Column names are in positions 1..N (skip the record-type prefix)
                headers = [c.strip() for c in row[1:]]

            elif record_type == "DATA":
                # Data values are in positions 1..N
                data_rows.append(row[1:])

    if headers is None:
        print("  WARNING: No HEADER row found in multi-section CSV.")
        return pd.DataFrame()

    if not data_rows:
        print("  WARNING: No DATA rows found in multi-section CSV.")
        return pd.DataFrame()

    # Build DataFrame, truncate/pad rows to match header length
    clean_rows = []
    for row in data_rows:
        if len(row) >= len(headers):
            clean_rows.append(row[:len(headers)])
        else:
            clean_rows.append(row + [""] * (len(headers) - len(row)))

    df = pd.DataFrame(clean_rows, columns=headers, dtype=str)
    print(f"  Format B (multi-section): {len(df)} DATA rows, {len(headers)} columns")
    return df


def _build_column_map(columns: pd.Index) -> dict:
    """Resolve IBKR column names across Flex report variations.

    Different Flex Query templates use slightly different column names:
      - "Date/Time" vs "DateTime" vs "TradeDate"
      - "Price" vs "TradePrice" vs "T. Price"
      - "Buy/Sell" vs "Side"
    """
    col_set = {c.lower().strip(): c for c in columns}

    def _find(candidates: list[str], required: bool = True) -> str | None:
        for c in candidates:
            if c.lower() in col_set:
                return col_set[c.lower()]
        if required:
            # Fall back to first candidate as-is
            return candidates[0]
        return None

    return {
        "symbol": _find(["Symbol", "UnderlyingSymbol"]),
        "datetime": _find(["Date/Time", "DateTime", "TradeDate", "OrderTime"]),
        "buy_sell": _find(["Buy/Sell", "Side"]),
        "quantity": _find(["Quantity", "TradedQuantity", "Shares"]),
        "price": _find(["Price", "TradePrice", "T. Price"]),
        "commission": _find(["Commission", "IBCommission", "TotalCommission"], False),
        "code": _find(["Code", "Open/CloseIndicator", "OpenCloseIndicator"], False),
        "trade_id": _find(["TradeID", "TransactionID", "IBOrderID"], False),
        "order_id": _find(["OrderID", "IBOrderID"], False),
        "proceeds": _find(["Proceeds", "NetCash"], False),
        "asset_class": _find(["AssetClass", "SecurityType", "Asset Class"], False),
    }


def parse_ibkr_fills(path: Path) -> pd.DataFrame:
    """Parse IBKR Trade Confirmations / Flex Query CSV into fills DataFrame.

    Handles both formats:
      Format A: Flat CSV (header row + data rows)
      Format B: Multi-section CSV (BOF/HEADER/DATA/TRAILER prefixes)
    """
    print(f"Reading IBKR fills from {path}...")

    fmt = _detect_ibkr_format(path)
    print(f"  Detected format: {fmt}")

    if fmt == "multi_section":
        raw = _parse_multi_section_csv(path)
    else:
        raw = pd.read_csv(path, dtype=str, encoding="utf-8-sig")
        raw.columns = [c.strip() for c in raw.columns]
        print(f"  Format A (flat): {len(raw)} rows, {len(raw.columns)} columns")

    if raw.empty:
        return pd.DataFrame()

    # Build column name map — handle variations across Flex report types
    col_map = _build_column_map(raw.columns)
    print(f"  Column mapping: {col_map}")

    fills = []
    for _, row in raw.iterrows():
        symbol = str(row.get(col_map["symbol"], "")).strip()
        if not symbol:
            continue

        # Filter to stocks only if AssetClass column exists
        if col_map.get("asset_class"):
            ac = str(row.get(col_map["asset_class"], "")).strip().upper()
            if ac and ac != "STK":
                continue

        # Parse IBKR datetime: "20250324;093138" -> datetime
        dt_raw = str(row.get(col_map["datetime"], "")).strip()
        fill_time = _parse_ibkr_datetime(dt_raw)
        if fill_time is None:
            continue

        buy_sell = str(row.get(col_map["buy_sell"], "")).strip().upper()
        quantity = _safe_float(row.get(col_map["quantity"]))
        price = _safe_float(row.get(col_map["price"]))
        commission = _safe_float(row.get(col_map.get("commission", "Commission")))
        code = str(row.get(col_map.get("code", "Code"), "")).strip()
        trade_id = str(row.get(col_map.get("trade_id", "TradeID"), "")).strip()
        order_id = str(row.get(col_map.get("order_id", "OrderID"), "")).strip()
        proceeds = _safe_float(row.get(col_map.get("proceeds", "Proceeds")))

        if price is None or quantity is None:
            continue

        # Determine open/close from Code column
        # O = opening, C = closing, D = day trade, P = partial
        is_opening = "O" in code.upper().split(";")
        is_closing = "C" in code.upper().split(";")

        fills.append({
            "symbol": symbol,
            "fill_time": fill_time,
            "buy_sell": buy_sell,
            "quantity": abs(quantity),
            "price": price,
            "commission": abs(commission) if commission else 0.0,
            "proceeds": proceeds or 0.0,
            "is_opening": is_opening,
            "is_closing": is_closing,
            "trade_id": trade_id,
            "order_id": order_id,
            "code": code,
        })

    df = pd.DataFrame(fills)
    if df.empty:
        print("  WARNING: No valid fills parsed.")
        return df

    df = df.sort_values(["symbol", "fill_time"]).reset_index(drop=True)
    print(f"  Parsed {len(df)} fills across {df['symbol'].nunique()} symbols")

    # Direction summary
    buys = (df["buy_sell"] == "BUY").sum()
    sells = (df["buy_sell"] == "SELL").sum()
    print(f"  Buys: {buys}, Sells: {sells}")

    return df


def _parse_ibkr_datetime(val: str):
    """Parse IBKR datetime format: '20250324;093138' or ISO."""
    if not val or val.lower() == "nan":
        return None
    try:
        if ";" in val:
            date_part, time_part = val.split(";")
            return pd.Timestamp(
                year=int(date_part[:4]),
                month=int(date_part[4:6]),
                day=int(date_part[6:8]),
                hour=int(time_part[:2]),
                minute=int(time_part[2:4]),
                second=int(time_part[4:6]) if len(time_part) >= 6 else 0,
            )
        return pd.to_datetime(val)
    except (ValueError, TypeError):
        return None


def _safe_float(val) -> float | None:
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


# ---------------------------------------------------------------------------
# 2. Group fills into round-trip trades (FIFO)
# ---------------------------------------------------------------------------

def group_round_trips(fills: pd.DataFrame) -> pd.DataFrame:
    """
    Group IBKR fills into round-trip trades using the Code column.

    Strategy: pair opening fills (Code contains 'O') with closing fills
    (Code contains 'C') for the same symbol, using FIFO order.
    """
    if fills.empty:
        return pd.DataFrame()

    round_trips = []

    for symbol, sym_fills in fills.groupby("symbol"):
        sym_fills = sym_fills.sort_values("fill_time").reset_index(drop=True)

        # Separate opening and closing fills
        opens = sym_fills[sym_fills["is_opening"]].copy()
        closes = sym_fills[sym_fills["is_closing"]].copy()

        # FIFO match: pair each opening with earliest available closing
        used_close_idx = set()

        for _, open_fill in opens.iterrows():
            # Find first unmatched close for this symbol after the open
            matched_close = None
            for close_idx, close_fill in closes.iterrows():
                if close_idx in used_close_idx:
                    continue
                if close_fill["fill_time"] >= open_fill["fill_time"]:
                    matched_close = close_fill
                    used_close_idx.add(close_idx)
                    break

            # Determine direction from buy/sell
            if open_fill["buy_sell"] == "BUY":
                direction = "Long"
            elif open_fill["buy_sell"] == "SELL":
                direction = "Short"
            else:
                direction = "Unknown"

            entry_price = open_fill["price"]
            entry_time = open_fill["fill_time"]
            shares = open_fill["quantity"]
            entry_commission = open_fill["commission"]

            if matched_close is not None:
                exit_price = matched_close["price"]
                exit_time = matched_close["fill_time"]
                exit_commission = matched_close["commission"]
                total_commission = entry_commission + exit_commission
                hold_seconds = (exit_time - entry_time).total_seconds()

                if direction == "Long":
                    gross_pnl = (exit_price - entry_price) * shares
                elif direction == "Short":
                    gross_pnl = (entry_price - exit_price) * shares
                else:
                    gross_pnl = 0.0

                net_pnl = gross_pnl - total_commission
                status = "closed"
            else:
                exit_price = None
                exit_time = None
                exit_commission = 0.0
                total_commission = entry_commission
                gross_pnl = None
                net_pnl = None
                hold_seconds = None
                status = "open"

            round_trips.append({
                "symbol": symbol,
                "direction": direction,
                "entry_time": entry_time,
                "entry_price": entry_price,
                "exit_time": exit_time,
                "exit_price": exit_price,
                "shares": shares,
                "gross_pnl": gross_pnl,
                "net_pnl": net_pnl,
                "total_commission": total_commission,
                "hold_seconds": hold_seconds,
                "status": status,
            })

    df = pd.DataFrame(round_trips)
    if df.empty:
        print("  WARNING: No round trips formed.")
        return df

    closed = (df["status"] == "closed").sum()
    still_open = (df["status"] == "open").sum()
    print(f"\n  Round trips: {len(df)} ({closed} closed, {still_open} open)")
    if closed > 0:
        closed_df = df[df["status"] == "closed"]
        winners = (closed_df["net_pnl"] > 0).sum()
        losers = (closed_df["net_pnl"] <= 0).sum()
        total_pnl = closed_df["net_pnl"].sum()
        print(f"  W/L: {winners}/{losers}, Total net P&L: ${total_pnl:,.2f}")

    return df


# ---------------------------------------------------------------------------
# 3. Load Holly trades from DuckDB
# ---------------------------------------------------------------------------

def load_holly_trades(db, date_range: tuple[str, str] | None = None) -> pd.DataFrame:
    """Load Holly trades, optionally filtered to a date range."""
    query = """
        SELECT
            trade_id, symbol, strategy, direction,
            entry_time, entry_price, exit_time, exit_price,
            stop_price, target_price, shares, holly_pnl,
            real_entry_price, real_entry_time
        FROM trades
        ORDER BY entry_time
    """
    if date_range:
        query = f"""
            SELECT
                trade_id, symbol, strategy, direction,
                entry_time, entry_price, exit_time, exit_price,
                stop_price, target_price, shares, holly_pnl,
                real_entry_price, real_entry_time
            FROM trades
            WHERE CAST(entry_time AS DATE) >= CAST('{date_range[0]}' AS DATE)
              AND CAST(entry_time AS DATE) <= CAST('{date_range[1]}' AS DATE)
            ORDER BY entry_time
        """
    df = db.execute(query).fetchdf()
    df["entry_time"] = pd.to_datetime(df["entry_time"])
    if "exit_time" in df.columns:
        df["exit_time"] = pd.to_datetime(df["exit_time"], errors="coerce")
    print(f"  Holly trades loaded: {len(df)}")
    return df


# ---------------------------------------------------------------------------
# 4. Match IBKR round trips to Holly trades
# ---------------------------------------------------------------------------

def match_ibkr_to_holly(
    ibkr_trades: pd.DataFrame,
    holly_trades: pd.DataFrame,
    window: timedelta = MATCH_WINDOW,
) -> pd.DataFrame:
    """
    Match IBKR round trips to Holly trades by (symbol, direction, time +/- window).

    Returns a merged DataFrame with columns from both sides.
    """
    if ibkr_trades.empty or holly_trades.empty:
        print("  No trades to match.")
        return pd.DataFrame()

    matches = []
    holly_matched_ids = set()

    for _, ibkr in ibkr_trades.iterrows():
        sym = ibkr["symbol"]
        direction = ibkr["direction"]
        entry_t = ibkr["entry_time"]

        # Find Holly candidates: same symbol, same direction, within window
        candidates = holly_trades[
            (holly_trades["symbol"] == sym)
            & (holly_trades["direction"] == direction)
            & (~holly_trades["trade_id"].isin(holly_matched_ids))
        ]

        best_match = None
        best_delta = None

        for _, holly in candidates.iterrows():
            holly_t = holly["entry_time"]
            delta = abs(entry_t - holly_t)
            if delta <= window:
                if best_delta is None or delta < best_delta:
                    best_match = holly
                    best_delta = delta

        if best_match is not None:
            holly_matched_ids.add(best_match["trade_id"])

            # Slippage calculations
            entry_slippage = ibkr["entry_price"] - best_match["entry_price"]
            entry_slippage_pct = entry_slippage / best_match["entry_price"] * 100

            exit_slippage = None
            exit_slippage_pct = None
            if ibkr["exit_price"] is not None and pd.notna(best_match["exit_price"]):
                exit_slippage = ibkr["exit_price"] - best_match["exit_price"]
                exit_slippage_pct = exit_slippage / best_match["exit_price"] * 100

            # Risk (R) from Holly's stop
            risk = None
            entry_slip_r = None
            if pd.notna(best_match["stop_price"]) and best_match["entry_price"] > 0:
                risk = abs(best_match["entry_price"] - best_match["stop_price"])
                if risk > 0:
                    entry_slip_r = entry_slippage / risk

            matches.append({
                # IBKR side
                "ibkr_entry_time": entry_t,
                "ibkr_entry_price": ibkr["entry_price"],
                "ibkr_exit_time": ibkr["exit_time"],
                "ibkr_exit_price": ibkr["exit_price"],
                "ibkr_shares": ibkr["shares"],
                "ibkr_gross_pnl": ibkr["gross_pnl"],
                "ibkr_net_pnl": ibkr["net_pnl"],
                "ibkr_commission": ibkr["total_commission"],
                "ibkr_hold_seconds": ibkr["hold_seconds"],
                "ibkr_status": ibkr["status"],
                # Holly side
                "holly_trade_id": best_match["trade_id"],
                "symbol": sym,
                "direction": direction,
                "strategy": best_match["strategy"],
                "holly_entry_time": best_match["entry_time"],
                "holly_entry_price": best_match["entry_price"],
                "holly_exit_time": best_match["exit_time"],
                "holly_exit_price": best_match["exit_price"],
                "holly_stop_price": best_match["stop_price"],
                "holly_target_price": best_match["target_price"],
                "holly_shares": best_match["shares"],
                "holly_pnl": best_match["holly_pnl"],
                # Slippage
                "entry_slippage_$": entry_slippage,
                "entry_slippage_%": entry_slippage_pct,
                "entry_slippage_R": entry_slip_r,
                "exit_slippage_$": exit_slippage,
                "exit_slippage_%": exit_slippage_pct,
                "time_delta_sec": best_delta.total_seconds(),
                "risk_per_share": risk,
                # Comparison
                "pnl_diff": (ibkr["net_pnl"] - best_match["holly_pnl"])
                    if ibkr["net_pnl"] is not None and pd.notna(best_match["holly_pnl"])
                    else None,
            })
        else:
            # Unmatched IBKR trade
            matches.append({
                "ibkr_entry_time": entry_t,
                "ibkr_entry_price": ibkr["entry_price"],
                "ibkr_exit_time": ibkr["exit_time"],
                "ibkr_exit_price": ibkr["exit_price"],
                "ibkr_shares": ibkr["shares"],
                "ibkr_gross_pnl": ibkr["gross_pnl"],
                "ibkr_net_pnl": ibkr["net_pnl"],
                "ibkr_commission": ibkr["total_commission"],
                "ibkr_hold_seconds": ibkr["hold_seconds"],
                "ibkr_status": ibkr["status"],
                "holly_trade_id": None,
                "symbol": sym,
                "direction": direction,
                "strategy": None,
                "holly_entry_time": None,
                "holly_entry_price": None,
                "holly_exit_time": None,
                "holly_exit_price": None,
                "holly_stop_price": None,
                "holly_target_price": None,
                "holly_shares": None,
                "holly_pnl": None,
                "entry_slippage_$": None,
                "entry_slippage_%": None,
                "entry_slippage_R": None,
                "exit_slippage_$": None,
                "exit_slippage_%": None,
                "time_delta_sec": None,
                "risk_per_share": None,
                "pnl_diff": None,
            })

    result = pd.DataFrame(matches)
    matched_count = result["holly_trade_id"].notna().sum()
    unmatched_count = result["holly_trade_id"].isna().sum()
    print(f"\n  Matching results:")
    print(f"    IBKR trades: {len(ibkr_trades)}")
    print(f"    Matched to Holly: {matched_count}")
    print(f"    IBKR-only (no Holly match): {unmatched_count}")

    # Holly-side coverage
    holly_in_range = holly_trades[
        holly_trades["entry_time"].between(
            ibkr_trades["entry_time"].min() - window,
            ibkr_trades["entry_time"].max() + window,
        )
    ]
    holly_unmatched = len(holly_in_range) - matched_count
    print(f"    Holly alerts in date range: {len(holly_in_range)}")
    print(f"    Holly alerts NOT traded: {holly_unmatched}")
    if len(holly_in_range) > 0:
        coverage = matched_count / len(holly_in_range) * 100
        print(f"    Holly coverage: {coverage:.1f}%")

    return result


# ---------------------------------------------------------------------------
# 5. Analytics
# ---------------------------------------------------------------------------

def compute_analytics(matched: pd.DataFrame, holly_all: pd.DataFrame) -> dict:
    """Compute slippage, P&L comparison, coverage analytics."""
    results = {}

    has_holly = matched[matched["holly_trade_id"].notna()].copy()
    ibkr_only = matched[matched["holly_trade_id"].isna()].copy()

    # --- Slippage summary ---
    if len(has_holly) > 0:
        slip = has_holly[has_holly["entry_slippage_$"].notna()]
        if len(slip) > 0:
            results["entry_slippage"] = {
                "n": len(slip),
                "mean_$": slip["entry_slippage_$"].mean(),
                "median_$": slip["entry_slippage_$"].median(),
                "mean_%": slip["entry_slippage_%"].mean(),
                "median_%": slip["entry_slippage_%"].median(),
                "mean_R": slip["entry_slippage_R"].dropna().mean(),
                "median_R": slip["entry_slippage_R"].dropna().median(),
                "favorable": (slip["entry_slippage_$"] < 0).sum()
                    if has_holly.iloc[0]["direction"] == "Long"
                    else (slip["entry_slippage_$"] > 0).sum(),
                "adverse": (slip["entry_slippage_$"] > 0).sum()
                    if has_holly.iloc[0]["direction"] == "Long"
                    else (slip["entry_slippage_$"] < 0).sum(),
            }

        exit_slip = has_holly[has_holly["exit_slippage_$"].notna()]
        if len(exit_slip) > 0:
            results["exit_slippage"] = {
                "n": len(exit_slip),
                "mean_$": exit_slip["exit_slippage_$"].mean(),
                "median_$": exit_slip["exit_slippage_$"].median(),
                "mean_%": exit_slip["exit_slippage_%"].mean(),
                "median_%": exit_slip["exit_slippage_%"].median(),
            }

    # --- P&L comparison ---
    closed_matched = has_holly[
        (has_holly["ibkr_status"] == "closed")
        & has_holly["holly_pnl"].notna()
        & has_holly["ibkr_net_pnl"].notna()
    ]
    if len(closed_matched) > 0:
        results["pnl_comparison"] = {
            "n_trades": len(closed_matched),
            "ibkr_total_net": closed_matched["ibkr_net_pnl"].sum(),
            "holly_total": closed_matched["holly_pnl"].sum(),
            "ibkr_total_gross": closed_matched["ibkr_gross_pnl"].sum(),
            "total_commission": closed_matched["ibkr_commission"].sum(),
            "pnl_diff_total": closed_matched["pnl_diff"].sum(),
            "pnl_diff_mean": closed_matched["pnl_diff"].mean(),
            "ibkr_win_rate": (closed_matched["ibkr_net_pnl"] > 0).mean(),
            "holly_win_rate": (closed_matched["holly_pnl"] > 0).mean(),
            "same_direction_pnl": (
                (closed_matched["ibkr_net_pnl"] > 0) == (closed_matched["holly_pnl"] > 0)
            ).mean(),
        }

    # --- By-strategy breakdown ---
    if len(has_holly) > 0 and "strategy" in has_holly.columns:
        strat_groups = []
        for strat, grp in has_holly.groupby("strategy"):
            closed = grp[grp["ibkr_status"] == "closed"]
            row = {
                "strategy": strat,
                "n_matched": len(grp),
                "n_closed": len(closed),
            }
            if len(closed) > 0 and closed["ibkr_net_pnl"].notna().any():
                row["ibkr_net_pnl"] = closed["ibkr_net_pnl"].sum()
                row["ibkr_win_rate"] = (closed["ibkr_net_pnl"] > 0).mean()
            if len(closed) > 0 and closed["holly_pnl"].notna().any():
                row["holly_pnl"] = closed["holly_pnl"].sum()
                row["holly_win_rate"] = (closed["holly_pnl"] > 0).mean()
            if len(grp) > 0 and grp["entry_slippage_%"].notna().any():
                row["avg_entry_slip_%"] = grp["entry_slippage_%"].mean()
            strat_groups.append(row)
        results["by_strategy"] = pd.DataFrame(strat_groups)

    # --- Commission impact ---
    if len(has_holly) > 0:
        total_comm = has_holly["ibkr_commission"].sum()
        total_gross = has_holly["ibkr_gross_pnl"].dropna().sum()
        results["commission_impact"] = {
            "total_commission": total_comm,
            "total_gross_pnl": total_gross,
            "total_net_pnl": total_gross - total_comm,
            "commission_per_trade": total_comm / len(has_holly),
            "commission_pct_of_gross": (total_comm / abs(total_gross) * 100)
                if total_gross != 0 else None,
        }

    # --- Coverage: Holly alerts in date range that were NOT traded ---
    results["ibkr_only_count"] = len(ibkr_only)
    results["matched_count"] = len(has_holly)

    return results


# ---------------------------------------------------------------------------
# 6. Print & export
# ---------------------------------------------------------------------------

def print_report(analytics: dict, matched: pd.DataFrame):
    """Print human-readable report."""
    print("\n" + "=" * 70)
    print("  IBKR <-> HOLLY TRADE MAPPING REPORT")
    print("=" * 70)

    print(f"\n  Matched trades: {analytics['matched_count']}")
    print(f"  IBKR-only (no Holly alert): {analytics['ibkr_only_count']}")

    if "entry_slippage" in analytics:
        s = analytics["entry_slippage"]
        print(f"\n--- Entry Slippage ({s['n']} trades) ---")
        print(f"  Mean:   ${s['mean_$']:+.4f}  ({s['mean_%']:+.4f}%)")
        print(f"  Median: ${s['median_$']:+.4f}  ({s['median_%']:+.4f}%)")
        if s.get("mean_R") is not None:
            print(f"  Mean R: {s['mean_R']:+.4f}R")

    if "exit_slippage" in analytics:
        s = analytics["exit_slippage"]
        print(f"\n--- Exit Slippage ({s['n']} trades) ---")
        print(f"  Mean:   ${s['mean_$']:+.4f}  ({s['mean_%']:+.4f}%)")
        print(f"  Median: ${s['median_$']:+.4f}  ({s['median_%']:+.4f}%)")

    if "pnl_comparison" in analytics:
        p = analytics["pnl_comparison"]
        print(f"\n--- P&L Comparison ({p['n_trades']} closed trades) ---")
        print(f"  IBKR gross:    ${p['ibkr_total_gross']:+,.2f}")
        print(f"  Commission:    ${p['total_commission']:,.2f}")
        print(f"  IBKR net:      ${p['ibkr_total_net']:+,.2f}")
        print(f"  Holly PnL:     ${p['holly_total']:+,.2f}")
        print(f"  Diff (IBKR-Holly): ${p['pnl_diff_total']:+,.2f}")
        print(f"  IBKR win rate: {p['ibkr_win_rate']:.1%}")
        print(f"  Holly win rate:{p['holly_win_rate']:.1%}")
        print(f"  Same-sign PnL: {p['same_direction_pnl']:.1%}")

    if "commission_impact" in analytics:
        c = analytics["commission_impact"]
        print(f"\n--- Commission Impact ---")
        print(f"  Total commission: ${c['total_commission']:,.2f}")
        print(f"  Per trade:        ${c['commission_per_trade']:,.2f}")
        if c.get("commission_pct_of_gross") is not None:
            print(f"  % of gross P&L:   {c['commission_pct_of_gross']:.2f}%")

    if "by_strategy" in analytics:
        print(f"\n--- By Strategy ---")
        strat_df = analytics["by_strategy"]
        cols = [c for c in ["strategy", "n_matched", "ibkr_net_pnl",
                            "ibkr_win_rate", "holly_pnl", "avg_entry_slip_%"]
                if c in strat_df.columns]
        print(strat_df[cols].to_string(index=False))

    # Per-trade detail
    has_holly = matched[matched["holly_trade_id"].notna()]
    if len(has_holly) > 0:
        print(f"\n--- Per-Trade Detail ---")
        detail_cols = ["symbol", "direction", "strategy",
                       "ibkr_entry_price", "holly_entry_price", "entry_slippage_$",
                       "ibkr_net_pnl", "holly_pnl", "pnl_diff"]
        available = [c for c in detail_cols if c in has_holly.columns]
        print(has_holly[available].to_string(index=False))


def export_reports(matched: pd.DataFrame, analytics: dict):
    """Export CSV reports."""
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    # Full matched detail
    out_path = REPORT_DIR / "ibkr_holly_matched.csv"
    matched.to_csv(out_path, index=False)
    print(f"\n  Exported: {out_path}")

    # Strategy summary
    if "by_strategy" in analytics:
        strat_path = REPORT_DIR / "ibkr_holly_by_strategy.csv"
        analytics["by_strategy"].to_csv(strat_path, index=False)
        print(f"  Exported: {strat_path}")

    # Slippage detail (matched only)
    has_holly = matched[matched["holly_trade_id"].notna()]
    if len(has_holly) > 0:
        slip_path = REPORT_DIR / "slippage_detail.csv"
        slip_cols = ["symbol", "direction", "strategy",
                     "ibkr_entry_time", "ibkr_entry_price",
                     "holly_entry_time", "holly_entry_price",
                     "entry_slippage_$", "entry_slippage_%", "entry_slippage_R",
                     "ibkr_exit_price", "holly_exit_price",
                     "exit_slippage_$", "exit_slippage_%",
                     "time_delta_sec"]
        available = [c for c in slip_cols if c in has_holly.columns]
        has_holly[available].to_csv(slip_path, index=False)
        print(f"  Exported: {slip_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _load_fills(args) -> pd.DataFrame:
    """Load fills from a single CSV or scan a directory for all CSVs."""
    if args.dir:
        csv_dir = Path(args.dir)
        if not csv_dir.is_dir():
            print(f"ERROR: --dir path is not a directory: {csv_dir}")
            sys.exit(1)

        csv_files = sorted(csv_dir.glob("*.csv"))
        if not csv_files:
            print(f"ERROR: No CSV files found in {csv_dir}")
            sys.exit(1)

        print(f"Found {len(csv_files)} CSV files in {csv_dir}")
        all_fills = []
        for f in csv_files:
            try:
                fills = parse_ibkr_fills(f)
                if not fills.empty:
                    all_fills.append(fills)
            except Exception as e:
                print(f"  [WARN] Skipping {f.name}: {e}")

        if not all_fills:
            return pd.DataFrame()
        combined = pd.concat(all_fills, ignore_index=True)
        # Deduplicate by trade_id
        before = len(combined)
        combined = combined.drop_duplicates(subset=["trade_id", "symbol", "fill_time"])
        after = len(combined)
        if before != after:
            print(f"  Deduplicated: {before} -> {after} fills")
        return combined
    else:
        fills_path = Path(args.fills)
        if not fills_path.exists():
            print(f"ERROR: IBKR fills CSV not found at {fills_path}")
            sys.exit(1)
        return parse_ibkr_fills(fills_path)


def main():
    parser = argparse.ArgumentParser(
        description="Map IBKR execution fills to Holly trades"
    )
    parser.add_argument(
        "--fills", type=Path, default=FILLS_CSV,
        help="Path to IBKR Flex Query CSV (default: data/raw/tradersync_fills.csv)"
    )
    parser.add_argument(
        "--dir", type=Path, default=None,
        help="Scan a directory for all IBKR CSV files (overrides --fills)"
    )
    parser.add_argument(
        "--window", type=int, default=5,
        help="Match window in minutes (default: 5)"
    )
    args = parser.parse_args()

    window = timedelta(minutes=args.window)

    # Step 1: Parse fills
    fills = _load_fills(args)
    if fills.empty:
        print("No fills to process.")
        sys.exit(0)

    # Step 2: Group into round trips
    print("\n--- Grouping fills into round-trip trades ---")
    ibkr_trades = group_round_trips(fills)
    if ibkr_trades.empty:
        print("No round trips formed.")
        sys.exit(0)

    # Step 3: Load Holly trades for the relevant date range
    print("\n--- Loading Holly trades ---")
    date_min = fills["fill_time"].min().strftime("%Y-%m-%d")
    date_max = fills["fill_time"].max().strftime("%Y-%m-%d")
    print(f"  IBKR date range: {date_min} to {date_max}")

    db = get_db()
    holly_trades = load_holly_trades(db, date_range=(date_min, date_max))
    holly_all = load_holly_trades(db)
    db.close()

    if holly_trades.empty:
        print(f"\n  WARNING: No Holly trades found for {date_min} to {date_max}.")
        print(f"  IBKR fills may not be Holly-sourced (manual/Finviz/other).")
        print(f"  Holly DB covers: {len(holly_all)} trades total.")

        # Still export the IBKR round trips for reference
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        rt_path = REPORT_DIR / "ibkr_round_trips.csv"
        ibkr_trades.to_csv(rt_path, index=False)
        print(f"\n  Exported IBKR round trips: {rt_path}")
        print("\nDone (no Holly matches).")
        sys.exit(0)

    # Step 4: Match
    print("\n--- Matching IBKR to Holly ---")
    matched = match_ibkr_to_holly(ibkr_trades, holly_trades, window=window)

    if matched.empty:
        print("No matches found.")
        sys.exit(0)

    # Step 5: Analytics
    print("\n--- Computing analytics ---")
    analytics = compute_analytics(matched, holly_all)

    # Step 6: Report
    print_report(analytics, matched)
    export_reports(matched, analytics)

    print("\nDone.")


if __name__ == "__main__":
    main()
