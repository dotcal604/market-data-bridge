"""
19_quantstats_tearsheets.py — Generate QuantStats HTML tearsheets for Holly trades.

Produces:
  - Portfolio-level tearsheet (all strategies combined)
  - Per-strategy tearsheets (top N by trade count)
  - Sector-level tearsheets (if sector data available)
  - Summary metrics CSV

Usage:
    python scripts/19_quantstats_tearsheets.py
    python scripts/19_quantstats_tearsheets.py --top 10
    python scripts/19_quantstats_tearsheets.py --strategy "Bon Shorty"
"""

import argparse
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import quantstats as qs

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import OUTPUT_DIR

HOLLY_CSV = OUTPUT_DIR / "holly_analytics.csv"
TEARSHEET_DIR = OUTPUT_DIR / "tearsheets"


def pnl_to_returns(pnl_series: pd.Series, initial_equity: float = 100_000) -> pd.Series:
    """Convert trade-level PnL to percentage returns indexed by date."""
    equity = initial_equity + pnl_series.cumsum()
    returns = equity.pct_change().fillna(0)
    return returns


def daily_returns_from_trades(df: pd.DataFrame, initial_equity: float = 100_000) -> pd.Series:
    """Aggregate trade PnL to daily returns with proper DatetimeIndex."""
    daily_pnl = df.groupby("trade_date")["holly_pnl"].sum()
    daily_pnl.index = pd.to_datetime(daily_pnl.index)
    daily_pnl = daily_pnl.sort_index()

    # Fill gaps with 0 (no-trade days)
    full_idx = pd.bdate_range(daily_pnl.index.min(), daily_pnl.index.max())
    daily_pnl = daily_pnl.reindex(full_idx, fill_value=0)

    equity = initial_equity + daily_pnl.cumsum()
    returns = equity.pct_change().fillna(0)
    returns.name = "Strategy"
    return returns


def generate_tearsheet(
    returns: pd.Series,
    title: str,
    output_path: Path,
    benchmark: str | None = "SPY",
) -> bool:
    """Generate QuantStats HTML tearsheet. Returns True on success."""
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        qs.reports.html(
            returns,
            benchmark=benchmark,
            output=str(output_path),
            title=title,
            download_filename=output_path.stem,
        )
        size_kb = output_path.stat().st_size / 1024
        print(f"  -> {output_path.name} ({size_kb:.0f} KB)")
        return True
    except Exception as e:
        print(f"  FAILED: {title} -> {e}")
        return False


def generate_metrics_csv(df: pd.DataFrame, output_path: Path):
    """Generate a summary CSV with QuantStats metrics per strategy."""
    rows = []
    for strat, group in df.groupby("strategy"):
        if len(group) < 30:
            continue

        returns = daily_returns_from_trades(group)

        try:
            metrics = {
                "strategy": strat,
                "trades": len(group),
                "total_pnl": round(group["holly_pnl"].sum(), 2),
                "win_rate": round((group["holly_pnl"] > 0).mean(), 4),
                "sharpe": round(float(qs.stats.sharpe(returns)), 4),
                "sortino": round(float(qs.stats.sortino(returns)), 4),
                "max_drawdown": round(float(qs.stats.max_drawdown(returns)), 4),
                "calmar": round(float(qs.stats.calmar(returns)), 4),
                "avg_return": round(float(qs.stats.avg_return(returns)), 6),
                "volatility": round(float(qs.stats.volatility(returns)), 4),
                "skew": round(float(qs.stats.skew(returns)), 4),
                "kurtosis": round(float(qs.stats.kurtosis(returns)), 4),
                "best_day": round(float(qs.stats.best(returns)), 4),
                "worst_day": round(float(qs.stats.worst(returns)), 4),
                "avg_win": round(group.loc[group["holly_pnl"] > 0, "holly_pnl"].mean(), 2),
                "avg_loss": round(group.loc[group["holly_pnl"] < 0, "holly_pnl"].mean(), 2),
                "profit_factor": round(
                    abs(group.loc[group["holly_pnl"] > 0, "holly_pnl"].sum() /
                        group.loc[group["holly_pnl"] < 0, "holly_pnl"].sum())
                    if group.loc[group["holly_pnl"] < 0, "holly_pnl"].sum() != 0 else 0, 4
                ),
            }
            rows.append(metrics)
        except Exception as e:
            print(f"  Metrics failed for {strat}: {e}")

    metrics_df = pd.DataFrame(rows)
    metrics_df = metrics_df.sort_values("sharpe", ascending=False)
    metrics_df.to_csv(output_path, index=False)
    print(f"\nMetrics CSV: {output_path} ({len(metrics_df)} strategies)")
    return metrics_df


def main():
    parser = argparse.ArgumentParser(description="Generate QuantStats tearsheets")
    parser.add_argument("--top", type=int, default=10, help="Number of top strategies")
    parser.add_argument("--strategy", type=str, default=None, help="Specific strategy")
    parser.add_argument("--no-benchmark", action="store_true", help="Skip SPY benchmark")
    args = parser.parse_args()

    if not HOLLY_CSV.exists():
        print(f"ERROR: {HOLLY_CSV} not found. Run 13_export_analytics.py first.")
        sys.exit(1)

    print("Loading Holly analytics...")
    df = pd.read_csv(HOLLY_CSV, parse_dates=["trade_date", "entry_time", "exit_time"])
    print(f"  {len(df):,} trades, {df['strategy'].nunique()} strategies")
    print(f"  Date range: {df['trade_date'].min()} to {df['trade_date'].max()}")

    benchmark = None if args.no_benchmark else "SPY"
    TEARSHEET_DIR.mkdir(parents=True, exist_ok=True)

    # ── 1. Portfolio-level tearsheet ───────────────────────────────
    print(f"\n{'='*60}")
    print("Portfolio Tearsheet (all strategies combined)")
    print(f"{'='*60}")
    portfolio_returns = daily_returns_from_trades(df)
    generate_tearsheet(
        portfolio_returns,
        "Holly Portfolio — All Strategies",
        TEARSHEET_DIR / "tearsheet_portfolio.html",
        benchmark=benchmark,
    )

    # ── 2. Per-strategy tearsheets ────────────────────────────────
    if args.strategy:
        strategies = [args.strategy]
    else:
        # Top N by trade count
        top_strats = (
            df.groupby("strategy").size()
            .sort_values(ascending=False)
            .head(args.top)
            .index.tolist()
        )
        strategies = top_strats

    print(f"\n{'='*60}")
    print(f"Strategy Tearsheets ({len(strategies)} strategies)")
    print(f"{'='*60}")
    success = 0
    for strat in strategies:
        strat_df = df[df["strategy"] == strat]
        if len(strat_df) < 20:
            print(f"  SKIP {strat}: only {len(strat_df)} trades")
            continue

        returns = daily_returns_from_trades(strat_df)
        safe_name = strat.replace(" ", "_").replace("/", "_").replace("\\", "_")
        ok = generate_tearsheet(
            returns,
            f"Holly — {strat} ({len(strat_df)} trades)",
            TEARSHEET_DIR / f"tearsheet_{safe_name}.html",
            benchmark=benchmark,
        )
        if ok:
            success += 1

    print(f"\n  Generated {success}/{len(strategies)} strategy tearsheets")

    # ── 3. Sector tearsheets (if available) ───────────────────────
    if "sector" in df.columns and df["sector"].notna().sum() > 100:
        print(f"\n{'='*60}")
        print("Sector Tearsheets")
        print(f"{'='*60}")
        top_sectors = (
            df.dropna(subset=["sector"])
            .groupby("sector").size()
            .sort_values(ascending=False)
            .head(5)
            .index.tolist()
        )
        for sector in top_sectors:
            sector_df = df[df["sector"] == sector]
            if len(sector_df) < 30:
                continue
            returns = daily_returns_from_trades(sector_df)
            safe_name = sector.replace(" ", "_").replace(",", "").replace("&", "and")[:40]
            generate_tearsheet(
                returns,
                f"Holly — {sector} ({len(sector_df)} trades)",
                TEARSHEET_DIR / f"tearsheet_sector_{safe_name}.html",
                benchmark=benchmark,
            )

    # ── 4. Metrics summary CSV ────────────────────────────────────
    print(f"\n{'='*60}")
    print("Generating metrics summary...")
    print(f"{'='*60}")
    metrics_df = generate_metrics_csv(df, TEARSHEET_DIR / "strategy_metrics.csv")

    # Print top strategies by Sharpe
    print(f"\nTop 15 Strategies by Sharpe:")
    print(f"{'Strategy':<25} {'Trades':>6} {'WR':>6} {'Sharpe':>7} {'Sortino':>8} {'MaxDD':>8} {'PnL':>12}")
    for _, r in metrics_df.head(15).iterrows():
        print(
            f"{r['strategy']:<25} {r['trades']:>6} {r['win_rate']:>5.1%} "
            f"{r['sharpe']:>7.2f} {r['sortino']:>8.2f} {r['max_drawdown']:>7.1%} "
            f"${r['total_pnl']:>11,.0f}"
        )

    print(f"\n{'='*60}")
    print(f"All tearsheets saved to: {TEARSHEET_DIR}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
