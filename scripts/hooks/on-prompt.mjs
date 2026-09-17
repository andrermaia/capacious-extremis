#!/usr/bin/env node
// UserPromptSubmit hook: loads the module list for the detected project,
// records session state, shows the step on screen and injects the protocol
// into the model context so Stage 1 can never be skipped.
import {
  readStdinJson, emit, projectRoot, detectProject, loadState, saveState,
  runCliWithFallback, sourceFlags, STAGE,
} from './hook-lib.mjs';

const input = readStdinJson();
const root = projectRoot(input);
const { project, folder } = detectProject(input, root);

const result = runCliWithFallback(root, ['list-modules', '--project', project]);
const modules = result.ok && Array.isArray(result.data) ? result.data : [];
const flags = sourceFlags(result.source, result.apiUrl);

const state = loadState(input.session_id);
state.project = project;
state.source = result.source;
state.apiUrl = result.apiUrl;
state.contextQueried = true;
saveState(input.session_id, state);

const moduleLine = modules.length
  ? modules.map((m) => `${m.module} (${m.total_count})`).join(', ')
  : '(nenhum módulo cadastrado — rode bootstrap-scan ou init)';

const cli = 'node .agents/skills/managing-system-context/scripts/context-cli.mjs';
const projectFlag = `--project ${project}`;
const apiFlag = result.source === 'api' ? ` --api-url "${result.apiUrl}"` : '';

const context = [
  `[managing-system-context] ${STAGE.CONTEXT} carregada automaticamente pelo hook.`,
  `Projeto detectado: ${project} (pasta: ${folder}). Fonte: ${result.source === 'api' ? 'API Takius' : 'SQLite local .agents/context.db'}${result.apiError ? ` — API indisponível: ${String(result.apiError).slice(0, 120)}` : ''}.`,
  `Módulos: ${moduleLine}`,
  '',
  'PROTOCOLO OBRIGATÓRIO (anuncie cada etapa ao usuário em texto antes de executá-la, exatamente com estes rótulos):',
  `- "${STAGE.CONTEXT}": ${cli} query ${projectFlag} --module <módulo>${apiFlag}`,
  `- "${STAGE.TASK}": ${cli} task-start ${projectFlag} --module <módulo> --desc "<pedido>"${apiFlag}  (guarde o id TASK-...)`,
  `- "${STAGE.CLOSE}": upsert de decisões/débitos (summary em inglês, <= 250 chars) e ${cli} task-finish ${projectFlag} --id <TASK_ID> --status DONE${apiFlag}`,
  'Edit/Write ficam bloqueados pelo hook até existir uma tarefa aberta nesta sessão. O turno não encerra com tarefa aberta.',
  `Se o projeto detectado estiver errado, use outro --project (disponíveis: louza, qlave, qoincamera, qoinpass, qoinmsg, qoinpay, qpoker, qoinstore, qoinsite, qoinmodel, qoinreviews) e mantenha ${sourceFlags(result.source, result.apiUrl)}.`,
].join('\n');

emit({
  systemMessage: `📚 ${STAGE.CONTEXT} · projeto ${project} · ${modules.length} módulo(s) · fonte ${result.source === 'api' ? 'API' : 'local'}`,
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: context,
  },
});
