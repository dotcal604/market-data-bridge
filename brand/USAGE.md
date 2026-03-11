# Usage Guidelines — market-data-bridge

## The Mark

### Do
- Use `mark.svg` at 32px and above
- Use `favicon-16.svg` at 16px
- Use `mark-mono.svg` when color is unavailable
- Maintain clear space equal to 1/4 of mark width on all sides
- Place on dark (#0f172a) or light (#f8fafc) backgrounds

### Don't
- Don't stretch, compress, or rotate the mark
- Don't add drop shadows, glows, or gradients
- Don't change the column colors (sources must be gray, bridge outlined, output emerald)
- Don't rearrange the grid columns
- Don't use the mark at sizes below 16px
- Don't place on busy or multicolored backgrounds
- Don't add text inside the mark

## The Lockup

### Horizontal lockup (default)
- Mark | separator | wordmark + tagline
- Use `lockup-dark.svg` on dark backgrounds
- Use `lockup-light.svg` on light backgrounds
- Minimum width: 280px (below this, use mark only)

### Standalone wordmark
- `market-data-bridge` in system monospace, weight 500
- Always lowercase, always with hyphens
- Never abbreviate to "MDB" in primary contexts

## Color Usage

### Primary accent: Emerald (#10b981)
- Active states, success indicators, positive values
- Output column in the mark
- CTA buttons and links (dark mode)
- Use #059669 for light-mode variant

### Backgrounds
- Dark mode: #0f172a (primary), #1e293b (surface)
- Light mode: #f8fafc (primary), #e2e8f0 (surface)

### Text
- Dark mode: #e2e8f0 (primary), #64748b (secondary)
- Light mode: #0f172a (primary), #64748b (secondary)

### Feature accents (contextual only)
- Purple (#8b5cf6): Claude, eval engine contexts
- Amber (#f59e0b): Gemini, warning states
- Red (#ef4444): Errors, negative values
- These are NOT brand colors — they're functional colors from the codebase

## Social & Web

### README banner
- `banner/readme-banner.svg` — 1280x320
- Place at the top of README.md
- Do not crop or resize the banner — use as-is

### OG/Social card
- `social/og-card.svg` — 1200x630
- Use for Open Graph meta tags, Twitter cards, LinkedIn shares

### Favicon
- `favicon/favicon.svg` — use for web browsers
- `favicon/favicon-16.svg` — use for contexts requiring 16px (browser tabs)
- Generate .ico or .png from SVG if needed using the export script

## App Icon
- `icon/app-icon.svg` — 512x512 with rounded-rect background
- Suitable for Electron, PWA, macOS, or system tray

## MDB Shorthand

"MDB" may be used:
- In CLI output and log lines
- In UI badges where space is constrained
- As a variable/namespace prefix in code

"MDB" must NOT be used:
- As the primary brand name
- In headers, titles, or hero sections
- In external communications (docs, social, README)

## File Formats

All source assets are SVG. For raster exports:
- PNG: Use the export script or render at 2x for retina
- ICO: Generate from favicon.svg at 16, 32, 48px
- WebP: Generate from banner/social SVGs for web optimization
