# E2E Smoke Test - Package.json Script Additions

To integrate the E2E smoke tests into your npm workflow, add these scripts to `package.json`:

```json
{
  "scripts": {
    "test:e2e": "npm run build && npx vitest run test/e2e/smoke.test.ts",
    "test:e2e:setup": "chmod +x test/migrate-e2e.sh && ./test/migrate-e2e.sh",
    "test:smoke": "npm run build && npx vitest run test/e2e/smoke.test.ts"
  }
}
```

## Usage

### First Time Setup
```bash
npm run test:e2e:setup  # Creates test/e2e/ structure and moves files
```

### Running Tests
```bash
npm run test:e2e       # Builds and runs E2E smoke tests
npm run test:smoke     # Alias for test:e2e
```

### CI/CD Integration

For GitHub Actions, add this job to `.github/workflows/test.yml`:

```yaml
  e2e-smoke:
    name: E2E Smoke Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Setup E2E test structure
        run: |
          mkdir -p test/e2e
          if [ -f test/smoke-helpers.ts ]; then
            mv test/smoke-helpers.ts test/e2e/helpers.ts
            mv test/smoke.test.ts test/e2e/smoke.test.ts
            sed -i 's/from "\.\/smoke-helpers\.js"/from ".\/helpers.js"/' test/e2e/smoke.test.ts
          fi
      
      - name: Build backend
        run: npm run build
      
      - name: Run E2E smoke tests
        run: npx vitest run test/e2e/smoke.test.ts
        
      - name: Check for hanging processes
        if: always()
        run: |
          HANGING=$(ps aux | grep "[n]ode.*build/index.js" || true)
          if [ -n "$HANGING" ]; then
            echo "Warning: Hanging processes found"
            ps aux | grep "[n]ode.*build/index.js" | awk '{print $2}' | xargs -r kill -9
            exit 1
          fi
```

## Alternative: Quick Start Script

Or use the provided quick-start script:

```bash
chmod +x test/run-e2e-smoke.sh
./test/run-e2e-smoke.sh
```

This script:
- ✅ Runs migration if needed
- ✅ Builds backend if needed
- ✅ Runs smoke tests
- ✅ Checks for hanging processes
- ✅ Cleans up if necessary
