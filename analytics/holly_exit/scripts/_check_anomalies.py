"""Quick check: do Bull Trap / Count De Monet anomalies still exist?"""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from engine.data_loader import get_db

db = get_db()

r = db.execute("""
  SELECT strategy, direction, COUNT(*) as cnt,
         SUM(holly_pnl) as total_pnl, AVG(holly_pnl) as avg_pnl
  FROM trades
  WHERE strategy IN ('Bull Trap', 'Count De Monet')
  GROUP BY strategy, direction
  ORDER BY strategy, direction
""").fetchdf()
print("=== Bull Trap + Count De Monet in DuckDB ===")
print(r.to_string())
print()

params_path = Path(__file__).parent.parent / "output" / "optimal_exit_params.json"
with open(params_path) as f:
    params = json.load(f)
for s in ['Bull Trap', 'Count De Monet']:
    if s in params.get('strategies', {}):
        p = params['strategies'][s]
        print(f"{s}: dir={p['direction']}, trades={p['trade_count']}, "
              f"baseline=${p['baseline']['total_pnl']:,.0f}, "
              f"optimized=${p['optimized']['total_pnl']:,.0f}")
    else:
        print(f"{s}: NOT in optimal_exit_params.json")

# Top 5 by total_pnl (looking for anomalies)
print("\n=== Top 5 strategies by total_pnl (anomaly check) ===")
r2 = db.execute("""
  SELECT strategy, direction, COUNT(*) as cnt, SUM(holly_pnl) as total_pnl
  FROM trades GROUP BY strategy, direction ORDER BY total_pnl DESC LIMIT 5
""").fetchdf()
print(r2.to_string())

print("\n=== Bottom 5 strategies by total_pnl ===")
r3 = db.execute("""
  SELECT strategy, direction, COUNT(*) as cnt, SUM(holly_pnl) as total_pnl
  FROM trades GROUP BY strategy, direction ORDER BY total_pnl ASC LIMIT 5
""").fetchdf()
print(r3.to_string())

db.close()
