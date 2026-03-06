"""
05_run_optimization.py — VectorBT exit sweep across all strategies.

Usage:
    python scripts/05_run_optimization.py
    python scripts/05_run_optimization.py --strategy "Guiding Hand Short"
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import MIN_TRADES_FOR_SIGNIFICANCE, OUTPUT_DIR, REPORTS_DIR, EQUITY_DIR
from engine.data_loader import get_db, ensure_schema
from engine.price_paths import build_all_paths
from engine.optimizer import ExitOptimizer
from engine.reporter import generate_heatmap, generate_equity_curve, generate_summary_report


def main():
    parser = argparse.ArgumentParser(description="Holly Exit Optimizer — Parameter Sweep")
    parser.add_argument("--strategy", type=str, default=None,
                        help="Run optimization for a single strategy only")
    parser.add_argument("--top-n", type=int, default=5,
                        help="Number of top parameter sets to report per strategy")
    args = parser.parse_args()

    db = get_db()
    ensure_schema(db)

    # ── Phase A: Build Price Paths ─────────────────────────────
    print("=" * 60)
    print("Phase A: Building price paths...")
    print("=" * 60)

    t0 = time.time()
    paths, trade_meta = build_all_paths(db)
    print(f"  Built in {time.time() - t0:.1f}s")

    # ── Phase B: Parameter Sweep ───────────────────────────────
    print("\n" + "=" * 60)
    print("Phase B: Running parameter sweep...")
    print("=" * 60)

    optimizer = ExitOptimizer(paths, trade_meta)

    if args.strategy:
        strategies = [args.strategy]
    else:
        # Get strategies with enough trades
        strat_counts = trade_meta["strategy"].value_counts()
        strategies = strat_counts[strat_counts >= MIN_TRADES_FOR_SIGNIFICANCE].index.tolist()
        print(f"  Strategies with >= {MIN_TRADES_FOR_SIGNIFICANCE} trades: {len(strategies)}")
        for s in strategies:
            print(f"    {s}: {strat_counts[s]} trades")

    all_results = []

    # Run ALL strategies (including global "ALL")
    print(f"\n--- Running global sweep (all trades) ---")
    t0 = time.time()
    global_results = optimizer.run_all(strategy_filter=None, verbose=True)
    all_results.append(global_results)
    print(f"  Global sweep: {time.time() - t0:.1f}s, {len(global_results)} combos\n")

    for strat in strategies:
        print(f"\n--- Running sweep: {strat} ---")
        t0 = time.time()
        strat_results = optimizer.run_all(strategy_filter=strat, verbose=True)
        all_results.append(strat_results)
        print(f"  {strat}: {time.time() - t0:.1f}s, {len(strat_results)} combos")

    # Combine
    combined = pd.concat(all_results, ignore_index=True)
    print(f"\nTotal result rows: {len(combined)}")

    # ── Phase C: Aggregate and Rank ────────────────────────────
    print("\n" + "=" * 60)
    print("Phase C: Ranking results...")
    print("=" * 60)

    # Save to DuckDB
    db.execute("DELETE FROM optimization_results")
    combined_for_db = combined.copy()
    combined_for_db.insert(0, "run_id", range(1, len(combined_for_db) + 1))
    db.register("results_df", combined_for_db)
    db.execute("""
        INSERT INTO optimization_results
        SELECT
            run_id, CURRENT_TIMESTAMP, strategy_filter, exit_rule, param_json,
            total_trades, win_rate, avg_pnl, total_pnl, max_drawdown,
            profit_factor, sharpe, avg_hold_mins
        FROM results_df
    """)

    # Save optimal params per strategy
    db.execute("DELETE FROM optimal_params")
    for strat in strategies:
        strat_df = combined[combined["strategy_filter"] == strat]
        if strat_df.empty:
            continue
        best = strat_df.nlargest(1, "sharpe").iloc[0]
        db.execute("""
            INSERT INTO optimal_params (strategy, exit_rule, params, win_rate, avg_pnl, total_pnl, profit_factor)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, [
            strat, best["exit_rule"], best["param_json"],
            best["win_rate"], best["avg_pnl"], best["total_pnl"], best["profit_factor"],
        ])

    # Print top results
    print(f"\n{'='*80}")
    print(f"{'Strategy':<30} {'Exit Rule':<20} {'Sharpe':>8} {'Win%':>7} {'Avg P&L':>10} {'Total P&L':>12} {'PF':>6}")
    print(f"{'='*80}")

    for strat in ["ALL"] + strategies:
        strat_df = combined[combined["strategy_filter"] == strat]
        if strat_df.empty:
            continue
        best = strat_df.nlargest(1, "sharpe").iloc[0]

        # Also get baseline
        baseline = strat_df[strat_df["exit_rule"] == "holly_baseline"]
        base_pnl = baseline["total_pnl"].iloc[0] if not baseline.empty else 0

        print(f"{strat:<30} {best['exit_rule']:<20} {best['sharpe']:>8.2f} "
              f"{best['win_rate']:>6.1%} {best['avg_pnl']:>10.2f} "
              f"{best['total_pnl']:>12,.0f} {best['profit_factor']:>6.2f}")

    # ── Generate Reports ───────────────────────────────────────
    print("\n" + "=" * 60)
    print("Generating reports...")
    print("=" * 60)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    EQUITY_DIR.mkdir(parents=True, exist_ok=True)

    # Heatmaps for 2-param rules
    heatmap_configs = [
        ("atr_trail", "atr_multiplier", "atr_period"),
        ("time_decay_trail", "initial_trail_pct", "decay_rate"),
        ("partial_plus_trail", "partial_tp_pct", "trail_pct_after"),
        ("breakeven_plus_trail", "trigger_pct", "trail_pct_after"),
        ("volume_climax", "volume_multiplier", "lookback_bars"),
    ]

    for strat in ["ALL"] + strategies[:5]:  # Top 5 by trade count
        for rule, px, py in heatmap_configs:
            strat_df = combined[(combined["strategy_filter"] == strat) & (combined["exit_rule"] == rule)]
            if len(strat_df) > 1:
                path = generate_heatmap(combined, rule, px, py, "sharpe", strat)
                if path:
                    print(f"  Heatmap: {path.name}")

    # Summary report
    generate_summary_report(combined, strategies)

    db.close()
    print("\nOptimization complete.")
    print(f"Results saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
