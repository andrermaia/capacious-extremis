# System Context & Knowledge Management

Before analyzing, investigating, or writing code for ANY task, follow the `managing-system-context` protocol (`.agents/skills/managing-system-context/SKILL.md`). The hooks run it: the session-start hook brings the protocol, context and commands, each prompt hook opens the task and shows what the base already knows, the Stop hook closes it. The stages show on screen through the hooks: do not narrate them.

Always pass `--project <id>` (louza, qlave, qoincamera, qoinpass, qoinmsg, qoinpay, qpoker, qoinstore, qoinsite, qoinmodel, qoinreviews, projetos). The prompt hook detects it from the repository folder name.

The knowledge base is shared on a server whose address is `CONTEXT_API_URL` in the cloud environment variables. The CLI targets it by default — do not pass `--api-url`. Authentication is `CONTEXT_API_TOKEN` from the same variables. If the API is unreachable, writes fail on purpose: report it to the user, never use `--no-api` (that writes into a copy nobody else sees).

Your part: `query`/`search` when the injected hits are not enough, and before the final answer one batch `upsert --file -` with the new decisions, models or debts (English summaries, max 250 characters). Run `task-finish --project <p> --id <TASK_ID> --status BLOCKED` only when the work got stuck.

Subagents stay outside the protocol: do not ask them to run `context-cli`; pass them the context they need and record their findings yourself.

`.agents` in the repository is a symlink created by a SessionStart hook and listed in `.git/info/exclude`: never commit it.

Git: the source of truth and CI/CD (Gitea Actions) live on the Gitea at `TAKIUS_GIT_HOST`; GitHub is a mirror. When `TAKIUS_GIT_TOKEN` is set, each cloned repository has a `takius` remote: push work branches to it too (`git push -u takius <branch>`) so CI runs. After cloning a repository mid-session, run `sh ~/.agents/skills/managing-system-context/cloud/takius-git.sh` to give it the remote.
