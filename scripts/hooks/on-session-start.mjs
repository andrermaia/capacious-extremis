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
  saveModulesCache, stateFile, scriptPath, cliEnv, apiUrl, protocolText, apiRequest, savePathsIndex, CLI,
} from './hook-lib.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_MS = 2 * DAY_MS;
const BLOCKED_MS = 14 * DAY_MS;
const ITEM_MS = 14 * DAY_MS;

const input = readStdinJson();
if (input.agent_id) process.exit(0);

const root = projectRoot(input);
if (!root) process.exit(0); // outside every project: only the universal rules apply
if (!apiUrl()) {
  // The address is configuration, not code (the repository is public): say once how to set it.
  emit({
    systemMessage: '⚠️ Base de conhecimento desligada: CONTEXT_API_URL não configurada nesta máquina',
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '[managing-system-context] CONTEXT_API_URL não está configurada (ambiente ou bloco "env" de <raiz>/.claude/settings.local.json): a base compartilhada está desligada nesta sessão e os hooks não fazem nada. Avise o usuário; não use --no-api.' },
  });
  process.exit(0);
}
const { project, folder } = detectProject(input, root);
const url = apiUrl();
const state = loadState(input.session_id);
const read = (args) => callApi(root, [...args, '--project', project, '--api-url', url], { timeoutMs: 8000 });

// Background jobs, detached and throttled across sessions by stamp files.
inBackground('sync-rules', 10 * 60 * 1000, [scriptPath('sync-rules.mjs'), '--quiet']);
inBackground('hygiene', 7 * DAY_MS, [scriptPath('hygiene.mjs'), '--fix', '--save', '--quiet']);
// The local cache is what reads fall back to when the API is unreachable: keep it a week fresh at most.
inBackground('pull', 7 * DAY_MS, [scriptPath('context-cli.mjs'), 'pull']);
// Commits of the repositories under the root, so a search finds what changed and when.
inBackground('commits', 6 * 60 * 60 * 1000, [scriptPath('ingest-commits.mjs'), '--root', root, '--quiet']);
// Finished sessions become drafts by a small model through the Batches API (off without its key).
inBackground('consolidate', 2 * 60 * 60 * 1000, [scriptPath('consolidate.mjs'), '--quiet']);

// At the root the digest spans every project; inside a product, that product and the cross-project rows.
const digestScope = project === path.basename(root).toLowerCase() ? '' : `project=${encodeURIComponent(`${project},projetos`)}&`;
const [modulesRaw, open, blocked, done, inProgress, hygiene, pathsIndex, digest] = await Promise.all([
  read(['list-modules']),
  read(['list-tasks', '--status', 'IN_PROGRESS', '--limit', '30']),
  read(['list-tasks', '--status', 'BLOCKED', '--limit', '10']),
  read(['list-tasks', '--status', 'DONE', '--limit', '30']),
  read(['query', '--phase', 'in_progress']),
  callApi(root, ['get', 'HYGIENE-REPORT', '--project', 'global', '--api-url', url], { timeoutMs: 8000 }),
  apiRequest(root, 'GET', 'paths', null, { timeoutMs: 8000 }),
  apiRequest(root, 'GET', `digest?${digestScope}days=7&limit=8`, null, { timeoutMs: 8000 }),
]);
// The edit hook's file radar reads this index locally (no network at edit time).
if (pathsIndex.ok && Array.isArray(pathsIndex.data)) savePathsIndex(pathsIndex.data);
const listing = withLocalFallback(root, ['list-modules', '--project', project], modulesRaw);
const modules = listing.ok && Array.isArray(listing.data) ? listing.data : [];
if (listing.source === 'api' && modules.length) saveModulesCache(project, modules);

const rows = (r) => (r.ok && Array.isArray(r.data) ? r.data : []);
const now = Date.now();
// Clock times, not "há 9 h": the block then reads the same in every session until the base
// changes, and the prompt cache reuses it (measured 17/10/2026: rewritten in each session, it
// was about a third of the skill's extra cost on recall questions).
const WHEN = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const age = (iso) => WHEN.format(new Date(iso)).replace(',', '');
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
// What changed in the base this week replaces the module list (list-modules still has it): a
// handful of decisions and debts, and the drafts the Stop hook left for confirmation.
const week = [];
if (digest.ok && digest.data?.counts) {
  const counts = Object.entries(digest.data.counts).map(([p, n]) => `${p} ${n}`).join(', ');
  if (digest.data.changed?.length) {
    week.push(`Novidades da base (${digest.data.days} dias · ${counts}):`,
      ...digest.data.changed.map((k) => `- ${k.project_id}/${k.id} · ${cut(k.summary, 120)}`));
  }
  if (digest.data.drafts?.length) {
    week.push(`Rascunhos a confirmar (${digest.data.drafts_total}; trabalho que terminou sem upsert):`,
      ...digest.data.drafts.map((k) => `- ${k.project_id}/${k.id} · ${cut(k.summary, 110)}`),
      'Ao retomar um deles, grave a linha real com "supersedes":"<ID do rascunho>" (o rascunho sai e os arquivos passam para ela).');
  }
}
const context = [
  `[managing-system-context] Início de sessão · projeto ${project} (pasta ${folder}) · fonte ${listing.source === 'api' ? 'API' : 'cache local (somente leitura)'}${listing.apiError ? ` — API indisponível: ${cut(listing.apiError, 100)}` : ''}.`,
  ...(digest.ok && digest.data?.counts ? [] : [`Módulos: ${moduleLine}`]),
  ...(week.length ? ['', ...week] : []),
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
