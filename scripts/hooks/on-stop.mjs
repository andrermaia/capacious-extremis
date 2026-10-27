#!/usr/bin/env node
// Stop hook: closes the session's open tasks (DONE) by itself, saves the first
// lines of the final answer as the latest task's result (current_step
// "resultado: ..."), so the next session knows how it ended, and shows on screen
// how much knowledge the turn saved. What the agent did with the CLI (upserts, a
// task closed by hand as BLOCKED) is read from the transcript here, so no hook runs
// after every shell command. It never blocks the end of the turn: when the API is
// unreachable the task stays open and the next prompt continues it.
import path from 'node:path';
import {
  readStdinJson, emit, projectRoot, detectProject, loadState, saveState, openTasks, runCliAsync, callApi, apiUrl,
  finalAnswer, outcomeLine, turnCliCalls, recordTask, apiRequest, repoRelative, searchWords, STAGE,
} from './hook-lib.mjs';

const input = readStdinJson();
if (input.agent_id) process.exit(0);

const root = projectRoot(input);
if (!root) process.exit(0); // outside every project: only the universal rules apply
if (!apiUrl()) process.exit(0); // no API configured on this machine: session start says so

// A benchmark session (CONTEXT_BENCH=1, set by the A/B harness) keeps its result out of every
// later search and session start: a past run's answer to the same question must not reach the
// next run (the 16/10 recall runs were contaminated that way).
const RESULT_PREFIX = process.env.CONTEXT_BENCH === '1' ? 'ab-test resultado:' : 'resultado:';
// A draft needs a real piece of work: a few tool calls, not a one-line fix.
const DRAFT_MIN_TOOLS = 4;
const state = loadState(input.session_id);
// Where the session lives, for the background consolidation (scripts/consolidate.mjs): it reads
// the transcript once the session has gone quiet. Benchmark sessions stay out of it.
// Codex may send no path: the consolidation then finds its rollout by the session id.
Object.assign(state, { root, bench: process.env.CONTEXT_BENCH === '1', ...(input.transcript_path ? { transcript: input.transcript_path } : {}) });
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
  ? callApi(root, ['task-step', '--project', projectOf(latest), '--id', latest.id, '--step', `${RESULT_PREFIX} ${outcome}`, '--api-url', apiUrl()], { timeoutMs: 7000 })
  : null;
// Work that edited files under the root and saved nothing leaves a draft (module drafts, out of
// search and of the radar): the next session start lists it, and whoever resumes it saves the
// real row with "supersedes":"<draft id>". One draft per task: a later turn updates it.
const inside = (f) => {
  const rel = path.relative(root, path.resolve(f));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};
const draftFiles = upserts ? [] : edited.filter((f) => inside(f) && !/[\\/](\.agents|\.claude)[\\/]/.test(f) && !/(^|[\\/])CLAUDE\.md$/i.test(f));
let draftId = null;
const drafting = draftFiles.length && latest && toolUses >= DRAFT_MIN_TOOLS
  ? (async () => {
    const prompt = String(state.turn?.prompt || latest.desc || '').replace(/\s+/g, ' ').trim();
    const project = detectProject({ cwd: path.dirname(draftFiles[0]) }, root).project;
    const id = `DRAFT-${String(latest.id).replace(/^TASK-/, '')}`;
    const files = [...new Set(draftFiles.map((f) => repoRelative(f, root)))];
    const answer = String(finalAnswer(input) || '').trim();
    const summary = `Rascunho: ${prompt.slice(0, 120)}${outcome ? ` → ${outcome}` : ''}`.slice(0, 250);
    const saved = await apiRequest(root, 'POST', `upsert?project=${encodeURIComponent(project)}`, {
      id, module: 'drafts', feature: latest.module || 'general', knowledge_type: 'current_behavior', phase: 'queued', summary,
      keywords: searchWords(prompt).slice(0, 10).join(', ') || null, no_similar: true,
      details: `Pedido: ${prompt.slice(0, 600)}\n\nResposta final: ${answer.slice(0, 1500)}\n\nArquivos editados: ${files.join(', ')}\n\nTarefa: ${latest.id}`,
    }, { timeoutMs: 7000 });
    if (!saved.ok) return;
    draftId = `${project}/${id}`;
    await apiRequest(root, 'POST', `paths?project=${encodeURIComponent(project)}`, { items: [{ id, paths: files, mode: 'append' }] }, { timeoutMs: 6000 });
  })()
  : null;
const [results] = await Promise.all([
  Promise.all(open.map((task) =>
    callApi(root, ['task-finish', '--project', projectOf(task), '--id', task.id, '--status', 'DONE', '--api-url', apiUrl()], { timeoutMs: 7000 }))),
  saving,
  linking,
  drafting,
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

const saved = upserts ? `${upserts} conhecimento(s) gravado(s)` : draftId ? `nada gravado; rascunho ${draftId} para confirmar` : 'nada gravado na base';
const parts = [];
if (closed.length) parts.push(`🏁 ${STAGE.CLOSE} · ${closed.join(', ')} fechada(s) · ${saved}`);
else if (!failed.length) parts.push(`🏁 ${STAGE.CLOSE} · ${saved}`);
if (failed.length) parts.push(`⚠️ não consegui fechar ${failed.join(', ')}; segue aberta e o próximo pedido continua nela`);
emit({ systemMessage: parts.join(' · ') });
