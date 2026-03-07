"""Backtest Benzinga-equivalent data against Holly outcomes.

Tests whether data Benzinga sells ($99/mo) would actually help filter trades:
  1. Short interest (shortPercentOfFloat, shortRatio)
  2. Insider transactions (buys/sells near trade date)
  3. Price target upside/downside
  4. Analyst consensus (recommendation score)
  5. Institutional vs insider ownership
  6. News volume (proxy for Benzinga news feed)

Usage:
    python -m holly_tearsheets.backtest_benzinga_proxies
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
INSIDER_FILE = CATALYST_DIR / "insider_transactions.parquet"
TARGETS_FILE = CATALYST_DIR / "price_targets.parquet"
NEWS_FILE = CATALYST_DIR / "news_volume.parquet"


def bucket_test(df, feature, label, n_buckets=5):
    """Generic bucket analysis: split feature into quantiles, show WR + PnL."""
    valid = df[[feature, "is_winner", "holly_pnl", "trade_id"]].dropna()
    if len(valid) < 100:
        print(f"  {label}: insufficient data ({len(valid)} rows)")
        return None

    nunique = valid[feature].nunique()
    if nunique <= 8:
        grp = valid.groupby(valid[feature])
    else:
        try:
            valid = valid.copy()
            valid["_bucket"] = pd.qcut(valid[feature], q=n_buckets, duplicates="drop")
            grp = valid.groupby("_bucket")
        except Exception:
            print(f"  {label}: could not bucket")
            return None

    result = grp.agg(
        trades=("trade_id", "count"),
        win_rate=("is_winner", "mean"),
        avg_pnl=("holly_pnl", "mean"),
        total_pnl=("holly_pnl", "sum"),
    )

    wr_spread = result["win_rate"].max() - result["win_rate"].min()
    pnl_spread = result["avg_pnl"].max() - result["avg_pnl"].min()

    # Correlation
    corr, p = stats.pointbiserialr(valid["is_winner"], valid[feature])

    print(f"\n  {label}")
    print(f"  Coverage: {len(valid):,} trades | Corr w/ win: {corr:.4f} (p={p:.2e})")
    print(f"  WR spread: {wr_spread:.1%} | PnL spread: ${pnl_spread:,.0f}")
    print(f"  {'Bucket':<25} {'Trades':>7} {'WR':>7} {'Avg PnL':>10} {'Total PnL':>14}")
    print(f"  {'-'*65}")
    for bucket, row in result.iterrows():
        print(
            f"  {str(bucket):<25} {row['trades']:>7,.0f} "
            f"{row['win_rate']:>6.1%} ${row['avg_pnl']:>9,.0f} "
            f"${row['total_pnl']:>13,.0f}"
        )

    return {
        "feature": label,
        "coverage": len(valid),
        "corr": corr,
        "p_value": p,
        "wr_spread": wr_spread,
        "pnl_spread": pnl_spread,
        "significant": p < 0.05,
    }


def filter_test(df, name, mask):
    """Test a binary filter."""
    kept = df[mask]
    dropped = df[~mask]
    if len(kept) < 50 or len(dropped) < 50:
        return None

    baseline_wr = df["is_winner"].mean()
    baseline_avg = df["holly_pnl"].mean()

    return {
        "filter": name,
        "kept": len(kept),
        "pct": len(kept) / len(df),
        "kept_wr": kept["is_winner"].mean(),
        "wr_lift": kept["is_winner"].mean() - baseline_wr,
        "kept_avg": kept["holly_pnl"].mean(),
        "avg_lift": kept["holly_pnl"].mean() - baseline_avg,
        "dropped_wr": dropped["is_winner"].mean(),
        "dropped_avg": dropped["holly_pnl"].mean(),
    }


def main():
    print("=" * 70)
    print("BENZINGA-PROXY DATA BACKTEST")
    print("Testing: Would Benzinga's $99/mo data help filter Holly trades?")
    print("=" * 70)

    # Load Holly trades
    df = load_holly_data(validate=False)
    df["trade_date"] = pd.to_datetime(df["trade_date"])
    baseline_wr = df["is_winner"].mean()
    baseline_avg = df["holly_pnl"].mean()
    print(f"\nBaseline: {len(df):,} trades | WR={baseline_wr:.1%} | Avg=${baseline_avg:,.0f}")

    # Load data files
    targets = pd.read_parquet(TARGETS_FILE)
    insider = pd.read_parquet(INSIDER_FILE)
    news = pd.read_parquet(NEWS_FILE)

    print(f"\nData loaded:")
    print(f"  Price targets/info: {len(targets)} symbols")
    print(f"  Insider transactions: {len(insider):,} rows, {insider['symbol'].nunique()} symbols")
    print(f"  News volume: {len(news)} symbols")

    all_results = []

    # ══════════════════════════════════════════════════════════════
    # 1. SHORT INTEREST (Benzinga key offering)
    # ══════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("1. SHORT INTEREST (Benzinga: real-time short interest data)")
    print(f"{'='*70}")

    # Join short interest to trades (static snapshot — proxy for historical)
    si_cols = ["symbol", "shortPercentOfFloat", "shortRatio"]
    si_data = targets[si_cols].dropna(subset=["shortPercentOfFloat"])
    matched = df.merge(si_data, on="symbol", how="left")

    r = bucket_test(matched, "shortPercentOfFloat", "Short % of Float")
    if r:
        all_results.append(r)

    r = bucket_test(matched, "shortRatio", "Short Ratio (days to cover)")
    if r:
        all_results.append(r)

    # ══════════════════════════════════════════════════════════════
    # 2. PRICE TARGET UPSIDE (Benzinga: analyst price targets)
    # ══════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("2. ANALYST PRICE TARGETS (Benzinga: real-time PT changes)")
    print(f"{'='*70}")

    pt_cols = ["symbol", "pt_upside_pct", "numberOfAnalystOpinions",
               "recommendationMean"]
    pt_data = targets[pt_cols].dropna(subset=["pt_upside_pct"])
    matched_pt = df.merge(pt_data, on="symbol", how="left")

    r = bucket_test(matched_pt, "pt_upside_pct", "Price Target Upside %")
    if r:
        all_results.append(r)

    r = bucket_test(matched_pt, "numberOfAnalystOpinions", "# Analyst Opinions")
    if r:
        all_results.append(r)

    r = bucket_test(matched_pt, "recommendationMean",
                    "Recommendation Score (1=Buy, 5=Sell)")
    if r:
        all_results.append(r)

    # ══════════════════════════════════════════════════════════════
    # 3. INSIDER TRANSACTIONS (Benzinga: insider trading feed)
    # ══════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("3. INSIDER TRANSACTIONS (Benzinga: insider trading activity)")
    print(f"{'='*70}")

    # For each trade, count insider buys/sells in prior 30 days
    insider_rows = []
    if "date" in insider.columns or "Date" in insider.columns:
        date_col = "date" if "date" in insider.columns else "Date"
        insider[date_col] = pd.to_datetime(insider[date_col], errors="coerce", utc=True)
        if insider[date_col].dt.tz is not None:
            insider[date_col] = insider[date_col].dt.tz_localize(None)

        # Detect transaction type column
        txn_col = None
        for candidate in ["Transaction", "Text", "transaction", "text"]:
            if candidate in insider.columns:
                txn_col = candidate
                break

        symbols_with_insider = set(insider["symbol"].unique())
        trades_with_insider = df[df["symbol"].isin(symbols_with_insider)]
        print(f"  Trades with insider data: {len(trades_with_insider):,} / {len(df):,}")

        for symbol in trades_with_insider["symbol"].unique():
            sym_trades = trades_with_insider[trades_with_insider["symbol"] == symbol]
            sym_insider = insider[insider["symbol"] == symbol]

            if sym_insider.empty:
                continue

            for _, trade in sym_trades.iterrows():
                td = pd.Timestamp(trade["trade_date"])
                recent = sym_insider[
                    (sym_insider[date_col] >= td - pd.Timedelta(days=30))
                    & (sym_insider[date_col] <= td)
                ]

                n_recent = len(recent)
                has_buy = False
                has_sell = False
                if txn_col and n_recent > 0:
                    txn_text = recent[txn_col].astype(str).str.lower()
                    has_buy = txn_text.str.contains("purchase|buy|acquisition", na=False).any()
                    has_sell = txn_text.str.contains("sale|sell|disposition", na=False).any()

                insider_rows.append({
                    "trade_id": trade["trade_id"],
                    "insider_txn_30d": n_recent,
                    "has_insider_buy": has_buy,
                    "has_insider_sell": has_sell,
                    "has_any_insider": n_recent > 0,
                })

        if insider_rows:
            insider_prox = pd.DataFrame(insider_rows)
            matched_ins = df.merge(insider_prox, on="trade_id", how="left")
            matched_ins["insider_txn_30d"] = matched_ins["insider_txn_30d"].fillna(0)
            matched_ins["has_any_insider"] = matched_ins["has_any_insider"].fillna(False)

            r = bucket_test(matched_ins, "insider_txn_30d",
                           "Insider Transactions (30d before trade)")
            if r:
                all_results.append(r)

            # Has insider activity vs not
            has = matched_ins[matched_ins["has_any_insider"] == True]
            no = matched_ins[matched_ins["has_any_insider"] == False]
            if len(has) >= 50 and len(no) >= 50:
                print(f"\n  Insider activity (30d): "
                      f"{len(has):,} trades WR={has['is_winner'].mean():.1%} "
                      f"avg=${has['holly_pnl'].mean():,.0f}")
                print(f"  No insider activity:    "
                      f"{len(no):,} trades WR={no['is_winner'].mean():.1%} "
                      f"avg=${no['holly_pnl'].mean():,.0f}")

            # Insider buy vs sell
            buys = matched_ins[matched_ins["has_insider_buy"] == True]
            sells = matched_ins[matched_ins["has_insider_sell"] == True]
            if len(buys) >= 20:
                print(f"\n  Insider BUY (30d):  {len(buys):>5} trades "
                      f"WR={buys['is_winner'].mean():.1%} "
                      f"avg=${buys['holly_pnl'].mean():,.0f}")
            if len(sells) >= 20:
                print(f"  Insider SELL (30d): {len(sells):>5} trades "
                      f"WR={sells['is_winner'].mean():.1%} "
                      f"avg=${sells['holly_pnl'].mean():,.0f}")
    else:
        print(f"  Insider columns: {list(insider.columns)}")
        print("  Could not find date column for insider transactions")

    # ══════════════════════════════════════════════════════════════
    # 4. INSTITUTIONAL/INSIDER OWNERSHIP (Benzinga: ownership data)
    # ══════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("4. OWNERSHIP DATA (Benzinga: institutional/insider ownership)")
    print(f"{'='*70}")

    own_cols = ["symbol", "heldPercentInsiders", "heldPercentInstitutions"]
    own_data = targets[own_cols].dropna()
    matched_own = df.merge(own_data, on="symbol", how="left")

    r = bucket_test(matched_own, "heldPercentInsiders", "Insider Ownership %")
    if r:
        all_results.append(r)

    r = bucket_test(matched_own, "heldPercentInstitutions", "Institutional Ownership %")
    if r:
        all_results.append(r)

    # ══════════════════════════════════════════════════════════════
    # 5. NEWS VOLUME (Benzinga: news feed, sentiment)
    # ══════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("5. NEWS VOLUME (Benzinga: timestamped news + sentiment)")
    print(f"{'='*70}")

    matched_news = df.merge(news[["symbol", "news_count"]], on="symbol", how="left")
    r = bucket_test(matched_news, "news_count", "Recent News Count")
    if r:
        all_results.append(r)

    # ══════════════════════════════════════════════════════════════
    # 6. VALUATION / FUNDAMENTALS (Benzinga: fundamental data)
    # ══════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("6. VALUATION METRICS (Benzinga: fundamental data)")
    print(f"{'='*70}")

    val_cols = ["symbol", "beta", "trailingPE", "forwardPE"]
    val_data = targets[val_cols].copy()
    matched_val = df.merge(val_data, on="symbol", how="left")

    r = bucket_test(matched_val, "beta", "Beta")
    if r:
        all_results.append(r)

    r = bucket_test(matched_val, "trailingPE", "Trailing P/E")
    if r:
        all_results.append(r)

    r = bucket_test(matched_val, "forwardPE", "Forward P/E")
    if r:
        all_results.append(r)

    # ══════════════════════════════════════════════════════════════
    # 7. PRACTICAL FILTER TESTS
    # ══════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("PRACTICAL FILTER TESTS")
    print(f"{'='*70}")

    filters = []

    # Short interest filters
    si_merged = df.merge(si_data, on="symbol", how="left")
    if si_merged["shortPercentOfFloat"].notna().sum() > 100:
        filters.append(filter_test(si_merged, "Short % < 10%",
                                   si_merged["shortPercentOfFloat"] < 10))
        filters.append(filter_test(si_merged, "Short % < 5%",
                                   si_merged["shortPercentOfFloat"] < 5))
        filters.append(filter_test(si_merged, "Short % > 10% (high SI)",
                                   si_merged["shortPercentOfFloat"] > 10))
        filters.append(filter_test(si_merged, "Short % > 20% (very high SI)",
                                   si_merged["shortPercentOfFloat"] > 20))

    # Price target filters
    if matched_pt["pt_upside_pct"].notna().sum() > 100:
        filters.append(filter_test(matched_pt, "PT upside > 20%",
                                   matched_pt["pt_upside_pct"] > 20))
        filters.append(filter_test(matched_pt, "PT upside > 0% (above target)",
                                   matched_pt["pt_upside_pct"] > 0))
        filters.append(filter_test(matched_pt, "PT downside (below target)",
                                   matched_pt["pt_upside_pct"] < 0))
        filters.append(filter_test(matched_pt, "Analyst Buy (rec < 2.5)",
                                   matched_pt["recommendationMean"] < 2.5))
        filters.append(filter_test(matched_pt, "Analyst Hold+ (rec > 2.5)",
                                   matched_pt["recommendationMean"] > 2.5))
        filters.append(filter_test(matched_pt, ">5 analysts covering",
                                   matched_pt["numberOfAnalystOpinions"] > 5))

    # Ownership filters
    if matched_own["heldPercentInstitutions"].notna().sum() > 100:
        filters.append(filter_test(matched_own, "Inst. ownership > 70%",
                                   matched_own["heldPercentInstitutions"] > 0.70))
        filters.append(filter_test(matched_own, "Inst. ownership > 80%",
                                   matched_own["heldPercentInstitutions"] > 0.80))
        filters.append(filter_test(matched_own, "Insider ownership > 5%",
                                   matched_own["heldPercentInsiders"] > 0.05))

    # Insider activity + direction combos
    if insider_rows:
        filters.append(filter_test(matched_ins, "Has insider buy (30d) + Long",
                                   (matched_ins["has_insider_buy"] == True) &
                                   (matched_ins["direction"] == "Long")))
        filters.append(filter_test(matched_ins, "No insider sell (30d)",
                                   matched_ins["has_insider_sell"] != True))

    # Beta filters
    if matched_val["beta"].notna().sum() > 100:
        filters.append(filter_test(matched_val, "Beta < 1.5",
                                   matched_val["beta"] < 1.5))
        filters.append(filter_test(matched_val, "Beta > 1.0 (high beta)",
                                   matched_val["beta"] > 1.0))

    # News volume
    if matched_news["news_count"].notna().sum() > 100:
        filters.append(filter_test(matched_news, "Has recent news (>0)",
                                   matched_news["news_count"] > 0))
        filters.append(filter_test(matched_news, "High news volume (>5)",
                                   matched_news["news_count"] > 5))

    filters = [f for f in filters if f is not None]
    filters = sorted(filters, key=lambda x: x["wr_lift"], reverse=True)

    print(f"\n  {'Filter':<35} {'Kept':>6} {'Pct':>5} {'WR':>6} {'dWR':>7} {'Avg PnL':>10} {'dAvg':>10} {'Drop WR':>8}")
    print("  " + "-" * 90)
    for f in filters:
        print(
            f"  {f['filter']:<35} {f['kept']:>6,} {f['pct']:>4.0%} "
            f"{f['kept_wr']:>5.1%} {f['wr_lift']:>+6.1%} "
            f"${f['kept_avg']:>9,.0f} ${f['avg_lift']:>+9,.0f} "
            f"{f['dropped_wr']:>7.1%}"
        )

    # ══════════════════════════════════════════════════════════════
    # SYNTHESIS
    # ══════════════════════════════════════════════════════════════
    print(f"\n{'='*70}")
    print("SYNTHESIS: Is $99/mo Benzinga data worth it for Holly filtering?")
    print(f"{'='*70}")

    if all_results:
        results_df = pd.DataFrame(all_results)
        sig = results_df[results_df["significant"]]
        not_sig = results_df[~results_df["significant"]]

        print(f"\n  Total features tested: {len(results_df)}")
        print(f"  Statistically significant (p<0.05): {len(sig)}")
        print(f"  Not significant: {len(not_sig)}")

        if not sig.empty:
            print(f"\n  Significant features:")
            for _, r in sig.iterrows():
                print(f"    {r['feature']:<35} corr={r['corr']:+.4f}  "
                      f"WR spread={r['wr_spread']:.1%}  "
                      f"PnL spread=${r['pnl_spread']:,.0f}")

        if not not_sig.empty:
            print(f"\n  NOT significant (p>=0.05) -- NO EDGE:")
            for _, r in not_sig.iterrows():
                print(f"    {r['feature']:<35} corr={r['corr']:+.4f}  p={r['p_value']:.3f}")

    # Compare to what we know works
    print(f"\n  COMPARISON TO PROVEN FILTERS (from feature_importance.py):")
    print(f"  {'Feature':<35} {'Source':>15} {'Corr':>8} {'Cost':>10}")
    print(f"  {'-'*70}")
    print(f"  {'sector_win_rate':<35} {'Holly CSV':>15} {'0.2180':>8} {'FREE':>10}")
    print(f"  {'strat_win_rate':<35} {'Holly CSV':>15} {'0.1433':>8} {'FREE':>10}")
    print(f"  {'prob_bayesian_wr':<35} {'Holly CSV':>15} {'0.1355':>8} {'FREE':>10}")
    print(f"  {'market_cap':<35} {'Holly CSV':>15} {'0.0515':>8} {'FREE':>10}")
    print(f"  {'is_long':<35} {'Holly CSV':>15} {'0.0343':>8} {'FREE':>10}")

    if not sig.empty:
        for _, r in sig.iterrows():
            print(f"  {r['feature']:<35} {'Benzinga proxy':>15} {r['corr']:>+7.4f} {'$99/mo':>10}")


if __name__ == "__main__":
    main()
