# Market Data Bridge — Agent Orchestration

> How work gets delegated across Claude Code, GitHub Copilot, and OpenAI Codex.

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
  │   └─ YES → OpenAI Codex (via chatgpt.com/codex)
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
| **OpenAI Codex** | Single-file tasks, multi-file edits, Python scripts, analytical utilities | PR body generation buggy (placeholder text), needs environment setup for dual package.json, slower feedback loop | chatgpt.com/codex → Draft PR |

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

## Issue Template: Codex

Codex works best with **single-file tasks** that have clear input/output contracts.

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
| `agent-task` | Copilot/Codex delegated work |
| `phase-0` through `phase-8` | Roadmap phase tracking |
| `copilot` | Assigned to GitHub Copilot |
| `codex` | Assigned to OpenAI Codex |
| `claude-code` | Done by Claude Code directly |
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

## Codex Cloud Setup

### Environment Configuration

Go to **chatgpt.com/codex → Settings → Environments** and configure:

**Setup script:**
```bash
npm install
cd frontend && npm install
```

This is critical — the project has two `package.json` files (root backend + `frontend/` Next.js). Without both installs, Codex can't verify TypeScript compilation.

### Known Codex Issues

| Issue | Impact | Workaround |
|-------|--------|------------|
| PR body says "encountered an unexpected error" | Cosmetic — code is fine, PR description is placeholder | Review the diff, not the body. Manually edit PR description if needed. |
| Doesn't add "Fixes #N" to PRs | Issues don't auto-close on merge | Manually close issues after merging, or edit PR body to add `Fixes #N` |
| Doesn't read AGENTS.md automatically in Cloud mode | May miss conventions | Put all critical conventions in the issue body itself |
| Can't self-approve PRs | PR appears under your account, GitHub blocks self-approval | Merge directly with `gh pr merge` |

### How to Submit Work to Codex

1. Go to **chatgpt.com/codex**
2. Select the **market-data-bridge** repo
3. Paste the task — either:
   - Link to a GitHub issue: "Implement issue #N"
   - Or paste the full issue body directly
4. Codex creates a branch and draft PR when done
5. Review the PR diff, merge with `gh pr merge --merge --delete-branch`

### Codex vs Copilot: When to Use Which

| Scenario | Use Codex | Use Copilot |
|----------|-----------|-------------|
| Single-file utility (e.g. `export.ts`) | Yes | Yes |
| Multi-file component + page wiring | Yes (proved in PR #23) | Yes (proved in PRs #11-13) |
| Needs exact issue spec format | No — handles natural language | Yes — verbatim spec works best |
| Needs verification in CI | No — runs in Codex sandbox | Yes — runs in GitHub Actions |
| Python scripts | Yes (preferred) | Possible but less natural |
| Batch of similar components | No — one task at a time | Yes — can do sequentially via issues |
