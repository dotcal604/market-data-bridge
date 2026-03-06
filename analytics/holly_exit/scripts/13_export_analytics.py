"""
13_export_analytics.py — Export denormalized analytics file for Tableau/Power BI.

Joins trades + regime features + optimization results into a single flat
Parquet (and CSV) file for BI tool consumption.

Usage:
    python scripts/13_export_analytics.py
"""

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import OUTPUT_DIR
from engine.data_loader import get_db


def main():
    db = get_db()

    # ── Build denormalized trade + regime + optimization view ──────────
    df = db.execute("""
        SELECT
            t.trade_id,
            t.symbol,
            t.strategy,
            t.direction,
            t.entry_time,
            t.entry_price,
            t.exit_time,
            t.exit_price,
            t.real_entry_price,
            t.real_entry_time,
            t.holly_pnl,
            t.shares,
            t.stop_price,
            t.target_price,
            t.mfe,
            t.mae,
            t.stop_buffer_pct,
            CAST(t.entry_time AS DATE) AS trade_date,
            EXTRACT(YEAR FROM t.entry_time) AS trade_year,
            EXTRACT(MONTH FROM t.entry_time) AS trade_month,
            EXTRACT(DOW FROM t.entry_time) AS trade_dow,
            EXTRACT(HOUR FROM t.entry_time) AS entry_hour,
            -- Regime features
            r.sma20,
            r.sma5,
            r.trend_slope,
            r.above_sma20,
            r.atr14,
            r.atr_pct,
            r.daily_range_pct,
            r.rsi14,
            r.roc5,
            r.roc20,
            r.trend_regime,
            r.vol_regime,
            r.momentum_regime,
            -- Optimization results (best params per strategy)
            o.exit_rule AS opt_exit_rule,
            o.param_json AS opt_params,
            o.avg_pnl AS opt_avg_pnl,
            o.profit_factor AS opt_profit_factor,
            o.win_rate AS opt_win_rate,
            o.sharpe AS opt_sharpe,
            o.max_drawdown AS opt_max_drawdown,
            o.total_trades AS opt_total_trades,
            -- Ticker details (sector, exchange, market cap)
            td.name AS company_name,
            td.sic_code,
            td.sic_description AS sector,
            td.primary_exchange,
            td.market_cap,
            td.total_employees,
            td.address_state,
            td.list_date AS ipo_date,
            -- Bar coverage flag
            CASE WHEN EXISTS (
                SELECT 1 FROM bars b
                WHERE b.symbol = t.symbol
                AND CAST(b.bar_time AS DATE) = CAST(t.entry_time AS DATE)
            ) THEN TRUE ELSE FALSE END AS has_minute_bars,
            -- Daily bar coverage flag
            CASE WHEN r.trade_id IS NOT NULL
                THEN TRUE ELSE FALSE END AS has_regime_data
        FROM trades t
        LEFT JOIN trade_regime r ON t.trade_id = r.trade_id
        LEFT JOIN ticker_details td ON t.symbol = td.symbol
        LEFT JOIN (
            SELECT strategy_filter, exit_rule, param_json,
                   avg_pnl, profit_factor, win_rate, sharpe, max_drawdown, total_trades,
                   ROW_NUMBER() OVER (PARTITION BY strategy_filter ORDER BY profit_factor DESC) AS rn
            FROM optimization_results
        ) o ON t.strategy = o.strategy_filter AND o.rn = 1
        ORDER BY t.entry_time
    """).fetchdf()

    db.close()

    # ── Computed columns ──────────────────────────────────────────────
    df["hold_minutes"] = (
        pd.to_datetime(df["exit_time"]) - pd.to_datetime(df["entry_time"])
    ).dt.total_seconds() / 60
    df["hold_minutes"] = df["hold_minutes"].clip(lower=0).fillna(0).astype(int)

    df["pnl_per_share"] = (df["holly_pnl"] / df["shares"].replace(0, 1)).round(4)

    df["is_winner"] = df["holly_pnl"] > 0
    df["is_loser"] = df["holly_pnl"] < 0

    # R-multiple (if stop_price available)
    risk = (df["entry_price"] - df["stop_price"]).abs()
    df["risk_per_share"] = risk
    df["r_multiple"] = (
        df["pnl_per_share"] / risk.replace(0, float("nan"))
    ).round(2)

    # ── Export ─────────────────────────────────────────────────────────
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    parquet_path = OUTPUT_DIR / "holly_analytics.parquet"
    csv_path = OUTPUT_DIR / "holly_analytics.csv"

    df.to_parquet(parquet_path, index=False, engine="pyarrow")
    df.to_csv(csv_path, index=False)

    print(f"Exported {len(df):,} trades")
    print(f"  Parquet: {parquet_path} ({parquet_path.stat().st_size / 1e6:.1f} MB)")
    print(f"  CSV:     {csv_path} ({csv_path.stat().st_size / 1e6:.1f} MB)")
    print(f"  Columns: {len(df.columns)}")
    print(f"  With minute bars: {df['has_minute_bars'].sum():,}")
    print(f"  With regime data: {df['has_regime_data'].sum():,}")
    print(f"  With optimization: {df['opt_exit_rule'].notna().sum():,}")
    print(f"  With sector data:  {df['sector'].notna().sum():,}")

    # Column summary
    print(f"\nColumns:")
    for col in df.columns:
        dtype = df[col].dtype
        nulls = df[col].isna().sum()
        print(f"  {col:<25} {str(dtype):<15} {nulls:>6} nulls")


if __name__ == "__main__":
    main()
