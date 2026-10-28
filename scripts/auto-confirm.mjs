#!/usr/bin/env node
// Drafts confirmed without a person. A draft holding proposals (the Haiku consolidation's
// DRAFT-H-*, merge-duplicates' MERGE-*) has each proposed note vetted by fixed rules and saved
// with "supersedes" naming the draft, which retires it; a draft where nothing passes is retired
// (deprioritized, row kept). A thin draft the Stop hook left (no proposals) retires after
// THIN_DRAFT_DAYS: by then the consolidation has turned its session into a DRAFT-H, or never will.
// Every note applied or rejected goes to <consolidateDir>/auto-applied.jsonl, which the session
// start shows for a day. CONTEXT_AUTO_CONFIRM=0 turns it off (drafts then wait for confirm-draft).
//
//   node auto-confirm.mjs [--quiet] [--dry-run]   sweep the open drafts of every project
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrub, consolidateDir } from './consolidate.mjs';
import { notEnglish } from './hygiene.mjs';
import { draftProposals } from './cli-format.mjs';
import { apiRequest, PROJECTS } from './hooks/hook-lib.mjs';

export const AUTO = process.env.CONTEXT_AUTO_CONFIRM !== '0';
export const THIN_DRAFT_DAYS = 3;
const TYPES = ['architecture_decision', 'system_model', 'current_behavior', 'future_revision', 'technical_debt'];
const PHASES = ['implemented', 'in_progress', 'queued', 'deprioritized'];
const DAY_MS = 24 * 60 * 60 * 1000;

export const auditFile = () => path.join(consolidateDir(), 'auto-applied.jsonl');
const known = () => new Set(String(PROJECTS).split(/,\s*/).filter(Boolean));

// Why a proposed note may not be saved unseen; null when it may.
export function vetNote({ project, row }) {
  if (!known().has(project)) return `projeto desconhecido: ${project}`;
  if (!row || typeof row !== 'object') return 'linha inválida';
  if (!row.module || !row.feature) return 'sem module ou feature';
  if (row.module === 'drafts') return 'módulo drafts';
  if (!TYPES.includes(row.type)) return `type inválido: ${row.type}`;
  if (!PHASES.includes(row.phase)) return `phase inválida: ${row.phase}`;
  const summary = String(row.summary || '').trim();
  if (!summary) return 'resumo vazio';
  if (summary.length > 250) return `resumo com ${summary.length} caracteres`;
  if (notEnglish(summary)) return 'resumo fora do inglês';
  for (const field of ['summary', 'details', 'keywords']) {
    const v = String(row[field] || '');
    if (v && scrub(v) !== v) return `dado sensível em ${field}`;
  }
  return null;
}

// A free id for a note the model left unnamed: the generated one, else -2, -3...
async function freeId(request, root, project, id) {
  for (let i = 1; i <= 9; i++) {
    const candidate = i === 1 ? id : `${id}-${i}`;
    const r = await request(root, 'GET', `knowledge/${encodeURIComponent(candidate)}?project=${encodeURIComponent(project)}`, undefined, { timeoutMs: 8000 });
    if (!r.ok && /404|not found/i.test(String(r.error || r.status || ''))) return candidate;
    if (!r.ok) throw new Error(`knowledge ${candidate}: ${r.error}`);
  }
  return null;
}

function audit(entry) {
  try { fs.appendFileSync(auditFile(), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`); } catch {}
}

async function retire(request, root, project, draft, reason) {
  const { id, feature, knowledge_type, summary, details, keywords } = draft;
  const r = await request(root, 'POST', `upsert?project=${encodeURIComponent(project)}`,
    { id, module: 'drafts', feature, knowledge_type: knowledge_type || 'current_behavior', summary, details, keywords, phase: 'deprioritized', no_similar: true }, { timeoutMs: 10_000 });
  if (r.ok) audit({ project, draft: id, action: 'discarded', reason });
  return r.ok;
}

// Saves what a draft (already in the base: "supersedes" needs it there) proposes. A merge keeps
// the existing note's id on purpose; any other draft's note gets an id nobody holds.
export async function applyDraft(root, project, draft, { request = apiRequest, today = new Date(), dryRun = false } = {}) {
  const out = { applied: [], rejected: [], discarded: false };
  const merge = /^MERGE-/.test(draft.id);
  const self = `${project}/${draft.id}`;
  const proposals = draftProposals(draft.details, { today });
  // A handoff with nothing to save (pending work only) waits for whoever resumes it.
  if (!proposals.length) return out;
  for (const p of proposals) {
    const reason = vetNote(p);
    if (reason) { out.rejected.push({ project: p.project, id: p.row.id, reason }); audit({ project: p.project, draft: self, action: 'rejected', reason, row: p.row }); continue; }
    const row = { ...p.row };
    if (!merge) {
      const id = await freeId(request, root, p.project, row.id);
      if (!id) { out.rejected.push({ project: p.project, id: row.id, reason: 'sem id livre' }); continue; }
      row.id = id;
    }
    const supersedes = String(row.supersedes || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!supersedes.includes(self) && !supersedes.includes(draft.id)) supersedes.push(self);
    if (dryRun) { out.applied.push({ project: p.project, id: row.id }); continue; }
    const r = await request(root, 'POST', `upsert?project=${encodeURIComponent(p.project)}`, {
      id: row.id, project_id: p.project, module: row.module, feature: row.feature, knowledge_type: row.type, phase: row.phase,
      summary: row.summary.trim(), details: row.details || null, keywords: row.keywords || null, supersedes: supersedes.join(','),
    }, { timeoutMs: 10_000 });
    if (r.ok) {
      out.applied.push({ project: p.project, id: row.id });
      audit({ project: p.project, id: row.id, draft: self, action: 'applied', summary: row.summary.trim() });
    } else {
      out.rejected.push({ project: p.project, id: row.id, reason: `upsert: ${r.error}` });
    }
  }
  if (!out.applied.length && !dryRun) {
    out.discarded = await retire(request, root, project, draft, `nenhuma proposta passou (${out.rejected.map((x) => x.reason).join('; ')})`);
  }
  return out;
}

// Open drafts and what to do with each: apply (has proposals), retire (the Stop hook's thin draft,
// old), wait (a handoff, a playbook: hygiene retires those after LIMITS.oldDraftDays).
export function plan(rows, now = Date.now()) {
  return rows
    .filter((k) => k.module === 'drafts' && k.phase !== 'deprioritized')
    .map((k) => {
      const days = (now - new Date(k.updated_at || k.created_at || now).getTime()) / DAY_MS;
      const proposes = /^--project [\w-]+ \{/m.test(String(k.details || ''));
      return { row: k, action: proposes ? 'apply' : days >= THIN_DRAFT_DAYS && /^DRAFT-(?!H-)/.test(k.id) ? 'retire' : 'wait' };
    });
}

// Applied notes of the last day, for the session start.
export function recentApplied(now = Date.now(), file = auditFile()) {
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { return []; }
  return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.action === 'applied' && now - new Date(e.at).getTime() < DAY_MS);
}

function workspaceRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const parts = path.resolve(here, '..').split(path.sep);
  return parts.slice(-3).join('/') === '.agents/skills/managing-system-context' ? parts.slice(0, -3).join(path.sep) : process.cwd();
}

async function main() {
  const quiet = process.argv.includes('--quiet');
  const dryRun = process.argv.includes('--dry-run');
  const log = (...a) => { if (!quiet) console.log(...a); };
  if (!AUTO) return log('Confirmação automática desligada (CONTEXT_AUTO_CONFIRM=0).');
  const root = workspaceRoot();
  const exp = await apiRequest(root, 'GET', 'export', undefined, { timeoutMs: 30_000 });
  if (!exp.ok) throw new Error(`export: ${exp.error}`);
  const rows = (exp.data?.system_knowledge || []).filter((k) => known().has(k.project_id));
  for (const { row, action } of plan(rows)) {
    if (action === 'wait') continue;
    if (action === 'retire') {
      const ok = dryRun || await retire(apiRequest, root, row.project_id, row, `rascunho sem propostas há ${THIN_DRAFT_DAYS}+ dias`);
      log(`${row.project_id}/${row.id}: ${ok ? 'aposentado' : 'falhou'}`);
      continue;
    }
    const r = await applyDraft(root, row.project_id, row, { dryRun });
    log(`${row.project_id}/${row.id}: ${r.applied.map((a) => a.id).join(', ') || '-'}${r.rejected.length ? ` · rejeitadas: ${r.rejected.map((x) => `${x.id} (${x.reason})`).join('; ')}` : ''}${r.discarded ? ' · descartado' : ''}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { if (!process.argv.includes('--quiet')) console.error(err.message); process.exit(1); });
}
