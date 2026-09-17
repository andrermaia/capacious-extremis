// Shared helpers for the Claude Code hooks that enforce the
// managing-system-context protocol. Zero dependencies (Node >= 22).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const STAGE = {
  CONTEXT: 'Etapa 1/3 · Contexto',
  TASK: 'Etapa 2/3 · Tarefa',
  CLOSE: 'Etapa 3/3 · Encerramento',
};

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

export function saveState(sessionId, state) {
  fs.writeFileSync(stateFile(sessionId), JSON.stringify(state, null, 2));
}

export function openTasks(state) {
  return (state.tasks || []).filter((t) => !t.finished);
}

// Run the context CLI and parse its JSON stdout. Returns { ok, data, error }.
export function runCli(root, args, { timeoutMs = 10000 } = {}) {
  const res = spawnSync(process.execPath, [cliPath(root), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  });
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

// Try the remote API first (if configured), then fall back to the local SQLite DB.
// Returns { ok, data, source: 'api'|'local', apiUrl, apiError }.
export function runCliWithFallback(root, args) {
  const apiUrl = process.env.CONTEXT_API_URL || 'https://takius.com.br/api/v1/context';
  const remote = runCli(root, [...args, '--api-url', apiUrl], { timeoutMs: 8000 });
  if (remote.ok) return { ...remote, source: 'api', apiUrl };
  const local = runCli(root, args);
  return { ...local, source: 'local', apiUrl, apiError: remote.error };
}

export function sourceFlags(source, apiUrl) {
  return source === 'api' ? `--api-url "${apiUrl}"` : '(sem --api-url: API fora do ar, usando .agents/context.db)';
}
