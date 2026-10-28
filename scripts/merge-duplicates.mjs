#!/usr/bin/env node
// Duplicate notes merged by the small model through the Message Batches API. The hygiene check
// finds pairs of notes in the same project whose summaries share most of their words; each pair
// goes to Haiku, which says whether they state the same fact and, when they do, writes the merged
// note. What comes back is a draft (module drafts) holding the upsert that keeps one ID and
// supersedes the other: nothing changes in the base until an agent or the user confirms it.
//
// Same key and switches as consolidate.mjs (CONTEXT_CONSOLIDATE_API_KEY or ..._KEY_FILE,
// CONTEXT_CONSOLIDATE=0 off); its spend goes to the same ledger, so `consolidate.mjs status`
// counts both. A pair is proposed once: a "different facts" answer is remembered too.
//
//   node merge-duplicates.mjs [--quiet]   collect ended batches, then submit new pairs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, consolidateDir, apiKey, scrub, costOf, anthropic } from './consolidate.mjs';
import { duplicates } from './hygiene.mjs';
import { apiRequest, PROJECTS } from './hooks/hook-lib.mjs';

// Pairs per run: a weekly run over a tidy base finds few; the cap keeps a messy one cheap.
const MAX_PAIRS = 20;
const TYPES = ['architecture_decision', 'system_model', 'current_behavior', 'future_revision', 'technical_debt'];
const PHASES = ['implemented', 'in_progress', 'queued', 'deprioritized'];

const quiet = process.argv.includes('--quiet');
const log = (...a) => { if (!quiet) console.log(...a); };
const here = path.dirname(fileURLToPath(import.meta.url));

const stateFile = () => path.join(consolidateDir(), 'merge-state.json');
const ledgerFile = () => path.join(consolidateDir(), 'usage.jsonl');
function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// The workspace root holding the token (.claude/settings*.json): the skill's installed clone sits
// in <root>/.agents/skills/managing-system-context; anywhere else, the working directory.
function workspaceRoot() {
  const parts = path.resolve(here, '..').split(path.sep);
  return parts.slice(-3).join('/') === '.agents/skills/managing-system-context' ? parts.slice(0, -3).join(path.sep) : process.cwd();
}

export const pairKey = (p) => `${p.project}|${[p.a, p.b].sort().join('|')}`;

const str = { type: 'string' };
export const MERGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['same_fact', 'keep', 'summary', 'keywords', 'details', 'type', 'phase', 'reason'],
  properties: {
    same_fact: { type: 'boolean' },
    keep: { type: 'string', enum: ['a', 'b'] },
    summary: str, keywords: str, details: str,
    type: { type: 'string', enum: TYPES },
    phase: { type: 'string', enum: PHASES },
    reason: str,
  },
};

export const MERGE_SYSTEM = `Você revisa uma base de conhecimento compartilhada por agentes de código. Recebe duas notas do mesmo projeto cujos resumos se parecem e decide se dizem o mesmo fato.

Devolva:
- same_fact: true só quando as duas descrevem o mesmo fato, decisão ou comportamento (uma repete, detalha ou atualiza a outra). Assuntos vizinhos, produtos ou módulos diferentes, ou fatos que se complementam sem se repetir: false.
- keep: a nota cujo ID continua ("a" ou "b"): a mais recente ou a mais completa.
- summary: a nota fundida, em inglês, até 250 caracteres, autossuficiente, com o que cada uma tem de útil; quando se contradizem, vale a mais recente (updated_at) e a data entra no texto.
- keywords: 6 a 10 palavras-chave em português, separadas por vírgula.
- details: os detalhes das duas, fundidos, em inglês (pode ser "").
- type e phase: os da nota fundida.
- reason: uma frase em português dizendo por que são ou não o mesmo fato.
Com same_fact false, os demais campos podem ir vazios ("") e keep "a".

Privacidade: nunca escreva nomes de pessoas físicas que não sejam o usuário André, CPF, telefone, e-mail, endereço ou qualquer dado pessoal; nunca escreva senhas, tokens, chaves, hosts ou IPs que não estejam nas notas.`;

const noteXml = (tag, n) => `<${tag} id="${n.id}" type="${n.knowledge_type || ''}" phase="${n.phase || ''}" module="${n.module || ''}" updated_at="${n.updated_at || ''}">
summary: ${String(n.summary || '').replace(/\s+/g, ' ')}
keywords: ${n.keywords || ''}
details: ${scrub(String(n.details || '')).slice(0, 4000)}
</${tag}>`;

export function buildMergeRequest(customId, a, b) {
  return {
    custom_id: customId,
    params: {
      model: MODEL,
      max_tokens: 4000,
      system: MERGE_SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: MERGE_SCHEMA } },
      messages: [{ role: 'user', content: `${noteXml('nota_a', a)}\n\n${noteXml('nota_b', b)}` }],
    },
  };
}

// The model's answer as a draft holding the upsert to confirm; null when they are not the same fact.
export function mergeDraftFrom(reply, pair) {
  if (!reply?.same_fact) return null;
  const keep = reply.keep === 'b' ? pair.b : pair.a;
  const drop = keep === pair.a ? pair.b : pair.a;
  const id = `MERGE-${keep}`.slice(0, 120);
  const summary = scrub(reply.summary).replace(/\s+/g, ' ').trim();
  const row = {
    id: keep, module: pair.module || 'general', feature: pair.feature || 'general', type: reply.type, phase: reply.phase,
    summary: summary.length > 250 ? `${summary.slice(0, 249)}…` : summary,
    keywords: scrub(reply.keywords),
    ...(reply.details ? { details: scrub(reply.details) } : {}),
    supersedes: [drop, `${pair.project}/${id}`].join(','),
  };
  return {
    id, module: 'drafts', feature: 'merge-duplicates', knowledge_type: 'current_behavior', phase: 'queued',
    summary: `Rascunho (Haiku): fundir ${pair.a} e ${pair.b} (similaridade ${pair.similarity})`.slice(0, 250),
    keywords: row.keywords || null,
    no_similar: true,
    details: `${scrub(reply.reason)}\n\nNota fundida (confira e grave com upsert; o supersedes já inclui a outra nota e este rascunho):\n--project ${pair.project} ${JSON.stringify(row)}`,
  };
}

// Pairs not proposed before, from the live notes (drafts and retired notes left out).
export function newPairs(rows, state) {
  const live = rows.filter((k) => k.module !== 'drafts' && k.phase !== 'deprioritized');
  const byKey = new Map(live.map((k) => [`${k.project_id}|${k.id}`, k]));
  const busy = new Set((state.batches || []).flatMap((b) => b.pairs.map(pairKey)));
  return duplicates(live)
    .filter((p) => !state.proposed?.[pairKey(p)] && !busy.has(pairKey(p)))
    .slice(0, MAX_PAIRS)
    .map((p) => ({ ...p, notes: [byKey.get(`${p.project}|${p.a}`), byKey.get(`${p.project}|${p.b}`)] }))
    .filter((p) => p.notes[0] && p.notes[1]);
}

export async function collect(key, state, root) {
  for (const batch of [...(state.batches || [])]) {
    const info = await (await anthropic(key, 'GET', `/v1/messages/batches/${batch.id}`)).json();
    if (info.processing_status !== 'ended') continue;
    const body = info.results_url ? await (await anthropic(key, 'GET', new URL(info.results_url).pathname)).text() : '';
    const results = new Map(body.split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.custom_id, r.result]; }));
    for (const pair of batch.pairs) {
      const r = results.get(pair.customId);
      const msg = r?.type === 'succeeded' ? r.message : null;
      if (msg) fs.appendFileSync(ledgerFile(), `${JSON.stringify({ at: new Date().toISOString(), batch: batch.id, window: pair.customId, usage: msg.usage, cost: costOf(msg.usage) })}\n`);
      let reply = null;
      if (msg && msg.stop_reason === 'end_turn') {
        try { reply = JSON.parse(msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('')); } catch {}
      }
      // No answer: the pair stays unproposed and goes again on a later run.
      if (!reply) { log(`par ${pair.customId}: ${r?.type || 'sem resultado'}`); continue; }
      state.proposed = { ...(state.proposed || {}), [pairKey(pair)]: new Date().toISOString() };
      const draft = mergeDraftFrom(reply, pair);
      if (draft) state.unsaved = [...(state.unsaved || []), { project: pair.project, draft }];
    }
    state.batches = state.batches.filter((b) => b.id !== batch.id);
  }
  let saved = 0;
  const left = [];
  for (const item of state.unsaved || []) {
    const r = await apiRequest(root, 'POST', `upsert?project=${encodeURIComponent(item.project)}`, item.draft, { timeoutMs: 10_000 });
    if (r.ok) saved++;
    else { left.push(item); log(`rascunho ${item.draft.id}: ${r.error}`); }
  }
  state.unsaved = left;
  return saved;
}

export async function submit(key, state, pairs) {
  if (!pairs.length) return null;
  const requests = pairs.map((p, i) => {
    p.customId = `m${i}-${p.a}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    return buildMergeRequest(p.customId, p.notes[0], p.notes[1]);
  });
  const batch = await (await anthropic(key, 'POST', '/v1/messages/batches', { requests })).json();
  state.batches = [...(state.batches || []), {
    id: batch.id, at: new Date().toISOString(),
    pairs: pairs.map(({ notes, ...p }) => ({ ...p, module: notes[0].module, feature: notes[0].feature })),
  }];
  return batch.id;
}

async function main() {
  if (process.env.CONTEXT_CONSOLIDATE === '0') return;
  const key = apiKey();
  if (!key) return log('Fusão desligada: configure CONTEXT_CONSOLIDATE_KEY_FILE ou CONTEXT_CONSOLIDATE_API_KEY.');
  const root = workspaceRoot();
  const state = loadJson(stateFile(), { batches: [], proposed: {}, unsaved: [] });
  try {
    const saved = await collect(key, state, root);
    if (saved) log(`${saved} rascunho(s) de fusão gravado(s)`);
    const exp = await apiRequest(root, 'GET', 'export', undefined, { timeoutMs: 30_000 });
    if (!exp.ok) return log(`export: ${exp.error}`);
    const known = new Set(PROJECTS.split(/,\s*/));
    const rows = (exp.data?.system_knowledge || []).filter((k) => known.has(k.project_id));
    const pairs = newPairs(rows, state);
    const id = await submit(key, state, pairs);
    if (id) log(`lote ${id}: ${pairs.length} par(es)`);
  } finally {
    saveJson(stateFile(), state);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { if (!quiet) console.error(err.message); process.exit(1); });
}
