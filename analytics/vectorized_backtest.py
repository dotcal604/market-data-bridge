"""
Vectorized Backtesting Engine — Holly Pipeline Integration
===========================================================

Two modes:
  1. Signal-based backtest: External signals (1/0/-1) on bar-level data
  2. Holly trade-level backtest: Walk-forward on Holly exit optimizer trades

Both modes support IBKR-realistic costs (per-share commission + bps slippage),
position sizing, and walk-forward validation.

Usage:
    # Trade-level Holly backtest
    python analytics/vectorized_backtest.py --holly --walk-forward 3
    python analytics/vectorized_backtest.py --holly --strategy "Breakdown Short"

    # Signal-based on a CSV of bars
    python analytics/vectorized_backtest.py --signal bars.csv
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

# ── Constants ─────────────────────────────────────────────────────────────

HOLLY_DB = Path(__file__).parent / "holly_exit" / "data" / "duckdb" / "holly.ddb"
HOLLY_CSV = Path(__file__).parent / "holly_exit" / "output" / "holly_analytics.csv"
OUTPUT_DIR = Path(__file__).parent / "output"


# ── Signal-Based Backtester ───────────────────────────────────────────────

class SignalBacktester:
    """Bar-level signal backtest using log-return vectorization."""

    def __init__(
        self,
        initial_capital: float = 100_000.0,
        commission_per_share: float = 0.0035,
        slippage_bps: float = 1.0,
    ):
        self.initial_capital = initial_capital
        self.commission = commission_per_share
        self.slippage_pct = slippage_bps / 10_000.0

    def run(self, df: pd.DataFrame, signals: pd.Series) -> Dict[str, Any]:
        """
        Run bar-level signal backtest.

        Args:
            df: OHLCV DataFrame
            signals: Series of {-1, 0, 1}. Signal at t -> position at t+1.
        """
        data = df.copy()
        data["signal"] = signals

        # Log returns shifted by 1 (trade at close t, return at t+1)
        data["log_ret"] = np.log(data["close"] / data["close"].shift(1))
        data["strat_ret"] = data["signal"].shift(1) * data["log_ret"]

        # Transaction costs on signal changes
        data["trades"] = data["signal"].diff().abs().fillna(0)
        cost_pct = (self.commission / data["close"]) + self.slippage_pct
        data["cost"] = data["trades"] * cost_pct
        data["net_ret"] = data["strat_ret"] - data["cost"]

        # Equity curve
        data["equity"] = self.initial_capital * np.exp(data["net_ret"].cumsum())

        return self._compute_metrics(data)

    def _compute_metrics(self, data: pd.DataFrame) -> Dict[str, Any]:
        """Compute standard performance metrics."""
        ret = data["net_ret"].dropna()
        if len(ret) == 0:
            return {"error": "No returns"}

        # Auto-detect annualization
        if isinstance(data.index, pd.DatetimeIndex):
            diffs = data.index.to_series().diff().dropna()
            med = diffs.median()
            if med < pd.Timedelta(minutes=5):
                ann = 252 * 390
            elif med < pd.Timedelta(hours=1):
                ann = 252 * 13
            else:
                ann = 252
        else:
            ann = 252

        total_ret = (data["equity"].iloc[-1] / self.initial_capital) - 1
        mean_r = ret.mean()
        std_r = ret.std()
        sharpe = (mean_r / std_r) * np.sqrt(ann) if std_r > 0 else 0

        down = ret[ret < 0]
        sortino = (mean_r / down.std()) * np.sqrt(ann) if len(down) > 0 and down.std() > 0 else 0

        roll_max = data["equity"].cummax()
        drawdown = (data["equity"] - roll_max) / roll_max
        max_dd = drawdown.min()

        return {
            "total_return": round(total_ret * 100, 2),
            "sharpe": round(sharpe, 2),
            "sortino": round(sortino, 2),
            "max_drawdown_pct": round(max_dd * 100, 2),
            "win_rate_bars": round((ret > 0).mean() * 100, 2),
            "total_trades": int(data["trades"].sum() / 2),
            "equity_final": round(data["equity"].iloc[-1], 2),
            "n_bars": len(data),
        }


# ── Holly Trade-Level Backtester ──────────────────────────────────────────

class HollyBacktester:
    """
    Walk-forward trade-level backtester for Holly exit optimizer.
    Loads from holly_analytics.csv (enriched export) or DuckDB.

    Walk-forward: splits into K folds chronologically, trains on K-1, tests on 1.
    """

    def __init__(
        self,
        initial_capital: float = 100_000.0,
        commission_per_share: float = 0.005,
        slippage_per_share: float = 0.01,
        default_shares: int = 100,
    ):
        self.initial_capital = initial_capital
        self.commission = commission_per_share
        self.slippage = slippage_per_share
        self.shares = default_shares

    def load_trades(
        self,
        strategy: Optional[str] = None,
        direction: Optional[str] = None,
        min_date: Optional[str] = None,
        max_date: Optional[str] = None,
    ) -> pd.DataFrame:
        """Load trades from CSV or DuckDB."""
        if HOLLY_CSV.exists():
            df = pd.read_csv(HOLLY_CSV, parse_dates=["trade_date", "entry_time", "exit_time"])
        elif HOLLY_DB.exists():
            import duckdb
            con = duckdb.connect(str(HOLLY_DB), read_only=True)
            df = con.execute("SELECT * FROM trades ORDER BY entry_time").fetchdf()
            con.close()
            df["trade_date"] = pd.to_datetime(df["entry_time"]).dt.date
        else:
            raise FileNotFoundError(f"Neither {HOLLY_CSV} nor {HOLLY_DB} found")

        if strategy:
            df = df[df["strategy"] == strategy]
        if direction:
            df = df[df["direction"] == direction]
        if min_date:
            df = df[df["trade_date"] >= pd.Timestamp(min_date)]
        if max_date:
            df = df[df["trade_date"] <= pd.Timestamp(max_date)]

        return df.sort_values("entry_time").reset_index(drop=True)

    def run(
        self,
        df: pd.DataFrame,
        sizing: str = "fixed",  # "fixed", "risk_pct", "kelly"
        risk_pct: float = 0.01,
    ) -> Dict[str, Any]:
        """
        Run trade-level backtest with realistic costs.

        Args:
            df: Holly trades DataFrame (needs holly_pnl, entry_price, shares)
            sizing: Position sizing method
            risk_pct: Risk per trade (for risk_pct/kelly sizing)
        """
        pnl = df["holly_pnl"].fillna(0).values
        entries = df["entry_price"].values
        shares = df["shares"].values if "shares" in df else np.full(len(df), self.shares)

        # Apply costs
        cost_per_trade = shares * (self.commission + self.slippage) * 2  # round-trip
        net_pnl = pnl - cost_per_trade

        # Position sizing adjustment
        if sizing == "risk_pct":
            # Scale PnL by risk_pct of equity per trade
            equity = self.initial_capital
            scaled_pnl = np.zeros(len(net_pnl))
            for i in range(len(net_pnl)):
                risk_dollars = equity * risk_pct
                if entries[i] > 0 and shares[i] > 0:
                    base_risk = abs(pnl[i]) if pnl[i] < 0 else entries[i] * shares[i] * 0.02
                    scale = min(risk_dollars / max(base_risk, 1), 3.0)  # cap at 3x
                else:
                    scale = 1.0
                scaled_pnl[i] = net_pnl[i] * scale
                equity += scaled_pnl[i]
            net_pnl = scaled_pnl

        # Equity curve
        equity_curve = self.initial_capital + np.cumsum(net_pnl)

        # Metrics
        return self._compute_metrics(df, net_pnl, equity_curve)

    def _compute_metrics(
        self,
        df: pd.DataFrame,
        net_pnl: np.ndarray,
        equity_curve: np.ndarray,
    ) -> Dict[str, Any]:
        """Compute trade-level performance metrics."""
        n = len(net_pnl)
        wins = (net_pnl > 0).sum()
        losses = (net_pnl < 0).sum()
        wr = wins / n if n > 0 else 0

        avg_win = float(np.mean(net_pnl[net_pnl > 0])) if wins > 0 else 0
        avg_loss = float(np.mean(net_pnl[net_pnl < 0])) if losses > 0 else 0
        payoff = abs(avg_win / avg_loss) if avg_loss != 0 else 0

        # Profit factor
        gross_profit = float(net_pnl[net_pnl > 0].sum()) if wins > 0 else 0
        gross_loss = float(abs(net_pnl[net_pnl < 0].sum())) if losses > 0 else 1
        pf = gross_profit / gross_loss

        # Max drawdown
        peak = np.maximum.accumulate(equity_curve)
        dd = (equity_curve - peak) / peak
        max_dd = float(dd.min())

        # Sharpe (trade-level, annualized)
        mean_pnl = float(np.mean(net_pnl))
        std_pnl = float(np.std(net_pnl))
        # ~5 trades/day * 252 days
        trades_per_year = min(n, 252 * 5)
        sharpe = (mean_pnl / std_pnl) * np.sqrt(trades_per_year) if std_pnl > 0 else 0

        # Kelly criterion
        kelly = wr - (1 - wr) / payoff if payoff > 0 else 0

        # Consecutive losses (max streak)
        losing_streak = 0
        max_streak = 0
        for p in net_pnl:
            if p < 0:
                losing_streak += 1
                max_streak = max(max_streak, losing_streak)
            else:
                losing_streak = 0

        # CAGR
        date_range = (pd.to_datetime(df["trade_date"]).max() - pd.to_datetime(df["trade_date"]).min()).days
        years = max(date_range / 365.25, 0.1)
        total_ret = equity_curve[-1] / self.initial_capital
        cagr = (total_ret ** (1 / years) - 1) if total_ret > 0 else -1

        return {
            "n_trades": n,
            "wins": int(wins),
            "losses": int(losses),
            "win_rate": round(wr * 100, 2),
            "total_pnl": round(float(net_pnl.sum()), 2),
            "avg_pnl": round(mean_pnl, 2),
            "avg_win": round(avg_win, 2),
            "avg_loss": round(avg_loss, 2),
            "payoff_ratio": round(payoff, 2),
            "profit_factor": round(pf, 2),
            "sharpe": round(sharpe, 2),
            "max_drawdown_pct": round(max_dd * 100, 2),
            "kelly": round(kelly * 100, 2),
            "max_losing_streak": max_streak,
            "cagr_pct": round(cagr * 100, 2),
            "equity_final": round(float(equity_curve[-1]), 2),
            "years": round(years, 1),
            "strategies": int(df["strategy"].nunique()) if "strategy" in df else 0,
        }

    def walk_forward(
        self,
        df: pd.DataFrame,
        n_folds: int = 3,
        sizing: str = "fixed",
    ) -> Dict[str, Any]:
        """
        Walk-forward validation: train on K-1 folds, test on fold K.
        Returns per-fold and aggregate out-of-sample metrics.
        """
        df = df.sort_values("entry_time").reset_index(drop=True)
        fold_size = len(df) // n_folds
        if fold_size < 50:
            return {"error": f"Too few trades per fold ({fold_size}). Need 50+."}

        folds = []
        oos_pnl = []

        for k in range(1, n_folds):
            train_end = k * fold_size
            test_end = min((k + 1) * fold_size, len(df))

            train = df.iloc[:train_end]
            test = df.iloc[train_end:test_end]

            if len(test) < 20:
                continue

            # Run backtest on test fold
            result = self.run(test, sizing=sizing)
            result["fold"] = k
            result["train_size"] = len(train)
            result["test_size"] = len(test)
            result["train_range"] = f"{train['trade_date'].min()} to {train['trade_date'].max()}"
            result["test_range"] = f"{test['trade_date'].min()} to {test['trade_date'].max()}"

            folds.append(result)
            oos_pnl.extend(test["holly_pnl"].fillna(0).tolist())

        if not folds:
            return {"error": "No valid folds"}

        # Aggregate OOS metrics
        oos_arr = np.array(oos_pnl)
        aggregate = {
            "method": "walk_forward",
            "n_folds": len(folds),
            "oos_trades": len(oos_arr),
            "oos_win_rate": round((oos_arr > 0).mean() * 100, 2),
            "oos_avg_pnl": round(float(oos_arr.mean()), 2),
            "oos_total_pnl": round(float(oos_arr.sum()), 2),
            "oos_sharpe": round(
                (oos_arr.mean() / oos_arr.std()) * np.sqrt(252 * 5)
                if oos_arr.std() > 0 else 0, 2
            ),
            "folds": folds,
        }
        return aggregate

    def by_strategy(self, df: pd.DataFrame, min_trades: int = 30) -> List[Dict]:
        """Run backtest per strategy, return ranked results."""
        results = []
        for strat, group in df.groupby("strategy"):
            if len(group) < min_trades:
                continue
            r = self.run(group)
            r["strategy"] = strat
            results.append(r)

        results.sort(key=lambda x: x["sharpe"], reverse=True)
        return results

    def by_regime(self, df: pd.DataFrame, regime_col: str = "trend_regime") -> List[Dict]:
        """Run backtest per regime state."""
        if regime_col not in df.columns:
            return [{"error": f"{regime_col} not in data"}]

        results = []
        for regime, group in df.dropna(subset=[regime_col]).groupby(regime_col):
            if len(group) < 30:
                continue
            r = self.run(group)
            r["regime"] = regime
            r["regime_col"] = regime_col
            results.append(r)

        return results


# ── Time-of-Day Probability Curves ────────────────────────────────────────

def time_of_day_curves(df: pd.DataFrame, bucket_minutes: int = 30) -> pd.DataFrame:
    """
    Compute win rate, expectancy, and trade count by time-of-day bucket.
    Outputs a summary table suitable for charting.
    """
    entry_dt = pd.to_datetime(df["entry_time"])
    total_minutes = entry_dt.dt.hour * 60 + entry_dt.dt.minute
    df = df.copy()
    df["_bucket_min"] = (total_minutes // bucket_minutes) * bucket_minutes
    df["_bucket_label"] = df["_bucket_min"].apply(lambda m: f"{m // 60:02d}:{m % 60:02d}")

    summary = df.groupby("_bucket_label").agg(
        trades=("holly_pnl", "count"),
        win_rate=("holly_pnl", lambda x: (x > 0).mean()),
        avg_pnl=("holly_pnl", "mean"),
        total_pnl=("holly_pnl", "sum"),
        median_pnl=("holly_pnl", "median"),
        std_pnl=("holly_pnl", "std"),
    ).round(4)

    summary["expectancy"] = (summary["win_rate"] * summary.apply(
        lambda r: df.loc[df["_bucket_label"] == r.name].loc[df["holly_pnl"] > 0, "holly_pnl"].mean()
        if r["win_rate"] > 0 else 0, axis=1
    ) + (1 - summary["win_rate"]) * summary.apply(
        lambda r: df.loc[df["_bucket_label"] == r.name].loc[df["holly_pnl"] < 0, "holly_pnl"].mean()
        if r["win_rate"] < 1 else 0, axis=1
    )).round(2)

    # Simplified expectancy: just use avg_pnl (which IS the expectancy)
    summary["expectancy"] = summary["avg_pnl"].round(2)
    summary["sharpe_proxy"] = np.where(
        summary["std_pnl"] > 0,
        (summary["avg_pnl"] / summary["std_pnl"]).round(4),
        0,
    )

    summary.index.name = "time_bucket"
    return summary.reset_index()


# ── Main CLI ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Vectorized Backtesting Engine")
    parser.add_argument("--holly", action="store_true", help="Run Holly trade-level backtest")
    parser.add_argument("--signal", type=str, default=None, help="CSV for signal backtest")
    parser.add_argument("--strategy", type=str, default=None, help="Filter to strategy")
    parser.add_argument("--walk-forward", type=int, default=0, help="Walk-forward folds")
    parser.add_argument("--by-strategy", action="store_true", help="Per-strategy breakdown")
    parser.add_argument("--by-regime", type=str, default=None, help="Per-regime breakdown")
    parser.add_argument("--tod-curves", action="store_true", help="Time-of-day curves")
    parser.add_argument("--sizing", type=str, default="fixed", choices=["fixed", "risk_pct"])
    parser.add_argument("--output", type=str, default=None, help="Output JSON path")
    args = parser.parse_args()

    results = {}

    if args.holly or args.by_strategy or args.walk_forward or args.tod_curves or args.by_regime:
        bt = HollyBacktester()
        df = bt.load_trades(strategy=args.strategy)
        print(f"Loaded {len(df):,} trades ({df['strategy'].nunique()} strategies)")
        print(f"  Range: {df['trade_date'].min()} to {df['trade_date'].max()}")

        if args.walk_forward > 0:
            print(f"\nWalk-forward ({args.walk_forward} folds)...")
            results = bt.walk_forward(df, n_folds=args.walk_forward, sizing=args.sizing)
            print(f"  OOS Trades: {results['oos_trades']:,}")
            print(f"  OOS Win Rate: {results['oos_win_rate']}%")
            print(f"  OOS Avg PnL: ${results['oos_avg_pnl']:.2f}")
            print(f"  OOS Sharpe: {results['oos_sharpe']}")
            print(f"\n  Folds:")
            for f in results.get("folds", []):
                print(f"    Fold {f['fold']}: {f['test_size']} trades, "
                      f"WR={f['win_rate']}%, Sharpe={f['sharpe']}, "
                      f"PnL=${f['total_pnl']:,.0f}")

        elif args.by_strategy:
            print(f"\nPer-strategy backtest...")
            strat_results = bt.by_strategy(df)
            results = {"strategies": strat_results}
            print(f"\n{'Strategy':<28} {'N':>5} {'WR':>6} {'Sharpe':>7} "
                  f"{'PF':>5} {'MaxDD':>7} {'PnL':>12} {'Kelly':>6}")
            for r in strat_results[:20]:
                print(f"{r['strategy']:<28} {r['n_trades']:>5} {r['win_rate']:>5.1f}% "
                      f"{r['sharpe']:>7.2f} {r['profit_factor']:>5.2f} "
                      f"{r['max_drawdown_pct']:>6.1f}% ${r['total_pnl']:>11,.0f} "
                      f"{r['kelly']:>5.1f}%")

        elif args.by_regime:
            print(f"\nPer-regime backtest ({args.by_regime})...")
            regime_results = bt.by_regime(df, regime_col=args.by_regime)
            results = {"regimes": regime_results}
            for r in regime_results:
                print(f"  {r.get('regime', '?'):<20} {r['n_trades']:>5} trades  "
                      f"WR={r['win_rate']}%  Sharpe={r['sharpe']}  "
                      f"PnL=${r['total_pnl']:,.0f}")

        elif args.tod_curves:
            print(f"\nTime-of-day probability curves...")
            curves = time_of_day_curves(df)
            results = {"tod_curves": curves.to_dict("records")}
            print(f"\n{'Bucket':<8} {'Trades':>7} {'WR':>6} {'Avg PnL':>10} "
                  f"{'Total PnL':>12} {'Sharpe':>7}")
            for _, r in curves.iterrows():
                print(f"{r['time_bucket']:<8} {r['trades']:>7} {r['win_rate']:>5.1%} "
                      f"${r['avg_pnl']:>9,.2f} ${r['total_pnl']:>11,.0f} "
                      f"{r['sharpe_proxy']:>7.3f}")

            # Save CSV
            csv_path = OUTPUT_DIR / "tod_probability_curves.csv"
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            curves.to_csv(csv_path, index=False)
            print(f"\n  Saved: {csv_path}")

        else:
            # Full portfolio backtest
            print(f"\nPortfolio backtest...")
            results = bt.run(df, sizing=args.sizing)
            print(f"\n  Trades:     {results['n_trades']:,}")
            print(f"  Win Rate:   {results['win_rate']}%")
            print(f"  Sharpe:     {results['sharpe']}")
            print(f"  PF:         {results['profit_factor']}")
            print(f"  Max DD:     {results['max_drawdown_pct']}%")
            print(f"  Kelly:      {results['kelly']}%")
            print(f"  CAGR:       {results['cagr_pct']}%")
            print(f"  Total PnL:  ${results['total_pnl']:,.2f}")
            print(f"  Equity:     ${results['equity_final']:,.2f}")

    elif args.signal:
        print(f"Signal backtest on {args.signal}...")
        df = pd.read_csv(args.signal)
        if "timestamp" in df.columns:
            df["timestamp"] = pd.to_datetime(df["timestamp"])
            df.set_index("timestamp", inplace=True)

        # Default: SMA crossover for demo
        df["sma_fast"] = df["close"].rolling(20).mean()
        df["sma_slow"] = df["close"].rolling(50).mean()
        signals = pd.Series(
            np.where(df["sma_fast"] > df["sma_slow"], 1, -1), index=df.index
        )

        bt = SignalBacktester()
        results = bt.run(df, signals)
        for k, v in results.items():
            print(f"  {k}: {v}")

    else:
        parser.print_help()
        return

    # Save JSON output
    if args.output:
        out_path = Path(args.output)
    else:
        out_path = OUTPUT_DIR / "backtest_results.json"
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    class NpEncoder(json.JSONEncoder):
        def default(self, obj):
            if isinstance(obj, (np.integer,)):
                return int(obj)
            if isinstance(obj, (np.floating,)):
                return float(obj)
            if isinstance(obj, (np.ndarray,)):
                return obj.tolist()
            if isinstance(obj, (np.bool_,)):
                return bool(obj)
            return super().default(obj)

    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, cls=NpEncoder)
    print(f"\nResults saved to {out_path}")


if __name__ == "__main__":
    main()
