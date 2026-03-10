"""
60_gradient_boosting_model.py — Nonlinear model to break through linear composite ceiling.

Linear scoring (v2/v3) plateaued at OOS Cohen's d ≈ 0.60. This script uses
HistGradientBoostingClassifier to discover nonlinear interactions between the
14 features, with proper walk-forward OOS validation.

Key advantages over linear composite:
  - Automatically finds interaction effects (e.g., market cap × strategy)
  - Handles NaN natively (no imputation needed)
  - Non-monotonic feature relationships (e.g., mid-range VIX best)
  - Feature importance from tree structure

Walk-forward: train on first 60% (chronological), test on last 40%.
Compare OOS decile separation to linear v3 (d ≈ 0.60).

Output: reports/gradient-boosting-model.md

Usage:
    python scripts/60_gradient_boosting_model.py
"""

import sys
import time
import warnings
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH, DATA_DIR

REPORT_DIR = DATA_DIR.parent / "output" / "reports"
warnings.filterwarnings("ignore", category=FutureWarning)


def welch_t_test(a: pd.Series, b: pd.Series) -> dict:
    a, b = a.dropna(), b.dropna()
    if len(a) < 10 or len(b) < 10:
        return {"t_stat": np.nan, "p_value": np.nan, "cohens_d": np.nan,
                "n_a": len(a), "n_b": len(b)}
    t_stat, p_value = stats.ttest_ind(a, b, equal_var=False)
    pooled_std = np.sqrt((a.std()**2 + b.std()**2) / 2)
    cohens_d = (a.mean() - b.mean()) / pooled_std if pooled_std > 0 else 0
    return {"t_stat": t_stat, "p_value": p_value, "cohens_d": cohens_d,
            "n_a": len(a), "n_b": len(b)}


def load_all_features(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Load trades with ALL raw feature values (no scoring/z-transformation)."""
    print("Loading trades with raw features...")
    t0 = time.time()

    # Base query with regime, fred, ticker joins
    df = con.execute("""
        SELECT
            t.trade_id, t.symbol, t.entry_time, t.entry_price,
            t.strategy, t.direction, t.holly_pnl, t.mfe, t.mae,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            CAST(t.entry_time AS DATE) AS trade_date,
            EXTRACT(QUARTER FROM t.entry_time) AS quarter,
            EXTRACT(DOW FROM t.entry_time) AS dow,
            EXTRACT(HOUR FROM t.entry_time) AS hour,
            r.vol_regime, r.atr_pct,
            fm.vix, fm.yield_spread_10y2y,
            td.market_cap
        FROM trades t
        LEFT JOIN trade_regime r ON r.trade_id = t.trade_id
        LEFT JOIN fred_macro_daily fm ON fm.date = CAST(t.entry_time AS DATE)
        LEFT JOIN ticker_details td ON td.symbol = t.symbol
    """).fetchdf()

    # Earnings proximity
    earnings_df = con.execute("""
        SELECT
            t.trade_id,
            COALESCE(
                MIN(ABS(DATEDIFF('day',
                    CAST(t.entry_time AS DATE),
                    ec.earnings_date
                ))),
                999
            ) AS days_to_earnings
        FROM trades t
        LEFT JOIN earnings_calendar ec
            ON ec.symbol = t.symbol
            AND ec.earnings_date BETWEEN
                CAST(t.entry_time AS DATE) - INTERVAL '30 days'
                AND CAST(t.entry_time AS DATE) + INTERVAL '30 days'
        GROUP BY t.trade_id
    """).fetchdf()
    df = df.merge(earnings_df, on="trade_id", how="left")

    # Intraday features from bars
    print("  Computing intraday features from minute bars...")
    t1 = time.time()

    intraday_df = con.execute("""
        WITH trade_bars AS (
            SELECT
                t.trade_id,
                t.entry_price,
                b.bar_time, b.close AS bar_close,
                b.volume AS bar_volume, b.vwap AS bar_vwap
            FROM trades t
            JOIN bars b ON b.symbol = t.symbol
                AND CAST(b.bar_time AS DATE) = CAST(t.entry_time AS DATE)
                AND b.bar_time <= t.entry_time
        ),
        opening_range AS (
            SELECT
                symbol,
                CAST(bar_time AS DATE) AS trade_date,
                MAX(high) - MIN(low) AS or_range,
                MAX(high) AS or_high,
                MIN(low) AS or_low,
                AVG((high + low) / 2) AS or_mid
            FROM bars
            WHERE EXTRACT(HOUR FROM bar_time) * 60 + EXTRACT(MINUTE FROM bar_time)
                BETWEEN 570 AND 600
            GROUP BY symbol, CAST(bar_time AS DATE)
        ),
        pre_entry_stats AS (
            SELECT
                trade_id,
                SUM(bar_volume * bar_vwap) / NULLIF(SUM(bar_volume), 0) AS cum_vwap,
                SUM(bar_volume) AS pre_entry_volume,
                COUNT(*) AS bars_before_entry
            FROM trade_bars
            GROUP BY trade_id
        ),
        momentum AS (
            SELECT
                trade_id,
                LAST(bar_close ORDER BY bar_time) - FIRST(bar_close ORDER BY bar_time) AS momentum_10
            FROM (
                SELECT trade_id, bar_time, bar_close,
                    ROW_NUMBER() OVER (PARTITION BY trade_id ORDER BY bar_time DESC) AS rn
                FROM trade_bars
            ) sub
            WHERE rn <= 10
            GROUP BY trade_id
        )
        SELECT
            t.trade_id,
            CASE
                WHEN ps.cum_vwap IS NOT NULL
                THEN (t.entry_price - ps.cum_vwap) / ps.cum_vwap * 100
                ELSE NULL
            END AS vwap_position_pct,
            CASE
                WHEN orng.or_mid IS NOT NULL AND orng.or_mid > 0
                THEN orng.or_range / orng.or_mid * 100
                ELSE NULL
            END AS opening_range_pct,
            CASE
                WHEN t.entry_price > 0 AND m.momentum_10 IS NOT NULL
                THEN m.momentum_10 / t.entry_price * 100
                ELSE NULL
            END AS momentum_pct,
            ps.bars_before_entry
        FROM trades t
        LEFT JOIN pre_entry_stats ps ON ps.trade_id = t.trade_id
        LEFT JOIN opening_range orng ON orng.symbol = t.symbol
            AND orng.trade_date = CAST(t.entry_time AS DATE)
        LEFT JOIN momentum m ON m.trade_id = t.trade_id
    """).fetchdf()

    df = df.merge(intraday_df, on="trade_id", how="left")
    print(f"  Intraday features: {time.time()-t1:.1f}s")

    # Financial fundamentals
    print("  Loading financial fundamentals...")
    t2 = time.time()

    fin_df = con.execute("""
        WITH ranked AS (
            SELECT
                t.trade_id,
                f.operating_income,
                f.net_income,
                f.revenues,
                f.eps_diluted,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id
                    ORDER BY CAST(f.filing_date AS DATE) DESC
                ) AS rn
            FROM trades t
            JOIN financials f
                ON f.ticker = t.symbol
                AND CAST(f.filing_date AS DATE) < CAST(t.entry_time AS DATE)
                AND f.timeframe = 'quarterly'
                AND f.revenues IS NOT NULL
        )
        SELECT
            trade_id,
            eps_diluted,
            CASE WHEN revenues > 0
                THEN operating_income / revenues * 100
                ELSE NULL
            END AS operating_margin,
            CASE WHEN revenues > 0
                THEN net_income / revenues * 100
                ELSE NULL
            END AS net_margin,
            revenues
        FROM ranked
        WHERE rn = 1
    """).fetchdf()
    df = df.merge(fin_df, on="trade_id", how="left")
    print(f"  Financials: {time.time()-t2:.1f}s")

    # Prior-day context
    print("  Loading prior-day context from daily bars...")
    t3 = time.time()

    prior_day = con.execute("""
        WITH daily_with_trade AS (
            SELECT
                t.trade_id,
                d.bar_date,
                d.open, d.high, d.low, d.close, d.volume,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id
                    ORDER BY d.bar_date DESC
                ) AS rn
            FROM trades t
            JOIN daily_bars d
                ON d.symbol = t.symbol
                AND d.bar_date < CAST(t.entry_time AS DATE)
                AND d.bar_date >= CAST(t.entry_time AS DATE) - 30
        ),
        features AS (
            SELECT
                trade_id,
                -- Prior day range %
                MAX(CASE WHEN rn = 1 THEN
                    CASE WHEN close > 0 THEN (high - low) / close * 100 END
                END) AS prior_day_range_pct,
                -- Volume ratio vs 20-day average
                MAX(CASE WHEN rn = 1 THEN volume END) /
                    NULLIF(AVG(CASE WHEN rn BETWEEN 2 AND 21 THEN volume END), 0)
                    AS volume_ratio,
                -- Prior day return
                MAX(CASE WHEN rn = 1 THEN
                    CASE WHEN open > 0 THEN (close - open) / open * 100 END
                END) AS prior_day_return_pct,
                -- Gap from prior day close to today's implied open
                MAX(CASE WHEN rn = 1 THEN close END) AS prior_close
            FROM daily_with_trade
            WHERE rn <= 21
            GROUP BY trade_id
        )
        SELECT * FROM features
    """).fetchdf()
    df = df.merge(prior_day, on="trade_id", how="left")

    # Compute gap %
    df["gap_pct"] = np.where(
        df["prior_close"].notna() & (df["prior_close"] > 0),
        (df["entry_price"] - df["prior_close"]) / df["prior_close"] * 100,
        np.nan
    )

    print(f"  Prior-day: {time.time()-t3:.1f}s")

    # Encode categoricals for tree model
    df["is_short"] = (df["direction"].str.lower() == "short").astype(int)
    df["log_market_cap"] = np.log10(df["market_cap"].clip(lower=1e6))

    # Vol regime as ordinal
    vol_map = {"low": 0, "normal": 1, "high": 2}
    df["vol_regime_ord"] = df["vol_regime"].map(vol_map)

    # Earnings proximity as continuous (days_to_earnings already computed)

    print(f"  Total: {len(df):,} trades ({time.time()-t0:.1f}s)")
    return df


def build_feature_matrix(df: pd.DataFrame) -> tuple:
    """Build feature matrix for gradient boosting."""
    feature_cols = [
        "log_market_cap",
        "opening_range_pct",
        "eps_diluted",
        "vol_regime_ord",
        "prior_day_range_pct",
        "days_to_earnings",
        "atr_pct",
        "operating_margin",
        "vwap_position_pct",
        "momentum_pct",
        "volume_ratio",
        "quarter",
        "vix",
        "yield_spread_10y2y",
        # Additional raw features not in linear model
        "is_short",
        "prior_day_return_pct",
        "gap_pct",
        "bars_before_entry",
        "hour",
        "dow",
        "net_margin",
    ]
    available = [c for c in feature_cols if c in df.columns]
    X = df[available].copy()
    y = df["win"].values
    pnl = df["holly_pnl"].values
    return X, y, pnl, available


def run_gradient_boosting(df: pd.DataFrame) -> dict:
    """Train HistGradientBoosting with walk-forward OOS validation."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.inspection import permutation_importance
    from sklearn.calibration import calibration_curve
    from sklearn.metrics import roc_auc_score, brier_score_loss

    X, y, pnl, feature_names = build_feature_matrix(df)

    # Sort by time for walk-forward
    sort_idx = df["entry_time"].argsort()
    X = X.iloc[sort_idx].reset_index(drop=True)
    y = y[sort_idx]
    pnl = pnl[sort_idx]
    df_sorted = df.iloc[sort_idx].reset_index(drop=True)

    split_idx = int(len(X) * 0.6)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]
    pnl_train, pnl_test = pnl[:split_idx], pnl[split_idx:]

    print(f"\nTrain: {len(X_train):,} | Test: {len(X_test):,}")
    print(f"Features: {len(feature_names)}")
    print(f"Train WR: {y_train.mean()*100:.1f}% | Test WR: {y_test.mean()*100:.1f}%")

    # Train model with regularization to prevent overfitting
    model = HistGradientBoostingClassifier(
        max_iter=300,
        max_depth=5,
        learning_rate=0.05,
        min_samples_leaf=50,
        max_leaf_nodes=31,
        l2_regularization=1.0,
        early_stopping=True,
        n_iter_no_change=20,
        validation_fraction=0.15,
        random_state=42,
    )

    print("Training HistGradientBoosting...")
    t0 = time.time()
    model.fit(X_train, y_train)
    train_time = time.time() - t0
    print(f"  Trained in {train_time:.1f}s, "
          f"n_iter={model.n_iter_}")

    # Predictions
    train_proba = model.predict_proba(X_train)[:, 1]
    test_proba = model.predict_proba(X_test)[:, 1]

    # Metrics
    train_auc = roc_auc_score(y_train, train_proba)
    test_auc = roc_auc_score(y_test, test_proba)
    train_brier = brier_score_loss(y_train, train_proba)
    test_brier = brier_score_loss(y_test, test_proba)

    print(f"  Train AUC: {train_auc:.4f} | Test AUC: {test_auc:.4f}")
    print(f"  Train Brier: {train_brier:.4f} | Test Brier: {test_brier:.4f}")

    # Feature importance (permutation-based on test set)
    print("  Computing permutation importance...")
    perm = permutation_importance(model, X_test, y_test,
                                   n_repeats=10, random_state=42, n_jobs=-1)
    importance = pd.DataFrame({
        "feature": feature_names,
        "importance_mean": perm.importances_mean,
        "importance_std": perm.importances_std,
    }).sort_values("importance_mean", ascending=False)

    # Decile analysis on TEST set
    test_df = pd.DataFrame({
        "proba": test_proba,
        "win": y_test,
        "pnl": pnl_test,
    })
    test_df["pct"] = test_df["proba"].rank(pct=True).mul(100)
    test_df["decile"] = pd.qcut(test_df["pct"], 10, labels=False,
                                  duplicates="drop") + 1

    # Calibration curve
    try:
        prob_true, prob_pred = calibration_curve(y_test, test_proba, n_bins=10)
        cal_data = list(zip(prob_pred, prob_true))
    except Exception:
        cal_data = []

    return {
        "model": model,
        "feature_names": feature_names,
        "importance": importance,
        "train_auc": train_auc,
        "test_auc": test_auc,
        "train_brier": train_brier,
        "test_brier": test_brier,
        "train_proba": train_proba,
        "test_proba": test_proba,
        "test_df": test_df,
        "pnl_test": pnl_test,
        "y_test": y_test,
        "train_time": train_time,
        "n_iter": model.n_iter_,
        "calibration": cal_data,
        "df_sorted": df_sorted,
        "split_idx": split_idx,
    }


def decile_report(test_df: pd.DataFrame) -> list:
    """Generate decile analysis for the OOS test set."""
    lines = []
    lines.append("| Decile | Prob Range | n | WR | Avg P&L | Cum P&L |")
    lines.append("|--------|-----------|---|----|---------|---------| ")

    cum_pnl = 0
    prev_pnl = None
    mono_count = 0
    for d in sorted(test_df["decile"].unique()):
        sub = test_df[test_df["decile"] == d]
        cum_pnl += sub["pnl"].sum()
        avg_pnl = sub["pnl"].mean()
        if prev_pnl is not None and avg_pnl > prev_pnl:
            mono_count += 1
        prev_pnl = avg_pnl
        lines.append(
            f"| D{d} | {sub['proba'].min():.2f}-{sub['proba'].max():.2f} "
            f"| {len(sub):,} | {sub['win'].mean()*100:.1f}% "
            f"| ${avg_pnl:.0f} "
            f"| ${cum_pnl:,.0f} |"
        )

    lines.append("")
    n_deciles = len(test_df["decile"].unique())
    lines.append(f"**Monotonicity:** {mono_count}/{n_deciles - 1} transitions increasing")
    lines.append("")

    # Cohen's d: top vs bottom
    top = test_df[test_df["decile"] == test_df["decile"].max()]
    bot = test_df[test_df["decile"] == test_df["decile"].min()]
    if len(top) >= 10 and len(bot) >= 10:
        test = welch_t_test(top["pnl"], bot["pnl"])
        lines.append(f"**Top (D10):** {len(top):,} trades, "
                     f"WR={top['win'].mean()*100:.1f}%, Avg=${top['pnl'].mean():.0f}")
        lines.append(f"**Bottom (D1):** {len(bot):,} trades, "
                     f"WR={bot['win'].mean()*100:.1f}%, Avg=${bot['pnl'].mean():.0f}")
        if not np.isnan(test["cohens_d"]):
            lines.append(f"**Cohen's d (OOS):** {test['cohens_d']:.3f}")
        if not np.isnan(test["p_value"]):
            lines.append(f"**p-value:** {test['p_value']:.4f}")
    lines.append("")
    return lines


def strategy_decile_report(df_sorted, test_proba, split_idx) -> list:
    """Strategy x model score interaction on test set."""
    lines = []
    test_data = df_sorted.iloc[split_idx:].copy()
    test_data["proba"] = test_proba
    test_data["pct"] = test_data["proba"].rank(pct=True).mul(100)

    top_strats = test_data["strategy"].value_counts().head(8).index.tolist()

    for strat in top_strats:
        sdf = test_data[test_data["strategy"] == strat].copy()
        direction = sdf["direction"].mode().iloc[0] if len(sdf) > 0 else "?"
        try:
            sdf["tercile"] = pd.qcut(sdf["pct"], 3,
                                      labels=["Bottom", "Middle", "Top"],
                                      duplicates="drop")
        except ValueError:
            continue

        lines.append(f"**{strat}** ({direction}, n={len(sdf):,})")
        lines.append("")
        lines.append("| Tercile | n | WR | Avg P&L |")
        lines.append("|---------|---|----|---------| ")
        for t in ["Bottom", "Middle", "Top"]:
            sub = sdf[sdf["tercile"] == t]
            if len(sub) >= 5:
                lines.append(
                    f"| {t} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                    f"| ${sub['holly_pnl'].mean():.0f} |"
                )
        lines.append("")
    return lines


def threshold_report(test_df: pd.DataFrame) -> list:
    """Actionable thresholds on OOS test set."""
    lines = []
    for threshold in [90, 80, 70, 60, 50]:
        above = test_df[test_df["pct"] >= threshold]
        if len(above) > 0:
            lines.append(
                f"- **Score >= {threshold}:** {len(above):,} trades "
                f"({len(above)/len(test_df)*100:.0f}%), "
                f"WR={above['win'].mean()*100:.1f}%, "
                f"Avg=${above['pnl'].mean():.0f}"
            )
    lines.append("")

    total_pnl = test_df["pnl"].sum()
    top_30 = test_df[test_df["pct"] >= 70]
    top_30_pnl = top_30["pnl"].sum()
    lines.append(f"**Total OOS P&L:** ${total_pnl:,.0f}")
    if total_pnl > 0:
        lines.append(f"**Top-30% OOS P&L (score>=70):** ${top_30_pnl:,.0f} "
                      f"({top_30_pnl/total_pnl*100:.0f}% from "
                      f"{len(top_30)/len(test_df)*100:.0f}% of trades)")
    lines.append("")
    return lines


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df = load_all_features(con)
    con.close()

    if len(df) == 0:
        print("No data!")
        sys.exit(1)

    results = run_gradient_boosting(df)

    # ── Build report ──
    report = []
    report.append("# Gradient Boosting Model (HistGBT)")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,}")
    report.append(f"Train: {results['split_idx']:,} | "
                  f"Test: {len(df) - results['split_idx']:,}")
    report.append(f"Features: {len(results['feature_names'])}")
    report.append("")

    # Model performance
    report.append("## 1. Model Performance")
    report.append("")
    report.append("| Metric | Train | Test (OOS) |")
    report.append("|--------|-------|------------|")
    report.append(f"| AUC-ROC | {results['train_auc']:.4f} | "
                  f"{results['test_auc']:.4f} |")
    report.append(f"| Brier Score | {results['train_brier']:.4f} | "
                  f"{results['test_brier']:.4f} |")
    report.append(f"| Iterations | {results['n_iter']} | — |")
    report.append(f"| Training Time | {results['train_time']:.1f}s | — |")
    report.append("")

    # Calibration
    if results["calibration"]:
        report.append("**Calibration (predicted vs actual):**")
        report.append("")
        report.append("| Predicted | Actual |")
        report.append("|-----------|--------|")
        for pred, actual in results["calibration"]:
            report.append(f"| {pred:.2f} | {actual:.2f} |")
        report.append("")

    # Feature importance
    report.append("## 2. Feature Importance (Permutation, OOS)")
    report.append("")
    report.append("| Rank | Feature | Importance | Std |")
    report.append("|------|---------|------------|-----|")
    for i, row in results["importance"].iterrows():
        rank = results["importance"].index.tolist().index(i) + 1
        report.append(f"| {rank} | {row['feature']} | "
                      f"{row['importance_mean']:.4f} | "
                      f"±{row['importance_std']:.4f} |")
    report.append("")

    # Section 3: OOS Decile analysis
    report.append("## 3. OOS Decile Analysis")
    report.append("")
    report.extend(decile_report(results["test_df"]))

    # Section 4: Strategy x Score
    report.append("## 4. Strategy x Model Score (OOS, top 8)")
    report.append("")
    report.extend(strategy_decile_report(
        results["df_sorted"],
        results["test_proba"],
        results["split_idx"]
    ))

    # Section 5: Actionable thresholds
    report.append("## 5. Actionable Thresholds (OOS)")
    report.append("")
    report.extend(threshold_report(results["test_df"]))

    # Section 6: Comparison to linear v3
    report.append("## 6. Comparison to Linear Composite V3")
    report.append("")
    report.append("| Metric | Linear V3 | GBT |")
    report.append("|--------|-----------|-----|")

    # Get GBT OOS Cohen's d
    top = results["test_df"][results["test_df"]["decile"] == results["test_df"]["decile"].max()]
    bot = results["test_df"][results["test_df"]["decile"] == results["test_df"]["decile"].min()]
    gbt_test = welch_t_test(top["pnl"], bot["pnl"])
    gbt_d = gbt_test["cohens_d"] if not np.isnan(gbt_test["cohens_d"]) else 0

    report.append(f"| OOS Cohen's d (D10 vs D1) | 0.592 | {gbt_d:.3f} |")
    report.append(f"| OOS D10 Win Rate | 83.6% | "
                  f"{top['win'].mean()*100:.1f}% |")
    report.append(f"| OOS D10 Avg P&L | $7,836 | "
                  f"${top['pnl'].mean():.0f} |")
    report.append(f"| OOS D1 Win Rate | 29.4% | "
                  f"{bot['win'].mean()*100:.1f}% |")
    report.append(f"| OOS D1 Avg P&L | $227 | "
                  f"${bot['pnl'].mean():.0f} |")
    report.append(f"| OOS AUC-ROC | — | {results['test_auc']:.4f} |")
    report.append(f"| Features | 14 (hand-weighted) | "
                  f"{len(results['feature_names'])} (learned) |")
    report.append("")

    if gbt_d > 0.60:
        report.append("**VERDICT: GBT beats linear composite — nonlinear interactions confirmed**")
    elif gbt_d > 0.55:
        report.append("**VERDICT: GBT comparable to linear — limited nonlinear interactions**")
    else:
        report.append("**VERDICT: GBT underperforms linear — overfitting or data limitations**")
    report.append("")

    # Write
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / "gradient-boosting-model.md"
    report_path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport saved: {report_path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
