#!/usr/bin/env node
// Stop hook: refuses to end the turn while a task started in this session
// is still open, and prints the protocol summary on screen otherwise.
import { readStdinJson, emit, loadState, openTasks, STAGE } from './hook-lib.mjs';

const input = readStdinJson();
const state = loadState(input.session_id);
const open = openTasks(state);
const done = (state.tasks || []).filter((t) => t.finished);

if (open.length && !input.stop_hook_active) {
  const cli = 'node .agents/skills/managing-system-context/scripts/context-cli.mjs';
  const ids = open.map((t) => t.id).join(', ');
  emit({
    decision: 'block',
    systemMessage: `⏳ ${STAGE.CLOSE} pendente · tarefa(s) aberta(s): ${ids}`,
    reason:
      `${STAGE.CLOSE} não foi executada. Tarefa(s) aberta(s): ${ids}. ` +
      'Antes de encerrar: grave decisões/débitos novos com upsert (summary em inglês, <= 250 chars) e rode ' +
      `${cli} task-finish --project ${state.project || '<projeto>'} --id <TASK_ID> --status DONE` +
      (state.source === 'api' ? ` --api-url "${state.apiUrl}"` : '') +
      '. Se a tarefa ficou bloqueada, use --status BLOCKED. Depois entregue a resposta final.',
  });
  process.exit(0);
}

if (open.length && input.stop_hook_active) {
  emit({ systemMessage: `⚠️ Turno encerrado com tarefa(s) ainda aberta(s): ${open.map((t) => t.id).join(', ')}` });
} else if (done.length) {
  emit({ systemMessage: `🏁 Protocolo completo · ${done.map((t) => t.id).join(', ')} · projeto ${state.project || '?'}` });
}
