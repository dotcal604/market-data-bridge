"""
TraderSync Trade Analytics

Analyzes imported TraderSync trade data from the bridge database.
Outputs: win rate, expectancy, R distribution, performance by side/time/holdtime,
streaks, symbol analysis, and calibration metrics.

Usage:
    python analytics/tradersync_analytics.py [--days 90] [--output analytics/output/ts_report.json]
"""

import argparse
import json
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

ANALYTICS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = ANALYTICS_DIR.parent
DB_PATH = PROJECT_ROOT / "data" / "bridge.db"
OUTPUT_DIR = ANALYTICS_DIR / "output"


def load_trades(days: int | None = None) -> pd.DataFrame:
    """Load all TraderSync trades from DB."""
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    where = ""
    params: list = []
    if days:
        where = f"WHERE open_date >= date('now', ? || ' days')"
        params = [f"-{days}"]
    df = pd.read_sql_query(
        f"SELECT * FROM tradersync_trades {where} ORDER BY open_date DESC, open_time DESC",
        conn,
        params=params,
    )
    conn.close()

    # Parse dates
    df["open_date"] = pd.to_datetime(df["open_date"])
    df["close_date"] = pd.to_datetime(df["close_date"])
    # Extract hour from open_time
    df["open_hour"] = df["open_time"].str.split(":").str[0].astype(int, errors="ignore")
    return df


def overview(df: pd.DataFrame) -> dict:
    """Top-level stats."""
    wins = (df["status"] == "WIN").sum()
    losses = (df["status"] == "LOSS").sum()
    total = len(df)
    return {
        "total_trades": int(total),
        "wins": int(wins),
        "losses": int(losses),
        "win_rate": round(wins / total, 4) if total else 0,
        "total_pnl": round(float(df["return_dollars"].sum()), 2),
        "total_net": round(float(df["net_return"].sum()), 2),
        "total_commission": round(float(df["commission"].sum()), 2),
        "avg_pnl": round(float(df["return_dollars"].mean()), 2),
        "avg_return_pct": round(float(df["return_pct"].mean()), 4),
        "unique_symbols": int(df["symbol"].nunique()),
        "trading_days": int(df["open_date"].dt.date.nunique()),
        "first_trade": str(df["open_date"].min().date()),
        "last_trade": str(df["open_date"].max().date()),
    }


def r_multiple_analysis(df: pd.DataFrame) -> dict:
    """R-Multiple distribution and expectancy."""
    r = df["r_multiple"].dropna()
    if r.empty:
        return {"has_r_data": False, "note": "No R-multiple data (older trades may lack targets/stops)"}

    r_with = df[df["r_multiple"].notna()]
    wins = r_with[r_with["status"] == "WIN"]["r_multiple"]
    losses = r_with[r_with["status"] == "LOSS"]["r_multiple"]

    # Histogram buckets
    bins = [-np.inf, -1.0, -0.5, -0.25, 0, 0.1, 0.25, 0.5, 1.0, np.inf]
    labels = ["<-1R", "-1 to -0.5R", "-0.5 to -0.25R", "-0.25 to 0R",
              "0 to 0.1R", "0.1 to 0.25R", "0.25 to 0.5R", "0.5 to 1R", ">1R"]
    hist = pd.cut(r, bins=bins, labels=labels).value_counts().sort_index()

    return {
        "has_r_data": True,
        "trades_with_r": int(len(r)),
        "avg_r": round(float(r.mean()), 4),
        "median_r": round(float(r.median()), 4),
        "expectancy": round(float(r.mean()), 4),
        "avg_win_r": round(float(wins.mean()), 4) if not wins.empty else None,
        "avg_loss_r": round(float(losses.mean()), 4) if not losses.empty else None,
        "best_r": round(float(r.max()), 4),
        "worst_r": round(float(r.min()), 4),
        "std_r": round(float(r.std()), 4),
        "distribution": {k: int(v) for k, v in hist.items()},
    }


def side_breakdown(df: pd.DataFrame) -> dict:
    """Performance by LONG vs SHORT."""
    result = {}
    for side in ["LONG", "SHORT"]:
        sub = df[df["side"] == side]
        if sub.empty:
            continue
        wins = (sub["status"] == "WIN").sum()
        result[side] = {
            "total": int(len(sub)),
            "wins": int(wins),
            "win_rate": round(wins / len(sub), 4),
            "avg_pnl": round(float(sub["return_dollars"].mean()), 2),
            "total_pnl": round(float(sub["return_dollars"].sum()), 2),
            "avg_r": round(float(sub["r_multiple"].dropna().mean()), 4) if sub["r_multiple"].notna().any() else None,
        }
    return result


def time_of_day_analysis(df: pd.DataFrame) -> dict:
    """Performance by hour of day."""
    result = {}
    for hour in sorted(df["open_hour"].dropna().unique()):
        sub = df[df["open_hour"] == hour]
        if len(sub) < 3:
            continue
        wins = (sub["status"] == "WIN").sum()
        result[f"{int(hour):02d}:00"] = {
            "trades": int(len(sub)),
            "win_rate": round(wins / len(sub), 4),
            "avg_pnl": round(float(sub["return_dollars"].mean()), 2),
            "avg_r": round(float(sub["r_multiple"].dropna().mean()), 4) if sub["r_multiple"].notna().any() else None,
        }
    return result


def daily_performance(df: pd.DataFrame) -> list[dict]:
    """Per-day aggregates (last 30 trading days)."""
    daily = df.groupby(df["open_date"].dt.date).agg(
        trades=("status", "count"),
        wins=("status", lambda x: (x == "WIN").sum()),
        pnl=("return_dollars", "sum"),
        net=("net_return", "sum"),
        avg_r=("r_multiple", "mean"),
    ).reset_index()
    daily.columns = ["date", "trades", "wins", "pnl", "net", "avg_r"]
    daily["win_rate"] = daily["wins"] / daily["trades"]
    daily = daily.sort_values("date", ascending=False).head(30)

    return [
        {
            "date": str(row["date"]),
            "trades": int(row["trades"]),
            "wins": int(row["wins"]),
            "win_rate": round(float(row["win_rate"]), 4),
            "pnl": round(float(row["pnl"]), 2),
            "net": round(float(row["net"]), 2),
            "avg_r": round(float(row["avg_r"]), 4) if pd.notna(row["avg_r"]) else None,
        }
        for _, row in daily.iterrows()
    ]


def top_symbols(df: pd.DataFrame, n: int = 20) -> list[dict]:
    """Most-traded symbols by frequency."""
    sym = df.groupby("symbol").agg(
        trades=("status", "count"),
        wins=("status", lambda x: (x == "WIN").sum()),
        pnl=("return_dollars", "sum"),
        avg_r=("r_multiple", "mean"),
    ).reset_index()
    sym["win_rate"] = sym["wins"] / sym["trades"]
    sym = sym.sort_values("trades", ascending=False).head(n)

    return [
        {
            "symbol": row["symbol"],
            "trades": int(row["trades"]),
            "wins": int(row["wins"]),
            "win_rate": round(float(row["win_rate"]), 4),
            "pnl": round(float(row["pnl"]), 2),
            "avg_r": round(float(row["avg_r"]), 4) if pd.notna(row["avg_r"]) else None,
        }
        for _, row in sym.iterrows()
    ]


def streak_analysis(df: pd.DataFrame) -> dict:
    """Win/loss streak analysis."""
    sorted_df = df.sort_values(["open_date", "open_time"])
    statuses = sorted_df["status"].tolist()

    max_win_streak = 0
    max_loss_streak = 0
    current_streak = 0
    current_type = None

    for s in statuses:
        if s == current_type:
            current_streak += 1
        else:
            current_type = s
            current_streak = 1
        if s == "WIN":
            max_win_streak = max(max_win_streak, current_streak)
        elif s == "LOSS":
            max_loss_streak = max(max_loss_streak, current_streak)

    return {
        "max_win_streak": max_win_streak,
        "max_loss_streak": max_loss_streak,
        "current_streak": current_streak,
        "current_type": current_type,
    }


def mae_mfe_analysis(df: pd.DataFrame) -> dict:
    """Max Adverse/Favorable Excursion analysis."""
    with_data = df[(df["mae"].notna()) & (df["mfe"].notna()) & (df["mae"] != 0) & (df["mfe"] != 0)]
    if with_data.empty:
        return {"has_data": False}

    wins = with_data[with_data["status"] == "WIN"]
    losses = with_data[with_data["status"] == "LOSS"]

    return {
        "has_data": True,
        "trades_with_mae_mfe": int(len(with_data)),
        "avg_mae_wins": round(float(wins["mae"].mean()), 2) if not wins.empty else None,
        "avg_mae_losses": round(float(losses["mae"].mean()), 2) if not losses.empty else None,
        "avg_mfe_wins": round(float(wins["mfe"].mean()), 2) if not wins.empty else None,
        "avg_mfe_losses": round(float(losses["mfe"].mean()), 2) if not losses.empty else None,
        "mae_recovery_pct": round(
            float((wins["mfe"] / wins["mae"].abs()).replace([np.inf, -np.inf], np.nan).dropna().mean()), 4
        ) if not wins.empty and (wins["mae"] != 0).any() else None,
    }


def holdtime_analysis(df: pd.DataFrame) -> dict:
    """Performance by hold time buckets."""
    def parse_holdtime_minutes(ht: str) -> float | None:
        if not isinstance(ht, str):
            return None
        ht = ht.strip()
        if "sec" in ht:
            parts = ht.split()
            return float(parts[0]) / 60
        if "min" in ht:
            parts = ht.replace(" min", "").split(":")
            return float(parts[0]) + (float(parts[1]) / 60 if len(parts) > 1 else 0)
        if "hr" in ht:
            parts = ht.replace(" hr", "").split(":")
            h = float(parts[0])
            m = float(parts[1]) if len(parts) > 1 else 0
            s = float(parts[2]) if len(parts) > 2 else 0
            return h * 60 + m + s / 60
        if "d" in ht:
            return float(ht.replace("d", "").strip()) * 24 * 60
        return None

    df = df.copy()
    df["hold_minutes"] = df["holdtime"].apply(parse_holdtime_minutes)
    with_ht = df[df["hold_minutes"].notna()]
    if with_ht.empty:
        return {"has_data": False}

    bins = [0, 5, 15, 30, 60, 120, np.inf]
    labels = ["<5m", "5-15m", "15-30m", "30m-1h", "1-2h", ">2h"]
    with_ht = with_ht.copy()
    with_ht["ht_bucket"] = pd.cut(with_ht["hold_minutes"], bins=bins, labels=labels)

    result = {}
    for bucket in labels:
        sub = with_ht[with_ht["ht_bucket"] == bucket]
        if sub.empty:
            continue
        wins = (sub["status"] == "WIN").sum()
        result[bucket] = {
            "trades": int(len(sub)),
            "win_rate": round(wins / len(sub), 4),
            "avg_pnl": round(float(sub["return_dollars"].mean()), 2),
            "avg_r": round(float(sub["r_multiple"].dropna().mean()), 4) if sub["r_multiple"].notna().any() else None,
        }
    return {"has_data": True, "buckets": result}


def signal_source_breakdown(df: pd.DataFrame) -> dict:
    """Performance by signal source (holly, manual, etc)."""
    result = {}
    for source in df["signal_source"].fillna("manual").unique():
        sub = df[df["signal_source"].fillna("manual") == source]
        if sub.empty:
            continue
        wins = (sub["status"] == "WIN").sum()
        result[source] = {
            "total": int(len(sub)),
            "wins": int(wins),
            "win_rate": round(wins / len(sub), 4),
            "avg_pnl": round(float(sub["return_dollars"].mean()), 2),
            "total_pnl": round(float(sub["return_dollars"].sum()), 2),
            "total_net": round(float(sub["net_return"].sum()), 2),
            "avg_r": round(float(sub["r_multiple"].dropna().mean()), 4) if sub["r_multiple"].notna().any() else None,
        }
    return result


def run_analytics(days: int | None = None) -> dict:
    """Run full analytics suite."""
    df = load_trades(days)
    if df.empty:
        return {"error": "No trades found"}

    return {
        "overview": overview(df),
        "r_multiple": r_multiple_analysis(df),
        "by_side": side_breakdown(df),
        "by_signal": signal_source_breakdown(df),
        "by_time": time_of_day_analysis(df),
        "by_holdtime": holdtime_analysis(df),
        "mae_mfe": mae_mfe_analysis(df),
        "streaks": streak_analysis(df),
        "top_symbols": top_symbols(df),
        "daily_performance": daily_performance(df),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TraderSync Trade Analytics")
    parser.add_argument("--days", type=int, default=None, help="Lookback period (default: all)")
    parser.add_argument("--output", type=str, default=None, help="Output JSON path")
    args = parser.parse_args()

    print(f"TraderSync Analytics — DB: {DB_PATH}")
    if not DB_PATH.exists():
        print("Database not found. Import trades first.")
        exit(1)

    report = run_analytics(args.days)

    # Print summary
    ov = report.get("overview", {})
    print(f"\n{'='*60}")
    print(f"  TRADE ANALYTICS — {ov.get('first_trade', '?')} to {ov.get('last_trade', '?')}")
    print(f"{'='*60}")
    print(f"  Trades:     {ov.get('total_trades', 0):,}")
    print(f"  Win Rate:   {ov.get('win_rate', 0):.1%}  ({ov.get('wins', 0)}W / {ov.get('losses', 0)}L)")
    print(f"  Total P&L:  ${ov.get('total_pnl', 0):,.2f}  (net: ${ov.get('total_net', 0):,.2f})")
    print(f"  Avg Trade:  ${ov.get('avg_pnl', 0):,.2f}")
    print(f"  Commission: ${ov.get('total_commission', 0):,.2f}")
    print(f"  Symbols:    {ov.get('unique_symbols', 0)} unique")
    print(f"  Days:       {ov.get('trading_days', 0)} trading days")

    rm = report.get("r_multiple", {})
    if rm.get("has_r_data"):
        print(f"\n  R-Multiple:")
        print(f"    Expectancy:  {rm.get('expectancy', 0):+.4f}R")
        print(f"    Avg Win R:   {rm.get('avg_win_r', 0):+.4f}R")
        print(f"    Avg Loss R:  {rm.get('avg_loss_r', 0):+.4f}R")
        print(f"    Best:        {rm.get('best_r', 0):+.4f}R")
        print(f"    Worst:       {rm.get('worst_r', 0):+.4f}R")

    sides = report.get("by_side", {})
    if sides:
        print(f"\n  By Side:")
        for side, data in sides.items():
            print(f"    {side:6s}: {data['win_rate']:.1%} WR, ${data['total_pnl']:,.2f} P&L ({data['total']} trades)")

    streaks = report.get("streaks", {})
    if streaks:
        print(f"\n  Streaks:")
        print(f"    Best win:  {streaks.get('max_win_streak', 0)}")
        print(f"    Worst loss: {streaks.get('max_loss_streak', 0)}")

    print(f"{'='*60}")

    # Save to file
    output_path = args.output
    if not output_path:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        output_path = str(OUTPUT_DIR / "ts_analytics.json")

    with open(output_path, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\nFull report saved to: {output_path}")
