#!/usr/bin/env node
// UserPromptSubmit hook: loads the module list for the detected project, opens
// the session task by itself (Stage 2), shows the step on screen and injects the
// protocol into the model context. The agent only runs query (Stage 1) and
// upsert (Stage 3); on-stop closes the task.
import {
  readStdinJson, emit, projectRoot, detectProject, loadState, saveState, openTasks, recordTask,
  runCliAsync, withLocalFallback, sourceFlags, loadModulesCache, saveModulesCache, cleanPrompt,
  guessModule, apiUrl, CLI, STAGE,
} from './hook-lib.mjs';

// A task left open longer than this belongs to an old turn (resumed session): close it.
const STALE_MS = 6 * 60 * 60 * 1000;

const input = readStdinJson();
const root = projectRoot(input);
const { project, folder } = detectProject(input, root);
const url = apiUrl();
const prompt = cleanPrompt(input.prompt);
const state = loadState(input.session_id);

const listArgs = ['list-modules', '--project', project];
const listing = runCliAsync(root, [...listArgs, '--api-url', url], { timeoutMs: 8000 });

// An interrupted turn or a queued prompt leaves the task open: the new prompt continues it.
const open = openTasks(state);
const isFresh = (t) => (t.project || project) === project && Date.now() - Date.parse(t.startedAt || 0) < STALE_MS;
const current = open.filter(isFresh).at(-1);
const stale = open.filter((t) => !isFresh(t));
const closing = stale.map((t) =>
  runCliAsync(root, ['task-finish', '--project', t.project || project, '--id', t.id, '--status', 'BLOCKED', '--api-url', url], { timeoutMs: 8000 })
    .then((r) => { if (r.ok) t.finished = true; }));

let module = current?.module;
let taskRun;
if (current) {
  taskRun = runCliAsync(root, ['task-step', '--project', project, '--id', current.id, '--step', `novo pedido: ${prompt || '(sem texto)'}`, '--api-url', url], { timeoutMs: 8000 });
} else {
  // First prompt ever for this project: wait for the module list to pick the module.
  const known = loadModulesCache(project) || (await listing).data;
  module = guessModule(prompt, Array.isArray(known) ? known : []);
  taskRun = runCliAsync(root, ['task-start', '--project', project, '--module', module, '--desc', prompt || 'pedido sem texto', '--api-url', url], { timeoutMs: 8000 });
}

const [listed, task] = await Promise.all([listing, taskRun, ...closing]);
const result = withLocalFallback(root, listArgs, listed);
const modules = result.ok && Array.isArray(result.data) ? result.data : [];
if (result.source === 'api' && modules.length) saveModulesCache(project, modules);

let taskId = current?.id;
let taskError = null;
if (!current) {
  taskId = task.ok ? task.data?.id : null;
  if (taskId) recordTask(state, { id: taskId, module, project, by: 'on-prompt' });
  else taskError = task.error || 'task-start sem id na resposta';
}

state.project = project;
state.source = result.source;
state.apiUrl = result.apiUrl;
state.contextQueried = true;
state.lastModule = module;
state.lastDesc = prompt;
state.turn = { promptId: input.prompt_id || null, upserts: 0, reminded: false, startedAt: new Date().toISOString() };
saveState(input.session_id, state);

const moduleLine = modules.length
  ? modules.map((m) => `${m.module} (${m.total_count})`).join(', ')
  : '(nenhum módulo cadastrado — rode bootstrap-scan ou init)';
const p = `--project ${project}`;

const taskLine = taskId
  ? `- "${STAGE.TASK}": já aberta pelo hook — ${taskId} (módulo ${module}). Não rode task-start nem task-finish. Opcional em operação longa: ${CLI} task-step ${p} --id ${taskId} --step "<passo>"`
  : `- "${STAGE.TASK}": ⚠️ a tarefa NÃO foi aberta (${String(taskError).slice(0, 120)}). A base compartilhada parece fora do ar: avise o usuário; as edições ficam bloqueadas até ela voltar. Não use --no-api.`;

const context = [
  `[managing-system-context] Projeto ${project} (pasta ${folder}) · fonte ${result.source === 'api' ? `API ${result.apiUrl}` : 'cache local .agents/context.db (somente leitura)'}${result.apiError ? ` — API indisponível: ${String(result.apiError).slice(0, 120)}` : ''}.`,
  `Módulos: ${moduleLine}`,
  '',
  'PROTOCOLO (anuncie em texto cada etapa, com estes rótulos, antes de executá-la):',
  `- "${STAGE.CONTEXT}": ${CLI} query ${p} --module <módulo>   (a lista acima dispensa list-modules; a sintaxe aqui dispensa --help)`,
  taskLine,
  `- "${STAGE.CLOSE}": se surgiu decisão, modelo ou débito, grave antes da resposta final: ${CLI} upsert ${p} --id <ID> --module <m> --feature <f> --type architecture_decision|system_model|current_behavior|future_revision|technical_debt --phase implemented|in_progress|queued|deprioritized [--progress XX/YY, obrigatório em in_progress] --summary "<inglês, até 250 caracteres>" [--details "<texto>"]. O hook fecha a tarefa (DONE) ao fim do turno; só se ela ficou bloqueada rode task-finish ${p} --id ${taskId || '<TASK_ID>'} --status BLOCKED.`,
  'Subagentes ficam fora do protocolo: não peça context-cli a eles; passe no prompt o contexto de que precisarem e grave você o que eles descobrirem.',
  `Se o projeto detectado estiver errado, use outro --project (disponíveis: louza, qlave, qoincamera, qoinpass, qoinmsg, qoinpay, qpoker, qoinstore, qoinsite, qoinmodel, qoinreviews) ${sourceFlags(result.source)}.`,
].join('\n');

emit({
  systemMessage: `📚 ${STAGE.CONTEXT} · projeto ${project} · ${modules.length} módulo(s) · fonte ${result.source === 'api' ? 'API' : 'local'} · ` +
    (taskId ? `🟢 ${taskId}${current ? ' (continuação)' : ''}` : '⚠️ tarefa não aberta'),
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: context,
  },
});
