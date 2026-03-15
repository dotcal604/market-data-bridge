# Final Merge Plan — Docs Automation

## Patch Order

### Step 1: Cherry-pick Branch B commit onto a clean branch

```bash
git checkout main
git checkout -b docs-automation-mvp
git cherry-pick 5c5427d   # the single commit from docs-automation-mvp
```

### Step 2: Apply required fixes (before merge)

#### Fix 2a: Add setup-node and configure-pages to workflow

In `.github/workflows/docs.yml`, update the `build` job:

```yaml
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Generate docs site
        run: node scripts/generate-docs.mjs

      - name: Configure GitHub Pages
        uses: actions/configure-pages@v5

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs-site
```

#### Fix 2b: Add output directory cleanup to script

In `scripts/generate-docs.mjs`, in the `main()` function, before `ensureDir(OUT)`:

```javascript
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
// ...
function main() {
  console.log("Generating docs site...\n");

  // Clean previous output
  if (existsSync(OUT)) {
    rmSync(OUT, { recursive: true, force: true });
  }

  // Clean and create output directory
  ensureDir(OUT);
```

#### Fix 2c: Extract base path to a const

At top of `scripts/generate-docs.mjs`, after the `OUT` const:

```javascript
const BASE_PATH = "/market-data-bridge";
```

Then replace all 26 occurrences of `/market-data-bridge` with template literal `${BASE_PATH}`.

#### Fix 2d: Remove DOCS_AUTOMATION_PLAN.md

```bash
git rm docs/DOCS_AUTOMATION_PLAN.md
```

The planning rationale is preserved in this audit's judgment docs. It does not need to live in `docs/`.

### Step 3: Verify

```bash
node scripts/generate-docs.mjs
# Expect: 152 tools, 6 guide pages, clean output
ls docs-site/
# Expect: index.html, style.css, openapi.json, .nojekyll, api/, mcp/, guide/, architecture/
```

### Step 4: Commit and merge

```bash
git add -A
git commit -m "feat(docs): add zero-dependency docs automation with GitHub Pages deployment

Generates a static docs site from source:
- MCP tool reference (152 tools) extracted from src/mcp/server.ts
- REST API docs via Redoc from openapi-chatgpt.json
- Guide pages from docs/01-06*.md
- Architecture diagram embed from architecture-diagram.html
- GitHub Actions workflow deploys to GitHub Pages on push to main

Zero npm dependencies. Build completes in seconds."
```

---

## File-by-File Action List

| File | Action | Detail |
|------|--------|--------|
| `scripts/generate-docs.mjs` | merge with 2 fixes | Add output cleanup (rmSync); extract BASE_PATH const |
| `.github/workflows/docs.yml` | merge with 2 fixes | Add setup-node@v4; add configure-pages@v5 |
| `.gitignore` | merge as-is | 3 lines adding docs-site/ to ignore |
| `package.json` | merge as-is | 1 line adding docs:generate script |
| `docs/DOCS_AUTOMATION_PLAN.md` | remove | Planning doc; not operational |

---

## Post-Merge Follow-Ups (Priority Order)

1. **Enable GitHub Pages** in repo settings (Settings → Pages → Source: GitHub Actions). Required for the workflow to deploy.
2. **Pin Redoc CDN version**: Replace `https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js` with a pinned version URL.
3. **Replace hardcoded "135"** on landing page with dynamic count from OpenAPI spec (read + count discriminator mappings).
4. **Add MCP extraction smoke test**: A simple CI check that asserts tool count >= 150 to catch silent extraction degradation.
5. **Evaluate guide page quality**: Review the generated guide HTML for rendering issues (70 blockquotes and 37 nested list items are imperfectly handled). If quality is unacceptable, either replace the custom markdown parser with `marked` or remove guide generation.
6. **Consider integrating Mintlify MDX content**: 28 files in `docs/mcp/`, `docs/workflows/`, `docs/frontend/` are not included. These have hand-written workflow guides of real value.

---

## Ownership / Maintenance Notes

- **Single script, single workflow.** No framework to maintain. No dependencies to update.
- **What triggers a docs rebuild:** Changes to `src/mcp/server.ts`, `openapi-chatgpt.json`, `docs/**`, `architecture-diagram.html`, or the script/workflow itself.
- **What can break silently:** If `server.ts` tool registration format changes (different quote style, extracted descriptions, helper functions), the regex extraction will miss tools without failing. The tool count on the landing page (currently dynamic for MCP, hardcoded for REST) is the canary.
- **What to watch:** Guide page rendering quality. The custom markdown parser handles ~90% of the markdown features used in the guides but drops blockquotes and flattens nested lists.
- **If the custom parser becomes a problem:** Replace `mdToHtml()` with `import { marked } from 'marked'` — marked is 2KB with zero transitive deps. This breaks the "zero dependency" constraint but solves the parser problem permanently.
