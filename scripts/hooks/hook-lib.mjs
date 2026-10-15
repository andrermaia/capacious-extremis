// Shared helpers for the Claude Code hooks that enforce the
// managing-system-context protocol. Zero dependencies (Node >= 22).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const STAGE = {
  CONTEXT: 'Etapa 1/3 · Contexto',
  TASK: 'Etapa 2/3 · Tarefa',
  CLOSE: 'Etapa 3/3 · Encerramento',
};

export const CLI = 'node .agents/skills/managing-system-context/scripts/context-cli.mjs';
export const DEFAULT_MODULE = 'general';

export function apiUrl() {
  return process.env.CONTEXT_API_URL || 'https://api.takius.com.br/v1/context';
}

// Projects that exist in the central knowledge base. Folder prefixes map to them.
const PROJECT_PREFIXES = [
  ['louza', 'louza'],
  ['qlave', 'qlave'],
  ['qoincamera', 'qoincamera'],
  ['qoinpass', 'qoinpass'],
  ['qoinmsg', 'qoinmsg'],
  ['qoinpay', 'qoinpay'],
  ['qoinpoker', 'qpoker'],
  ['qpoker', 'qpoker'],
  ['qoinstore', 'qoinstore'],
  ['qoinsite', 'qoinsite'],
  ['qoinmodel', 'qoinmodel'],
  ['qoinreviews', 'qoinreviews'],
];

export function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

const SKILL_REL = path.join('.agents', 'skills', 'managing-system-context');

// Walk up from cwd until a folder containing the skill is found; fall back to
// CLAUDE_PROJECT_DIR (set by Claude Code) or cwd itself.
export function projectRoot(input) {
  const candidates = [input.cwd, process.env.CLAUDE_PROJECT_DIR, process.cwd()].filter(Boolean);
  for (const start of candidates) {
    let dir = path.resolve(start);
    for (;;) {
      if (fs.existsSync(path.join(dir, SKILL_REL))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

export function cliPath(root) {
  return path.join(root, '.agents', 'skills', 'managing-system-context', 'scripts', 'context-cli.mjs');
}

// Derive the knowledge-base project from the working directory.
// <root>/louza-fe -> louza ; <root>/qoinpoker-tv -> qpoker ; <root> itself -> basename(root).
export function detectProject(input, root) {
  const cwd = path.resolve(input.cwd || process.cwd());
  const rel = path.relative(path.resolve(root), cwd);
  const first = rel && !rel.startsWith('..') ? rel.split(/[\\/]/)[0] : '';
  const folder = (first || path.basename(root)).toLowerCase();
  for (const [prefix, project] of PROJECT_PREFIXES) {
    if (folder.startsWith(prefix)) return { project, folder };
  }
  return { project: path.basename(root), folder };
}

export function stateFile(sessionId) {
  const dir = path.join(os.tmpdir(), 'claude-context-hooks');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${sessionId || 'no-session'}.json`);
}

export function loadState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(sessionId), 'utf8'));
  } catch {
    return { tasks: [], contextQueried: false };
  }
}

// Write to a sibling file and rename, so a hook reading the state never sees half a JSON.
export function saveState(sessionId, state) {
  const file = stateFile(sessionId);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
    fs.rmSync(tmp, { force: true });
  }
}

export function openTasks(state) {
  return (state.tasks || []).filter((t) => !t.finished);
}

export function recordTask(state, task) {
  state.tasks ||= [];
  if (!state.tasks.some((t) => t.id === task.id)) {
    state.tasks.push({ finished: false, startedAt: new Date().toISOString(), ...task });
  }
}

// The module list barely changes, so the last one seen per project lets the prompt
// hook pick the task module without waiting for list-modules.
function modulesCacheFile(project) {
  return path.join(path.dirname(stateFile('modules')), `modules-${project}.json`);
}

export function loadModulesCache(project) {
  try {
    return JSON.parse(fs.readFileSync(modulesCacheFile(project), 'utf8'));
  } catch {
    return null;
  }
}

export function saveModulesCache(project, modules) {
  try {
    fs.writeFileSync(modulesCacheFile(project), JSON.stringify(modules));
  } catch {}
}

// The user prompt becomes the task description: no IDE/system wrappers, one line, short.
export function cleanPrompt(prompt) {
  return String(prompt || '')
    .replace(/<(ide_selection|ide_opened_file|system-reminder|pasted_content)[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

// Longest module name the prompt mentions as a whole word; DEFAULT_MODULE otherwise.
export function guessModule(prompt, modules) {
  const text = ` ${String(prompt || '').toLowerCase()} `;
  const names = (modules || []).map((m) => String(m.module || '')).filter((n) => n.length >= 4);
  names.sort((a, b) => b.length - a.length);
  const escape = (s) => s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return names.find((n) => new RegExp(`[^a-z0-9_-]${escape(n)}[^a-z0-9_-]`).test(text)) || DEFAULT_MODULE;
}

// The text of the turn's final answer: the Stop input when Claude Code sends it, else
// the last assistant text in the tail of the transcript (after the last user prompt).
export function finalAnswer(input) {
  if (typeof input.last_assistant_message === 'string' && input.last_assistant_message.trim()) return input.last_assistant_message;
  const file = input.transcript_path;
  if (!file) return null;
  let tail;
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, size - length);
    fs.closeSync(fd);
    tail = buf.toString('utf8').split('\n');
  } catch {
    return null;
  }
  for (let i = tail.length - 1; i >= 0; i--) {
    let rec;
    try { rec = JSON.parse(tail[i]); } catch { continue; }
    const content = rec.message?.content;
    if (rec.type === 'user' && typeof content === 'string' && !rec.isMeta) return null;
    if (rec.type !== 'assistant' || !Array.isArray(content)) continue;
    const text = content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim();
    if (text) return text;
  }
  return null;
}

// One line, no markdown, for the task's current_step ("resultado: ...").
export function outcomeLine(text, max = 230) {
  const plain = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s?)/gm, '')
    .replace(/(\*\*|__|\*|_)(\S[^*_]*?)\1/g, '$2')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return null;
  if (plain.length <= max) return plain;
  const cutAt = plain.lastIndexOf(' ', max - 1);
  return `${plain.slice(0, cutAt > max * 0.6 ? cutAt : max - 1)}…`;
}

export function upsertReminder(taskId) {
  return `Lembrete da ${STAGE.CLOSE}: antes da resposta final, grave com upsert o que este trabalho decidiu ou revelou ` +
    `(decisão, modelo, débito; summary em inglês, até 250 caracteres). ${taskId ? `A ${taskId} fecha sozinha` : 'A tarefa fecha sozinha'} ao fim do turno.`;
}

// Run the context CLI and parse its JSON stdout. Returns { ok, data, error }.
export function runCli(root, args, { timeoutMs = 10000 } = {}) {
  const res = spawnSync(process.execPath, [cliPath(root), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  });
  return parseCliResult(res);
}

// Same as runCli, without blocking: lets the prompt hook run list-modules and task-start together.
export function runCliAsync(root, args, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath(root), ...args], { cwd: root, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (error) => { clearTimeout(timer); resolve(parseCliResult({ error })); });
    child.on('close', (status) => { clearTimeout(timer); resolve(parseCliResult({ stdout, stderr, status })); });
  });
}

function parseCliResult(res) {
  if (res.error) return { ok: false, error: res.error.message };
  const out = (res.stdout || '').trim();
  try {
    const data = JSON.parse(out);
    if (data && typeof data === 'object' && !Array.isArray(data) && data.error) {
      return { ok: false, error: data.error };
    }
    return { ok: true, data };
  } catch {
    // The CLI reports failures as a JSON object on stderr; extract its "error" field.
    const stderr = String(res.stderr || '');
    const fromJson = stderr.match(/"error"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
    if (fromJson) return { ok: false, error: fromJson.replace(/\\n/g, ' ').trim() };
    const firstLine = (s) => String(s || '').split(/\r?\n/).find((l) => l.trim() && !/ExperimentalWarning|trace-warnings|^[{}]$/.test(l.trim())) || '';
    return { ok: false, error: firstLine(out) || firstLine(stderr) || `exit ${res.status}` };
  }
}

// Try the shared API first, then fall back to the local read-only cache.
// Returns { ok, data, source: 'api'|'local', apiUrl, apiError }.
export function runCliWithFallback(root, args) {
  const url = apiUrl();
  const remote = runCli(root, [...args, '--api-url', url], { timeoutMs: 8000 });
  return withLocalFallback(root, args, remote);
}

// Given the API attempt of a read command, fall back to the local cache when it failed.
export function withLocalFallback(root, args, remote) {
  const url = apiUrl();
  if (remote.ok) return { ...remote, source: 'api', apiUrl: url };
  const local = runCli(root, [...args, '--no-api']);
  return { ...local, source: 'local', apiUrl: url, apiError: remote.error };
}

export function sourceFlags(source) {
  return source === 'api'
    ? '(a API compartilhada é o padrão do CLI: não passe --api-url nem --no-api)'
    : '(API fora do ar: leitura cai no cache local .agents/context.db, mas GRAVAÇÃO VAI FALHAR — não invente workaround, avise o usuário)';
}
