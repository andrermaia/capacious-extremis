#!/usr/bin/env node
// Stop hook: closes the session's open tasks (DONE) by itself, saves the first
// lines of the final answer as the latest task's result (current_step
// "resultado: ..."), so the next session knows how it ended, and shows on screen
// how much knowledge the turn saved. What the agent did with the CLI (upserts, a
// task closed by hand as BLOCKED) is read from the transcript here, so no hook runs
// after every shell command. It never blocks the end of the turn: when the API is
// unreachable the task stays open and the next prompt continues it.
import {
  readStdinJson, emit, projectRoot, detectProject, loadState, saveState, openTasks, runCliAsync, callApi, apiUrl,
  finalAnswer, outcomeLine, turnCliCalls, recordTask, apiRequest, repoRelative, STAGE,
} from './hook-lib.mjs';

const input = readStdinJson();
if (input.agent_id) process.exit(0);

const root = projectRoot(input);
if (!root) process.exit(0); // outside every project: only the universal rules apply

const state = loadState(input.session_id);
const { upserts, finished, toolUses, edited, upserted } = turnCliCalls(input);
// What this turn saved is about the files it edited: link them, so the edit hook can warn
// whoever edits those files next (any clone, any session, any agent).
const linking = edited.length && upserted.length
  ? Promise.all(upserted.map(({ project, ids }) => apiRequest(root, 'POST', `paths?project=${encodeURIComponent(project)}`,
    { items: ids.map((id) => ({ id, paths: edited.map((f) => repoRelative(f, root)), mode: 'append' })) }, { timeoutMs: 6000 })))
  : null;
// Tasks the agent closed itself (BLOCKED, or DONE by habit) keep their status.
for (const f of finished) {
  const task = (state.tasks || []).find((t) => t.id === f.id);
  if (task) Object.assign(task, { finished: true, finishedBy: `agent (${f.status})` });
}
let open = openTasks(state);
// A short prompt ("sim, pode") opened no task; if the turn did work after all, record it now.
if (!open.length && state.turn?.trivial && toolUses > 0) {
  const project = state.project || detectProject(input, root).project;
  const desc = `${state.turn.prompt || 'pedido curto'}${state.lastDesc ? ` (continuação: ${state.lastDesc})` : ''}`.slice(0, 200);
  const started = await callApi(root, ['task-start', '--project', project, '--module', state.lastModule || 'general', '--desc', desc, '--api-url', apiUrl()], { timeoutMs: 7000 });
  if (started.ok && started.data?.id) {
    recordTask(state, { id: started.data.id, module: state.lastModule || 'general', project, by: 'on-stop (pedido curto)' });
    open = openTasks(state);
  }
}
if (!open.length && !upserts) {
  await linking;
  saveState(input.session_id, state);
  process.exit(0);
}

const fallbackProject = state.project || detectProject(input, root).project;
const closed = [];
const failed = [];
const projectOf = (task) => task.project || fallbackProject;
const outcome = open.length ? outcomeLine(finalAnswer(input)) : null;
const latest = [...open].sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt))).at(-1);
const saving = outcome
  ? callApi(root, ['task-step', '--project', projectOf(latest), '--id', latest.id, '--step', `resultado: ${outcome}`, '--api-url', apiUrl()], { timeoutMs: 7000 })
  : null;
const [results] = await Promise.all([
  Promise.all(open.map((task) =>
    callApi(root, ['task-finish', '--project', projectOf(task), '--id', task.id, '--status', 'DONE', '--api-url', apiUrl()], { timeoutMs: 7000 }))),
  saving,
  linking,
]);
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

state.turn = { ...(state.turn || {}), reminded: false };
saveState(input.session_id, state);

const saved = upserts ? `${upserts} conhecimento(s) gravado(s)` : 'nada gravado na base';
const parts = [];
if (closed.length) parts.push(`🏁 ${STAGE.CLOSE} · ${closed.join(', ')} fechada(s) · ${saved}`);
else if (!failed.length) parts.push(`🏁 ${STAGE.CLOSE} · ${saved}`);
if (failed.length) parts.push(`⚠️ não consegui fechar ${failed.join(', ')}; segue aberta e o próximo pedido continua nela`);
emit({ systemMessage: parts.join(' · ') });
