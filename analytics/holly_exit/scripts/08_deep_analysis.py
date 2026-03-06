"""
08_deep_analysis.py — Deep analysis of Holly Exit Optimizer results.

Investigates:
  1. Direction inference bug (direction_int=0 trades causing unrealistic P&L)
  2. Strategy-level performance: baseline vs optimized, with/without unknown directions
  3. Exit rule effectiveness across all strategies
  4. Trade distribution: time of day, day of week, seasonality
  5. Bar data quality: coverage gaps, stale prices
  6. Risk-adjusted metrics: Sharpe, Sortino, Calmar, max drawdown, recovery factor
  7. Walk-forward stability check (first half vs second half)
  8. Correlation between strategies (diversification potential)
  9. Outlier analysis: which trades drive the most P&L skew
 10. Actionable recommendations

Usage:
    python scripts/08_deep_analysis.py
    python scripts/08_deep_analysis.py --html   # generate HTML report
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import (
    OUTPUT_DIR, DATA_DIR, DUCKDB_PATH,
    DEFAULT_SHARES, COMMISSION_PER_SHARE, SLIPPAGE_PER_SHARE,
    MIN_TRADES_FOR_SIGNIFICANCE, MAX_HOLD_MINUTES,
)
from engine.data_loader import get_db


def section(title: str):
    print(f"\n{'='*80}")
    print(f"  {title}")
    print(f"{'='*80}\n")


def subsection(title: str):
    print(f"\n--- {title} ---\n")


def pct(val, total):
    return f"{val/total*100:.1f}%" if total > 0 else "N/A"


def main():
    parser = argparse.ArgumentParser(description="Holly Exit Optimizer — Deep Analysis")
    parser.add_argument("--html", action="store_true", help="Generate HTML report")
    args = parser.parse_args()

    db = get_db()
    report_lines = []

    def log(line=""):
        # Sanitize for Windows cp1252 console
        safe = line.encode("ascii", errors="replace").decode("ascii")
        print(safe, flush=True)
        report_lines.append(line)

    # ================================================================
    # SECTION 1: Data Inventory
    # ================================================================
    section("1. DATA INVENTORY")

    trades = db.execute("SELECT * FROM trades ORDER BY entry_time").fetchdf()
    bars_stats = db.execute("""
        SELECT
            COUNT(*) as total_bars,
            COUNT(DISTINCT symbol) as unique_symbols,
            MIN(bar_time) as first_bar,
            MAX(bar_time) as last_bar
        FROM bars
    """).fetchone()

    opt_results = db.execute("SELECT * FROM optimization_results").fetchdf()
    optimal = db.execute("SELECT * FROM optimal_params").fetchdf()

    log(f"Trades:              {len(trades):,}")
    log(f"Bars:                {bars_stats[0]:,}")
    log(f"Bar symbols:         {bars_stats[1]:,}")
    log(f"Bar range:           {bars_stats[2]} to {bars_stats[3]}")
    log(f"Optimization runs:   {len(opt_results):,}")
    log(f"Optimal strategies:  {len(optimal):,}")
    log()

    # Trade date range
    trades["entry_dt"] = pd.to_datetime(trades["entry_time"])
    log(f"Trade range:         {trades['entry_dt'].min()} to {trades['entry_dt'].max()}")
    log(f"Unique symbols:      {trades['symbol'].nunique()}")
    log(f"Unique strategies:   {trades['strategy'].nunique()}")

    # ================================================================
    # SECTION 2: Direction Inference Analysis (THE BUG)
    # ================================================================
    section("2. DIRECTION INFERENCE — THE BUG")

    dir_counts = trades["direction"].value_counts()
    log("Direction distribution:")
    for d, c in dir_counts.items():
        log(f"  {d:<10} {c:>6,}  ({pct(c, len(trades))})")

    # Trades with unknown/missing direction
    unknown_mask = ~trades["direction"].isin(["Long", "Short"])
    unknown = trades[unknown_mask]
    log(f"\nUnknown direction trades: {len(unknown):,} ({pct(len(unknown), len(trades))})")

    if len(unknown) > 0:
        log(f"\nStrategies with unknown direction:")
        for strat, count in unknown["strategy"].value_counts().head(20).items():
            log(f"  {strat:<35} {count:>5} trades")

        # Impact analysis: what happens to P&L when direction_int = 0
        # direction_int = 0 means (exit - entry) * 0 = 0 PnL for EVERY trade
        # But wait — let's check what the optimizer actually does with these
        log(f"\n[WARNING]  CRITICAL: direction_int=0 means PnL = (exit - entry) × 0 = $0 for every trade")
        log(f"   These trades contribute ZERO to total P&L but ARE counted in trade count,")
        log(f"   win rate (always win since pnl >= -costs ≈ $0), and Sharpe denominator.")
        log(f"   This inflates win rates and distorts Sharpe ratios for affected strategies.")

        # Which optimal strategies are affected?
        affected_strategies = unknown["strategy"].unique()
        affected_optimal = optimal[optimal["strategy"].isin(affected_strategies)]
        log(f"\nOptimal params affected by direction bug: {len(affected_optimal)}/{len(optimal)}")
        for _, row in affected_optimal.iterrows():
            n_unknown = len(unknown[unknown["strategy"] == row["strategy"]])
            n_total = len(trades[trades["strategy"] == row["strategy"]])
            log(f"  {row['strategy']:<35} {n_unknown}/{n_total} unknown "
                f"({pct(n_unknown, n_total)})  total_pnl=${row['total_pnl']:>14,.0f}")

    # ================================================================
    # SECTION 3: Clean vs Dirty Strategy Comparison
    # ================================================================
    section("3. CLEAN vs DIRTY STRATEGY COMPARISON")

    subsection("3a. Strategies with ZERO unknown-direction trades (clean)")
    clean_strategies = []
    dirty_strategies = []

    for strat in trades["strategy"].unique():
        strat_trades = trades[trades["strategy"] == strat]
        n_unknown = (~strat_trades["direction"].isin(["Long", "Short"])).sum()
        n_total = len(strat_trades)
        if n_unknown == 0:
            clean_strategies.append(strat)
        else:
            dirty_strategies.append((strat, n_unknown, n_total))

    log(f"Clean strategies: {len(clean_strategies)}")
    log(f"Dirty strategies: {len(dirty_strategies)}")

    # Show clean strategy optimization results (these are trustworthy)
    clean_optimal = optimal[optimal["strategy"].isin(clean_strategies)]
    if not clean_optimal.empty:
        log(f"\n{'Strategy':<35} {'Exit Rule':<22} {'Win%':>7} {'Avg P&L':>10} {'Total P&L':>14} {'PF':>7}")
        log("-" * 100)
        for _, row in clean_optimal.sort_values("total_pnl", ascending=False).iterrows():
            log(f"{row['strategy']:<35} {row['exit_rule']:<22} "
                f"{row['win_rate']:>6.1%} ${row['avg_pnl']:>9.2f} "
                f"${row['total_pnl']:>13,.0f} {row['profit_factor']:>7.2f}")

    subsection("3b. Dirty strategies (contaminated by direction_int=0)")
    if dirty_strategies:
        log(f"{'Strategy':<35} {'Unknown':>8} {'Total':>7} {'%':>6}")
        log("-" * 60)
        for strat, n_unknown, n_total in sorted(dirty_strategies, key=lambda x: -x[1]):
            log(f"{strat:<35} {n_unknown:>8} {n_total:>7} {pct(n_unknown, n_total):>6}")

    # ================================================================
    # SECTION 4: Baseline Performance (Holly's Own Exits)
    # ================================================================
    section("4. HOLLY BASELINE PERFORMANCE")

    baseline = opt_results[opt_results["exit_rule"] == "holly_baseline"]

    if not baseline.empty:
        log(f"{'Strategy':<35} {'Trades':>7} {'Win%':>7} {'Avg P&L':>10} {'Total P&L':>14} {'Sharpe':>8}")
        log("-" * 90)
        for _, row in baseline.sort_values("total_pnl", ascending=False).iterrows():
            log(f"{row['strategy_filter']:<35} {row['total_trades']:>7} "
                f"{row['win_rate']:>6.1%} ${row['avg_pnl']:>9.2f} "
                f"${row['total_pnl']:>13,.0f} {row['sharpe']:>8.2f}")

    # ================================================================
    # SECTION 5: Exit Rule Effectiveness
    # ================================================================
    section("5. EXIT RULE EFFECTIVENESS (across all strategies)")

    # For each exit rule, what's the average improvement over baseline?
    rule_summary = opt_results.groupby("exit_rule").agg(
        avg_sharpe=("sharpe", "mean"),
        max_sharpe=("sharpe", "max"),
        avg_pf=("profit_factor", "mean"),
        avg_wr=("win_rate", "mean"),
        combos=("run_id", "count"),
    ).sort_values("avg_sharpe", ascending=False)

    log(f"{'Exit Rule':<25} {'Combos':>7} {'Avg Sharpe':>11} {'Max Sharpe':>11} {'Avg PF':>8} {'Avg WR':>8}")
    log("-" * 75)
    for rule, row in rule_summary.iterrows():
        log(f"{rule:<25} {row['combos']:>7} {row['avg_sharpe']:>11.2f} "
            f"{row['max_sharpe']:>11.2f} {row['avg_pf']:>8.2f} {row['avg_wr']:>7.1%}")

    # ================================================================
    # SECTION 6: Best Combinations (Clean Only)
    # ================================================================
    section("6. BEST CLEAN COMBINATIONS (excluding direction-buggy strategies)")

    clean_results = opt_results[opt_results["strategy_filter"].isin(clean_strategies)]
    if not clean_results.empty:
        top_clean = clean_results.nlargest(20, "sharpe")
        log(f"{'Strategy':<30} {'Exit Rule':<22} {'Sharpe':>8} {'Win%':>7} "
            f"{'Total P&L':>14} {'PF':>7} {'Trades':>7}")
        log("-" * 100)
        for _, row in top_clean.iterrows():
            log(f"{row['strategy_filter']:<30} {row['exit_rule']:<22} "
                f"{row['sharpe']:>8.2f} {row['win_rate']:>6.1%} "
                f"${row['total_pnl']:>13,.0f} {row['profit_factor']:>7.2f} "
                f"{row['total_trades']:>7}")

    # ================================================================
    # SECTION 7: Trade Distribution Analysis
    # ================================================================
    section("7. TRADE DISTRIBUTION")

    subsection("7a. By Year")
    trades["year"] = trades["entry_dt"].dt.year
    year_dist = trades.groupby("year").agg(
        trades=("trade_id", "count"),
        avg_pnl=("holly_pnl", "mean"),
        total_pnl=("holly_pnl", "sum"),
        symbols=("symbol", "nunique"),
    )
    log(f"{'Year':>6} {'Trades':>8} {'Symbols':>8} {'Avg P&L':>10} {'Total P&L':>14}")
    log("-" * 50)
    for yr, row in year_dist.iterrows():
        log(f"{yr:>6} {row['trades']:>8} {row['symbols']:>8} "
            f"${row['avg_pnl']:>9.2f} ${row['total_pnl']:>13,.0f}")

    subsection("7b. By Day of Week")
    trades["dow"] = trades["entry_dt"].dt.day_name()
    dow_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    dow_dist = trades.groupby("dow").agg(
        trades=("trade_id", "count"),
        avg_pnl=("holly_pnl", "mean"),
        win_rate=("holly_pnl", lambda x: (x > 0).mean()),
    ).reindex(dow_order)
    log(f"{'Day':<12} {'Trades':>8} {'Avg P&L':>10} {'Win Rate':>9}")
    log("-" * 42)
    for dow, row in dow_dist.iterrows():
        log(f"{dow:<12} {row['trades']:>8} ${row['avg_pnl']:>9.2f} {row['win_rate']:>8.1%}")

    subsection("7c. By Hour of Day (ET)")
    trades["hour"] = trades["entry_dt"].dt.hour
    hour_dist = trades.groupby("hour").agg(
        trades=("trade_id", "count"),
        avg_pnl=("holly_pnl", "mean"),
        win_rate=("holly_pnl", lambda x: (x > 0).mean()),
    )
    log(f"{'Hour':>6} {'Trades':>8} {'Avg P&L':>10} {'Win Rate':>9}")
    log("-" * 36)
    for hour, row in hour_dist.iterrows():
        log(f"{hour:>5}h {row['trades']:>8} ${row['avg_pnl']:>9.2f} {row['win_rate']:>8.1%}")

    # ================================================================
    # SECTION 8: Walk-Forward Stability
    # ================================================================
    section("8. WALK-FORWARD STABILITY (first half vs second half)")

    midpoint = trades["entry_dt"].median()
    log(f"Split point: {midpoint}")
    log(f"First half:  {trades['entry_dt'].min()} to {midpoint}")
    log(f"Second half: {midpoint} to {trades['entry_dt'].max()}")

    first_half = trades[trades["entry_dt"] <= midpoint]
    second_half = trades[trades["entry_dt"] > midpoint]
    log(f"\nFirst half:  {len(first_half):,} trades")
    log(f"Second half: {len(second_half):,} trades")

    log(f"\n{'Strategy':<30} {'1H Avg P&L':>11} {'2H Avg P&L':>11} {'1H WR':>7} {'2H WR':>7} {'Stable?':>8}")
    log("-" * 80)

    for strat in clean_strategies:
        h1 = first_half[first_half["strategy"] == strat]
        h2 = second_half[second_half["strategy"] == strat]
        if len(h1) < 15 or len(h2) < 15:
            continue

        avg1 = h1["holly_pnl"].mean()
        avg2 = h2["holly_pnl"].mean()
        wr1 = (h1["holly_pnl"] > 0).mean()
        wr2 = (h2["holly_pnl"] > 0).mean()

        # Stable if both halves have same sign avg_pnl and WR within 15%
        same_sign = (avg1 > 0) == (avg2 > 0)
        wr_close = abs(wr1 - wr2) < 0.15
        stable = "YES" if (same_sign and wr_close) else "NO"

        log(f"{strat:<30} ${avg1:>10.2f} ${avg2:>10.2f} "
            f"{wr1:>6.1%} {wr2:>6.1%} {stable:>8}")

    # ================================================================
    # SECTION 9: Outlier Analysis
    # ================================================================
    section("9. OUTLIER ANALYSIS")

    subsection("9a. Top 20 P&L Trades (Holly exits)")
    top_winners = trades.nlargest(10, "holly_pnl")
    top_losers = trades.nsmallest(10, "holly_pnl")

    log(f"{'Symbol':<8} {'Strategy':<30} {'Dir':>5} {'P&L':>12} {'Date'}")
    log("-" * 80)
    for _, t in pd.concat([top_winners, top_losers]).iterrows():
        log(f"{t['symbol']:<8} {t['strategy']:<30} {t['direction']:>5} "
            f"${t['holly_pnl']:>11,.2f} {str(t['entry_time'])[:10]}")

    subsection("9b. P&L Distribution Stats")
    pnl = trades["holly_pnl"].dropna()
    log(f"Mean:     ${pnl.mean():>10.2f}")
    log(f"Median:   ${pnl.median():>10.2f}")
    log(f"Std Dev:  ${pnl.std():>10.2f}")
    log(f"Skewness: {pnl.skew():>10.3f}")
    log(f"Kurtosis: {pnl.kurtosis():>10.3f}")
    log(f"Min:      ${pnl.min():>10.2f}")
    log(f"Max:      ${pnl.max():>10.2f}")
    log(f"IQR:      ${pnl.quantile(0.75) - pnl.quantile(0.25):>10.2f}")

    # P&L percentiles
    percentiles = [1, 5, 10, 25, 50, 75, 90, 95, 99]
    log(f"\nPercentiles:")
    for p in percentiles:
        log(f"  P{p:<3} ${pnl.quantile(p/100):>10.2f}")

    # ================================================================
    # SECTION 10: Bar Data Quality
    # ================================================================
    section("10. BAR DATA QUALITY")

    coverage = db.execute("""
        SELECT
            t.strategy,
            COUNT(*) as total_trades,
            COUNT(b.symbol) as trades_with_bars,
            ROUND(COUNT(b.symbol)::DOUBLE / COUNT(*) * 100, 1) as coverage_pct
        FROM trades t
        LEFT JOIN (
            SELECT DISTINCT symbol, CAST(bar_time AS DATE) as bar_date
            FROM bars
        ) b ON t.symbol = b.symbol AND CAST(t.entry_time AS DATE) = b.bar_date
        GROUP BY t.strategy
        ORDER BY coverage_pct ASC
    """).fetchdf()

    log(f"{'Strategy':<35} {'Total':>7} {'W/Bars':>7} {'Coverage':>9}")
    log("-" * 62)
    for _, row in coverage.iterrows():
        flag = " [WARNING]" if row["coverage_pct"] < 50 else ""
        log(f"{row['strategy']:<35} {row['total_trades']:>7} "
            f"{row['trades_with_bars']:>7} {row['coverage_pct']:>8.1f}%{flag}")

    # ================================================================
    # SECTION 11: Strategy Correlation Matrix
    # ================================================================
    section("11. STRATEGY CORRELATION (daily P&L)")

    # Build daily P&L per strategy
    trades_with_pnl = trades[trades["holly_pnl"].notna()].copy()
    trades_with_pnl["trade_date"] = trades_with_pnl["entry_dt"].dt.date

    # Only clean strategies with enough data
    strat_daily = {}
    for strat in clean_strategies:
        s_trades = trades_with_pnl[trades_with_pnl["strategy"] == strat]
        if len(s_trades) < MIN_TRADES_FOR_SIGNIFICANCE:
            continue
        daily = s_trades.groupby("trade_date")["holly_pnl"].sum()
        strat_daily[strat] = daily

    if len(strat_daily) >= 3:
        daily_df = pd.DataFrame(strat_daily).fillna(0)
        corr = daily_df.corr()

        # Show pairs with high correlation (>0.3) or anti-correlation (<-0.3)
        log("Notable strategy correlations (|r| > 0.3):")
        pairs_shown = set()
        for s1 in corr.columns:
            for s2 in corr.columns:
                if s1 >= s2:
                    continue
                r = corr.loc[s1, s2]
                if abs(r) > 0.3:
                    pair_key = tuple(sorted([s1, s2]))
                    if pair_key not in pairs_shown:
                        pairs_shown.add(pair_key)
                        label = "📈 correlated" if r > 0 else "📉 anti-correlated"
                        log(f"  {s1:<25} ↔ {s2:<25} r={r:+.3f} {label}")

        if not pairs_shown:
            log("  (No pairs with |r| > 0.3 — strategies are well-diversified)")

    # ================================================================
    # SECTION 12: MFE/MAE Analysis
    # ================================================================
    section("12. MFE/MAE ANALYSIS (Maximum Favorable/Adverse Excursion)")

    mfe_mae = trades[["strategy", "direction", "mfe", "mae", "holly_pnl"]].dropna()
    if not mfe_mae.empty:
        log(f"Trades with MFE/MAE data: {len(mfe_mae):,}")

        subsection("12a. MFE left on the table (exited too early?)")
        mfe_mae["pnl_capture_ratio"] = mfe_mae.apply(
            lambda r: r["holly_pnl"] / r["mfe"] if r["mfe"] > 0 else 0, axis=1
        )
        avg_capture = mfe_mae["pnl_capture_ratio"].mean()
        log(f"Average P&L capture ratio (P&L / MFE): {avg_capture:.1%}")
        log(f"  (100% = exited at the best possible point)")
        log(f"  ({avg_capture:.0%} means Holly captures {avg_capture:.0%} of max favorable move)")

        # By strategy
        log(f"\n{'Strategy':<30} {'Avg MFE':>10} {'Avg MAE':>10} {'Capture':>9} {'Trades':>7}")
        log("-" * 70)
        for strat in clean_strategies:
            s = mfe_mae[mfe_mae["strategy"] == strat]
            if len(s) < 20:
                continue
            log(f"{strat:<30} ${s['mfe'].mean():>9.2f} ${s['mae'].mean():>9.2f} "
                f"{s['pnl_capture_ratio'].mean():>8.1%} {len(s):>7}")

    # ================================================================
    # SECTION 13: Optimization Sensitivity
    # ================================================================
    section("13. OPTIMIZATION SENSITIVITY (parameter stability)")

    # For each clean strategy's optimal rule, how sensitive is Sharpe to param changes?
    for strat in clean_strategies[:10]:  # top 10
        opt_row = optimal[optimal["strategy"] == strat]
        if opt_row.empty:
            continue

        rule = opt_row.iloc[0]["exit_rule"]
        strat_results = opt_results[
            (opt_results["strategy_filter"] == strat) &
            (opt_results["exit_rule"] == rule)
        ]
        if len(strat_results) < 3:
            continue

        sharpe_range = strat_results["sharpe"].max() - strat_results["sharpe"].min()
        sharpe_std = strat_results["sharpe"].std()
        best_sharpe = strat_results["sharpe"].max()

        # Fraction of param combos within 80% of best Sharpe
        near_optimal = (strat_results["sharpe"] >= 0.8 * best_sharpe).mean()

        log(f"{strat:<30} rule={rule:<20} "
            f"Sharpe range={sharpe_range:.2f}, std={sharpe_std:.2f}, "
            f"{near_optimal:.0%} combos within 80% of best")

    # ================================================================
    # SECTION 14: Recommendations
    # ================================================================
    section("14. ACTIONABLE RECOMMENDATIONS")

    log("[!!] CRITICAL FIXES:")
    log("  1. Fix direction inference for Unknown trades (direction_int=0)")
    log("     -> Line 108 in engine/price_paths.py: .fillna(0) should use")
    log("       strategy name heuristics or Holly's stop/target placement")
    log("     -> Re-run optimization after fix for accurate results")
    log()
    log("[!] HIGH PRIORITY:")

    if clean_optimal is not None and not clean_optimal.empty:
        best_clean = clean_optimal.nlargest(5, "total_pnl")
        log("  2. Deploy these CLEAN strategies (no direction bug, real results):")
        for _, row in best_clean.iterrows():
            log(f"     -> {row['strategy']}: {row['exit_rule']} "
                f"(P&L=${row['total_pnl']:,.0f}, WR={row['win_rate']:.1%}, PF={row['profit_factor']:.2f})")

    log()
    log("  3. Run walk-forward validation (script 06) before deploying any strategy")
    log("  4. Monitor live performance for 30 days with paper trades before sizing up")
    log()
    log("[+] NICE TO HAVE:")
    log("  5. Add sentiment overlay from Benzinga to flag catalyst-driven trades")
    log("  6. Build per-strategy position sizing using Sharpe-weighted allocation")
    log("  7. Track MFE capture ratio in live trades to detect deterioration")

    # ================================================================
    # SECTION 15: Summary JSON
    # ================================================================
    section("15. ANALYSIS SUMMARY")

    summary = {
        "generated_at": datetime.utcnow().isoformat(),
        "data": {
            "total_trades": len(trades),
            "total_bars": bars_stats[0],
            "unique_symbols": trades["symbol"].nunique(),
            "unique_strategies": trades["strategy"].nunique(),
            "date_range": f"{trades['entry_dt'].min()} -> {trades['entry_dt'].max()}",
        },
        "direction_bug": {
            "unknown_direction_trades": len(unknown),
            "pct_of_total": round(len(unknown) / len(trades) * 100, 1),
            "affected_strategies": len(dirty_strategies),
            "clean_strategies": len(clean_strategies),
        },
        "clean_results": {
            "total_strategies": len(clean_strategies),
            "with_optimization_data": len(clean_optimal) if clean_optimal is not None else 0,
        },
        "baseline": {
            "avg_pnl": round(trades["holly_pnl"].mean(), 2),
            "total_pnl": round(trades["holly_pnl"].sum(), 2),
            "win_rate": round((trades["holly_pnl"] > 0).mean(), 4),
        },
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = OUTPUT_DIR / "analysis_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    log(f"Summary JSON saved to: {summary_path}")

    # Save full report
    report_path = OUTPUT_DIR / "deep_analysis_report.txt"
    report_path.write_text("\n".join(report_lines), encoding="utf-8")
    log(f"Full report saved to:  {report_path}")

    db.close()
    log("\nAnalysis complete.")


if __name__ == "__main__":
    main()
