"""Quick comparison report: Holly alerts vs your actual IBKR trades."""
import pandas as pd
import sys
from pathlib import Path

REPORT_DIR = Path(__file__).parent.parent / "output" / "reports" / "trade_mapping"

def main():
    m = pd.read_csv(REPORT_DIR / "ibkr_holly_matched.csv")
    matched = m[m["category"] == "matched"].copy()
    matched["ibkr_entry_time"] = pd.to_datetime(matched["ibkr_entry_time"])
    matched["ibkr_exit_time"] = pd.to_datetime(matched["ibkr_exit_time"])
    matched["holly_entry_time"] = pd.to_datetime(matched["holly_entry_time"])
    matched["holly_exit_time"] = pd.to_datetime(matched["holly_exit_time"])

    matched = matched.sort_values("ibkr_entry_time").reset_index(drop=True)

    print("=" * 110)
    print("  YOUR TRADES vs HOLLY ALERTS  (side-by-side)")
    print(f"  {len(matched)} matched trades where Holly fired an alert for the same ticker that day")
    print("=" * 110)
    print()

    total_you = 0
    total_holly = 0
    wins_you = 0
    wins_holly = 0

    for _, r in matched.iterrows():
        sym = r["symbol"]
        d = r["direction"][0]
        strat = r["strategy"]
        holly_et = r["holly_entry_time"].strftime("%m/%d %H:%M") if pd.notna(r["holly_entry_time"]) else "?"
        you_et = r["ibkr_entry_time"].strftime("%m/%d %H:%M") if pd.notna(r["ibkr_entry_time"]) else "?"
        delay = r["time_delta_sec"] / 60 if pd.notna(r["time_delta_sec"]) else 0

        h_ep = r["holly_entry_price"]
        y_ep = r["ibkr_entry_price"]
        slip = r["entry_slippage_%"]
        slip_s = f"{slip:+.2f}%" if pd.notna(slip) else ""

        h_stop = f"${r['holly_stop_price']:.2f}" if pd.notna(r["holly_stop_price"]) else "n/a"
        h_tgt = f"${r['holly_target_price']:.2f}" if pd.notna(r.get("holly_target_price")) else ""

        h_xt = r["holly_exit_time"].strftime("%H:%M") if pd.notna(r["holly_exit_time"]) else "?"
        y_xt = r["ibkr_exit_time"].strftime("%H:%M") if pd.notna(r["ibkr_exit_time"]) else "OPEN"

        y_hold = f"{r['ibkr_hold_minutes']:.0f}m" if pd.notna(r["ibkr_hold_minutes"]) else ""
        h_hold = ""
        if pd.notna(r["holly_exit_time"]) and pd.notna(r["holly_entry_time"]):
            hm = (r["holly_exit_time"] - r["holly_entry_time"]).total_seconds() / 60
            h_hold = f"{hm:.0f}m"

        y_pnl = r["ibkr_net_pnl"] if pd.notna(r["ibkr_net_pnl"]) else 0
        h_pnl = r["holly_pnl"] if pd.notna(r["holly_pnl"]) else 0
        diff = r["pnl_diff"] if pd.notna(r["pnl_diff"]) else 0

        total_you += y_pnl
        total_holly += h_pnl
        if y_pnl > 0: wins_you += 1
        if h_pnl > 0: wins_holly += 1

        y_sh = int(r["ibkr_shares"]) if pd.notna(r["ibkr_shares"]) else "?"
        h_sh = int(r["holly_shares"]) if pd.notna(r["holly_shares"]) else "?"

        # Verdict
        if y_pnl > 0 and h_pnl > 0:
            verdict = "BOTH WIN"
        elif y_pnl <= 0 and h_pnl <= 0:
            verdict = "BOTH LOSE"
        elif y_pnl > 0:
            verdict = "YOU WIN, HOLLY LOSES"
        else:
            verdict = "HOLLY WINS, YOU LOSE"

        # Exit comparison
        exit_note = ""
        if pd.notna(r["ibkr_exit_time"]) and pd.notna(r["holly_exit_time"]):
            exit_delta_min = (r["ibkr_exit_time"] - r["holly_exit_time"]).total_seconds() / 60
            if exit_delta_min < -5:
                exit_note = f"  (you exited {abs(exit_delta_min):.0f}m BEFORE Holly)"
            elif exit_delta_min > 5:
                exit_note = f"  (you exited {exit_delta_min:.0f}m AFTER Holly)"
            else:
                exit_note = "  (exited ~same time)"

        print(f"  {you_et}  {sym:6s} {d} | {strat}")
        print(f"    Holly:  ${h_ep:.2f} -> stop {h_stop} -> exit ${r['holly_exit_price']:.2f} @ {h_xt}  hold {h_hold}  P&L ${h_pnl:+.2f}  ({h_sh} sh)")
        print(f"    You:    ${y_ep:.2f} (slip {slip_s}, delay {delay:.0f}m) -> exit ${r['ibkr_exit_price']:.2f} @ {y_xt}  hold {y_hold}  P&L ${y_pnl:+.2f}  ({y_sh} sh)")
        print(f"    {verdict} | diff ${diff:+.2f}{exit_note}")
        print()

    print("=" * 110)
    print(f"  TOTALS ({len(matched)} trades)")
    print(f"    You:    ${total_you:+,.2f}  ({wins_you}W / {len(matched)-wins_you}L = {wins_you/len(matched)*100:.1f}% WR)")
    print(f"    Holly:  ${total_holly:+,.2f}  ({wins_holly}W / {len(matched)-wins_holly}L = {wins_holly/len(matched)*100:.1f}% WR)")
    print(f"    Gap:    ${total_you - total_holly:+,.2f}")
    print("=" * 110)


if __name__ == "__main__":
    main()
