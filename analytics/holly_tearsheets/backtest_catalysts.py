"""Backtest earnings proximity and analyst action filters against Holly outcomes."""

import sys
import warnings

import numpy as np
import pandas as pd

sys.path.insert(0, ".")
warnings.filterwarnings("ignore")

from holly_tearsheets.data_loader import load_holly_data

EARNINGS_FILE = "holly_tearsheets/output/catalysts/earnings_dates.parquet"
ANALYST_FILE = "holly_tearsheets/output/catalysts/analyst_actions.parquet"


def main():
    df = load_holly_data(validate=False)

    earnings = pd.read_parquet(EARNINGS_FILE)
    analyst = pd.read_parquet(ANALYST_FILE)

    print(f"Earnings: {len(earnings):,} rows, {earnings['symbol'].nunique()} symbols")
    print(f"Analyst:  {len(analyst):,} rows, {analyst['symbol'].nunique()} symbols")

    # Filter to symbols with catalyst data
    catalyst_symbols = set(earnings["symbol"].unique())
    matched = df[df["symbol"].isin(catalyst_symbols)].copy()
    print(f"\nHolly trades with catalyst coverage: {len(matched):,} / {len(df):,} ({len(matched)/len(df):.0%})")

    # ── Earnings proximity ─────────────────────────────────────────
    print(f"\n{'='*70}")
    print("EARNINGS PROXIMITY ANALYSIS")
    print(f"{'='*70}")

    proximity_rows = []
    for symbol in matched["symbol"].unique():
        sym_trades = matched[matched["symbol"] == symbol]
        sym_earnings = earnings[earnings["symbol"] == symbol]["earnings_date"].values

        if len(sym_earnings) == 0:
            continue

        for _, trade in sym_trades.iterrows():
            td = pd.Timestamp(trade["trade_date"])
            diffs = (pd.to_datetime(sym_earnings) - td).total_seconds() / 86400

            future = diffs[diffs >= 0]
            past = diffs[diffs < 0]

            days_to_next = float(future.min()) if len(future) > 0 else np.nan
            days_since_last = float(abs(past.max())) if len(past) > 0 else np.nan
            days_nearest = min(
                abs(days_to_next) if not np.isnan(days_to_next) else 999,
                abs(days_since_last) if not np.isnan(days_since_last) else 999,
            )

            proximity_rows.append({
                "trade_id": trade["trade_id"],
                "days_to_next_earnings": round(days_to_next, 1),
                "days_since_last_earnings": round(days_since_last, 1),
                "days_nearest_earnings": round(days_nearest, 1),
            })

    proximity = pd.DataFrame(proximity_rows)
    matched = matched.merge(proximity, on="trade_id", how="left")
    print(f"Computed earnings proximity for {len(proximity):,} trades")

    # Bucket
    def prox_bucket(days):
        if pd.isna(days):
            return "unknown"
        if days <= 1:
            return "0-1d"
        if days <= 3:
            return "2-3d"
        if days <= 7:
            return "4-7d"
        if days <= 14:
            return "8-14d"
        if days <= 30:
            return "15-30d"
        return "30+d"

    matched["earnings_proximity"] = matched["days_nearest_earnings"].apply(prox_bucket)

    prox_stats = matched.groupby("earnings_proximity").agg(
        trades=("trade_id", "count"),
        win_rate=("is_winner", "mean"),
        avg_pnl=("holly_pnl", "mean"),
        total_pnl=("holly_pnl", "sum"),
        median_pnl=("holly_pnl", "median"),
        avg_mfe=("mfe", "mean"),
        avg_mae=("mae", "mean"),
    )

    # Sort by bucket order
    order = ["0-1d", "2-3d", "4-7d", "8-14d", "15-30d", "30+d", "unknown"]
    prox_stats = prox_stats.reindex([b for b in order if b in prox_stats.index])

    header = f"{'Proximity':<12} {'Trades':>7} {'WR':>7} {'Avg PnL':>10} {'Total PnL':>14} {'Med PnL':>10} {'MFE':>6} {'MAE':>7}"
    print(f"\n{header}")
    print("-" * len(header))
    for bucket, r in prox_stats.iterrows():
        print(
            f"{bucket:<12} {r['trades']:>7,} {r['win_rate']:>6.1%} "
            f"${r['avg_pnl']:>9,.0f} ${r['total_pnl']:>13,.0f} "
            f"${r['median_pnl']:>9,.0f} {r['avg_mfe']:>6.1f} {r['avg_mae']:>7.1f}"
        )

    # Same-day vs rest
    same_day = matched[matched["days_nearest_earnings"] <= 1]
    not_same = matched[matched["days_nearest_earnings"] > 1]
    print(f"\n--- EARNINGS DAY (0-1d) vs REST ---")
    print(f"Earnings day:  {len(same_day):>5} trades  WR={same_day['is_winner'].mean():.1%}  avg=${same_day['holly_pnl'].mean():,.0f}  total=${same_day['holly_pnl'].sum():,.0f}")
    print(f"Not earnings:  {len(not_same):>5} trades  WR={not_same['is_winner'].mean():.1%}  avg=${not_same['holly_pnl'].mean():,.0f}  total=${not_same['holly_pnl'].sum():,.0f}")

    # Direction breakdown for earnings day
    print(f"\n--- EARNINGS DAY × DIRECTION ---")
    for direction in ["Long", "Short"]:
        d_earn = same_day[same_day["direction"] == direction]
        d_not = not_same[not_same["direction"] == direction]
        if len(d_earn) >= 5:
            print(
                f"{direction} on earnings day:  {len(d_earn):>4} trades  "
                f"WR={d_earn['is_winner'].mean():.1%}  "
                f"avg=${d_earn['holly_pnl'].mean():,.0f}"
            )
            print(
                f"{direction} not earnings:     {len(d_not):>4} trades  "
                f"WR={d_not['is_winner'].mean():.1%}  "
                f"avg=${d_not['holly_pnl'].mean():,.0f}"
            )

    # ── Analyst action analysis ────────────────────────────────────
    print(f"\n{'='*70}")
    print("ANALYST ACTION ANALYSIS (within 3 days before trade)")
    print(f"{'='*70}")

    analyst_rows = []
    analyst_sorted = analyst[["symbol", "action_date", "action", "firm"]].copy()

    for symbol in matched["symbol"].unique():
        sym_trades = matched[matched["symbol"] == symbol]
        sym_analyst = analyst_sorted[analyst_sorted["symbol"] == symbol]

        if sym_analyst.empty:
            continue

        for _, trade in sym_trades.iterrows():
            td = pd.Timestamp(trade["trade_date"])
            recent = sym_analyst[
                (sym_analyst["action_date"] >= td - pd.Timedelta(days=3))
                & (sym_analyst["action_date"] <= td)
            ]

            analyst_rows.append({
                "trade_id": trade["trade_id"],
                "recent_actions": len(recent),
                "has_upgrade": any(recent["action"] == "up") if len(recent) else False,
                "has_downgrade": any(recent["action"] == "down") if len(recent) else False,
                "has_init": any(recent["action"] == "init") if len(recent) else False,
                "has_any_action": len(recent) > 0,
            })

    analyst_prox = pd.DataFrame(analyst_rows)
    matched = matched.merge(analyst_prox, on="trade_id", how="left")

    has_action = matched[matched["has_any_action"] == True]
    no_action = matched[matched["has_any_action"] == False]
    print(f"\nWith analyst action:  {len(has_action):>5} trades  WR={has_action['is_winner'].mean():.1%}  avg=${has_action['holly_pnl'].mean():,.0f}  total=${has_action['holly_pnl'].sum():,.0f}")
    print(f"No analyst action:   {len(no_action):>5} trades  WR={no_action['is_winner'].mean():.1%}  avg=${no_action['holly_pnl'].mean():,.0f}  total=${no_action['holly_pnl'].sum():,.0f}")

    # Upgrades vs downgrades
    has_up = matched[matched["has_upgrade"] == True]
    has_down = matched[matched["has_downgrade"] == True]
    if len(has_up) >= 5:
        print(f"\nRecent upgrade:    {len(has_up):>4} trades  WR={has_up['is_winner'].mean():.1%}  avg=${has_up['holly_pnl'].mean():,.0f}")
    if len(has_down) >= 5:
        print(f"Recent downgrade:  {len(has_down):>4} trades  WR={has_down['is_winner'].mean():.1%}  avg=${has_down['holly_pnl'].mean():,.0f}")

    # Direction × analyst
    print(f"\n--- DIRECTION x ANALYST ACTION ---")
    for direction in ["Long", "Short"]:
        d_action = has_action[has_action["direction"] == direction]
        d_no = no_action[no_action["direction"] == direction]
        if len(d_action) >= 5:
            print(
                f"{direction} + action:     {len(d_action):>4} trades  "
                f"WR={d_action['is_winner'].mean():.1%}  "
                f"avg=${d_action['holly_pnl'].mean():,.0f}"
            )
            print(
                f"{direction} no action:    {len(d_no):>4} trades  "
                f"WR={d_no['is_winner'].mean():.1%}  "
                f"avg=${d_no['holly_pnl'].mean():,.0f}"
            )

    # ── Combined filter test ───────────────────────────────────────
    print(f"\n{'='*70}")
    print("COMBINED FILTER: Skip trades on earnings day with no analyst catalyst")
    print(f"{'='*70}")

    # What if we skip earnings-day trades that DON'T have a confirming analyst action?
    risky = matched[(matched["days_nearest_earnings"] <= 1) & (matched["has_any_action"] == False)]
    safe = matched[~matched.index.isin(risky.index)]
    print(f"\nFiltered out:  {len(risky):>5} trades  WR={risky['is_winner'].mean():.1%}  avg=${risky['holly_pnl'].mean():,.0f}  total=${risky['holly_pnl'].sum():,.0f}")
    print(f"Kept:          {len(safe):>5} trades  WR={safe['is_winner'].mean():.1%}  avg=${safe['holly_pnl'].mean():,.0f}  total=${safe['holly_pnl'].sum():,.0f}")
    print(f"Original:      {len(matched):>5} trades  WR={matched['is_winner'].mean():.1%}  avg=${matched['holly_pnl'].mean():,.0f}  total=${matched['holly_pnl'].sum():,.0f}")

    pnl_diff = safe["holly_pnl"].sum() - matched["holly_pnl"].sum()
    wr_diff = safe["is_winner"].mean() - matched["is_winner"].mean()
    print(f"\nFilter impact: PnL {'+' if pnl_diff >= 0 else ''}${pnl_diff:,.0f}  WR {'+' if wr_diff >= 0 else ''}{wr_diff:.1%}")


if __name__ == "__main__":
    main()
