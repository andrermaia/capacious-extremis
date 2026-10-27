#!/usr/bin/env node
// UserPromptSubmit hook: opens (or continues) the session task by itself, searches the
// base with the words of the prompt and injects the best hits, so the agent rarely needs a
// query turn of its own. With the session context in place it injects only that; without
// it (no session-start hook), also the module list and the whole protocol.
import path from 'node:path';
import {
  readStdinJson, emit, projectRoot, detectProject, loadState, saveState, openTasks, recordTask,
  runCliAsync, callApi, withLocalFallback, sourceFlags, loadModulesCache, saveModulesCache, cleanPrompt,
  guessModule, searchWords, isTrivialPrompt, hitsBlock, protocolText, apiUrl, productsNamed, STAGE,
} from './hook-lib.mjs';

// A task left open longer than this belongs to an old turn (resumed session): close it.
const STALE_MS = 6 * 60 * 60 * 1000;

const input = readStdinJson();
const root = projectRoot(input);
if (!root) process.exit(0); // outside every project: only the universal rules apply
if (!apiUrl()) process.exit(0); // no API configured on this machine: session start says so
const { project, folder } = detectProject(input, root);
const url = apiUrl();
// A background task finishing comes in as a <task-notification> "prompt": it continues the
// work, it is not a request, so it is neither searched nor described by its XML.
const notice = /^\s*<task-notification>/.test(String(input.prompt || ''));
const prompt = notice ? 'aviso de tarefa em segundo plano' : cleanPrompt(input.prompt);
const fullPrompt = notice ? prompt : cleanPrompt(input.prompt, Infinity);
const state = loadState(input.session_id);
const trivial = !notice && isTrivialPrompt(input.prompt);

// The session-start hook already showed the module list: then the prompt hook skips it
// (and the list-modules call) and uses the cached list to pick the task module.
const cached = loadModulesCache(project);
const primed = Boolean(state.sessionContext) && Array.isArray(cached);
const listArgs = ['list-modules', '--project', project];
const listing = primed ? null : callApi(root, [...listArgs, '--api-url', url], { timeoutMs: 8000 });

// An interrupted turn or a queued prompt leaves the task open: the new prompt continues it.
const open = openTasks(state);
const isFresh = (t) => (t.project || project) === project && Date.now() - Date.parse(t.startedAt || 0) < STALE_MS;
const current = open.filter(isFresh).at(-1);
const stale = open.filter((t) => !isFresh(t));
const closing = stale.map((t) =>
  callApi(root, ['task-finish', '--project', t.project || project, '--id', t.id, '--status', 'BLOCKED', '--api-url', url], { timeoutMs: 8000 })
    .then((r) => { if (r.ok) t.finished = true; }));

let module = current?.module;
let taskRun;
if (trivial && !current) {
  taskRun = Promise.resolve({ ok: true, data: null, skipped: true });
} else if (current) {
  taskRun = callApi(root, ['task-step', '--project', project, '--id', current.id, '--step', notice ? prompt : `novo pedido: ${prompt || '(sem texto)'}`, '--api-url', url], { timeoutMs: 8000 });
} else {
  // First prompt ever for this project: wait for the module list to pick the module.
  const known = cached || (await listing).data;
  module = guessModule(prompt, Array.isArray(known) ? known : []);
  taskRun = callApi(root, ['task-start', '--project', project, '--module', module, '--desc', prompt || 'pedido sem texto', '--api-url', url], { timeoutMs: 8000 });
}

// The agent's first move used to be a query/search turn that re-read the whole context:
// the hook searches the base with the prompt's words instead, in parallel.
const words = notice || trivial ? [] : searchWords(fullPrompt);
// Commits only from the products the request names, or the session's product; at the root,
// with no product named, none (17/10/2026: they were mostly other products' noise).
const named = productsNamed(words);
const sessionProduct = project !== path.basename(root).toLowerCase() ? project : null;
const commitScope = named.length ? named : sessionProduct ? [sessionProduct] : [];
const commitArgs = commitScope.length ? ['--commits', '3', '--commit-projects', commitScope.join(',')] : ['--commits', '0'];
// The products the request names (or the session's product) first, with projetos and global;
// the whole base in parallel, used when the scoped search finds fewer than 2 notes. At the root
// with no product named, the whole base only.
const scope = commitScope.length ? [...new Set([...commitScope, 'projetos', 'global'])].join(',') : null;
const searchArgs = (where) => ['search', ...words, ...where, '--limit', '12', '--excerpt', '2', ...commitArgs, '--drafts', '1',
  '--meaning', fullPrompt.replace(/^-+/, '').slice(0, 300), '--project', project, '--api-url', url];
const searching = words.length
  ? Promise.all([
    scope ? callApi(root, searchArgs(['--projects', scope]), { timeoutMs: 8000 }) : null,
    callApi(root, searchArgs(['--all']), { timeoutMs: 8000 }),
  ]).then(([scoped, all]) => (scoped?.ok && (scoped.data?.knowledge || []).length >= 2 ? scoped : all))
  : null;

const [listed, task, found] = await Promise.all([listing, taskRun, searching, ...closing]);
const result = primed
  ? { ok: true, data: cached, source: task.ok ? 'api' : state.source || 'local', apiUrl: url, apiError: task.ok ? null : task.error }
  : withLocalFallback(root, listArgs, listed);
const modules = result.ok && Array.isArray(result.data) ? result.data : [];
if (!primed && result.source === 'api' && modules.length) saveModulesCache(project, modules);

let taskId = current?.id;
let taskError = null;
if (!current) {
  taskId = task.ok ? task.data?.id : null;
  if (taskId) recordTask(state, { id: taskId, module, project, by: 'on-prompt' });
  else if (!task.skipped) taskError = task.error || 'task-start sem id na resposta';
}

state.project = project;
state.source = result.source;
state.apiUrl = result.apiUrl;
state.contextQueried = true;
state.lastModule = module;
if (!notice && !trivial) state.lastDesc = prompt;
state.turn = { promptId: input.prompt_id || null, upserts: 0, reminded: false, startedAt: new Date().toISOString(), trivial, prompt };
saveState(input.session_id, state);

const moduleLine = modules.length
  ? modules.map((m) => `${m.module} (${m.total_count})`).join(', ')
  : '(nenhum módulo cadastrado — rode bootstrap-scan ou init)';

const taskLine = trivial && !taskId
  ? 'Pedido curto: sem tarefa nem busca (se houver trabalho, o hook registra a tarefa ao fim do turno).'
  : taskId
  ? `Tarefa ${taskId} (módulo ${module}) aberta pelo hook; ele a fecha ao fim do turno.`
  : `⚠️ A tarefa NÃO foi aberta (${String(taskError).slice(0, 120)}). A base compartilhada parece fora do ar: avise o usuário; as edições ficam bloqueadas até ela voltar. Não use --no-api.`;
// This session's own tasks are what the agent is doing right now: never a hit.
const hits = found?.ok ? hitsBlock(found.data, words, new Set((state.tasks || []).map((t) => t.id))) : [];

// With the session context in place (protocol, modules) the prompt only needs the task
// line and what the search found; otherwise (hooks installed mid-session, no session
// start) it carries the whole protocol, as before.
const context = [
  `[managing-system-context] Projeto ${project} (pasta ${folder}) · ${taskLine}${result.apiError && taskId ? ` API instável: ${String(result.apiError).slice(0, 80)}` : ''}`,
  ...hits,
  ...(primed ? [] : ['', `Fonte: ${result.source === 'api' ? `API ${result.apiUrl}` : 'cache local (somente leitura)'} ${sourceFlags(result.source)}`, `Módulos: ${moduleLine}`, '', protocolText(project)]),
].join('\n');

emit({
  systemMessage: `📚 ${STAGE.CONTEXT} · projeto ${project}${hits.length ? ` · ${hits.length - 1} item(ns) da base` : ''} · ` +
    (taskId ? `🟢 ${STAGE.TASK} · ${taskId}${current ? ' (continuação)' : ''}` : trivial ? 'pedido curto, sem tarefa' : '⚠️ tarefa não aberta'),
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: context,
  },
});
