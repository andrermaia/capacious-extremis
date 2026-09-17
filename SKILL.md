---
name: managing-system-context
description: Use when starting any AI agent task, before analyzing or writing code, to synchronize system context and architecture decisions from the database, and before ending execution to persist task progress.
---

# Managing System Context

## Overview

A structured, database-backed knowledge and task persistence system for AI agents. It ensures persistent memory across sessions, eliminates monolithic documentation bloat, and enforces strict token-efficient context retrieval (concise English summaries <= 250 characters per item).

## When to Use

- At the **very start of every prompt** or task before answering, investigating, or writing code.
- When working on new projects (greenfield) to log requirements, domain models, and architecture decisions.
- When working on existing codebases (brownfield) to scan, partition, and retrieve module architecture, current behaviors, and technical debt.
- At the **end of every task** to update task progress (`01/25`), log new decisions/debts, and close active tasks.

## On-Screen Step Announcements

Every stage MUST be announced to the user in plain text **before** its command runs, using exactly these labels so the user can follow the protocol on screen:

| Stage | Label to print | When |
|---|---|---|
| 1 | `Etapa 1/3 · Contexto` | before `list-modules` / `query` |
| 2 | `Etapa 2/3 · Tarefa` | before `task-start`; on `task-step` print the step text |
| 3 | `Etapa 3/3 · Encerramento` | before `upsert` / `task-finish` |

Example: `Etapa 2/3 · Tarefa — abrindo TASK para o módulo louza_fe`. The Claude Code hooks (see below) echo the same labels as system messages, so the two views stay aligned.

## Target Selection (`--project` / `--api-url`)

- Always pass `--project <id>`. The knowledge base holds one row set per project (`louza`, `qlave`, `qoincamera`, `qoinpass`, `qoinmsg`, `qoinpay`, `qpoker`, `qoinstore`, `qoinsite`, `qoinmodel`, `qoinreviews`); the default is the working-directory basename, which is usually wrong from a sub-folder.
- Prefer the central server with `--api-url "https://takius.com.br/api/v1/context"` (or `CONTEXT_API_URL`). If the API is unreachable the CLI returns `{"error": ...}` and does **not** fall back: drop `--api-url` to use the local `.agents/context.db`. The `UserPromptSubmit` hook probes the API on every prompt and tells you which flags to use.

## Enforcement via Claude Code Hooks

`scripts/hooks/` ships four zero-dependency hooks wired in the project's `.claude/settings.json`:

| Hook | Event | Effect |
|---|---|---|
| `on-prompt.mjs` | `UserPromptSubmit` | Detects the project from `cwd`, runs `list-modules` (API, then local), injects the protocol + module list as context, shows `Etapa 1/3` on screen |
| `on-edit-guard.mjs` | `PreToolUse` on `Edit\|Write\|NotebookEdit` | **Denies** file edits until a `task-start` was observed in the session (files under `.agents/`, `.claude/` and `CLAUDE.md` are exempt) |
| `on-cli-call.mjs` | `PostToolUse` on `Bash\|PowerShell` | Watches `context-cli.mjs` calls, records open/finished tasks per session, prints the stage of each call |
| `on-stop.mjs` | `Stop` | **Blocks the end of the turn** while a task is open and sends the `task-finish` instruction back to the agent |

Session state lives in `<tmpdir>/claude-context-hooks/<session_id>.json`. Known gap: edits made through shell commands (`sed`, heredocs) bypass the edit guard; the Stop hook still catches the unfinished task.

Install in another repository:

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.agents/skills/managing-system-context/scripts/hooks/on-prompt.mjs\"", "timeout": 30 }] }],
    "PreToolUse": [{ "matcher": "Edit|Write|NotebookEdit", "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.agents/skills/managing-system-context/scripts/hooks/on-edit-guard.mjs\"" }] }],
    "PostToolUse": [{ "matcher": "Bash|PowerShell", "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.agents/skills/managing-system-context/scripts/hooks/on-cli-call.mjs\"" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.agents/skills/managing-system-context/scripts/hooks/on-stop.mjs\"" }] }]
  }
}
```

## The Three-Stage Agent Protocol

Every interaction MUST execute the three stages in order:

```dot
digraph context_lifecycle {
    "User Prompt" [shape=doublecircle];
    "Stage 1: Pre-Execution Hook\n(Query modules & context)" [shape=box];
    "Stage 2: Execution Hook\n(Register task & progress)" [shape=box];
    "Stage 3: Post-Execution Hook\n(Upsert decisions, debts & finish task)" [shape=box];
    "Final Response to User" [shape=doublecircle];

    "User Prompt" -> "Stage 1: Pre-Execution Hook\n(Query modules & context)";
    "Stage 1: Pre-Execution Hook\n(Query modules & context)" -> "Stage 2: Execution Hook\n(Register task & progress)";
    "Stage 2: Execution Hook\n(Register task & progress)" -> "Stage 3: Post-Execution Hook\n(Upsert decisions, debts & finish task)";
    "Stage 3: Post-Execution Hook\n(Upsert decisions, debts & finish task)" -> "Final Response to User";
}
```

---

### Stage 1: Pre-Execution Hook (Context Loading)

Before writing any code or answering complex architecture queries:

1. **List Modules**:
   ```bash
   node .agents/skills/managing-system-context/scripts/context-cli.mjs list-modules
   ```
   *Consumes ~30 tokens. Returns existing modules and item counts.*

2. **If database is empty:**
   - **For existing projects (brownfield)**: Run initial discovery scan:
     ```bash
     node .agents/skills/managing-system-context/scripts/bootstrap-scan.mjs --import --db-path .agents/context.db
     ```
   - **For new projects (greenfield)**: Initialize database and record user requirements:
     ```bash
     node .agents/skills/managing-system-context/scripts/context-cli.mjs init
     ```

3. **Query Relevant Module**:
   ```bash
   node .agents/skills/managing-system-context/scripts/context-cli.mjs query --module <module_name>
   ```
   *Returns concise English summaries (max 250 chars) of architecture decisions, current behavior, and technical debt.*

4. **On-Demand Deep Dive (Only if necessary)**:
   If a specific record requires full design specifications or code snippets:
   ```bash
   node .agents/skills/managing-system-context/scripts/context-cli.mjs get <ID>
   ```

---

### Stage 2: Execution Hook (Task Tracking)

1. **Start the Active Task**:
   ```bash
   node .agents/skills/managing-system-context/scripts/context-cli.mjs task-start --module <module_name> --desc "<brief user request>"
   ```
   *Returns the generated `id` (e.g. `TASK-M3K9...`).*

2. **Update Steps During Complex Operations**:
   ```bash
   node .agents/skills/managing-system-context/scripts/context-cli.mjs task-step --id <TASK_ID> --step "Created database schema and migration"
   ```

---

### Stage 3: Post-Execution Hook (Persistence & Closure)

Before delivering your final response to the user:

1. **Record New Architecture Decisions or Technical Debt**:
   If your implementation introduced or identified architecture choices, schema changes, or debt:
   ```bash
   node .agents/skills/managing-system-context/scripts/context-cli.mjs upsert \
     --id "AUTH-DEC-002" \
     --module "auth" \
     --feature "oauth2" \
     --type "architecture_decision" \
     --phase "in_progress" \
     --progress "02/10" \
     --summary "OAuth2 Google provider integration using PKCE flow." \
     --details "Full implementation details and redirect URI config."
   ```

2. **Mark Task Finished**:
   ```bash
   node .agents/skills/managing-system-context/scripts/context-cli.mjs task-finish --id <TASK_ID> --status DONE
   ```

---

## Data Model & Constraints

### Summary Field Constraints
- **Language**: MUST be in **English** (consumes fewer tokens).
- **Length**: Maximum of **250 characters**. The CLI will strictly reject any input exceeding 250 characters. Keep it brief, factual, and actionable.

### Valid Enum Values

| Field | Permitted Values |
|---|---|
| `knowledge_type` | `architecture_decision`, `system_model`, `current_behavior`, `future_revision`, `technical_debt` |
| `phase` | `implemented`, `in_progress`, `queued`, `deprioritized` |
| `tasks_progress` | `XX/YY` (e.g. `01/25`) — required when `phase = in_progress` |
| `status` (tasks) | `PLANNED`, `IN_PROGRESS`, `DONE`, `BLOCKED` |

---

## Database Configuration

The database backend is completely abstracted via `context-cli.mjs`:

1. **Default (Zero-Config SQLite)**:
   - File location: `.agents/context.db`
   - Uses Node.js 24 native `node:sqlite`. No external dependencies or installation required.

2. **Custom Location or Remote DB**:
   - Set environment variables or pass flags:
     - `--db-path <path>` or `CONTEXT_DB_PATH=<path>`
     - `--project <id>` or `PROJECT_ID=<name>`
   - To connect to remote services (e.g. Supabase, PostgreSQL), configure connection credentials in `.env`.

---

## Rationalization Table

| Rationalization | Reality |
|---|---|
| "The task is simple, I don't need to load context." | Simple tasks frequently violate unwritten architecture constraints. Always query the module. |
| "I'll update the database on the next turn." | Next turns lose working memory. Run post-execution upserts immediately before closing. |
| "250 characters is too short to explain." | Use `summary` for the high-level fact (<250 chars) and pass detailed rationale to `--details`. |
| "I can write summaries in Portuguese." | English tokenization consumes 30-50% fewer tokens, maximizing context efficiency. |

## Red Flags - STOP and Correct

- Proceeding to answer or code without running `list-modules` or `query`.
- Storing verbose multi-paragraph explanations in `summary` instead of `details`.
- Ending a conversation turn without finishing the active task via `task-finish`.
- Hardcoding database connection strings inside conversation chat turns.
