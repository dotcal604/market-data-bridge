# Supabase + NocoDB — Architecture Sketch

> Task management layer for Market Data Bridge.
> Goal: structured task/research tracking with LLM-native CRUD via NocoDB MCP.

---

## Why This Stack

| Layer | Tool | Role |
|-------|------|------|
| **Database** | Supabase (Postgres) | Cloud Postgres with auto-generated REST API, RLS, real-time subscriptions |
| **UI** | NocoDB | Airtable-like spreadsheet UI on top of the same Postgres — no-code views, filters, kanban |
| **LLM access** | NocoDB MCP Server | Claude/agents read & write tasks, link to strategies, create research runs |
| **Local bridge** | bridge.db (SQLite) | Stays local — trades, evals, orders, analytics_jobs. No migration needed. |

### What moves to Supabase (cloud-native, multi-device, LLM-accessible)

- Task / feature tracking (replaces FEATURE-PLAN.md + manual tracking)
- Research run logs (experiment parameters, results, links to output files)
- Agent coordination metadata (who's working on what, status, blockers)
- Strategy metadata & notes (human annotations, links to Holly params)

### What stays in SQLite (low-latency, single-process, local data)

- `bridge.db` — evals, orders, executions, risk_config, analytics_jobs
- `holly.ddb` (DuckDB) — Bronze trade data
- `holly_trades.duckdb` — Silver layer
- All time-series and OHLCV data

---

## Schema Design

### Core Tables

```sql
-- ============================================================
-- tasks: Central task/feature tracker
-- ============================================================
CREATE TABLE tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'backlog'
                  CHECK (status IN ('backlog','todo','in_progress','blocked','review','done','cancelled')),
  priority      TEXT DEFAULT 'p2'
                  CHECK (priority IN ('p0','p1','p2','p3','p4')),
  category      TEXT DEFAULT 'feature'
                  CHECK (category IN ('feature','bug','research','ops','docs','refactor')),

  -- Agent delegation
  assigned_agent TEXT,          -- 'claude_code','codex','copilot','v0','qodo','mintlify','human'
  estimated_hours NUMERIC(4,1),
  actual_hours    NUMERIC(4,1),

  -- Lifecycle
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  due_date      DATE,

  -- Context
  source        TEXT,          -- 'feature_plan','analytics_roadmap','session','ad_hoc'
  phase         TEXT,          -- 'phase_1','phase_2', etc. (from FEATURE-PLAN.md)
  notes         TEXT,          -- free-form markdown

  -- Soft delete
  archived      BOOLEAN DEFAULT FALSE
);

-- Indexes
CREATE INDEX idx_tasks_status ON tasks(status) WHERE NOT archived;
CREATE INDEX idx_tasks_priority ON tasks(priority, status);
CREATE INDEX idx_tasks_agent ON tasks(assigned_agent) WHERE status IN ('todo','in_progress','blocked');

-- ============================================================
-- task_links: Junction table — tasks ↔ domain entities
-- ============================================================
CREATE TABLE task_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  linked_entity_type TEXT NOT NULL
                    CHECK (linked_entity_type IN (
                      'strategy',      -- Holly strategy name (e.g. "Downward Dog")
                      'symbol',        -- Ticker (e.g. "AAPL")
                      'trade',         -- Trade ID from holly.ddb
                      'research_run',  -- Reference to research_runs table
                      'script',        -- Analytics script path
                      'mcp_tool',      -- MCP tool name
                      'rest_endpoint', -- REST route path
                      'pr',            -- GitHub PR number
                      'doc'            -- Doc file path
                    )),
  linked_entity_id TEXT NOT NULL,     -- strategy name, ticker, trade ID, etc.
  label           TEXT,               -- optional display label
  created_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE(task_id, linked_entity_type, linked_entity_id)
);

CREATE INDEX idx_task_links_entity ON task_links(linked_entity_type, linked_entity_id);

-- ============================================================
-- research_runs: Experiment tracking
-- ============================================================
CREATE TABLE research_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,      -- "sizing_simulation_v1", "walk_forward_5fold"
  script_path     TEXT,               -- "analytics/holly_exit/scripts/30_sizing_simulation.py"

  -- Parameters
  parameters      JSONB DEFAULT '{}', -- full param dict for reproducibility

  -- Results
  status          TEXT DEFAULT 'running'
                    CHECK (status IN ('running','completed','failed','cancelled')),
  result_summary  JSONB DEFAULT '{}', -- key metrics (e.g. {"scenarios": 36, "best_expectancy": 15.30})
  output_path     TEXT,               -- path to output files

  -- Lifecycle
  started_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  duration_secs   INTEGER,

  -- Context
  notes           TEXT,
  triggered_by    TEXT DEFAULT 'manual'  -- 'manual','scheduler','agent'
);

CREATE INDEX idx_research_runs_status ON research_runs(status);

-- ============================================================
-- strategy_notes: Human annotations per Holly strategy
-- ============================================================
CREATE TABLE strategy_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name   TEXT NOT NULL UNIQUE,  -- "Downward Dog", "Bull Trap", etc.

  -- Assessments
  confidence      TEXT CHECK (confidence IN ('high','medium','low','untested')),
  live_ready       BOOLEAN DEFAULT FALSE,

  -- Context
  notes           TEXT,                  -- markdown: observations, edge thesis
  tags            TEXT[],                -- ['momentum','reversal','gap_play']

  -- Exit optimizer link
  optimal_exit_rule TEXT,                -- "fixed_trail", "chandelier_3x", etc.
  sharpe_ratio      NUMERIC(6,3),
  win_rate          NUMERIC(5,2),
  profit_factor     NUMERIC(6,3),
  wf_validated      BOOLEAN DEFAULT FALSE,

  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- agent_sessions: Track what each AI agent did
-- ============================================================
CREATE TABLE agent_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name      TEXT NOT NULL,        -- 'claude_code','codex','copilot'
  session_type    TEXT DEFAULT 'work',   -- 'work','review','research'

  summary         TEXT,                  -- what was accomplished
  files_changed   TEXT[],                -- list of file paths touched
  tasks_completed UUID[],                -- references to tasks.id

  started_at      TIMESTAMPTZ DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  machine         TEXT                   -- 'desktop','laptop'
);
```

### Entity-Relationship Overview

```
tasks ──┤ 1:N │── task_links ──┤ N:1 │──→ { strategy | symbol | trade | research_run | ... }
  │
  │ (optional)
  └── research_runs (linked via task_links where linked_entity_type = 'research_run')
  └── strategy_notes (linked via task_links where linked_entity_type = 'strategy')
  └── agent_sessions.tasks_completed[] (array of task IDs)
```

---

## Supabase Setup

### Project Creation

```
Organization: KLFH (mytpjnuenchlloqowkrr)
Project name:  market-data-bridge
Region:        us-east-1 (closest to IBKR gateway)
```

### Row-Level Security (RLS)

Single-user system → simple RLS. All tables get:

```sql
-- Enable RLS on all tables
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;

-- Single-user policy: authenticated users get full access
-- (service_role key for server-side, anon key for NocoDB)
CREATE POLICY "full_access" ON tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access" ON task_links FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access" ON research_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access" ON strategy_notes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "full_access" ON agent_sessions FOR ALL USING (true) WITH CHECK (true);
```

### Auto-Generated REST

Supabase auto-generates a PostgREST API. Every table immediately gets:
- `GET /rest/v1/tasks?status=eq.in_progress` — filtered reads
- `POST /rest/v1/tasks` — create
- `PATCH /rest/v1/tasks?id=eq.{uuid}` — update
- `DELETE /rest/v1/tasks?id=eq.{uuid}` — delete

No custom API code needed. NocoDB and MDB server both use this.

---

## NocoDB Integration

### Connection

NocoDB connects directly to the Supabase Postgres instance:

```
Host:     db.<project-ref>.supabase.co
Port:     5432 (or 6543 for connection pooler)
Database: postgres
User:     postgres
Password: <project-password>
```

NocoDB auto-discovers all tables and presents them as spreadsheet views.

### Views to Create in NocoDB

| View Name | Table | Type | Purpose |
|-----------|-------|------|---------|
| **Active Tasks** | tasks | Grid + Filter (status != done/cancelled) | Day-to-day task board |
| **Kanban Board** | tasks | Kanban (group by status) | Visual workflow |
| **By Agent** | tasks | Grid (group by assigned_agent) | Agent workload view |
| **Research Log** | research_runs | Grid (sort by started_at DESC) | Experiment history |
| **Strategy Card** | strategy_notes | Gallery | Strategy quick-reference cards |
| **This Week** | tasks | Calendar (due_date field) | Weekly planning |

### NocoDB MCP Server

NocoDB ships an MCP server (`nocodb-mcp-server`). Once configured, Claude agents can:

```
Tools available:
  nocodb_list_records    — query tasks with filters
  nocodb_create_record   — create new task
  nocodb_update_record   — update status, add notes
  nocodb_delete_record   — remove record
  nocodb_list_tables     — discover schema
```

**Agent workflow example:**
```
Agent starts session →
  1. nocodb_list_records(table="tasks", filter="status=in_progress AND assigned_agent=claude_code")
  2. Pick top priority task
  3. nocodb_update_record(id=..., status="in_progress", started_at=now())
  4. ... do the work ...
  5. nocodb_update_record(id=..., status="done", completed_at=now(), notes="...")
  6. nocodb_create_record(table="agent_sessions", summary="...", files_changed=[...])
```

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────┐
│  LOCAL (Desktop)                                        │
│                                                         │
│  bridge.db (SQLite)     holly.ddb (DuckDB)              │
│  ├─ evals               ├─ Bronze (raw trades)          │
│  ├─ orders               └─ Silver (holly_trades)       │
│  ├─ executions                                          │
│  ├─ risk_config          analytics/output/               │
│  └─ analytics_jobs       ├─ sizing_summary.csv          │
│                          ├─ sizing_scenarios.parquet     │
│                          └─ charts/*.png                 │
│                                                         │
│  MDB Server (Node.js)                                   │
│  ├─ 136 MCP tools                                       │
│  ├─ 81 REST endpoints                                   │
│  └─ Supabase client (new)  ──────────────────┐          │
│                                              │          │
└──────────────────────────────────────────────│──────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────┐
│  CLOUD (Supabase)                                       │
│                                                         │
│  Postgres                                               │
│  ├─ tasks              ← feature/bug/research tracking  │
│  ├─ task_links         ← junction to domain entities    │
│  ├─ research_runs      ← experiment log                 │
│  ├─ strategy_notes     ← human annotations              │
│  └─ agent_sessions     ← agent activity log             │
│                                                         │
│  PostgREST API (auto)                                   │
│  Real-time subscriptions (optional later)               │
│                                                         │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  UI / ACCESS LAYERS                                     │
│                                                         │
│  NocoDB           → Spreadsheet UI (self-hosted or cloud│
│  NocoDB MCP       → Claude agents read/write tasks      │
│  Supabase Dashboard → SQL editor, table viewer          │
│  Next.js frontend → (future) task widget on dashboard   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Migration Path: FEATURE-PLAN.md → tasks Table

Seed the tasks table from the existing feature plan:

```sql
-- Phase 1 tasks
INSERT INTO tasks (title, status, priority, category, assigned_agent, estimated_hours, phase, source) VALUES
  ('Exit Params MCP Tool', 'todo', 'p0', 'feature', 'claude_code', 2, 'phase_1', 'feature_plan'),
  ('Fix Direction Inference Bug', 'todo', 'p0', 'bug', 'claude_code', 2, 'phase_1', 'feature_plan'),
  ('Auto-Apply Exit Rules to Holly Alerts', 'todo', 'p1', 'feature', 'claude_code', 4, 'phase_1', 'feature_plan'),
  ('Exit Optimization Dashboard', 'todo', 'p1', 'feature', 'v0', 3, 'phase_1', 'feature_plan'),

-- Phase 2
  ('Headline Sentiment Scoring', 'todo', 'p1', 'feature', 'codex', 3, 'phase_2', 'feature_plan'),
  ('Unified News Feed', 'todo', 'p2', 'feature', 'copilot', 2, 'phase_2', 'feature_plan'),
  ('News-Triggered Alerts', 'todo', 'p3', 'feature', 'claude_code', 3, 'phase_2', 'feature_plan'),

-- Phase 3
  ('WebSocket Indicator Streaming', 'todo', 'p3', 'feature', 'claude_code', 4, 'phase_3', 'feature_plan'),
  ('Indicator Flags in Scan Output', 'todo', 'p2', 'feature', 'copilot', 2, 'phase_3', 'feature_plan'),
  ('Cross-Validate Indicators vs TA-Lib', 'todo', 'p2', 'research', 'codex', 2, 'phase_3', 'feature_plan'),

-- Phase 4
  ('Pre-Alert Scoring Model', 'todo', 'p2', 'feature', 'claude_code', 6, 'phase_4', 'feature_plan'),
  ('Strategy-Specific Position Sizing', 'todo', 'p2', 'feature', 'claude_code', 3, 'phase_4', 'feature_plan'),
  ('Walk-Forward Validation', 'todo', 'p1', 'research', 'codex', 4, 'phase_4', 'feature_plan'),

-- Phase 5
  ('Frontend Dashboard Polish', 'todo', 'p3', 'feature', 'v0', 4, 'phase_5', 'feature_plan'),
  ('Test Coverage for New Features', 'todo', 'p4', 'docs', 'qodo', 2, 'phase_5', 'feature_plan'),
  ('Documentation Update', 'todo', 'p4', 'docs', 'mintlify', 1, 'phase_5', 'feature_plan');

-- Link tasks to strategies/scripts
INSERT INTO task_links (task_id, linked_entity_type, linked_entity_id, label) VALUES
  ((SELECT id FROM tasks WHERE title = 'Fix Direction Inference Bug'),
   'script', 'analytics/holly_exit/engine/data_loader.py', 'Direction inference logic');
```

### Research Runs — Backfill Existing

```sql
-- Record the sizing simulation that already ran
INSERT INTO research_runs (name, script_path, parameters, status, result_summary, completed_at, triggered_by)
VALUES (
  'sizing_simulation_v1',
  'analytics/holly_exit/scripts/30_sizing_simulation.py',
  '{"engines": ["baseline","fixed_notional","hybrid_risk_cap"], "scenarios": 36, "trades": 28875}',
  'completed',
  '{"scenarios": 36, "rows": 1039500, "price_baseline_pnl": 79356, "vendor_baseline_pnl": 57845537, "best_hybrid_expectancy": 15.30}',
  now(),
  'agent'
);
```

---

## MDB Server Integration (Optional Phase)

If we want the MDB server itself to read/write tasks (e.g., analytics_jobs → research_runs sync):

### New env vars

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...   # for server-side operations
```

### New dependency

```bash
npm install @supabase/supabase-js
```

### New module: `src/supabase/client.ts`

```typescript
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);
```

### New MCP tools (future)

- `get_tasks` — list tasks with filters (status, priority, agent)
- `update_task` — change status, add notes
- `create_task` — add new task from agent context
- `log_research_run` — record experiment with params + results
- `get_strategy_notes` — read human annotations for a strategy

These would complement the NocoDB MCP tools with tighter domain integration.

---

## Implementation Steps

| Step | Action | Time |
|------|--------|------|
| 1 | Create Supabase project (us-east-1, under KLFH org) | 2 min |
| 2 | Run schema migration (DDL above) | 5 min |
| 3 | Seed tasks from FEATURE-PLAN.md | 5 min |
| 4 | Backfill research_runs with existing experiments | 5 min |
| 5 | Install NocoDB (Docker or cloud) and connect to Supabase Postgres | 15 min |
| 6 | Create NocoDB views (kanban, grid, calendar) | 10 min |
| 7 | Configure NocoDB MCP server for Claude Code | 10 min |
| 8 | Add SUPABASE_URL/KEY to MDB .env | 2 min |
| 9 | (Optional) Build `src/supabase/client.ts` + MCP tools | 2-3h |

**Total setup: ~1 hour for basic stack, +3h for MDB integration.**

---

## Cost

| Component | Cost | Notes |
|-----------|------|-------|
| Supabase Free tier | $0 | 500 MB storage, 2 GB transfer, 50K MAU |
| NocoDB (self-hosted Docker) | $0 | Runs on desktop alongside MDB |
| NocoDB Cloud (alternative) | $0 (free tier) | 1,000 records free |

Task management at this scale fits entirely in free tiers.

---

## Open Questions

1. **NocoDB hosting**: Self-hosted Docker on desktop vs NocoDB Cloud? Docker is free + unlimited, but needs to be running. Cloud is always-on but has record limits.

2. **Real-time sync**: Do agents need real-time task updates? Supabase supports WebSocket subscriptions, but polling every session-start is probably sufficient.

3. **analytics_jobs migration**: Should `analytics_jobs` (currently in bridge.db) move to Supabase as `research_runs`? Pro: unified tracking. Con: adds latency to local job logging.

4. **Strategy notes source-of-truth**: Should `strategy_notes` replace the exit optimizer JSON files, or coexist as an annotation layer?

5. **FEATURE-PLAN.md retirement**: Once tasks are in Supabase, do we keep FEATURE-PLAN.md as a static snapshot or delete it?
