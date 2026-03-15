# market-data-bridge — StreamDeck Icon Spec

> All icons follow the MDB brand identity ("The Bridge Grid").
> See `brand/BRAND-SHEET.md` for the full canonical spec.

## Generation

```bash
node docs/streamdeck/icons/generate.js
```

Outputs 57 SVG icons to `docs/streamdeck/icons/svg/`.

## Icon Anatomy (144×144 canvas)

```
┌──────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ ← 5px accent bar (category color)
│                              │
│                              │
│         ╭─────────╮          │
│         │  glyph  │          │ ← slate-200 (#e2e8f0) monochrome
│         │  icon   │          │    stroke-based, no fills
│         ╰─────────╯          │
│                              │
│                              │
│  bg: slate-800 (#1e293b)     │ ← rounded rect, rx=16
│                              │
└──────────────────────────────┘
```

- **Canvas:** 144×144 px (2× for MK2 72×72, also fits SD+ 120×120)
- **Background:** `#1e293b` (slate-800) rounded rect, rx=16
- **Accent bar:** 5px tall strip at top, category color, rx=2.5
- **Glyph:** `#e2e8f0` (slate-200), stroke-width 3–5, stroke-linecap round
- **Accent in glyph:** Only for state indication (emerald dot on active, red tint on danger)
- **No text:** Button titles are set in the Stream Deck app
- **Pressed state:** accent color at 20% opacity as background tint (set in SD app)

## Color Palette

### Structural

| Token | Hex | Usage |
|-------|-----|-------|
| slate-900 | `#0f172a` | Stream Deck app dark background |
| slate-800 | `#1e293b` | Button surface fill |
| slate-700 | `#334155` | Pressed state (darkest) |
| slate-600 | `#475569` | Borders |
| slate-500 | `#64748b` | Market data accent, secondary icons |
| slate-400 | `#94a3b8` | Navigation accent, muted labels |
| slate-200 | `#e2e8f0` | Primary icon stroke color |

### Category Accents (top bar color)

| Category | Color | Hex | Icon count |
|----------|-------|-----|------------|
| Connection / Status | Emerald | `#10b981` | 4 |
| Market Data | Slate | `#64748b` | 10 |
| Eval Engine | Purple | `#8b5cf6` | 11 |
| Orders / Execution | Red | `#ef4444` | 9 |
| Portfolio | Amber | `#f59e0b` | 10 |
| Tools / Utility | Slate | `#64748b` | 8 |
| Navigation | Muted | `#94a3b8` | 5 |

### Semantic Colors (used sparingly in glyphs)

| Meaning | Hex | Usage in icons |
|---------|-----|----------------|
| Positive / active | `#10b981` (emerald) | Filled checkmark, active dots |
| Negative / danger | `#ef4444` (red) | Cancel X background tint, trade folder cross |
| Warning | `#f59e0b` (amber) | Flatten-config indicator dot |
| Eval / AI | `#8b5cf6` (purple) | Analytics folder chart line |

### Model Colors (eval buttons)

| Model | Hex |
|-------|-----|
| GPT-4o | `#10b981` |
| Claude | `#8b5cf6` |
| Gemini | `#f59e0b` |

## Typography (in Stream Deck app titles)

- Font: SF Mono, Cascadia Code, JetBrains Mono, Consolas, monospace
- Weight: 500 (primary labels), 400 (secondary)
- Product name: all lowercase `market-data-bridge` or `MDB`

## Icon Inventory

### Connection / Status — `#10b981`
| File | Description |
|------|-------------|
| `status.svg` | Heartbeat/pulse line |
| `session.svg` | Shield with center dot |
| `ops-health.svg` | Clock/gauge |
| `unlock.svg` | Open padlock |

### Market Data — `#64748b`
| File | Description |
|------|-------------|
| `spy.svg` | "SPY" monospace text |
| `qqq.svg` | "QQQ" monospace text |
| `iwm.svg` | "IWM" monospace text |
| `trending.svg` | Rising arrow chart |
| `news.svg` | Document with lines |
| `earnings.svg` | Trend line with emerald dot |
| `financials.svg` | Bar chart (3 bars) |
| `options.svg` | Grid/table |
| `search.svg` | Magnifying glass |
| `indicators.svg` | Gauge with needle |

### Eval Engine — `#8b5cf6`
| File | Description |
|------|-------------|
| `eval.svg` | Face/model icon |
| `drift.svg` | Diverging sine waves |
| `edge.svg` | Diamond (nested) |
| `daily.svg` | Calendar |
| `weights.svg` | Balance scale |
| `holly.svg` | Robot/AI face |
| `holly-exits.svg` | Trend with exit marker |
| `exit-autopsy.svg` | Clock with crosshair |
| `signals.svg` | Antenna with arcs |
| `regime.svg` | Stacked layers |
| `tradersync.svg` | Sync arcs with center dot |

### Orders / Execution — `#ef4444`
| File | Description |
|------|-------------|
| `orders.svg` | Clipboard with lines |
| `open-orders.svg` | Clipboard with amber dot |
| `filled.svg` | Clipboard with emerald checkmark |
| `executions.svg` | Ledger/receipt |
| `history.svg` | Clock |
| `flatten.svg` | Flat line with red tint |
| `cancel.svg` | X in circle with red tint |
| `lock.svg` | Closed padlock |
| `reset.svg` | Circular refresh arrow |

### Portfolio — `#f59e0b`
| File | Description |
|------|-------------|
| `account.svg` | Dollar sign |
| `pnl.svg` | 3-bar chart (ascending) |
| `positions.svg` | 2×2 grid |
| `exposure.svg` | Pie chart with segment |
| `stress-test.svg` | Jagged volatility line |
| `risk-config.svg` | 3 vertical sliders |
| `flatten-config.svg` | Clock with amber indicator |
| `size-pos.svg` | Resize/measure box |
| `screener-gainers.svg` | Up triangle with emerald arrows |
| `screener-actives.svg` | Pulse/activity line |

### Tools / Utility — `#64748b`
| File | Description |
|------|-------------|
| `journal.svg` | Notebook with spine |
| `collab.svg` | Chat bubbles |
| `import.svg` | Download arrow into tray |
| `import-history.svg` | Clock with download arrow |
| `divoom.svg` | Pixel grid display |
| `divoom-bright.svg` | Sun/brightness rays |
| `debug.svg` | Bug |
| `ops-log.svg` | Terminal prompt `>_` |

### Navigation — `#94a3b8`
| File | Description |
|------|-------------|
| `back.svg` | Left chevron |
| `dashboard.svg` | Dashboard grid layout |
| `folder-trade.svg` | Folder with red cross |
| `folder-analytics.svg` | Folder with purple trend line |
| `folder-data.svg` | Folder with database cylinder |

## Device Icon Sizes

| Device | Native | Recommended | Notes |
|--------|--------|-------------|-------|
| StreamDeck MK2 | 72×72 | 144×144 (2×) | SVGs scale perfectly |
| StreamDeck+ buttons | 120×120 | 144×144 | Slight downscale is fine |
| StreamDeck+ dial touch | 200×100 | Custom needed | Not covered by generator |
| StreamDeck Pedal | N/A | N/A | No display |

## Converting SVG to PNG

If the Stream Deck app requires PNG:

```bash
# Using ImageMagick (if available)
for f in docs/streamdeck/icons/svg/*.svg; do
  convert -background none -resize 144x144 "$f" "${f%.svg}.png"
done

# Using librsvg (if available)
for f in docs/streamdeck/icons/svg/*.svg; do
  rsvg-convert -w 144 -h 144 "$f" -o "${f%.svg}.png"
done
```

## Design Rules

1. Always dark theme — never use light backgrounds
2. Emerald (`#10b981`) is the ONLY color for active/positive states
3. Icons are monochrome slate-200 — accent color only for state indication
4. Category is expressed through the top accent bar, not the glyph color
5. The 3-column progression (filled → outlined → emerald) should inform button grouping on the MK2 home page
6. Group related buttons visually using accent colors as top-edge indicators
