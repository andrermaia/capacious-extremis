#!/usr/bin/env node
// Background consolidation of finished sessions by a small model through the Message Batches
// API (half price, results within 24 h). Each run first collects the batches already ended, then
// submits the sessions that went quiet: their transcript is condensed (prompts, answers, tool
// calls, errors; no tool output), cut in windows that stay under the 100k-token rate card, and
// sent with the base's nearest notes. What comes back is a draft (module drafts): a handoff of
// the work and the notes worth saving, ready to upsert with "supersedes":"<draft id>". Nothing
// becomes a fact without an agent or the user confirming it.
//
// Off unless an Anthropic API key is configured for it: CONTEXT_CONSOLIDATE_API_KEY, or a file
// holding the key in CONTEXT_CONSOLIDATE_KEY_FILE (environment or the "env" block of the root's
// .claude/settings.local.json). Never ANTHROPIC_API_KEY: in the settings env it would switch
// Claude Code itself from the subscription to API billing. CONTEXT_CONSOLIDATE=0 turns it off.
//
//   node consolidate.mjs [--quiet]   collect ended batches, then submit quiet sessions
//   node consolidate.mjs status      pending batches and the spend of the last 30 days
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuredEnv } from './api-config.mjs';
import { callApi, apiRequest, searchWords, PROJECTS } from './hooks/hook-lib.mjs';

export const MODEL = 'claude-haiku-5-5';
// Per million tokens, prompts up to 100k tokens; the Batches API halves both.
const PRICE = { input: 0.10, output: 0.50, longInput: 0.50, longOutput: 2.50, batch: 0.5 };
// Measured 26/10/2026: condensed transcripts run ~2.1 characters per token (Portuguese, code,
// the newer tokenizer), so 160k characters is ~78k tokens: under the 100k-token rate card with
// room for the notes and the prompt.
export const WINDOW_CHARS = 160_000;
// A session is consolidated once it has been quiet this long (no new transcript lines).
const IDLE_MS = 2 * 60 * 60 * 1000;
// Too little new work since the last window: wait for more, or give up once the session is old.
const MIN_CHARS = 3_000;
const MIN_TOOLS = 4;
const GIVE_UP_MS = 3 * 24 * 60 * 60 * 1000;
// Spend guard per run and attempts per window before it is skipped.
const MAX_REQUESTS = 30;
const MAX_ATTEMPTS = 2;

const quiet = process.argv.includes('--quiet');
const log = (...a) => { if (!quiet) console.log(...a); };

export function consolidateDir() {
  const dir = process.env.CONTEXT_CONSOLIDATE_DIR || path.join(os.homedir(), '.claude', 'context-consolidate');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const stateFile = () => path.join(consolidateDir(), 'state.json');
const ledgerFile = () => path.join(consolidateDir(), 'usage.jsonl');
// The hooks' per-session state (scripts/hooks/hook-lib.mjs stateFile): the Stop hook leaves the
// transcript path, project and root there.
const hooksDir = () => path.join(os.tmpdir(), 'claude-context-hooks');

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function apiKey() {
  const direct = configuredEnv('CONTEXT_CONSOLIDATE_API_KEY');
  if (direct) return String(direct).trim();
  const file = configuredEnv('CONTEXT_CONSOLIDATE_KEY_FILE');
  if (!file) return null;
  try { return fs.readFileSync(file, 'utf8').trim() || null; } catch { return null; }
}
const apiBase = () => String(process.env.CONTEXT_CONSOLIDATE_API_BASE || 'https://api.anthropic.com').replace(/\/$/, '');

// Secrets never leave the machine in a draft, and the shared base gets no personal data: the
// prompt forbids it, these patterns catch what slips (in the transcript sent and in the reply).
const SCRUB = [
  [/sk-ant-[\w-]{10,}/g, '[segredo]'],
  [/\b(?:sk|pk|rk)-[\w-]{20,}/g, '[segredo]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[segredo]'],
  [/\bxox[abpr]-[\w-]{10,}/g, '[segredo]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[segredo]'],
  [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '[segredo]'],
  [/(Bearer\s+)[\w.~+/=-]{16,}/gi, '$1[segredo]'],
  [/((?:password|passwd|senha|secret|token|api[_-]?key)\s*[:=]\s*["']?)[^\s"',;]{6,}/gi, '$1[segredo]'],
  // The word, then a value in backticks or quotes a few characters on ("senha** `x`", "password: 'x'").
  [/((?:password|passwd|senha|secret|token|api[_-]?key)[^\n`'"]{0,20}[`'"])[^`'"\s]{6,}([`'"])/gi, '$1[segredo]$2'],
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[cpf]'],
  [/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '[cnpj]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/(?:\+55\s?)?\(?\b\d{2}\)?\s?9\d{4}-?\d{4}\b/g, '[telefone]'],
];
export function scrub(text) {
  let out = String(text ?? '');
  for (const [re, to] of SCRUB) out = out.replace(re, to);
  return out;
}

const WRAPPERS = /<(ide_selection|ide_opened_file|system-reminder|maestro-continuity)[^>]*>[\s\S]*?<\/\1>/g;
const clip = (s, n) => {
  const t = String(s ?? '').replace(WRAPPERS, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// What a tool call did, in one short line: the command, the file, the pattern.
function toolLine(b) {
  const i = b.input || {};
  const cmd = i.command ? String(i.command) : '';
  // What the agent itself saved to the base stays whole: the model must not propose it again.
  if (/context-cli[\s\S]*\bupsert\b/.test(cmd)) return `→ ${b.name} (gravou na base): ${clip(cmd, 2500)}`;
  const what = cmd || i.file_path || i.path || i.notebook_path || i.skill || i.pattern || i.url || i.query || i.description || i.prompt || '';
  return `→ ${b.name}: ${clip(what, 300)}`;
}

// One transcript record as condensed lines. Four formats, told apart record by record:
//   Claude Code  {type: user|assistant, message: {content}}
//   Codex        {type: event_msg, payload: {type: item_completed, item}} (the response_item copy of
//                each event is skipped: it repeats the same thing with injected context)
//   agy          {step_index, source, type: USER_INPUT|PLANNER_RESPONSE|GENERIC|ERROR_MESSAGE}
//   Kimi Code    {type: turn.prompt | context.append_loop_event, agentId, ...} (agents/main/wire.jsonl)
const prompt = (p) => ({ prompt: p, line: `USUÁRIO: ${p}` });
const tool = (name, what) => ({ tool: true, line: `→ ${name}: ${clip(what, 300)}` });
const error = (body) => ({ line: `✗ erro: ${clip(typeof body === 'string' ? body : JSON.stringify(body ?? ''), 400)}` });
const agent = (text) => ({ line: `AGENTE: ${clip(text, 3000)}` });
const texts = (content) => (Array.isArray(content) ? content.map((x) => x?.text || '').join('\n') : String(content || ''));
const cmdLine = (b) => {
  const cmd = b.cmd ?? b.command ?? b.CommandLine;
  return Array.isArray(cmd) ? cmd.at(-1) : cmd;
};

export function recordPieces(rec) {
  // Claude Code
  if (rec.message && (rec.type === 'user' || rec.type === 'assistant')) {
    const c = rec.message.content;
    if (rec.type === 'user' && typeof c === 'string') {
      if (rec.isMeta || /^\s*<(command-name|local-command)/.test(c)) return [];
      if (/^\s*<task-notification>/.test(c)) return [{ line: 'AVISO: uma tarefa em segundo plano terminou.' }];
      const p = clip(c, 4000);
      return p ? [prompt(p)] : [];
    }
    return (Array.isArray(c) ? c : []).flatMap((b) => {
      if (b?.type === 'text' && rec.type === 'assistant') return [agent(b.text)];
      if (b?.type === 'tool_use') return [{ tool: true, line: toolLine(b) }];
      if (b?.type === 'tool_result' && b.is_error) return [error(b.content)];
      return [];
    });
  }
  // Codex
  if (rec.type === 'event_msg' && rec.payload?.type === 'item_completed') {
    const it = rec.payload.item || {};
    switch (it.type) {
      case 'UserMessage': { const p = clip(texts(it.content), 4000); return p ? [prompt(p)] : []; }
      case 'AgentMessage': { const t = texts(it.content); return t.trim() ? [agent(t)] : []; }
      case 'CommandExecution': {
        const cmd = String(cmdLine(it) || '');
        const call = /context-cli[\s\S]*\bupsert\b/.test(cmd) ? { tool: true, line: `→ shell (gravou na base): ${clip(cmd, 2500)}` } : tool('shell', cmd);
        return it.status === 'failed' || (it.exit_code != null && it.exit_code !== 0) ? [call, error(`exit ${it.exit_code}`)] : [call];
      }
      case 'FileChange': {
        const files = Object.entries(it.changes || {}).map(([p, ch]) => `${ch?.type || 'edit'} ${p}`).join(', ');
        return it.status && it.status !== 'completed' ? [tool('apply_patch', files), error(it.stderr || it.status)] : [tool('apply_patch', files)];
      }
      case 'McpToolCall': {
        const call = tool(`${it.server}.${it.tool}`, JSON.stringify(it.arguments ?? ''));
        return it.status === 'failed' || it.result?.isError ? [call, error(it.status)] : [call];
      }
      case 'Extension': return it.query ? [tool(it.kind || 'extension', it.query)] : [];
      default: return [];
    }
  }
  // agy
  if (rec.step_index != null && rec.source) {
    if (rec.type === 'USER_INPUT' && rec.source === 'USER_EXPLICIT') {
      const text = String(rec.content || '');
      const p = clip(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/.exec(text)?.[1] ?? text, 4000);
      return p ? [prompt(p)] : [];
    }
    if (rec.type === 'PLANNER_RESPONSE') {
      const out = rec.content ? [agent(rec.content)] : [];
      for (const call of rec.tool_calls || []) {
        const args = Object.fromEntries(Object.entries(call.args || {}).map(([k, v]) => { try { return [k, JSON.parse(v)]; } catch { return [k, v]; } }));
        const what = String(args.CommandLine || args.Path || args.AbsolutePath || args.toolSummary || '');
        out.push(/context-cli[\s\S]*\bupsert\b/.test(what) ? { tool: true, line: `→ ${call.name} (gravou na base): ${clip(what, 2500)}` } : tool(call.name, what));
      }
      return out;
    }
    if (rec.type === 'GENERIC' && rec.status === 'ERROR') return [error(rec.error || rec.content)];
    if (rec.type === 'GENERIC' && /exited with code [1-9]/.test(String(rec.content || ''))) return [error(String(rec.content).slice(-400))];
    if (rec.type === 'ERROR_MESSAGE') return [error(rec.error)];
    return [];
  }
  // Kimi Code
  if (rec.type === 'turn.prompt') {
    if (rec.origin?.kind && rec.origin.kind !== 'user') return [];
    const p = clip(texts(rec.input), 4000);
    return p ? [prompt(p)] : [];
  }
  if (rec.type === 'context.append_loop_event') {
    const e = rec.event || {};
    if (e.type === 'content.part' && e.part?.type === 'text' && e.part.text?.trim()) return [agent(e.part.text)];
    if (e.type === 'tool.call') return [{ tool: true, line: toolLine({ name: e.name, input: e.args }) }];
    if (e.type === 'tool.result' && e.result?.isError) return [error(e.result.output)];
  }
  return [];
}

// The transcript lines [from, end) condensed into text, cut where the window fills up.
// Returns the text, the line it stopped at, how many tool calls and the user's prompts.
export function condense(lines, from = 0, maxChars = WINDOW_CHARS) {
  const parts = [];
  const prompts = [];
  let chars = 0;
  let toolUses = 0;
  let end = from;
  for (let i = from; i < lines.length; i++) {
    let rec;
    try { rec = JSON.parse(lines[i]); } catch { end = i + 1; continue; }
    const pieces = recordPieces(rec);
    const piece = pieces.map((p) => p.line).join('\n');
    if (piece && chars + piece.length > maxChars && chars > 0) break;
    if (piece) { parts.push(piece); chars += piece.length + 1; }
    for (const p of pieces) {
      if (p.prompt) prompts.push(p.prompt);
      if (p.tool) toolUses++;
    }
    end = i + 1;
  }
  return { text: scrub(parts.join('\n')), end, toolUses, prompts };
}

const TYPES = ['architecture_decision', 'system_model', 'current_behavior', 'future_revision', 'technical_debt'];
const PHASES = ['implemented', 'in_progress', 'queued', 'deprioritized'];
const str = { type: 'string' };
const strs = { type: 'array', items: str };
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['worth_saving', 'title', 'handoff', 'notes'],
  properties: {
    worth_saving: { type: 'boolean' },
    title: str,
    handoff: {
      type: 'object',
      additionalProperties: false,
      required: ['goal', 'state', 'failed', 'verified', 'open', 'next'],
      properties: { goal: str, state: str, failed: strs, verified: strs, open: strs, next: str },
    },
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['project', 'module', 'feature', 'type', 'phase', 'summary', 'keywords', 'details', 'supersedes'],
        properties: {
          project: str, module: str, feature: str,
          type: { type: 'string', enum: TYPES },
          phase: { type: 'string', enum: PHASES },
          summary: str, keywords: str, details: str, supersedes: str,
        },
      },
    },
  },
};

export const SYSTEM = `Você consolida uma sessão de trabalho de um agente de código numa base de conhecimento compartilhada por vários agentes. Recebe a sessão condensada (pedidos do usuário, respostas, comandos e erros; sem as saídas das ferramentas) e as notas já existentes na base sobre o assunto.

Devolva:
- worth_saving: false quando a sessão não deixou conhecimento durável nem trabalho por terminar (pergunta simples, conversa, tarefa trivial já concluída, ou tudo já gravado pelo próprio agente).
- title: uma linha em português dizendo o que a sessão fez.
- handoff: a passagem de trabalho para quem retomar. goal (o objetivo do usuário), state (onde parou, com commits, arquivos e ambientes citados na sessão), failed (abordagens que falharam e por quê), verified (o que foi de fato testado ou conferido, com o comando), open (o que ficou pendente ou sem verificar), next (o próximo passo concreto). Só o que está na sessão; não invente.
- notes: só fatos duráveis que outra sessão precisaria saber: decisões e o porquê, comportamento implementado, armadilhas, dívidas técnicas, planos. Nada efêmero. Não repita o que o agente já gravou ("gravou na base") nem o que as notas existentes já dizem; se a sessão corrige ou atualiza uma nota existente, reescreva-a e ponha o ID dela em supersedes (senão, supersedes = ""). No máximo 5 notas.
  - summary: em inglês, até 250 caracteres, autossuficiente, com datas absolutas e IDs de commit quando houver.
  - keywords: 6 a 10 palavras-chave em português, separadas por vírgula.
  - details: opcional (pode ser ""), em inglês, curto.
  - project: um destes: ${PROJECTS}. Fato de um produto vai no projeto dele; "projetos" só para o que cruza produtos.
  - module/feature: curtos, minúsculos, com hífen (use os das notas existentes quando couber).
  - type: architecture_decision | system_model | current_behavior | future_revision | technical_debt. phase: implemented | in_progress | queued | deprioritized.

Privacidade: a sessão pode conter dados de pessoas reais (alunos, responsáveis, clientes). Nunca escreva nomes de pessoas físicas que não sejam o usuário André, CPF, telefone, e-mail, endereço ou qualquer dado pessoal; nunca escreva senhas, tokens ou chaves. Descreva o fato técnico sem eles.`;

// One Batches request for a window: the nearest notes first (they change slowly), then the session.
export function buildRequest(customId, { project, text, neighbours }) {
  const notes = (neighbours || []).map((k) => `- ${k.project_id}/${k.id} · ${k.knowledge_type || ''} · ${String(k.summary || '').replace(/\s+/g, ' ')}`).join('\n');
  return {
    custom_id: customId,
    params: {
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: `<notas_existentes>\n${notes || '(nenhuma)'}\n</notas_existentes>\n\n<sessao projeto="${project}">\n${text}\n</sessao>`,
      }],
    },
  };
}

// Word overlap of two summaries (Jaccard over words of 4+ letters, accents and case ignored).
const wordSet = (s) => new Set((String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{4,}/g) || []));
export function overlap(a, b) {
  const x = wordSet(a);
  const y = wordSet(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}
// A proposal this close to a note already in the base repeats it (measured 27/10/2026: a session
// whose agent saved its notes at the end, past the window, got all five proposed again).
export const KNOWN_OVERLAP = 0.4;

// The draft a successful result becomes; null when the model found nothing worth saving, or when
// every note it proposes is already in the base (existing: rows found for them) and nothing is open.
export function draftFrom(reply, win, existing = []) {
  if (!reply || (!reply.worth_saving && !(reply.notes || []).length)) return null;
  const h = reply.handoff || {};
  const list = (title, xs) => (xs?.length ? `${title}:\n${xs.map((x) => `- ${scrub(x)}`).join('\n')}` : '');
  const known = new Set(PROJECTS.split(/,\s*/));
  const draftKey = `${win.project}/${win.draftId}`;
  const already = [];
  const fresh = (reply.notes || []).slice(0, 5).filter((n) => {
    const twin = existing.find((k) => overlap(k.summary, n.summary) >= KNOWN_OVERLAP);
    if (twin) already.push(`${twin.project_id}/${twin.id}`);
    return !twin;
  });
  if (!fresh.length && !(h.open || []).length && (reply.notes || []).length) return null;
  const notes = fresh.map((n) => {
    const summary = scrub(n.summary).replace(/\s+/g, ' ').trim();
    return {
      project: known.has(n.project) ? n.project : win.project,
      row: {
        id: '<ID>', module: n.module || 'general', feature: n.feature || 'general', type: n.type, phase: n.phase,
        summary: summary.length > 250 ? `${summary.slice(0, 249)}…` : summary,
        keywords: scrub(n.keywords),
        ...(n.details ? { details: scrub(n.details) } : {}),
        supersedes: [n.supersedes, draftKey].filter(Boolean).join(','),
      },
    };
  });
  const handoff = [
    h.goal && `Objetivo: ${scrub(h.goal)}`,
    h.state && `Estado: ${scrub(h.state)}`,
    list('Falhou', h.failed), list('Verificado', h.verified), list('Pendente', h.open),
    h.next && `Próximo passo: ${scrub(h.next)}`,
  ].filter(Boolean).join('\n\n');
  const proposals = notes.length
    ? `\n\nNotas propostas (confira, dê um ID e grave com upsert; o supersedes já inclui este rascunho):\n${notes.map((n) => `--project ${n.project} ${JSON.stringify(n.row)}`).join('\n')}`
    : '';
  const repeats = already.length ? `\n\nJá na base (não propostas de novo): ${[...new Set(already)].join(', ')}` : '';
  const title = scrub(reply.title || h.goal || 'sessão').replace(/\s+/g, ' ').trim();
  return {
    id: win.draftId, module: 'drafts', feature: 'consolidacao', knowledge_type: 'current_behavior', phase: 'queued',
    summary: `Rascunho (Haiku): ${title}`.slice(0, 250),
    keywords: [...new Set(notes.flatMap((n) => String(n.row.keywords).split(/,\s*/)).filter(Boolean))].slice(0, 10).join(', ') || null,
    no_similar: true,
    details: `${handoff}${proposals}${repeats}\n\nSessão ${win.session} · linhas ${win.from}–${win.to} · tarefas ${(win.tasks || []).join(', ') || '—'}`,
    // The Stop hook's thin draft of the same task is replaced by this one.
    ...(win.taskDrafts?.length ? { supersedes: win.taskDrafts.join(',') } : {}),
  };
}

export function costOf(usage) {
  const input = (usage?.input_tokens || 0) + (usage?.cache_read_input_tokens || 0) + (usage?.cache_creation_input_tokens || 0);
  const output = usage?.output_tokens || 0;
  const long = input > 100_000;
  return ((input * (long ? PRICE.longInput : PRICE.input) + output * (long ? PRICE.longOutput : PRICE.output)) / 1e6) * PRICE.batch;
}

async function anthropic(key, method, endpoint, body) {
  const res = await fetch(`${apiBase()}${endpoint}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

// The base's rows nearest to each proposed note (its project, by the summary's words), for
// draftFrom to drop what is already saved. The base down: none, and every proposal stays.
async function existingFor(reply, win) {
  const known = new Set(PROJECTS.split(/,\s*/));
  const found = await Promise.all((reply.notes || []).slice(0, 5).map((n) => {
    const words = searchWords(n.summary).slice(0, 8);
    const project = known.has(n.project) ? n.project : win.project;
    return words.length ? callApi(win.root, ['search', ...words, '--project', project, '--limit', '5'], { timeoutMs: 10_000 }) : null;
  }));
  return found.flatMap((r) => (r?.ok ? r.data?.knowledge || [] : []));
}

// Ended batches: each succeeded result becomes a draft and moves its session's watermark on;
// a failed window is tried again on the next run, MAX_ATTEMPTS times at most.
export async function collect(key, state) {
  for (const batch of [...(state.batches || [])]) {
    const info = await (await anthropic(key, 'GET', `/v1/messages/batches/${batch.id}`)).json();
    if (info.processing_status !== 'ended') continue;
    const body = info.results_url ? await (await anthropic(key, 'GET', new URL(info.results_url).pathname)).text() : '';
    const results = new Map(body.split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.custom_id, r.result]; }));
    for (const win of batch.windows) {
      const r = results.get(win.customId);
      const s = (state.sessions[win.session] ||= { done: 0 });
      const msg = r?.type === 'succeeded' ? r.message : null;
      if (msg) fs.appendFileSync(ledgerFile(), `${JSON.stringify({ at: new Date().toISOString(), batch: batch.id, window: win.customId, usage: msg.usage, cost: costOf(msg.usage) })}\n`);
      let reply = null;
      if (msg && msg.stop_reason === 'end_turn') {
        try { reply = JSON.parse(msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('')); } catch {}
      }
      if (!reply) {
        s.attempts = (s.attempts || 0) + 1;
        if (s.attempts >= MAX_ATTEMPTS) { s.done = win.to; s.attempts = 0; }
        log(`janela ${win.customId}: ${r?.type || 'sem resultado'}${msg ? ` (${msg.stop_reason})` : ''}`);
        continue;
      }
      const draft = draftFrom(reply, win, await existingFor(reply, win));
      // The base down keeps the draft here, to save on the next run: the window is not paid twice.
      if (draft) state.unsaved = [...(state.unsaved || []), { project: win.project, root: win.root, draft }];
      s.done = win.to;
      s.attempts = 0;
    }
    state.batches = state.batches.filter((b) => b.id !== batch.id);
  }
  return saveDrafts(state);
}

// Drafts collected but not yet in the base (just now, or the base was down on an earlier run).
async function saveDrafts(state) {
  let saved = 0;
  const left = [];
  for (const item of state.unsaved || []) {
    const r = await apiRequest(item.root, 'POST', `upsert?project=${encodeURIComponent(item.project)}`, item.draft, { timeoutMs: 10_000 });
    if (r.ok) saved++;
    else { left.push(item); log(`rascunho ${item.draft.id}: ${r.error}`); }
  }
  state.unsaved = left;
  return saved;
}

// Codex may send no transcript path to its hooks: its rollouts are found by the session id, the
// UUID at the end of ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl (last 30 days).
export function codexRollouts(home = os.homedir(), now = Date.now()) {
  const index = new Map();
  for (let d = 0; d < 30; d++) {
    const day = new Date(now - d * 24 * 60 * 60 * 1000);
    const dir = path.join(home, '.codex', 'sessions', String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0'));
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const id = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(n)?.[1];
      if (id && !index.has(id)) index.set(id, path.join(dir, n));
    }
  }
  return index;
}

// Quiet sessions with enough new work since their watermark, as windows ready to submit.
export async function pendingWindows(state, now = Date.now()) {
  let rollouts = null;
  const busy = new Set((state.batches || []).flatMap((b) => b.windows.map((w) => w.session)));
  const out = [];
  let files = [];
  try { files = fs.readdirSync(hooksDir()).filter((f) => f.endsWith('.json')); } catch {}
  for (const f of files) {
    if (out.length >= MAX_REQUESTS) break;
    const session = f.replace(/\.json$/, '');
    const hook = loadJson(path.join(hooksDir(), f), null);
    if (!hook?.project || !hook.root || hook.bench || busy.has(session)) continue;
    const transcript = hook.transcript || (rollouts ||= codexRollouts(os.homedir(), now)).get(session);
    if (!transcript) continue;
    let stat;
    try { stat = fs.statSync(transcript); } catch { continue; }
    if (now - stat.mtimeMs < IDLE_MS) continue;
    const s = (state.sessions[session] ||= { done: 0 });
    // Unchanged since the last look (sizes match): no need to read a transcript of many MB again.
    if (s.size === stat.size) continue;
    const lines = fs.readFileSync(transcript, 'utf8').split('\n').filter(Boolean);
    if (s.done >= lines.length) { s.size = stat.size; continue; }
    const win = condense(lines, s.done);
    if (win.text.length < MIN_CHARS || win.toolUses < MIN_TOOLS) {
      // Not enough yet; an old session will not grow, so its tail is dropped.
      if (now - stat.mtimeMs > GIVE_UP_MS) { s.done = win.end; s.size = stat.size; }
      continue;
    }
    const tasks = (hook.tasks || []).map((t) => t.id).filter(Boolean);
    out.push({
      session, project: hook.project, root: hook.root, from: s.done, to: win.end, text: win.text, prompts: win.prompts, tasks,
      // agy-<uuid> and kimi-<uuid> sessions: the prefix out, so the id keeps the UUID's start.
      draftId: `DRAFT-H-${session.replace(/^(agy|kimi)-/, '').slice(0, 8).toUpperCase()}-${s.done}`,
      taskDrafts: tasks.map((id) => `DRAFT-${String(id).replace(/^TASK-/, '')}`),
    });
  }
  return out;
}

export async function submit(key, state, windows) {
  if (!windows.length) return null;
  const requests = [];
  for (const [i, w] of windows.entries()) {
    const words = searchWords(w.prompts.join(' ')).slice(0, 8);
    const found = words.length
      ? await callApi(w.root, ['search', ...words, '--project', w.project, '--limit', '12'], { timeoutMs: 10_000 })
      : null;
    w.customId = `w${i}-${w.session.slice(0, 8)}-${w.from}`;
    requests.push(buildRequest(w.customId, { project: w.project, text: w.text, neighbours: found?.ok ? found.data?.knowledge : [] }));
  }
  const batch = await (await anthropic(key, 'POST', '/v1/messages/batches', { requests })).json();
  state.batches = [...(state.batches || []), {
    id: batch.id, at: new Date().toISOString(),
    windows: windows.map(({ text, prompts, ...w }) => w),
  }];
  return batch.id;
}

function status(state) {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let n = 0;
  let cost = 0;
  try {
    for (const l of fs.readFileSync(ledgerFile(), 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(l);
      if (Date.parse(r.at) >= since) { n++; cost += r.cost || 0; }
    }
  } catch {}
  console.log(`Consolidação ${apiKey() ? 'ligada' : 'desligada (sem chave)'} · modelo ${MODEL} via Batches`);
  console.log(`Lotes pendentes: ${(state.batches || []).length} (${(state.batches || []).reduce((a, b) => a + b.windows.length, 0)} janelas)`);
  console.log(`Últimos 30 dias: ${n} janelas, US$ ${cost.toFixed(4)}`);
}

async function main() {
  const state = loadJson(stateFile(), { sessions: {}, batches: [] });
  state.sessions ||= {};
  if (process.argv[2] === 'status') return status(state);
  if (process.env.CONTEXT_CONSOLIDATE === '0') return;
  const key = apiKey();
  if (!key) return log('Consolidação desligada: configure CONTEXT_CONSOLIDATE_KEY_FILE ou CONTEXT_CONSOLIDATE_API_KEY.');
  try {
    const drafts = await collect(key, state);
    if (drafts) log(`${drafts} rascunho(s) gravado(s)`);
    const windows = await pendingWindows(state);
    const id = await submit(key, state, windows);
    if (id) log(`lote ${id}: ${windows.length} janela(s)`);
  } finally {
    saveJson(stateFile(), state);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { if (!quiet) console.error(err.message); process.exit(1); });
}
