# Market Data Bridge — Agent Orchestration

> How work gets delegated across Claude Code, GitHub Copilot, and Google Jules.
>
> **Note:** OpenAI Codex was used for PRs #3 and #23 but proved unreliable (broken PR bodies, missing env setup). Jules replaced Codex as of Feb 2026.

## Decision Tree

```
New task arrives
  │
  ├─ Touches 3+ files or wires subsystems together?
  │   └─ YES → Claude Code (orchestrator)
  │
  ├─ Self-contained UI component with clear props/API?
  │   └─ YES → GitHub Copilot (via issue)
  │
  ├─ Single-file utility, chart, or Python script?
  │   └─ YES → Google Jules (via jules.google or `jules` label)
  │
  ├─ Backend route + frontend page + DB migration?
  │   └─ Claude Code builds backend, creates Copilot issue for frontend
  │
  └─ Unsure?
      └─ Claude Code scopes the work, then delegates
```

## Agent Profiles

| Agent | Strengths | Limitations | Interface |
|-------|-----------|-------------|-----------|
| **Claude Code** | Cross-file wiring, architecture, backend routes, planning, code review | Slower for large batches of isolated components | CLI (local) |
| **GitHub Copilot** | Self-contained components, multi-file refactors, follows issue specs precisely | Needs detailed issue specs, can't make architectural decisions, firewall blocks external fonts | GitHub Issues → Draft PRs |
| **Google Jules** | Single-file tasks, multi-file edits, Python scripts, analytical utilities, runs in cloud VM (clones repo, installs deps, runs builds) | Beta — usage limits apply, plan approval required before execution | jules.google dashboard or `jules` label on GitHub issues |

## Issue Template: Copilot

Copilot produces the best results when issues include **exact file paths, props interfaces, API endpoints, and acceptance criteria**. This template is derived from the successful PRs #11, #12, #13.

```markdown
## Component: `frontend/src/components/{category}/{name}.tsx`

{One-sentence description of what this component does.}

### Props Interface
\`\`\`tsx
interface {Name}Props {
  // Exact TypeScript interface — Copilot will implement this verbatim
}
\`\`\`

### API Endpoints Used
- `GET /api/{endpoint}` — {what it returns}
- `POST /api/{endpoint}` — {what it accepts}

### Requirements
- {Specific UI library}: `recharts`, `@tanstack/react-table`, shadcn/ui primitives
- {Behavior}: sorting, filtering, auto-refresh interval, form validation rules
- {Styling}: dark theme, model colors from `@/lib/utils/colors`, `font-mono` for numbers
- `"use client"` directive at top
- Named export `{ComponentName}`
- Wrap in `Card` from `@/components/ui/card`

### Files to Create/Modify
- **Create**: `frontend/src/components/{category}/{name}.tsx`
- **Modify** (if needed): `frontend/src/app/{route}/page.tsx` — mount the component
- **Modify** (if needed): `frontend/src/lib/hooks/use-{domain}.ts` — add React Query hook

### Dependencies
Already in `frontend/package.json`: {list installed packages}
Need to install: {list if any — prefer avoiding new deps}

### Acceptance Criteria
- [ ] Component renders with sample/mock data
- [ ] {Specific behavior verified}
- [ ] Dark theme compatible (no white backgrounds, correct text colors)
- [ ] TypeScript compiles clean: `cd frontend && npx tsc --noEmit`
- [ ] No `console.log` in committed code

### Context
- Design reference: {link to comparable UI, screenshot, or description}
- Related issues: #{number}
- Backend endpoint source: `src/rest/routes.ts` lines {X-Y}
```

### What Makes a Good Copilot Issue

From PRs #11 (score scatter), #12 (weight sliders), #13 (time-of-day chart):

**Worked well:**
- Exact props interface in the issue body — Copilot implements it verbatim
- Specific file paths (`frontend/src/components/analytics/score-scatter.tsx`)
- Library imports spelled out (`ScatterChart`, `Scatter`, `XAxis`, `YAxis`)
- Color values hardcoded (`emerald-400`, `#10b981`)
- Acceptance criteria as checkbox list
- Screenshots in PR descriptions (Copilot generates these automatically)

**Watch out for:**
- Copilot's firewall blocks `fonts.googleapis.com` — don't depend on Google Fonts in dev
- Copilot creates demo pages (e.g. `/weights/demo`) — review whether to keep or remove
- Copilot doesn't read AGENTS.md unless told to — put all conventions in the issue itself
- Don't assume Copilot knows the data shape — include the full TypeScript interface

## Issue Template: Jules

Jules works best with **single-file tasks** or **isolated features** that have clear input/output contracts. Jules clones the repo, installs deps, and builds in a cloud VM — no local env issues.

```markdown
## Task: {file path or utility name}

{Description of what to build.}

### Input
- {Exact parameters, types, data shapes}

### Output
- {Return type, file output, side effects}

### Implementation Notes
- Use {specific library or approach}
- Edge cases: {list them}
- Do NOT {constraints}

### Test with
\`\`\`bash
{Command to verify the output}
\`\`\`
```

### Triggering Jules

1. **Via label:** Add the `jules` label to any GitHub issue → Jules picks it up automatically
2. **Via dashboard:** Go to [jules.google](https://jules.google), select `market-data-bridge`, paste issue link
3. **Via GitHub Action:** (optional) `google-labs-code/jules-action` for event-driven triggers

Jules reads `AGENTS.md` automatically from repo root.

## Phase Orchestration Pattern

Each roadmap phase uses a **parent meta-issue** that tracks child issues:

```markdown
## Phase {N}: {Name}

Tracking issue for all {Phase Name} work.

### Issues
- [ ] #{id} — {title} (assigned: @copilot)
- [ ] #{id} — {title} (assigned: @copilot)
- [ ] #{id} — {title} (codex — manual)

### Dependencies
- Blocked by: Phase {N-1} completion
- Blocks: Phase {N+1}

### Definition of Done
- All child issues closed
- `cd frontend && npx tsc --noEmit` passes
- New pages accessible from sidebar nav
- No regressions in existing pages
```

## Review Workflow

```
1. Copilot creates draft PR from issue
2. Claude Code reviews (or human reviews):
   - Does it follow AGENTS.md conventions?
   - Does TypeScript compile clean?
   - Is the component wired into the page layout?
   - Are there unnecessary files (demo pages, test fixtures)?
3. Request changes or approve
4. Human merges (no auto-merge)
5. Close the linked issue
```

## Labels

| Label | Purpose |
|-------|---------|
| `agent-task` | Copilot/Jules delegated work |
| `phase-0` through `phase-8` | Roadmap phase tracking |
| `copilot` | Assigned to GitHub Copilot |
| `jules` | Assigned to Google Jules |
| `claude-code` | Done by Claude Code directly |
| `api-migration` | API dependency migration tasks |
| `api-audit` | Automated API audit findings |
| `blocked` | Waiting on dependency |
| `needs-review` | PR ready for review |

## Backend Additions (Claude Code)

Some frontend work requires new or modified backend endpoints. Claude Code handles these directly before creating the Copilot issue:

| Phase | Backend Work | Then Copilot Builds |
|-------|-------------|-------------------|
| Phase 2 | `GET /api/eval/outcomes` (evals + outcomes joined) | Score scatter with real data |
| Phase 2 | `POST /api/eval/weights/simulate` (re-score with custom weights) | Weight slider "what if" preview |
| Phase 3 | None — all endpoints exist | Account, positions, orders pages |
| Phase 4 | None — all endpoints exist | Journal + collab feed |
| Phase 5 | None — all endpoints exist | Market data tools |

## Firewall Configuration

Copilot's GitHub Actions environment blocks external network by default. To allow:

1. Go to repo Settings → Copilot → Coding Agent
2. Add to custom allowlist:
   - `fonts.googleapis.com` (if using Google Fonts)
   - `registry.npmjs.org` (already allowed for npm install)

Currently not blocking builds — the `fonts.googleapis.com` warning in PRs #11-13 is cosmetic (Next.js tries to optimize Google Fonts at build time but falls back gracefully).

## Jules Setup

### Initial Configuration

1. Go to [jules.google](https://jules.google) → **Try Jules** → sign in with Google
2. **Connect GitHub** → authorize access to `dotcal604/market-data-bridge`
3. Jules auto-reads `AGENTS.md` from repo root — no additional env config needed
4. Jules clones the repo into a secure cloud VM, runs `npm install` in both root and `frontend/`

### How Jules Works

1. **Assign:** Add `jules` label to a GitHub issue, or paste issue link in Jules dashboard
2. **Plan:** Jules analyzes the codebase and generates a plan → you review and approve
3. **Execute:** Jules implements in a cloud VM, builds, and verifies
4. **PR:** Jules creates a pull request with diff → you review and merge

### Jules vs Copilot: When to Use Which

| Scenario | Use Jules | Use Copilot |
|----------|-----------|-------------|
| Single-file utility (e.g. `export.ts`) | Yes | Yes |
| Multi-file component + page wiring | Yes | Yes (proved in PRs #11-13) |
| Needs exact issue spec format | No — handles natural language + reads AGENTS.md | Yes — verbatim spec works best |
| Python scripts | Yes (preferred — Gemini-native) | Possible but less natural |
| Batch of similar components | One task at a time | Yes — can do sequentially via issues |
| Needs build verification in sandbox | Yes — runs in cloud VM | Yes — runs in GitHub Actions |

### Jules Free Tier Limits

- **Beta (current):** Free during beta, subject to daily task limits
- Plan approval required before each execution (no auto-execution)
- Monitor usage at [jules.google/settings](https://jules.google/settings)

### Historical: Why Codex Was Replaced

OpenAI Codex (via chatgpt.com/codex) was used for PRs #3 and #23. Issues encountered:
- PR body generation consistently broken ("encountered an unexpected error" placeholder)
- Required manual environment setup for dual `package.json` (never completed)
- Didn't read `AGENTS.md` automatically
- PRs opened under user's account (can't self-approve)
- Issue #10 (CSV export) never delivered

Jules resolves all of these: reads AGENTS.md, runs in a proper VM, generates real PR descriptions, and auto-detects project structure.
