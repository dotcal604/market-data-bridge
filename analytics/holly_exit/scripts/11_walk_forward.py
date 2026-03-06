"""
11_walk_forward.py — Walk-forward validation for Holly Exit Optimizer.

Splits trades by date into train/test windows, optimizes on train data,
then evaluates on out-of-sample test data to detect overfitting.

Usage:
    python scripts/11_walk_forward.py
    python scripts/11_walk_forward.py --train-pct 0.7
    python scripts/11_walk_forward.py --rolling --n-folds 5
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import MIN_TRADES_FOR_SIGNIFICANCE, OUTPUT_DIR
from config.exit_strategies import EXIT_RULES
from engine.data_loader import get_db, ensure_schema
from engine.price_paths import build_all_paths
from engine.optimizer import ExitOptimizer


def split_by_date(
    trade_meta: pd.DataFrame,
    train_pct: float = 0.60,
) -> tuple[np.ndarray, np.ndarray]:
    """Split trades into train/test by entry_time."""
    entry_times = pd.to_datetime(trade_meta["entry_time"])
    sorted_idx = entry_times.argsort()
    n = len(sorted_idx)
    split_point = int(n * train_pct)

    train_mask = np.zeros(n, dtype=bool)
    test_mask = np.zeros(n, dtype=bool)
    train_mask[sorted_idx[:split_point]] = True
    test_mask[sorted_idx[split_point:]] = True

    return train_mask, test_mask


def rolling_splits(
    trade_meta: pd.DataFrame,
    n_folds: int = 5,
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Generate rolling train/test splits (expanding window)."""
    entry_times = pd.to_datetime(trade_meta["entry_time"])
    sorted_idx = entry_times.argsort().values
    n = len(sorted_idx)

    splits = []
    fold_size = n // (n_folds + 1)  # Each fold is ~1/(n+1) of data

    for fold in range(n_folds):
        # Train: everything up to fold boundary
        train_end = fold_size * (fold + 1)
        # Test: next fold_size trades
        test_end = min(train_end + fold_size, n)

        train_mask = np.zeros(n, dtype=bool)
        test_mask = np.zeros(n, dtype=bool)
        train_mask[sorted_idx[:train_end]] = True
        test_mask[sorted_idx[train_end:test_end]] = True

        splits.append((train_mask, test_mask))

    return splits


def evaluate_on_subset(
    optimizer: ExitOptimizer,
    exit_rule: str,
    params: dict,
    mask: np.ndarray,
) -> dict | None:
    """Run a single exit rule with given params on a masked subset."""
    from engine import exit_rules as er

    rule_config = EXIT_RULES[exit_rule]
    func_name = rule_config["function"]
    func = getattr(er, func_name)
    max_bars = min(240, optimizer.paths.shape[1])

    if func_name == "batch_trailing_stop":
        eb, ep, er_ = func(optimizer.paths, optimizer.entries, optimizer.directions,
                           params["trail_pct"], max_bars)
    elif func_name == "batch_atr_trailing_stop":
        eb, ep, er_ = func(optimizer.paths, optimizer.entries, optimizer.directions,
                           params["atr_multiplier"], int(params["atr_period"]), max_bars)
    elif func_name == "batch_time_decay_stop":
        eb, ep, er_ = func(optimizer.paths, optimizer.entries, optimizer.directions,
                           params["initial_trail_pct"], params["decay_rate"], max_bars)
    elif func_name == "batch_take_profit":
        eb, ep, er_ = func(optimizer.paths, optimizer.entries, optimizer.directions,
                           params["tp_pct"], max_bars)
    elif func_name == "batch_time_exit":
        eb, ep, er_ = func(optimizer.paths, optimizer.entries, optimizer.directions,
                           params["max_hold_minutes"], max_bars)
    elif func_name == "batch_partial_trail":
        eb, ep, er_ = func(optimizer.paths, optimizer.entries, optimizer.directions,
                           params["partial_tp_pct"], params["partial_size"],
                           params["trail_pct_after"], max_bars)
    elif func_name == "batch_breakeven_trail":
        eb, ep, er_ = func(optimizer.paths, optimizer.entries, optimizer.directions,
                           params["trigger_pct"], params["trail_pct_after"], max_bars)
    elif func_name == "batch_volume_climax":
        eb, ep, er_ = func(optimizer.paths, optimizer.entries, optimizer.directions,
                           params["volume_multiplier"], params["lookback_bars"], max_bars)
    elif func_name == "batch_holly_baseline":
        eb, ep, er_ = func(optimizer.paths, optimizer.entries, optimizer.directions,
                           optimizer.holly_exit_bars, max_bars)
    else:
        return None

    return optimizer._compute_metrics(eb, ep, er_, mask)


def run_walk_forward(
    paths: np.ndarray,
    trade_meta: pd.DataFrame,
    train_mask: np.ndarray,
    test_mask: np.ndarray,
    strategies: list[str],
    fold_label: str = "single",
) -> list[dict]:
    """Run optimization on train, evaluate on test, compare."""

    # Create optimizer with full data (masks filter during metrics computation)
    optimizer = ExitOptimizer(paths, trade_meta)

    results = []

    for strat in strategies:
        strat_mask = (trade_meta["strategy"] == strat).values

        # Train mask = strategy + train split
        train_strat = strat_mask & train_mask
        test_strat = strat_mask & test_mask

        n_train = int(np.sum(train_strat))
        n_test = int(np.sum(test_strat))

        if n_train < MIN_TRADES_FOR_SIGNIFICANCE or n_test < 10:
            continue

        # Find best params on TRAIN data
        best_sharpe = -999.0
        best_rule = None
        best_params = None
        best_train_metrics = None

        for rule_name, rule_config in EXIT_RULES.items():
            if rule_name == "holly_baseline":
                continue  # Skip baseline — we compare against it separately

            param_names = list(rule_config["params"].keys())
            if not param_names:
                continue

            import itertools
            param_values = [rule_config["params"][k] for k in param_names]
            for combo_vals in itertools.product(*param_values):
                combo = dict(zip(param_names, combo_vals))
                combo_float = {k: float(v) for k, v in combo.items()}

                metrics = evaluate_on_subset(optimizer, rule_name, combo_float, train_strat)
                if metrics is None:
                    continue

                if metrics["sharpe"] > best_sharpe:
                    best_sharpe = metrics["sharpe"]
                    best_rule = rule_name
                    best_params = combo_float
                    best_train_metrics = metrics

        if best_rule is None:
            continue

        # Evaluate best params on TEST data
        test_metrics = evaluate_on_subset(optimizer, best_rule, best_params, test_strat)

        # Also get baseline (holly exits) on both sets
        train_baseline = evaluate_on_subset(optimizer, "holly_baseline", {}, train_strat)
        test_baseline = evaluate_on_subset(optimizer, "holly_baseline", {}, test_strat)

        if test_metrics is None:
            continue

        # Compute degradation metrics
        sharpe_decay = (
            (best_train_metrics["sharpe"] - test_metrics["sharpe"]) /
            max(abs(best_train_metrics["sharpe"]), 0.001)
        ) if best_train_metrics["sharpe"] != 0 else 0

        pf_decay = (
            (best_train_metrics["profit_factor"] - test_metrics["profit_factor"]) /
            max(best_train_metrics["profit_factor"], 0.001)
        ) if best_train_metrics["profit_factor"] > 0 else 0

        # Flag overfitting: >50% Sharpe decay or test PF < 1.0
        overfit = sharpe_decay > 0.50 or test_metrics["profit_factor"] < 1.0
        robust = not overfit and test_metrics["sharpe"] > 1.0

        results.append({
            "fold": fold_label,
            "strategy": strat,
            "n_train": n_train,
            "n_test": n_test,
            "exit_rule": best_rule,
            "params": json.dumps(best_params),
            # In-sample (train)
            "train_sharpe": best_train_metrics["sharpe"],
            "train_pf": best_train_metrics["profit_factor"],
            "train_wr": best_train_metrics["win_rate"],
            "train_avg_pnl": best_train_metrics["avg_pnl"],
            # Out-of-sample (test)
            "test_sharpe": test_metrics["sharpe"],
            "test_pf": test_metrics["profit_factor"],
            "test_wr": test_metrics["win_rate"],
            "test_avg_pnl": test_metrics["avg_pnl"],
            # Baseline comparison
            "test_baseline_sharpe": test_baseline["sharpe"] if test_baseline else None,
            "test_baseline_pf": test_baseline["profit_factor"] if test_baseline else None,
            # Degradation
            "sharpe_decay_pct": round(sharpe_decay * 100, 1),
            "pf_decay_pct": round(pf_decay * 100, 1),
            "overfit": overfit,
            "robust": robust,
        })

    return results


def main():
    parser = argparse.ArgumentParser(description="Holly Exit — Walk-Forward Validation")
    parser.add_argument("--train-pct", type=float, default=0.60,
                        help="Train set fraction (default: 0.60)")
    parser.add_argument("--rolling", action="store_true",
                        help="Use rolling expanding-window splits instead of single split")
    parser.add_argument("--n-folds", type=int, default=5,
                        help="Number of rolling folds (default: 5)")
    args = parser.parse_args()

    db = get_db()
    ensure_schema(db)

    # Build price paths (uses all data)
    print("=" * 60)
    print("Building price paths...")
    print("=" * 60)
    t0 = time.time()
    paths, trade_meta = build_all_paths(db)
    print(f"  Built in {time.time() - t0:.1f}s\n")

    # Get strategies with enough trades
    strat_counts = trade_meta["strategy"].value_counts()
    strategies = strat_counts[strat_counts >= MIN_TRADES_FOR_SIGNIFICANCE * 2].index.tolist()
    print(f"Strategies with >= {MIN_TRADES_FOR_SIGNIFICANCE * 2} trades: {len(strategies)}")

    # Date range
    entry_times = pd.to_datetime(trade_meta["entry_time"])
    print(f"Date range: {entry_times.min().date()} to {entry_times.max().date()}")

    all_results = []

    if args.rolling:
        # Rolling expanding-window walk-forward
        print(f"\n{'=' * 60}")
        print(f"Rolling Walk-Forward ({args.n_folds} folds)")
        print(f"{'=' * 60}")

        splits = rolling_splits(trade_meta, n_folds=args.n_folds)

        for i, (train_mask, test_mask) in enumerate(splits):
            train_dates = entry_times[train_mask]
            test_dates = entry_times[test_mask]
            print(f"\n--- Fold {i+1}/{args.n_folds} ---")
            print(f"  Train: {train_dates.min().date()} to {train_dates.max().date()} ({int(train_mask.sum())} trades)")
            print(f"  Test:  {test_dates.min().date()} to {test_dates.max().date()} ({int(test_mask.sum())} trades)")

            t0 = time.time()
            fold_results = run_walk_forward(
                paths, trade_meta, train_mask, test_mask, strategies,
                fold_label=f"fold_{i+1}",
            )
            all_results.extend(fold_results)
            print(f"  Completed in {time.time() - t0:.1f}s — {len(fold_results)} strategies evaluated")

    else:
        # Single train/test split
        print(f"\n{'=' * 60}")
        print(f"Single Split Walk-Forward (train={args.train_pct:.0%} / test={1 - args.train_pct:.0%})")
        print(f"{'=' * 60}")

        train_mask, test_mask = split_by_date(trade_meta, train_pct=args.train_pct)

        train_dates = entry_times[train_mask]
        test_dates = entry_times[test_mask]
        print(f"  Train: {train_dates.min().date()} to {train_dates.max().date()} ({int(train_mask.sum())} trades)")
        print(f"  Test:  {test_dates.min().date()} to {test_dates.max().date()} ({int(test_mask.sum())} trades)")

        t0 = time.time()
        all_results = run_walk_forward(
            paths, trade_meta, train_mask, test_mask, strategies,
            fold_label="single",
        )
        print(f"\n  Completed in {time.time() - t0:.1f}s — {len(all_results)} strategies evaluated")

    if not all_results:
        print("\nNo results — not enough trades per strategy for walk-forward validation.")
        db.close()
        return

    # Results summary
    df = pd.DataFrame(all_results)

    print(f"\n{'=' * 80}")
    print("WALK-FORWARD RESULTS")
    print(f"{'=' * 80}")
    print(f"\n{'Strategy':<28} {'Rule':<18} {'Train':>7} {'Test':>7} "
          f"{'TrainPF':>8} {'TestPF':>7} {'Decay%':>7} {'Status':<10}")
    print("-" * 105)

    for _, row in df.iterrows():
        if row["fold"] != "single" and row["fold"] != "fold_1":
            continue  # Only print first fold for rolling

        status = "ROBUST" if row["robust"] else ("OVERFIT" if row["overfit"] else "MARGINAL")
        marker = "***" if row["robust"] else ("!!!" if row["overfit"] else "   ")

        print(f"{row['strategy']:<28} {row['exit_rule']:<18} "
              f"{row['train_sharpe']:>7.2f} {row['test_sharpe']:>7.2f} "
              f"{row['train_pf']:>8.2f} {row['test_pf']:>7.2f} "
              f"{row['sharpe_decay_pct']:>6.1f}% "
              f"{marker}{status}")

    # Summary stats
    n_robust = int(df["robust"].sum())
    n_overfit = int(df["overfit"].sum())
    n_marginal = len(df) - n_robust - n_overfit

    print(f"\n{'=' * 60}")
    print(f"Summary: {n_robust} robust, {n_marginal} marginal, {n_overfit} overfit")
    print(f"{'=' * 60}")

    if args.rolling:
        # Average across folds for rolling
        avg_by_strat = df.groupby("strategy").agg({
            "test_sharpe": "mean",
            "test_pf": "mean",
            "sharpe_decay_pct": "mean",
            "robust": "mean",
        }).sort_values("test_sharpe", ascending=False)

        print(f"\nAverage across {args.n_folds} folds:")
        print(f"{'Strategy':<28} {'Avg OOS Sharpe':>14} {'Avg OOS PF':>10} {'Avg Decay%':>10} {'Robust%':>8}")
        print("-" * 75)
        for strat, row in avg_by_strat.iterrows():
            print(f"{strat:<28} {row['test_sharpe']:>14.2f} {row['test_pf']:>10.2f} "
                  f"{row['sharpe_decay_pct']:>9.1f}% {row['robust']:>7.0%}")

    # Save results
    output_path = OUTPUT_DIR / "walk_forward_results.csv"
    df.to_csv(output_path, index=False)
    print(f"\nResults saved to {output_path}")

    # Save JSON summary for suggest-exits integration
    robust_strategies = df[df["robust"]].groupby("strategy").first().reset_index()
    wf_summary = {
        "generated_at": pd.Timestamp.now().isoformat(),
        "method": "rolling" if args.rolling else "single_split",
        "train_pct": args.train_pct if not args.rolling else None,
        "n_folds": args.n_folds if args.rolling else None,
        "total_strategies": len(df["strategy"].unique()),
        "robust_count": n_robust,
        "overfit_count": n_overfit,
        "robust_strategies": robust_strategies[
            ["strategy", "exit_rule", "params", "test_sharpe", "test_pf", "test_wr"]
        ].to_dict("records") if not robust_strategies.empty else [],
    }
    json_path = OUTPUT_DIR / "walk_forward_summary.json"
    with open(json_path, "w") as f:
        json.dump(wf_summary, f, indent=2, default=str)
    print(f"Summary saved to {json_path}")

    db.close()
    print("\nWalk-forward validation complete.")


if __name__ == "__main__":
    main()
