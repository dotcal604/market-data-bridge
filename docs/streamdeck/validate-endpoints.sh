#!/bin/bash
# Stream Deck Profile — Endpoint Validator
# Checks that all REST endpoints used by the Stream Deck profile are reachable.
# Run with MDB bridge active: bash docs/streamdeck/validate-endpoints.sh

BASE="http://localhost:3000/api"
PASS=0
FAIL=0
TOTAL=0

check() {
  local method="$1"
  local path="$2"
  local label="$3"
  local body="$4"
  TOTAL=$((TOTAL + 1))

  if [ "$method" = "GET" ]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$path" 2>/dev/null)
  elif [ "$method" = "POST" ] && [ -n "$body" ]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$body" "$BASE$path" 2>/dev/null)
  elif [ "$method" = "POST" ]; then
    # Dry-run check only — skip destructive POST without --live flag
    if [ "$LIVE" = "1" ]; then
      status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE$path" 2>/dev/null)
    else
      printf "  %-12s %-40s %s\n" "$method" "$path" "SKIP (use --live for POST/DELETE)"
      return
    fi
  elif [ "$method" = "DELETE" ]; then
    if [ "$LIVE" = "1" ]; then
      status=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE$path" 2>/dev/null)
    else
      printf "  %-12s %-40s %s\n" "$method" "$path" "SKIP (use --live for POST/DELETE)"
      return
    fi
  fi

  if [ "$status" -ge 200 ] && [ "$status" -lt 500 ]; then
    printf "  %-12s %-40s %s\n" "$method" "$path" "OK ($status)"
    PASS=$((PASS + 1))
  else
    printf "  %-12s %-40s %s\n" "$method" "$path" "FAIL ($status)"
    FAIL=$((FAIL + 1))
  fi
}

# Parse flags
LIVE=0
if [ "$1" = "--live" ]; then
  LIVE=1
  echo "WARNING: --live mode will execute POST/DELETE endpoints!"
  echo "Press Ctrl+C within 3 seconds to abort..."
  sleep 3
fi

echo ""
echo "=== Stream Deck Profile — Endpoint Validation ==="
echo "Base URL: $BASE"
echo ""

# Quick connectivity check
echo "--- Connectivity ---"
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/status" 2>/dev/null)
if [ "$status" = "000" ]; then
  echo "  FATAL: Cannot reach $BASE/status — is the bridge running?"
  echo "  Start with: npm start (or start.bat)"
  exit 1
fi
echo "  Bridge reachable: OK ($status)"
echo ""

# GET endpoints (safe, always tested)
echo "--- GET Endpoints (read-only) ---"
check GET "/status"                    "Status"
check GET "/quote/SPY"                 "SPY Quote"
check GET "/quote/QQQ"                 "QQQ Quote"
check GET "/quote/IWM"                 "IWM Quote"
check GET "/account/summary"           "Account Summary"
check GET "/account/positions"         "Positions"
check GET "/account/pnl"               "P&L"
check GET "/account/orders"            "Open Orders"
check GET "/account/orders/completed"  "Completed Orders"
check GET "/account/executions"        "Executions"
check GET "/orders/history"            "Order History"
check GET "/portfolio/exposure"        "Portfolio Exposure"
check GET "/session"                   "Session State"
check GET "/risk/config"               "Risk Config"
check GET "/flatten/config"            "Flatten Config"
check GET "/trending"                  "Trending"
check GET "/indicators"                "Indicators"
check GET "/collab/messages"           "Collab Messages"
echo ""

# POST endpoints (destructive — skipped unless --live)
echo "--- POST/DELETE Endpoints (action) ---"
check POST   "/session/lock"           "Session Lock"
check POST   "/session/unlock"         "Session Unlock"
check POST   "/session/reset"          "Session Reset"
check POST   "/positions/flatten"      "Flatten Positions"
check DELETE "/orders/all"             "Cancel All Orders"
check POST   "/screener/run"           "Run Screener" '{"screenerId":"day_gainers"}'
echo ""

# Summary
echo "=== Results ==="
echo "  Passed: $PASS / $TOTAL"
if [ "$FAIL" -gt 0 ]; then
  echo "  Failed: $FAIL"
  exit 1
else
  echo "  All reachable endpoints passed!"
fi
