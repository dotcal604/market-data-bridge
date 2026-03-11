# Iteration Comparison

## Direction 1 Iterations

### D1-Iter1: Simplified Grid Bridge
- Removed explicit input lines — the grid IS the mark
- Three subtle source notches on left edge imply input without drawing full convergence lines
- Output area is a filled panel showing enriched data
- **Assessment**: Better than original — fewer parts, grid as hero. But the rectangular grid + output panel layout feels like a small UI mockup, not a mark. Still too "illustration-y."

### D1-Iter2: Pure Grid Bridge (Timeless)
- Maximum reduction: 3x2 grid. Left column = sources (varied gray), right column = output (unified emerald)
- No arrows, no lines, no decoration
- **Assessment**: Clean. Reads as "three things become three enriched things." But it's lost the "bridge" — now it's just a table. The directionality (left → right) requires context to understand. As a standalone mark, it's too abstract.

### D1 Verdict
Iter1 is the better of the two, but neither iteration solved the core problem: Direction 1's narrative requires too many visual elements to tell its story. When we simplify, we lose the story. When we keep the story, we have too many parts.

---

## Direction 2 Iterations

### D2-Iter1: Bridge Reframe
- Same 3x3 grid but reframed: columns are Source → Bridge → Output (left to right)
- Subtle directional lines between columns
- Source column varied opacity, bridge column stroke-only, output column emerald-filled
- **Assessment**: This is strong. The 3x3 grid now communicates "bridge" via left-to-right progression. Three rows = three data channels. Three columns = source → process → output. The grid reads both as a data structure AND as a pipeline. The directional lines are subtle enough not to add clutter but clear enough to imply flow.

### D2-Iter2: Minimal 3-Column Bridge (Timeless)
- Stripped all decoration. Just 9 rectangles with clear differentiation: filled gray → outlined → emerald-filled
- **Assessment**: The purest expression. Works at 16x16 (just 9 tiny squares with left-gray, center-outlined, right-green). In monochrome, left=filled, center=outlined, right=filled-with-different-weight. Survives everywhere. But: is it too minimal? Does it need at least ONE enrichment indicator to show that the output is "enriched" vs just "forwarded"?

### D2 Verdict
D2-Iter2 is the winner. It's the most reducible, most scalable, most ownable. The three-column progression (filled → outlined → emerald) tells the bridge story through pure structure. Adding the enrichment dots from D2-Iter1 in the output column would be the one enhancement worth considering.

---

## Final Hybrid: D2-Iter2 + Enrichment Dots

The winning mark is **D2-Iter2 with enrichment indicators in the output column**:
- 3x3 grid
- Left column: filled gray (varied tones) = diverse data sources
- Center column: outlined = the bridge (processing/normalization layer)
- Right column: emerald-filled with centered dots = enriched output

This mark:
1. Communicates "bridge" through left-to-right progression
2. Communicates "enrichment" through the output column treatment
3. Is pixel-aligned and survives at 16x16
4. Works in monochrome (filled → outlined → filled-different)
5. Is specific to this product class (data pipeline with enrichment)
6. Has a compact, memorable shape (square grid)
7. Extends naturally to the wordmark (monospace, structured)

The runner-up is D1-Iter1 (simplified grid bridge with source notches), which tells the story more explicitly but has more parts and weaker small-size performance.
