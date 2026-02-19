#!/bin/bash

echo "Running TypeScript compilation check..."
echo ""

npx tsc --noEmit

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ TypeScript compilation check passed!"
  exit 0
else
  echo ""
  echo "❌ TypeScript compilation check failed!"
  exit 1
fi
