"""
07_export_params.py — Export optimal exit parameters to JSON.

Usage:
    python scripts/07_export_params.py
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import OUTPUT_DIR, EXCLUDE_STRATEGIES, MIN_STOP_BUFFER_PCT, MIN_ENTRY_PRICE, MAX_ENTRY_PRICE
from engine.data_loader import get_db


def main():
    db = get_db()

    # Get optimal params
    optimal = db.execute("""
        SELECT strategy, exit_rule, params, win_rate, avg_pnl, total_pnl,
               profit_factor, validated
        FROM optimal_params
        ORDER BY total_pnl DESC
    """).fetchdf()

    if optimal.empty:
        print("ERROR: No optimal params found. Run 05_run_optimization.py first.")
        sys.exit(1)

    # Get trade stats for each strategy
    trade_stats = db.execute("""
        SELECT
            strategy,
            direction,
            COUNT(*) as trade_count,
            AVG(holly_pnl) as baseline_avg_pnl,
            SUM(holly_pnl) as baseline_total_pnl,
            COUNT(CASE WHEN holly_pnl > 0 THEN 1 END)::DOUBLE / COUNT(*) as baseline_win_rate
        FROM trades
        GROUP BY strategy, direction
    """).fetchdf()

    # Global baseline
    global_stats = db.execute("""
        SELECT
            COUNT(*) as total_trades,
            AVG(holly_pnl) as avg_pnl,
            SUM(holly_pnl) as total_pnl,
            MIN(entry_time) as first_trade,
            MAX(entry_time) as last_trade
        FROM trades
    """).fetchone()

    # Get optimization results for Sharpe, max_dd, avg_hold
    opt_results = db.execute("""
        SELECT strategy_filter, exit_rule, param_json, sharpe, max_drawdown, avg_hold_mins
        FROM optimization_results
        WHERE (strategy_filter, exit_rule, param_json) IN (
            SELECT strategy, exit_rule, params FROM optimal_params
        )
    """).fetchdf()

    # Build output
    strategies_out = {}

    for _, row in optimal.iterrows():
        strat = row["strategy"]
        params = json.loads(row["params"])

        # Get trade stats for this strategy
        ts = trade_stats[trade_stats["strategy"] == strat]
        direction = ts["direction"].iloc[0] if not ts.empty else "Unknown"
        trade_count = int(ts["trade_count"].sum()) if not ts.empty else 0
        baseline_wr = float(ts["baseline_win_rate"].iloc[0]) if not ts.empty else 0
        baseline_avg = float(ts["baseline_avg_pnl"].iloc[0]) if not ts.empty else 0
        baseline_total = float(ts["baseline_total_pnl"].sum()) if not ts.empty else 0

        # Get extended metrics from optimization_results
        opt_row = opt_results[
            (opt_results["strategy_filter"] == strat)
            & (opt_results["exit_rule"] == row["exit_rule"])
        ]
        sharpe = float(opt_row["sharpe"].iloc[0]) if not opt_row.empty else 0
        max_dd = float(opt_row["max_drawdown"].iloc[0]) if not opt_row.empty else 0
        avg_hold = float(opt_row["avg_hold_mins"].iloc[0]) if not opt_row.empty else 0

        strategies_out[strat] = {
            "direction": direction,
            "trade_count": trade_count,
            "exit_rule": row["exit_rule"],
            "params": params,
            "baseline": {
                "win_rate": round(baseline_wr, 4),
                "avg_pnl": round(baseline_avg, 2),
                "total_pnl": round(baseline_total, 2),
            },
            "optimized": {
                "win_rate": round(float(row["win_rate"]), 4),
                "avg_pnl": round(float(row["avg_pnl"]), 2),
                "total_pnl": round(float(row["total_pnl"]), 2),
                "profit_factor": round(float(row["profit_factor"]), 3),
                "sharpe": round(sharpe, 3),
                "max_drawdown": round(max_dd, 2),
                "avg_hold_minutes": round(avg_hold, 1),
            },
            "validated": bool(row["validated"]),
        }

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_range": f"{global_stats[3]} to {global_stats[4]}",
        "total_trades_analyzed": int(global_stats[0]),
        "polygon_tier": "Developer",
        "baseline_avg_pnl": round(float(global_stats[1]), 2),
        "baseline_total_pnl": round(float(global_stats[2]), 2),
        "strategies": strategies_out,
        "global_filters": {
            "exclude_strategies": EXCLUDE_STRATEGIES,
            "min_stop_buffer_pct": MIN_STOP_BUFFER_PCT,
            "price_range": [MIN_ENTRY_PRICE, MAX_ENTRY_PRICE],
        },
    }

    # Write
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "optimal_exit_params.json"
    out_path.write_text(json.dumps(output, indent=2, default=str), encoding="utf-8")

    print(f"Exported {len(strategies_out)} strategy configurations")
    print(f"Output: {out_path}")
    print(f"\nBaseline: avg P&L ${global_stats[1]:.2f}, total ${global_stats[2]:,.0f}")
    print(f"Optimized strategies:")

    for strat, data in strategies_out.items():
        improvement = "N/A"
        if data["baseline"]["total_pnl"] != 0:
            imp = (data["optimized"]["total_pnl"] - data["baseline"]["total_pnl"]) / abs(data["baseline"]["total_pnl"]) * 100
            improvement = f"{imp:+.0f}%"
        print(f"  {strat:<30} {data['exit_rule']:<20} "
              f"${data['optimized']['total_pnl']:>10,.0f} ({improvement})")

    db.close()
    print("\nDone. This JSON is ready for Layer 2 MCP consumption.")


if __name__ == "__main__":
    main()
