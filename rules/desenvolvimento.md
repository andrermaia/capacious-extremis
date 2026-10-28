# Development playbook (spec → plan → tests → code → verify)

Read this when the request is to build a system, a feature or a non-trivial change. A one-line
fix, a question or a config tweak does not need it. The product's own rules (stack, checks,
deploy, test accounts) come from its `PLAYBOOK-<PRODUCT>` note and its `deploy-<repo>` skill;
when they disagree with this file, they win.

Adapted from the `superpowers` skills by Jesse Vincent (https://github.com/obra/superpowers,
MIT License, Copyright (c) 2025 Jesse Vincent), condensed into one file so it costs a read
instead of a session-start injection.

## 1. Understand before designing
- Search the base first (`search`, `get`, `impact <ENT-ID>`): earlier decisions, debts and
  gotchas on this module beat re-deriving them.
- Read the code you will touch and its tests. Name the files before proposing anything.
- Ask only what the base, the code and git history do not answer, one question at a time,
  multiple choice when possible. A sensible default is a decision you state, not a question.

## 2. Spec (what and why, no code)
- Goal in one sentence, who uses it, what is out of scope.
- Behaviour as observable cases: input → expected output, including errors and empty states.
- Data and privacy: what personal data it touches, who sees what, after which proof. Copy the
  user's privacy requirements verbatim when the spec goes to another session or agent.
- For anything bigger than an afternoon, show the spec to the user and wait for an OK.

## 3. Plan (small, ordered, verifiable)
- Steps of 2-15 minutes each; every step names its files, its test and how it is checked.
- Order: migrations and contracts first, then the API, then the front end, then deploy.
- Independent steps can go to parallel subagents in separate worktrees; pass them the context
  (they skip the knowledge-base protocol) and record what they find.

## 4. Tests first
- Write the failing test for the step, run it, see it fail for the right reason.
- Write the least code that makes it pass; run it again; then refactor with the test green.
- Test real behaviour through the public surface; mock only what crosses the process boundary.
- No test framework in the repo: state how the step will be checked by hand instead.

## 5. Debugging (when something fails)
- Reproduce first, read the whole error, check what changed recently (git log, diff).
- One hypothesis at a time, the smallest experiment that tells it apart; no shotgun edits.
- Three failed fixes in a row: stop and question the design, not the next patch.

## 6. Verify before claiming done
- Run the product's checks (typecheck, lint, tests, build) and read their output.
- Exercise the change for real: the endpoint, the screen, the job, with a test account.
- Say plainly what was not checked. "Should work" is not done.

## 7. Finish
- Commit by path with the repo's message convention; check `git log origin/<branch>..HEAD`
  before pushing (another session may have committed in the same tree).
- Deploy with the product's `deploy-<repo>` skill; confirm the health check afterwards.
- Record decisions, behaviours and debts in the base (one upsert, English, max 250 chars).
