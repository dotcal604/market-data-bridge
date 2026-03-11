# Final Decision

## Winner: "The Bridge Grid" (D2-Iter2 hybrid)

A 3x3 grid mark with three semantic columns:
- **Left column** (source): Filled gray squares at varying opacities → diverse data sources (IBKR, Yahoo, CSV)
- **Center column** (bridge): Outlined squares → the normalization/processing layer
- **Right column** (output): Emerald-filled squares with centered dots → enriched, unified data

### Why it won:
1. **Architecturally honest**: Three columns map directly to source → bridge → output, which is the product's core data flow
2. **Favicon-first**: 9 squares in a grid is inherently pixel-aligned and reads clearly at 16x16
3. **Monochrome-safe**: Filled → outlined → filled-different reads without color
4. **Memorable**: Simple enough to sketch from memory, specific enough to not be confused with other products
5. **Extensible**: The grid vocabulary extends naturally to banners (wider grids), social cards (contextual grids), and the dashboard UI
6. **Rooted in the codebase**: The emerald accent (#10b981) comes from the product's own color system. The grid structure echoes the schema alignment in ParsedContent
7. **Passes the skeptic test**: Every reviewer agreed the grid was the strongest pure mark. The reframing from "eval" to "bridge" resolved the semantic objection

### Known tradeoffs:
- Less narrative than Direction 1 — doesn't explicitly show convergence
- Requires the name to fully land — "bridge" isn't immediately obvious from a bare grid without context
- The model-color story (emerald/purple/amber) from the original D2 is lost, replaced by source/bridge/output semantics. This is the right tradeoff — brand should represent the whole product, not one feature.

---

## Runner-Up: "The Simplified Join" (D1-Iter1)

A vertical grid bridge with three source notches on the left, internal schema grid, and enriched output panel on the right.

### Why it lost:
1. **More parts = less memorable**: The Join requires ~8 visual elements to tell its story. The Bridge Grid needs 9 identical squares.
2. **Weaker at small sizes**: At 16px, the Join collapses to noise. The Grid stays structured.
3. **More "illustration" than "mark"**: Good marks are compact symbols. The Join is closer to a diagram.
4. **Narrative dependency**: The Join only works if you read it left-to-right. The Grid works as a static symbol.

### Where it excels:
- Better for **explanatory contexts** (architecture docs, presentations, blog posts)
- The Join's narrative version will be used in the README banner as a **supporting illustration** extending the mark vocabulary, not as the primary identity

---

## Color Palette (Final)

| Role | Hex | Tailwind | Usage |
|------|-----|----------|-------|
| Primary accent | #10b981 | emerald-500 | Output column, active states, success |
| Source dark | #334155 | slate-700 | Source column (dark mode) |
| Source mid | #475569 | slate-600 | Source column variants |
| Source light | #64748b | slate-500 | Source column variants, secondary text |
| Bridge stroke | #94a3b8 | slate-400 | Bridge column outlines |
| Background dark | #0f172a | slate-900 | Dark mode background |
| Background light | #f8fafc | slate-50 | Light mode background |
| Text primary | #e2e8f0 | slate-200 | Dark mode text |
| Text secondary | #64748b | slate-500 | Muted text, labels |

## Typography

- **Wordmark**: System monospace stack: `'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace`
- **Weight**: 500 (medium) for the name, 400 (regular) for tagline
- **Case**: All lowercase (`market-data-bridge`) — matches repo name exactly, kebab-case is the native form
