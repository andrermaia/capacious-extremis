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
│       ├── on-session-start.mjs # SessionStart: protocol, open work, file-radar index
│       ├── on-prompt.mjs        # UserPromptSubmit: opens the task, injects search hits (+ excerpts)
│       ├── on-edit-guard.mjs    # PreToolUse: file radar, upsert reminder, deny only when the API is down
│       └── on-stop.mjs          # Stop: closes the task, saves the result, links edited files to saved rows
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

`get`, `search`, `query`, `neighbours` and `impact` print compact text; add `--json` for the raw answer.

---

## Enforcing the Protocol with Claude Code Hooks

Instructions in `CLAUDE.md` are advisory. To make the protocol mandatory, wire the hooks from `scripts/hooks/` into `.claude/settings.json` (full snippet in `SKILL.md`, section *Enforcement via Claude Code Hooks*):

- **SessionStart** injects, once per session and after each compaction, the module list, work in progress in other sessions, blocked tasks, the latest results and the knowledge items still in progress, and refreshes the universal rules files (`sync-rules`).
- **UserPromptSubmit** runs `list-modules` for the project detected from `cwd` (remote API first, local SQLite as fallback), opens the task itself (`task-start`) and injects the module list, the task id and the protocol into the model context.
- **PreToolUse** on `Edit|Write|NotebookEdit` reminds the main agent to `upsert` on the first edit of each turn and opens a task if none is open; it denies edits only when the API is unreachable. Subagents pass straight through.
- There is no PostToolUse hook: the Stop hook reads the turn's CLI calls (upserts, tasks closed by hand) from the transcript.
- **Stop** closes the open task (`DONE`) by itself; it never blocks the turn.

`scripts/install-hooks.mjs` puts the hooks in the user settings, so they run in every folder (and do nothing outside a project); `scripts/hygiene.mjs` is the weekly clean-up report, triggered by the session-start hook. The agent's part is `query` (Stage 1), `search` when in doubt, and `upsert` (Stage 3). Universal agent rules live in the base (project `global`, module `rules`) and `scripts/sync-rules.mjs` writes them into `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md` and the project's `CLAUDE.md`/`AGENTS.md` (see `SKILL.md`). Subagents stay outside the protocol. Codex (`install-hooks.mjs --codex`, trusted once in `/hooks`) and Antigravity CLI (`install-hooks.mjs --agy`, through `scripts/hooks/agy-adapter.mjs`) run the same hooks; agents without hooks still run `task-start` / `task-finish` by hand.

Set `CONTEXT_API_URL` (and `CONTEXT_API_TOKEN`) in the environment or in the `env` block of `<root>/.claude/settings.local.json` (or `~/.claude/settings.json`): there is no default address, so this public repository never names a server. Without it the CLI refuses writes and the hooks stay silent, saying so once at session start.

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

## Claude Code on the web

Cloud sessions do not load plugins or your local `~/.claude`, so `cloud/setup.sh` installs the skill
inside the VM: it clones this repository to `~/.agents/skills/managing-system-context`, registers the
protocol hooks in the VM's `~/.claude/settings.json`, writes the protocol to the VM's `~/.claude/CLAUDE.md`,
and a `SessionStart` hook links `~/.agents` into each cloned repository (excluded from git).

In claude.ai/code → environment settings:

- **Environment variables**: `CONTEXT_API_URL=<API base URL>`, `CONTEXT_API_TOKEN=<token>`; optionally
  `TAKIUS_GIT_HOST=<Gitea host>` with `TAKIUS_GIT_TOKEN=<Gitea token>` (repository read and write).
- **Network access**: Custom, add the API's host (and the Gitea host with the Gitea token), keep the
  default list.

With `TAKIUS_GIT_HOST` and `TAKIUS_GIT_TOKEN`, the `SessionStart` hook also runs `cloud/takius-git.sh`: git
authenticates on that host with the token (read from the environment, never written to disk) and every
repository cloned from `github.com/andrermaia/<name>` gets a `takius` remote at `<host>/andre/<name>.git`.
Override with `TAKIUS_GIT_OWNER`, `TAKIUS_GIT_USER`, `TAKIUS_GITHUB_OWNER`.
- **Setup script**:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/andrermaia/capacious-extremis/main/cloud/setup.sh | bash
  ```

Hooks only run in single-repository sessions.
