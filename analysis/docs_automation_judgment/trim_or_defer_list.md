# Trim or Defer List

## Trim (remove from landing set)

| Item | Reason | Impact of Removal |
|------|--------|-------------------|
| `docs/DOCS_AUTOMATION_PLAN.md` | Planning artifact, not operational code. Lives in wrong directory (`docs/`). | None. Planning rationale is preserved in judgment docs. |

## Defer (do not ship now, pursue later if valuable)

| Item | Why Defer | When to Revisit |
|------|-----------|-----------------|
| Guide page markdown parser improvements | Custom parser drops 70 blockquotes, flattens 37 nested lists across the 6 guide files. Works but imperfect. | When someone reports rendering issues, or when a contributor is willing to swap in `marked`. |
| Mintlify MDX integration (28 files) | `docs/mcp/*.mdx`, `docs/workflows/*.mdx`, `docs/frontend/*.mdx` have rich hand-written content not included in the generated site. | After the MVP is deployed and stable. These are the best candidates for expanding the docs site. |
| Search functionality | No search across 152 MCP tools + 135 REST actions + 6 guides. | When the docs site has actual users who request it. |
| Light/dark theme toggle | Generated site is dark-theme only. | Low priority. Trading tool audience is comfortable with dark theme. |
| MCP extraction smoke test | No assertion that tool count stays above a threshold. | As a CI check after merge, before any major `server.ts` refactor. |
| Pinned Redoc CDN version | Currently uses `latest` — minor stability risk. | Next PR that touches the docs script. |
| Dynamic REST action count | Landing page says "135" statically. | Next PR that touches the docs script. |

## Reject (do not pursue)

| Item | Why Reject |
|------|-----------|
| Branch A (`automate-docs-generation`) entirely | Wrong tools. TypeDoc doesn't extract MCP tools. Docusaurus is overweight. Puppeteer is fragile. 25K lines for docs that miss the primary use cases. |
| TypeDoc integration | TypeDoc generates TypeScript module docs. Users of this repo interact via `server.tool()` calls and HTTP endpoints, not TypeScript classes. Wrong abstraction level. |
| Puppeteer screenshot capture | Fragile in CI (Chrome binary + frontend build), captures empty UI shells without data, marginal documentation value. Manual screenshots are simpler. |
| Mermaid CLI rendering | The Mermaid SVG rendering step in Branch A produces files that nothing references. The architecture page uses client-side rendering instead. Dead code. |
| Docusaurus as docs framework | Overkill for 4-section static docs. Adds React build pipeline, 8 npm deps, separate package.json. The zero-dep approach serves this repo better. |
| Committed package-lock.json for docs-site | 19,706 lines of generated lockfile that produce noisy diffs. Not needed when the approach is zero-dependency. |
