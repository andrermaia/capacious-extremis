# Managing System Context (Capacious Extremis)

> A token-efficient, database-backed system knowledge and task persistence skill for AI coding assistants (Claude Code, Gemini CLI, Antigravity, Roo/Cline, Codex).

## Overview

Modern AI agents often suffer from **context loss between sessions** or **token exhaustion** caused by reading large, monolithic documentation files on every prompt.

**Managing System Context** solves this by:
1. **Partitioning by Module**: Context is partitioned into functional modules (e.g., `auth`, `billing`, `reports`).
2. **Token Economy**: Fast queries return concise, factual summaries strictly constrained to **<= 250 characters** in **English** (~40-60 tokens).
3. **Task & Decision Lifecycle**: Tracks in-progress tasks, task counters (`01/25`), architecture decisions, and technical debt across turns.
4. **Zero-Config Storage**: Uses native Node.js 24 SQLite (`node:sqlite`) with zero external package installations, or connects to remote databases (Supabase, PostgreSQL).

---

## Directory Structure

```
├── SKILL.md                 # Agent instructions, triggers, and lifecycle protocols
├── references/
│   └── schema.sql           # SQL DDL for SQLite / Postgres / Supabase
├── scripts/
│   ├── context-cli.mjs      # Zero-dependency Node 24 CLI for database operations
│   ├── bootstrap-scan.mjs   # Brownfield codebase scanner to auto-discover modules
│   └── hooks/               # Claude Code hooks that enforce the protocol on every prompt
│       ├── on-prompt.mjs        # UserPromptSubmit: auto list-modules + protocol injection
│       ├── on-edit-guard.mjs    # PreToolUse: deny Edit/Write until a task is open
│       ├── on-cli-call.mjs      # PostToolUse: track task-start/finish, print stage on screen
│       └── on-stop.mjs          # Stop: refuse to end the turn with an open task
├── tests/                   # Automated test suite using Node.js native test runner
├── .gitignore
└── README.md
```

---

## Quick Start

### 1. Requirements
- Node.js >= 22.0.0 (Node 24+ recommended for built-in `node:sqlite`).

### 2. Run Tests
```bash
node --test tests/*.test.mjs
```

### 3. Initialize Database
```bash
node scripts/context-cli.mjs init
```
This creates `.agents/context.db` using `references/schema.sql`.

### 4. Scan an Existing Project (Brownfield)
```bash
node scripts/bootstrap-scan.mjs --import --db-path .agents/context.db
```

---

## CLI Commands

| Command | Description |
|---|---|
| `list-modules` | Lists all distinct modules with item counts (~30 tokens) |
| `query --module <m>` | Retrieves compact knowledge records (summaries <= 250 chars) |
| `get <id>` | Retrieves full details including extended markdown for a specific item |
| `upsert --id <id> ...` | Inserts or updates a decision/debt entry (enforces 250 char limit) |
| `task-start --module <m> --desc "<d>"` | Registers an active agent task |
| `task-step --id <id> --step "<s>"` | Updates current step of an active task |
| `task-finish --id <id> --status DONE` | Completes the active task |
| `list-tasks` | Lists recent agent tasks and their status |

---

## Enforcing the Protocol with Claude Code Hooks

Instructions in `CLAUDE.md` are advisory. To make the protocol mandatory, wire the hooks from `scripts/hooks/` into `.claude/settings.json` (full snippet in `SKILL.md`, section *Enforcement via Claude Code Hooks*):

- **UserPromptSubmit** runs `list-modules` for the project detected from `cwd` (remote API first, local SQLite as fallback) and injects the result plus the three-stage protocol into the model context.
- **PreToolUse** on `Edit|Write|NotebookEdit` denies edits until a `task-start` has been observed in the session.
- **PostToolUse** on `Bash|PowerShell` tracks `task-start` / `task-finish` and prints each stage on screen (`Etapa 1/3 · Contexto`, `Etapa 2/3 · Tarefa`, `Etapa 3/3 · Encerramento`).
- **Stop** blocks the end of the turn while a task is still open.

Set `CONTEXT_API_URL` to point the prompt hook at your server (default `https://takius.com.br/api/v1/context`).

## Agent Protocol

Add this rule to your project's `AGENTS.md` or `CLAUDE.md`:

```markdown
## System Context & Knowledge Management

Before analyzing, investigating, or writing code for ANY task, you MUST invoke the `managing-system-context` skill:

1. **Pre-Execution (Context Load)**:
   - Run: `node .agents/skills/managing-system-context/scripts/context-cli.mjs list-modules`
   - If empty on existing project, run bootstrap: `node .agents/skills/managing-system-context/scripts/bootstrap-scan.mjs --import --db-path .agents/context.db`
   - Query the target module: `node .agents/skills/managing-system-context/scripts/context-cli.mjs query --module <module_name>`
2. **Execution (Task Start)**:
   - Start active task: `node .agents/skills/managing-system-context/scripts/context-cli.mjs task-start --module <module_name> --desc "<user request>"`
3. **Post-Execution (Persistence & Exit)**:
   - If new decisions, models, or debts were identified, upsert them (summaries in **English**, maximum **250 characters**).
   - If progress on in-progress items changed, update progress (e.g. `02/25`).
   - Conclude task: `node .agents/skills/managing-system-context/scripts/context-cli.mjs task-finish --id <TASK_ID> --status DONE`
```

---

## License
MIT
