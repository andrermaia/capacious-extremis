# System Context & Knowledge Management

Before analyzing, investigating, or writing code for ANY task, you MUST follow the `managing-system-context` protocol (`.agents/skills/managing-system-context/SKILL.md`). The hooks open the task on each prompt and close it at the end of the turn; your part is `query` and `upsert`. **Announce each stage to the user in text**, with these exact labels: `Etapa 1/3 · Contexto`, `Etapa 2/3 · Tarefa`, `Etapa 3/3 · Encerramento`.

Always pass `--project <id>` (louza, qlave, qoincamera, qoinpass, qoinmsg, qoinpay, qpoker, qoinstore, qoinsite, qoinmodel, qoinreviews, projetos). The prompt hook detects it from the repository folder name.

The knowledge base is shared on the Takius server: `https://api.takius.com.br/v1/context`. The CLI targets it by default — do not pass `--api-url`. Authentication is `CONTEXT_API_TOKEN` from the cloud environment variables. If the API is unreachable, writes fail on purpose: report it to the user, never use `--no-api` (that writes into a copy nobody else sees).

1. **Etapa 1/3 · Contexto**: `node .agents/skills/managing-system-context/scripts/context-cli.mjs query --project <p> --module <module>`
2. **Etapa 2/3 · Tarefa**: the prompt hook already opened the task and injected its `TASK-...` id — mention it, do not run `task-start`. Optional on long operations: `task-step --id <TASK_ID> --step "<step>"`.
3. **Etapa 3/3 · Encerramento**: before the final answer, upsert new decisions, models or debts (summaries in **English**, max **250 characters**) and update progress. The Stop hook closes the task as `DONE`; run `task-finish --project <p> --id <TASK_ID> --status BLOCKED` only when the work got stuck.

Subagents stay outside the protocol: do not ask them to run `context-cli`; pass them the context they need and record their findings yourself.

`.agents` in the repository is a symlink created by a SessionStart hook and listed in `.git/info/exclude`: never commit it.

Git: the source of truth and CI/CD (Gitea Actions) live on `git.takius.com.br`; GitHub is a mirror. When `TAKIUS_GIT_TOKEN` is set, each cloned repository has a `takius` remote: push work branches to it too (`git push -u takius <branch>`) so CI runs. After cloning a repository mid-session, run `sh ~/.agents/skills/managing-system-context/cloud/takius-git.sh` to give it the remote.
