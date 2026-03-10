"""
Script 72 — Multi-Day Volume & Liquidity Patterns Lift
=========================================================
Mine `daily_bars_flat` (13.7M rows) for per-ticker multi-day features:
  - transactions_1d: number of trades prior day (liquidity proxy)
  - volume_change_1d: volume vs 20-day average (prior day)
  - return_streak: consecutive up/down days ending prior day
  - volatility_5d: 5-day realized volatility (close-to-close)
  - high_low_range_5d: average (H-L)/C over prior 5 days
  - volume_trend_5d: 5-day volume slope (is volume rising or falling?)
  - close_vs_5d_high: where price is relative to 5-day high

Uses DuckDB window functions for efficient computation.
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


def quintile_breakdown(df, col):
    valid = df.dropna(subset=[col])
    if len(valid) < 100:
        return None
    try:
        valid = valid.copy()
        valid["q"] = pd.qcut(valid[col], 5, labels=False, duplicates="drop")
    except ValueError:
        return None
    rows = []
    for q in sorted(valid["q"].unique()):
        qdf = valid[valid["q"] == q]
        rows.append({
            "quintile": f"Q{q+1}",
            "range": f"{qdf[col].min():.4f}–{qdf[col].max():.4f}",
            "n": len(qdf),
            "wr": qdf["win"].mean() * 100,
            "avg_pnl": qdf["holly_pnl"].mean(),
        })
    return rows


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    # Compute daily features using DuckDB window functions (2-stage CTE to avoid nesting)
    print("Computing multi-day features in DuckDB...")
    df = con.execute("""
        WITH base AS (
            SELECT
                ticker,
                bar_time AS bar_date,
                open, high, low, close, volume, transactions,
                -- Prior day values via LAG
                LAG(close) OVER w AS prev_close,
                LAG(volume) OVER w AS prev_volume,
                LAG(transactions) OVER w AS prev_transactions,
                -- Rolling averages for volume
                AVG(volume) OVER (PARTITION BY ticker ORDER BY bar_time ROWS BETWEEN 21 PRECEDING AND 1 PRECEDING) AS avg_volume_20d,
                -- 5-day range and price stats (using prior 5 days)
                AVG((high - low) / NULLIF(close, 0) * 100) OVER (
                    PARTITION BY ticker ORDER BY bar_time ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING
                ) AS avg_range_5d,
                MAX(high) OVER (PARTITION BY ticker ORDER BY bar_time ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS high_5d,
                MIN(low) OVER (PARTITION BY ticker ORDER BY bar_time ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS low_5d,
                LN(NULLIF(LAG(volume) OVER w, 0)) AS log_volume_1d
            FROM daily_bars_flat
            WINDOW w AS (PARTITION BY ticker ORDER BY bar_time)
        ),
        daily_features AS (
            SELECT
                ticker, bar_date, close, volume,
                prev_transactions AS transactions_1d,
                (close / NULLIF(prev_close, 0) - 1) * 100 AS return_1d,
                prev_volume / NULLIF(avg_volume_20d, 0) AS rel_volume_1d,
                -- 5-day volatility using std of returns over prior rows
                STDDEV((close / NULLIF(prev_close, 0) - 1)) OVER (
                    PARTITION BY ticker ORDER BY bar_date ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING
                ) * 100 AS volatility_5d,
                avg_range_5d,
                close / NULLIF(high_5d, 0) AS close_vs_5d_high,
                close / NULLIF(low_5d, 0) AS close_vs_5d_low,
                log_volume_1d
            FROM base
            WHERE prev_close IS NOT NULL
        )
        SELECT
            t.trade_id, t.symbol, t.strategy, t.direction,
            t.entry_time, t.holly_pnl,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            df.transactions_1d,
            df.rel_volume_1d,
            df.volatility_5d,
            df.avg_range_5d,
            df.close_vs_5d_high,
            df.close_vs_5d_low,
            df.log_volume_1d,
            df.return_1d AS flat_return_1d
        FROM trades t
        LEFT JOIN daily_features df
            ON df.ticker = t.symbol
            AND df.bar_date = (
                SELECT MAX(df2.bar_time)
                FROM daily_bars_flat df2
                WHERE df2.ticker = t.symbol
                AND df2.bar_time < t.entry_time
            )
    """).fetchdf()
    con.close()
    print(f"Loaded {len(df):,} trades ({time.time()-t0:.1f}s)")

    # Log-transform transactions
    df["log_transactions_1d"] = np.log1p(df["transactions_1d"])

    # Coverage stats
    feature_cols = [
        "transactions_1d", "log_transactions_1d", "rel_volume_1d",
        "volatility_5d", "avg_range_5d",
        "close_vs_5d_high", "close_vs_5d_low",
        "log_volume_1d", "flat_return_1d",
    ]
    for c in feature_cols:
        n = df[c].notna().sum()
        print(f"  {c}: {n:,} ({n/len(df)*100:.1f}%)")

    # ── Lift analysis ──
    features = [
        ("transactions_1d", "Transactions (Prior Day)"),
        ("log_transactions_1d", "Log Transactions (Prior Day)"),
        ("rel_volume_1d", "Relative Volume (Prior Day vs 20d Avg)"),
        ("volatility_5d", "5-Day Realized Volatility (%)"),
        ("avg_range_5d", "Average Daily Range 5-Day (%)"),
        ("close_vs_5d_high", "Close vs 5-Day High (ratio)"),
        ("close_vs_5d_low", "Close vs 5-Day Low (ratio)"),
        ("log_volume_1d", "Log Volume (Prior Day)"),
        ("flat_return_1d", "Prior Day Return (%)"),
    ]

    feature_summary = []
    for col, label in features:
        valid = df.dropna(subset=[col])
        if len(valid) < 100:
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
    report.append("# Multi-Day Volume & Liquidity Patterns — Lift Analysis")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,}")
    fdr_count = sum(1 for f in feature_summary if f.get("fdr_sig"))
    report.append(f"FDR-Significant: {fdr_count}/{len(feature_summary)}")
    report.append("")

    report.append("## 1. Feature Summary")
    report.append("")
    report.append("| Feature | n | Cohen's d | p-value | FDR Sig |")
    report.append("|---------|---|-----------|---------|---------|")
    for fs in feature_summary:
        sig = "Y" if fs.get("fdr_sig") else ""
        report.append(f"| {fs['feature']} | {fs['n']:,} | {fs['d']:.3f} | {fs['p']:.4f} | {sig} |")
    report.append("")

    report.append("## 2. Quintile Breakdowns")
    report.append("")
    for col, label in features:
        rows = quintile_breakdown(df, col)
        if rows is None:
            continue
        report.append(f"**{label}** (n={sum(r['n'] for r in rows):,})")
        report.append("")
        report.append("| Quintile | Range | n | WR | Avg P&L |")
        report.append("|----------|-------|---|----|---------|")
        for r in rows:
            report.append(f"| {r['quintile']} | {r['range']} | {r['n']:,} | {r['wr']:.1f}% | ${r['avg_pnl']:.0f} |")
        report.append("")

    report.append("## 3. Direction-Specific (Top 15)")
    report.append("")
    report.append("| Feature | n | Cohen's d | p-value |")
    report.append("|---------|---|-----------|---------|")
    for dr in dir_results[:15]:
        report.append(f"| {dr['feature']} | {dr['n']:,} | {dr['d']:.3f} | {dr['p']:.4f} |")
    report.append("")

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
    path = REPORT_DIR / "multiday-volume-lift.md"
    path.write_text("\n".join(report), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
