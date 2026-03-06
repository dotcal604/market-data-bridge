"""
Power BI-Optimized Parquet Export

Adds calculated columns and a star-schema-friendly layout for Power BI:
- Pre-computed filter pass/fail flags for slicer-friendly filtering
- Bucketed continuous variables (market cap, hold time, PnL ranges)
- Full stack verdict column
- Descriptive labels instead of raw codes

Run:  python analytics/output/export_powerbi.py
"""

import numpy as np
import pandas as pd
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent
HOLLY_CSV = OUTPUT_DIR.parent / "holly_exit" / "output" / "holly_analytics.csv"
MIN_SECTOR_TRADES = 50

print("Loading data...")
df = pd.read_csv(HOLLY_CSV)
df["entry_dt"] = pd.to_datetime(df["entry_time"])
df["exit_dt"] = pd.to_datetime(df["exit_time"])
df["holly_pnl"] = df["holly_pnl"].fillna(0)
print(f"  {len(df):,} trades, {df.shape[1]} columns")

# ── Pre-computed filter flags (Power BI slicers) ───────────────────────

print("Adding filter flags...")
df["filter_edge"] = (df["prob_edge_verdict"] == "Strong Edge").map({True: "Pass", False: "Fail"})
df["filter_tod"] = df["tod_bucket"].isin(["06:30", "07:00", "07:30", "08:00"]).map({True: "Pass", False: "Fail"})
df["filter_regime"] = df["trend_regime"].isin(["sideways", "downtrend"]).map({True: "Pass", False: "Fail"})
df["filter_sector"] = (
    (df["sector_win_rate"] > 0.52) & (df["sector_trades"] >= MIN_SECTOR_TRADES)
).map({True: "Pass", False: "Fail"})

# Full stack verdict
df["full_stack_verdict"] = "Reject"
full_stack = (
    (df["filter_edge"] == "Pass") &
    (df["filter_tod"] == "Pass") &
    (df["filter_regime"] == "Pass") &
    (df["filter_sector"] == "Pass")
)
df.loc[full_stack, "full_stack_verdict"] = "Accept"

# Count how many filters pass
df["filters_passing"] = (
    (df["filter_edge"] == "Pass").astype(int) +
    (df["filter_tod"] == "Pass").astype(int) +
    (df["filter_regime"] == "Pass").astype(int) +
    (df["filter_sector"] == "Pass").astype(int)
)

# ── Bucketed columns for Power BI grouping ─────────────────────────────

print("Adding bucketed columns...")

# PnL buckets
df["pnl_bucket"] = pd.cut(
    df["holly_pnl"],
    bins=[-np.inf, -5000, -1000, 0, 1000, 5000, np.inf],
    labels=["< -$5K", "-$5K to -$1K", "-$1K to $0", "$0 to $1K", "$1K to $5K", "> $5K"],
)

# Hold time buckets
df["hold_bucket"] = pd.cut(
    df["hold_minutes"],
    bins=[0, 15, 30, 60, 120, 240, np.inf],
    labels=["0-15m", "15-30m", "30-60m", "1-2hr", "2-4hr", "4hr+"],
)

# Market cap buckets
df["mcap_bucket"] = pd.cut(
    df["market_cap"].fillna(0),
    bins=[0, 3e8, 2e9, 1e10, 2e11, np.inf],
    labels=["Micro (<$300M)", "Small ($300M-$2B)", "Mid ($2B-$10B)", "Large ($10B-$200B)", "Mega (>$200B)"],
)

# R-multiple buckets
df["r_bucket"] = pd.cut(
    df["r_multiple"].fillna(0),
    bins=[-np.inf, -2, -1, 0, 1, 2, 3, np.inf],
    labels=["< -2R", "-2R to -1R", "-1R to 0R", "0R to 1R", "1R to 2R", "2R to 3R", "> 3R"],
)

# Win/loss label
df["outcome"] = df["is_winner"].map({True: "Winner", False: "Loser"})

# ── Descriptive labels ─────────────────────────────────────────────────

print("Adding descriptive labels...")
df["edge_label"] = df["prob_edge_verdict"].fillna("Unknown")
df["regime_label"] = df["trend_regime"].fillna("No Data")
df["sector_short"] = df["sector"].str[:40].fillna("Unknown")

# ── Cumulative PnL (for equity curve in Power BI) ──────────────────────

print("Computing cumulative PnL...")
df = df.sort_values("entry_dt")
df["cumulative_pnl"] = df["holly_pnl"].cumsum()
df["trade_number"] = range(1, len(df) + 1)

# ── Export ─────────────────────────────────────────────────────────────

pbi_path = OUTPUT_DIR / "holly_powerbi.parquet"
df.to_parquet(pbi_path, index=False, engine="pyarrow")
print(f"\nExported: {pbi_path}")
print(f"  Size: {pbi_path.stat().st_size / 1024 / 1024:.1f} MB")
print(f"  Columns: {df.shape[1]}")
print(f"  New columns added: filter_edge, filter_tod, filter_regime, filter_sector,")
print(f"    full_stack_verdict, filters_passing, pnl_bucket, hold_bucket,")
print(f"    mcap_bucket, r_bucket, outcome, edge_label, regime_label,")
print(f"    sector_short, cumulative_pnl, trade_number")

# Summary
n_accept = full_stack.sum()
n_total = len(df)
print(f"\n  Full Stack: {n_accept:,} accepted ({n_accept/n_total*100:.1f}%), "
      f"{n_total - n_accept:,} rejected ({(n_total-n_accept)/n_total*100:.1f}%)")
print(f"  Filters passing distribution: {df['filters_passing'].value_counts().sort_index().to_dict()}")

print(f"\nPower BI Usage:")
print(f"  1. Open Power BI Desktop")
print(f"  2. Get Data > Parquet > {pbi_path}")
print(f"  3. Recommended slicers: full_stack_verdict, filter_*, strategy, regime_label, tod_bucket")
print(f"  4. Recommended measures: WR% = DIVIDE(COUNTROWS(FILTER(trades, [outcome]=\"Winner\")), COUNTROWS(trades))")
print(f"  5. Equity curve: Line chart with trade_number on X, cumulative_pnl on Y")
