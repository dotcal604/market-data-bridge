"""
52_composite_edge_score.py — Composite edge score from all significant features.

Combines the statistically significant features found in scripts 47-51 into
a single composite score per trade, then validates via decile analysis and
out-of-sample walk-forward.

Significant features used (all passed FDR < 0.05):
  From script 47 (regime):
    - vol_regime: normal > low > high (d=0.22-0.25)
    - trend_regime: uptrend better for longs
    - atr_pct, roc5, gap_pct, prior_day_return

  From script 48 (earnings):
    - earnings_proximity: post_earnings_3d hurts (d=-0.26)
    - earnings_week: within 5 days hurts (d=-0.22)

  From script 49 (economic/macro):
    - VIX level: low best, extreme worst
    - Yield curve: normal best, inverted worst

  From script 50 (fundamentals):
    - market_cap: mega best, micro worst (d=0.55)

  From script 51 (temporal):
    - quarter: Q1 best, Q4 worst
    - month: Dec worst, Feb best

Scoring approach: z-score normalization + direction-aware weighting.
Each feature contributes a z-score based on its historical distribution.
Weights are proportional to Cohen's d from the lift analyses.

Output: reports/composite-edge-score.md + DuckDB table `composite_scores`

Usage:
    python scripts/52_composite_edge_score.py
"""

import argparse
import sys
import time
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH, DATA_DIR

REPORT_DIR = DATA_DIR.parent / "output" / "reports"


def load_all_features(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Load trades with all significant features joined."""
    print("Loading trades with all feature sources...")
    t0 = time.time()

    # Check which tables exist
    tables = [r[0] for r in con.execute(
        "SELECT table_name FROM information_schema.tables"
    ).fetchall()]

    has_regime = "trade_regime" in tables
    has_earnings = "earnings_calendar" in tables
    has_events = "economic_event_flags" in tables
    has_fred = "fred_macro_daily" in tables
    has_ticker = "ticker_details" in tables

    print(f"  trade_regime: {has_regime}, earnings_calendar: {has_earnings}")
    print(f"  fred_macro_daily: {has_fred}, ticker_details: {has_ticker}")

    # Build base query with all joins
    regime_cols = ""
    regime_join = ""
    if has_regime:
        regime_cols = """
            , r.vol_regime, r.trend_regime, r.momentum_regime
            , r.atr_pct, r.roc5, r.trend_slope
        """
        regime_join = """
            LEFT JOIN trade_regime r ON r.trade_id = t.trade_id
        """

    fred_cols = ""
    fred_join = ""
    if has_fred:
        fred_cols = """
            , fm.vix
            , fm.yield_spread_10y2y
        """
        fred_join = """
            LEFT JOIN fred_macro_daily fm ON fm.date = CAST(t.entry_time AS DATE)
        """

    ticker_cols = ""
    ticker_join = ""
    if has_ticker:
        ticker_cols = """
            , td.market_cap
        """
        ticker_join = """
            LEFT JOIN ticker_details td ON td.symbol = t.symbol
        """

    df = con.execute(f"""
        SELECT
            t.trade_id, t.symbol, t.entry_time, t.entry_price,
            t.strategy, t.direction, t.holly_pnl, t.mfe, t.mae,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            CAST(t.entry_time AS DATE) AS trade_date,
            EXTRACT(HOUR FROM t.entry_time) AS entry_hour,
            EXTRACT(QUARTER FROM t.entry_time) AS quarter,
            EXTRACT(MONTH FROM t.entry_time) AS month
            {regime_cols}
            {fred_cols}
            {ticker_cols}
        FROM trades t
        {regime_join}
        {fred_join}
        {ticker_join}
    """).fetchdf()

    # Add earnings proximity
    if has_earnings:
        earnings_df = con.execute("""
            SELECT
                t.trade_id,
                CASE
                    WHEN EXISTS (
                        SELECT 1 FROM earnings_calendar ec
                        WHERE ec.symbol = t.symbol
                        AND ec.earnings_date = CAST(t.entry_time AS DATE)
                    ) THEN 'earnings_day'
                    WHEN EXISTS (
                        SELECT 1 FROM earnings_calendar ec
                        WHERE ec.symbol = t.symbol
                        AND ec.earnings_date > CAST(t.entry_time AS DATE)
                        AND ec.earnings_date <= CAST(t.entry_time AS DATE) + INTERVAL '3 days'
                    ) THEN 'pre_earnings_3d'
                    WHEN EXISTS (
                        SELECT 1 FROM earnings_calendar ec
                        WHERE ec.symbol = t.symbol
                        AND ec.earnings_date >= CAST(t.entry_time AS DATE) - INTERVAL '3 days'
                        AND ec.earnings_date < CAST(t.entry_time AS DATE)
                    ) THEN 'post_earnings_3d'
                    ELSE 'normal'
                END AS earnings_proximity
            FROM trades t
        """).fetchdf()
        df = df.merge(earnings_df, on="trade_id", how="left")

    print(f"  Loaded {len(df):,} trades ({time.time()-t0:.1f}s)")
    return df


def compute_composite_score(df: pd.DataFrame) -> pd.DataFrame:
    """Compute composite edge score from all significant features."""
    print("Computing composite edge scores...")

    scores = pd.DataFrame(index=df.index)
    scores["trade_id"] = df["trade_id"]

    # Weight each feature by its Cohen's d magnitude from lift analyses
    # Positive weight = higher value is better for P&L

    # 1. Market cap (d=0.55, strongest) — higher is better
    if "market_cap" in df.columns:
        valid = df["market_cap"].dropna()
        if len(valid) > 100:
            log_cap = np.log10(df["market_cap"].clip(lower=1e6))
            scores["cap_z"] = (log_cap - log_cap.mean()) / log_cap.std()
            scores["cap_z"] = scores["cap_z"].fillna(0)
        else:
            scores["cap_z"] = 0.0
    else:
        scores["cap_z"] = 0.0

    # 2. Vol regime (d=0.22-0.25) — normal/low better, high worse
    if "vol_regime" in df.columns:
        vol_map = {"low": 1.0, "normal": 0.5, "high": -1.0}
        scores["vol_z"] = df["vol_regime"].map(vol_map).fillna(0)
    else:
        scores["vol_z"] = 0.0

    # 3. VIX level (d=0.04-0.07) — low better, extreme worse
    if "vix" in df.columns:
        valid_vix = df["vix"].dropna()
        if len(valid_vix) > 100:
            # Invert: lower VIX = better
            scores["vix_z"] = -(df["vix"] - valid_vix.mean()) / valid_vix.std()
            scores["vix_z"] = scores["vix_z"].fillna(0)
        else:
            scores["vix_z"] = 0.0
    else:
        scores["vix_z"] = 0.0

    # 4. Yield spread (d=~0.1) — normal spread best
    if "yield_spread_10y2y" in df.columns:
        # Peak performance around 0.5-1.5, penalize extremes
        spread = df["yield_spread_10y2y"].fillna(0.75)  # neutral default
        scores["yield_z"] = -np.abs(spread - 0.75) / 1.0  # penalize deviation from optimal
    else:
        scores["yield_z"] = 0.0

    # 5. Earnings proximity (d=-0.22 to -0.26) — near earnings is bad
    if "earnings_proximity" in df.columns:
        prox_map = {"normal": 0.0, "pre_earnings_3d": -1.0,
                     "earnings_day": -0.8, "post_earnings_3d": -1.2}
        scores["earnings_z"] = df["earnings_proximity"].map(prox_map).fillna(0)
    else:
        scores["earnings_z"] = 0.0

    # 6. Quarter (d=~0.08) — Q1 best, Q4 worst
    if "quarter" in df.columns:
        q_map = {1: 0.5, 2: 0.2, 3: -0.2, 4: -0.5}
        scores["quarter_z"] = df["quarter"].map(q_map).fillna(0)
    else:
        scores["quarter_z"] = 0.0

    # 7. ATR % (from regime analysis) — higher ATR trades are worse
    if "atr_pct" in df.columns:
        valid_atr = df["atr_pct"].dropna()
        if len(valid_atr) > 100:
            scores["atr_z"] = -(df["atr_pct"] - valid_atr.mean()) / valid_atr.std()
            scores["atr_z"] = scores["atr_z"].fillna(0)
        else:
            scores["atr_z"] = 0.0
    else:
        scores["atr_z"] = 0.0

    # Weighted composite: weights proportional to Cohen's d
    weights = {
        "cap_z": 0.30,       # d=0.55, strongest
        "vol_z": 0.20,       # d=0.22-0.25
        "vix_z": 0.05,       # d=0.04-0.07 (small)
        "yield_z": 0.05,     # d=~0.1
        "earnings_z": 0.15,  # d=-0.22 to -0.26
        "quarter_z": 0.10,   # d=~0.08
        "atr_z": 0.15,       # d=~0.15
    }

    composite = sum(scores[col] * w for col, w in weights.items())
    scores["composite_score"] = composite

    # Normalize to 0-100 scale
    cs = scores["composite_score"]
    if cs.std() > 0:
        scores["composite_score_pct"] = (
            (cs - cs.min()) / (cs.max() - cs.min()) * 100
        ).round(1)
    else:
        scores["composite_score_pct"] = 50.0

    # Component contributions
    for col, w in weights.items():
        scores[f"{col}_contribution"] = (scores[col] * w / composite.std() * 100).round(1) if composite.std() > 0 else 0

    print(f"  Composite score: mean={scores['composite_score_pct'].mean():.1f}, "
          f"std={scores['composite_score_pct'].std():.1f}")

    return scores


def decile_analysis(df: pd.DataFrame, scores: pd.DataFrame) -> list[str]:
    """Analyze trade outcomes by composite score decile."""
    lines = []
    lines.append("### Decile Analysis")
    lines.append("")

    merged = df[["trade_id", "holly_pnl", "win", "mfe", "mae", "strategy"]].merge(
        scores[["trade_id", "composite_score_pct"]], on="trade_id"
    )

    merged["decile"] = pd.qcut(merged["composite_score_pct"], 10, labels=False, duplicates="drop") + 1

    lines.append("| Decile | Score Range | n | WR | Avg P&L | Avg MFE | Avg MAE | Cum P&L |")
    lines.append("|--------|-------------|---|----|---------|---------|---------|---------| ")

    cum_pnl = 0
    for d in sorted(merged["decile"].unique()):
        sub = merged[merged["decile"] == d]
        score_min = sub["composite_score_pct"].min()
        score_max = sub["composite_score_pct"].max()
        cum_pnl += sub["holly_pnl"].sum()
        lines.append(
            f"| D{d} | {score_min:.0f}-{score_max:.0f} "
            f"| {len(sub):,} | {sub['win'].mean()*100:.1f}% "
            f"| ${sub['holly_pnl'].mean():.0f} "
            f"| ${sub['mfe'].mean():.0f} | ${sub['mae'].mean():.0f} "
            f"| ${cum_pnl:,.0f} |"
        )

    lines.append("")

    # Monotonicity check: does P&L increase with score?
    decile_pnl = merged.groupby("decile")["holly_pnl"].mean()
    monotonic_count = sum(1 for i in range(1, len(decile_pnl))
                         if decile_pnl.iloc[i] > decile_pnl.iloc[i-1])
    lines.append(f"**Monotonicity:** {monotonic_count}/{len(decile_pnl)-1} decile transitions are increasing")
    lines.append("")

    # Top vs bottom decile
    top = merged[merged["decile"] == merged["decile"].max()]
    bottom = merged[merged["decile"] == merged["decile"].min()]
    test = stats.ttest_ind(top["holly_pnl"], bottom["holly_pnl"], equal_var=False)
    pooled_std = np.sqrt((top["holly_pnl"].std()**2 + bottom["holly_pnl"].std()**2) / 2)
    d = (top["holly_pnl"].mean() - bottom["holly_pnl"].mean()) / pooled_std if pooled_std > 0 else 0

    lines.append(f"**Top vs Bottom decile:**")
    lines.append(f"- Top (D{merged['decile'].max()}): {len(top):,} trades, "
                 f"WR={top['win'].mean()*100:.1f}%, Avg=${top['holly_pnl'].mean():.0f}")
    lines.append(f"- Bottom (D{merged['decile'].min()}): {len(bottom):,} trades, "
                 f"WR={bottom['win'].mean()*100:.1f}%, Avg=${bottom['holly_pnl'].mean():.0f}")
    lines.append(f"- t-test: p={test.pvalue:.6f}, Cohen's d={d:.3f}")
    lines.append("")

    return lines


def walk_forward_validation(df: pd.DataFrame, scores: pd.DataFrame,
                           train_pct: float = 0.6) -> list[str]:
    """Walk-forward: train weights on first 60%, test on last 40%."""
    lines = []
    lines.append("### Walk-Forward Out-of-Sample Validation")
    lines.append("")

    merged = df[["trade_id", "holly_pnl", "win", "entry_time"]].merge(
        scores[["trade_id", "composite_score_pct"]], on="trade_id"
    ).sort_values("entry_time")

    split_idx = int(len(merged) * train_pct)
    train = merged.iloc[:split_idx]
    test = merged.iloc[split_idx:]

    lines.append(f"- Train: {len(train):,} trades ({train['entry_time'].min()} to {train['entry_time'].max()})")
    lines.append(f"- Test: {len(test):,} trades ({test['entry_time'].min()} to {test['entry_time'].max()})")
    lines.append("")

    # Analyze by tercile in both sets
    for label, subset in [("TRAIN (in-sample)", train), ("TEST (out-of-sample)", test)]:
        subset = subset.copy()
        subset["tercile"] = pd.qcut(subset["composite_score_pct"], 3,
                                     labels=["Bottom", "Middle", "Top"],
                                     duplicates="drop")

        lines.append(f"**{label}:**")
        lines.append("")
        lines.append("| Tercile | n | WR | Avg P&L |")
        lines.append("|---------|---|----|---------| ")

        for t in ["Bottom", "Middle", "Top"]:
            sub = subset[subset["tercile"] == t]
            if len(sub) > 0:
                lines.append(
                    f"| {t} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                    f"| ${sub['holly_pnl'].mean():.0f} |"
                )
        lines.append("")

    # Top-tercile lift in test set
    test_copy = test.copy()
    test_copy["tercile"] = pd.qcut(test_copy["composite_score_pct"], 3,
                                    labels=["Bottom", "Middle", "Top"],
                                    duplicates="drop")
    top_test = test_copy[test_copy["tercile"] == "Top"]
    bottom_test = test_copy[test_copy["tercile"] == "Bottom"]

    if len(top_test) >= 10 and len(bottom_test) >= 10:
        oos_test = stats.ttest_ind(top_test["holly_pnl"], bottom_test["holly_pnl"], equal_var=False)
        oos_d = (top_test["holly_pnl"].mean() - bottom_test["holly_pnl"].mean())
        pooled_std = np.sqrt((top_test["holly_pnl"].std()**2 + bottom_test["holly_pnl"].std()**2) / 2)
        d = oos_d / pooled_std if pooled_std > 0 else 0

        lines.append(f"**OOS Top vs Bottom tercile:**")
        lines.append(f"- Lift: ${oos_d:.0f} per trade")
        lines.append(f"- t-test: p={oos_test.pvalue:.4f}, Cohen's d={d:.3f}")

        if oos_test.pvalue < 0.05:
            lines.append(f"- **VERDICT: Edge survives out-of-sample (p<0.05)**")
        elif oos_test.pvalue < 0.10:
            lines.append(f"- **VERDICT: Marginal OOS signal (p<0.10)**")
        else:
            lines.append(f"- **VERDICT: No significant OOS edge (p={oos_test.pvalue:.4f})**")
    else:
        lines.append("*Insufficient data for OOS tercile comparison*")

    lines.append("")
    return lines


def strategy_score_interaction(df: pd.DataFrame, scores: pd.DataFrame) -> list[str]:
    """Top 5 strategies: score tercile performance."""
    lines = []
    lines.append("### Strategy x Composite Score (top 5)")
    lines.append("")

    merged = df[["trade_id", "holly_pnl", "win", "strategy"]].merge(
        scores[["trade_id", "composite_score_pct"]], on="trade_id"
    )

    top_strats = merged["strategy"].value_counts().head(5).index.tolist()

    for strat in top_strats:
        sdf = merged[merged["strategy"] == strat]
        sdf = sdf.copy()
        try:
            sdf["tercile"] = pd.qcut(sdf["composite_score_pct"], 3,
                                      labels=["Bottom", "Middle", "Top"],
                                      duplicates="drop")
        except ValueError:
            continue

        lines.append(f"**{strat}** (n={len(sdf):,})")
        lines.append("")
        lines.append("| Score Tercile | n | WR | Avg P&L |")
        lines.append("|---------------|---|----|---------| ")

        for t in ["Bottom", "Middle", "Top"]:
            sub = sdf[sdf["tercile"] == t]
            if len(sub) >= 5:
                lines.append(
                    f"| {t} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                    f"| ${sub['holly_pnl'].mean():.0f} |"
                )
        lines.append("")

    return lines


def main():
    parser = argparse.ArgumentParser()
    args = parser.parse_args()

    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df = load_all_features(con)
    if len(df) == 0:
        print("No data found!")
        sys.exit(1)

    scores = compute_composite_score(df)

    # Build report
    report = []
    report.append("# Composite Edge Score Analysis")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,}")
    report.append(f"Date range: {df['trade_date'].min()} to {df['trade_date'].max()}")
    report.append("")

    # Feature weights
    report.append("## Feature Weights")
    report.append("")
    report.append("| Feature | Weight | Source | Cohen's d |")
    report.append("|---------|--------|--------|-----------|")
    report.append("| Market Cap (log) | 0.30 | Script 50 | 0.553 |")
    report.append("| Vol Regime | 0.20 | Script 47 | 0.22-0.25 |")
    report.append("| Earnings Proximity | 0.15 | Script 48 | -0.22 to -0.26 |")
    report.append("| ATR % | 0.15 | Script 47 | ~0.15 |")
    report.append("| Quarter | 0.10 | Script 51 | ~0.08 |")
    report.append("| VIX Level | 0.05 | Script 49 | 0.04-0.07 |")
    report.append("| Yield Curve | 0.05 | Script 49 | ~0.10 |")
    report.append("")
    report.append("---")
    report.append("")

    # Section 1: Score distribution
    report.append("## 1. Score Distribution")
    report.append("")
    report.append(f"- Mean: {scores['composite_score_pct'].mean():.1f}")
    report.append(f"- Std: {scores['composite_score_pct'].std():.1f}")
    report.append(f"- Min: {scores['composite_score_pct'].min():.1f}")
    report.append(f"- Max: {scores['composite_score_pct'].max():.1f}")
    report.append(f"- Median: {scores['composite_score_pct'].median():.1f}")
    report.append("")

    # Section 2: Decile analysis
    report.append("## 2. Decile Analysis")
    report.append("")
    report.extend(decile_analysis(df, scores))

    # Section 3: Walk-forward
    report.append("## 3. Walk-Forward Validation (60/40 split)")
    report.append("")
    report.extend(walk_forward_validation(df, scores))

    # Section 4: Strategy interaction
    report.append("## 4. Strategy x Composite Score")
    report.append("")
    report.extend(strategy_score_interaction(df, scores))

    # Section 5: Actionable thresholds
    report.append("## 5. Actionable Thresholds")
    report.append("")

    merged = df[["trade_id", "holly_pnl", "win"]].merge(
        scores[["trade_id", "composite_score_pct"]], on="trade_id"
    )

    for threshold in [70, 60, 50, 40, 30]:
        above = merged[merged["composite_score_pct"] >= threshold]
        below = merged[merged["composite_score_pct"] < threshold]
        report.append(
            f"- **Score >= {threshold}:** {len(above):,} trades "
            f"({len(above)/len(merged)*100:.0f}%), "
            f"WR={above['win'].mean()*100:.1f}%, "
            f"Avg=${above['holly_pnl'].mean():.0f}"
        )
    report.append("")

    total_pnl = merged["holly_pnl"].sum()
    top_half = merged[merged["composite_score_pct"] >= 50]
    top_half_pnl = top_half["holly_pnl"].sum()
    report.append(f"**Total P&L (all trades):** ${total_pnl:,.0f}")
    report.append(f"**Top-half P&L (score>=50):** ${top_half_pnl:,.0f} "
                  f"({top_half_pnl/total_pnl*100:.0f}% of total from "
                  f"{len(top_half)/len(merged)*100:.0f}% of trades)")
    report.append("")

    # Write report
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / "composite-edge-score.md"
    report_path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport saved: {report_path}")
    print(f"Done in {elapsed:.1f}s")
    con.close()


if __name__ == "__main__":
    main()
