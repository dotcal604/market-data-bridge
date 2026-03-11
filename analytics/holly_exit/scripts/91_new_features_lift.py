"""
Script 91 -- Lift Analysis for New Features (FRED Extended, Shorts, Insider)
=============================================================================
Tests win/loss separation (Cohen's d with FDR correction) for all features
from scripts 88-90:
  1. Extended FRED macro (HY spread, initial claims, breakeven inflation,
     USD index, credit/claims/USD regimes)
  2. Polygon short interest (short interest, days to cover, squeeze regime)
  3. Polygon short volume (short volume ratio, 5d avg, relative ratio)
  4. SEC insider transactions (insider buys 7d/30d/90d, cluster buying,
     officer/director/10pct buys, buy intensity)

Then builds a composite v13 model with the best new features added to the
v9 baseline.

Usage:
    python scripts/91_new_features_lift.py
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

# -- V9 baseline features (from script 82) ------------------------------
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


def cohens_d(group1, group2):
    """Compute Cohen's d between two groups."""
    n1, n2 = len(group1), len(group2)
    if n1 < 5 or n2 < 5:
        return 0.0
    m1, m2 = group1.mean(), group2.mean()
    s1, s2 = group1.std(), group2.std()
    pooled_std = np.sqrt(((n1 - 1) * s1**2 + (n2 - 1) * s2**2) / (n1 + n2 - 2))
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
    t_stat, p_val = scipy_stats.ttest_ind(wins, losses, equal_var=False)

    # Decile analysis
    try:
        valid["decile"] = pd.qcut(valid[feature], 10, labels=False,
                                  duplicates="drop")
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
    group_vals = [g[target].values for _, g in valid.groupby(feature)
                  if len(g) >= 10]
    if len(group_vals) < 2:
        return None
    f_stat, p_val = scipy_stats.f_oneway(*group_vals)

    # Effect size: best vs worst group
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
        "detail": groups.to_string(),
    }


def load_all_features(con):
    """Join trades with all new feature tables."""
    print("Loading trade data with new features...")

    df = con.execute("""
        SELECT
            t.trade_id,
            t.symbol,
            t.strategy,
            t.direction,
            t.entry_time,
            CAST(t.entry_time AS DATE) AS trade_date,
            t.holly_pnl,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS is_win,

            -- Extended FRED macro
            fm.hy_spread,
            fm.initial_claims,
            fm.breakeven_inflation_10y,
            fm.usd_index,
            fm.credit_regime,
            fm.claims_regime,
            fm.usd_direction,

            -- Short interest
            sf.short_interest,
            sf.si_avg_daily_volume,
            sf.days_to_cover,
            sf.short_squeeze_regime,

            -- Short volume
            sf.short_volume_ratio,
            sf.short_vol_ratio_5d,
            sf.short_vol_ratio_rel,

            -- Insider transactions
            inf.insider_buys_30d,
            inf.insider_buy_value_30d,
            inf.insider_buys_7d,
            inf.insider_buy_value_7d,
            inf.insider_buys_90d,
            inf.any_insider_buy_30d,
            inf.any_insider_buy_7d,
            inf.cluster_buying_30d,
            inf.has_officer_buy_30d,
            inf.has_director_buy_30d,
            inf.has_10pct_buy_30d,
            inf.insider_buy_intensity

        FROM trades t
        LEFT JOIN fred_macro_extended fm
            ON fm.date = CAST(t.entry_time AS DATE)
        LEFT JOIN trade_short_features sf
            ON sf.trade_id = t.trade_id
        LEFT JOIN trade_insider_features inf
            ON inf.trade_id = t.trade_id
    """).fetchdf()

    print(f"  Loaded {len(df):,} trades")

    # Derived features
    # Convert nullable integer columns to float to avoid NA comparison issues
    for col in df.columns:
        if df[col].dtype == "Int64" or df[col].dtype == "Int32":
            df[col] = df[col].astype("float64")

    if "short_interest" in df.columns and "si_avg_daily_volume" in df.columns:
        mask = df["si_avg_daily_volume"].fillna(0) > 0
        df["short_interest_pct"] = np.where(
            mask,
            df["short_interest"] / df["si_avg_daily_volume"].replace(0, np.nan),
            np.nan,
        )

    return df


def run_lift_analysis(df):
    """Run Cohen's d analysis on all new features."""
    print("\n" + "=" * 70)
    print("LIFT ANALYSIS -- New Features (Scripts 88-90)")
    print("=" * 70)

    # Split into train/test for OOS validation
    df["trade_date_str"] = df["trade_date"].astype(str)
    train = df[df["trade_date_str"] <= TRAIN_END]
    test = df[df["trade_date_str"] > TRAIN_END]
    print(f"  Train: {len(train):,} trades (<={TRAIN_END})")
    print(f"  Test:  {len(test):,} trades (>{TRAIN_END})")

    # -- Continuous features ------------------------------------------
    continuous_features = [
        # FRED extended
        "hy_spread", "initial_claims", "breakeven_inflation_10y", "usd_index",
        # Short interest
        "short_interest", "days_to_cover", "short_interest_pct",
        # Short volume
        "short_volume_ratio", "short_vol_ratio_5d", "short_vol_ratio_rel",
        # Insider
        "insider_buys_30d", "insider_buy_value_30d",
        "insider_buys_7d", "insider_buy_value_7d",
        "insider_buys_90d", "insider_buy_intensity",
        "any_insider_buy_30d", "any_insider_buy_7d",
        "cluster_buying_30d",
        "has_officer_buy_30d", "has_director_buy_30d", "has_10pct_buy_30d",
    ]

    print("\n-- Continuous Features (Cohen's d) --")
    print(f"{'Feature':<30} {'d':>6} {'p':>10} {'N':>7} "
          f"{'Cov%':>5} {'D10$':>10} {'D1$':>10} {'Spread':>10}")
    print("-" * 100)

    results = []
    for feat in continuous_features:
        if feat not in df.columns:
            continue
        r = analyze_feature(train, feat)
        if r:
            results.append(r)

    # FDR correction
    p_values = [r["p_value"] for r in results]
    sig_flags = fdr_correct(p_values)

    # Sort by Cohen's d
    sorted_results = sorted(results, key=lambda x: x["d"], reverse=True)
    sorted_sig = {r["feature"]: sig_flags[i]
                  for i, r in enumerate(results)}

    for r in sorted_results:
        sig = "*" if sorted_sig.get(r["feature"]) else " "
        print(f"{r['feature']:<30} {r['d']:>6.3f} {r['p_value']:>10.2e} "
              f"{r['n_valid']:>7,} {r['coverage_pct']:>5.1f} "
              f"{r['d10_pnl']:>10.0f} {r['d1_pnl']:>10.0f} "
              f"{r['spread_d10_d1']:>10.0f} {sig}")

    # -- Categorical features ----------------------------------------─
    categorical_features = [
        "credit_regime", "claims_regime", "usd_direction",
        "short_squeeze_regime",
    ]

    print("\n-- Categorical Features (ANOVA) --")
    for feat in categorical_features:
        if feat not in df.columns:
            continue
        r = analyze_categorical(train, feat)
        if r:
            print(f"\n  {feat} (n={r['n_valid']:,}, "
                  f"p={r['p_value']:.2e}, "
                  f"spread=${r['spread']:.0f})")
            print(f"    Best: {r['best_group']} (${r['best_pnl']:.0f})")
            print(f"    Worst: {r['worst_group']} (${r['worst_pnl']:.0f})")
            print(f"    {r['detail']}")

    # -- OOS validation for top features ------------------------------
    print("\n-- OOS Validation (Test Set) --")
    top_features = [r["feature"] for r in sorted_results if r["d"] >= 0.05]
    if not top_features:
        top_features = [r["feature"] for r in sorted_results[:5]]

    print(f"{'Feature':<30} {'Train d':>8} {'Test d':>8} "
          f"{'Train p':>10} {'Test p':>10} {'Stable?':>8}")
    print("-" * 80)

    for feat in top_features:
        train_r = analyze_feature(train, feat)
        test_r = analyze_feature(test, feat)
        if train_r and test_r:
            stable = "YES" if (test_r["d"] >= 0.03
                              and np.sign(train_r.get("spread_d10_d1", 0))
                              == np.sign(test_r.get("spread_d10_d1", 0))) \
                else "no"
            print(f"{feat:<30} {train_r['d']:>8.3f} {test_r['d']:>8.3f} "
                  f"{train_r['p_value']:>10.2e} {test_r['p_value']:>10.2e} "
                  f"{stable:>8}")

    return sorted_results


def build_composite_v13(df, top_features):
    """Test composite model with best new features added to v9 baseline."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import roc_auc_score

    print("\n" + "=" * 70)
    print("COMPOSITE V13 -- V9 + Best New Features")
    print("=" * 70)

    # Prepare base features
    df["is_short"] = (df["direction"] == "short").astype(int)
    df["strat_mighty_mouse"] = (
        df["strategy"].str.contains("Mighty Mouse", case=False, na=False)
    ).astype(int)
    df["trade_date_str"] = df["trade_date"].astype(str)
    df["is_win"] = (df["holly_pnl"] > 0).astype(int)

    train = df[df["trade_date_str"] <= TRAIN_END].copy()
    test = df[df["trade_date_str"] > TRAIN_END].copy()

    # Filter to features with d >= 0.03 from lift analysis
    new_feats = [f for f in top_features if f in df.columns]
    if not new_feats:
        print("  No significant new features to add")
        return

    # Model configs
    configs = {
        "v9_baseline": V9_DIR_FEATURES,
        "v13_all_new": V9_DIR_FEATURES + new_feats,
    }

    # Also test individual new feature groups
    fred_feats = [f for f in new_feats
                  if f in ("hy_spread", "initial_claims",
                           "breakeven_inflation_10y", "usd_index")]
    short_feats = [f for f in new_feats
                   if "short" in f or "days_to_cover" in f]
    insider_feats = [f for f in new_feats if "insider" in f or "buy" in f]

    if fred_feats:
        configs["v13_fred_only"] = V9_DIR_FEATURES + fred_feats
    if short_feats:
        configs["v13_shorts_only"] = V9_DIR_FEATURES + short_feats
    if insider_feats:
        configs["v13_insider_only"] = V9_DIR_FEATURES + insider_feats

    # Run each config
    print(f"\n{'Config':<25} {'AUC':>6} {'D10 PnL':>10} {'D1 PnL':>10} "
          f"{'d(D10-D1)':>10} {'N_feat':>7}")
    print("-" * 75)

    for name, features in configs.items():
        available = [f for f in features if f in train.columns]

        X_train = train[available].copy()
        y_train = train["is_win"]
        X_test = test[available].copy()
        y_test = test["is_win"]
        pnl_test = test["holly_pnl"]

        model = HistGradientBoostingClassifier(
            max_iter=300,
            max_depth=4,
            learning_rate=0.05,
            min_samples_leaf=50,
            max_features=0.8,
            random_state=42,
        )
        model.fit(X_train, y_train)

        proba = model.predict_proba(X_test)[:, 1]
        auc = roc_auc_score(y_test, proba)

        # Decile PnL
        test_scored = pd.DataFrame({
            "score": proba, "pnl": pnl_test.values
        })
        test_scored["decile"] = pd.qcut(
            test_scored["score"], 10, labels=False, duplicates="drop"
        )
        decile_pnl = test_scored.groupby("decile")["pnl"].mean()
        d10 = decile_pnl.iloc[-1] if len(decile_pnl) >= 10 else np.nan
        d1 = decile_pnl.iloc[0] if len(decile_pnl) >= 1 else np.nan

        # Cohen's d for D10 vs D1
        d10_vals = test_scored[
            test_scored["decile"] == test_scored["decile"].max()
        ]["pnl"]
        d1_vals = test_scored[
            test_scored["decile"] == test_scored["decile"].min()
        ]["pnl"]
        d = cohens_d(d10_vals, d1_vals)

        print(f"{name:<25} {auc:>6.4f} {d10:>10.0f} {d1:>10.0f} "
              f"{d:>10.3f} {len(available):>7}")

    # Feature importance for v13_all_new
    if "v13_all_new" in configs:
        available = [f for f in configs["v13_all_new"] if f in train.columns]
        X_train = train[available].copy()
        y_train = train["is_win"]

        model = HistGradientBoostingClassifier(
            max_iter=300, max_depth=4, learning_rate=0.05,
            min_samples_leaf=50, max_features=0.8, random_state=42,
        )
        model.fit(X_train, y_train)

        # Permutation importance on test set
        from sklearn.inspection import permutation_importance

        X_test = test[available].copy()
        y_test = test["is_win"]

        perm = permutation_importance(
            model, X_test, y_test, n_repeats=10,
            random_state=42, scoring="roc_auc",
        )
        imp = pd.DataFrame({
            "feature": available,
            "importance": perm.importances_mean,
        }).sort_values("importance", ascending=False)

        print("\n  Permutation Importance (v13_all_new, top 15):")
        for _, row in imp.head(15).iterrows():
            marker = " *NEW*" if row["feature"] not in V9_DIR_FEATURES else ""
            print(f"    {row['feature']:<30} {row['importance']:>+.4f}{marker}")


def main():
    print("=" * 70)
    print("Script 91 -- Lift Analysis for New Features")
    print("=" * 70)
    t0 = time.time()

    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    # Check available tables
    tables = [r[0] for r in con.execute(
        "SELECT table_name FROM information_schema.tables"
    ).fetchall()]
    print(f"\n  Available new tables:")
    for t in ["fred_macro_extended", "polygon_short_interest",
              "polygon_short_volume", "trade_short_features",
              "sec_insider_raw", "trade_insider_features"]:
        if t in tables:
            cnt = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(f"    {t}: {cnt:,} rows")
        else:
            print(f"    {t}: MISSING")

    # Load all features
    df = load_all_features(con)
    con.close()

    # Run lift analysis
    sorted_results = run_lift_analysis(df)

    # Get features with d >= 0.03 for composite model
    top_features = [r["feature"] for r in sorted_results if r["d"] >= 0.03]
    print(f"\n  Features with d >= 0.03: {len(top_features)}")
    for f in top_features:
        d_val = next(r["d"] for r in sorted_results if r["feature"] == f)
        print(f"    {f}: d={d_val:.3f}")

    # Build composite model
    build_composite_v13(df, top_features)

    elapsed = time.time() - t0
    print(f"\nScript 91 complete in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
