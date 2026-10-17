// Shared helpers for the Claude Code hooks that enforce the
// managing-system-context protocol. Zero dependencies (Node >= 22).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configuredApiUrl } from '../api-config.mjs';

export const STAGE = {
  CONTEXT: 'Etapa 1/3 · Contexto',
  TASK: 'Etapa 2/3 · Tarefa',
  CLOSE: 'Etapa 3/3 · Encerramento',
};

export const CLI = 'node .agents/skills/managing-system-context/scripts/context-cli.mjs';
export const DEFAULT_MODULE = 'general';

// The API address comes from the machine's configuration (scripts/api-config.mjs), never from
// this public repository; '' when none is configured, and then the hooks stay silent.
export function apiUrl() {
  return configuredApiUrl() || '';
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
  let toolUses = 0;
  const edited = new Set();
  const upserted = [];
  for (const rec of tail.slice(start)) {
    for (const b of Array.isArray(rec.message?.content) ? rec.message.content : []) {
      if (b?.type !== 'tool_use') continue;
      toolUses++;
      const f = b.input?.file_path || b.input?.notebook_path;
      if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(b.name) && f) edited.add(String(f));
    }
  }
  for (const [id, command] of commands) {
    const bare = command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
    const out = results.get(id) || '';
    if (/\bupsert\b/.test(bare)) {
      const project = command.match(/upsert\b[^\n]*?--project\s+["']?([\w-]+)/)?.[1];
      const ids = [...command.matchAll(/"id"\s*:\s*"([^"]+)"|--id\s+["']?([^\s"']+)/g)].map((m) => m[1] || m[2]);
      if (project && ids.length) upserted.push({ project, ids: [...new Set(ids)] });
      upserts += (out.match(/\\?"action\\?"\s*:\s*\\?"(inserted|updated|upserted)/g) || []).length || (bare.match(/\bupsert\b/g) || []).length;
    }
    if (/\btask-finish\b/.test(bare)) {
      for (const m of command.matchAll(/task-finish\b[^\n]*?--id\s+["']?(TASK-[A-Z0-9]+-\d+)[^\n]*?(?:--status\s+["']?([A-Z]+))?/g)) {
        finished.push({ id: m[1], status: m[2] || 'DONE' });
      }
    }
  }
  return { upserts, finished, toolUses, edited: [...edited], upserted };
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
    '  [{"id":"<ID>","module":"<m>","feature":"<f>","type":"architecture_decision|system_model|current_behavior|future_revision|technical_debt","phase":"implemented|in_progress|queued|deprioritized","progress":"XX/YY (só em in_progress)","summary":"<inglês, até 250 caracteres>","keywords":"<6 a 10 palavras-chave em português, separadas por vírgula>","details":"<opcional>","supersedes":"<ID antigo que este substitui, opcional>","links":"<opcional: depends_on:ID, contradicts:ID, refers_to:ID>"}]',
    '  EOF',
    `- Tarefa travada: ${CLI} task-finish ${p} --id <TASK_ID> --status BLOCKED.`,
    'Subagentes ficam fora do protocolo: passe a eles o contexto e grave você o que descobrirem.',
    `Projetos (--project): ${PROJECTS}. Fato de um produto vai no projeto dele (--project louza, qoinstore, qoinpass…), mesmo trabalhando na raiz; projetos é só para o que cruza produtos. A API compartilhada é o padrão do CLI: não passe --api-url nem --no-api.`,
  ].join('\n');
}

// Words of the prompt worth searching: no stop words, no short noise, at most 8.
const STOP_WORDS = new Set(('a o as os um uma uns umas de do da dos das em no na nos nas por para pra com sem que se e ou mas como ' +
  'mais menos muito pouco ja já nao não sim isso isto esse essa este esta aquele aquela ele ela eles elas eu voce você voces vocês ' +
  'me te nos lhe meu minha seu sua nosso nossa ao aos pelo pela pelos pelas qual quais quando onde porque porquê quem ' +
  'ser estar ter fazer faca faça pode posso preciso quero queria gostaria favor por-favor agora hoje tambem também ainda ' +
  'the and for with from that this what how why when where can could should would please make have has').split(' '));

// Short acknowledgements ("ok", "sim, pode", "valeu!") carry nothing to search and often no
// work at all: the prompt hook opens no task for them (the Stop hook records one if the turn
// ends up using tools).
const TRIVIAL = new Set(('ok okay okk sim não nao obrigado obrigada obg valeu vlw beleza blz certo perfeito show top ' +
  'ótimo otimo entendi isso pode segue continue continua siga vai bora manda fechado combinado bom boa dia tarde noite ' +
  'oi olá ola tudo bem legal massa claro exato verdade thanks thx yes no').split(' '));

export function isTrivialPrompt(prompt) {
  const text = String(prompt || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!text || text.length > 30) return false;
  const words = text.split(/\s+/);
  return words.length <= 4 && words.every((w) => TRIVIAL.has(w));
}

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
// A hit is strong when two of its words sit in the summary, id or keywords: score - hits =
// 2 per such word (+1 per word in module or feature), so loose words in long details never
// make a row strong. Semantic thresholds for the prompt are stricter than the API's: a prompt
// is not a question and carries noise.
const STRONG = 4;
// Measured 16/10/2026 on real prompts: word hits unrelated to the prompt 0.78-0.82 in meaning,
// the right rows 0.82-0.90 (multilingual-e5-small, query vs passage).
const RELEVANT = 0.82;
const RELEVANT_TOP = 0.80;
// An excerpt costs ~420 characters: only for rows clearly about the prompt (the right rows
// measured 0.86-0.90; a noisy top word hit 0.815).
const EXCERPT_MIN = 0.845;
// The API's full-text search says how many rare-enough words sit in summary, id or keywords.
const strength = (k) => (k.strong != null ? 2 * k.strong : (k.score ?? 3 * k.hits) - (k.hits ?? 0));
const SEMANTIC_IN_PROMPT = 0.865;
const SEMANTIC_STRONG = 0.88;

// One hop of the base's graph under the row it hangs from, and the warning that an open
// note's files changed after it was written (maybe fixed since).
const EDGE_LABEL = {
  'depends_on|out': 'depende de', 'depends_on|in': 'é base de', 'contradicts|out': 'contradiz', 'contradicts|in': 'contradito por',
  'refers_to|out': 'cita', 'refers_to|in': 'citado por',
};
export const staleNote = (stale) => (stale ? ` ⚠ arquivo mudou depois desta nota: ${stale.repo}@${stale.sha} (${stale.date})` : '');

export function hitsBlock(data, words, ownTaskIds = new Set()) {
  const minScore = words.length >= 3 ? 5 : 3;
  const minTaskHits = Math.max(2, Math.ceil(words.length / 2));
  const cut = (s, n) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  const ranked = (data?.knowledge || [])
    // Rules are already in CLAUDE.md; bootstrap-scan rows only list build files.
    .filter((k) => (k.score ?? 3 * k.hits) >= minScore && !['rules', 'hygiene'].includes(k.module) && !/^Discovered module /.test(k.summary || ''))
    // The API's rank (word score weighed by meaning) when it sends one; else equal word
    // scores put the row closer in meaning to the prompt first.
    .sort((a, b) => (a.rank != null && b.rank != null ? b.rank - a.rank
      : (b.score ?? 3 * b.hits) - (a.score ?? 3 * a.hits) || (b.similarity ?? 0) - (a.similarity ?? 0)));
  // A word hit far in meaning from the prompt (API similarity) only shared loose words: out,
  // except the best one, which only needs to clear a lower bar. Without similarity, all stay.
  const knowledge = ranked
    .filter((k, i) => k.similarity == null || k.similarity >= RELEVANT || (i === 0 && k.similarity >= RELEVANT_TOP))
    .slice(0, 5);
  const tasks = (data?.tasks || []).filter((t) => t.hits >= minTaskHits && !ownTaskIds.has(t.id) && /^resultado:/i.test(t.current_step || '')).slice(0, 2);
  // Rows close in meaning that no word reached (API semantic layer), after the word hits.
  const seen = new Set(knowledge.map((k) => `${k.project_id}|${k.id}`));
  const similar = (data?.semantic || [])
    .filter((k) => k.similarity >= SEMANTIC_IN_PROMPT && !seen.has(`${k.project_id}|${k.id}`) && !['rules', 'hygiene'].includes(k.module))
    .slice(0, Math.min(2, Math.max(0, 5 - knowledge.length)));
  // A strong hit brings the start of its details, so the agent rarely needs a get turn.
  let excerpts = 0;
  const withExcerpt = (line, k, strong) => {
    if (!strong || !k.excerpt || excerpts >= 2) return [line];
    excerpts++;
    return [line, `  ↳ ${cut(k.excerpt, 420)}`];
  };
  // Commits whose subject holds two of the words (or one, for a one-word prompt): what changed and when.
  const commits = (data?.commits || []).filter((c) => c.score >= Math.min(6, 3 * words.length)).slice(0, 2);
  if (!knowledge.length && !tasks.length && !similar.length && !commits.length) return [];
  const related = (data?.related || []).slice(0, 2);
  const relatedOf = (k) => related.filter((r) => r.for === `${k.project_id}|${k.id}`)
    .map((r) => `  ↔ ${EDGE_LABEL[`${r.kind}|${r.dir}`] || r.kind} ${r.project_id}/${r.id} · ${cut(r.summary, 110)}`);
  return [
    `Da base (busca automática pelo pedido; detalhes: ${CLI} get <ID> --project <projeto>):`,
    ...knowledge.flatMap((k, i) => [...withExcerpt(`- ${k.project_id}/${k.id} · ${cut(k.summary, 170)}${staleNote(k.stale)}`, k,
      i < 2 && strength(k) >= STRONG && (k.similarity == null || k.similarity >= EXCERPT_MIN)), ...relatedOf(k)]),
    ...similar.flatMap((k) => withExcerpt(`- ≈ ${k.project_id}/${k.id} · ${cut(k.summary, 170)}`, k, k.similarity >= SEMANTIC_STRONG)),
    ...tasks.map((t) => `- tarefa ${t.project_id}/${t.id} · ${cut(t.task_description, 60)} → ${cut(String(t.current_step).replace(/^resultado:\s*/i, ''), 110)}`),
    ...commits.map((c) => `- commit ${c.repo}@${String(c.sha).slice(0, 7)} · ${c.date} · ${cut(c.subject, 120)}`),
  ];
}

// --- File radar: rows of the base linked to files (paths), kept as a local index by the
// session-start hook, looked up by the edit hook with no network call.
const GENERIC_FILES = new Set(['index.ts', 'index.js', 'index.tsx', 'page.tsx', 'layout.tsx', 'route.ts', 'main.ts', 'app.module.ts',
  'package.json', 'readme.md', 'ci.yml', 'docker-compose.yml', 'tsconfig.json', '.env', 'dockerfile', 'schema.sql', 'server.mjs', 'config.ts']);

function pathsIndexFile() {
  return path.join(path.dirname(stateFile('paths')), 'paths-index.json');
}

export function savePathsIndex(rows) {
  try { fs.writeFileSync(pathsIndexFile(), JSON.stringify(rows)); } catch {}
}

export function loadPathsIndex() {
  try { return JSON.parse(fs.readFileSync(pathsIndexFile(), 'utf8')); } catch { return []; }
}

// A stored path matches the edited file when the file ends with it (repo-relative or deeper);
// a bare file name counts only when it is not generic (index.ts, page.tsx, package.json…).
export function pathMatches(stored, file) {
  const f = String(file || '').replace(/\\/g, '/').toLowerCase();
  const p = String(stored || '').toLowerCase();
  if (!p || !f) return false;
  if (p.includes('/')) return f === p || f.endsWith(`/${p}`);
  return !GENERIC_FILES.has(p) && f.split('/').pop() === p;
}

// Folder names that differ from the project id; every other project lives in folders named after it.
const PROJECT_DIRS = { qpoker: 'qoinpoker' };
const CROSS_PROJECT = new Set(['projetos', 'global']);

// Rows of another product stay out: a file under louza-fe/ only hears about louza's rows (and the
// cross-project ones), so a bare name like permissoes.ts does not pull qlave's notes.
export function radarFor(file, index, max = 3) {
  const segs = String(file || '').replace(/\\/g, '/').toLowerCase().split('/');
  const products = [...new Set((index || []).map((r) => r.project_id))].filter((p) => !CROSS_PROJECT.has(p));
  const owners = products.filter((p) => segs.some((s) => s.startsWith(PROJECT_DIRS[p] || p)));
  return (index || [])
    .filter((r) => !owners.length || owners.includes(r.project_id) || CROSS_PROJECT.has(r.project_id))
    .filter((r) => (r.paths || []).some((p) => pathMatches(p, file)))
    .sort((a, b) => (b.knowledge_type === 'technical_debt') - (a.knowledge_type === 'technical_debt') || String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, max);
}

// The file path relative to its git repository (or to the projects root), so a link made in
// one clone or worktree matches the same file in another.
export function repoRelative(file, root) {
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return path.relative(dir, path.resolve(file)).split(path.sep).join('/').toLowerCase();
    const parent = path.dirname(dir);
    if (parent === dir || (root && path.resolve(dir) === path.resolve(root))) break;
    dir = parent;
  }
  return path.relative(root || path.dirname(file), path.resolve(file)).split(path.sep).join('/').toLowerCase();
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

// The hooks' calls to the shared base, made with fetch inside the hook process instead of
// spawning the CLI (one Node start per call cost ~0.3 s; the session start made six). The
// arguments are the CLI's, so a call reads the same either way; the answer is the API's JSON,
// which is also what the CLI prints. A read that fails here gets no local-cache fallback
// (withLocalFallback still covers the module list).
export async function callApi(root, args, { timeoutMs = 8000 } = {}) {
  const [command, ...rest] = args;
  const opts = {};
  const words = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) { words.push(a); continue; }
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--') && key !== 'all') { opts[key] = next; i++; } else opts[key] = true;
  }
  const project = opts.project;
  const base = String(opts['api-url'] || apiUrl()).replace(/\/$/, '');
  const q = (pairs) => pairs.filter(([, v]) => v != null && v !== true).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  let method = 'GET';
  let endpoint;
  let body;
  switch (command) {
    case 'list-modules': endpoint = `modules?${q([['project', project]])}`; break;
    case 'list-tasks': endpoint = `tasks?${q([['project', project], ['status', opts.status && String(opts.status).toUpperCase()], ['limit', opts.limit]])}`; break;
    case 'query': endpoint = `query?${q([['project', project], ['module', opts.module], ['phase', opts.phase], ['type', opts.type]])}`; break;
    case 'get': endpoint = `knowledge/${encodeURIComponent(words[0] || opts.id)}?${q([['project', project]])}`; break;
    case 'search': endpoint = `search?${q([['q', words.join(' ')], ['limit', opts.limit], ['excerpt', opts.excerpt], ['commits', opts.commits], ['meaning', opts.meaning], ['project', opts.all ? null : [project, 'global'].filter(Boolean).join(',')]])}`; break;
    case 'task-start': method = 'POST'; endpoint = `tasks/start?${q([['project', project]])}`; body = { project_id: project, module: opts.module || 'general', desc: opts.desc || 'Unnamed task' }; break;
    case 'task-step': method = 'POST'; endpoint = `tasks/step?${q([['project', project]])}`; body = { project_id: project, id: opts.id, step: opts.step }; break;
    case 'task-finish': method = 'POST'; endpoint = `tasks/finish?${q([['project', project]])}`; body = { project_id: project, id: opts.id, status: String(opts.status || 'DONE').toUpperCase() }; break;
    default: return runCliAsync(root, args, { timeoutMs });
  }
  return apiRequest(root, method, endpoint, body, { timeoutMs, base });
}

export async function apiRequest(root, method, endpoint, body, { timeoutMs = 8000, base = apiUrl() } = {}) {
  const token = cliEnv(root).CONTEXT_API_TOKEN;
  try {
    const res = await fetch(`${String(base).replace(/\/$/, '')}/${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: `API error (${res.status}): ${data?.error || res.statusText}` };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.name === 'TimeoutError' ? `API timeout after ${timeoutMs} ms` : err.message };
  }
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
