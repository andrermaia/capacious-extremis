#!/usr/bin/env node
// SessionStart hook (startup, resume, clear, compact): hands a new or compacted
// session its project context once, instead of on every prompt — module list,
// work in progress in other sessions, blocked tasks, the latest results and the
// knowledge items still in progress. It also refreshes the universal rules files
// in the background (sync-rules, at most every 10 minutes).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  readStdinJson, emit, projectRoot, detectProject, loadState, saveState, runCliAsync, callApi, withLocalFallback,
  saveModulesCache, stateFile, scriptPath, cliEnv, apiUrl, protocolText, CLI,
} from './hook-lib.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_MS = 2 * DAY_MS;
const BLOCKED_MS = 14 * DAY_MS;
const ITEM_MS = 14 * DAY_MS;

const input = readStdinJson();
if (input.agent_id) process.exit(0);

const root = projectRoot(input);
if (!root) process.exit(0); // outside every project: only the universal rules apply
const { project, folder } = detectProject(input, root);
const url = apiUrl();
const state = loadState(input.session_id);
const read = (args) => callApi(root, [...args, '--project', project, '--api-url', url], { timeoutMs: 8000 });

// Background jobs, detached and throttled across sessions by stamp files.
inBackground('sync-rules', 10 * 60 * 1000, [scriptPath('sync-rules.mjs'), '--quiet']);
inBackground('hygiene', 7 * DAY_MS, [scriptPath('hygiene.mjs'), '--fix', '--save', '--quiet']);
// The local cache is what reads fall back to when the API is unreachable: keep it a week fresh at most.
inBackground('pull', 7 * DAY_MS, [scriptPath('context-cli.mjs'), 'pull']);

const [modulesRaw, open, blocked, done, inProgress, hygiene] = await Promise.all([
  read(['list-modules']),
  read(['list-tasks', '--status', 'IN_PROGRESS', '--limit', '30']),
  read(['list-tasks', '--status', 'BLOCKED', '--limit', '10']),
  read(['list-tasks', '--status', 'DONE', '--limit', '30']),
  read(['query', '--phase', 'in_progress']),
  callApi(root, ['get', 'HYGIENE-REPORT', '--project', 'global', '--api-url', url], { timeoutMs: 8000 }),
]);
const listing = withLocalFallback(root, ['list-modules', '--project', project], modulesRaw);
const modules = listing.ok && Array.isArray(listing.data) ? listing.data : [];
if (listing.source === 'api' && modules.length) saveModulesCache(project, modules);

const rows = (r) => (r.ok && Array.isArray(r.data) ? r.data : []);
const now = Date.now();
const age = (iso) => {
  const h = Math.round((now - Date.parse(iso)) / 3600000);
  return h < 1 ? 'agora há pouco' : h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
};
const cut = (s, n) => {
  const text = String(s || '').replace(/\s+/g, ' ').trim();
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
};
const mine = new Set((state.tasks || []).map((t) => t.id));
const fresh = (t, ms) => now - Date.parse(t.updated_at) < ms && !mine.has(t.id);
const realStep = (t) => t.current_step && t.current_step !== 'Task started';
const taskLine = (t) => `- ${t.id} · ${t.module} · ${age(t.updated_at)} · ${cut(t.task_description, 70)}${realStep(t) ? ` — ${cut(t.current_step, 70)}` : ''}`;

const sections = [];
const openNow = rows(open).filter((t) => fresh(t, RECENT_MS)).slice(0, 4);
if (openNow.length) sections.push('Em andamento em outras sessões (48 h):', ...openNow.map(taskLine));
const stuck = rows(blocked).filter((t) => fresh(t, BLOCKED_MS)).slice(0, 3);
if (stuck.length) sections.push('Bloqueadas (14 dias):', ...stuck.map(taskLine));
const results = rows(done).filter((t) => /^resultado:/i.test(t.current_step || '')).slice(0, 3);
if (results.length) {
  sections.push('Resultados recentes:',
    ...results.map((t) => `- ${age(t.updated_at)} · ${cut(t.task_description, 60)} → ${cut(String(t.current_step).replace(/^resultado:\s*/i, ''), 110)}`));
}
const pending = rows(inProgress).filter((k) => now - Date.parse(k.updated_at) < ITEM_MS).slice(0, 4);
if (pending.length) {
  sections.push('Itens em andamento na base (14 dias):', ...pending.map((k) => `- ${k.id}${k.tasks_progress ? ` (${k.tasks_progress})` : ''} · ${cut(k.summary, 110)}`));
}

// The weekly hygiene report, while it still has findings.
if (hygiene.ok && hygiene.data?.knowledge_type === 'technical_debt') {
  sections.push('Faxina da base:', `- ${cut(hygiene.data.summary, 220)} (detalhes: ${CLI} get HYGIENE-REPORT --project global)`);
}

state.project = project;
state.sessionContext = { at: new Date().toISOString(), source: input.source || 'startup' };
saveState(input.session_id, state);

const moduleLine = modules.length
  ? modules.map((m) => m.module).join(', ')
  : '(nenhum módulo cadastrado — rode bootstrap-scan ou init)';
const context = [
  `[managing-system-context] Início de sessão · projeto ${project} (pasta ${folder}) · fonte ${listing.source === 'api' ? 'API' : 'cache local (somente leitura)'}${listing.apiError ? ` — API indisponível: ${cut(listing.apiError, 100)}` : ''}.`,
  `Módulos: ${moduleLine}`,
  ...(sections.length ? ['', ...sections] : []),
  '',
  protocolText(project),
].join('\n');

emit({
  systemMessage: `🗂️ Contexto da sessão · projeto ${project} · ${openNow.length} em andamento · ${results.length} resultado(s) recente(s)`,
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
});

// Runs a script detached, at most once per `everyMs` across all sessions (stamp file);
// the session never waits for it. CONTEXT_SYNC_RULES=0 turns every background job off (tests).
function inBackground(name, everyMs, args) {
  if (process.env.CONTEXT_SYNC_RULES === '0') return;
  const stamp = path.join(path.dirname(stateFile(name)), `${name}.stamp`);
  try {
    if (Date.now() - fs.statSync(stamp).mtimeMs < everyMs) return;
  } catch {}
  try {
    fs.writeFileSync(stamp, new Date().toISOString());
    spawn(process.execPath, args, { cwd: root, detached: true, stdio: 'ignore', windowsHide: true, env: cliEnv(root) }).unref();
  } catch {}
}
