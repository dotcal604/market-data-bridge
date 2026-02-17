#!/bin/bash
set -euo pipefail

# ══════════════════════════════════════════════════════════════════════
# Market Bridge — Zero-Downtime Deploy Script
#
# Usage:   ./scripts/deploy.sh
# Purpose: Build, test, reload pm2, verify readiness
# ══════════════════════════════════════════════════════════════════════

PORT="${PORT:-3000}"
BASE_URL="http://localhost:${PORT}"
PM2_NAME="${PM2_NAME:-market-bridge}"
READY_TIMEOUT=30  # seconds to wait for readiness

echo "══════════════════════════════════════════════"
echo "  Market Bridge Deploy"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════════════"

# ── Step 1: Pre-flight ──────────────────────────────────────────────
echo ""
echo "▶ Step 1: Pre-flight checks..."

# TypeScript compile
echo "  • TypeScript typecheck..."
npx tsc --noEmit || { echo "❌ TypeScript errors — aborting deploy"; exit 1; }

# Run tests
echo "  • Running tests..."
npx vitest run --reporter=dot 2>&1 | tail -5 || { echo "❌ Tests failed — aborting deploy"; exit 1; }

echo "  • Build..."
npm run build || { echo "❌ Build failed — aborting deploy"; exit 1; }

echo "  ✅ Pre-flight passed"

# ── Step 2: Check current instance health ───────────────────────────
echo ""
echo "▶ Step 2: Current instance health check..."

if curl -sf "${BASE_URL}/health" > /dev/null 2>&1; then
  echo "  ✅ Current instance is healthy"
  # Capture current state for rollback comparison
  PREV_HEALTH=$(curl -sf "${BASE_URL}/health" 2>/dev/null || echo "unavailable")
  echo "  • Pre-deploy state: $(echo "$PREV_HEALTH" | head -c 200)"
else
  echo "  ⚠️  Current instance is down or unhealthy (deploying anyway)"
fi

# ── Step 3: Graceful reload ─────────────────────────────────────────
echo ""
echo "▶ Step 3: Graceful pm2 reload..."

pm2 reload "$PM2_NAME" --update-env 2>&1 || {
  echo "❌ pm2 reload failed"
  echo "  Trying pm2 restart as fallback..."
  pm2 restart "$PM2_NAME" --update-env 2>&1 || { echo "❌ pm2 restart also failed"; exit 1; }
}

echo "  ✅ pm2 reload triggered"

# ── Step 4: Wait for readiness ──────────────────────────────────────
echo ""
echo "▶ Step 4: Waiting for readiness (${READY_TIMEOUT}s timeout)..."

for i in $(seq 1 "$READY_TIMEOUT"); do
  if curl -sf "${BASE_URL}/health/ready" > /dev/null 2>&1; then
    echo ""
    echo "  ✅ Bridge ready after ${i}s"

    # Show post-deploy health
    echo ""
    echo "▶ Post-deploy health:"
    curl -sf "${BASE_URL}/health" 2>/dev/null | python3 -m json.tool 2>/dev/null || curl -sf "${BASE_URL}/health" 2>/dev/null || echo "  (could not fetch health)"

    echo ""
    echo "══════════════════════════════════════════════"
    echo "  ✅ Deploy successful — $(date '+%H:%M:%S')"
    echo "══════════════════════════════════════════════"
    exit 0
  fi
  printf "  ."
  sleep 1
done

# ── Failure path ────────────────────────────────────────────────────
echo ""
echo "❌ Bridge not ready after ${READY_TIMEOUT}s"
echo ""
echo "  Checking health endpoint..."
curl -sf "${BASE_URL}/health" 2>/dev/null || echo "  /health unreachable"
echo ""
echo "  pm2 status:"
pm2 show "$PM2_NAME" 2>/dev/null | head -20 || echo "  pm2 show failed"
echo ""
echo "  Recent logs:"
pm2 logs "$PM2_NAME" --nostream --lines 20 2>/dev/null || echo "  (no logs available)"
echo ""
echo "══════════════════════════════════════════════"
echo "  ❌ Deploy FAILED — investigate above"
echo "══════════════════════════════════════════════"
exit 1
