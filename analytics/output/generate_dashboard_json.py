"""
Generate pre-computed dashboard JSON for the Next.js analytics route.

Reads holly_analytics.csv and produces holly_dashboard.json with all
aggregations pre-computed so the frontend doesn't need to crunch 28K rows.

Run:  python analytics/output/generate_dashboard_json.py
"""

import json
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
df = df.sort_values("entry_dt").reset_index(drop=True)
print(f"  {len(df):,} trades, {df.shape[1]} columns")

result = {}

# -- Overview --
winners = df["holly_pnl"] > 0
losers = df["holly_pnl"] <= 0
pf = df.loc[winners, "holly_pnl"].sum() / abs(df.loc[losers, "holly_pnl"].sum()) if losers.any() else 0
sharpe = df["holly_pnl"].mean() / df["holly_pnl"].std() * np.sqrt(252) if df["holly_pnl"].std() > 0 else 0

result["overview"] = {
    "total_trades": int(len(df)),
    "win_rate": round(df["is_winner"].mean() * 100, 1),
    "avg_pnl": round(df["holly_pnl"].mean(), 0),
    "total_pnl": round(df["holly_pnl"].sum(), 0),
    "sharpe": round(sharpe, 2),
    "profit_factor": round(pf, 2),
    "years": int(df["trade_year"].nunique()) if "trade_year" in df.columns else 0,
    "strategies": int(df["strategy"].nunique()),
    "date_range": {
        "start": str(df["entry_dt"].min().date()),
        "end": str(df["entry_dt"].max().date()),
    },
}

# -- Filter definitions --
filters = {}
filters["edge"] = df["prob_edge_verdict"] == "Strong Edge" if "prob_edge_verdict" in df.columns else pd.Series([False] * len(df))
filters["tod"] = df["tod_bucket"].isin(["06:30", "07:00", "07:30", "08:00"]) if "tod_bucket" in df.columns else pd.Series([False] * len(df))
filters["regime"] = df["trend_regime"].isin(["sideways", "downtrend"]) if "trend_regime" in df.columns else pd.Series([False] * len(df))

# Sector filter with min trades guardrail
if "sector" in df.columns and "sector_win_rate" in df.columns and "sector_trades" in df.columns:
    filters["sector"] = (df["sector_win_rate"] > 0.52) & (df["sector_trades"] >= MIN_SECTOR_TRADES)
else:
    filters["sector"] = pd.Series([False] * len(df))

baseline_wr = df["is_winner"].mean() * 100

# -- Filter impact (independent) --
filter_labels = {
    "edge": "Edge Verdict (Strong)",
    "tod": "TOD Window (06:30-08:00)",
    "regime": "Regime (Sideways/Down)",
    "sector": f"Sector (Robust n>={MIN_SECTOR_TRADES})",
}

filter_impact = []
for key, mask in filters.items():
    sub = df.loc[mask]
    n = len(sub)
    if n == 0:
        continue
    wr = sub["is_winner"].mean() * 100
    filter_impact.append({
        "name": filter_labels[key],
        "key": key,
        "trades": n,
        "retained_pct": round(n / len(df) * 100, 1),
        "wr": round(wr, 1),
        "wr_lift": round(wr - baseline_wr, 1),
        "avg_pnl": round(sub["holly_pnl"].mean(), 0),
        "total_pnl": round(sub["holly_pnl"].sum(), 0),
    })

result["filter_impact"] = sorted(filter_impact, key=lambda x: x["wr_lift"], reverse=True)

# -- Full stack --
full_stack_mask = filters["edge"] & filters["tod"] & filters["regime"] & filters["sector"]
fs = df.loc[full_stack_mask]
result["full_stack"] = {
    "trades": int(len(fs)),
    "wr": round(fs["is_winner"].mean() * 100, 1) if len(fs) > 0 else 0,
    "avg_pnl": round(fs["holly_pnl"].mean(), 0) if len(fs) > 0 else 0,
    "total_pnl": round(fs["holly_pnl"].sum(), 0) if len(fs) > 0 else 0,
}

# -- Cumulative stacking equity curves (downsampled) --
print("Computing equity curves...")
configs = {
    "Baseline": pd.Series([True] * len(df), index=df.index),
    "+Edge": filters["edge"],
    "+TOD": filters["tod"],
    "+Regime": filters["regime"],
    "+Sector": filters["sector"],
}

equity_curves = {}
running = pd.Series([True] * len(df), index=df.index)

for name, filt in configs.items():
    if name != "Baseline":
        running = running & filt
    sub = df.loc[running].sort_values("entry_dt").copy()
    if len(sub) == 0:
        continue
    cum = sub["holly_pnl"].cumsum().values
    n = len(cum)
    # Downsample to ~200 points
    if n > 200:
        indices = np.linspace(0, n - 1, 200, dtype=int)
    else:
        indices = np.arange(n)
    wr = sub["is_winner"].mean() * 100
    equity_curves[name] = {
        "points": [{"n": int(i + 1), "pnl": round(float(cum[i]), 0)} for i in indices],
        "trades": int(n),
        "wr": round(wr, 1),
    }

result["equity_curves"] = equity_curves

# -- TOD performance --
if "tod_bucket" in df.columns:
    tod = df.groupby("tod_bucket").agg(
        trades=("holly_pnl", "count"),
        wr=("is_winner", "mean"),
        avg_pnl=("holly_pnl", "mean"),
        total_pnl=("holly_pnl", "sum"),
    ).reset_index()
    tod = tod[tod["trades"] >= 20]
    tod["wr"] = (tod["wr"] * 100).round(1)
    tod["avg_pnl"] = tod["avg_pnl"].round(0)
    tod["total_pnl"] = tod["total_pnl"].round(0)
    result["tod_performance"] = tod.rename(columns={"tod_bucket": "bucket"}).to_dict("records")

# -- Regime performance --
if "trend_regime" in df.columns:
    reg = df.dropna(subset=["trend_regime"]).groupby("trend_regime").agg(
        trades=("holly_pnl", "count"),
        wr=("is_winner", "mean"),
        avg_pnl=("holly_pnl", "mean"),
        total_pnl=("holly_pnl", "sum"),
    ).reset_index()
    reg = reg[reg["trades"] >= 20]
    reg["wr"] = (reg["wr"] * 100).round(1)
    reg["avg_pnl"] = reg["avg_pnl"].round(0)
    reg["total_pnl"] = reg["total_pnl"].round(0)
    result["regime_performance"] = reg.rename(columns={"trend_regime": "regime"}).to_dict("records")

# -- Strategy leaderboard (top 25 by total PnL) --
strat = df.groupby("strategy").agg(
    trades=("holly_pnl", "count"),
    wr=("is_winner", "mean"),
    avg_pnl=("holly_pnl", "mean"),
    total_pnl=("holly_pnl", "sum"),
    avg_hold=("hold_minutes", "mean"),
).reset_index()
strat = strat[strat["trades"] >= 30]
strat["wr"] = (strat["wr"] * 100).round(1)
strat["avg_pnl"] = strat["avg_pnl"].round(0)
strat["total_pnl"] = strat["total_pnl"].round(0)
strat["avg_hold"] = strat["avg_hold"].round(0)

# Compute Sharpe per strategy
sharpe_map = {}
for s in strat["strategy"]:
    pnls = df.loc[df["strategy"] == s, "holly_pnl"]
    if pnls.std() > 0:
        sharpe_map[s] = round(pnls.mean() / pnls.std() * np.sqrt(252), 2)
    else:
        sharpe_map[s] = 0
strat["sharpe"] = strat["strategy"].map(sharpe_map)

# Profit factor
pf_map = {}
for s in strat["strategy"]:
    pnls = df.loc[df["strategy"] == s, "holly_pnl"]
    wins = pnls[pnls > 0].sum()
    losses = abs(pnls[pnls <= 0].sum())
    pf_map[s] = round(wins / losses, 2) if losses > 0 else 0
strat["profit_factor"] = strat["strategy"].map(pf_map)

strat = strat.sort_values("total_pnl", ascending=False).head(25)
result["strategy_leaderboard"] = strat.to_dict("records")

# -- YoY performance --
if "trade_year" in df.columns:
    yoy = df.groupby("trade_year").agg(
        trades=("holly_pnl", "count"),
        wr=("is_winner", "mean"),
        avg_pnl=("holly_pnl", "mean"),
        total_pnl=("holly_pnl", "sum"),
    ).reset_index()
    yoy["wr"] = (yoy["wr"] * 100).round(1)
    yoy["avg_pnl"] = yoy["avg_pnl"].round(0)
    yoy["total_pnl"] = yoy["total_pnl"].round(0)
    result["yoy_performance"] = yoy.rename(columns={"trade_year": "year"}).to_dict("records")

# -- Filter distribution --
passing = (
    filters["edge"].astype(int) +
    filters["tod"].astype(int) +
    filters["regime"].astype(int) +
    filters["sector"].astype(int)
)
dist = passing.value_counts().sort_index()
result["filter_distribution"] = [
    {"passing": int(k), "trades": int(v)} for k, v in dist.items()
]

# -- Write JSON --
out_path = OUTPUT_DIR / "holly_dashboard.json"
with open(out_path, "w") as f:
    json.dump(result, f, indent=2, default=str)

size_kb = out_path.stat().st_size / 1024
print(f"\nExported: {out_path}")
print(f"  Size: {size_kb:.1f} KB")
print(f"  Keys: {list(result.keys())}")
print(f"  Overview: {result['overview']['total_trades']:,} trades, {result['overview']['win_rate']}% WR")
print(f"  Full Stack: {result['full_stack']['trades']:,} trades, {result['full_stack']['wr']}% WR")
print(f"  Strategies: {len(result['strategy_leaderboard'])} in leaderboard")
