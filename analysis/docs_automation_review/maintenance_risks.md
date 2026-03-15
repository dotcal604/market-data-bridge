# Maintenance & Complexity Audit

## Branch A: `automate-docs-generation` (Docusaurus + TypeDoc + Mermaid + Puppeteer)

### Overengineering Assessment: **SEVERE**

This branch adds:
- **Docusaurus 3** (React-based docs framework) — 8 npm dependencies in `docs-site/`
- **TypeDoc + typedoc-plugin-markdown** — generates TypeScript class/function docs
- **@mermaid-js/mermaid-cli** — renders Mermaid diagrams to SVG
- **Puppeteer** — headless Chrome for frontend screenshots
- **19,706-line package-lock.json** committed to the repo
- **4,540 lines added to root package-lock.json**
- **20 new files** across 6 directories
- **25,322 total lines added**

**What this buys you:**
- TypeScript module-level API docs that nobody asked for (not MCP tool docs)
- 4 hand-written Mermaid diagrams that will go stale
- A screenshots page that requires a running frontend + Chrome

**What this costs:**
- A Docusaurus site that needs its own `npm ci` and React build
- Puppeteer Chrome download in CI (~300MB)
- Three separate `npm ci` calls in the workflow
- A `capture-ui.mjs` script (172 lines) that launches the frontend, waits for it, screenshots 14 pages, then shuts down
- Ongoing maintenance of `docs-site/package.json` version updates
- Risk of Docusaurus major version upgrades breaking the build

**Is Docusaurus justified?** No. This repo has ~60K lines of existing guide docs, an OpenAPI spec, and tool registrations in source. The right approach is to extract, transform, and serve that — not add a React framework for a docs site. Docusaurus is justified when you need multi-version docs, i18n, plugin ecosystems, or search. This repo needs none of those.

**Is TypeDoc justified?** No. TypeDoc generates docs for TypeScript modules (classes, interfaces, functions). Users of this MCP server need tool-level reference docs (name, description, parameters), not TypeScript class hierarchies. TypeDoc does not extract `server.tool()` calls. This is solving the wrong problem.

**Is Puppeteer justified?** No. Frontend screenshots captured by Puppeteer require a running Next.js dev server + Chrome. This will fail frequently in CI. Static screenshots added manually would be simpler and more reliable.

**Are Mermaid diagrams justified?** Partially. The Mermaid diagrams are well-written, but they duplicate `architecture-diagram.html` and are hand-maintained. They will go stale unless someone manually updates them when subsystems change.

### Maintenance Traps
1. Docusaurus + React version drift (8 deps to keep current)
2. TypeDoc version compatibility with TypeScript version
3. Puppeteer Chrome binary compatibility with Ubuntu runner
4. Mermaid CLI Node version requirements
5. Three `package.json` files to maintain (root, frontend, docs-site)
6. 19,706-line lockfile committed = noisy diffs on any update

---

## Branch B: `docs-automation-mvp` (Zero-dependency generator)

### Complexity Assessment: **ACCEPTABLE WITH CAVEATS**

This branch adds:
- **1 script** (943 lines, zero npm dependencies)
- **1 workflow** (57 lines)
- **1 planning doc** (156 lines)
- **1 npm script** in package.json
- **3 lines in .gitignore**
- **Total: 1,160 lines added across 5 files**

**What this buys you:**
- MCP tool reference (152 tools) extracted from actual source
- REST API docs via Redoc + existing OpenAPI spec
- 6 guide pages converted from existing markdown
- Architecture diagram embedded from existing HTML
- GitHub Pages deployment
- Zero runtime dependencies

**Maintenance traps identified:**

1. **Regex-based MCP extraction (Moderate risk)**
   The tool extraction scans `src/mcp/server.ts` line-by-line looking for `server.tool(` calls. This works today but is coupled to:
   - Quote style (double quotes only)
   - Code formatting (description on same line as name)
   - Schema definition patterns (top-level `z.*` params only)
   - 50-line scan window for params

   If someone refactors `server.ts` to use helper functions, template literals, or variable-based descriptions, the extraction will silently degrade. **Mitigation**: Add a smoke test that asserts tool count >= 150.

2. **Custom markdown parser (Moderate risk)**
   160 lines of hand-written markdown→HTML. Works for the common subset (headers, tables, code, bold, links, lists) but will produce broken output for:
   - Nested lists (used in several guide pages)
   - Blockquotes
   - Images/screenshots
   - Raw HTML passthrough
   - Footnotes

   This will manifest as subtle rendering bugs in the guide pages that nobody notices until someone reports it. **Mitigation**: Replace with `marked` (2KB, zero transitive deps) or accept the limitations.

3. **Hardcoded base path `/market-data-bridge/` (Low risk)**
   Every URL in every generated page uses this prefix. If the repo is renamed, deployed to a custom domain, or the org changes, all links break. **Mitigation**: Make it a const at the top of the script.

4. **Hardcoded "135" on landing page (Low risk)**
   Landing page card says "135 agent actions" instead of counting from the OpenAPI spec. Will go stale as actions are added. **Mitigation**: Read `openapi-chatgpt.json` and count discriminator mappings.

5. **No stale file cleanup (Low risk)**
   The script creates directories but never removes old files. If a guide page is renamed, the old HTML persists. **Mitigation**: Add `rmSync(OUT, { recursive: true, force: true })` before generation.

6. **CDN dependency for Redoc (Low risk)**
   REST API page loads `https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js` at runtime. If Redoc changes their CDN URL or goes down, API docs break. **Mitigation**: Pin to a specific Redoc version URL.

### Would a new maintainer understand this in 10 minutes?
**Yes.** The script is a single file with clear sections (extract → generate → write). The workflow is 4 steps. There's one command to run (`npm run docs:generate`). The planning doc in `docs/DOCS_AUTOMATION_PLAN.md` explains the architecture. A new maintainer could read the script top-to-bottom and understand it.

### Hidden costs
- The 943-line script includes ~400 lines of CSS (a style sheet embedded in JS). This is ugly but functional. If the CSS needs updating, the developer needs to edit a JavaScript file.
- The custom markdown parser will need bug fixes as guide content evolves. Each fix risks breaking other pages.

---

## Comparative Summary

| Criterion | Branch A | Branch B |
|-----------|----------|----------|
| Files added | 20 | 5 |
| Lines added | 25,322 | 1,160 |
| Dependencies added | 8 npm packages + 4 devDeps | 0 |
| Package-lock impact | +24,246 lines | 0 lines |
| Maintenance burden | High (3 pkg.json, Chrome compat, React upgrades) | Low (1 script, 1 workflow) |
| 10-minute onboarding | No (need to understand Docusaurus + TypeDoc + Mermaid + Puppeteer) | Yes |
| Overengineering | Severe | Moderate (custom md parser, embedded CSS) |
| Right tool for job | No (TypeDoc for MCP tools is wrong) | Yes (regex extraction is fragile but correct) |
