## System Context & Knowledge Management (only under `{{ROOT}}`)

When the working directory is inside `{{ROOT}}`, before analyzing, investigating, or writing code for ANY task, follow the context protocol below. Outside that folder, ignore this section (the universal rules above still apply everywhere).

**When the hooks run it** (the context already says `Tarefa TASK-… aberta pelo hook`, as in Codex once its hooks are trusted in `/hooks`): follow what they inject. They open and close the task; you only query and upsert, and you do not announce the stages. Otherwise, run it by hand as below.

Announce each stage to the user in text before running it, with these exact labels: `Etapa 1/3 · Contexto`, `Etapa 2/3 · Tarefa`, `Etapa 3/3 · Encerramento`.

CLI (written `ctx` below): `node {{CLI}}`. Reads (`get`, `search`, `query`, `impact`, `neighbours`) print compact text.

Always pass `--project <id>`, one of: louza, qlave, qoincamera, qoinpass, qoinmsg, qoinpay, qpoker, qoinstore, qoinsite, qoinmodel, qoinreviews, projetos.

The knowledge base is shared on a server (`CONTEXT_API_URL`, from the environment or the `env` block of `.claude/settings.local.json`); the CLI targets it by default, so do not pass `--api-url`. Authentication is the `CONTEXT_API_TOKEN` environment variable. If the API is down, reads fall back to the local cache with a warning and writes fail on purpose: report the outage to the user and never use `--no-api`.

1. **Etapa 1/3 · Contexto**: `ctx list-modules --project <project>`, then `ctx query --project <project> --module <module>`. In doubt, search before asking: `ctx search <English keywords> --project <project>` (`--all` spans every project). Map of systems and dependencies (ids `ENT-*`): `ctx impact <ENT-ID> --project <project>` lists what is affected if it changes or goes down; `ctx neighbours <ID> --project <project>` lists every link.
2. **Etapa 2/3 · Tarefa**: `ctx task-start --project <project> --module <module> --desc "<user request>"` and keep the returned `TASK-...` id. On long operations: `ctx task-step --project <project> --id <TASK_ID> --step "<step>"`.
3. **Etapa 3/3 · Encerramento**: if new decisions, models or debts were identified, upsert them all in one call: `ctx upsert --project <project> --file -` with a JSON array on stdin, each item `{"id", "module", "feature", "type": architecture_decision|system_model|current_behavior|future_revision|technical_debt, "phase": implemented|in_progress|queued|deprioritized, "progress": "02/25" (in_progress only), "summary": "<English, at most 250 characters>"}`; record the outcome with `ctx task-step --project <project> --id <TASK_ID> --step "resultado: <one line>"`, then `ctx task-finish --project <project> --id <TASK_ID> --status DONE`, with the literal task id.

Without that hook line, nothing enforces this protocol for you: close the task yourself before ending the turn.
