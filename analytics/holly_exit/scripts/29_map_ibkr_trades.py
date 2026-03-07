"""
29_map_ibkr_trades.py -- Map IBKR executions to Holly trades (3-step architecture).

Architecture:
  Step 1: Execution Normalization
    - Parse IBKR Flex CSV (HEADER/DATA multi-section or flat)
    - Filter to STK + EXECUTION level
    - Cluster partial fills by OrderID → VWAP entry/exit per order
    - Pair opening/closing orders into round-trip positions (FIFO by symbol)

  Step 2: Match Engine
    - Load Holly trades from DuckDB
    - Score candidates by (symbol, direction, date, time proximity, price proximity)
    - Output match confidence (1.0 = exact, 0.5 = ambiguous)
    - Flag low-confidence matches for manual review

  Step 3: Comparison Layer
    - Entry/exit slippage ($ and %)
    - P&L comparison (actual vs Holly theoretical)
    - Coverage (matched / missed / extra)
    - By-strategy breakdown
    - Honest language: "best-matched", not "triggered"

Designed for actual IBKR Flex Query exports:
  - TradeConfirmations_FULL.csv: HEADER,CONF / DATA,CONF rows, 80 cols, all EXECUTION
  - Activity_FULL.csv: HEADER,TRNT / DATA,TRNT rows, 87 cols, mixed LevelOfDetail

Usage:
    python scripts/29_map_ibkr_trades.py --fills path/to/TradeConfirmations_FULL.csv
    python scripts/29_map_ibkr_trades.py --dir path/to/folder/
    python scripts/29_map_ibkr_trades.py --fills path/to/file.csv --window 10
"""

import sys
import csv
import json
import argparse
from pathlib import Path
from datetime import timedelta

import pandas as pd
import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import RAW_DIR, OUTPUT_DIR
from engine.data_loader import get_db

# ── Defaults ──────────────────────────────────────────────────────────────

DEFAULT_FILLS_PATH = RAW_DIR / "TradeConfirmations_FULL.csv"
MATCH_WINDOW_MINUTES = 5
REPORT_DIR = OUTPUT_DIR / "reports" / "trade_mapping"

# Record-type prefixes used in multi-section IBKR CSVs
MULTI_SECTION_TYPES = {"HEADER", "DATA", "EOS", "EOA", "EOF", "BOF", "TRAILER"}

# Minimum match confidence to auto-accept (below this → review queue)
MIN_AUTO_CONFIDENCE = 0.70


# ═══════════════════════════════════════════════════════════════════════════
# STEP 1: EXECUTION NORMALIZATION
# ═══════════════════════════════════════════════════════════════════════════


def _detect_format(path: Path) -> str:
    """Detect flat CSV vs multi-section (HEADER/DATA prefix)."""
    with open(path, "r", encoding="utf-8-sig") as f:
        first_lines = [f.readline() for _ in range(5)]

    for line in first_lines:
        if not line.strip():
            continue
        first_field = line.split(",")[0].strip().strip('"')
        if first_field in MULTI_SECTION_TYPES:
            return "multi_section"
    return "flat"


def _parse_multi_section(path: Path) -> pd.DataFrame:
    """Parse HEADER/DATA multi-section CSV.

    Handles both:
      HEADER,CONF,...  (Trade Confirmations — section type in col 2)
      HEADER,TRNT,...  (Activity Statement — section type in col 2)

    Skips EOS/EOA/EOF footer rows.
    """
    headers = None
    section_type = None
    data_rows = []

    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for row in reader:
            if not row:
                continue
            record = row[0].strip()

            if record == "HEADER" and headers is None:
                # Col 0 = record type, Col 1 = section type, Col 2..N = column names
                section_type = row[1].strip() if len(row) > 1 else "UNKNOWN"
                headers = [c.strip() for c in row[2:]]

            elif record == "DATA":
                # Col 0 = record type, Col 1 = section type, Col 2..N = values
                data_rows.append(row[2:])

            # Skip EOS, EOA, EOF, BOF, TRAILER

    if headers is None:
        print("  WARNING: No HEADER row found.")
        return pd.DataFrame()

    if not data_rows:
        print("  WARNING: No DATA rows found.")
        return pd.DataFrame()

    # Pad/truncate rows to match header length
    clean = []
    for row in data_rows:
        if len(row) >= len(headers):
            clean.append(row[: len(headers)])
        else:
            clean.append(row + [""] * (len(headers) - len(row)))

    df = pd.DataFrame(clean, columns=headers, dtype=str)
    print(f"  Multi-section ({section_type}): {len(df)} rows, {len(headers)} cols")
    return df


def _resolve_col(columns: pd.Index, candidates: list[str]) -> str | None:
    """Find first matching column name (case-insensitive)."""
    col_map = {c.lower().strip(): c for c in columns}
    for c in candidates:
        if c.lower() in col_map:
            return col_map[c.lower()]
    return None


def _parse_ibkr_datetime(val: str) -> pd.Timestamp | None:
    """Parse '20250324;093138' or ISO datetime."""
    if not val or val.lower() == "nan":
        return None
    try:
        if ";" in val:
            d, t = val.split(";")
            return pd.Timestamp(
                year=int(d[:4]), month=int(d[4:6]), day=int(d[6:8]),
                hour=int(t[:2]), minute=int(t[2:4]),
                second=int(t[4:6]) if len(t) >= 6 else 0,
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


def parse_fills(path: Path) -> pd.DataFrame:
    """Parse IBKR Flex Query CSV into a clean fills DataFrame.

    Handles both flat and multi-section formats.
    Filters to STK + EXECUTION only.
    """
    print(f"\nReading IBKR fills: {path.name}")
    fmt = _detect_format(path)
    print(f"  Format: {fmt}")

    if fmt == "multi_section":
        raw = _parse_multi_section(path)
    else:
        raw = pd.read_csv(path, dtype=str, encoding="utf-8-sig")
        raw.columns = [c.strip() for c in raw.columns]
        print(f"  Flat CSV: {len(raw)} rows, {len(raw.columns)} cols")

    if raw.empty:
        return pd.DataFrame()

    # Resolve column names (IBKR uses different names across report types)
    cols = raw.columns
    C = {
        "symbol": _resolve_col(cols, ["Symbol", "UnderlyingSymbol"]),
        "datetime": _resolve_col(cols, ["Date/Time", "DateTime", "TradeDate"]),
        "buy_sell": _resolve_col(cols, ["Buy/Sell", "Side"]),
        "quantity": _resolve_col(cols, ["Quantity", "TradedQuantity"]),
        "price": _resolve_col(cols, ["Price", "TradePrice", "T. Price"]),
        "commission": _resolve_col(cols, ["Commission", "IBCommission"]),
        "code": _resolve_col(cols, ["Code", "Open/CloseIndicator"]),
        "order_id": _resolve_col(cols, ["OrderID", "IBOrderID"]),
        "trade_id": _resolve_col(cols, ["TradeID", "TransactionID"]),
        "asset_class": _resolve_col(cols, ["AssetClass", "SecurityType"]),
        "level": _resolve_col(cols, ["LevelOfDetail"]),
        "proceeds": _resolve_col(cols, ["Proceeds", "NetCash"]),
        "currency": _resolve_col(cols, ["CurrencyPrimary", "Currency"]),
        "exchange": _resolve_col(cols, ["Exchange"]),
        "order_type": _resolve_col(cols, ["OrderType"]),
    }

    # Filter to EXECUTION level only (Activity files have ORDER, CLOSED_LOT, etc.)
    if C["level"] and C["level"] in raw.columns:
        before = len(raw)
        raw = raw[raw[C["level"]] == "EXECUTION"]
        if len(raw) < before:
            print(f"  Filtered to EXECUTION: {before} → {len(raw)} rows")

    # Filter to STK only
    if C["asset_class"] and C["asset_class"] in raw.columns:
        before = len(raw)
        raw = raw[raw[C["asset_class"]].str.strip().str.upper() == "STK"]
        if len(raw) < before:
            print(f"  Filtered to STK: {before} → {len(raw)} rows")

    fills = []
    for _, row in raw.iterrows():
        sym = str(row.get(C["symbol"], "")).strip()
        if not sym:
            continue

        dt = _parse_ibkr_datetime(str(row.get(C["datetime"], "")))
        if dt is None:
            continue

        buy_sell = str(row.get(C["buy_sell"], "")).strip().upper()
        qty = _safe_float(row.get(C["quantity"]))
        price = _safe_float(row.get(C["price"]))
        if price is None or qty is None:
            continue

        code = str(row.get(C["code"], "")).strip() if C["code"] else ""
        code_parts = set(code.upper().split(";"))

        fills.append({
            "symbol": sym,
            "fill_time": dt,
            "buy_sell": buy_sell,
            "quantity": abs(qty),
            "price": price,
            "commission": abs(_safe_float(row.get(C["commission"])) or 0.0),
            "proceeds": _safe_float(row.get(C["proceeds"])) or 0.0,
            "code": code,
            "is_opening": "O" in code_parts,
            "is_closing": "C" in code_parts,
            "is_partial": "P" in code_parts,
            "is_daytrade": "D" in code_parts,
            "order_id": str(row.get(C["order_id"], "")).strip(),
            "trade_id": str(row.get(C["trade_id"], "")).strip(),
            "currency": str(row.get(C["currency"], "")).strip() if C["currency"] else "",
            "exchange": str(row.get(C["exchange"], "")).strip() if C["exchange"] else "",
            "order_type": str(row.get(C["order_type"], "")).strip() if C["order_type"] else "",
        })

    df = pd.DataFrame(fills)
    if df.empty:
        print("  WARNING: No valid fills parsed.")
        return df

    df = df.sort_values(["symbol", "fill_time"]).reset_index(drop=True)
    buys = (df["buy_sell"] == "BUY").sum()
    sells = (df["buy_sell"] == "SELL").sum()
    print(f"  Parsed: {len(df)} fills, {df['symbol'].nunique()} symbols, "
          f"{buys} buys / {sells} sells")

    return df


def cluster_by_order(fills: pd.DataFrame) -> pd.DataFrame:
    """Cluster partial fills by OrderID → one row per logical order with VWAP price.

    Each OrderID represents one logical order that may have been filled
    across multiple exchanges in partial lots.

    Output columns: symbol, order_time, buy_sell, total_shares, vwap_price,
                    total_commission, n_fills, order_id, code, is_opening, is_closing
    """
    if fills.empty:
        return pd.DataFrame()

    orders = []
    for order_id, grp in fills.groupby("order_id"):
        if not order_id or order_id == "nan":
            # No OrderID — treat each fill as its own order
            for _, fill in grp.iterrows():
                orders.append({
                    "symbol": fill["symbol"],
                    "order_time": fill["fill_time"],
                    "buy_sell": fill["buy_sell"],
                    "total_shares": fill["quantity"],
                    "vwap_price": fill["price"],
                    "total_commission": fill["commission"],
                    "n_fills": 1,
                    "order_id": order_id,
                    "is_opening": fill["is_opening"],
                    "is_closing": fill["is_closing"],
                    "currency": fill["currency"],
                    "exchanges": fill["exchange"],
                    "order_type": fill["order_type"],
                })
            continue

        # VWAP = sum(price * quantity) / sum(quantity)
        prices = grp["price"].values
        qtys = grp["quantity"].values
        total_qty = qtys.sum()
        vwap = (prices * qtys).sum() / total_qty if total_qty > 0 else prices.mean()

        orders.append({
            "symbol": grp["symbol"].iloc[0],
            "order_time": grp["fill_time"].min(),  # earliest fill
            "buy_sell": grp["buy_sell"].iloc[0],
            "total_shares": total_qty,
            "vwap_price": round(vwap, 6),
            "total_commission": grp["commission"].sum(),
            "n_fills": len(grp),
            "order_id": order_id,
            "is_opening": grp["is_opening"].any(),
            "is_closing": grp["is_closing"].any(),
            "currency": grp["currency"].iloc[0],
            "exchanges": ",".join(sorted(grp["exchange"].unique())),
            "order_type": grp["order_type"].iloc[0],
        })

    df = pd.DataFrame(orders)
    partial = (df["n_fills"] > 1).sum()
    print(f"\n  Clustered: {len(fills)} fills → {len(df)} orders "
          f"({partial} had partial fills, avg {fills.shape[0]/len(df):.1f} fills/order)")
    return df


def pair_round_trips(orders: pd.DataFrame) -> pd.DataFrame:
    """Pair opening orders with closing orders into round-trip positions.

    Uses Code column (O=open, C=close) and FIFO matching within each symbol.
    """
    if orders.empty:
        return pd.DataFrame()

    trips = []

    for symbol, sym_orders in orders.groupby("symbol"):
        sym_orders = sym_orders.sort_values("order_time").reset_index(drop=True)

        opens = sym_orders[sym_orders["is_opening"]].copy()
        closes = sym_orders[sym_orders["is_closing"]].copy()
        used_close = set()

        for oidx, open_ord in opens.iterrows():
            # Find earliest unmatched close after this open
            matched_close = None
            for cidx, close_ord in closes.iterrows():
                if cidx in used_close:
                    continue
                if close_ord["order_time"] >= open_ord["order_time"]:
                    matched_close = close_ord
                    used_close.add(cidx)
                    break

            direction = "Long" if open_ord["buy_sell"] == "BUY" else "Short"

            trip = {
                "symbol": symbol,
                "direction": direction,
                "entry_time": open_ord["order_time"],
                "entry_price": open_ord["vwap_price"],
                "entry_shares": open_ord["total_shares"],
                "entry_commission": open_ord["total_commission"],
                "entry_fills": open_ord["n_fills"],
                "entry_order_id": open_ord["order_id"],
                "entry_order_type": open_ord["order_type"],
                "entry_exchanges": open_ord["exchanges"],
                "currency": open_ord["currency"],
            }

            if matched_close is not None:
                trip["exit_time"] = matched_close["order_time"]
                trip["exit_price"] = matched_close["vwap_price"]
                trip["exit_shares"] = matched_close["total_shares"]
                trip["exit_commission"] = matched_close["total_commission"]
                trip["exit_fills"] = matched_close["n_fills"]
                trip["exit_order_id"] = matched_close["order_id"]
                trip["exit_order_type"] = matched_close["order_type"]
                trip["total_commission"] = (open_ord["total_commission"]
                                            + matched_close["total_commission"])
                hold = (matched_close["order_time"] - open_ord["order_time"])
                trip["hold_seconds"] = hold.total_seconds()
                trip["hold_minutes"] = hold.total_seconds() / 60

                shares = min(open_ord["total_shares"], matched_close["total_shares"])
                if direction == "Long":
                    gross = (matched_close["vwap_price"] - open_ord["vwap_price"]) * shares
                else:
                    gross = (open_ord["vwap_price"] - matched_close["vwap_price"]) * shares

                trip["gross_pnl"] = round(gross, 2)
                trip["net_pnl"] = round(gross - trip["total_commission"], 2)
                trip["status"] = "closed"
            else:
                trip.update({
                    "exit_time": None, "exit_price": None, "exit_shares": None,
                    "exit_commission": 0.0, "exit_fills": 0, "exit_order_id": None,
                    "exit_order_type": None,
                    "total_commission": open_ord["total_commission"],
                    "hold_seconds": None, "hold_minutes": None,
                    "gross_pnl": None, "net_pnl": None, "status": "open",
                })

            trips.append(trip)

    df = pd.DataFrame(trips)
    if df.empty:
        print("  WARNING: No round trips formed.")
        return df

    closed = df[df["status"] == "closed"]
    print(f"\n  Positions: {len(df)} ({len(closed)} closed, {len(df)-len(closed)} open)")
    if len(closed) > 0:
        w = (closed["net_pnl"] > 0).sum()
        l = (closed["net_pnl"] <= 0).sum()
        pnl = closed["net_pnl"].sum()
        comm = closed["total_commission"].sum()
        print(f"  W/L: {w}/{l}, Net P&L: ${pnl:,.2f}, Commission: ${comm:,.2f}")

    return df


# ═══════════════════════════════════════════════════════════════════════════
# STEP 2: MATCH ENGINE
# ═══════════════════════════════════════════════════════════════════════════


def load_holly_trades(db, date_range: tuple[str, str] | None = None) -> pd.DataFrame:
    """Load Holly trades from DuckDB, optionally filtered to date range."""
    where = ""
    if date_range:
        where = (f"WHERE CAST(entry_time AS DATE) >= '{date_range[0]}' "
                 f"AND CAST(entry_time AS DATE) <= '{date_range[1]}'")

    query = f"""
        SELECT
            trade_id, symbol, strategy, direction,
            entry_time, entry_price, exit_time, exit_price,
            stop_price, target_price, shares, holly_pnl,
            real_entry_price, real_entry_time
        FROM trades
        {where}
        ORDER BY entry_time
    """
    df = db.execute(query).fetchdf()
    df["entry_time"] = pd.to_datetime(df["entry_time"])
    if "exit_time" in df.columns:
        df["exit_time"] = pd.to_datetime(df["exit_time"], errors="coerce")
    print(f"  Holly trades loaded: {len(df)}")
    return df


def _score_match(
    ibkr_time: pd.Timestamp,
    ibkr_price: float,
    ibkr_direction: str,
    holly_time: pd.Timestamp,
    holly_price: float,
    holly_direction: str,
    window: timedelta,
) -> float:
    """Score a candidate match on [0, 1].

    Components:
      - Time proximity:  1.0 if same minute, decays linearly to 0 at window edge
      - Price proximity:  1.0 if within 0.1%, decays to 0.5 at 1%, 0 at 5%
      - Direction match:  0 if wrong direction (hard reject)
    """
    # Direction must match
    if ibkr_direction != holly_direction:
        return 0.0

    # Time score: linear decay from 1.0 at 0 minutes to 0.0 at window
    time_delta = abs(ibkr_time - holly_time)
    if time_delta > window:
        return 0.0
    time_score = 1.0 - (time_delta.total_seconds() / window.total_seconds())

    # Price score: how close are entry prices?
    if holly_price > 0:
        price_diff_pct = abs(ibkr_price - holly_price) / holly_price * 100
        if price_diff_pct <= 0.1:
            price_score = 1.0
        elif price_diff_pct <= 1.0:
            price_score = 1.0 - (price_diff_pct - 0.1) / 0.9 * 0.5  # 1.0 → 0.5
        elif price_diff_pct <= 5.0:
            price_score = 0.5 - (price_diff_pct - 1.0) / 4.0 * 0.5  # 0.5 → 0.0
        else:
            price_score = 0.0
    else:
        price_score = 0.5  # can't score price, neutral

    # Weighted combination: time 60%, price 40%
    return round(time_score * 0.6 + price_score * 0.4, 4)


def match_positions_to_holly(
    positions: pd.DataFrame,
    holly: pd.DataFrame,
    window: timedelta,
) -> pd.DataFrame:
    """Match IBKR positions to Holly trades with confidence scoring.

    For each IBKR position:
      1. Find all Holly candidates: same symbol, same direction, within window
      2. Score each candidate
      3. Accept best if above MIN_AUTO_CONFIDENCE
      4. Flag ambiguous/low-confidence for review

    Categories:
      - matched:     IBKR position best-matched to Holly alert
      - ibkr_only:   IBKR position with no Holly candidate
      - holly_missed: Holly alert with no IBKR match (computed after)
    """
    if positions.empty or holly.empty:
        print("  No data to match.")
        return pd.DataFrame()

    results = []
    holly_used = set()

    for _, pos in positions.iterrows():
        sym = pos["symbol"]
        direction = pos["direction"]
        entry_t = pos["entry_time"]
        entry_p = pos["entry_price"]

        # Find candidates
        candidates = holly[
            (holly["symbol"] == sym)
            & (holly["direction"] == direction)
            & (~holly["trade_id"].isin(holly_used))
        ]

        best = None
        best_score = 0.0
        n_candidates = 0

        for _, h in candidates.iterrows():
            score = _score_match(
                entry_t, entry_p, direction,
                h["entry_time"], h["entry_price"], h["direction"],
                window,
            )
            if score > 0:
                n_candidates += 1
                if score > best_score:
                    best = h
                    best_score = score

        row = {
            # IBKR side
            "symbol": sym,
            "direction": direction,
            "ibkr_entry_time": entry_t,
            "ibkr_entry_price": entry_p,
            "ibkr_exit_time": pos["exit_time"],
            "ibkr_exit_price": pos["exit_price"],
            "ibkr_shares": pos["entry_shares"],
            "ibkr_gross_pnl": pos["gross_pnl"],
            "ibkr_net_pnl": pos["net_pnl"],
            "ibkr_commission": pos["total_commission"],
            "ibkr_hold_minutes": pos["hold_minutes"],
            "ibkr_entry_fills": pos["entry_fills"],
            "ibkr_exit_fills": pos.get("exit_fills", 0),
            "ibkr_entry_order_type": pos["entry_order_type"],
            "ibkr_status": pos["status"],
            "currency": pos["currency"],
        }

        if best is not None and best_score >= MIN_AUTO_CONFIDENCE:
            holly_used.add(best["trade_id"])

            # Slippage
            entry_slip = entry_p - best["entry_price"]
            entry_slip_pct = entry_slip / best["entry_price"] * 100 if best["entry_price"] else None

            exit_slip = None
            exit_slip_pct = None
            if pos["exit_price"] is not None and pd.notna(best["exit_price"]):
                exit_slip = pos["exit_price"] - best["exit_price"]
                exit_slip_pct = exit_slip / best["exit_price"] * 100

            # Risk in R
            risk = None
            entry_slip_r = None
            if pd.notna(best.get("stop_price")) and best["entry_price"] > 0:
                risk = abs(best["entry_price"] - best["stop_price"])
                if risk > 0:
                    entry_slip_r = entry_slip / risk

            row.update({
                "category": "matched",
                "match_confidence": best_score,
                "n_candidates": n_candidates,
                "holly_trade_id": best["trade_id"],
                "strategy": best["strategy"],
                "holly_entry_time": best["entry_time"],
                "holly_entry_price": best["entry_price"],
                "holly_exit_time": best["exit_time"],
                "holly_exit_price": best["exit_price"],
                "holly_stop_price": best["stop_price"],
                "holly_target_price": best["target_price"],
                "holly_shares": best["shares"],
                "holly_pnl": best["holly_pnl"],
                "entry_slippage_$": round(entry_slip, 4) if entry_slip is not None else None,
                "entry_slippage_%": round(entry_slip_pct, 4) if entry_slip_pct is not None else None,
                "entry_slippage_R": round(entry_slip_r, 4) if entry_slip_r is not None else None,
                "exit_slippage_$": round(exit_slip, 4) if exit_slip is not None else None,
                "exit_slippage_%": round(exit_slip_pct, 4) if exit_slip_pct is not None else None,
                "time_delta_sec": abs(entry_t - best["entry_time"]).total_seconds(),
                "risk_per_share": risk,
                "pnl_diff": (
                    round(pos["net_pnl"] - best["holly_pnl"], 2)
                    if pos["net_pnl"] is not None and pd.notna(best["holly_pnl"])
                    else None
                ),
            })
        elif best is not None:
            # Low confidence — flag for review
            row.update({
                "category": "review",
                "match_confidence": best_score,
                "n_candidates": n_candidates,
                "holly_trade_id": best["trade_id"],
                "strategy": best["strategy"],
                "holly_entry_time": best["entry_time"],
                "holly_entry_price": best["entry_price"],
                "holly_exit_time": None, "holly_exit_price": None,
                "holly_stop_price": None, "holly_target_price": None,
                "holly_shares": None, "holly_pnl": None,
                "entry_slippage_$": None, "entry_slippage_%": None,
                "entry_slippage_R": None, "exit_slippage_$": None,
                "exit_slippage_%": None,
                "time_delta_sec": abs(entry_t - best["entry_time"]).total_seconds(),
                "risk_per_share": None, "pnl_diff": None,
            })
        else:
            # No match at all
            row.update({
                "category": "ibkr_only",
                "match_confidence": 0.0,
                "n_candidates": 0,
                "holly_trade_id": None, "strategy": None,
                "holly_entry_time": None, "holly_entry_price": None,
                "holly_exit_time": None, "holly_exit_price": None,
                "holly_stop_price": None, "holly_target_price": None,
                "holly_shares": None, "holly_pnl": None,
                "entry_slippage_$": None, "entry_slippage_%": None,
                "entry_slippage_R": None, "exit_slippage_$": None,
                "exit_slippage_%": None,
                "time_delta_sec": None, "risk_per_share": None, "pnl_diff": None,
            })

        results.append(row)

    df = pd.DataFrame(results)
    cats = df["category"].value_counts()
    print(f"\n  Match results:")
    for cat, count in cats.items():
        print(f"    {cat}: {count}")

    if "matched" in cats.index:
        matched = df[df["category"] == "matched"]
        conf = matched["match_confidence"]
        print(f"    Confidence: mean={conf.mean():.3f}, min={conf.min():.3f}, max={conf.max():.3f}")

    return df


# ═══════════════════════════════════════════════════════════════════════════
# STEP 3: COMPARISON LAYER
# ═══════════════════════════════════════════════════════════════════════════


def compute_analytics(matched: pd.DataFrame, holly_all: pd.DataFrame,
                      positions: pd.DataFrame) -> dict:
    """Compute slippage, P&L comparison, coverage analytics."""
    results = {}

    confirmed = matched[matched["category"] == "matched"].copy()
    ibkr_only = matched[matched["category"] == "ibkr_only"].copy()
    review = matched[matched["category"] == "review"].copy()

    results["summary"] = {
        "total_ibkr_positions": len(matched),
        "matched": len(confirmed),
        "ibkr_only": len(ibkr_only),
        "review_queue": len(review),
        "total_holly_alerts": len(holly_all),
    }

    # Holly coverage: how many Holly alerts in the IBKR date range were traded?
    if len(positions) > 0 and len(holly_all) > 0:
        date_min = positions["entry_time"].min()
        date_max = positions["entry_time"].max()
        holly_in_range = holly_all[
            holly_all["entry_time"].between(
                date_min - timedelta(minutes=MATCH_WINDOW_MINUTES),
                date_max + timedelta(minutes=MATCH_WINDOW_MINUTES),
            )
        ]
        holly_matched_ids = set(confirmed["holly_trade_id"].dropna())
        holly_missed = holly_in_range[~holly_in_range["trade_id"].isin(holly_matched_ids)]

        results["coverage"] = {
            "holly_in_range": len(holly_in_range),
            "holly_matched": len(holly_matched_ids),
            "holly_missed": len(holly_missed),
            "coverage_pct": round(
                len(holly_matched_ids) / len(holly_in_range) * 100, 1
            ) if len(holly_in_range) > 0 else 0,
        }

    # Entry slippage
    if len(confirmed) > 0:
        slip = confirmed[confirmed["entry_slippage_$"].notna()]
        if len(slip) > 0:
            results["entry_slippage"] = {
                "n": len(slip),
                "mean_$": round(slip["entry_slippage_$"].mean(), 4),
                "median_$": round(slip["entry_slippage_$"].median(), 4),
                "mean_%": round(slip["entry_slippage_%"].mean(), 4),
                "median_%": round(slip["entry_slippage_%"].median(), 4),
                "mean_R": round(slip["entry_slippage_R"].dropna().mean(), 4)
                    if slip["entry_slippage_R"].notna().any() else None,
            }

        exit_slip = confirmed[confirmed["exit_slippage_$"].notna()]
        if len(exit_slip) > 0:
            results["exit_slippage"] = {
                "n": len(exit_slip),
                "mean_$": round(exit_slip["exit_slippage_$"].mean(), 4),
                "median_$": round(exit_slip["exit_slippage_$"].median(), 4),
                "mean_%": round(exit_slip["exit_slippage_%"].mean(), 4),
                "median_%": round(exit_slip["exit_slippage_%"].median(), 4),
            }

    # P&L comparison
    closed = confirmed[
        (confirmed["ibkr_status"] == "closed")
        & confirmed["holly_pnl"].notna()
        & confirmed["ibkr_net_pnl"].notna()
    ]
    if len(closed) > 0:
        results["pnl"] = {
            "n_trades": len(closed),
            "ibkr_gross": round(closed["ibkr_gross_pnl"].sum(), 2),
            "ibkr_commission": round(closed["ibkr_commission"].sum(), 2),
            "ibkr_net": round(closed["ibkr_net_pnl"].sum(), 2),
            "holly_total": round(closed["holly_pnl"].sum(), 2),
            "diff_total": round(closed["pnl_diff"].sum(), 2),
            "diff_mean": round(closed["pnl_diff"].mean(), 2),
            "ibkr_win_rate": round((closed["ibkr_net_pnl"] > 0).mean(), 4),
            "holly_win_rate": round((closed["holly_pnl"] > 0).mean(), 4),
            "same_sign": round(
                ((closed["ibkr_net_pnl"] > 0) == (closed["holly_pnl"] > 0)).mean(), 4
            ),
        }

    # By-strategy breakdown
    if len(confirmed) > 0 and "strategy" in confirmed.columns:
        strats = []
        for strat, grp in confirmed.groupby("strategy"):
            cl = grp[grp["ibkr_status"] == "closed"]
            row = {"strategy": strat, "n_matched": len(grp), "n_closed": len(cl)}
            if len(cl) > 0 and cl["ibkr_net_pnl"].notna().any():
                row["ibkr_net_pnl"] = round(cl["ibkr_net_pnl"].sum(), 2)
                row["ibkr_wr"] = round((cl["ibkr_net_pnl"] > 0).mean(), 4)
            if len(cl) > 0 and cl["holly_pnl"].notna().any():
                row["holly_pnl"] = round(cl["holly_pnl"].sum(), 2)
                row["holly_wr"] = round((cl["holly_pnl"] > 0).mean(), 4)
            if grp["entry_slippage_%"].notna().any():
                row["avg_slip_%"] = round(grp["entry_slippage_%"].mean(), 4)
            if grp["match_confidence"].notna().any():
                row["avg_confidence"] = round(grp["match_confidence"].mean(), 3)
            strats.append(row)
        results["by_strategy"] = pd.DataFrame(strats).sort_values(
            "n_matched", ascending=False
        )

    # Commission impact
    if len(confirmed) > 0:
        comm = confirmed["ibkr_commission"].sum()
        gross = confirmed["ibkr_gross_pnl"].dropna().sum()
        results["commission"] = {
            "total": round(comm, 2),
            "per_trade": round(comm / len(confirmed), 2),
            "pct_of_gross": round(comm / abs(gross) * 100, 2) if gross != 0 else None,
        }

    return results


def print_report(analytics: dict, matched: pd.DataFrame):
    """Print human-readable report."""
    print("\n" + "=" * 70)
    print("  IBKR ↔ HOLLY TRADE MAPPING REPORT")
    print("  (matches are best-candidate, not confirmed causal links)")
    print("=" * 70)

    s = analytics.get("summary", {})
    print(f"\n  IBKR positions:   {s.get('total_ibkr_positions', 0)}")
    print(f"  Best-matched:     {s.get('matched', 0)}")
    print(f"  IBKR-only:        {s.get('ibkr_only', 0)}")
    print(f"  Review queue:     {s.get('review_queue', 0)}")

    if "coverage" in analytics:
        c = analytics["coverage"]
        print(f"\n--- Holly Coverage ---")
        print(f"  Holly alerts in date range: {c['holly_in_range']}")
        print(f"  Best-matched to IBKR:       {c['holly_matched']}")
        print(f"  Holly alerts NOT traded:     {c['holly_missed']}")
        print(f"  Coverage:                    {c['coverage_pct']:.1f}%")

    if "entry_slippage" in analytics:
        e = analytics["entry_slippage"]
        print(f"\n--- Entry Slippage ({e['n']} trades) ---")
        print(f"  Mean:   ${e['mean_$']:+.4f}  ({e['mean_%']:+.4f}%)")
        print(f"  Median: ${e['median_$']:+.4f}  ({e['median_%']:+.4f}%)")
        if e.get("mean_R") is not None:
            print(f"  Mean R: {e['mean_R']:+.4f}R")

    if "exit_slippage" in analytics:
        x = analytics["exit_slippage"]
        print(f"\n--- Exit Slippage ({x['n']} trades) ---")
        print(f"  Mean:   ${x['mean_$']:+.4f}  ({x['mean_%']:+.4f}%)")
        print(f"  Median: ${x['median_$']:+.4f}  ({x['median_%']:+.4f}%)")

    if "pnl" in analytics:
        p = analytics["pnl"]
        print(f"\n--- P&L Comparison ({p['n_trades']} closed, best-matched trades) ---")
        print(f"  IBKR gross:        ${p['ibkr_gross']:+,.2f}")
        print(f"  Commission:        ${p['ibkr_commission']:,.2f}")
        print(f"  IBKR net:          ${p['ibkr_net']:+,.2f}")
        print(f"  Holly theoretical: ${p['holly_total']:+,.2f}")
        print(f"  Diff (IBKR−Holly): ${p['diff_total']:+,.2f}")
        print(f"  IBKR win rate:     {p['ibkr_win_rate']:.1%}")
        print(f"  Holly win rate:    {p['holly_win_rate']:.1%}")
        print(f"  Same-sign P&L:     {p['same_sign']:.1%}")

    if "commission" in analytics:
        c = analytics["commission"]
        print(f"\n--- Commission Impact ---")
        print(f"  Total:       ${c['total']:,.2f}")
        print(f"  Per trade:   ${c['per_trade']:,.2f}")
        if c.get("pct_of_gross") is not None:
            print(f"  % of gross:  {c['pct_of_gross']:.2f}%")

    if "by_strategy" in analytics:
        print(f"\n--- By Strategy ---")
        strat = analytics["by_strategy"]
        cols = [c for c in ["strategy", "n_matched", "ibkr_net_pnl", "ibkr_wr",
                            "holly_pnl", "avg_slip_%", "avg_confidence"]
                if c in strat.columns]
        print(strat[cols].to_string(index=False))


def export_reports(matched: pd.DataFrame, analytics: dict, positions: pd.DataFrame):
    """Export CSV + JSON reports."""
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    # Full detail
    out = REPORT_DIR / "ibkr_holly_matched.csv"
    matched.to_csv(out, index=False)
    print(f"\n  Exported: {out}")

    # Review queue
    review = matched[matched["category"] == "review"]
    if len(review) > 0:
        rq = REPORT_DIR / "review_queue.csv"
        review.to_csv(rq, index=False)
        print(f"  Exported: {rq} ({len(review)} trades need manual review)")

    # IBKR round trips (all, before matching)
    rt = REPORT_DIR / "ibkr_round_trips.csv"
    positions.to_csv(rt, index=False)
    print(f"  Exported: {rt}")

    # Strategy summary
    if "by_strategy" in analytics:
        sp = REPORT_DIR / "ibkr_holly_by_strategy.csv"
        analytics["by_strategy"].to_csv(sp, index=False)
        print(f"  Exported: {sp}")

    # Slippage detail
    confirmed = matched[matched["category"] == "matched"]
    if len(confirmed) > 0:
        sl = REPORT_DIR / "slippage_detail.csv"
        cols = [c for c in [
            "symbol", "direction", "strategy", "match_confidence",
            "ibkr_entry_time", "ibkr_entry_price",
            "holly_entry_time", "holly_entry_price",
            "entry_slippage_$", "entry_slippage_%", "entry_slippage_R",
            "ibkr_exit_price", "holly_exit_price",
            "exit_slippage_$", "exit_slippage_%",
            "time_delta_sec",
        ] if c in confirmed.columns]
        confirmed[cols].to_csv(sl, index=False)
        print(f"  Exported: {sl}")

    # Analytics JSON
    json_out = REPORT_DIR / "analytics_summary.json"
    # Convert non-serializable types
    clean = {}
    for k, v in analytics.items():
        if isinstance(v, pd.DataFrame):
            clean[k] = v.to_dict(orient="records")
        elif isinstance(v, dict):
            clean[k] = {
                kk: (float(vv) if isinstance(vv, (np.floating, np.integer)) else vv)
                for kk, vv in v.items()
            }
        else:
            clean[k] = v
    with open(json_out, "w") as f:
        json.dump(clean, f, indent=2, default=str)
    print(f"  Exported: {json_out}")


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════


def _load_fills(args) -> pd.DataFrame:
    """Load fills from single CSV or scan directory."""
    if args.dir:
        csv_dir = Path(args.dir)
        if not csv_dir.is_dir():
            print(f"ERROR: {csv_dir} is not a directory"); sys.exit(1)
        csv_files = sorted(csv_dir.glob("*.csv"))
        if not csv_files:
            print(f"ERROR: No CSVs in {csv_dir}"); sys.exit(1)

        print(f"Found {len(csv_files)} CSV files in {csv_dir}")
        all_fills = []
        for f in csv_files:
            try:
                fills = parse_fills(f)
                if not fills.empty:
                    all_fills.append(fills)
            except Exception as e:
                print(f"  [WARN] Skipping {f.name}: {e}")

        if not all_fills:
            return pd.DataFrame()
        combined = pd.concat(all_fills, ignore_index=True)
        before = len(combined)
        combined = combined.drop_duplicates(subset=["trade_id", "symbol", "fill_time"])
        if len(combined) < before:
            print(f"  Deduplicated: {before} → {len(combined)}")
        return combined
    else:
        p = Path(args.fills)
        if not p.exists():
            print(f"ERROR: {p} not found"); sys.exit(1)
        return parse_fills(p)


def main():
    parser = argparse.ArgumentParser(description="Map IBKR fills to Holly trades")
    parser.add_argument("--fills", type=Path, default=DEFAULT_FILLS_PATH,
                        help="IBKR Flex Query CSV path")
    parser.add_argument("--dir", type=Path, default=None,
                        help="Scan directory for all IBKR CSVs")
    parser.add_argument("--window", type=int, default=MATCH_WINDOW_MINUTES,
                        help=f"Match window in minutes (default: {MATCH_WINDOW_MINUTES})")
    parser.add_argument("--no-holly", action="store_true",
                        help="Skip Holly matching, just normalize IBKR fills")
    args = parser.parse_args()

    window = timedelta(minutes=args.window)

    # ── Step 1: Execution Normalization ──
    print("=" * 70)
    print("  STEP 1: EXECUTION NORMALIZATION")
    print("=" * 70)

    fills = _load_fills(args)
    if fills.empty:
        print("No fills to process."); sys.exit(0)

    orders = cluster_by_order(fills)
    positions = pair_round_trips(orders)
    if positions.empty:
        print("No positions formed."); sys.exit(0)

    if args.no_holly:
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        positions.to_csv(REPORT_DIR / "ibkr_round_trips.csv", index=False)
        print(f"\n  Exported: {REPORT_DIR / 'ibkr_round_trips.csv'}")
        print("\nDone (--no-holly, skipped matching).")
        sys.exit(0)

    # ── Step 2: Match Engine ──
    print("\n" + "=" * 70)
    print("  STEP 2: MATCH ENGINE")
    print("=" * 70)

    date_min = fills["fill_time"].min().strftime("%Y-%m-%d")
    date_max = fills["fill_time"].max().strftime("%Y-%m-%d")
    print(f"  IBKR date range: {date_min} to {date_max}")

    db = get_db()
    holly_range = load_holly_trades(db, date_range=(date_min, date_max))
    holly_all = load_holly_trades(db)
    db.close()

    if holly_range.empty:
        print(f"\n  WARNING: No Holly trades for {date_min} to {date_max}.")
        print(f"  Holly DB: {len(holly_all)} trades total.")
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        positions.to_csv(REPORT_DIR / "ibkr_round_trips.csv", index=False)
        print(f"  Exported: {REPORT_DIR / 'ibkr_round_trips.csv'}")
        print("\nDone (no Holly matches in date range).")
        sys.exit(0)

    matched = match_positions_to_holly(positions, holly_range, window)

    # ── Step 3: Comparison Layer ──
    print("\n" + "=" * 70)
    print("  STEP 3: COMPARISON LAYER")
    print("=" * 70)

    analytics = compute_analytics(matched, holly_all, positions)
    print_report(analytics, matched)
    export_reports(matched, analytics, positions)

    print("\nDone.")


if __name__ == "__main__":
    main()
