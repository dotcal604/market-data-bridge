---
applyTo: "frontend/**/*.tsx,frontend/**/*.ts"
---
# Frontend Standards (Next.js 14 + Tailwind v4)

## Component Rules
- Every interactive component starts with `"use client"` directive
- Named exports only — `export function Foo()`, never `export default`
- Props interface defined in same file or imported from `@/lib/api/types`
- Use `cn()` from `@/lib/utils` for conditional class merging

## Dark Theme (Mandatory)
- App is always in dark mode — `<html className="dark">`
- Use semantic Tailwind classes: `bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `border-border`
- No white backgrounds, no light theme colors
- Score colors: 8+→emerald, 6+→green, 4+→yellow, 2+→orange, <2→red
- Model colors: use `modelColor()` from `@/lib/utils/colors` — never hardcode

## Typography
- `font-mono` for numeric/data values (prices, scores, percentages)
- Default sans-serif for labels and text

## Data Fetching
- All API calls go through `@/lib/api/eval-client.ts` or `@/lib/api/account-client.ts`
- React Query hooks in `@/lib/hooks/`
- No direct `fetch()` in components — always use hooks or client wrappers
- Proxy in `next.config.ts` rewrites `/api/*` → `http://localhost:3000/api/*`

## UI Library
- shadcn/ui primitives from `@/components/ui/*` (already installed)
- TanStack Table v8 for data tables
- TanStack Query v5 for server state
- Recharts v3 with `ResponsiveContainer` wrapper
- Zustand v5 for client stores
- Lucide React for icons

## Formatters & Utilities
- `@/lib/utils/formatters` — formatScore, formatPrice, formatMs, formatTimestamp
- `@/lib/utils/colors` — scoreColor, scoreBg, modelColor, directionColor
- `@/lib/utils/export` — exportToCsv, exportToJson

## Verification
```bash
cd frontend && npx tsc --noEmit
```
