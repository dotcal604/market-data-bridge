"""
Script 93 -- Lift Analysis for Technical Indicator Features
============================================================
Tests win/loss separation (Cohen's d with FDR correction) for all
features from script 92 (Polygon technical indicators):
  - RSI(14), MACD (value/signal/histogram), EMA(9/21), SMA(20/50)
  - Price vs MA ratios, EMA spread, RSI zones, MACD cross, MA trend
  - Above/below MA binary flags

Then builds a composite v14 model with best indicator features added
to the v9 baseline, using walk-forward OOS validation.

Usage:
    python scripts/93_indicator_lift.py
"""

import sys
import time
import warnings
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from scipy import stats as scipy_stats

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH

warnings.filterwarnings("ignore")

# -- V9 baseline features (from script 82) --
V9_DIR_FEATURES = [
    "log_market_cap",
    "ticker_prior_avg_pnl", "ticker_prior_streak", "ticker_prior_wr",
    "flat_transactions_1d", "flat_log_volume_1d",
    "strategy_recent_wr", "gap_pct", "atr_pct",
    "strategy_vol_regime_wr", "prior_day_gap_pct",
    "rs_5d", "vix", "vwap_position_pct",
    "opening_range_pct", "rs_5d_abs", "prior_day_range_pct",
    "vol_trend_3d", "yield_spread_10y2y",
    "prior_day_return_pct", "net_margin", "op_margin",
    "days_since_split", "days_to_next_split",
    "is_short", "strat_mighty_mouse",
]

TRAIN_END = "2021-12-31"

# Continuous indicator features to test
CONTINUOUS_FEATURES = [
    "rsi_14",
    "macd_value",
    "macd_signal",
    "macd_hist",
    "ema_9",
    "ema_21",
    "sma_20",
    "sma_50",
    "price_vs_ema9",
    "price_vs_ema21",
    "price_vs_sma50",
    "ema_spread",
]

# Categorical features to test
CATEGORICAL_FEATURES = [
    "rsi_zone",
    "macd_cross",
    "ma_trend",
]

# Binary features
BINARY_FEATURES = [
    "above_ema9",
    "above_ema21",
    "above_sma50",
]


def cohens_d(group1, group2):
    """Compute Cohen's d between two groups."""
    n1, n2 = len(group1), len(group2)
    if n1 < 5 or n2 < 5:
        return 0.0
    m1, m2 = group1.mean(), group2.mean()
    s1, s2 = group1.std(), group2.std()
    pooled_std = np.sqrt(
        ((n1 - 1) * s1**2 + (n2 - 1) * s2**2) / (n1 + n2 - 2)
    )
    if pooled_std == 0:
        return 0.0
    return abs(m1 - m2) / pooled_std


def fdr_correct(p_values, alpha=0.05):
    """Benjamini-Hochberg FDR correction."""
    n = len(p_values)
    if n == 0:
        return []
    sorted_idx = np.argsort(p_values)
    sorted_p = np.array(p_values)[sorted_idx]
    thresholds = [(i + 1) / n * alpha for i in range(n)]
    significant = [False] * n
    max_sig = -1
    for i in range(n):
        if sorted_p[i] <= thresholds[i]:
            max_sig = i
    for i in range(max_sig + 1):
        significant[sorted_idx[i]] = True
    return significant


def analyze_feature(df, feature, target="holly_pnl"):
    """Compute win/loss separation metrics for a feature."""
    valid = df[[feature, target]].dropna()
    if len(valid) < 50:
        return None

    wins = valid[valid[target] > 0][feature]
    losses = valid[valid[target] <= 0][feature]

    if len(wins) < 10 or len(losses) < 10:
        return None

    d = cohens_d(wins, losses)

    # T-test p-value
    _, p_val = scipy_stats.ttest_ind(wins, losses, equal_var=False)

    # Decile analysis
    try:
        valid["decile"] = pd.qcut(
            valid[feature], 10, labels=False, duplicates="drop"
        )
        decile_pnl = valid.groupby("decile")[target].mean()
        d10_pnl = decile_pnl.iloc[-1] if len(decile_pnl) >= 10 else np.nan
        d1_pnl = decile_pnl.iloc[0] if len(decile_pnl) >= 1 else np.nan
        spread = d10_pnl - d1_pnl if not np.isnan(d10_pnl) else np.nan
    except Exception:
        spread = np.nan
        d10_pnl = np.nan
        d1_pnl = np.nan

    return {
        "feature": feature,
        "n_valid": len(valid),
        "coverage_pct": 100 * len(valid) / len(df),
        "d": d,
        "p_value": p_val,
        "win_mean": wins.mean(),
        "loss_mean": losses.mean(),
        "d10_pnl": d10_pnl,
        "d1_pnl": d1_pnl,
        "spread_d10_d1": spread,
    }


def analyze_categorical(df, feature, target="holly_pnl"):
    """Analyze a categorical feature for PnL separation."""
    valid = df[[feature, target]].dropna()
    if len(valid) < 50:
        return None

    groups = valid.groupby(feature).agg(
        count=(target, "count"),
        mean_pnl=(target, "mean"),
        win_rate=(target, lambda x: (x > 0).mean()),
    ).sort_values("mean_pnl", ascending=False)

    if len(groups) < 2:
        return None

    # ANOVA F-test
    group_vals = [
        g[target].values for _, g in valid.groupby(feature) if len(g) >= 10
    ]
    if len(group_vals) < 2:
        return None
    _, p_val = scipy_stats.f_oneway(*group_vals)

    best_pnl = groups["mean_pnl"].iloc[0]
    worst_pnl = groups["mean_pnl"].iloc[-1]

    return {
        "feature": feature,
        "n_valid": len(valid),
        "n_groups": len(groups),
        "p_value": p_val,
        "best_group": groups.index[0],
        "best_pnl": best_pnl,
        "worst_group": groups.index[-1],
        "worst_pnl": worst_pnl,
        "spread": best_pnl - worst_pnl,
        "groups": groups,
    }


def oos_validate_feature(df, feature, target="holly_pnl"):
    """OOS validation: compute Cohen's d on train and test sets."""
    valid = df[[feature, target, "entry_time"]].dropna()
    if len(valid) < 100:
        return None

    train = valid[valid["entry_time"] <= TRAIN_END]
    test = valid[valid["entry_time"] > TRAIN_END]

    if len(train) < 50 or len(test) < 50:
        return None

    # Train d
    train_wins = train[train[target] > 0][feature]
    train_losses = train[train[target] <= 0][feature]
    d_train = cohens_d(train_wins, train_losses)

    # Test d
    test_wins = test[test[target] > 0][feature]
    test_losses = test[test[target] <= 0][feature]
    d_test = cohens_d(test_wins, test_losses)

    # Check direction consistency
    train_dir = (
        1 if train_wins.mean() > train_losses.mean() else -1
    )
    test_dir = (
        1 if test_wins.mean() > test_losses.mean() else -1
    )
    stable = train_dir == test_dir

    return {
        "feature": feature,
        "d_train": d_train,
        "d_test": d_test,
        "n_train": len(train),
        "n_test": len(test),
        "stable": stable,
        "ratio": d_test / d_train if d_train > 0 else 0,
    }


def build_composite_model(df, new_features, label="v14"):
    """Build a direction-split GBT with v9 + new features."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import roc_auc_score

    all_features = V9_DIR_FEATURES + new_features

    # Filter to available features
    available = [f for f in all_features if f in df.columns]
    missing = [f for f in all_features if f not in df.columns]
    if missing:
        print(f"  Missing features (skipped): {missing}")

    target = "is_win"
    df[target] = (df["holly_pnl"] > 0).astype(int)

    # Train/test split
    train = df[df["entry_time"] <= TRAIN_END].copy()
    test = df[df["entry_time"] > TRAIN_END].copy()

    print(f"\n  {label} Composite Model")
    print(f"  {'='*50}")
    print(f"  Features: {len(available)} ({len(new_features)} new)")
    print(f"  Train: {len(train):,} | Test: {len(test):,}")

    results = {}
    for direction in ["long", "short"]:
        if "is_short" in df.columns:
            mask_col = "is_short"
            dir_val = 1 if direction == "short" else 0
        else:
            continue

        dir_train = train[train[mask_col] == dir_val]
        dir_test = test[test[mask_col] == dir_val]

        if len(dir_train) < 100 or len(dir_test) < 50:
            print(f"  {direction}: insufficient data")
            continue

        X_train = dir_train[available].copy()
        y_train = dir_train[target]
        X_test = dir_test[available].copy()
        y_test = dir_test[target]

        model = HistGradientBoostingClassifier(
            max_iter=200,
            max_depth=4,
            learning_rate=0.05,
            min_samples_leaf=50,
            l2_regularization=1.0,
            random_state=42,
        )
        model.fit(X_train, y_train)

        # Predictions
        train_proba = model.predict_proba(X_train)[:, 1]
        test_proba = model.predict_proba(X_test)[:, 1]

        train_auc = roc_auc_score(y_train, train_proba)
        test_auc = roc_auc_score(y_test, test_proba)

        # Decile spread on test set
        dir_test = dir_test.copy()
        dir_test["score"] = test_proba
        dir_test["decile"] = pd.qcut(
            dir_test["score"], 10, labels=False, duplicates="drop"
        )
        decile_pnl = dir_test.groupby("decile")["holly_pnl"].mean()
        d10 = decile_pnl.iloc[-1] if len(decile_pnl) >= 10 else np.nan
        d1 = decile_pnl.iloc[0] if len(decile_pnl) >= 1 else np.nan
        d_val = cohens_d(
            dir_test[dir_test["decile"] == decile_pnl.index[-1]]["holly_pnl"],
            dir_test[dir_test["decile"] == decile_pnl.index[0]]["holly_pnl"],
        )

        print(f"\n  {direction.upper()}:")
        print(f"    AUC: train={train_auc:.3f} test={test_auc:.3f}")
        print(f"    D10=${d10:,.0f} vs D1=${d1:,.0f}  "
              f"spread=${d10-d1:,.0f}  d={d_val:.3f}")

        # Feature importance (top 10)
        importances = model.feature_importances_
        imp_df = pd.DataFrame({
            "feature": available,
            "importance": importances,
        }).sort_values("importance", ascending=False)
        print(f"    Top features:")
        for _, row in imp_df.head(10).iterrows():
            marker = " *NEW*" if row["feature"] in new_features else ""
            print(f"      {row['feature']:30s} {row['importance']:.4f}{marker}")

        results[direction] = {
            "train_auc": train_auc,
            "test_auc": test_auc,
            "d10_pnl": d10,
            "d1_pnl": d1,
            "spread": d10 - d1 if not np.isnan(d10) else np.nan,
            "d": d_val,
        }

    return results


def main():
    print("=" * 60)
    print("Technical Indicator Lift Analysis (Script 93)")
    print("=" * 60)

    t0 = time.time()

    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    # Load base trade data
    print("\nLoading trade data...")
    df = con.execute("""
        SELECT t.*,
               -- Indicator features
               ti.rsi_14,
               ti.macd_value,
               ti.macd_signal,
               ti.macd_hist,
               ti.ema_9,
               ti.ema_21,
               ti.sma_20,
               ti.sma_50,
               ti.price_vs_ema9,
               ti.price_vs_ema21,
               ti.price_vs_sma50,
               ti.ema_spread,
               ti.rsi_zone,
               ti.macd_cross,
               ti.ma_trend,
               ti.above_ema9,
               ti.above_ema21,
               ti.above_sma50
        FROM trades t
        LEFT JOIN trade_indicator_features ti
            ON ti.trade_id = t.trade_id
    """).fetchdf()

    con.close()

    # Fix nullable integer columns
    for col in df.columns:
        if str(df[col].dtype) in ("Int64", "Int32", "boolean"):
            df[col] = df[col].astype("float64")

    print(f"  Trades: {len(df):,}")
    print(f"  With indicators: "
          f"{df['rsi_14'].notna().sum():,} ({100*df['rsi_14'].notna().mean():.1f}%)")

    # Winsorize extreme price_vs_MA values (penny stock reverse splits)
    for col in ["price_vs_ema9", "price_vs_ema21", "price_vs_sma50",
                "ema_spread"]:
        if col in df.columns:
            p01 = df[col].quantile(0.01)
            p99 = df[col].quantile(0.99)
            df[col] = df[col].clip(lower=p01, upper=p99)

    # =====================================================================
    # 1. CONTINUOUS FEATURE SEPARATION
    # =====================================================================
    print("\n" + "=" * 60)
    print("1. CONTINUOUS FEATURE SEPARATION (Cohen's d)")
    print("=" * 60)

    continuous_results = []
    for feat in CONTINUOUS_FEATURES:
        if feat not in df.columns:
            continue
        result = analyze_feature(df, feat)
        if result:
            continuous_results.append(result)

    # FDR correction
    p_vals = [r["p_value"] for r in continuous_results]
    sig_flags = fdr_correct(p_vals) if p_vals else []

    # Sort by Cohen's d
    continuous_results.sort(key=lambda x: x["d"], reverse=True)

    print(f"\n{'Feature':25s} {'d':>6s} {'p-value':>10s} {'FDR':>5s} "
          f"{'N':>7s} {'Cov%':>5s} {'D10$':>8s} {'D1$':>8s} {'Spread$':>9s}")
    print("-" * 90)
    for r in continuous_results:
        idx = next(
            i for i, x in enumerate(
                sorted(
                    [rr for rr in continuous_results],
                    key=lambda x: x["p_value"]
                )
            ) if x["feature"] == r["feature"]
        )
        fdr_flag = "YES" if idx < len(sig_flags) and sig_flags[idx] else "no"
        print(
            f"{r['feature']:25s} {r['d']:6.3f} {r['p_value']:10.2e} "
            f"{fdr_flag:>5s} {r['n_valid']:7,d} {r['coverage_pct']:5.1f} "
            f"{r['d10_pnl']:8,.0f} {r['d1_pnl']:8,.0f} "
            f"{r['spread_d10_d1']:9,.0f}"
        )

    # =====================================================================
    # 2. CATEGORICAL FEATURE ANALYSIS
    # =====================================================================
    print("\n" + "=" * 60)
    print("2. CATEGORICAL FEATURE ANALYSIS")
    print("=" * 60)

    for feat in CATEGORICAL_FEATURES:
        if feat not in df.columns:
            continue
        result = analyze_categorical(df, feat)
        if result:
            print(f"\n  {feat} (p={result['p_value']:.2e}):")
            print(f"    {'Group':15s} {'Count':>7s} {'Mean PnL':>10s} {'WR':>6s}")
            print(f"    {'-'*42}")
            for group_name, row in result["groups"].iterrows():
                print(
                    f"    {str(group_name):15s} {int(row['count']):7,d} "
                    f"${row['mean_pnl']:9,.0f} {100*row['win_rate']:5.1f}%"
                )
            print(
                f"    Spread: ${result['spread']:,.0f} "
                f"({result['best_group']} vs {result['worst_group']})"
            )

    # =====================================================================
    # 3. BINARY FEATURE ANALYSIS
    # =====================================================================
    print("\n" + "=" * 60)
    print("3. BINARY FEATURE ANALYSIS")
    print("=" * 60)

    for feat in BINARY_FEATURES:
        if feat not in df.columns:
            continue
        result = analyze_categorical(df, feat)
        if result:
            print(f"\n  {feat} (p={result['p_value']:.2e}):")
            for group_name, row in result["groups"].iterrows():
                label = "YES" if group_name == 1 else "NO"
                print(
                    f"    {label:5s}: n={int(row['count']):,d}, "
                    f"avg PnL=${row['mean_pnl']:,.0f}, "
                    f"WR={100*row['win_rate']:.1f}%"
                )

    # =====================================================================
    # 4. OOS VALIDATION
    # =====================================================================
    print("\n" + "=" * 60)
    print("4. OUT-OF-SAMPLE VALIDATION (train<=2021 vs test>2021)")
    print("=" * 60)

    oos_results = []
    all_test_features = CONTINUOUS_FEATURES + BINARY_FEATURES
    for feat in all_test_features:
        if feat not in df.columns:
            continue
        result = oos_validate_feature(df, feat)
        if result:
            oos_results.append(result)

    oos_results.sort(key=lambda x: x["d_test"], reverse=True)

    print(f"\n{'Feature':25s} {'d_train':>8s} {'d_test':>8s} "
          f"{'Ratio':>6s} {'Stable':>7s} {'n_train':>8s} {'n_test':>8s}")
    print("-" * 75)
    for r in oos_results:
        stable_str = "YES" if r["stable"] else "FLIP"
        print(
            f"{r['feature']:25s} {r['d_train']:8.3f} {r['d_test']:8.3f} "
            f"{r['ratio']:6.2f} {stable_str:>7s} "
            f"{r['n_train']:8,d} {r['n_test']:8,d}"
        )

    # =====================================================================
    # 5. COMPOSITE MODEL (v14 = v9 + best indicators)
    # =====================================================================
    print("\n" + "=" * 60)
    print("5. COMPOSITE MODEL COMPARISON")
    print("=" * 60)

    # Identify best new features (d > 0.03 and OOS stable)
    stable_features = [
        r["feature"] for r in oos_results
        if r["d_test"] > 0.02 and r["stable"]
    ]
    print(f"\n  Candidate features (d_test > 0.02, stable): {stable_features}")

    # Also include promising features from script 91
    # short_interest_pct (d=0.096 OOS), hy_spread (d=0.039 OOS)
    extra_features = []
    for f in ["short_interest_pct", "hy_spread"]:
        if f in df.columns:
            extra_features.append(f)

    all_new = list(set(stable_features + extra_features))
    print(f"  All new features to test: {all_new}")

    if all_new:
        # V9 baseline (no new features)
        print("\n  -- V9 Baseline (no new features) --")
        v9_results = build_composite_model(df, [], label="v9_baseline")

        # V14 with new features
        print(f"\n  -- V14 ({len(all_new)} new features) --")
        v14_results = build_composite_model(df, all_new, label="v14_indicators")

        # Compare
        print("\n  " + "=" * 50)
        print("  COMPARISON SUMMARY")
        print("  " + "=" * 50)
        for direction in ["long", "short"]:
            if direction in v9_results and direction in v14_results:
                v9 = v9_results[direction]
                v14 = v14_results[direction]
                print(f"\n  {direction.upper()}:")
                print(f"    V9:  AUC={v9['test_auc']:.3f}  "
                      f"d={v9['d']:.3f}  spread=${v9['spread']:,.0f}")
                print(f"    V14: AUC={v14['test_auc']:.3f}  "
                      f"d={v14['d']:.3f}  spread=${v14['spread']:,.0f}")
                delta_d = v14["d"] - v9["d"]
                print(f"    Delta d: {delta_d:+.3f} "
                      f"({'IMPROVEMENT' if delta_d > 0 else 'NO GAIN'})")
    else:
        print("\n  No stable features to add. Skipping composite model.")

    elapsed = time.time() - t0
    print(f"\nLift analysis complete in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
