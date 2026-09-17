#!/usr/bin/env node
// PostToolUse hook (Bash|PowerShell): watches calls to context-cli.mjs,
// tracks task-start / task-finish in the session state and shows the
// protocol step on screen.
import { readStdinJson, emit, loadState, saveState, STAGE } from './hook-lib.mjs';

const input = readStdinJson();
const command = String(input.tool_input?.command || '');
if (!command.includes('context-cli.mjs')) process.exit(0);

const response = input.tool_response;
const output = typeof response === 'string'
  ? response
  : [response?.stdout, response?.output, response?.content, JSON.stringify(response ?? '')].filter(Boolean).join('\n');

const state = loadState(input.session_id);
state.tasks ||= [];
let message = null;

if (/\btask-start\b/.test(command)) {
  const id = output.match(/TASK-[A-Z0-9]+-\d+/)?.[0];
  const module = command.match(/--module\s+"?([^\s"]+)/)?.[1] || '?';
  if (id) {
    if (!state.tasks.some((t) => t.id === id)) state.tasks.push({ id, module, finished: false, startedAt: new Date().toISOString() });
    message = `🟢 ${STAGE.TASK} · ${id} aberta (módulo ${module})`;
  } else {
    message = `⚠️ ${STAGE.TASK} · task-start rodou mas nenhum id TASK-... foi encontrado na saída`;
  }
} else if (/\btask-finish\b/.test(command)) {
  const id = command.match(/--id\s+"?(TASK-[A-Z0-9]+-\d+)/)?.[1];
  const status = command.match(/--status\s+"?([A-Z]+)/)?.[1] || 'DONE';
  const task = state.tasks.find((t) => t.id === id);
  if (task) task.finished = true;
  else if (id) state.tasks.push({ id, finished: true });
  message = `✅ ${STAGE.CLOSE} · ${id || 'tarefa'} encerrada (${status})`;
} else if (/\btask-step\b/.test(command)) {
  const step = command.match(/--step\s+"([^"]+)"/)?.[1] || '';
  message = `▶️ ${STAGE.TASK} · passo: ${step.slice(0, 80)}`;
} else if (/\bupsert\b/.test(command)) {
  const id = command.match(/--id\s+"?([^\s"]+)/)?.[1] || '?';
  message = `💾 ${STAGE.CLOSE} · conhecimento ${id} gravado`;
} else if (/\bquery\b/.test(command)) {
  const module = command.match(/--module\s+"?([^\s"]+)/)?.[1] || '?';
  state.contextQueried = true;
  message = `🔎 ${STAGE.CONTEXT} · módulo ${module} consultado`;
} else if (/\blist-modules\b/.test(command)) {
  state.contextQueried = true;
  message = `📚 ${STAGE.CONTEXT} · módulos listados`;
}

saveState(input.session_id, state);
if (message) emit({ systemMessage: message });
