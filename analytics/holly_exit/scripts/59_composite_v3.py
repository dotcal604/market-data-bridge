"""
59_composite_v3.py — Composite Edge Score v3 with fundamentals + prior-day context.

Builds on v2 (10 features) by adding the 4 strongest new features from
scripts 56-58:
  - EPS diluted (d=0.233) — profitability signal
  - Prior day range % (d=-0.190) — tight setups outperform
  - Operating margin (d=0.161) — profitability quality
  - Prior day volume ratio (d=-0.075) — normal volume outperforms

Updated weights (14 features):
  - Market cap (log): 0.20 (was 0.25)
  - Opening range %: 0.13 (was 0.15)
  - EPS diluted: 0.10 (NEW — d=0.233)
  - Vol regime: 0.10 (was 0.15)
  - Prior day range %: 0.08 (NEW — d=-0.190)
  - Earnings proximity: 0.08 (was 0.10)
  - ATR %: 0.07 (was 0.10)
  - Operating margin: 0.06 (NEW — d=0.161)
  - VWAP position: 0.05 (was 0.08)
  - Pre-entry momentum: 0.04 (was 0.07)
  - Prior day volume ratio: 0.03 (NEW — d=-0.075)
  - Quarter: 0.03 (was 0.05)
  - VIX: 0.02 (was 0.03)
  - Yield curve: 0.01 (was 0.02)

Output: reports/composite-v3.md

Usage:
    python scripts/59_composite_v3.py
"""

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
            "n_a": len(a), "n_b": len(b)}


def load_all_features(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Load trades with ALL feature sources: regime, intraday, fundamentals, prior-day."""
    print("Loading trades with all features...")
    t0 = time.time()

    # Base query with regime, fred, ticker joins
    df = con.execute("""
        SELECT
            t.trade_id, t.symbol, t.entry_time, t.entry_price,
            t.strategy, t.direction, t.holly_pnl, t.mfe, t.mae,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            CAST(t.entry_time AS DATE) AS trade_date,
            EXTRACT(QUARTER FROM t.entry_time) AS quarter,
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
            END AS momentum_pct
        FROM trades t
        LEFT JOIN pre_entry_stats ps ON ps.trade_id = t.trade_id
        LEFT JOIN opening_range orng ON orng.symbol = t.symbol
            AND orng.trade_date = CAST(t.entry_time AS DATE)
        LEFT JOIN momentum m ON m.trade_id = t.trade_id
    """).fetchdf()

    df = df.merge(intraday_df, on="trade_id", how="left")
    print(f"  Intraday features: {time.time()-t1:.1f}s")

    # ── NEW v3: Financial fundamentals (script 57) ──
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
            END AS operating_margin
        FROM ranked
        WHERE rn = 1
    """).fetchdf()
    df = df.merge(fin_df, on="trade_id", how="left")
    print(f"  Financials: {time.time()-t2:.1f}s, "
          f"EPS coverage={df['eps_diluted'].notna().sum():,}, "
          f"OpMargin={df['operating_margin'].notna().sum():,}")

    # ── NEW v3: Prior-day context from daily bars (script 56) ──
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
                AND d.bar_date >= CAST(t.entry_time AS DATE) - 25
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
                    AS volume_ratio
            FROM daily_with_trade
            WHERE rn <= 21
            GROUP BY trade_id
        )
        SELECT * FROM features
    """).fetchdf()
    df = df.merge(prior_day, on="trade_id", how="left")
    print(f"  Prior-day: {time.time()-t3:.1f}s, "
          f"range coverage={df['prior_day_range_pct'].notna().sum():,}, "
          f"vol_ratio={df['volume_ratio'].notna().sum():,}")

    print(f"  Total: {len(df):,} trades ({time.time()-t0:.1f}s)")
    return df


def compute_composite_v3(df: pd.DataFrame) -> pd.DataFrame:
    """Compute composite v3 score with 14 features."""
    print("Computing composite v3 scores...")

    scores = pd.DataFrame(index=df.index)
    scores["trade_id"] = df["trade_id"]

    is_short = df["direction"].str.lower() == "short"

    # 1. Market cap — FLIP for shorts (d=0.55)
    if "market_cap" in df.columns:
        log_cap = np.log10(df["market_cap"].clip(lower=1e6))
        cap_z = (log_cap - log_cap.mean()) / log_cap.std()
        cap_z = cap_z.fillna(0)
        scores["cap_z"] = np.where(is_short, -cap_z, cap_z)
    else:
        scores["cap_z"] = 0.0

    # 2. Opening range — direction-neutral (d=-0.284)
    if "opening_range_pct" in df.columns:
        valid = df["opening_range_pct"].dropna()
        if len(valid) > 100:
            scores["or_z"] = -(df["opening_range_pct"] - valid.mean()) / valid.std()
            scores["or_z"] = scores["or_z"].fillna(0)
        else:
            scores["or_z"] = 0.0
    else:
        scores["or_z"] = 0.0

    # 3. EPS diluted — NEW v3 (d=0.233)
    if "eps_diluted" in df.columns:
        valid = df["eps_diluted"].dropna()
        if len(valid) > 100:
            # Higher EPS = better, but flip for shorts (small cap shorts work better)
            eps_z = (df["eps_diluted"] - valid.median()) / valid.std()
            eps_z = eps_z.clip(-3, 3).fillna(0)
            scores["eps_z"] = np.where(is_short, -eps_z, eps_z)
        else:
            scores["eps_z"] = 0.0
    else:
        scores["eps_z"] = 0.0

    # 4. Vol regime — FLIP for shorts (d=0.22)
    if "vol_regime" in df.columns:
        long_map = {"low": 0.5, "normal": 1.0, "high": -1.0}
        short_map = {"low": -0.5, "normal": 0.0, "high": 1.0}
        vol_long = df["vol_regime"].map(long_map).fillna(0)
        vol_short = df["vol_regime"].map(short_map).fillna(0)
        scores["vol_z"] = np.where(is_short, vol_short, vol_long)
    else:
        scores["vol_z"] = 0.0

    # 5. Prior day range % — NEW v3 (d=-0.190)
    if "prior_day_range_pct" in df.columns:
        valid = df["prior_day_range_pct"].dropna()
        if len(valid) > 100:
            # Lower prior day range = better (tight setups)
            scores["pdr_z"] = -(df["prior_day_range_pct"] - valid.mean()) / valid.std()
            scores["pdr_z"] = scores["pdr_z"].fillna(0)
        else:
            scores["pdr_z"] = 0.0
    else:
        scores["pdr_z"] = 0.0

    # 6. Earnings proximity — direction-neutral (d=-0.22)
    if "earnings_proximity" in df.columns:
        prox_map = {"normal": 0.0, "pre_earnings_3d": -1.0,
                     "earnings_day": -0.8, "post_earnings_3d": -1.2}
        scores["earnings_z"] = df["earnings_proximity"].map(prox_map).fillna(0)
    else:
        scores["earnings_z"] = 0.0

    # 7. ATR % — direction-neutral
    if "atr_pct" in df.columns:
        valid = df["atr_pct"].dropna()
        if len(valid) > 100:
            scores["atr_z"] = -(df["atr_pct"] - valid.mean()) / valid.std()
            scores["atr_z"] = scores["atr_z"].fillna(0)
        else:
            scores["atr_z"] = 0.0
    else:
        scores["atr_z"] = 0.0

    # 8. Operating margin — NEW v3 (d=0.161)
    if "operating_margin" in df.columns:
        valid = df["operating_margin"].dropna()
        if len(valid) > 100:
            om_z = (df["operating_margin"] - valid.median()) / valid.std()
            om_z = om_z.clip(-3, 3).fillna(0)
            # Higher operating margin = better for longs, flip for shorts
            scores["om_z"] = np.where(is_short, -om_z, om_z)
        else:
            scores["om_z"] = 0.0
    else:
        scores["om_z"] = 0.0

    # 9. VWAP position — direction-sensitive (d=0.063)
    if "vwap_position_pct" in df.columns:
        valid = df["vwap_position_pct"].dropna()
        if len(valid) > 100:
            vwap_z = (df["vwap_position_pct"] - valid.mean()) / valid.std()
            vwap_z = vwap_z.fillna(0)
            scores["vwap_z"] = np.where(is_short, -vwap_z, vwap_z)
        else:
            scores["vwap_z"] = 0.0
    else:
        scores["vwap_z"] = 0.0

    # 10. Pre-entry momentum — direction-sensitive
    if "momentum_pct" in df.columns:
        valid = df["momentum_pct"].dropna()
        if len(valid) > 100:
            scores["momentum_z"] = -np.abs(df["momentum_pct"].fillna(0)) / valid.std()
        else:
            scores["momentum_z"] = 0.0
    else:
        scores["momentum_z"] = 0.0

    # 11. Prior day volume ratio — NEW v3 (d=-0.075)
    if "volume_ratio" in df.columns:
        valid = df["volume_ratio"].dropna()
        if len(valid) > 100:
            # Normal volume is best; high surge and very low are worse
            # Penalize deviation from mean (~1.0)
            vr_z = -np.abs(df["volume_ratio"].fillna(1.0) - 1.0) / valid.std()
            scores["vr_z"] = vr_z
        else:
            scores["vr_z"] = 0.0
    else:
        scores["vr_z"] = 0.0

    # 12. Quarter — direction-neutral
    if "quarter" in df.columns:
        q_map = {1: 0.5, 2: 0.2, 3: -0.2, 4: -0.5}
        scores["quarter_z"] = df["quarter"].map(q_map).fillna(0)
    else:
        scores["quarter_z"] = 0.0

    # 13. VIX — direction-neutral
    if "vix" in df.columns:
        valid = df["vix"].dropna()
        if len(valid) > 100:
            scores["vix_z"] = -(df["vix"] - valid.mean()) / valid.std()
            scores["vix_z"] = scores["vix_z"].fillna(0)
        else:
            scores["vix_z"] = 0.0
    else:
        scores["vix_z"] = 0.0

    # 14. Yield spread — direction-neutral
    if "yield_spread_10y2y" in df.columns:
        spread = df["yield_spread_10y2y"].fillna(0.75)
        scores["yield_z"] = -np.abs(spread - 0.75)
    else:
        scores["yield_z"] = 0.0

    # Weighted composite — 14 features
    weights = {
        "cap_z": 0.20,        # market cap (d=0.55, strongest)
        "or_z": 0.13,         # opening range (d=-0.284)
        "eps_z": 0.10,        # EPS diluted (d=0.233, NEW)
        "vol_z": 0.10,        # vol regime (d=0.22)
        "pdr_z": 0.08,        # prior day range (d=-0.190, NEW)
        "earnings_z": 0.08,   # earnings proximity (d=-0.22)
        "atr_z": 0.07,        # ATR %
        "om_z": 0.06,         # operating margin (d=0.161, NEW)
        "vwap_z": 0.05,       # VWAP position (d=0.063)
        "momentum_z": 0.04,   # pre-entry momentum
        "vr_z": 0.03,         # prior day vol ratio (d=-0.075, NEW)
        "quarter_z": 0.03,    # quarter
        "vix_z": 0.02,        # VIX
        "yield_z": 0.01,      # yield curve
    }

    composite = sum(scores[col] * w for col, w in weights.items())
    scores["composite_score"] = composite

    # Percentile rank for 0-100 spread
    cs = scores["composite_score"]
    if cs.std() > 0:
        scores["composite_pct"] = cs.rank(pct=True).mul(100).round(1)
    else:
        scores["composite_pct"] = 50.0

    print(f"  Score: mean={scores['composite_pct'].mean():.1f}, "
          f"std={scores['composite_pct'].std():.1f}")

    return scores


def decile_analysis(df, scores):
    lines = []
    merged = df[["trade_id", "holly_pnl", "win", "mfe", "mae"]].merge(
        scores[["trade_id", "composite_pct"]], on="trade_id"
    )
    merged["decile"] = pd.qcut(merged["composite_pct"], 10, labels=False,
                                duplicates="drop") + 1

    lines.append("| Decile | Score Range | n | WR | Avg P&L | Avg MFE | Cum P&L |")
    lines.append("|--------|-------------|---|----|---------|---------|---------| ")

    cum_pnl = 0
    for d in sorted(merged["decile"].unique()):
        sub = merged[merged["decile"] == d]
        cum_pnl += sub["holly_pnl"].sum()
        lines.append(
            f"| D{d} | {sub['composite_pct'].min():.0f}-{sub['composite_pct'].max():.0f} "
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

    top = merged[merged["decile"] == merged["decile"].max()]
    bottom = merged[merged["decile"] == merged["decile"].min()]
    if len(top) >= 10 and len(bottom) >= 10:
        test = welch_t_test(top["holly_pnl"], bottom["holly_pnl"])
        lines.append(f"**Top (D10):** {len(top):,} trades, "
                     f"WR={top['win'].mean()*100:.1f}%, Avg=${top['holly_pnl'].mean():.0f}")
        lines.append(f"**Bottom (D1):** {len(bottom):,} trades, "
                     f"WR={bottom['win'].mean()*100:.1f}%, Avg=${bottom['holly_pnl'].mean():.0f}")
        if not np.isnan(test["cohens_d"]):
            lines.append(f"**Cohen's d:** {test['cohens_d']:.3f}")
    lines.append("")
    return lines


def strategy_analysis(df, scores):
    lines = []
    merged = df[["trade_id", "holly_pnl", "win", "strategy", "direction"]].merge(
        scores[["trade_id", "composite_pct"]], on="trade_id"
    )
    top_strats = merged["strategy"].value_counts().head(8).index.tolist()

    for strat in top_strats:
        sdf = merged[merged["strategy"] == strat].copy()
        direction = sdf["direction"].mode().iloc[0] if len(sdf) > 0 else "?"
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


def walk_forward(df, scores):
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
        t = welch_t_test(top["holly_pnl"], bot["holly_pnl"])
        lines.append(f"**OOS Lift:** ${top['holly_pnl'].mean() - bot['holly_pnl'].mean():.0f}/trade")
        if not np.isnan(t["cohens_d"]):
            lines.append(f"**Cohen's d:** {t['cohens_d']:.3f}")
        if not np.isnan(t["p_value"]):
            lines.append(f"**p-value:** {t['p_value']:.4f}")
            if t["p_value"] < 0.05:
                lines.append("**VERDICT: Edge confirmed out-of-sample**")
            elif t["p_value"] < 0.10:
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
    con.close()

    if len(df) == 0:
        print("No data!")
        sys.exit(1)

    scores = compute_composite_v3(df)

    report = []
    report.append("# Composite Edge Score V3 (+ Fundamentals + Prior-Day Context)")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,}")
    report.append(f"Longs: {(df['direction'].str.lower()=='long').sum():,} | "
                  f"Shorts: {(df['direction'].str.lower()=='short').sum():,}")
    report.append(f"Coverage: OR={df['opening_range_pct'].notna().sum():,} "
                  f"({df['opening_range_pct'].notna().mean()*100:.0f}%), "
                  f"EPS={df['eps_diluted'].notna().sum():,} "
                  f"({df['eps_diluted'].notna().mean()*100:.0f}%), "
                  f"Prior-day={df['prior_day_range_pct'].notna().sum():,} "
                  f"({df['prior_day_range_pct'].notna().mean()*100:.0f}%)")
    report.append("")

    # Weights table
    report.append("## Feature Weights (14 features)")
    report.append("")
    report.append("| Feature | Weight | Source | Cohen's d |")
    report.append("|---------|--------|--------|-----------|")
    report.append("| Market Cap (log) | 0.20 | Script 50 | 0.553 |")
    report.append("| Opening Range % | 0.13 | Script 54 | -0.284 |")
    report.append("| EPS Diluted | 0.10 | Script 57 | 0.233 |")
    report.append("| Vol Regime | 0.10 | Script 47 | 0.22 |")
    report.append("| Prior Day Range % | 0.08 | Script 56 | -0.190 |")
    report.append("| Earnings Proximity | 0.08 | Script 48 | -0.22 |")
    report.append("| ATR % | 0.07 | Script 47 | ~0.15 |")
    report.append("| Operating Margin | 0.06 | Script 57 | 0.161 |")
    report.append("| VWAP Position | 0.05 | Script 54 | 0.063 |")
    report.append("| Pre-Entry Momentum | 0.04 | Script 54 | ~0.10 |")
    report.append("| Prior Day Vol Ratio | 0.03 | Script 56 | -0.075 |")
    report.append("| Quarter | 0.03 | Script 51 | ~0.08 |")
    report.append("| VIX Level | 0.02 | Script 49 | 0.04-0.07 |")
    report.append("| Yield Curve | 0.01 | Script 49 | ~0.10 |")
    report.append("")
    report.append("---")
    report.append("")

    # Section 1: Decile
    report.append("## 1. Decile Analysis")
    report.append("")
    report.extend(decile_analysis(df, scores))

    # Section 2: Strategy
    report.append("## 2. Strategy x Score (top 8)")
    report.append("")
    report.extend(strategy_analysis(df, scores))

    # Section 3: Walk-forward
    report.append("## 3. Walk-Forward Validation")
    report.append("")
    report.extend(walk_forward(df, scores))

    # Section 4: Thresholds
    report.append("## 4. Actionable Thresholds")
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

    # Section 5: V2 vs V3 comparison
    report.append("## 5. V2 vs V3 Comparison")
    report.append("")
    report.append("See composite-v2.md for V2 baseline metrics.")
    report.append("")

    # Write
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / "composite-v3.md"
    report_path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport saved: {report_path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
