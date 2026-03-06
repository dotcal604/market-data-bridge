"""VectorBT parameter sweep orchestration."""

import json
import itertools
import time

import numpy as np
import pandas as pd

from config.settings import (
    MAX_HOLD_MINUTES,
    MIN_TRADES_FOR_SIGNIFICANCE,
    DEFAULT_SHARES,
    COMMISSION_PER_SHARE,
    SLIPPAGE_PER_SHARE,
)
from config.exit_strategies import EXIT_RULES
from engine import exit_rules as er


class ExitOptimizer:
    def __init__(self, paths: np.ndarray, trade_meta: pd.DataFrame):
        self.paths = paths
        self.meta = trade_meta
        self.entries = trade_meta["eff_entry_price"].values.astype(np.float64)
        self.directions = trade_meta["direction_int"].values.astype(np.int64)
        self.holly_exit_bars = trade_meta["holly_exit_bar"].values.astype(np.int64)
        self.all_results: list[dict] = []

    def _compute_metrics(
        self,
        exit_bars: np.ndarray,
        exit_prices: np.ndarray,
        exit_reasons: np.ndarray,
        mask: np.ndarray | None = None,
    ) -> dict:
        """Compute portfolio metrics from exit simulation results."""
        if mask is not None:
            eb = exit_bars[mask]
            ep = exit_prices[mask]
            entries = self.entries[mask]
            dirs = self.directions[mask]
        else:
            eb = exit_bars
            ep = exit_prices
            entries = self.entries
            dirs = self.directions

        n = len(eb)
        if n < MIN_TRADES_FOR_SIGNIFICANCE:
            return None

        # PnL per share (direction-adjusted)
        raw_pnl = (ep - entries) * dirs
        # Apply costs
        costs = (COMMISSION_PER_SHARE + SLIPPAGE_PER_SHARE) * 2  # round-trip
        pnl = (raw_pnl - costs) * DEFAULT_SHARES

        total_pnl = float(np.sum(pnl))
        avg_pnl = float(np.mean(pnl))
        winners = pnl > 0
        win_rate = float(np.sum(winners)) / n

        gross_profit = float(np.sum(pnl[winners])) if np.any(winners) else 0.0
        gross_loss = float(np.abs(np.sum(pnl[~winners]))) if np.any(~winners) else 0.001
        profit_factor = gross_profit / max(gross_loss, 0.001)

        # Max drawdown on cumulative equity
        cum = np.cumsum(pnl)
        running_max = np.maximum.accumulate(cum)
        drawdown = running_max - cum
        max_dd = float(np.max(drawdown)) if len(drawdown) > 0 else 0.0

        # Sharpe (annualized, ~252 days, assume avg ~5 trades/day)
        if np.std(pnl) > 0:
            daily_factor = np.sqrt(252 * 5)
            sharpe = float(np.mean(pnl) / np.std(pnl) * daily_factor)
        else:
            sharpe = 0.0

        avg_hold = float(np.mean(eb))

        # Count ambiguous bars
        ambiguous = int(np.sum(exit_reasons == 3))

        return {
            "total_trades": n,
            "win_rate": round(win_rate, 4),
            "avg_pnl": round(avg_pnl, 2),
            "total_pnl": round(total_pnl, 2),
            "max_drawdown": round(max_dd, 2),
            "profit_factor": round(profit_factor, 3),
            "sharpe": round(sharpe, 3),
            "avg_hold_mins": round(avg_hold, 1),
            "ambiguous_bars": ambiguous,
        }

    def _get_strategy_mask(self, strategy: str | None) -> np.ndarray | None:
        if strategy is None:
            return None
        return (self.meta["strategy"] == strategy).values

    def run_sweep(
        self,
        exit_rule: str,
        param_grid: dict,
        strategy_filter: str | None = None,
    ) -> pd.DataFrame:
        """Run all parameter combinations for a given exit rule."""
        rule_config = EXIT_RULES[exit_rule]
        func_name = rule_config["function"]
        mask = self._get_strategy_mask(strategy_filter)

        max_bars = min(MAX_HOLD_MINUTES, self.paths.shape[1])
        results = []

        # Build parameter combos
        param_names = list(param_grid.keys())
        if not param_names:
            # No params (holly_baseline)
            param_combos = [{}]
        else:
            param_values = [param_grid[k] for k in param_names]
            param_combos = [
                dict(zip(param_names, combo))
                for combo in itertools.product(*param_values)
            ]

        for combo in param_combos:
            func = getattr(er, func_name)

            # Build arguments based on function name
            if func_name == "batch_trailing_stop":
                eb, ep, er_ = func(self.paths, self.entries, self.directions,
                                   combo["trail_pct"], max_bars)
            elif func_name == "batch_atr_trailing_stop":
                eb, ep, er_ = func(self.paths, self.entries, self.directions,
                                   combo["atr_multiplier"], int(combo["atr_period"]), max_bars)
            elif func_name == "batch_time_decay_stop":
                eb, ep, er_ = func(self.paths, self.entries, self.directions,
                                   combo["initial_trail_pct"], combo["decay_rate"], max_bars)
            elif func_name == "batch_take_profit":
                eb, ep, er_ = func(self.paths, self.entries, self.directions,
                                   combo["tp_pct"], max_bars)
            elif func_name == "batch_time_exit":
                eb, ep, er_ = func(self.paths, self.entries, self.directions,
                                   combo["max_hold_minutes"], max_bars)
            elif func_name == "batch_partial_trail":
                eb, ep, er_ = func(self.paths, self.entries, self.directions,
                                   combo["partial_tp_pct"], combo["partial_size"],
                                   combo["trail_pct_after"], max_bars)
            elif func_name == "batch_breakeven_trail":
                eb, ep, er_ = func(self.paths, self.entries, self.directions,
                                   combo["trigger_pct"], combo["trail_pct_after"], max_bars)
            elif func_name == "batch_volume_climax":
                eb, ep, er_ = func(self.paths, self.entries, self.directions,
                                   combo["volume_multiplier"], combo["lookback_bars"], max_bars)
            elif func_name == "batch_holly_baseline":
                eb, ep, er_ = func(self.paths, self.entries, self.directions,
                                   self.holly_exit_bars, max_bars)
            else:
                raise ValueError(f"Unknown function: {func_name}")

            metrics = self._compute_metrics(eb, ep, er_, mask)
            if metrics is None:
                continue

            row = {
                "exit_rule": exit_rule,
                "strategy_filter": strategy_filter or "ALL",
                "param_json": json.dumps({k: round(float(v), 4) for k, v in combo.items()}),
                **metrics,
            }
            results.append(row)

        return pd.DataFrame(results)

    def run_all(self, strategy_filter: str | None = None, verbose: bool = True) -> pd.DataFrame:
        """Run all exit rules with their full parameter grids."""
        all_dfs = []
        for rule_name, rule_config in EXIT_RULES.items():
            t0 = time.time()
            if verbose:
                print(f"  Running {rule_name}...", end=" ", flush=True)

            df = self.run_sweep(rule_name, rule_config["params"], strategy_filter)
            all_dfs.append(df)

            if verbose:
                elapsed = time.time() - t0
                combos = len(df)
                print(f"{combos} combos in {elapsed:.1f}s")

        result = pd.concat(all_dfs, ignore_index=True) if all_dfs else pd.DataFrame()
        self.all_results.extend(result.to_dict("records"))
        return result

    def top_n(self, n: int = 5, strategy: str | None = None) -> pd.DataFrame:
        """Return top N parameter sets ranked by Sharpe."""
        df = pd.DataFrame(self.all_results)
        if df.empty:
            return df

        if strategy:
            df = df[df["strategy_filter"] == strategy]

        df = df[df["total_trades"] >= MIN_TRADES_FOR_SIGNIFICANCE]
        return df.nlargest(n, "sharpe").reset_index(drop=True)

    def top_per_strategy(self, strategies: list[str], n: int = 1) -> pd.DataFrame:
        """Run sweep per strategy and return best params for each."""
        rows = []
        for strat in strategies:
            print(f"\n{'='*60}")
            print(f"Strategy: {strat}")
            print(f"{'='*60}")
            self.all_results = []
            self.run_all(strategy_filter=strat)
            top = self.top_n(n=n, strategy=strat)
            if not top.empty:
                rows.append(top.iloc[0].to_dict())
        return pd.DataFrame(rows)
