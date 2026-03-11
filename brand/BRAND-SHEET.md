# market-data-bridge — Brand Sheet

## Identity

**Name**: market-data-bridge
**Shorthand**: MDB (supporting only, never primary)
**Tagline**: Structured data layer for AI trading tools

## The Mark: "The Bridge Grid"

A 3x3 grid with flow connectors representing the core data flow:

```
┌──────────┐      ┌──────────┐      ┌──────────┐
│  Source   │─────▸│  Bridge   │─────▸│  Output  ●│
│  (dark)   │      │ (outline) │      │ (emerald) │
├──────────┤      ├──────────┤      ├──────────┤
│  Source   │─────▸│  Bridge   │─────▸│  Output  ●│
│  (mid)    │      │ (outline) │      │ (emerald) │
├──────────┤      ├──────────┤      ├──────────┤
│  Source   │─────▸│  Bridge   │─────▸│  Output  ●│
│  (light)  │      │ (outline) │      │ (emerald) │
└──────────┘      └──────────┘      └──────────┘
  Col 1              Col 2              Col 3
  Data in            Normalize          Enriched out
```

- **Column 1** (Sources): Filled gray squares, dark→mid→light (top-to-bottom) = data depth → IBKR, Yahoo, CSV
- **Flow connectors** (source→bridge): Gray lines, opacity 0.4 — raw data entering the bridge
- **Column 2** (Bridge): Outlined squares → the normalization/processing layer
- **Flow connectors** (bridge→output): Emerald lines, opacity 0.35 — data becoming enriched
- **Column 3** (Output): Emerald-filled squares (fill-opacity 0.3) with centered dots (r=3) → enriched, unified data

## Color Palette

### Primary

| Swatch | Name | Hex | Tailwind | Usage |
|--------|------|-----|----------|-------|
| 🟩 | Emerald | `#10b981` | `emerald-500` | Primary accent, output column, active states |
| 🟩 | Emerald dark | `#059669` | `emerald-600` | Light-mode accent variant |

### Structural

| Swatch | Name | Hex | Tailwind | Usage |
|--------|------|-----|----------|-------|
| ⬛ | Slate 900 | `#0f172a` | `slate-900` | Dark mode background |
| ⬛ | Slate 800 | `#1e293b` | `slate-800` | Dark mode surface |
| ◼️ | Slate 700 | `#334155` | `slate-700` | Source cells (darkest) |
| ◻️ | Slate 600 | `#475569` | `slate-600` | Source cells (mid) |
| ◻️ | Slate 500 | `#64748b` | `slate-500` | Source cells (lightest), secondary text |
| ◻️ | Slate 400 | `#94a3b8` | `slate-400` | Bridge outlines |
| ⬜ | Slate 200 | `#e2e8f0` | `slate-200` | Dark mode primary text |
| ⬜ | Slate 50 | `#f8fafc` | `slate-50` | Light mode background |

### Feature Accents (from codebase)

| Swatch | Name | Hex | Context |
|--------|------|-----|---------|
| 🟪 | Purple | `#8b5cf6` | Claude / eval engine |
| 🟧 | Amber | `#f59e0b` | Gemini / warnings |
| 🔴 | Red | `#ef4444` | Negative / errors |

## Typography

**Wordmark font stack**: `'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace`
**Weight**: 500 (medium) for name, 400 (regular) for tagline
**Case**: All lowercase, preserving kebab-case: `market-data-bridge`

## Asset Inventory

```
brand/assets/
├── mark/
│   ├── mark.svg           # Primary mark (color)
│   └── mark-mono.svg      # Monochrome variant
├── lockup/
│   ├── lockup-dark.svg    # Mark + wordmark on dark
│   └── lockup-light.svg   # Mark + wordmark on light
├── icon/
│   └── app-icon.svg       # 512x512 app icon with background
├── favicon/
│   ├── favicon.svg         # 32x32 optimized
│   └── favicon-16.svg      # 16x16 maximum simplification
├── banner/
│   └── readme-banner.svg   # 1280x320 README hero
└── social/
    └── og-card.svg          # 1200x630 Open Graph card
```

## Quick Reference

- Mark minimum size: 16x16 (use favicon-16.svg variant)
- Clear space: 1/4 of mark width on all sides
- Never stretch, rotate, or add effects to the mark
- The mark works in monochrome — always test dark/light/mono before deploying
- The emerald accent (#10b981) is the only color that should be used for "active" or "positive" states across the product
- Source column gradient order: slate-700 (top) → slate-600 (mid) → slate-500 (bottom) = dark-to-light
- Output column fill-opacity: 0.3 (dark mode), 0.15 (light mode) — stronger than initial 0.2 for better emerald read
- Banner/OG card tool count: 75 MCP tools (not 56 — that was the REST endpoint count)

## Iteration History

| Iteration | Focus | Key Changes |
|-----------|-------|-------------|
| 1-2 | Direction exploration | 3 concepts × 2 directions, 5-reviewer critique, D2-Iter2 + enrichment dots selected |
| 3 | Core mark tightening | Source gradient ordered, output opacity 0.2→0.3, dots r=2.5→3, mono mark fixed, favicon symmetry |
| 4 | Compound asset refinement | Banner/OG tighter composition, flow arrows in banner, tool count corrected, separators unified |
| 5 | Flow connectors in mark | Subtle inter-column lines promoted from banner-only to core mark; addresses "where's the bridge?" critique |
