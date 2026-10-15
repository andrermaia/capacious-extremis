## System Context & Knowledge Management

Before analyzing, investigating, or writing code for ANY task, you MUST follow the `managing-system-context` protocol. The hooks in `.claude/settings.json` open the task on each prompt and close it at the end of the turn; your part is `query` and `upsert`. **Announce each stage to the user in text**, with these exact labels: `Etapa 1/3 · Contexto`, `Etapa 2/3 · Tarefa`, `Etapa 3/3 · Encerramento`.

Always pass `--project <id>` (louza, qlave, qoincamera, qoinpass, qoinmsg, qoinpay, qpoker, qoinstore, qoinsite, qoinmodel, qoinreviews, projetos).

The knowledge base is **shared, on the Takius server**: `https://api.takius.com.br/v1/context` (PostgreSQL `agent_context`). The CLI targets it by default — do **not** pass `--api-url`. Authentication is `CONTEXT_API_TOKEN`, already set in `.claude/settings.local.json`.

`.agents/context.db` is only a read-only cache (`context-cli.mjs pull` refreshes it). If the API is down, reads fall back to the cache with a warning and **writes fail on purpose** — report the outage to the user instead of reaching for `--no-api`, which writes into a copy no other agent will ever see.

1. **Etapa 1/3 · Contexto (Pre-Execution)**:
   - The session-start hook injected the module list, the work in progress and the last results; the prompt hook injects the command syntax (no `list-modules`, no `--help`). Query the target module: `node .agents/skills/managing-system-context/scripts/context-cli.mjs query --project <p> --module <module_name>`
   - In doubt, search before asking: `node .agents/skills/managing-system-context/scripts/context-cli.mjs search <English keywords> --project <p>` (`--all` spans every project).
   - If empty on existing project, run bootstrap: `node .agents/skills/managing-system-context/scripts/bootstrap-scan.mjs --import --db-path .agents/context.db`
2. **Etapa 2/3 · Tarefa (Execution)**:
   - The prompt hook already opened the task and injected its `TASK-...` id: mention it, do **not** run `task-start`.
   - Optional on long operations: `task-step --id <TASK_ID> --step "<step>"`.
3. **Etapa 3/3 · Encerramento (Post-Execution)**:
   - Before the final answer, upsert new decisions, models, or debts (summaries in **English**, maximum **250 characters**) and update progress on in-progress items (e.g. `02/25`).
   - The Stop hook closes the task as `DONE` and saves the first lines of your final answer as its result. Run `task-finish --project <p> --id <TASK_ID> --status BLOCKED` only when the work got stuck.

**Subagents stay outside the protocol.** Do not ask them to run `context-cli`; pass them the context they need in the prompt and record their findings yourself. If you are a subagent, skip this section.
