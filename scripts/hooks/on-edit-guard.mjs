#!/usr/bin/env node
// PreToolUse hook (Edit|Write|NotebookEdit): makes sure a task is open before
// the main agent edits files. The prompt hook normally opened it already; when
// work resumes after the turn closed it (a background subagent finished, for
// instance) this hook opens a new one instead of denying the edit. It denies
// only when the shared base is unreachable. The first edit of each turn also
// carries the Stage 3 upsert reminder.
// Subagents are outside the protocol and pass straight through, as do files
// under .agents/ and .claude/ (the skill and hooks themselves) and CLAUDE.md.
import path from 'node:path';
import {
  readStdinJson, emit, projectRoot, detectProject, loadState, saveState, openTasks, recordTask,
  callApi, upsertReminder, apiUrl, DEFAULT_MODULE, STAGE, CLI, radarFor, loadPathsIndex, staleNote, draftLine,
} from './hook-lib.mjs';

const input = readStdinJson();
const root = projectRoot(input);
if (!root) process.exit(0); // outside every project: nothing to track
if (!apiUrl()) process.exit(0); // no API configured on this machine: session start says so

const target = String(input.tool_input?.file_path || input.tool_input?.notebook_path || '').replace(/\\/g, '/');
if (/\/(\.agents|\.claude)\//.test(target) || /\/CLAUDE\.md$/.test(target)) process.exit(0);

const state = loadState(input.session_id);

// File radar, for every agent (subagents too): what the base knows about this file, once
// per file per session, from the local index (no network).
const radar = [];
const seenKey = target.toLowerCase();
state.radarSeen ||= [];
if (!state.radarSeen.includes(seenKey)) {
  const rows = radarFor(target, loadPathsIndex());
  if (rows.length) {
    state.radarSeen.push(seenKey);
    radar.push(`Radar da base para ${path.basename(target)} (o que já se sabe deste arquivo; detalhes: ${CLI} get <ID> --project <projeto>):`,
      ...rows.map((r) => (r.draft ? draftLine(r) : `- ${r.project_id}/${r.id} · ${String(r.summary).slice(0, 180)}${staleNote(r.stale)}`)));
  }
}
const radarOut = (extra = {}, more = []) => {
  const ctx = [...radar, ...more].join('\n');
  return ctx ? { ...extra, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: ctx, ...(extra.hookSpecificOutput || {}) } } : extra;
};
if (input.agent_id) {
  if (radar.length) { saveState(input.session_id, state); emit(radarOut()); }
  process.exit(0);
}

const open = openTasks(state);
if (open.length > 0) {
  const remind = state.turn && !state.turn.reminded;
  if (remind) state.turn.reminded = true;
  if (remind || radar.length) {
    saveState(input.session_id, state);
    emit(radarOut({}, remind ? [upsertReminder(open.at(-1).id)] : []));
  }
  process.exit(0);
}

const project = state.project || detectProject(input, root).project;
const module = state.lastModule || DEFAULT_MODULE;
const desc = state.lastDesc ? `continuação: ${state.lastDesc}` : `edição de ${path.basename(target)}`;
const started = await callApi(root, ['task-start', '--project', project, '--module', module, '--desc', desc, '--api-url', apiUrl()], { timeoutMs: 8000 });
const id = started.ok ? started.data?.id : null;

if (id) {
  recordTask(state, { id, module, project, by: 'on-edit-guard' });
  state.project = project;
  state.turn = { ...(state.turn || { upserts: 0 }), reminded: true };
  saveState(input.session_id, state);
  emit({
    systemMessage: `🟢 ${STAGE.TASK} · ${id} aberta automaticamente (módulo ${module})`,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: [...radar, `${STAGE.TASK}: nenhuma tarefa estava aberta; o hook abriu ${id}. ${upsertReminder(id)}`].join('\n'),
    },
  });
  process.exit(0);
}

emit({
  systemMessage: `⛔ ${STAGE.TASK} · edição bloqueada: não consegui abrir a tarefa`,
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      `${STAGE.TASK}: não consegui abrir a tarefa automaticamente (${String(started.error).slice(0, 160)}). ` +
      'A base compartilhada parece fora do ar: avise o usuário e não use --no-api. Quando a API voltar, repita a edição.',
  },
});
