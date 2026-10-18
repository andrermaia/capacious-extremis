#!/usr/bin/env node
// Weekly hygiene of the shared knowledge base. Reports:
//   - knowledge still in_progress with no update for 30+ days
//   - tasks IN_PROGRESS with no update for 7+ days (--fix closes them as BLOCKED)
//   - summaries that are not in English
//   - near-duplicate summaries inside a project
//   - project facts written to a Claude Code memory folder (they belong in the base)
//   - rules files that differ from the base (hand-edited or stale; sync-rules fixes them)
//   - knowledge without Portuguese keywords (the prompt search finds it worse)
//   - drafts the Stop hook left (work that ended without an upsert) still to confirm
// --save stores the report in the base (project global, module hygiene, id HYGIENE-REPORT),
// which the session-start hook shows while it has findings.
// Usage: node hygiene.mjs [--fix] [--save] [--quiet]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configuredApiUrl, MISSING_API_URL } from './api-config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DAY = 24 * 60 * 60 * 1000;
export const LIMITS = { staleKnowledgeDays: 30, staleTaskDays: 7, duplicateJaccard: 0.6 };

const PT_WORDS = new Set(['não', 'nao', 'para', 'uma', 'aos', 'nas', 'nos', 'seu', 'sua', 'ser', 'faz', 'tudo', 'que', 'dos', 'das', 'está', 'são', 'pelo', 'pela', 'também', 'quando', 'sem', 'ainda', 'foi', 'ficou', 'tem', 'isso', 'mas', 'depois', 'antes', 'agora', 'como', 'porque', 'entre', 'onde']);
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'are', 'was', 'has', 'not', 'but', 'its', 'via', 'per', 'when', 'only', 'now', 'all', 'any', 'one', 'two', 'out']);
const words = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) || [];

// Portuguese prose, not Portuguese identifiers: quoted text, code-ish tokens and domains are
// ignored, and it takes 3+ common Portuguese words to flag a summary.
export function notEnglish(summary) {
  const prose = String(summary || '')
    .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ' ')
    .replace(/\S*[._/:=]\S*/g, ' ')
    .toLowerCase();
  const ws = prose.match(/[a-zà-ú]+/g) || [];
  return ws.filter((w) => PT_WORDS.has(w)).length >= 3;
}

// bootstrap-scan rows ("Discovered module X. Key files: ...") list build files: two Next apps
// look alike without being the same fact, so they never count as duplicates.
const SCANNER_ROW = /^Discovered module /;

export function duplicates(rows, threshold = LIMITS.duplicateJaccard) {
  const sets = rows.filter((r) => !SCANNER_ROW.test(r.summary || '')).map((r) => ({ r, s: new Set(words(r.summary).filter((w) => w.length >= 3 && !STOP.has(w))) })).filter((x) => x.s.size >= 5);
  const pairs = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i];
      const b = sets[j];
      if (a.r.project_id !== b.r.project_id) continue;
      let inter = 0;
      for (const w of a.s) if (b.s.has(w)) inter++;
      const jac = inter / (a.s.size + b.s.size - inter);
      if (jac >= threshold) pairs.push({ a: a.r.id, b: b.r.id, project: a.r.project_id, similarity: Math.round(jac * 100) / 100 });
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity);
}

// Memory notes that are project facts (frontmatter type project/feedback or a project_/gotcha_ file).
export function memoryFacts(home = os.homedir()) {
  const base = path.join(home, '.claude', 'projects');
  const found = [];
  let dirs = [];
  try { dirs = fs.readdirSync(base); } catch { return found; }
  for (const d of dirs) {
    const mem = path.join(base, d, 'memory');
    let files = [];
    try { files = fs.readdirSync(mem).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md'); } catch { continue; }
    for (const f of files) {
      let head = '';
      try { head = fs.readFileSync(path.join(mem, f), 'utf8').slice(0, 600); } catch {}
      const type = (head.match(/^\s*type:\s*(\w+)/m) || [])[1];
      if (/^(project|gotcha|feedback)_/.test(f) || ['project', 'feedback'].includes(type)) found.push(path.join(d, 'memory', f));
    }
  }
  return found;
}

export function analyse({ knowledge: all, tasks, now = Date.now(), memory = [], rulesDrift = [] }) {
  const age = (r) => (now - Date.parse(r.updated_at)) / DAY;
  // Drafts are raw notes in Portuguese waiting for an agent: listed apart, never checked as rows.
  const drafts = all.filter((k) => k.module === 'drafts' && k.phase !== 'deprioritized');
  const knowledge = all.filter((k) => k.module !== 'drafts');
  return {
    staleKnowledge: knowledge.filter((k) => k.phase === 'in_progress' && age(k) >= LIMITS.staleKnowledgeDays)
      .map((k) => ({ id: k.id, project: k.project_id, days: Math.floor(age(k)), summary: k.summary })),
    staleTasks: tasks.filter((t) => t.status === 'IN_PROGRESS' && age(t) >= LIMITS.staleTaskDays)
      .map((t) => ({ id: t.id, project: t.project_id, days: Math.floor(age(t)), desc: t.task_description })),
    notEnglish: knowledge.filter((k) => k.phase !== 'deprioritized' && notEnglish(k.summary)).map((k) => ({ id: k.id, project: k.project_id, summary: k.summary })),
    duplicates: duplicates(knowledge.filter((k) => k.phase !== 'deprioritized')),
    memoryFacts: memory,
    rulesDrift,
    missingKeywords: knowledge.filter((k) => k.phase !== 'deprioritized' && !k.keywords && !SCANNER_ROW.test(k.summary || ''))
      .map((k) => ({ id: k.id, project: k.project_id })),
    drafts: drafts.map((k) => ({ id: k.id, project: k.project_id, days: Math.floor(age(k)), summary: k.summary })),
  };
}

export function render(findings, { fixed = 0, date = new Date() } = {}) {
  const d = date.toISOString().slice(0, 10);
  const cut = (s, n = 140) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
  const sec = (title, list, line, max = 40) => (list.length
    ? [`## ${title} (${list.length})`, ...list.slice(0, max).map(line), ...(list.length > max ? [`- … e mais ${list.length - max}`] : []), '']
    : []);
  const lines = [
    `# Faxina da base · ${d}`, '',
    ...sec(`In progress sem atualização há ${LIMITS.staleKnowledgeDays}+ dias`, findings.staleKnowledge, (k) => `- ${k.project}/${k.id} · ${k.days} d · ${cut(k.summary)}`),
    ...sec(`Tarefas abertas sem movimento há ${LIMITS.staleTaskDays}+ dias${fixed ? ` (${fixed} fechadas como BLOCKED)` : ''}`, findings.staleTasks, (t) => `- ${t.project}/${t.id} · ${t.days} d · ${cut(t.desc, 100)}`),
    ...sec('Resumos fora do inglês', findings.notEnglish, (k) => `- ${k.project}/${k.id} · ${cut(k.summary)}`),
    ...sec('Possíveis duplicados (mesmo projeto)', findings.duplicates, (p) => `- ${p.project}: ${p.a} ≈ ${p.b} (${p.similarity})`),
    ...sec('Fatos de projeto na memória local (migrar com upsert e apagar)', findings.memoryFacts, (f) => `- ${f}`),
    ...sec('Arquivos de regras diferentes da base (rode sync-rules)', findings.rulesDrift, (f) => `- ${f}`),
    ...sec('Sem palavras-chave em português (context-cli keywords --file -)', findings.missingKeywords, (k) => `- ${k.project}/${k.id}`, 20),
    ...sec('Rascunhos a confirmar (grave a linha real com "supersedes":"<ID>" ou descarte com phase deprioritized)', findings.drafts || [], (k) => `- ${k.project}/${k.id} · ${k.days} d · ${cut(k.summary, 110)}`, 20),
  ];
  return lines.join('\n').trim();
}

export function summaryLine(findings, { fixed = 0, date = new Date() } = {}) {
  const d = date.toISOString().slice(0, 10).split('-').reverse().join('/');
  const n = (k) => findings[k].length;
  return `Hygiene ${d}: ${n('staleKnowledge')} stale in_progress, ${n('staleTasks')} stale tasks (${fixed} closed), ${n('duplicates')} duplicate pairs, ${n('notEnglish')} non-English, ${n('memoryFacts')} memory facts, ${n('rulesDrift')} rules drift, ${n('missingKeywords')} without keywords, ${(findings.drafts || []).length} drafts.`;
}

export const total = (f) => Object.values(f).reduce((a, l) => a + l.length, 0);

function token() {
  if (process.env.CONTEXT_API_TOKEN) return process.env.CONTEXT_API_TOKEN;
  const parts = path.resolve(here, '..').split(path.sep);
  if (parts.slice(-3).join('/') === '.agents/skills/managing-system-context') {
    const root = parts.slice(0, -3).join(path.sep);
    for (const n of ['settings.local.json', 'settings.json']) {
      try { const t = JSON.parse(fs.readFileSync(path.join(root, '.claude', n), 'utf8')).env?.CONTEXT_API_TOKEN; if (t) return t; } catch {}
    }
  }
  return '';
}

async function api(endpoint, init = {}) {
  const base = configuredApiUrl();
  if (!base) throw new Error(MISSING_API_URL);
  const res = await fetch(`${base.replace(/\/$/, '')}/${endpoint}`, {
    ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`API error (${res.status}): ${body.error || ''}`);
  return body;
}

async function main() {
  const argv = process.argv.slice(2);
  const fix = argv.includes('--fix');
  const data = await api('export');
  const drift = spawnSync(process.execPath, [path.join(here, 'sync-rules.mjs'), '--dry-run'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, CONTEXT_API_TOKEN: token() } });
  let rulesDrift = [];
  try { rulesDrift = JSON.parse(drift.stdout).written || []; } catch {}
  const findings = analyse({ knowledge: data.system_knowledge, tasks: data.agent_tasks, memory: memoryFacts(), rulesDrift });

  let fixed = 0;
  if (fix) {
    for (const t of findings.staleTasks) {
      const project = `project=${encodeURIComponent(t.project)}`;
      try {
        await api(`tasks/step?${project}`, { method: 'POST', body: JSON.stringify({ id: t.id, step: `faxina: aberta sem movimento havia ${t.days} dias` }) });
        await api(`tasks/finish?${project}`, { method: 'POST', body: JSON.stringify({ id: t.id, status: 'BLOCKED' }) });
        fixed++;
      } catch {}
    }
  }

  const report = render(findings, { fixed });
  const summary = summaryLine(findings, { fixed });
  if (argv.includes('--save')) {
    await api('upsert?project=global', {
      method: 'POST',
      body: JSON.stringify({ id: 'HYGIENE-REPORT', project_id: 'global', module: 'hygiene', feature: 'weekly-report',
        knowledge_type: total(findings) ? 'technical_debt' : 'current_behavior', phase: total(findings) ? 'queued' : 'implemented', summary, details: report }),
    });
  }
  if (!argv.includes('--quiet')) console.log(`${summary}\n\n${report}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(JSON.stringify({ status: 'error', error: err.message })); process.exitCode = 1; });
}
