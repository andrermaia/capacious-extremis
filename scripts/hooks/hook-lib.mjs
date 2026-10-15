// Shared helpers for the Claude Code hooks that enforce the
// managing-system-context protocol. Zero dependencies (Node >= 22).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

// Walk up from the session folder (or CLAUDE_PROJECT_DIR) to the folder that holds the
// skill. null means the session is outside every project — a scratch folder, Temp, a
// smoke test: the hooks then stay out of the way (the universal rules still apply,
// they come from ~/.claude/CLAUDE.md).
export function projectRoot(input) {
  const candidates = [input.cwd, process.env.CLAUDE_PROJECT_DIR].filter(Boolean);
  for (const start of candidates) {
    let dir = path.resolve(start);
    for (;;) {
      if (fs.existsSync(path.join(dir, SKILL_REL))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

// The CLI next to these hooks, wherever the skill is installed (project, ~/.agents, plugin).
const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function cliPath() {
  return path.join(SCRIPTS_DIR, 'context-cli.mjs');
}
export function scriptPath(name) {
  return path.join(SCRIPTS_DIR, name);
}

// A session opened straight in <root>/louza does not load <root>/.claude/settings.local.json,
// so the token may be missing from the environment: read it from the project root then.
export function cliEnv(root) {
  if (process.env.CONTEXT_API_TOKEN || !root) return process.env;
  for (const name of ['settings.local.json', 'settings.json']) {
    try {
      const token = JSON.parse(fs.readFileSync(path.join(root, '.claude', name), 'utf8')).env?.CONTEXT_API_TOKEN;
      if (token) return { ...process.env, CONTEXT_API_TOKEN: token };
    } catch {}
  }
  return process.env;
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
// The last records of the transcript (parsed JSON lines), newest last.
function readTail(file, bytes = 1024 * 1024) {
  if (!file) return [];
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, bytes);
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, size - length);
    fs.closeSync(fd);
    return buf.toString('utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

const isPrompt = (rec) => rec.type === 'user' && typeof rec.message?.content === 'string' && !rec.isMeta;

// What the agent did with the CLI in this turn (since the last user prompt): how many
// knowledge rows it saved and which tasks it closed by hand. Read from the transcript at
// Stop time, so no hook has to run after every shell command.
export function turnCliCalls(input) {
  const tail = readTail(input.transcript_path);
  let start = 0;
  for (let i = tail.length - 1; i >= 0; i--) if (isPrompt(tail[i])) { start = i + 1; break; }
  const commands = new Map();
  const results = new Map();
  for (const rec of tail.slice(start)) {
    for (const b of Array.isArray(rec.message?.content) ? rec.message.content : []) {
      if (b?.type === 'tool_use' && ['Bash', 'PowerShell'].includes(b.name) && String(b.input?.command || '').includes('context-cli')) {
        commands.set(b.id, String(b.input.command));
      } else if (b?.type === 'tool_result' && commands.has(b.tool_use_id)) {
        const c = b.content;
        results.set(b.tool_use_id, typeof c === 'string' ? c : JSON.stringify(c ?? ''));
      }
    }
  }
  let upserts = 0;
  const finished = [];
  for (const [id, command] of commands) {
    const bare = command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
    const out = results.get(id) || '';
    if (/\bupsert\b/.test(bare)) {
      upserts += (out.match(/\\?"action\\?"\s*:\s*\\?"(inserted|updated|upserted)/g) || []).length || (bare.match(/\bupsert\b/g) || []).length;
    }
    if (/\btask-finish\b/.test(bare)) {
      for (const m of command.matchAll(/task-finish\b[^\n]*?--id\s+["']?(TASK-[A-Z0-9]+-\d+)[^\n]*?(?:--status\s+["']?([A-Z]+))?/g)) {
        finished.push({ id: m[1], status: m[2] || 'DONE' });
      }
    }
  }
  return { upserts, finished };
}

export function finalAnswer(input) {
  if (typeof input.last_assistant_message === 'string' && input.last_assistant_message.trim()) return input.last_assistant_message;
  const tail = readTail(input.transcript_path, 512 * 1024);
  if (!tail.length) return null;
  for (let i = tail.length - 1; i >= 0; i--) {
    const rec = tail[i];
    const content = rec.message?.content;
    if (isPrompt(rec)) return null;
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

export const PROJECTS = 'louza, qlave, qoincamera, qoinpass, qoinmsg, qoinpay, qpoker, qoinstore, qoinsite, qoinmodel, qoinreviews, projetos';

// The whole protocol, sent once per session (session start, and again after compaction).
// The stages show on screen through the hooks' messages, so the agent does not narrate them.
export function protocolText(project) {
  const p = `--project ${project}`;
  return [
    'PROTOCOLO (as etapas aparecem na tela pelos hooks; não as narre):',
    `- Contexto: o hook de cada pedido já busca na base pelas palavras do pedido e mostra os itens achados. Para ir além: ${CLI} query ${p} --module <módulo> · ${CLI} search <palavras em inglês> ${p} (--all = todos os projetos) · ${CLI} get <ID> ${p}`,
    '- Tarefa: o hook abre e fecha sozinho; não rode task-start nem task-finish.',
    `- Encerramento: se surgiu decisão, modelo ou débito, grave antes da resposta final, numa chamada só: ${CLI} upsert ${p} --file - <<'EOF'`,
    '  [{"id":"<ID>","module":"<m>","feature":"<f>","type":"architecture_decision|system_model|current_behavior|future_revision|technical_debt","phase":"implemented|in_progress|queued|deprioritized","progress":"XX/YY (só em in_progress)","summary":"<inglês, até 250 caracteres>","keywords":"<6 a 10 palavras-chave em português, separadas por vírgula>","details":"<opcional>"}]',
    '  EOF',
    `- Tarefa travada: ${CLI} task-finish ${p} --id <TASK_ID> --status BLOCKED.`,
    'Subagentes ficam fora do protocolo: passe a eles o contexto e grave você o que descobrirem.',
    `Projetos (--project): ${PROJECTS}. A API compartilhada é o padrão do CLI: não passe --api-url nem --no-api.`,
  ].join('\n');
}

// Words of the prompt worth searching: no stop words, no short noise, at most 8.
const STOP_WORDS = new Set(('a o as os um uma uns umas de do da dos das em no na nos nas por para pra com sem que se e ou mas como ' +
  'mais menos muito pouco ja já nao não sim isso isto esse essa este esta aquele aquela ele ela eles elas eu voce você voces vocês ' +
  'me te nos lhe meu minha seu sua nosso nossa ao aos pelo pela pelos pelas qual quais quando onde porque porquê quem ' +
  'ser estar ter fazer faca faça pode posso preciso quero queria gostaria favor por-favor agora hoje tambem também ainda ' +
  'the and for with from that this what how why when where can could should would please make have has').split(' '));

export function searchWords(prompt) {
  const words = String(prompt || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_.-]*/gu) || [];
  const seen = new Set();
  const out = [];
  for (const w of words) {
    const clean = w.replace(/[.-]+$/, '');
    if (clean.length < 4 && !/\d/.test(clean)) continue;
    if (STOP_WORDS.has(clean) || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length === 8) break;
  }
  return out;
}

// The few best hits of the automatic search, in a few hundred characters. The score
// counts 3 per word found in the summary, id or Portuguese keywords and 1 per word found
// only in the details: from three words up a hit needs 5 (two strong matches, or one
// strong and two weak), so loose words in long notes do not flood the context.
export function hitsBlock(data, words) {
  const minScore = words.length >= 3 ? 5 : 3;
  const minTaskHits = Math.max(2, Math.ceil(words.length / 2));
  const cut = (s, n) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  const knowledge = (data?.knowledge || [])
    // Rules are already in CLAUDE.md; bootstrap-scan rows only list build files.
    .filter((k) => (k.score ?? 3 * k.hits) >= minScore && !['rules', 'hygiene'].includes(k.module) && !/^Discovered module /.test(k.summary || ''))
    .slice(0, 5);
  const tasks = (data?.tasks || []).filter((t) => t.hits >= minTaskHits && /^resultado:/i.test(t.current_step || '')).slice(0, 2);
  if (!knowledge.length && !tasks.length) return [];
  return [
    `Da base (busca automática pelo pedido; detalhes: ${CLI} get <ID> --project <projeto>):`,
    ...knowledge.map((k) => `- ${k.project_id}/${k.id} · ${cut(k.summary, 170)}`),
    ...tasks.map((t) => `- tarefa ${t.project_id}/${t.id} · ${cut(t.task_description, 60)} → ${cut(String(t.current_step).replace(/^resultado:\s*/i, ''), 110)}`),
  ];
}

export function upsertReminder(taskId) {
  return `Lembrete da ${STAGE.CLOSE}: antes da resposta final, grave numa chamada só (upsert --file -) o que este trabalho decidiu ou revelou ` +
    `(decisão, modelo, débito; summary em inglês, até 250 caracteres). ${taskId ? `A ${taskId} fecha sozinha` : 'A tarefa fecha sozinha'} ao fim do turno.`;
}

// Run the context CLI and parse its JSON stdout. Returns { ok, data, error }.
export function runCli(root, args, { timeoutMs = 10000 } = {}) {
  const res = spawnSync(process.execPath, [cliPath(), ...args], {
    env: cliEnv(root),
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
    const child = spawn(process.execPath, [cliPath(), ...args], { cwd: root, env: cliEnv(root), windowsHide: true });
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
