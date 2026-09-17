#!/usr/bin/env node
// PreToolUse hook (Edit|Write|NotebookEdit): denies file edits while no
// task is open in this session, so Stage 2 always precedes code changes.
// Files under .agents/ and .claude/ are exempt so the skill and hooks
// themselves can be maintained.
import { readStdinJson, emit, loadState, openTasks, STAGE } from './hook-lib.mjs';

const input = readStdinJson();
const target = String(input.tool_input?.file_path || input.tool_input?.notebook_path || '').replace(/\\/g, '/');
if (/\/(\.agents|\.claude)\//.test(target) || /\/CLAUDE\.md$/.test(target)) process.exit(0);

const state = loadState(input.session_id);
if (openTasks(state).length > 0) process.exit(0);

const cli = 'node .agents/skills/managing-system-context/scripts/context-cli.mjs';
emit({
  systemMessage: `⛔ ${STAGE.TASK} pendente · edição bloqueada até task-start`,
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      `Nenhuma tarefa aberta nesta sessão. Antes de editar arquivos execute ${STAGE.TASK}: ` +
      `${cli} task-start --project ${state.project || '<projeto>'} --module <módulo> --desc "<pedido>"` +
      (state.source === 'api' ? ` --api-url "${state.apiUrl}"` : '') +
      ' e então repita a edição.',
  },
});
