"""
Script 67 — Strategy × Regime Interaction Lift Analysis
=========================================================
Investigate whether certain strategies perform differently across
volatility regimes, macro environments, and time-of-day contexts.

Features:
  - strategy_vol_regime_wr: Historical WR for this strategy in this vol regime
  - strategy_hour_wr: Historical WR for this strategy at this hour
  - strategy_dow_wr: Historical WR for this strategy on this day of week
  - strategy_recent_wr: Strategy's rolling 20-trade win rate
  - strategy_recent_streak: Strategy's current streak
  - strategy_daily_count: How many trades this strategy has taken today
  - strategy_vix_bucket_wr: Strategy WR in this VIX bucket (low/mid/high)
"""

import sys, time
from pathlib import Path
import numpy as np
import pandas as pd
import duckdb
from scipy import stats
from statsmodels.stats.multitest import multipletests

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH

REPORT_DIR = Path(__file__).parent.parent / "output" / "reports"


def welch_t(a, b):
    na, nb = len(a), len(b)
    if na < 10 or nb < 10:
        return {"cohens_d": np.nan, "p_value": np.nan}
    ma, mb = np.mean(a), np.mean(b)
    sa, sb = np.std(a, ddof=1), np.std(b, ddof=1)
    pooled = np.sqrt((sa**2 + sb**2) / 2)
    d = (ma - mb) / pooled if pooled > 0 else 0
    _, p_val = stats.ttest_ind(a, b, equal_var=False)
    return {"cohens_d": d, "p_value": p_val}


def compute_strategy_meta_features(df):
    """Compute strategy-level meta-features with NO look-ahead."""
    df = df.sort_values("entry_time").reset_index(drop=True)
    n = len(df)

    strategy_recent_wr = np.full(n, np.nan)
    strategy_recent_streak = np.zeros(n, dtype=int)
    strategy_daily_count = np.zeros(n, dtype=int)
    strategy_vol_regime_wr = np.full(n, np.nan)
    strategy_hour_wr = np.full(n, np.nan)
    strategy_dow_wr = np.full(n, np.nan)
    strategy_vix_bucket_wr = np.full(n, np.nan)

    # Running state per strategy
    strat_history = {}  # strategy -> deque of (win,)
    strat_vol_history = {}  # (strategy, vol_regime) -> [wins, total]
    strat_hour_history = {}  # (strategy, hour) -> [wins, total]
    strat_dow_history = {}  # (strategy, dow) -> [wins, total]
    strat_daily_counter = {}  # (strategy, date) -> count
    strat_vix_history = {}  # (strategy, vix_bucket) -> [wins, total]

    for i in range(n):
        strat = df.iloc[i]["strategy"]
        win = df.iloc[i]["win"]
        vol = df.iloc[i].get("vol_regime", None)
        hour = df.iloc[i]["hour"]
        dow = df.iloc[i]["dow"]
        trade_date = df.iloc[i]["trade_date"]
        vix_bucket = df.iloc[i].get("vix_bucket", None)

        # Strategy recent WR (rolling 20)
        hist = strat_history.get(strat, [])
        if len(hist) >= 10:
            recent = hist[-20:] if len(hist) >= 20 else hist
            strategy_recent_wr[i] = sum(recent) / len(recent) * 100

        # Strategy recent streak
        if len(hist) > 0:
            streak = 0
            for h in reversed(hist):
                if h == 1:
                    if streak >= 0:
                        streak += 1
                    else:
                        break
                else:
                    if streak <= 0:
                        streak -= 1
                    else:
                        break
            strategy_recent_streak[i] = streak

        # Strategy × vol regime WR
        if vol is not None and not (isinstance(vol, float) and np.isnan(vol)):
            key = (strat, vol)
            if key in strat_vol_history and strat_vol_history[key][1] >= 10:
                strategy_vol_regime_wr[i] = strat_vol_history[key][0] / strat_vol_history[key][1] * 100

        # Strategy × hour WR
        key_h = (strat, hour)
        if key_h in strat_hour_history and strat_hour_history[key_h][1] >= 10:
            strategy_hour_wr[i] = strat_hour_history[key_h][0] / strat_hour_history[key_h][1] * 100

        # Strategy × DOW WR
        key_d = (strat, dow)
        if key_d in strat_dow_history and strat_dow_history[key_d][1] >= 10:
            strategy_dow_wr[i] = strat_dow_history[key_d][0] / strat_dow_history[key_d][1] * 100

        # Strategy × VIX bucket WR
        if vix_bucket is not None and not (isinstance(vix_bucket, float) and np.isnan(vix_bucket)):
            key_v = (strat, vix_bucket)
            if key_v in strat_vix_history and strat_vix_history[key_v][1] >= 10:
                strategy_vix_bucket_wr[i] = strat_vix_history[key_v][0] / strat_vix_history[key_v][1] * 100

        # Daily count for this strategy
        key_dc = (strat, trade_date)
        if key_dc in strat_daily_counter:
            strategy_daily_count[i] = strat_daily_counter[key_dc]
        # This is count BEFORE this trade, so 0 means first of the day

        # ── Update state ──
        if strat not in strat_history:
            strat_history[strat] = []
        strat_history[strat].append(win)

        if vol is not None and not (isinstance(vol, float) and np.isnan(vol)):
            key = (strat, vol)
            if key not in strat_vol_history:
                strat_vol_history[key] = [0, 0]
            strat_vol_history[key][0] += win
            strat_vol_history[key][1] += 1

        if key_h not in strat_hour_history:
            strat_hour_history[key_h] = [0, 0]
        strat_hour_history[key_h][0] += win
        strat_hour_history[key_h][1] += 1

        if key_d not in strat_dow_history:
            strat_dow_history[key_d] = [0, 0]
        strat_dow_history[key_d][0] += win
        strat_dow_history[key_d][1] += 1

        if vix_bucket is not None and not (isinstance(vix_bucket, float) and np.isnan(vix_bucket)):
            key_v = (strat, vix_bucket)
            if key_v not in strat_vix_history:
                strat_vix_history[key_v] = [0, 0]
            strat_vix_history[key_v][0] += win
            strat_vix_history[key_v][1] += 1

        if key_dc not in strat_daily_counter:
            strat_daily_counter[key_dc] = 0
        strat_daily_counter[key_dc] += 1

    df["strategy_recent_wr"] = strategy_recent_wr
    df["strategy_recent_streak"] = strategy_recent_streak
    df["strategy_daily_count"] = strategy_daily_count
    df["strategy_vol_regime_wr"] = strategy_vol_regime_wr
    df["strategy_hour_wr"] = strategy_hour_wr
    df["strategy_dow_wr"] = strategy_dow_wr
    df["strategy_vix_bucket_wr"] = strategy_vix_bucket_wr

    return df


def quintile_breakdown(df, col, label):
    valid = df.dropna(subset=[col])
    if len(valid) < 100:
        return None
    try:
        valid["q"] = pd.qcut(valid[col], 5, labels=False, duplicates="drop")
    except ValueError:
        return None
    rows = []
    for q in sorted(valid["q"].unique()):
        qdf = valid[valid["q"] == q]
        rows.append({
            "quintile": f"Q{q+1}",
            "range": f"{qdf[col].min():.2f}–{qdf[col].max():.2f}",
            "n": len(qdf),
            "wr": qdf["win"].mean() * 100,
            "avg_pnl": qdf["holly_pnl"].mean(),
        })
    return rows


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df = con.execute("""
        SELECT t.trade_id, t.symbol, t.strategy, t.direction,
            t.entry_time, t.holly_pnl,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            EXTRACT(HOUR FROM t.entry_time) AS hour,
            EXTRACT(DOW FROM t.entry_time) AS dow,
            CAST(t.entry_time AS DATE) AS trade_date,
            r.vol_regime,
            fm.vix
        FROM trades t
        LEFT JOIN trade_regime r ON r.trade_id = t.trade_id
        LEFT JOIN fred_macro_daily fm ON fm.date = CAST(t.entry_time AS DATE)
        ORDER BY t.entry_time
    """).fetchdf()
    con.close()
    print(f"Loaded {len(df):,} trades")

    # VIX buckets
    df["vix_bucket"] = pd.cut(df["vix"], bins=[0, 15, 20, 25, 100],
                              labels=["low", "mid", "high", "extreme"],
                              right=False).astype(str)
    df.loc[df["vix"].isna(), "vix_bucket"] = np.nan

    # Compute features
    print("Computing strategy meta-features...")
    df = compute_strategy_meta_features(df)

    # Coverage stats
    for col in ["strategy_recent_wr", "strategy_vol_regime_wr", "strategy_hour_wr",
                "strategy_dow_wr", "strategy_vix_bucket_wr"]:
        coverage = df[col].notna().sum()
        print(f"  {col}: {coverage:,} trades")

    # ── Lift analysis ──
    features = [
        ("strategy_recent_wr", "Strategy Rolling 20-Trade WR (%)"),
        ("strategy_recent_streak", "Strategy Current Streak"),
        ("strategy_daily_count", "Strategy Daily Count (prior)"),
        ("strategy_vol_regime_wr", "Strategy × Vol Regime WR (%)"),
        ("strategy_hour_wr", "Strategy × Hour WR (%)"),
        ("strategy_dow_wr", "Strategy × Day-of-Week WR (%)"),
        ("strategy_vix_bucket_wr", "Strategy × VIX Bucket WR (%)"),
    ]

    feature_summary = []
    for col, label in features:
        valid = df.dropna(subset=[col])
        if len(valid) < 50:
            continue
        winners = valid[valid["win"] == 1][col]
        losers = valid[valid["win"] == 0][col]
        t = welch_t(winners, losers)
        if np.isnan(t["cohens_d"]):
            continue
        feature_summary.append({
            "feature": label, "col": col,
            "n": len(valid), "d": t["cohens_d"], "p": t["p_value"],
        })

    # FDR
    if feature_summary:
        pvals = [f["p"] for f in feature_summary]
        reject, _, _, _ = multipletests(pvals, method="fdr_bh", alpha=0.05)
        for i, fs in enumerate(feature_summary):
            fs["fdr_sig"] = reject[i]

    feature_summary.sort(key=lambda x: abs(x["d"]), reverse=True)

    # Direction-specific
    longs = df[df["direction"].str.lower() == "long"]
    shorts = df[df["direction"].str.lower() == "short"]
    dir_results = []
    for col, label in features:
        for ddf, dname in [(longs, "Longs"), (shorts, "Shorts")]:
            valid = ddf.dropna(subset=[col])
            if len(valid) < 50:
                continue
            w = valid[valid["win"] == 1][col]
            l = valid[valid["win"] == 0][col]
            t = welch_t(w, l)
            if not np.isnan(t["cohens_d"]):
                dir_results.append({
                    "feature": f"{label} ({dname})",
                    "d": t["cohens_d"], "p": t["p_value"], "n": len(valid),
                })
    dir_results.sort(key=lambda x: abs(x["d"]), reverse=True)

    # ── Build report ──
    report = []
    report.append("# Strategy × Regime Interaction — Lift Analysis")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,}")
    fdr_count = sum(1 for f in feature_summary if f.get("fdr_sig"))
    report.append(f"FDR-Significant: {fdr_count}/{len(feature_summary)}")
    report.append("")

    report.append("## 1. Feature Summary")
    report.append("")
    report.append("| Feature | n | Cohen's d | p-value | FDR Sig |")
    report.append("|---------|---|-----------|---------|---------|\n")
    for fs in feature_summary:
        sig = "Y" if fs.get("fdr_sig") else ""
        report.append(f"| {fs['feature']} | {fs['n']:,} | {fs['d']:.3f} | {fs['p']:.4f} | {sig} |")
    report.append("")

    # Quintile breakdowns
    report.append("## 2. Quintile Breakdowns")
    report.append("")
    for col, label in features:
        rows = quintile_breakdown(df, col, label)
        if rows is None:
            continue
        report.append(f"**{label}** (n={sum(r['n'] for r in rows):,})")
        report.append("")
        report.append("| Quintile | Range | n | WR | Avg P&L |")
        report.append("|----------|-------|---|----|---------|\n")
        for r in rows:
            report.append(f"| {r['quintile']} | {r['range']} | {r['n']:,} | {r['wr']:.1f}% | ${r['avg_pnl']:.0f} |")
        report.append("")

    # Direction-specific
    report.append("## 3. Direction-Specific Features")
    report.append("")
    report.append("| Feature | n | Cohen's d | p-value |")
    report.append("|---------|---|-----------|---------|\n")
    for dr in dir_results:
        report.append(f"| {dr['feature']} | {dr['n']:,} | {dr['d']:.3f} | {dr['p']:.4f} |")
    report.append("")

    # Conclusions
    report.append("## 4. Conclusions")
    report.append("")
    sig_features = [f for f in feature_summary if f.get("fdr_sig")]
    if sig_features:
        report.append("**FDR-significant features:**")
        for f in sig_features:
            report.append(f"- {f['feature']}: d={f['d']:.3f}")
    else:
        report.append("*No FDR-significant features found.*")
    report.append("")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "strategy-regime-lift.md"
    path.write_text("\n".join(report), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
