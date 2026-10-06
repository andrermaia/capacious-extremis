# System Context & Knowledge Management

Before analyzing, investigating, or writing code for ANY task, you MUST invoke the `managing-system-context` skill (`.agents/skills/managing-system-context/SKILL.md`). The protocol is enforced by hooks (edits are denied without an open task; the turn cannot end with an open task). **Announce each stage to the user in text before running it**, with these exact labels: `Etapa 1/3 · Contexto`, `Etapa 2/3 · Tarefa`, `Etapa 3/3 · Encerramento`.

Always pass `--project <id>` (louza, qlave, qoincamera, qoinpass, qoinmsg, qoinpay, qpoker, qoinstore, qoinsite, qoinmodel, qoinreviews, projetos). The prompt hook detects it from the repository folder name.

The knowledge base is shared on the Takius server: `https://api.takius.com.br/v1/context`. The CLI targets it by default — do not pass `--api-url`. Authentication is `CONTEXT_API_TOKEN` from the cloud environment variables. If the API is unreachable, writes fail on purpose: report it to the user, never use `--no-api` (that writes into a copy nobody else sees).

1. **Etapa 1/3 · Contexto**: `node .agents/skills/managing-system-context/scripts/context-cli.mjs query --project <p> --module <module>`
2. **Etapa 2/3 · Tarefa**: `node .agents/skills/managing-system-context/scripts/context-cli.mjs task-start --project <p> --module <module> --desc "<user request>"`; keep the returned `TASK-...` id. Use `task-step --id <TASK_ID> --step "<step>"` on long operations.
3. **Etapa 3/3 · Encerramento**: upsert new decisions, models or debts (summaries in **English**, max **250 characters**), update progress, then `node .agents/skills/managing-system-context/scripts/context-cli.mjs task-finish --project <p> --id <TASK_ID> --status DONE` — always with the literal id, never a shell variable.

`.agents` in the repository is a symlink created by a SessionStart hook and listed in `.git/info/exclude`: never commit it.
