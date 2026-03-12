"""Comprehensive feature importance analysis for Holly trade outcomes.

Joins Holly trades with VIX, SPY, and sector ETF data, then runs:
  1. Univariate bucket analysis (each feature vs win rate / avg PnL)
  2. Correlation matrix (features vs outcome)
  3. Random Forest feature importance
  4. Logistic regression coefficients
  5. Top-feature filter backtest with PnL impact

Usage:
    python -m holly_tearsheets.feature_importance
"""

import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).parent.parent))
warnings.filterwarnings("ignore")

from holly_tearsheets.data_loader import load_holly_data

CATALYST_DIR = Path(__file__).parent / "output" / "catalysts"
VIX_FILE = CATALYST_DIR / "vix_daily.parquet"
SPY_FILE = CATALYST_DIR / "spy_daily.parquet"
SECTOR_FILE = CATALYST_DIR / "sector_returns.parquet"


# ═══════════════════════════════════════════════════════════════════
# 1. BUILD FEATURE MATRIX
# ═══════════════════════════════════════════════════════════════════


def build_feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    """Join Holly trades with external market data and engineer features."""

    # Parse trade_date
    df = df.copy()
    df["trade_date"] = pd.to_datetime(df["trade_date"])

    # ── Load external data ────────────────────────────────────────
    vix = pd.read_parquet(VIX_FILE)
    spy = pd.read_parquet(SPY_FILE)
    sectors = pd.read_parquet(SECTOR_FILE)

    # Ensure date indices
    for ext in [vix, spy, sectors]:
        ext.index = pd.to_datetime(ext.index)

    # ── Join VIX ──────────────────────────────────────────────────
    vix_daily = vix.copy()
    vix_daily["vix_5d_avg"] = vix_daily["vix_close"].rolling(5).mean()
    vix_daily["vix_20d_avg"] = vix_daily["vix_close"].rolling(20).mean()
    vix_daily["vix_pctile_60d"] = vix_daily["vix_close"].rolling(60).apply(
        lambda x: stats.percentileofscore(x, x.iloc[-1]), raw=False
    )
    vix_daily["vix_change_1d"] = vix_daily["vix_close"].pct_change()
    vix_daily["vix_change_5d"] = vix_daily["vix_close"].pct_change(5)

    df = df.merge(
        vix_daily.reset_index().rename(columns={"index": "trade_date", "Date": "trade_date"}),
        on="trade_date", how="left",
    )

    # ── Join SPY ──────────────────────────────────────────────────
    spy_daily = spy.copy()
    spy_daily["spy_above_sma20"] = (
        spy_daily["spy_close"] > spy_daily["spy_close"].rolling(20).mean()
    ).astype(float)
    spy_daily["spy_above_sma50"] = (
        spy_daily["spy_close"] > spy_daily["spy_close"].rolling(50).mean()
    ).astype(float)

    df = df.merge(
        spy_daily.reset_index().rename(columns={"index": "trade_date", "Date": "trade_date"}),
        on="trade_date", how="left",
    )

    # ── Join sector returns ───────────────────────────────────────
    df = df.merge(
        sectors.reset_index().rename(columns={"index": "trade_date", "Date": "trade_date"}),
        on="trade_date", how="left",
    )

    # ── Engineer Holly-internal features ──────────────────────────
    # Time features
    if "entry_time" in df.columns:
        et = pd.to_datetime(df["entry_time"], errors="coerce")
        df["entry_hour"] = et.dt.hour + et.dt.minute / 60
        df["is_first_30min"] = (df["entry_hour"] < 10.0).astype(float)
        df["is_last_hour"] = (df["entry_hour"] >= 15.0).astype(float)
        df["is_lunch"] = ((df["entry_hour"] >= 11.5) & (df["entry_hour"] < 13.5)).astype(float)

    if "trade_date" in df.columns:
        df["trade_dow"] = pd.to_datetime(df["trade_date"]).dt.dayofweek  # Mon=0
        df["is_monday"] = (df["trade_dow"] == 0).astype(float)
        df["is_friday"] = (df["trade_dow"] == 4).astype(float)

    # Direction as numeric
    df["is_long"] = (df["direction"] == "Long").astype(float)

    # Relative metrics
    if "atr14" in df.columns and "entry_price" in df.columns:
        df["atr_pct"] = df["atr14"] / df["entry_price"] * 100

    if "daily_range_pct" in df.columns and "atr14" in df.columns:
        df["range_vs_atr"] = df["daily_range_pct"] / (df["atr14"] / df["entry_price"] * 100).replace(0, np.nan)

    # Strategy frequency as feature
    strat_counts = df["strategy"].value_counts()
    df["strategy_trade_count"] = df["strategy"].map(strat_counts)

    # VIX regime bucketing
    if "vix_close" in df.columns:
        df["vix_regime"] = pd.cut(
            df["vix_close"],
            bins=[0, 15, 20, 25, 35, 100],
            labels=["low(<15)", "normal(15-20)", "elevated(20-25)", "high(25-35)", "extreme(>35)"],
        )

    return df


# ═══════════════════════════════════════════════════════════════════
# 2. FEATURE SELECTION
# ═══════════════════════════════════════════════════════════════════

# Features we'll test — curated from available columns
CANDIDATE_FEATURES = [
    # External market context
    "vix_close", "vix_5d_avg", "vix_20d_avg", "vix_pctile_60d",
    "vix_change_1d", "vix_change_5d",
    "spy_return", "spy_5d_return", "spy_20d_return", "spy_vol_20d",
    "spy_above_sma20", "spy_above_sma50",
    # Sector returns
    "XLK", "XLF", "XLE", "XLV", "XLI", "XLP", "XLU",
    # Holly technicals
    "rsi14", "atr14", "atr_pct", "roc5", "roc20",
    "sma20", "daily_range_pct", "range_vs_atr",
    # Trade characteristics
    "entry_price", "market_cap", "is_long",
    "strategy_trade_count",
    # Time features
    "entry_hour", "trade_dow",
    "is_first_30min", "is_last_hour", "is_lunch",
    "is_monday", "is_friday",
    # Regime/conditional stats from Holly
    "strat_win_rate", "sector_win_rate", "trend_cond_wr",
    "strat_sector_prior_wr", "strat_sector_prior_n",
    # Probabilistic
    "prob_bayesian_wr", "prob_kelly", "prob_cohens_d",
    "prob_var95",
]


def get_available_features(df: pd.DataFrame) -> list[str]:
    """Return only features that actually exist and have enough data."""
    available = []
    for f in CANDIDATE_FEATURES:
        if f in df.columns:
            non_null = df[f].notna().sum()
            if non_null >= 100:  # need at least 100 data points
                available.append(f)
    return available


# ═══════════════════════════════════════════════════════════════════
# 3. UNIVARIATE BUCKET ANALYSIS
# ═══════════════════════════════════════════════════════════════════


def bucket_analysis(df: pd.DataFrame, feature: str, n_buckets: int = 5) -> pd.DataFrame:
    """Split feature into quantile buckets, compute win rate and avg PnL per bucket."""
    col = df[feature].dropna()
    if len(col) < 100:
        return None

    # Use quantile buckets for continuous, unique values for discrete
    nunique = col.nunique()
    if nunique <= 10:
        # Discrete — use actual values
        buckets = df.groupby(df[feature]).agg(
            trades=("trade_id", "count"),
            win_rate=("is_winner", "mean"),
            avg_pnl=("holly_pnl", "mean"),
            total_pnl=("holly_pnl", "sum"),
            median_pnl=("holly_pnl", "median"),
        )
    else:
        # Continuous — quantile buckets
        try:
            df = df.copy()
            df["_bucket"] = pd.qcut(df[feature], q=n_buckets, duplicates="drop")
            buckets = df.groupby("_bucket").agg(
                trades=("trade_id", "count"),
                win_rate=("is_winner", "mean"),
                avg_pnl=("holly_pnl", "mean"),
                total_pnl=("holly_pnl", "sum"),
                median_pnl=("holly_pnl", "median"),
            )
        except Exception:
            return None

    buckets["feature"] = feature
    return buckets


def run_bucket_analysis(df: pd.DataFrame, features: list[str]) -> pd.DataFrame:
    """Run bucket analysis for all features, return summary of spread."""
    results = []
    for feat in features:
        buckets = bucket_analysis(df, feat)
        if buckets is None or len(buckets) < 2:
            continue

        wr_spread = buckets["win_rate"].max() - buckets["win_rate"].min()
        pnl_spread = buckets["avg_pnl"].max() - buckets["avg_pnl"].min()

        # Best and worst buckets
        best_wr = buckets["win_rate"].idxmax()
        worst_wr = buckets["win_rate"].idxmin()
        best_pnl = buckets["avg_pnl"].idxmax()

        results.append({
            "feature": feat,
            "wr_spread": wr_spread,
            "pnl_spread": pnl_spread,
            "best_wr_bucket": str(best_wr),
            "best_wr": buckets.loc[best_wr, "win_rate"],
            "worst_wr_bucket": str(worst_wr),
            "worst_wr": buckets.loc[worst_wr, "win_rate"],
            "best_pnl_bucket": str(best_pnl),
            "best_avg_pnl": buckets.loc[best_pnl, "avg_pnl"],
        })

    return pd.DataFrame(results).sort_values("wr_spread", ascending=False)


# ═══════════════════════════════════════════════════════════════════
# 4. CORRELATION ANALYSIS
# ═══════════════════════════════════════════════════════════════════


def correlation_analysis(df: pd.DataFrame, features: list[str]) -> pd.DataFrame:
    """Point-biserial correlation of each feature vs is_winner."""
    results = []
    for feat in features:
        valid = df[[feat, "is_winner", "holly_pnl"]].dropna()
        if len(valid) < 100:
            continue

        # Correlation with win/loss
        corr_win, p_win = stats.pointbiserialr(valid["is_winner"], valid[feat])
        # Correlation with PnL
        corr_pnl, p_pnl = stats.pearsonr(valid["holly_pnl"], valid[feat])

        results.append({
            "feature": feat,
            "corr_vs_win": corr_win,
            "p_value_win": p_win,
            "corr_vs_pnl": corr_pnl,
            "p_value_pnl": p_pnl,
            "significant_win": p_win < 0.05,
            "significant_pnl": p_pnl < 0.05,
        })

    return pd.DataFrame(results).sort_values("corr_vs_win", key=abs, ascending=False)


# ═══════════════════════════════════════════════════════════════════
# 5. RANDOM FOREST FEATURE IMPORTANCE
# ═══════════════════════════════════════════════════════════════════


def random_forest_importance(df: pd.DataFrame, features: list[str]) -> pd.DataFrame:
    """Train a Random Forest classifier and extract feature importances."""
    try:
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.model_selection import cross_val_score
    except ImportError:
        print("  scikit-learn not installed — skipping RF importance")
        return pd.DataFrame()

    # Prepare data
    valid = df[features + ["is_winner"]].dropna()
    if len(valid) < 500:
        print(f"  Only {len(valid)} rows with no NaN — skipping RF")
        return pd.DataFrame()

    X = valid[features].values
    y = valid["is_winner"].astype(int).values

    # Train
    rf = RandomForestClassifier(
        n_estimators=200,
        max_depth=8,
        min_samples_leaf=50,
        random_state=42,
        n_jobs=-1,
    )
    rf.fit(X, y)

    # Cross-val accuracy
    cv_scores = cross_val_score(rf, X, y, cv=5, scoring="accuracy")

    importances = pd.DataFrame({
        "feature": features,
        "rf_importance": rf.feature_importances_,
    }).sort_values("rf_importance", ascending=False)

    print(f"  RF cross-val accuracy: {cv_scores.mean():.3f} ± {cv_scores.std():.3f}")
    print(f"  Baseline (always predict majority): {max(y.mean(), 1 - y.mean()):.3f}")

    return importances


# ═══════════════════════════════════════════════════════════════════
# 6. LOGISTIC REGRESSION
# ═══════════════════════════════════════════════════════════════════


def logistic_regression_analysis(df: pd.DataFrame, features: list[str]) -> pd.DataFrame:
    """Logistic regression with standardized coefficients."""
    try:
        from sklearn.linear_model import LogisticRegression
        from sklearn.preprocessing import StandardScaler
    except ImportError:
        print("  scikit-learn not installed — skipping logistic regression")
        return pd.DataFrame()

    valid = df[features + ["is_winner"]].dropna()
    if len(valid) < 500:
        return pd.DataFrame()

    X = valid[features].values
    y = valid["is_winner"].astype(int).values

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    lr = LogisticRegression(max_iter=1000, random_state=42)
    lr.fit(X_scaled, y)

    coefs = pd.DataFrame({
        "feature": features,
        "lr_coefficient": lr.coef_[0],
        "abs_coefficient": np.abs(lr.coef_[0]),
    }).sort_values("abs_coefficient", ascending=False)

    return coefs


# ═══════════════════════════════════════════════════════════════════
# 7. PRACTICAL FILTER TESTING
# ═══════════════════════════════════════════════════════════════════


def test_filter(df: pd.DataFrame, name: str, mask: pd.Series) -> dict:
    """Test a binary filter: compare kept vs filtered trades."""
    kept = df[mask]
    filtered = df[~mask]

    if len(kept) < 50 or len(filtered) < 50:
        return None

    return {
        "filter": name,
        "kept_trades": len(kept),
        "filtered_trades": len(filtered),
        "kept_wr": kept["is_winner"].mean(),
        "filtered_wr": filtered["is_winner"].mean(),
        "wr_lift": kept["is_winner"].mean() - df["is_winner"].mean(),
        "kept_avg_pnl": kept["holly_pnl"].mean(),
        "filtered_avg_pnl": filtered["holly_pnl"].mean(),
        "kept_total_pnl": kept["holly_pnl"].sum(),
        "original_total_pnl": df["holly_pnl"].sum(),
        "pnl_impact": kept["holly_pnl"].sum() - df["holly_pnl"].sum(),
        "pnl_per_trade_lift": kept["holly_pnl"].mean() - df["holly_pnl"].mean(),
        "kept_pct": len(kept) / len(df),
    }


def run_filter_tests(df: pd.DataFrame) -> pd.DataFrame:
    """Test a battery of practical pre-trade filters."""
    tests = []

    # ── VIX-based filters ─────────────────────────────────────────
    if "vix_close" in df.columns:
        tests.append(test_filter(df, "VIX < 20 (low vol only)",
                                 df["vix_close"] < 20))
        tests.append(test_filter(df, "VIX < 25 (skip high vol)",
                                 df["vix_close"] < 25))
        tests.append(test_filter(df, "VIX > 15 (skip very low vol)",
                                 df["vix_close"] > 15))
        tests.append(test_filter(df, "VIX 15-25 (normal range)",
                                 (df["vix_close"] >= 15) & (df["vix_close"] <= 25)))
        tests.append(test_filter(df, "VIX falling (1d change < 0)",
                                 df["vix_change_1d"] < 0))

    # ── SPY trend filters ─────────────────────────────────────────
    if "spy_return" in df.columns:
        tests.append(test_filter(df, "SPY green day (return > 0)",
                                 df["spy_return"] > 0))
        tests.append(test_filter(df, "SPY 20d trend up (20d ret > 0)",
                                 df["spy_20d_return"] > 0))
        tests.append(test_filter(df, "SPY above 20 SMA",
                                 df["spy_above_sma20"] > 0))
        tests.append(test_filter(df, "SPY above 50 SMA",
                                 df["spy_above_sma50"] > 0))
        tests.append(test_filter(df, "SPY vol < 1.5% (calm market)",
                                 df["spy_vol_20d"] < 0.015))

    # ── RSI filters ───────────────────────────────────────────────
    if "rsi14" in df.columns:
        tests.append(test_filter(df, "RSI 30-70 (avoid extremes)",
                                 (df["rsi14"] >= 30) & (df["rsi14"] <= 70)))
        tests.append(test_filter(df, "RSI > 50 (momentum up)",
                                 df["rsi14"] > 50))
        tests.append(test_filter(df, "RSI < 70 (not overbought)",
                                 df["rsi14"] < 70))

    # ── ATR / volatility filters ──────────────────────────────────
    if "atr_pct" in df.columns:
        q25 = df["atr_pct"].quantile(0.25)
        q75 = df["atr_pct"].quantile(0.75)
        tests.append(test_filter(df, f"ATR% < {q75:.1f} (skip most volatile)",
                                 df["atr_pct"] < q75))
        tests.append(test_filter(df, f"ATR% > {q25:.1f} (skip least volatile)",
                                 df["atr_pct"] > q25))
        med = df["atr_pct"].median()
        tests.append(test_filter(df, f"ATR% middle 50% ({q25:.1f}-{q75:.1f})",
                                 (df["atr_pct"] >= q25) & (df["atr_pct"] <= q75)))

    # ── Price filters ─────────────────────────────────────────────
    if "entry_price" in df.columns:
        tests.append(test_filter(df, "Price $10-50",
                                 (df["entry_price"] >= 10) & (df["entry_price"] <= 50)))
        tests.append(test_filter(df, "Price > $15",
                                 df["entry_price"] > 15))
        tests.append(test_filter(df, "Price $15-40",
                                 (df["entry_price"] >= 15) & (df["entry_price"] <= 40)))

    # ── Time-of-day filters ───────────────────────────────────────
    if "entry_hour" in df.columns:
        tests.append(test_filter(df, "First 30 min only",
                                 df["is_first_30min"] > 0))
        tests.append(test_filter(df, "Skip first 30 min",
                                 df["is_first_30min"] == 0))
        tests.append(test_filter(df, "Skip lunch (11:30-1:30)",
                                 df["is_lunch"] == 0))
        tests.append(test_filter(df, "Morning only (before 12pm)",
                                 df["entry_hour"] < 12))

    # ── Day-of-week filters ───────────────────────────────────────
    if "trade_dow" in df.columns:
        tests.append(test_filter(df, "Skip Monday",
                                 df["is_monday"] == 0))
        tests.append(test_filter(df, "Skip Friday",
                                 df["is_friday"] == 0))
        tests.append(test_filter(df, "Tue-Thu only",
                                 df["trade_dow"].isin([1, 2, 3])))

    # ── Direction filters ─────────────────────────────────────────
    tests.append(test_filter(df, "Long only",
                             df["is_long"] > 0))
    tests.append(test_filter(df, "Short only",
                             df["is_long"] == 0))

    # ── Strategy frequency ────────────────────────────────────────
    if "strategy_trade_count" in df.columns:
        med = df["strategy_trade_count"].median()
        tests.append(test_filter(df, f"High-freq strategies (>{int(med)} trades)",
                                 df["strategy_trade_count"] > med))

    # ── Market cap ────────────────────────────────────────────────
    if "market_cap" in df.columns:
        tests.append(test_filter(df, "Market cap > $1B",
                                 df["market_cap"] > 1e9))
        tests.append(test_filter(df, "Market cap > $5B",
                                 df["market_cap"] > 5e9))

    # ── Holly conditional stats ───────────────────────────────────
    if "strat_win_rate" in df.columns:
        tests.append(test_filter(df, "Strategy WR > 50%",
                                 df["strat_win_rate"] > 0.50))
        tests.append(test_filter(df, "Strategy WR > 55%",
                                 df["strat_win_rate"] > 0.55))

    if "prob_bayesian_wr" in df.columns:
        tests.append(test_filter(df, "Bayesian WR > 50%",
                                 df["prob_bayesian_wr"] > 0.50))

    if "prob_kelly" in df.columns:
        tests.append(test_filter(df, "Kelly > 0 (positive edge)",
                                 df["prob_kelly"] > 0))

    if "prob_cohens_d" in df.columns:
        tests.append(test_filter(df, "Cohen's d > 0.2 (small+ effect)",
                                 df["prob_cohens_d"] > 0.2))

    # ── SPY + Direction combos ────────────────────────────────────
    if "spy_return" in df.columns:
        tests.append(test_filter(df, "Long on SPY green day",
                                 (df["is_long"] > 0) & (df["spy_return"] > 0)))
        tests.append(test_filter(df, "Short on SPY red day",
                                 (df["is_long"] == 0) & (df["spy_return"] < 0)))
        # Align direction with market
        tests.append(test_filter(df, "Direction aligned with SPY",
                                 ((df["is_long"] > 0) & (df["spy_return"] > 0)) |
                                 ((df["is_long"] == 0) & (df["spy_return"] < 0))))

    # ── VIX + Direction combos ────────────────────────────────────
    if "vix_close" in df.columns:
        tests.append(test_filter(df, "Long + VIX < 20",
                                 (df["is_long"] > 0) & (df["vix_close"] < 20)))
        tests.append(test_filter(df, "Short + VIX > 20",
                                 (df["is_long"] == 0) & (df["vix_close"] > 20)))

    results = [r for r in tests if r is not None]
    return pd.DataFrame(results).sort_values("wr_lift", ascending=False)


# ═══════════════════════════════════════════════════════════════════
# 8. COMBINED TOP FILTERS
# ═══════════════════════════════════════════════════════════════════


def test_combined_filters(df: pd.DataFrame, filter_results: pd.DataFrame) -> None:
    """Stack top filters and measure combined impact."""
    print(f"\n{'='*70}")
    print("COMBINED FILTER STACKING")
    print(f"{'='*70}")

    # Start with all trades
    current = df.copy()
    baseline_pnl = df["holly_pnl"].sum()
    baseline_wr = df["is_winner"].mean()
    applied = []

    # Pick top filters by WR lift that keep >50% of trades
    good_filters = filter_results[
        (filter_results["wr_lift"] > 0.005) &
        (filter_results["kept_pct"] > 0.40) &
        (filter_results["kept_pct"] < 0.95) &
        (filter_results["pnl_impact"] > 0)
    ].head(10)

    print(f"\nBaseline: {len(df):,} trades | WR={baseline_wr:.1%} | Total PnL=${baseline_pnl:,.0f}")
    print(f"\nTop candidate filters (WR lift > 0.5%, keeps 40-95% of trades, positive PnL impact):")
    print("-" * 90)

    for _, row in good_filters.iterrows():
        print(
            f"  {row['filter']:<45} "
            f"WR lift={row['wr_lift']:+.1%}  "
            f"PnL impact=${row['pnl_impact']:+,.0f}  "
            f"Keeps={row['kept_pct']:.0%}"
        )


# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════


def main():
    print("=" * 70)
    print("HOLLY FEATURE IMPORTANCE ANALYSIS")
    print("=" * 70)

    # Load and build feature matrix
    print("\n[1/6] Loading data and building feature matrix...")
    df = load_holly_data(validate=False)
    df = build_feature_matrix(df)
    print(f"  {len(df):,} trades, {len(df.columns)} columns")

    # Get available features
    features = get_available_features(df)
    print(f"  {len(features)} candidate features available")

    # ── Univariate bucket analysis ────────────────────────────────
    print(f"\n[2/6] Running univariate bucket analysis...")
    bucket_results = run_bucket_analysis(df, features)
    print(f"\n  Top 20 features by win-rate spread across buckets:")
    print(f"  {'Feature':<30} {'WR Spread':>10} {'PnL Spread':>12} {'Best WR':>10} {'Worst WR':>10}")
    print("  " + "-" * 75)
    for _, r in bucket_results.head(20).iterrows():
        print(
            f"  {r['feature']:<30} {r['wr_spread']:>9.1%} "
            f"${r['pnl_spread']:>11,.0f} "
            f"{r['best_wr']:>9.1%} {r['worst_wr']:>9.1%}"
        )

    # ── Correlation analysis ──────────────────────────────────────
    print(f"\n[3/6] Running correlation analysis...")
    corr_results = correlation_analysis(df, features)
    sig = corr_results[corr_results["significant_win"]]
    print(f"\n  {len(sig)} features significantly correlated with win/loss (p<0.05):")
    print(f"  {'Feature':<30} {'Corr (win)':>12} {'p-value':>10} {'Corr (PnL)':>12}")
    print("  " + "-" * 67)
    for _, r in sig.head(20).iterrows():
        print(
            f"  {r['feature']:<30} {r['corr_vs_win']:>11.4f} "
            f"{r['p_value_win']:>9.2e} {r['corr_vs_pnl']:>11.4f}"
        )

    # ── Random Forest ─────────────────────────────────────────────
    print(f"\n[4/6] Training Random Forest classifier...")
    # Use features that have enough non-null overlap
    rf_features = [f for f in features if df[f].notna().sum() > len(df) * 0.5]
    rf_results = random_forest_importance(df, rf_features)
    if not rf_results.empty:
        print(f"\n  Top 20 features by RF importance:")
        print(f"  {'Feature':<30} {'Importance':>12}")
        print("  " + "-" * 44)
        for _, r in rf_results.head(20).iterrows():
            bar = "#" * int(r["rf_importance"] * 200)
            print(f"  {r['feature']:<30} {r['rf_importance']:>11.4f} {bar}")

    # ── Logistic Regression ───────────────────────────────────────
    print(f"\n[5/6] Running Logistic Regression...")
    lr_results = logistic_regression_analysis(df, rf_features)
    if not lr_results.empty:
        print(f"\n  Top 20 features by standardized LR coefficient:")
        print(f"  {'Feature':<30} {'Coefficient':>14} {'Direction':>10}")
        print("  " + "-" * 57)
        for _, r in lr_results.head(20).iterrows():
            direction = "-> WIN" if r["lr_coefficient"] > 0 else "-> LOSS"
            print(f"  {r['feature']:<30} {r['lr_coefficient']:>13.4f} {direction}")

    # ── Practical filter tests ────────────────────────────────────
    print(f"\n[6/6] Testing practical pre-trade filters...")
    filter_results = run_filter_tests(df)

    print(f"\n  {'Filter':<45} {'Trades':>7} {'WR':>7} {'WR Lift':>8} {'Avg PnL':>10} {'PnL Impact':>14}")
    print("  " + "-" * 95)
    for _, r in filter_results.head(30).iterrows():
        print(
            f"  {r['filter']:<45} {r['kept_trades']:>7,} "
            f"{r['kept_wr']:>6.1%} {r['wr_lift']:>+7.1%} "
            f"${r['kept_avg_pnl']:>9,.0f} "
            f"${r['pnl_impact']:>13,.0f}"
        )

    # ── Combined filters ──────────────────────────────────────────
    test_combined_filters(df, filter_results)

    # ── FINAL SYNTHESIS ───────────────────────────────────────────
    print(f"\n{'='*70}")
    print("SYNTHESIS — ACTIONABLE FINDINGS")
    print(f"{'='*70}")

    # Merge all rankings
    if not rf_results.empty and not corr_results.empty:
        merged = rf_results.merge(
            corr_results[["feature", "corr_vs_win", "significant_win"]],
            on="feature", how="left",
        )
        if not lr_results.empty:
            merged = merged.merge(
                lr_results[["feature", "lr_coefficient"]],
                on="feature", how="left",
            )
        merged = merged.merge(
            bucket_results[["feature", "wr_spread", "pnl_spread"]],
            on="feature", how="left",
        )

        # Composite score: normalize and average
        for col in ["rf_importance", "wr_spread"]:
            if col in merged.columns:
                cmax = merged[col].max()
                if cmax > 0:
                    merged[f"{col}_norm"] = merged[col] / cmax
                else:
                    merged[f"{col}_norm"] = 0
        merged["abs_corr_norm"] = merged["corr_vs_win"].abs() / merged["corr_vs_win"].abs().max()

        score_cols = [c for c in ["rf_importance_norm", "abs_corr_norm", "wr_spread_norm"] if c in merged.columns]
        merged["composite_score"] = merged[score_cols].mean(axis=1)
        merged = merged.sort_values("composite_score", ascending=False)

        print(f"\n  COMPOSITE FEATURE RANKING (RF importance + correlation + bucket spread):")
        print(f"  {'Rank':>4} {'Feature':<30} {'Composite':>10} {'RF Imp':>8} {'Corr':>8} {'WR Spread':>10} {'Sig?':>5}")
        print("  " + "-" * 78)
        for i, (_, r) in enumerate(merged.head(25).iterrows()):
            sig_flag = "***" if r.get("significant_win", False) else ""
            print(
                f"  {i+1:>4} {r['feature']:<30} {r['composite_score']:>9.3f} "
                f"{r['rf_importance']:>7.4f} {r.get('corr_vs_win', 0):>7.4f} "
                f"{r.get('wr_spread', 0):>9.1%} {sig_flag:>5}"
            )


if __name__ == "__main__":
    main()
