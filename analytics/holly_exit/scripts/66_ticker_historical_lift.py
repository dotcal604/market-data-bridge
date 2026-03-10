"""
Script 66 — Ticker Historical Performance Lift Analysis
========================================================
Mine historical per-ticker win rates and P&L from prior Holly trades.
Uses ONLY trades before each trade's entry_time (no look-ahead).

Features:
  - ticker_prior_wr: Historical win rate for this ticker (all prior trades)
  - ticker_prior_avg_pnl: Historical avg P&L for this ticker
  - ticker_prior_n: Number of prior trades on this ticker
  - ticker_prior_streak: Current streak (positive = wins, negative = losses)
  - ticker_prior_wr_30d: Win rate from last 30 days on this ticker
  - ticker_recency: Days since last trade on this ticker
  - ticker_is_repeat: Whether this ticker has been traded before
  - strategy_ticker_wr: Win rate for this strategy + ticker combo
"""

import sys, time
from pathlib import Path
import numpy as np
import pandas as pd
import duckdb
from scipy import stats

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH

REPORT_DIR = Path(__file__).parent.parent / "output" / "reports"


def welch_t(a, b):
    """Welch's t-test returning Cohen's d, p-value."""
    na, nb = len(a), len(b)
    if na < 10 or nb < 10:
        return {"cohens_d": np.nan, "p_value": np.nan}
    ma, mb = np.mean(a), np.mean(b)
    sa, sb = np.std(a, ddof=1), np.std(b, ddof=1)
    pooled = np.sqrt((sa**2 + sb**2) / 2)
    d = (ma - mb) / pooled if pooled > 0 else 0
    t_stat, p_val = stats.ttest_ind(a, b, equal_var=False)
    return {"cohens_d": d, "p_value": p_val}


def compute_ticker_features(df):
    """Compute per-ticker historical features with NO look-ahead."""
    # Sort by entry_time (chronological)
    df = df.sort_values("entry_time").reset_index(drop=True)

    # Pre-allocate arrays
    n = len(df)
    ticker_prior_wr = np.full(n, np.nan)
    ticker_prior_avg_pnl = np.full(n, np.nan)
    ticker_prior_n = np.zeros(n, dtype=int)
    ticker_prior_streak = np.zeros(n, dtype=int)
    ticker_prior_wr_30d = np.full(n, np.nan)
    ticker_recency = np.full(n, np.nan)
    ticker_is_repeat = np.zeros(n, dtype=int)
    strategy_ticker_wr = np.full(n, np.nan)

    # Build running stats per ticker
    # ticker -> list of (entry_time, win, pnl)
    ticker_history = {}
    strat_ticker_history = {}

    for i in range(n):
        sym = df.iloc[i]["symbol"]
        strat = df.iloc[i]["strategy"]
        entry_t = df.iloc[i]["entry_time"]
        win = df.iloc[i]["win"]
        pnl = df.iloc[i]["holly_pnl"]
        st_key = (strat, sym)

        # Look up prior history
        hist = ticker_history.get(sym, [])
        if len(hist) > 0:
            ticker_is_repeat[i] = 1
            wins = sum(h[1] for h in hist)
            total = len(hist)
            ticker_prior_wr[i] = wins / total * 100
            ticker_prior_avg_pnl[i] = sum(h[2] for h in hist) / total
            ticker_prior_n[i] = total

            # Streak
            streak = 0
            for h in reversed(hist):
                if h[1] == 1:
                    if streak >= 0:
                        streak += 1
                    else:
                        break
                else:
                    if streak <= 0:
                        streak -= 1
                    else:
                        break
            ticker_prior_streak[i] = streak

            # 30-day window
            cutoff = entry_t - pd.Timedelta(days=30)
            recent = [h for h in hist if h[0] >= cutoff]
            if len(recent) >= 3:
                ticker_prior_wr_30d[i] = sum(h[1] for h in recent) / len(recent) * 100

            # Recency (days since last trade)
            ticker_recency[i] = (entry_t - hist[-1][0]).total_seconds() / 86400

        # Strategy + ticker combo
        st_hist = strat_ticker_history.get(st_key, [])
        if len(st_hist) >= 3:
            strategy_ticker_wr[i] = sum(h[1] for h in st_hist) / len(st_hist) * 100

        # Append current trade to history (for future trades)
        if sym not in ticker_history:
            ticker_history[sym] = []
        ticker_history[sym].append((entry_t, win, pnl))

        if st_key not in strat_ticker_history:
            strat_ticker_history[st_key] = []
        strat_ticker_history[st_key].append((entry_t, win, pnl))

    df["ticker_prior_wr"] = ticker_prior_wr
    df["ticker_prior_avg_pnl"] = ticker_prior_avg_pnl
    df["ticker_prior_n"] = ticker_prior_n
    df["ticker_prior_streak"] = ticker_prior_streak
    df["ticker_prior_wr_30d"] = ticker_prior_wr_30d
    df["ticker_recency"] = ticker_recency
    df["ticker_is_repeat"] = ticker_is_repeat
    df["strategy_ticker_wr"] = strategy_ticker_wr

    return df


def quintile_breakdown(df, col, label):
    """Compute quintile breakdown for a continuous feature."""
    valid = df.dropna(subset=[col])
    if len(valid) < 100:
        return None, None

    try:
        valid["q"] = pd.qcut(valid[col], 5, labels=False, duplicates="drop")
    except ValueError:
        return None, None

    rows = []
    for q in sorted(valid["q"].unique()):
        qdf = valid[valid["q"] == q]
        lo, hi = qdf[col].min(), qdf[col].max()
        rows.append({
            "quintile": f"Q{q+1}",
            "range": f"{lo:.2f}–{hi:.2f}",
            "n": len(qdf),
            "wr": qdf["win"].mean() * 100,
            "avg_pnl": qdf["holly_pnl"].mean(),
        })

    # Cohen's d: Q5 vs Q1
    q5 = valid[valid["q"] == valid["q"].max()]["holly_pnl"]
    q1 = valid[valid["q"] == valid["q"].min()]["holly_pnl"]
    t = welch_t(q5, q1)

    return rows, t


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df = con.execute("""
        SELECT trade_id, symbol, strategy, direction,
            entry_time, holly_pnl,
            CASE WHEN holly_pnl > 0 THEN 1 ELSE 0 END AS win
        FROM trades
        ORDER BY entry_time
    """).fetchdf()
    con.close()
    print(f"Loaded {len(df):,} trades")

    # Compute ticker-level features
    print("Computing ticker historical features...")
    df = compute_ticker_features(df)

    # Stats
    repeat_pct = df["ticker_is_repeat"].mean() * 100
    has_30d = df["ticker_prior_wr_30d"].notna().sum()
    has_strat_ticker = df["strategy_ticker_wr"].notna().sum()
    print(f"  Repeat tickers: {repeat_pct:.1f}%")
    print(f"  With 30d WR: {has_30d:,}")
    print(f"  With strategy+ticker WR: {has_strat_ticker:,}")

    # ── Lift analysis ──
    features = [
        ("ticker_prior_wr", "Ticker Prior Win Rate (%)"),
        ("ticker_prior_avg_pnl", "Ticker Prior Avg P&L ($)"),
        ("ticker_prior_n", "Ticker Prior Trade Count"),
        ("ticker_prior_streak", "Ticker Current Streak"),
        ("ticker_prior_wr_30d", "Ticker 30-Day Win Rate (%)"),
        ("ticker_recency", "Days Since Last Trade on Ticker"),
        ("strategy_ticker_wr", "Strategy+Ticker Combo Win Rate (%)"),
    ]

    # Overall Cohen's d (winners vs losers)
    feature_summary = []
    for col, label in features:
        valid = df.dropna(subset=[col])
        if len(valid) < 100:
            continue
        winners = valid[valid["win"] == 1][col]
        losers = valid[valid["win"] == 0][col]
        t = welch_t(winners, losers)
        n = len(valid)
        from statsmodels.stats.multitest import multipletests
        feature_summary.append({
            "feature": label,
            "col": col,
            "n": n,
            "d": t["cohens_d"],
            "p": t["p_value"],
        })

    # FDR correction
    if feature_summary:
        pvals = [f["p"] for f in feature_summary]
        reject, corrected, _, _ = multipletests(pvals, method="fdr_bh", alpha=0.05)
        for i, fs in enumerate(feature_summary):
            fs["fdr_sig"] = reject[i]

    # Sort by absolute d
    feature_summary.sort(key=lambda x: abs(x["d"]), reverse=True)

    # Binary feature: ticker_is_repeat
    repeat_df = df.copy()
    rep_yes = repeat_df[repeat_df["ticker_is_repeat"] == 1]
    rep_no = repeat_df[repeat_df["ticker_is_repeat"] == 0]
    rep_t = welch_t(rep_yes["holly_pnl"], rep_no["holly_pnl"])

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
                    "d": t["cohens_d"],
                    "p": t["p_value"],
                    "n": len(valid),
                })

    # ── Build report ──
    report = []
    report.append("# Ticker Historical Performance — Lift Analysis")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,}")
    report.append(f"Repeat tickers: {repeat_pct:.1f}%")
    report.append(f"FDR-Significant: {sum(1 for f in feature_summary if f.get('fdr_sig'))}/{len(feature_summary)}")
    report.append("")

    # Feature summary
    report.append("## 1. Feature Summary")
    report.append("")
    report.append("| Feature | n | Cohen's d | p-value | FDR Sig |")
    report.append("|---------|---|-----------|---------|---------|\n")
    for fs in feature_summary:
        sig = "Y" if fs.get("fdr_sig") else ""
        report.append(f"| {fs['feature']} | {fs['n']:,} | {fs['d']:.3f} | {fs['p']:.4f} | {sig} |")
    report.append("")

    # Binary
    report.append("## 2. Repeat Ticker Effect")
    report.append("")
    report.append(f"| Metric | Repeat | First-time |")
    report.append(f"|--------|--------|------------|")
    report.append(f"| n | {len(rep_yes):,} | {len(rep_no):,} |")
    report.append(f"| Win Rate | {rep_yes['win'].mean()*100:.1f}% | {rep_no['win'].mean()*100:.1f}% |")
    report.append(f"| Avg P&L | ${rep_yes['holly_pnl'].mean():.0f} | ${rep_no['holly_pnl'].mean():.0f} |")
    report.append(f"| Cohen's d | {rep_t['cohens_d']:.3f} | — |")
    report.append(f"| p-value | {rep_t['p_value']:.4f} | — |")
    report.append("")

    # Quintile breakdowns
    report.append("## 3. Quintile Breakdowns")
    report.append("")
    for col, label in features:
        rows, t = quintile_breakdown(df, col, label)
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
    report.append("## 4. Direction-Specific Features")
    report.append("")
    dir_results.sort(key=lambda x: abs(x["d"]), reverse=True)
    report.append("| Feature | n | Cohen's d | p-value |")
    report.append("|---------|---|-----------|---------|\n")
    for dr in dir_results:
        report.append(f"| {dr['feature']} | {dr['n']:,} | {dr['d']:.3f} | {dr['p']:.4f} |")
    report.append("")

    # Conclusions
    report.append("## 5. Conclusions")
    report.append("")
    sig_features = [f for f in feature_summary if f.get("fdr_sig")]
    if sig_features:
        report.append("**FDR-significant features:**")
        for f in sig_features:
            report.append(f"- {f['feature']}: d={f['d']:.3f}")
    else:
        report.append("*No FDR-significant features found.*")
    report.append("")

    # Write
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "ticker-historical-lift.md"
    path.write_text("\n".join(report), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
