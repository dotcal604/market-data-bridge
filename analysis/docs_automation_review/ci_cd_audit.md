# CI/CD Audit

## Two Workflows Under Review

### Branch A: `automate-docs-generation` — `.github/workflows/generate-docs.yml`

**Trigger:** Push to `main` or manual dispatch. No path filtering.

**Steps:**
1. Checkout
2. `setup-node@v4` with Node 20 + npm cache
3. `npm ci` (root)
4. `cd frontend && npm ci`
5. `cd docs-site && npm ci`
6. `npx puppeteer browsers install chrome`
7. `node scripts/generate-docs.mjs` (runs TypeDoc + Mermaid + Puppeteer + Docusaurus)
8. `configure-pages@v5` + `upload-pages-artifact@v3` + `deploy-pages@v4`

**Issues:**

| Issue | Severity | Detail |
|-------|----------|--------|
| No path filtering | Medium | Rebuilds docs on every push to main, even for unrelated changes. Wastes CI minutes. |
| Frontend install required | High | `cd frontend && npm ci` installs the entire Next.js frontend just to take screenshots. If screenshots fail (likely — Chrome in CI is flaky), this is wasted time. |
| Puppeteer Chrome install | High | `npx puppeteer browsers install chrome` downloads ~300MB Chrome binary. Fragile, slow, and the screenshots have marginal value. |
| Three `npm ci` calls | Medium | Root deps + frontend deps + docs-site deps = significant install time and attack surface. |
| `cancel-in-progress: false` | Minor | If two pushes happen quickly, both deployments run fully. Should be `true` or use path filtering. |
| Permissions correct | OK | `contents: read`, `pages: write`, `id-token: write` are correct for Pages deployment. |
| Concurrency group correct | OK | `group: pages` prevents parallel deployments. |
| Pages deployment pattern | OK | Standard 3-step: configure → upload → deploy. Correct. |

**Verdict: Not merge-safe.** Too heavy, too fragile. The Puppeteer/Chrome dependency will cause random CI failures. The lack of path filtering wastes CI resources. The three-way `npm ci` is overkill.

---

### Branch B: `docs-automation-mvp` — `.github/workflows/docs.yml`

**Trigger:** Push to `main` with path filtering OR manual dispatch.

**Path filters:**
```yaml
paths:
  - "src/mcp/server.ts"
  - "src/rest/agent.ts"
  - "openapi-chatgpt.json"
  - "docs/**"
  - "architecture-diagram.html"
  - "scripts/generate-docs.mjs"
  - ".github/workflows/docs.yml"
```

**Steps:**
1. Checkout
2. `node scripts/generate-docs.mjs`
3. `upload-pages-artifact@v3` (path: `docs-site`)
4. `deploy-pages@v4`

**Issues:**

| Issue | Severity | Detail |
|-------|----------|--------|
| No `setup-node` step | Low | Ubuntu-latest ships Node 18+, which is sufficient. But version is uncontrolled. Add `setup-node@v4` with `node-version: 20` for reproducibility. |
| Path `src/rest/agent.ts` | Trivial | Script doesn't read this file — it reads `openapi-chatgpt.json`. Harmless false trigger. |
| Missing `configure-pages` step | Medium | Branch A includes `configure-pages@v5` before upload. Branch B omits it. This may cause issues on first deployment. Should add it. |
| `cancel-in-progress: true` | OK | Correct — cancels stale deployments. |
| Permissions correct | OK | Same as Branch A — correct for Pages. |
| Two-job separation (build → deploy) | OK | Clean separation with `needs: build` dependency. |
| Zero npm dependencies | Excellent | No `npm ci` needed. Script runs on Node built-ins only. Fast, reliable. |
| Path filtering | Excellent | Only rebuilds when actual source-of-truth files change. |

**Verdict: Merge-safe with minor fixes.**
1. Add `setup-node@v4` for reproducibility.
2. Add `configure-pages@v5` step before upload.
3. Optionally remove `src/rest/agent.ts` from path filter.

---

## Comparative Summary

| Criterion | Branch A | Branch B |
|-----------|----------|----------|
| CI run time (estimated) | 5-10 min (3x npm ci + Chrome download) | 5-15 sec (just Node script) |
| Failure surface | High (Puppeteer, Chrome, Mermaid CLI) | Low (Node built-ins only) |
| Path filtering | None | Yes — correct sources listed |
| Dependencies in CI | ~500MB+ (npm packages + Chrome) | 0 |
| Pages deployment pattern | Correct | Correct (missing configure-pages) |
| Merge safety | No | Yes (with minor fix) |
