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
  readStdinJson, emit, projectRoot, detectProject, loadState, saveState, runCliAsync, withLocalFallback,
  saveModulesCache, stateFile, scriptPath, cliEnv, apiUrl, CLI, STAGE,
} from './hook-lib.mjs';

const SYNC_EVERY_MS = 10 * 60 * 1000;
const HYGIENE_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_MS = 48 * 60 * 60 * 1000;
const BLOCKED_MS = 14 * 24 * 60 * 60 * 1000;

const input = readStdinJson();
if (input.agent_id) process.exit(0);

const root = projectRoot(input);
if (!root) process.exit(0); // outside every project: only the universal rules apply
const { project, folder } = detectProject(input, root);
const url = apiUrl();
const state = loadState(input.session_id);
const read = (args) => runCliAsync(root, [...args, '--project', project, '--api-url', url], { timeoutMs: 8000 });

refreshRules();
runHygieneWeekly();

const [modulesRaw, open, blocked, done, inProgress, hygiene] = await Promise.all([
  read(['list-modules']),
  read(['list-tasks', '--status', 'IN_PROGRESS', '--limit', '30']),
  read(['list-tasks', '--status', 'BLOCKED', '--limit', '10']),
  read(['list-tasks', '--status', 'DONE', '--limit', '30']),
  read(['query', '--phase', 'in_progress']),
  runCliAsync(root, ['get', 'HYGIENE-REPORT', '--project', 'global', '--api-url', url], { timeoutMs: 8000 }),
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
const taskLine = (t) => `- ${t.id} · ${t.module} · ${age(t.updated_at)} · ${cut(t.task_description, 90)}${realStep(t) ? ` — ${cut(t.current_step, 90)}` : ''}`;

const sections = [];
const openNow = rows(open).filter((t) => fresh(t, RECENT_MS)).slice(0, 5);
if (openNow.length) sections.push('Em andamento em outras sessões (48 h):', ...openNow.map(taskLine));
const stuck = rows(blocked).filter((t) => fresh(t, BLOCKED_MS)).slice(0, 3);
if (stuck.length) sections.push('Bloqueadas (14 dias):', ...stuck.map(taskLine));
const results = rows(done).filter((t) => /^resultado:/i.test(t.current_step || '')).slice(0, 5);
if (results.length) {
  sections.push('Resultados recentes:',
    ...results.map((t) => `- ${age(t.updated_at)} · ${cut(t.task_description, 70)} → ${cut(String(t.current_step).replace(/^resultado:\s*/i, ''), 150)}`));
}
const pending = rows(inProgress).slice(0, 8);
if (pending.length) {
  sections.push('Itens em andamento na base:', ...pending.map((k) => `- ${k.id}${k.tasks_progress ? ` (${k.tasks_progress})` : ''} · ${cut(k.summary, 140)}`));
}

// The weekly hygiene report, while it still has findings.
if (hygiene.ok && hygiene.data?.knowledge_type === 'technical_debt') {
  sections.push('Faxina da base:', `- ${cut(hygiene.data.summary, 220)} (detalhes: ${CLI} get HYGIENE-REPORT --project global)`);
}

state.project = project;
state.sessionContext = { at: new Date().toISOString(), source: input.source || 'startup' };
saveState(input.session_id, state);

const moduleLine = modules.length
  ? modules.map((m) => `${m.module} (${m.total_count})`).join(', ')
  : '(nenhum módulo cadastrado — rode bootstrap-scan ou init)';
const context = [
  `[managing-system-context] Início de sessão · projeto ${project} (pasta ${folder}) · fonte ${listing.source === 'api' ? 'API' : 'cache local (somente leitura)'}${listing.apiError ? ` — API indisponível: ${cut(listing.apiError, 100)}` : ''}.`,
  `Módulos: ${moduleLine}`,
  ...(sections.length ? ['', ...sections] : []),
  '',
  `Em dúvida, procure antes de perguntar: ${CLI} search <palavras em inglês> --project ${project} (--all = todos os projetos). O hook de cada pedido abre a tarefa e traz o protocolo (${STAGE.CONTEXT}, ${STAGE.TASK}, ${STAGE.CLOSE}).`,
].join('\n');

emit({
  systemMessage: `🗂️ Contexto da sessão · projeto ${project} · ${openNow.length} em andamento · ${results.length} resultado(s) recente(s)`,
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
});

// Weekly, detached: closes week-old open tasks as BLOCKED and saves the report (HYGIENE-REPORT).
function runHygieneWeekly() {
  if (process.env.CONTEXT_SYNC_RULES === '0') return;
  const stamp = path.join(path.dirname(stateFile('hygiene')), 'hygiene.stamp');
  try {
    if (Date.now() - fs.statSync(stamp).mtimeMs < HYGIENE_EVERY_MS) return;
  } catch {}
  try {
    fs.writeFileSync(stamp, new Date().toISOString());
    spawn(process.execPath, [scriptPath('hygiene.mjs'), '--fix', '--save', '--quiet'], { detached: true, stdio: 'ignore', windowsHide: true, env: cliEnv(root) }).unref();
  } catch {}
}

// Keeps ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md and friends in step with the rules in the
// base. Detached, so the session never waits for it; throttled across sessions by a stamp file.
function refreshRules() {
  if (process.env.CONTEXT_SYNC_RULES === '0') return;
  const stamp = path.join(path.dirname(stateFile('sync')), 'sync-rules.stamp');
  try {
    if (Date.now() - fs.statSync(stamp).mtimeMs < SYNC_EVERY_MS) return;
  } catch {}
  try {
    fs.writeFileSync(stamp, new Date().toISOString());
    spawn(process.execPath, [scriptPath('sync-rules.mjs'), '--quiet'], { detached: true, stdio: 'ignore', windowsHide: true, env: cliEnv(root) }).unref();
  } catch {}
}
