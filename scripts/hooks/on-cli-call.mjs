#!/usr/bin/env node
// PostToolUse hook (Bash|PowerShell): watches calls to context-cli.mjs, keeps
// the session state in step (tasks the agent opened or closed by hand, upserts
// of the turn) and shows the protocol step on screen. One shell command may
// hold several CLI calls; every one of them is counted.
import { readStdinJson, emit, loadState, saveState, recordTask, STAGE } from './hook-lib.mjs';

const input = readStdinJson();
const command = String(input.tool_input?.command || '');
if (!command.includes('context-cli.mjs')) process.exit(0);

const response = input.tool_response;
const output = typeof response === 'string'
  ? response
  : [response?.stdout, response?.output, response?.content, JSON.stringify(response ?? '')].filter(Boolean).join('\n');

const state = loadState(input.session_id);
state.tasks ||= [];
const messages = [];
// Subcommands are looked up outside quoted arguments: a --summary that mentions
// "task-finish" is not a task-finish.
const bare = command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
const count = (re) => (bare.match(re) || []).length;
const unique = (list) => [...new Set(list)];

if (/\btask-start\b/.test(bare)) {
  const ids = unique([...output.matchAll(/TASK-[A-Z0-9]+-\d+/g)].map((m) => m[0]));
  const module = command.match(/task-start\b[^\n]*?--module\s+["']?([^\s"']+)/)?.[1] || '?';
  for (const id of ids) recordTask(state, { id, module, project: state.project, by: input.agent_id ? 'subagent' : 'agent' });
  messages.push(ids.length
    ? `🟢 ${STAGE.TASK} · ${ids.join(', ')} aberta (módulo ${module})`
    : `⚠️ ${STAGE.TASK} · task-start rodou mas nenhum id TASK-... foi encontrado na saída`);
}
if (/\btask-finish\b/.test(bare)) {
  const ids = unique([...command.matchAll(/task-finish\b[^\n]*?--id\s+["']?(TASK-[A-Z0-9]+-\d+)/g)].map((m) => m[1]));
  const status = command.match(/task-finish\b[^\n]*?--status\s+["']?([A-Z]+)/)?.[1] || 'DONE';
  for (const id of ids) {
    const task = state.tasks.find((t) => t.id === id);
    if (task) task.finished = true;
    else state.tasks.push({ id, finished: true });
  }
  messages.push(`✅ ${STAGE.CLOSE} · ${ids.join(', ') || 'tarefa'} encerrada (${status})`);
}
if (/\btask-step\b/.test(bare)) {
  const step = command.match(/--step\s+"([^"]+)"/)?.[1] || '';
  messages.push(`▶️ ${STAGE.TASK} · passo: ${step.slice(0, 80)}`);
}
if (/\bupsert\b/.test(bare)) {
  // Count the rows the API confirmed; fall back to the calls in the command.
  const saved = (output.match(/"action"\s*:\s*"(inserted|updated)"/g) || []).length || count(/\bupsert\b/g);
  const ids = unique([...command.matchAll(/\bupsert\b[^\n]*?--id\s+["']?([^\s"']+)/g)].map((m) => m[1]));
  state.turn ||= { upserts: 0 };
  state.turn.upserts = (state.turn.upserts || 0) + saved;
  messages.push(`💾 ${STAGE.CLOSE} · conhecimento ${ids.join(', ') || '?'} gravado`);
}
if (/\bquery\b/.test(bare)) {
  const modules = unique([...bare.matchAll(/\bquery\b[^\n]*?--module\s+([^\s"]+)/g)].map((m) => m[1]));
  state.contextQueried = true;
  messages.push(`🔎 ${STAGE.CONTEXT} · módulo ${modules.join(', ') || '?'} consultado`);
} else if (/\blist-modules\b/.test(bare)) {
  state.contextQueried = true;
  messages.push(`📚 ${STAGE.CONTEXT} · módulos listados`);
}

saveState(input.session_id, state);
if (messages.length) emit({ systemMessage: messages.join(' · ') });
