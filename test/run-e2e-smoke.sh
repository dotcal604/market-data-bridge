#!/bin/bash
# Quick start script for E2E smoke tests
# Usage: ./test/run-e2e-smoke.sh

set -e

echo "🚀 E2E Smoke Test Quick Start"
echo ""

# Check if migration is needed
if [ ! -d "test/e2e" ]; then
  echo "📁 Creating test/e2e directory structure..."
  chmod +x test/migrate-e2e.sh
  ./test/migrate-e2e.sh
  echo ""
fi

# Check if backend is built
if [ ! -d "build" ]; then
  echo "🔨 Building backend..."
  npm run build
  echo ""
fi

# Run smoke tests
echo "🧪 Running E2E smoke tests..."
npx vitest run test/e2e/smoke.test.ts

# Check for hanging processes
echo ""
echo "🔍 Checking for hanging processes..."
HANGING=$(ps aux | grep "[n]ode.*build/index.js" || true)
if [ -n "$HANGING" ]; then
  echo "⚠️  Warning: Found hanging node processes:"
  echo "$HANGING"
  echo ""
  echo "Cleaning up..."
  ps aux | grep "[n]ode.*build/index.js" | awk '{print $2}' | xargs -r kill -9
else
  echo "✅ No hanging processes found"
fi

echo ""
echo "✨ E2E smoke tests complete!"
