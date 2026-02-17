#!/bin/bash
# Migration script to move E2E test files to correct directory structure
# Usage: chmod +x test/migrate-e2e.sh && ./test/migrate-e2e.sh

set -e

echo "Creating test/e2e directory..."
mkdir -p test/e2e

echo "Moving files to test/e2e/..."
mv test/smoke-helpers.ts test/e2e/helpers.ts
mv test/smoke.test.ts test/e2e/smoke.test.ts

echo "Updating imports in smoke.test.ts..."
sed -i 's/from "\.\/smoke-helpers\.js"/from ".\/helpers.js"/' test/e2e/smoke.test.ts

echo "✅ Migration complete!"
echo ""
echo "Files are now in test/e2e/:"
ls -la test/e2e/

echo ""
echo "Run tests with: npx vitest run test/e2e/smoke.test.ts"
