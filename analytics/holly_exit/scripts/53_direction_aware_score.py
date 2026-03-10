"""
53_direction_aware_score.py — Direction-aware composite edge score.

Script 52 revealed that short strategies (Breakdown Short, Downward Dog) have
INVERTED composite score — they perform better with LOW market cap, which the
naive composite penalizes. This script fixes that by flipping direction-sensitive
features for short trades.

Direction-sensitive features (flip for shorts):
  - market_cap: large cap = better for longs, worse for shorts
  - vol_regime: normal vol = better for longs, high vol = better for shorts

Direction-neutral features (same for both):
  - earnings_proximity, quarter, VIX, yield_curve, ATR

Output: reports/direction-aware-score.md

Usage:
    python scripts/53_direction_aware_score.py
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


def welch_t_test(a: pd.Series, b: pd.Series) -> dict:
    a, b = a.dropna(), b.dropna()
    if len(a) < 10 or len(b) < 10:
        return {"t_stat": np.nan, "p_value": np.nan, "cohens_d": np.nan,
                "n_a": len(a), "n_b": len(b)}
    t_stat, p_value = stats.ttest_ind(a, b, equal_var=False)
    pooled_std = np.sqrt((a.std()**2 + b.std()**2) / 2)
    cohens_d = (a.mean() - b.mean()) / pooled_std if pooled_std > 0 else 0
    return {"t_stat": t_stat, "p_value": p_value, "cohens_d": cohens_d,
            "n_a": len(a), "n_b": len(b), "mean_a": a.mean(), "mean_b": b.mean()}


def load_all_features(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Load trades with all significant features joined."""
    print("Loading trades with all feature sources...")
    t0 = time.time()

    tables = [r[0] for r in con.execute(
        "SELECT table_name FROM information_schema.tables"
    ).fetchall()]

    has_regime = "trade_regime" in tables
    has_earnings = "earnings_calendar" in tables
    has_fred = "fred_macro_daily" in tables
    has_ticker = "ticker_details" in tables

    regime_cols = ""
    regime_join = ""
    if has_regime:
        regime_cols = ", r.vol_regime, r.trend_regime, r.atr_pct, r.roc5, r.trend_slope"
        regime_join = "LEFT JOIN trade_regime r ON r.trade_id = t.trade_id"

    fred_cols = ""
    fred_join = ""
    if has_fred:
        fred_cols = ", fm.vix, fm.yield_spread_10y2y"
        fred_join = "LEFT JOIN fred_macro_daily fm ON fm.date = CAST(t.entry_time AS DATE)"

    ticker_cols = ""
    ticker_join = ""
    if has_ticker:
        ticker_cols = ", td.market_cap"
        ticker_join = "LEFT JOIN ticker_details td ON td.symbol = t.symbol"

    df = con.execute(f"""
        SELECT
            t.trade_id, t.symbol, t.entry_time, t.entry_price,
            t.strategy, t.direction, t.holly_pnl, t.mfe, t.mae,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            CAST(t.entry_time AS DATE) AS trade_date,
            EXTRACT(QUARTER FROM t.entry_time) AS quarter
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


def compute_direction_aware_score(df: pd.DataFrame) -> pd.DataFrame:
    """Compute direction-aware composite edge score."""
    print("Computing direction-aware composite scores...")

    scores = pd.DataFrame(index=df.index)
    scores["trade_id"] = df["trade_id"]
    scores["direction"] = df["direction"]

    is_short = df["direction"].str.lower() == "short"

    # 1. Market cap — FLIP for shorts (d=0.55)
    if "market_cap" in df.columns:
        valid = df["market_cap"].dropna()
        if len(valid) > 100:
            log_cap = np.log10(df["market_cap"].clip(lower=1e6))
            cap_z = (log_cap - log_cap.mean()) / log_cap.std()
            cap_z = cap_z.fillna(0)
            # Flip for shorts: small cap = good for shorts
            scores["cap_z"] = np.where(is_short, -cap_z, cap_z)
        else:
            scores["cap_z"] = 0.0
    else:
        scores["cap_z"] = 0.0

    # 2. Vol regime — FLIP for shorts (d=0.22)
    if "vol_regime" in df.columns:
        # For longs: normal > low > high
        # For shorts: high > normal > low (shorts benefit from volatility)
        long_map = {"low": 0.5, "normal": 1.0, "high": -1.0}
        short_map = {"low": -0.5, "normal": 0.0, "high": 1.0}

        vol_long = df["vol_regime"].map(long_map).fillna(0)
        vol_short = df["vol_regime"].map(short_map).fillna(0)
        scores["vol_z"] = np.where(is_short, vol_short, vol_long)
    else:
        scores["vol_z"] = 0.0

    # 3. VIX — direction-neutral (d=0.04-0.07)
    if "vix" in df.columns:
        valid_vix = df["vix"].dropna()
        if len(valid_vix) > 100:
            scores["vix_z"] = -(df["vix"] - valid_vix.mean()) / valid_vix.std()
            scores["vix_z"] = scores["vix_z"].fillna(0)
        else:
            scores["vix_z"] = 0.0
    else:
        scores["vix_z"] = 0.0

    # 4. Yield spread — direction-neutral
    if "yield_spread_10y2y" in df.columns:
        spread = df["yield_spread_10y2y"].fillna(0.75)
        scores["yield_z"] = -np.abs(spread - 0.75)
    else:
        scores["yield_z"] = 0.0

    # 5. Earnings proximity — direction-neutral (d=-0.22)
    if "earnings_proximity" in df.columns:
        prox_map = {"normal": 0.0, "pre_earnings_3d": -1.0,
                     "earnings_day": -0.8, "post_earnings_3d": -1.2}
        scores["earnings_z"] = df["earnings_proximity"].map(prox_map).fillna(0)
    else:
        scores["earnings_z"] = 0.0

    # 6. Quarter — direction-neutral
    if "quarter" in df.columns:
        q_map = {1: 0.5, 2: 0.2, 3: -0.2, 4: -0.5}
        scores["quarter_z"] = df["quarter"].map(q_map).fillna(0)
    else:
        scores["quarter_z"] = 0.0

    # 7. ATR % — direction-neutral
    if "atr_pct" in df.columns:
        valid_atr = df["atr_pct"].dropna()
        if len(valid_atr) > 100:
            scores["atr_z"] = -(df["atr_pct"] - valid_atr.mean()) / valid_atr.std()
            scores["atr_z"] = scores["atr_z"].fillna(0)
        else:
            scores["atr_z"] = 0.0
    else:
        scores["atr_z"] = 0.0

    # Weighted composite
    weights = {
        "cap_z": 0.30,
        "vol_z": 0.20,
        "earnings_z": 0.15,
        "atr_z": 0.15,
        "quarter_z": 0.10,
        "vix_z": 0.05,
        "yield_z": 0.05,
    }

    composite = sum(scores[col] * w for col, w in weights.items())
    scores["composite_score"] = composite

    # Normalize to 0-100
    cs = scores["composite_score"]
    if cs.std() > 0:
        # Use percentile rank for better spread
        scores["composite_pct"] = cs.rank(pct=True).mul(100).round(1)
    else:
        scores["composite_pct"] = 50.0

    print(f"  Score: mean={scores['composite_pct'].mean():.1f}, "
          f"std={scores['composite_pct'].std():.1f}")

    return scores


def decile_analysis(df: pd.DataFrame, scores: pd.DataFrame) -> list[str]:
    lines = []
    merged = df[["trade_id", "holly_pnl", "win", "mfe", "mae", "direction", "strategy"]].merge(
        scores[["trade_id", "composite_pct"]], on="trade_id"
    )

    merged["decile"] = pd.qcut(merged["composite_pct"], 10, labels=False, duplicates="drop") + 1

    lines.append("| Decile | Score Range | n | WR | Avg P&L | Avg MFE | Cum P&L |")
    lines.append("|--------|-------------|---|----|---------|---------|---------| ")

    cum_pnl = 0
    for d in sorted(merged["decile"].unique()):
        sub = merged[merged["decile"] == d]
        score_min = sub["composite_pct"].min()
        score_max = sub["composite_pct"].max()
        cum_pnl += sub["holly_pnl"].sum()
        lines.append(
            f"| D{d} | {score_min:.0f}-{score_max:.0f} "
            f"| {len(sub):,} | {sub['win'].mean()*100:.1f}% "
            f"| ${sub['holly_pnl'].mean():.0f} "
            f"| ${sub['mfe'].mean():.0f} "
            f"| ${cum_pnl:,.0f} |"
        )

    lines.append("")

    decile_pnl = merged.groupby("decile")["holly_pnl"].mean()
    monotonic = sum(1 for i in range(1, len(decile_pnl))
                    if decile_pnl.iloc[i] > decile_pnl.iloc[i-1])
    lines.append(f"**Monotonicity:** {monotonic}/{len(decile_pnl)-1} transitions increasing")
    lines.append("")

    # Top vs bottom
    top = merged[merged["decile"] == merged["decile"].max()]
    bottom = merged[merged["decile"] == merged["decile"].min()]
    if len(top) >= 10 and len(bottom) >= 10:
        test = welch_t_test(top["holly_pnl"], bottom["holly_pnl"])
        lines.append(f"**Top (D{merged['decile'].max()}):** {len(top):,} trades, "
                     f"WR={top['win'].mean()*100:.1f}%, Avg=${top['holly_pnl'].mean():.0f}")
        lines.append(f"**Bottom (D{merged['decile'].min()}):** {len(bottom):,} trades, "
                     f"WR={bottom['win'].mean()*100:.1f}%, Avg=${bottom['holly_pnl'].mean():.0f}")
        if not np.isnan(test["cohens_d"]):
            lines.append(f"**Cohen's d:** {test['cohens_d']:.3f}")
    lines.append("")

    return lines


def direction_split_analysis(df: pd.DataFrame, scores: pd.DataFrame) -> list[str]:
    """Analyze score effectiveness split by direction."""
    lines = []

    merged = df[["trade_id", "holly_pnl", "win", "direction", "strategy"]].merge(
        scores[["trade_id", "composite_pct"]], on="trade_id"
    )

    for direction in ["Long", "Short"]:
        ddf = merged[merged["direction"] == direction]
        if len(ddf) < 100:
            continue

        lines.append(f"**{direction.upper()} trades** (n={len(ddf):,})")
        lines.append("")

        ddf = ddf.copy()
        try:
            ddf["tercile"] = pd.qcut(ddf["composite_pct"], 3,
                                      labels=["Bottom", "Middle", "Top"],
                                      duplicates="drop")
        except ValueError:
            continue

        lines.append("| Tercile | n | WR | Avg P&L |")
        lines.append("|---------|---|----|---------| ")

        for t in ["Bottom", "Middle", "Top"]:
            sub = ddf[ddf["tercile"] == t]
            if len(sub) > 0:
                lines.append(
                    f"| {t} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                    f"| ${sub['holly_pnl'].mean():.0f} |"
                )
        lines.append("")

    return lines


def strategy_analysis(df: pd.DataFrame, scores: pd.DataFrame) -> list[str]:
    lines = []

    merged = df[["trade_id", "holly_pnl", "win", "strategy", "direction"]].merge(
        scores[["trade_id", "composite_pct"]], on="trade_id"
    )

    top_strats = merged["strategy"].value_counts().head(8).index.tolist()

    for strat in top_strats:
        sdf = merged[merged["strategy"] == strat]
        direction = sdf["direction"].mode().iloc[0] if len(sdf) > 0 else "?"
        sdf = sdf.copy()
        try:
            sdf["tercile"] = pd.qcut(sdf["composite_pct"], 3,
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


def walk_forward(df: pd.DataFrame, scores: pd.DataFrame) -> list[str]:
    lines = []

    merged = df[["trade_id", "holly_pnl", "win", "entry_time"]].merge(
        scores[["trade_id", "composite_pct"]], on="trade_id"
    ).sort_values("entry_time")

    split_idx = int(len(merged) * 0.6)
    train = merged.iloc[:split_idx]
    test = merged.iloc[split_idx:]

    lines.append(f"Train: {len(train):,} trades | Test: {len(test):,} trades")
    lines.append("")

    for label, subset in [("TRAIN", train), ("TEST (OOS)", test)]:
        subset = subset.copy()
        try:
            subset["tercile"] = pd.qcut(subset["composite_pct"], 3,
                                         labels=["Bottom", "Middle", "Top"],
                                         duplicates="drop")
        except ValueError:
            continue

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

    # OOS lift
    test_copy = test.copy()
    try:
        test_copy["tercile"] = pd.qcut(test_copy["composite_pct"], 3,
                                        labels=["Bottom", "Middle", "Top"],
                                        duplicates="drop")
    except ValueError:
        return lines

    top = test_copy[test_copy["tercile"] == "Top"]
    bot = test_copy[test_copy["tercile"] == "Bottom"]
    if len(top) >= 10 and len(bot) >= 10:
        test_result = welch_t_test(top["holly_pnl"], bot["holly_pnl"])
        lines.append(f"**OOS Lift:** ${top['holly_pnl'].mean() - bot['holly_pnl'].mean():.0f}/trade")
        if not np.isnan(test_result["cohens_d"]):
            lines.append(f"**Cohen's d:** {test_result['cohens_d']:.3f}")
        if not np.isnan(test_result["p_value"]):
            lines.append(f"**p-value:** {test_result['p_value']:.4f}")
            if test_result["p_value"] < 0.05:
                lines.append("**VERDICT: Edge confirmed out-of-sample**")
            elif test_result["p_value"] < 0.10:
                lines.append("**VERDICT: Marginal OOS signal**")
            else:
                lines.append("**VERDICT: No significant OOS edge**")
    lines.append("")
    return lines


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df = load_all_features(con)
    if len(df) == 0:
        print("No data!")
        sys.exit(1)

    scores = compute_direction_aware_score(df)

    report = []
    report.append("# Direction-Aware Composite Edge Score")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,}")
    report.append(f"Longs: {(df['direction'].str.lower()=='long').sum():,} | "
                  f"Shorts: {(df['direction'].str.lower()=='short').sum():,}")
    report.append("")
    report.append("**Key improvement over script 52:** Market cap and vol regime")
    report.append("features are FLIPPED for short trades. Short strategies")
    report.append("(Breakdown Short, Downward Dog) benefit from small caps and")
    report.append("high volatility — the opposite of long strategies.")
    report.append("")
    report.append("**Score uses percentile rank** (0-100) for better spread.")
    report.append("")
    report.append("---")
    report.append("")

    # Section 1: Overall decile
    report.append("## 1. Overall Decile Analysis")
    report.append("")
    report.extend(decile_analysis(df, scores))

    # Section 2: Direction split
    report.append("## 2. Long vs Short Effectiveness")
    report.append("")
    report.extend(direction_split_analysis(df, scores))

    # Section 3: Strategy
    report.append("## 3. Strategy x Score (top 8)")
    report.append("")
    report.extend(strategy_analysis(df, scores))

    # Section 4: Walk-forward
    report.append("## 4. Walk-Forward Validation")
    report.append("")
    report.extend(walk_forward(df, scores))

    # Section 5: Actionable thresholds
    report.append("## 5. Actionable Thresholds")
    report.append("")

    merged = df[["trade_id", "holly_pnl", "win"]].merge(
        scores[["trade_id", "composite_pct"]], on="trade_id"
    )

    for threshold in [80, 70, 60, 50, 40, 30, 20]:
        above = merged[merged["composite_pct"] >= threshold]
        if len(above) > 0:
            report.append(
                f"- **Score >= {threshold}:** {len(above):,} trades "
                f"({len(above)/len(merged)*100:.0f}%), "
                f"WR={above['win'].mean()*100:.1f}%, "
                f"Avg=${above['holly_pnl'].mean():.0f}"
            )
    report.append("")

    total_pnl = merged["holly_pnl"].sum()
    top_30 = merged[merged["composite_pct"] >= 70]
    top_30_pnl = top_30["holly_pnl"].sum()
    report.append(f"**Total P&L:** ${total_pnl:,.0f}")
    if total_pnl > 0:
        report.append(f"**Top-30% P&L (score>=70):** ${top_30_pnl:,.0f} "
                      f"({top_30_pnl/total_pnl*100:.0f}% from "
                      f"{len(top_30)/len(merged)*100:.0f}% of trades)")
    report.append("")

    # Write
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / "direction-aware-score.md"
    report_path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport saved: {report_path}")
    print(f"Done in {elapsed:.1f}s")
    con.close()


if __name__ == "__main__":
    main()
