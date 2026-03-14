"""
96_remaining_datasets_lift.py — Lift analysis for ALL remaining unmined datasets
================================================================================
Tests features from:
  1. massive_float — free float shares, float %
  2. massive_ipos — days since IPO, recent IPO flag
  3. massive_dividends — ex-dividend proximity, has upcoming div
  4. massive_sec_filings_index — recent 8-K filings, filing frequency
  5. massive_treasury_yields — yield curve slope, level, curvature

Each feature set is tested for win/loss separation via Cohen's d + OOS validation.
"""

import sys
import time
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH


def cohen_d(wins, losses):
    """Compute Cohen's d for two groups."""
    w = wins.astype(float).dropna()
    l = losses.astype(float).dropna()
    if len(w) < 20 or len(l) < 20:
        return None, None
    pooled = np.sqrt(((len(w)-1)*w.std()**2 + (len(l)-1)*l.std()**2) / (len(w)+len(l)-2))
    d = (w.mean() - l.mean()) / pooled if pooled > 0 else 0.0
    _, p = stats.ttest_ind(w, l, equal_var=False)
    return d, p


def oos_split(df, feat):
    """60/40 chronological OOS Cohen's d."""
    df_s = df.sort_values("entry_time")
    split = int(len(df_s) * 0.6)
    train, test = df_s.iloc[:split], df_s.iloc[split:]

    d_train, _ = cohen_d(
        train[train["win"]==1][feat], train[train["win"]==0][feat]
    )
    d_test, _ = cohen_d(
        test[test["win"]==1][feat], test[test["win"]==0][feat]
    )
    return d_train, d_test


def print_lift_table(df, features, title):
    """Print a standardized lift analysis table."""
    print(f"\n{'='*75}")
    print(f"  {title}")
    print(f"{'='*75}")
    print(f"{'Feature':<30} {'d':>8} {'p':>12} {'d_train':>8} {'d_test':>8} {'OOS':>6}")
    print("-" * 75)

    for feat in features:
        if feat not in df.columns:
            continue
        d_val, p_val = cohen_d(
            df[df["win"]==1][feat], df[df["win"]==0][feat]
        )
        if d_val is None:
            continue

        d_train, d_test = oos_split(df, feat)
        if d_train is None or d_test is None:
            oos_label = "N/A"
        elif (d_train > 0 and d_test > 0) or (d_train < 0 and d_test < 0):
            oos_label = "YES"
        else:
            oos_label = "FLIP"

        flag = "***" if p_val < 0.001 else "**" if p_val < 0.01 else "*" if p_val < 0.05 else ""
        print(f"{feat:<30} {d_val:>8.4f} {p_val:>11.2e}{flag:>1} {d_train or 0:>8.4f} {d_test or 0:>8.4f} {oos_label:>6}")


def build_float_features(con, trades_df):
    """Build float-based features."""
    print("\n--- Float Features ---")

    float_df = con.execute("""
        SELECT t.trade_id,
               f.free_float,
               f.free_float_percent
        FROM trades t
        LEFT JOIN massive_float f ON f.ticker = t.symbol
    """).fetchdf()

    trades_df = trades_df.merge(float_df, on="trade_id", how="left")

    # Log float (float is heavily right-skewed)
    trades_df["log_float"] = np.log1p(trades_df["free_float"].fillna(0))

    # Float buckets (handle NaN)
    has_float = trades_df["free_float"].notna()
    trades_df["is_low_float"] = np.where(has_float, (trades_df["free_float"].fillna(0) < 10_000_000).astype(float), np.nan)
    trades_df["is_micro_float"] = np.where(has_float, (trades_df["free_float"].fillna(0) < 1_000_000).astype(float), np.nan)

    coverage = trades_df["free_float"].notna().sum()
    print(f"  Coverage: {coverage:,}/{len(trades_df):,} ({100*coverage/len(trades_df):.1f}%)")
    print(f"  Low float (<10M): {trades_df['is_low_float'].sum():,}")
    print(f"  Micro float (<1M): {trades_df['is_micro_float'].sum():,}")

    return trades_df, ["log_float", "free_float_percent", "is_low_float", "is_micro_float"]


def build_ipo_features(con, trades_df):
    """Build IPO-based features."""
    print("\n--- IPO Features ---")

    ipo_df = con.execute("""
        SELECT t.trade_id,
               DATEDIFF('day', CAST(i.listing_date AS DATE), CAST(t.entry_time AS DATE)) AS days_since_ipo
        FROM trades t
        LEFT JOIN massive_ipos i ON i.ticker = t.symbol
    """).fetchdf()

    trades_df = trades_df.merge(ipo_df, on="trade_id", how="left")

    # Recent IPO flags
    has_ipo = trades_df["days_since_ipo"].notna()
    trades_df["is_recent_ipo_90d"] = np.where(has_ipo, trades_df["days_since_ipo"].fillna(9999).between(0, 90), np.nan)
    trades_df["is_recent_ipo_365d"] = np.where(has_ipo, trades_df["days_since_ipo"].fillna(9999).between(0, 365), np.nan)
    trades_df["log_days_since_ipo"] = np.log1p(trades_df["days_since_ipo"].clip(lower=0).fillna(9999))

    coverage = trades_df["days_since_ipo"].notna().sum()
    print(f"  Coverage: {coverage:,}/{len(trades_df):,} ({100*coverage/len(trades_df):.1f}%)")
    print(f"  Recent IPO (<90d): {trades_df['is_recent_ipo_90d'].sum():,}")
    print(f"  Recent IPO (<365d): {trades_df['is_recent_ipo_365d'].sum():,}")

    return trades_df, ["days_since_ipo", "log_days_since_ipo", "is_recent_ipo_90d", "is_recent_ipo_365d"]


def build_dividend_features(con, trades_df):
    """Build dividend proximity features."""
    print("\n--- Dividend Features ---")

    div_df = con.execute("""
        WITH nearest_past_div AS (
            SELECT DISTINCT ON (t.trade_id)
                t.trade_id,
                d.cash_amount,
                d.frequency,
                DATEDIFF('day', CAST(d.ex_dividend_date AS DATE), CAST(t.entry_time AS DATE)) AS days_since_ex_div
            FROM trades t
            JOIN massive_dividends d ON d.ticker = t.symbol
                AND CAST(d.ex_dividend_date AS DATE) < CAST(t.entry_time AS DATE)
            ORDER BY t.trade_id, d.ex_dividend_date DESC
        ),
        nearest_future_div AS (
            SELECT DISTINCT ON (t.trade_id)
                t.trade_id,
                DATEDIFF('day', CAST(t.entry_time AS DATE), CAST(d.ex_dividend_date AS DATE)) AS days_to_next_ex_div
            FROM trades t
            JOIN massive_dividends d ON d.ticker = t.symbol
                AND CAST(d.ex_dividend_date AS DATE) >= CAST(t.entry_time AS DATE)
            ORDER BY t.trade_id, d.ex_dividend_date ASC
        )
        SELECT t.trade_id,
               p.days_since_ex_div,
               p.cash_amount AS last_div_amount,
               f.days_to_next_ex_div
        FROM trades t
        LEFT JOIN nearest_past_div p ON p.trade_id = t.trade_id
        LEFT JOIN nearest_future_div f ON f.trade_id = t.trade_id
    """).fetchdf()

    trades_df = trades_df.merge(div_df, on="trade_id", how="left")

    # Near ex-div flags (handle NaN from LEFT JOIN)
    has_any_div = trades_df["days_since_ex_div"].notna() | trades_df["days_to_next_ex_div"].notna()
    trades_df["near_ex_div_7d"] = np.where(
        has_any_div,
        (trades_df["days_to_next_ex_div"].fillna(9999).between(0, 7)) |
        (trades_df["days_since_ex_div"].fillna(9999).between(0, 7)),
        np.nan
    ).astype(float)
    trades_df["is_dividend_stock"] = trades_df["days_since_ex_div"].notna().astype(float)

    coverage = trades_df["days_since_ex_div"].notna().sum()
    print(f"  Coverage (has past div): {coverage:,}/{len(trades_df):,} ({100*coverage/len(trades_df):.1f}%)")
    print(f"  Near ex-div (7d): {trades_df['near_ex_div_7d'].sum():,}")
    print(f"  Dividend stocks: {trades_df['is_dividend_stock'].sum():,}")

    return trades_df, ["days_since_ex_div", "days_to_next_ex_div", "last_div_amount",
                        "near_ex_div_7d", "is_dividend_stock"]


def build_sec_filing_features(con, trades_df):
    """Build SEC filing proximity features."""
    print("\n--- SEC Filing Features ---")

    sec_df = con.execute("""
        WITH filing_counts AS (
            SELECT t.trade_id,
                   COUNT(DISTINCT CASE WHEN s.form_type = '8-K' THEN s.accession_number END) AS eight_k_7d,
                   COUNT(DISTINCT CASE WHEN s.form_type IN ('10-Q', '10-K') THEN s.accession_number END) AS periodic_7d,
                   COUNT(DISTINCT s.accession_number) AS total_filings_30d
            FROM trades t
            LEFT JOIN massive_sec_filings_index s
                ON s.ticker = t.symbol
               AND CAST(s.filing_date AS DATE) < CAST(t.entry_time AS DATE)
               AND CAST(s.filing_date AS DATE) >= CAST(t.entry_time AS DATE) - INTERVAL '30 days'
            GROUP BY t.trade_id
        ),
        recent_8k AS (
            SELECT DISTINCT ON (t.trade_id)
                t.trade_id,
                DATEDIFF('day', CAST(s.filing_date AS DATE), CAST(t.entry_time AS DATE)) AS days_since_8k
            FROM trades t
            JOIN massive_sec_filings_index s
                ON s.ticker = t.symbol
               AND s.form_type = '8-K'
               AND CAST(s.filing_date AS DATE) < CAST(t.entry_time AS DATE)
            ORDER BY t.trade_id, s.filing_date DESC
        )
        SELECT fc.trade_id,
               fc.eight_k_7d,
               fc.periodic_7d,
               fc.total_filings_30d,
               r8.days_since_8k
        FROM filing_counts fc
        LEFT JOIN recent_8k r8 ON r8.trade_id = fc.trade_id
    """).fetchdf()

    trades_df = trades_df.merge(sec_df, on="trade_id", how="left")

    # Handle NaN from LEFT JOIN
    has_sec = trades_df["total_filings_30d"].notna()
    trades_df["has_recent_8k_7d"] = np.where(has_sec, trades_df["eight_k_7d"].fillna(0) > 0, np.nan).astype(float)
    trades_df["has_recent_periodic"] = np.where(has_sec, trades_df["periodic_7d"].fillna(0) > 0, np.nan).astype(float)

    coverage = trades_df["days_since_8k"].notna().sum()
    print(f"  Coverage (has any 8-K): {coverage:,}/{len(trades_df):,} ({100*coverage/len(trades_df):.1f}%)")
    print(f"  Has 8-K within 7d: {trades_df['has_recent_8k_7d'].sum():,}")
    print(f"  Has 10-Q/10-K within 7d: {trades_df['has_recent_periodic'].sum():,}")

    return trades_df, ["eight_k_7d", "total_filings_30d", "days_since_8k",
                        "has_recent_8k_7d", "has_recent_periodic"]


def build_yield_curve_features(con, trades_df):
    """Build treasury yield curve features."""
    print("\n--- Yield Curve Features ---")

    yc_df = con.execute("""
        SELECT DISTINCT ON (t.trade_id)
            t.trade_id,
            y.yield_2_year,
            y.yield_10_year,
            y.yield_10_year - y.yield_2_year AS yield_curve_slope,
            y.yield_10_year - y.yield_3_month AS yield_curve_spread,
            (y.yield_2_year + y.yield_10_year) / 2.0 AS yield_level,
            y.yield_30_year - 2 * y.yield_10_year + y.yield_2_year AS yield_curvature
        FROM trades t
        JOIN massive_treasury_yields y
            ON CAST(y.date AS DATE) <= CAST(t.entry_time AS DATE)
        ORDER BY t.trade_id, y.date DESC
    """).fetchdf()

    trades_df = trades_df.merge(yc_df, on="trade_id", how="left")

    has_yc = trades_df["yield_curve_slope"].notna()
    trades_df["yield_curve_inverted"] = np.where(has_yc, trades_df["yield_curve_slope"] < 0, np.nan).astype(float)

    coverage = trades_df["yield_curve_slope"].notna().sum()
    print(f"  Coverage: {coverage:,}/{len(trades_df):,} ({100*coverage/len(trades_df):.1f}%)")
    print(f"  Inverted yield curve: {trades_df['yield_curve_inverted'].sum():,}")
    print(f"  Slope range: {trades_df['yield_curve_slope'].min():.2f} to {trades_df['yield_curve_slope'].max():.2f}")

    return trades_df, ["yield_curve_slope", "yield_curve_spread", "yield_level",
                        "yield_curvature", "yield_curve_inverted"]


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    # Load base trades
    trades_df = con.execute("""
        SELECT trade_id, symbol, entry_time, strategy, direction,
               holly_pnl, mfe, mae
        FROM trades
        ORDER BY trade_id
    """).fetchdf()
    # Drop NaN pnl rows first, then create win flag
    total_before = len(trades_df)
    trades_df = trades_df[trades_df["holly_pnl"].notna()].copy()
    trades_df["win"] = (trades_df["holly_pnl"] > 0).astype(int)
    print(f"Trades: {len(trades_df):,} (excl {total_before - len(trades_df)} NaN PnL)")

    all_features = []

    # 1. Float
    trades_df, float_feats = build_float_features(con, trades_df)
    all_features.extend(float_feats)
    print_lift_table(trades_df, float_feats, "FLOAT FEATURES")

    # 2. IPO
    trades_df, ipo_feats = build_ipo_features(con, trades_df)
    all_features.extend(ipo_feats)
    print_lift_table(trades_df, ipo_feats, "IPO FEATURES")

    # 3. Dividends
    trades_df, div_feats = build_dividend_features(con, trades_df)
    all_features.extend(div_feats)
    print_lift_table(trades_df, div_feats, "DIVIDEND FEATURES")

    # 4. SEC Filings
    trades_df, sec_feats = build_sec_filing_features(con, trades_df)
    all_features.extend(sec_feats)
    print_lift_table(trades_df, sec_feats, "SEC FILING FEATURES")

    # 5. Yield Curve
    trades_df, yc_feats = build_yield_curve_features(con, trades_df)
    all_features.extend(yc_feats)
    print_lift_table(trades_df, yc_feats, "YIELD CURVE FEATURES")

    # Summary of best features
    print(f"\n{'='*75}")
    print(f"  SUMMARY — Best Features Across All Remaining Datasets")
    print(f"{'='*75}")

    results = []
    for feat in all_features:
        if feat not in trades_df.columns:
            continue
        d_val, p_val = cohen_d(
            trades_df[trades_df["win"]==1][feat],
            trades_df[trades_df["win"]==0][feat]
        )
        if d_val is None:
            continue
        d_train, d_test = oos_split(trades_df, feat)
        stable = "N/A"
        if d_train is not None and d_test is not None:
            stable = "YES" if (d_train > 0 and d_test > 0) or (d_train < 0 and d_test < 0) else "FLIP"
        results.append({
            "feature": feat, "d": d_val, "p": p_val,
            "d_train": d_train, "d_test": d_test, "stable": stable
        })

    # Sort by absolute d_test (OOS strength)
    results.sort(key=lambda x: abs(x["d_test"] or 0), reverse=True)

    print(f"{'Feature':<30} {'d':>8} {'p':>12} {'d_test':>8} {'OOS':>6}")
    print("-" * 70)
    for r in results:
        flag = "***" if r["p"] < 0.001 else "**" if r["p"] < 0.01 else "*" if r["p"] < 0.05 else ""
        print(f"{r['feature']:<30} {r['d']:>8.4f} {r['p']:>11.2e}{flag:>1} {r['d_test'] or 0:>8.4f} {r['stable']:>6}")

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s")
    con.close()


if __name__ == "__main__":
    main()
