# Internal Critique — market-data-bridge Brand Review

Five perspectives review Directions 1 and 2. They disagree where appropriate.

---

## Direction 1: "The Join" (convergence + schema grid + enriched output)
## Direction 2: "The Ensemble Grid" (3x3 scoring matrix with consensus row)

---

### FOUNDER (taste-driven, cares about first impressions and credibility)

**On Direction 1 (The Join):**
"I like the narrative — three inputs, one enriched output. That IS what the product does. The mark tells a story left-to-right, which matches how engineers think about data pipelines. But... I've seen variations of 'lines converging' on every data integration startup's landing page. The schema grid in the center helps differentiate it, but I'm not confident it reads as unique at a glance. The enrichment tick marks on the output line are a nice touch — they show the value-add, not just the routing."

**On Direction 2 (The Ensemble Grid):**
"This is more distinctive. The 3x3 grid with the highlighted consensus row is immediately recognizable as a specific thing, not just a generic concept. The three model colors (emerald, purple, amber) are already in the codebase — this feels native, not imposed. My concern: does it communicate 'bridge' or does it communicate 'evaluation engine'? The bridge is the whole product; the eval engine is one subsystem. Are we branding the whole or the part?"

**Verdict:** "Direction 2 is more memorable and distinctive. Direction 1 is more narratively complete. I lean Direction 2 but I want to see if we can make it communicate 'bridge' better."

---

### PRODUCT ENGINEER (cares about accuracy, hates misleading branding)

**On Direction 1:**
"Technically accurate. Three sources (IBKR, Yahoo, CSV) go in, normalized data comes out. The center grid represents the schema alignment that ParsedContent does. The output tick marks represent the 14 deterministic features. I approve the metaphor. My issue: the three input dots could be mistaken for 'three microservices' or 'three databases' — it's not immediately legible as market data sources specifically. But that's an acceptable level of abstraction."

**On Direction 2:**
"This represents the eval engine specifically, not the bridge as a whole. The three colors map to the three models (Claude = emerald, GPT = purple, Gemini = amber) — but wait, in the actual codebase, emerald maps to 'positive/good', not specifically to Claude. Claude is assigned #8b5cf6 (purple) in MODEL_COLORS. The color mapping in the mark doesn't match the code. That bugs me."

"Also, the 3x3 grid implies the product IS an eval engine. It's not. It's a bridge with 56 tools, and eval is maybe 10 of them. We're branding the feature, not the product."

**Verdict:** "Direction 1 is more honest about what the product is. Direction 2 is branding a subsystem."

---

### DATA ENGINEER (cares about the plumbing, schema alignment, normalization)

**On Direction 1:**
"Yes. This is exactly right. Three data sources → schema alignment → enriched output. That's the whole product in one mark. The grid in the center is the bridge — it's where the normalization happens. I would use this on my architecture diagrams. The only thing missing is the dual-output (MCP + REST), but you can't put everything in a mark."

**On Direction 2:**
"Looks like a dashboard widget, not a bridge. I'd see this and think 'analytics tool' or 'monitoring dashboard.' The 3x3 structure is clean but it doesn't say 'data pipeline.' If someone showed me this cold, I'd guess it's a product that compares three things — which is correct for the eval engine, but not for the bridge as a whole."

**Verdict:** "Strong Direction 1. It's architecturally honest."

---

### DESIGN LEAD (cares about craft, scalability, longevity)

**On Direction 1:**
"Craft-wise, this has a clean left-to-right narrative. It scales well from 32px up. At 16px, you lose the grid detail but the convergence shape still reads. My issue: it has 5 distinct visual elements (three input lines, center grid, output line + ticks). That's a lot of parts for a mark. Marks with fewer parts are more memorable. The center grid is doing the heavy lifting — maybe we should simplify to JUST the grid-with-connections and drop the explicit input lines?"

"The monospace wordmark is correct for the audience. The tagline 'structured data layer for AI trading tools' is clear and unpretentious."

**On Direction 2:**
"As a pure mark, this is stronger. It's one shape — a 3x3 grid. It's instantly recognizable. It's pixel-aligned by nature, which means it will never have subpixel rendering issues at small sizes. The color coding adds information without adding complexity. And it reduces to monochrome cleanly — just a 3x3 grid with the bottom row having different treatment."

"My concern: it's a grid. Lots of things are grids. Is a 3x3 grid with a highlighted bottom row distinctive enough to be ownable? I think so, IF we pair it with the specific color mapping and the name. Without the name, it could be mistaken for a spreadsheet icon or a Rubik's cube logo."

**Verdict:** "Direction 2 is the stronger mark. Direction 1 is the better illustration. For a logo/icon, I want Direction 2. For a banner, I want Direction 1's narrative."

---

### SKEPTICAL OSS MAINTAINER (hates polish over substance, wants utility)

**On Direction 1:**
"It's fine. It communicates what the thing does. I don't love the decorative tick marks on the output line — feels like someone trying too hard to make infrastructure look interesting. The core shape (three-to-one through a grid) is honest. But will I remember this mark vs. the 50 other data pipeline tools in my GitHub stars? Probably not."

**On Direction 2:**
"Distinctive but misleading. If I saw this on a GitHub repo, I'd think 'analytics dashboard' or 'comparison tool,' not 'MCP bridge for brokerage data.' The three colors are nice but they're communicating a feature (eval engine), not the product (bridge). Also — I don't like marks that require color to work. What does this look like in a monochrome terminal? A generic grid."

"Neither of these makes me think 'bridge.' Where's the bridge?"

**Verdict:** "Neither is perfect. Direction 1 is more honest. I'd prefer a simplified version of Direction 1 that strips out the decorative elements."

---

## Consensus Summary

| Reviewer | Direction 1 | Direction 2 | Reasoning |
|----------|------------|------------|-----------|
| Founder | ★★★☆ | ★★★★ | D2 more memorable, but D1 more complete |
| Product Engineer | ★★★★ | ★★☆☆ | D1 represents the whole product; D2 brands a subsystem |
| Data Engineer | ★★★★★ | ★★☆☆ | D1 is architecturally honest |
| Design Lead | ★★★☆ | ★★★★ | D2 is stronger as a mark; D1 is a better illustration |
| OSS Maintainer | ★★★☆ | ★★☆☆ | D1 needs simplification; D2 is misleading |

**Key tensions:**
1. Direction 2 is a stronger MARK but represents a SUBSYSTEM
2. Direction 1 is more HONEST but more COMPLEX
3. The ideal solution: simplify Direction 1's narrative into a tighter mark, OR evolve Direction 2 to represent the bridge (not just the eval engine)

**Action items for iteration:**
- Direction 1: Simplify. Remove explicit input lines, keep the core idea of "grid bridge with enriched output." Make it fewer parts.
- Direction 2: Reframe. Instead of "three models scoring," reframe as "three sources → unified output." Keep the grid shape but change what it means.
