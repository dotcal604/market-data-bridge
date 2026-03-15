# Stream Deck Button Icons — Design Guide

## Icon Specifications

| Device | Icon Size | Format |
|--------|-----------|--------|
| StreamDeck MK2 | 72x72 px | PNG (transparent bg) |
| StreamDeck+ (buttons) | 120x120 px | PNG (transparent bg) |
| StreamDeck+ (dial touch) | 200x100 px | PNG |
| StreamDeck Pedal | N/A (no display) | Title text only |

## Color Palette

Use these hex colors for button backgrounds in the Stream Deck app:

| Role | Color | Hex | Usage |
|------|-------|-----|-------|
| Status / Health | Green | `#22C55E` | STATUS, SESSION, OPS HEALTH |
| Data / Read-only | Blue | `#3B82F6` | Quotes (SPY/QQQ/IWM), P&L, POSITIONS |
| Caution / Orders | Yellow | `#EAB308` | ORDERS, LOCK, RISK CFG, FLATTEN CFG |
| Danger / Emergency | Red | `#EF4444` | FLATTEN ALL, CANCEL ALL |
| Analytics | Purple | `#A855F7` | ACCOUNT, EXPOSURE, STRESS TEST, JOURNAL |
| Holly / Screening | Orange | `#F97316` | HOLLY, SCREENERS, DIVOOM |
| Navigation / Misc | White | `#FFFFFF` | BACK, DASHBOARD, RESET, DEBUG |

## Icon Suggestions

For a clean, professional look, use single-character or simple glyph icons:

| Button | Suggested Icon / Glyph |
|--------|----------------------|
| STATUS | `⚡` or heartbeat pulse |
| SPY / QQQ / IWM | Ticker text as icon |
| ACCOUNT | `$` or wallet |
| P&L | `📊` or bar chart |
| POSITIONS | `📋` or list |
| ORDERS | `📝` or clipboard |
| EXPOSURE | `🎯` or target |
| SESSION | `🔓` (unlocked) / `🔒` (locked) |
| FLATTEN ALL | `⚠️` or flat line |
| CANCEL ALL | `✖` or stop sign |
| LOCK | `🔒` padlock |
| UNLOCK | `🔓` open padlock |
| HOLLY | `🤖` or AI chip |
| SCREENER | `🔍` magnifying glass |
| TRENDING | `📈` trending up |
| JOURNAL | `📓` notebook |
| DASHBOARD | `🏠` home |
| STRESS TEST | `💪` or crash icon |
| DIVOOM | `🖥️` display |
| DEBUG | `🐛` bug |

## Creating Custom Icons

1. Use any image editor (Figma, Canva, GIMP)
2. Create at the correct size for your device
3. Use the hex colors above for backgrounds
4. Export as PNG with transparency
5. In Stream Deck app: drag the icon onto the button's icon field

## Free Icon Sources

- [Lucide Icons](https://lucide.dev/) — Clean, consistent SVG icons
- [Heroicons](https://heroicons.com/) — Tailwind-compatible icons
- [Font Awesome](https://fontawesome.com/) — Extensive icon library
- Stream Deck built-in icon library (right-click button → Set Icon)
