# Market Data Bridge — Agent Orchestration

> 4-agent fleet managed via **GitHub Agent HQ**: Claude Code, GitHub Copilot, OpenAI Codex, and Google Jules.
>
> Agent HQ provides unified Mission Control across GitHub, VS Code, and CLI. Custom agent profiles live in `.github/agents/`.

## Agent Fleet

| Agent | Role | Model | Interface | Reads AGENTS.md |
|-------|------|-------|-----------|-----------------|
| **Claude Code** | Orchestrator — cross-file wiring, architecture, backend routes, planning, code review | Claude Opus 4.6 | CLI (local) | Yes (via claude.md) |
| **GitHub Copilot** | UI components, multi-file refactors, follows detailed issue specs | GPT-4.1 / Claude 3.5 | GitHub Issues → Draft PRs | Via issue body |
| **OpenAI Codex** | Long-running tasks, parallel execution, complex features, backend work | GPT-5.2-Codex | chatgpt.com/codex, @codex on issues | Yes (auto-discovery) |
| **Google Jules** | Single-file tasks, Python scripts, analytical utilities, cloud VM sandbox | Gemini | jules.google, `jules` label | Yes (auto-reads) |

## Decision Tree

```
New task arrives
  │
  ├─ Touches 3+ files or wires subsystems together?
  │   └─ YES → Claude Code (orchestrator)
  │
  ├─ Self-contained UI component with clear props/API?
  │   └─ YES → GitHub Copilot (via issue + assign)
  │
  ├─ Long-running feature, complex refactor, or needs 7+ hours?
  │   └─ YES → OpenAI Codex (cloud sandbox, parallel tasks)
  │
  ├─ Single-file utility, chart, or Python script?
  │   └─ YES → Google Jules (cloud VM, plan-then-execute)
  │
  ├─ Backend route + frontend page + DB migration?
  │   └─ Claude Code builds backend, creates issue for Copilot/Codex
  │
  ├─ Want to compare agent outputs?
  │   └─ Assign multiple agents to same issue via Agent HQ
  │
  └─ Unsure?
      └─ Claude Code scopes the work, then delegates
```

## GitHub Agent HQ

Agent HQ is GitHub's unified control plane for managing multiple AI coding agents. Announced at Universe 2025, expanded Feb 2026.

### What It Provides

- **Mission Control** — single dashboard to see, steer, and approve work across all agents (GitHub web, VS Code, Mobile, CLI)
- **Multi-agent assignment** — assign Copilot, Codex, Claude, or multiple agents to the same issue
- **Custom agent profiles** — `.github/agents/*.agent.md` files for specialized roles (e.g. `@copilot/frontend-dev`, `@copilot/test-writer`)
- **Plan Mode** — agents ask clarifying questions before writing code, reducing wasted effort
- **Enterprise controls** — granular permissions, sandboxed execution, branch protection

### Custom Agent Profiles

Located in `.github/agents/`. Each file defines a specialized agent role:

```yaml
---
name: frontend-dev
description: Frontend component specialist for Next.js dashboard
tools: ["read", "edit", "search"]
---

{Behavioral instructions in markdown}
```

Invoke via `@copilot/frontend-dev` when assigning issues.

See `.github/agents/` for this repo's custom profiles.

### Setup

1. **Copilot Pro+ or Enterprise** subscription required for Agent HQ
2. Navigate to repo → Issues → assign agent (Copilot, Codex, or Claude)
3. Monitor via Mission Control in GitHub web UI or VS Code
4. Custom agents auto-discovered from `.github/agents/`

---

## Issue Template: Copilot

Copilot produces the best results when issues include **exact file paths, props interfaces, API endpoints, and acceptance criteria**. Derived from successful PRs #11, #12, #13.

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
- Copilot's firewall blocks `fonts.googleapis.com` — cosmetic, builds succeed
- Copilot creates demo pages (e.g. `/weights/demo`) — review whether to keep or remove
- Put all conventions in the issue itself — don't assume Copilot knows the data shape

## Issue Template: Codex

Codex excels at **long-running, complex tasks** that benefit from parallel cloud execution. Tag `@codex` on issues/PRs, or start tasks at chatgpt.com/codex.

```markdown
## Task: {description}

{What needs to be built or changed.}

### Files Involved
- `{path/to/file.ts}` — {what to change}
- `{path/to/new-file.ts}` — {what to create}

### Requirements
- {Specific behavior, edge cases, error handling}
- Read AGENTS.md for project conventions
- Two package.json files: root (backend) + frontend/

### Verification
\`\`\`bash
# Backend
npx tsc --noEmit

# Frontend
cd frontend && npx tsc --noEmit
\`\`\`

### Acceptance Criteria
- [ ] {Specific testable outcomes}
- [ ] TypeScript compiles clean
- [ ] No `console.log` — use Pino logger for backend
```

### Codex Cloud Environment

Configure at [chatgpt.com/codex/settings/environments](https://chatgpt.com/codex/settings/environments):

**Setup script:**
```bash
npm install && cd frontend && npm install && cd ..
```

**Key capabilities:**
- Tasks run in cloud sandboxes (container state cached 12 hours)
- Parallel task execution across issues
- GPT-5.2-Codex model (optimized for agentic coding)
- Internet access configurable per task
- Reads AGENTS.md via auto-discovery chain

**Historical note:** Early Codex (PRs #3, #23) had broken PR bodies and no env setup. Current Codex (GPT-5.2) resolves all previous issues — reads AGENTS.md, supports setup scripts, generates proper PR descriptions.

## Issue Template: Jules

Jules works best with **single-file tasks** or **isolated features** with clear input/output contracts. Cloud VM execution — no local env issues.

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

1. **Via label:** Add the `jules` label to any GitHub issue
2. **Via dashboard:** Go to [jules.google](https://jules.google), select `market-data-bridge`, paste issue link
3. **Via GitHub Action:** (optional) `google-labs-code/jules-action`

Jules reads `AGENTS.md` automatically from repo root.

---

## Agent Comparison

| Scenario | Copilot | Codex | Jules |
|----------|---------|-------|-------|
| Self-contained UI component | Best | Good | Good |
| Multi-file component + page wiring | Proved (PRs #11-13) | Good | Good |
| Long-running complex feature (7+ hours) | No | Best | No |
| Parallel tasks across issues | Via separate issues | Native (cloud) | One at a time |
| Python scripts / analytics | Possible | Good | Best (Gemini-native) |
| Needs exact issue spec | Yes (verbatim) | Natural language OK | Natural language OK |
| Reads AGENTS.md | Via issue body | Auto-discovery | Auto-reads |
| Build verification | GitHub Actions sandbox | Cloud sandbox | Cloud VM |
| Cost | Copilot Pro+ | ChatGPT Pro/Plus | Free (beta) |

---

## Phase Orchestration Pattern

Each roadmap phase uses a **parent meta-issue** that tracks child issues:

```markdown
## Phase {N}: {Name}

Tracking issue for all {Phase Name} work.

### Issues
- [ ] #{id} — {title} (assigned: @copilot)
- [ ] #{id} — {title} (assigned: @codex)
- [ ] #{id} — {title} (jules label)

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
1. Agent creates draft PR from issue (Copilot/Codex/Jules)
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
| `agent-task` | Any agent-delegated work |
| `phase-0` through `phase-8` | Roadmap phase tracking |
| `copilot` | Assigned to GitHub Copilot |
| `codex` | Assigned to OpenAI Codex |
| `jules` | Assigned to Google Jules |
| `claude-code` | Done by Claude Code directly |
| `api-migration` | API dependency migration tasks |
| `api-audit` | Automated API audit findings |
| `blocked` | Waiting on dependency |
| `needs-review` | PR ready for review |

## Backend Additions (Claude Code)

Some frontend work requires new or modified backend endpoints. Claude Code handles these directly before creating agent issues:

| Phase | Backend Work | Then Agent Builds |
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

Currently not blocking builds — the `fonts.googleapis.com` warning in PRs #11-13 is cosmetic.

## Agent Setup Checklist

### OpenAI Codex
1. Go to [chatgpt.com/codex](https://chatgpt.com/codex) → connect GitHub account
2. Select `dotcal604/market-data-bridge` repository
3. Configure environment setup script: `npm install && cd frontend && npm install && cd ..`
4. AGENTS.md auto-discovered — no additional config needed
5. Test: create a task from chatgpt.com/codex or tag `@codex` on an issue

### Google Jules
1. Go to [jules.google](https://jules.google) → sign in with Google
2. Connect GitHub → authorize `dotcal604/market-data-bridge`
3. Jules auto-reads AGENTS.md, clones repo into cloud VM
4. Test: add `jules` label to an issue, or paste issue link in dashboard

### GitHub Copilot (Agent HQ)
1. Copilot Pro+ or Enterprise subscription required
2. Assign Copilot to issues via GitHub web UI (cannot be done via CLI)
3. Custom agent profiles in `.github/agents/` auto-discovered
4. Monitor via Mission Control in GitHub web UI or VS Code

### Custom Agent Profiles
Located in `.github/agents/`. See files for specialized roles:
- `frontend-dev.agent.md` — Next.js dashboard components
- `test-writer.agent.md` — Vitest unit test generation
- `backend-dev.agent.md` — Express/TypeScript backend tasks
