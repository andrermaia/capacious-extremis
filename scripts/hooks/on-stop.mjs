#!/usr/bin/env node
// Stop hook: closes the session's open tasks (DONE) by itself and shows on
// screen how much knowledge the turn saved. It never blocks the end of the
// turn: when the API is unreachable the task stays open and the next prompt
// hook carries it on.
import {
  readStdinJson, emit, projectRoot, detectProject, loadState, saveState, openTasks, runCliAsync, apiUrl, STAGE,
} from './hook-lib.mjs';

const input = readStdinJson();
if (input.agent_id) process.exit(0);

const state = loadState(input.session_id);
const open = openTasks(state);
const upserts = state.turn?.upserts || 0;
if (!open.length && !upserts) process.exit(0);

const root = projectRoot(input);
const fallbackProject = state.project || detectProject(input, root).project;
const closed = [];
const failed = [];
const results = await Promise.all(open.map((task) =>
  runCliAsync(root, ['task-finish', '--project', task.project || fallbackProject, '--id', task.id, '--status', 'DONE', '--api-url', apiUrl()], { timeoutMs: 7000 })));
for (const [i, task] of open.entries()) {
  const r = results[i];
  if (r.ok) {
    task.finished = true;
    task.finishedBy = 'on-stop';
    closed.push(task.id);
  } else {
    failed.push(`${task.id} (${String(r.error).slice(0, 80)})`);
  }
}

state.turn = { ...(state.turn || {}), upserts: 0, reminded: false };
saveState(input.session_id, state);

const saved = upserts ? `${upserts} conhecimento(s) gravado(s)` : 'nada gravado na base';
const parts = [];
if (closed.length) parts.push(`🏁 ${STAGE.CLOSE} · ${closed.join(', ')} fechada(s) · ${saved}`);
else if (!failed.length) parts.push(`🏁 ${STAGE.CLOSE} · ${saved}`);
if (failed.length) parts.push(`⚠️ não consegui fechar ${failed.join(', ')}; segue aberta e o próximo pedido continua nela`);
emit({ systemMessage: parts.join(' · ') });
