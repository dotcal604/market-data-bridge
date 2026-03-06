"""
09_export_for_chatgpt.py -- Export Holly Exit Optimizer data for ChatGPT analysis.

Exports DuckDB tables to CSVs + aggregates 2.7M raw bars into per-trade
summaries (ChatGPT can't handle 2.7M rows). Packages everything into a
zip for easy upload to ChatGPT Advanced Data Analysis.

Usage:
    python scripts/09_export_for_chatgpt.py

Output:
    output/chatgpt_upload/
        trades.csv                  -- 8,224 trades
        optimization_results.csv    -- 9,240 optimization runs
        optimal_params.csv          -- 34 best configs
        trade_bar_profiles.csv      -- per-trade bar summaries (replaces raw bars)
        strategy_daily_pnl.csv      -- daily P&L by strategy (for correlation/equity curves)
        analysis_summary.json       -- from script 08
        optimal_exit_params.json    -- from script 07
        prompt.md                   -- analysis instructions for ChatGPT
    output/chatgpt_upload.zip       -- everything zipped for upload
"""

import json
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import OUTPUT_DIR, DUCKDB_PATH
from engine.data_loader import get_db


def main():
    db = get_db()
    out_dir = OUTPUT_DIR / "chatgpt_upload"
    out_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("  Holly Exit Optimizer -- ChatGPT Export")
    print("=" * 60)

    # ------------------------------------------------------------------
    # 1. TRADES
    # ------------------------------------------------------------------
    print("\n[1/7] Exporting trades...")
    trades = db.execute("""
        SELECT
            trade_id, symbol, strategy, direction,
            entry_time, entry_price, exit_time, exit_price,
            stop_price, target_price,
            mfe, mae, shares, holly_pnl,
            stop_buffer_pct, real_entry_price, real_entry_time, real_commission
        FROM trades
        ORDER BY entry_time
    """).fetchdf()

    # Add derived columns ChatGPT will want
    trades["entry_dt"] = pd.to_datetime(trades["entry_time"])
    trades["exit_dt"] = pd.to_datetime(trades["exit_time"])
    trades["year"] = trades["entry_dt"].dt.year
    trades["month"] = trades["entry_dt"].dt.month
    trades["dow"] = trades["entry_dt"].dt.day_name()
    trades["hour"] = trades["entry_dt"].dt.hour
    trades["hold_minutes"] = (
        (trades["exit_dt"] - trades["entry_dt"]).dt.total_seconds() / 60
    ).round(1)
    trades["direction_int"] = trades["direction"].map(
        {"Long": 1, "Short": -1}
    ).fillna(0).astype(int)
    trades["is_winner"] = (trades["holly_pnl"] > 0).astype(int)
    trades["direction_known"] = (trades["direction_int"] != 0).astype(int)

    trades.to_csv(out_dir / "trades.csv", index=False)
    print(f"   {len(trades):,} trades exported")

    # ------------------------------------------------------------------
    # 2. OPTIMIZATION RESULTS
    # ------------------------------------------------------------------
    print("[2/7] Exporting optimization results...")
    opt_results = db.execute("""
        SELECT
            run_id, run_timestamp, strategy_filter AS strategy,
            exit_rule, param_json,
            total_trades, win_rate, avg_pnl, total_pnl,
            max_drawdown, profit_factor, sharpe, avg_hold_mins
        FROM optimization_results
        ORDER BY strategy, sharpe DESC
    """).fetchdf()
    opt_results.to_csv(out_dir / "optimization_results.csv", index=False)
    print(f"   {len(opt_results):,} optimization runs exported")

    # ------------------------------------------------------------------
    # 3. OPTIMAL PARAMS
    # ------------------------------------------------------------------
    print("[3/7] Exporting optimal params...")
    optimal = db.execute("""
        SELECT * FROM optimal_params
        ORDER BY total_pnl DESC
    """).fetchdf()
    optimal.to_csv(out_dir / "optimal_params.csv", index=False)
    print(f"   {len(optimal):,} optimal configs exported")

    # ------------------------------------------------------------------
    # 4. TRADE BAR PROFILES (aggregate 2.7M bars into per-trade summaries)
    # ------------------------------------------------------------------
    print("[4/7] Building per-trade bar profiles (this may take a minute)...")

    # Get trades that have bar data
    trade_bars = db.execute("""
        WITH trade_windows AS (
            SELECT
                t.trade_id,
                t.symbol,
                t.strategy,
                t.direction,
                t.direction_int,
                t.entry_time,
                t.exit_time,
                t.entry_price,
                t.exit_price,
                t.holly_pnl
            FROM (
                SELECT *,
                    CASE direction
                        WHEN 'Long' THEN 1
                        WHEN 'Short' THEN -1
                        ELSE 0
                    END AS direction_int
                FROM trades
            ) t
            WHERE t.exit_time IS NOT NULL
        )
        SELECT
            tw.trade_id,
            tw.strategy,
            tw.direction,
            tw.entry_price,
            tw.exit_price,
            tw.holly_pnl,
            COUNT(b.bar_time) AS bar_count,
            MIN(b.low) AS bar_min_low,
            MAX(b.high) AS bar_max_high,
            AVG(b.close) AS bar_avg_close,
            SUM(b.volume) AS bar_total_volume,
            AVG(b.volume) AS bar_avg_volume,
            MAX(b.volume) AS bar_max_volume,
            STDDEV(b.close) AS bar_price_stddev,
            -- MFE/MAE from actual bars
            CASE tw.direction_int
                WHEN 1 THEN MAX(b.high) - tw.entry_price
                WHEN -1 THEN tw.entry_price - MIN(b.low)
                ELSE NULL
            END AS bar_mfe,
            CASE tw.direction_int
                WHEN 1 THEN tw.entry_price - MIN(b.low)
                WHEN -1 THEN MAX(b.high) - tw.entry_price
                ELSE NULL
            END AS bar_mae,
            -- First and last bar prices
            FIRST(b.open ORDER BY b.bar_time) AS first_bar_open,
            LAST(b.close ORDER BY b.bar_time) AS last_bar_close,
            -- Price at key time intervals (via subquery approximation)
            FIRST(b.close ORDER BY b.bar_time) AS close_1min,
            -- Volume-weighted price
            CASE WHEN SUM(b.volume) > 0
                THEN SUM(b.close * b.volume) / SUM(b.volume)
                ELSE AVG(b.close)
            END AS bar_vwap,
            -- Volatility: range / entry
            (MAX(b.high) - MIN(b.low)) / NULLIF(tw.entry_price, 0) AS bar_range_pct
        FROM trade_windows tw
        JOIN bars b ON b.symbol = tw.symbol
            AND b.bar_time >= tw.entry_time
            AND b.bar_time <= tw.exit_time
        GROUP BY tw.trade_id, tw.strategy, tw.direction,
                 tw.entry_price, tw.exit_price, tw.holly_pnl,
                 tw.direction_int
        HAVING COUNT(b.bar_time) >= 1
        ORDER BY tw.trade_id
    """).fetchdf()

    trade_bars.to_csv(out_dir / "trade_bar_profiles.csv", index=False)
    print(f"   {len(trade_bars):,} trade bar profiles exported")
    print(f"   (from {len(trades):,} total trades -- rest had no bar coverage)")

    # ------------------------------------------------------------------
    # 5. STRATEGY DAILY P&L (for equity curves & correlation)
    # ------------------------------------------------------------------
    print("[5/7] Building strategy daily P&L...")

    daily_pnl = db.execute("""
        SELECT
            CAST(entry_time AS DATE) AS trade_date,
            strategy,
            COUNT(*) AS trades,
            SUM(holly_pnl) AS daily_pnl,
            AVG(holly_pnl) AS avg_pnl,
            SUM(CASE WHEN holly_pnl > 0 THEN 1 ELSE 0 END)::DOUBLE
                / COUNT(*)::DOUBLE AS win_rate
        FROM trades
        WHERE direction IN ('Long', 'Short')
        GROUP BY CAST(entry_time AS DATE), strategy
        ORDER BY trade_date, strategy
    """).fetchdf()

    daily_pnl.to_csv(out_dir / "strategy_daily_pnl.csv", index=False)
    print(f"   {len(daily_pnl):,} daily strategy rows exported")

    # ------------------------------------------------------------------
    # 6. COPY JSON FILES
    # ------------------------------------------------------------------
    print("[6/7] Copying JSON files...")

    json_files = [
        ("analysis_summary.json", OUTPUT_DIR / "analysis_summary.json"),
        ("optimal_exit_params.json", OUTPUT_DIR / "optimal_exit_params.json"),
    ]
    for name, src in json_files:
        if src.exists():
            shutil.copy2(src, out_dir / name)
            print(f"   Copied {name}")
        else:
            print(f"   SKIP {name} (not found)")

    # ------------------------------------------------------------------
    # 7. GENERATE PROMPT
    # ------------------------------------------------------------------
    print("[7/7] Generating ChatGPT prompt...")

    # Compute stats for prompt context
    clean_count = trades[trades["direction_known"] == 1].shape[0]
    dirty_count = trades[trades["direction_known"] == 0].shape[0]
    strategies_clean = trades[trades["direction_known"] == 1]["strategy"].nunique()
    strategies_dirty = trades[trades["direction_known"] == 0]["strategy"].nunique()

    prompt = f"""# Holly Exit Optimizer -- Analysis Package

> Upload ALL files in this zip to ChatGPT Advanced Data Analysis.
> Then paste this prompt (or upload this file) and say "Analyze this data."

## What This Is

A **5-year backtest of 59 Holly AI trading strategies** with 9 different exit
rules optimized across 264 parameter combinations. Holly is an AI stock scanner
by Trade Ideas that fires intraday alerts (long/short signals).

## Data Sources

| Source | What | Status |
|--------|------|--------|
| **TraderSync** | {len(trades):,} trade records (entries, exits, P&L) | In trades.csv |
| **Massive.com** (fka Polygon.io) | 2.7M 1-minute OHLCV bars (aggregated per-trade) | In trade_bar_profiles.csv |
| **Holly AI** | Strategy names, directions, stop/target levels | In trades.csv |
| **Benzinga** (via IBKR) | News headlines per symbol | NOT YET IN DATASET -- available for future overlay |

## Files Included

| File | Rows | Description |
|------|------|-------------|
| `trades.csv` | {len(trades):,} | All trades: symbol, strategy, direction, entry/exit, P&L, MFE/MAE |
| `optimization_results.csv` | {len(opt_results):,} | Every exit rule x parameter combo tested per strategy |
| `optimal_params.csv` | {len(optimal):,} | Best exit rule config per strategy (by Sharpe) |
| `trade_bar_profiles.csv` | {len(trade_bars):,} | Per-trade bar aggregates: MFE/MAE from bars, volume, volatility |
| `strategy_daily_pnl.csv` | {len(daily_pnl):,} | Daily P&L per strategy (for equity curves, correlation matrix) |
| `analysis_summary.json` | 1 | Quick stats summary |
| `optimal_exit_params.json` | 1 | Full optimal params with baseline vs optimized comparison |

## CRITICAL: Direction Inference Bug

**{dirty_count} trades ({dirty_count/len(trades)*100:.1f}%) have direction="Unknown" (direction_int=0).**
These trades produce ZERO P&L in optimization because `pnl = (exit - entry) * direction_int`.
This inflates win rates and distorts Sharpe ratios for {strategies_dirty} strategies.

**{clean_count} trades ({clean_count/len(trades)*100:.1f}%) have known direction** across {strategies_clean} strategies.
**Always separate "clean" (direction_known=1) from "dirty" (direction_known=0) in analysis.**

Strategies with most contamination (>30% unknown):
- Putting on the Breaks (50%), Pushing Through Resistance (46.2%)
- Horseshoe Up (41.5%), Yesterday Hammer Today Strength (38.8%)
- Got Dough Wants To Go (38.0%), Bull Trap (34.1%)

## Analysis Requests

### 1. Data Quality Audit
- Confirm direction bug impact: filter to direction_known=1 vs 0
- Check for duplicate trades, missing fields, outlier P&L values
- Bar coverage: what % of trades have bar data? Which strategies lack it?
- Show distributions: P&L histogram, hold time distribution, trades per strategy

### 2. Strategy Performance (CLEAN ONLY)
- Rank strategies by Sharpe ratio (clean trades only, direction_known=1)
- Show equity curves (cumulative P&L over time) for top 10 strategies
- Win rate vs profit factor scatter plot
- Average winner vs average loser per strategy
- Which strategies are consistently profitable across all years?

### 3. Exit Rule Effectiveness
- Which exit rule produces the best risk-adjusted returns across all strategies?
- Heatmap: strategy x exit_rule, colored by Sharpe
- Are some exit rules better for long vs short strategies?
- Parameter sensitivity: how much does Sharpe change across parameter variations?
- From optimization_results.csv, plot Sharpe distribution per exit_rule

### 4. Bar-Level Analysis (trade_bar_profiles.csv)
- MFE capture ratio: holly_pnl / bar_mfe (how much of the max move does Holly capture?)
- MAE analysis: how deep do trades go against us before recovering?
- Volume profile: do high-volume trades perform better?
- Price volatility (bar_range_pct) vs P&L -- is more volatile = more profitable?
- Compare bar-derived MFE/MAE vs trades.csv MFE/MAE (consistency check)

### 5. Temporal Patterns
- P&L by year, month, day of week, hour of day
- Are there seasonal patterns? (e.g., better in Q1 vs Q4)
- Morning (6-8 ET) vs midday (9-11 ET) vs afternoon (12+ ET) performance
- Which strategies work better in which time windows?

### 6. Walk-Forward Stability
- Split data at midpoint chronologically
- Compare strategy metrics (Sharpe, WR, avg P&L) in first half vs second half
- Flag strategies that degrade significantly in the second half
- Which strategies are TIME-STABLE (consistent across both halves)?

### 7. Portfolio Construction
- Strategy correlation matrix (from strategy_daily_pnl.csv)
- Which combination of 3-5 strategies maximizes diversification?
- Simulate an equal-weight portfolio of the top 5 clean strategies
- Plot combined equity curve vs individual strategies

### 8. Risk Analysis
- Max drawdown per strategy and as a portfolio
- Worst day, worst week, worst month
- VaR (Value at Risk) at 95% and 99% confidence
- Recovery factor: total P&L / max drawdown
- Tail risk: P1 and P99 of P&L distribution

### 9. Recommendations
Based on all analysis, provide:
- **Top 5 strategies** to deploy (clean, stable, high Sharpe, good bar coverage)
- **Exit rule recommendation** per strategy
- **Red flags** -- strategies to AVOID
- **Data quality fixes** needed before trusting results
- **Suggested next steps** for production deployment

## Settings Used in Optimization

| Parameter | Value |
|-----------|-------|
| Shares per trade | 100 (normalized) |
| Commission | $0.005/share |
| Slippage | $0.01/share |
| Max hold time | 240 minutes (4 hours) |
| Min trades for significance | 30 |
| Price filter | $5 - $500 |
| Min stop buffer | 0.35% |
| Sharpe annualization | sqrt(252 * 5) |

## Exit Rules Tested

| Rule | Parameters | Description |
|------|-----------|-------------|
| holly_baseline | (none) | Holly's original exit (baseline comparison) |
| fixed_trail | trail_pct | Trailing stop at fixed % below peak |
| atr_trail | atr_mult | ATR-based trailing stop |
| time_decay_trail | initial_pct, decay_rate | Trail tightens over time |
| fixed_tp | tp_pct | Fixed take-profit target |
| time_exit | exit_minutes | Exit after N minutes regardless |
| partial_plus_trail | partial_pct, partial_size, trail_pct | Take partial profits, trail rest |
| breakeven_plus_trail | be_trigger_pct, trail_pct | Move stop to breakeven, then trail |
| volume_climax | vol_mult | Exit on volume spike (climax) |
"""

    with open(out_dir / "prompt.md", "w", encoding="utf-8") as f:
        f.write(prompt)
    print("   Generated prompt.md")

    # ------------------------------------------------------------------
    # ZIP EVERYTHING
    # ------------------------------------------------------------------
    print("\nPackaging zip...")
    zip_path = OUTPUT_DIR / "chatgpt_upload"
    shutil.make_archive(str(zip_path), "zip", str(out_dir))
    zip_size = (OUTPUT_DIR / "chatgpt_upload.zip").stat().st_size / (1024 * 1024)
    print(f"   Created: {zip_path}.zip ({zip_size:.1f} MB)")

    # ------------------------------------------------------------------
    # SUMMARY
    # ------------------------------------------------------------------
    print("\n" + "=" * 60)
    print("  EXPORT COMPLETE")
    print("=" * 60)
    print(f"\n  Files in: {out_dir}")
    print(f"  Zip:      {zip_path}.zip ({zip_size:.1f} MB)")
    print(f"\n  Upload the .zip to ChatGPT Advanced Data Analysis")
    print(f"  Then paste prompt.md or say 'Analyze this data'")
    print(f"\n  ChatGPT Plus ($20/mo) is sufficient.")
    print(f"  Use GPT-4o with Advanced Data Analysis enabled.")


if __name__ == "__main__":
    main()
