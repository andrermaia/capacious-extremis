import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyse, notEnglish, duplicates, memoryFacts, render, summaryLine, total } from '../scripts/hygiene.mjs';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const ago = (days) => new Date(NOW - days * 86400000).toISOString();

test('Portuguese prose is flagged; English with Portuguese names, quotes and domains is not', () => {
  assert.equal(notEnglish('MEDIDO: um fluxo SSE aberto NAO cai quando o token expira e nao revalida para nada'), true);
  assert.equal(notEnglish("andremaia.com.br = Swarm stack on takius; 'Você não tem acesso' shown for Pia-Máter staff"), false);
  assert.equal(notEnglish('Rematricula 2027 renewal is live for the Escola de Teste'), false);
});

test('near-duplicate summaries pair up inside a project only', () => {
  const s = 'Closed in portal facial slice six vigia branch pending merge deploy';
  const pairs = duplicates([
    { id: 'A', project_id: 'louza', summary: s },
    { id: 'B', project_id: 'louza', summary: s },
    { id: 'C', project_id: 'qoinpass', summary: s },
    { id: 'D', project_id: 'louza', summary: 'Totally different words about payments webhooks retries' },
    { id: 'MOD-1', project_id: 'louza', summary: 'Discovered module "a" at "a". Key files: build-manifest.json, BUILD_ID, .rscinfo, .previewinfo, .tsbuildinfo.' },
    { id: 'MOD-2', project_id: 'louza', summary: 'Discovered module "b" at "b". Key files: build-manifest.json, BUILD_ID, .rscinfo, .previewinfo, .tsbuildinfo.' },
  ]);
  assert.deepEqual(pairs.map((p) => [p.a, p.b, p.similarity]), [['A', 'B', 1]]);
});

test('stale in_progress knowledge and week-old open tasks are reported', () => {
  const f = analyse({
    now: NOW,
    knowledge: [
      { id: 'K1', project_id: 'louza', phase: 'in_progress', updated_at: ago(31), summary: 'Old work in progress', keywords: 'antigo' },
      { id: 'K2', project_id: 'louza', phase: 'in_progress', updated_at: ago(3), summary: 'Fresh work in progress' },
    ],
    tasks: [
      { id: 'T1', project_id: 'louza', status: 'IN_PROGRESS', updated_at: ago(8), task_description: 'forgotten' },
      { id: 'T2', project_id: 'louza', status: 'IN_PROGRESS', updated_at: ago(1), task_description: 'live' },
      { id: 'T3', project_id: 'louza', status: 'DONE', updated_at: ago(40), task_description: 'done' },
    ],
  });
  assert.deepEqual(f.staleKnowledge.map((k) => k.id), ['K1']);
  assert.deepEqual(f.missingKeywords.map((k) => k.id), ['K2']);
  assert.deepEqual(f.staleTasks.map((t) => t.id), ['T1']);
  assert.equal(total(f), 3);
  assert.match(render(f, { fixed: 1, date: new Date(NOW) }), /Tarefas abertas sem movimento há 7\+ dias \(1 fechadas como BLOCKED\) \(1\)\n- louza\/T1 · 8 d · forgotten/);
  assert.match(summaryLine(f, { fixed: 1, date: new Date(NOW) }), /^Hygiene 15\/10\/2026: 1 stale in_progress, 1 stale tasks \(1 closed\)/);
  assert.ok(summaryLine(f).length <= 250);
});

test('project facts in a memory folder are found; references and the index are not', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hygiene-'));
  const mem = path.join(home, '.claude', 'projects', 'p1', 'memory');
  fs.mkdirSync(mem, { recursive: true });
  fs.writeFileSync(path.join(mem, 'MEMORY.md'), '# index');
  fs.writeFileSync(path.join(mem, 'reference_server.md'), '---\ntype: reference\n---\nhost');
  fs.writeFileSync(path.join(mem, 'gotcha_x.md'), '---\ntype: feedback\n---\nx');
  fs.writeFileSync(path.join(mem, 'notes.md'), '---\nmetadata:\n  type: project\n---\ny');
  assert.deepEqual(memoryFacts(home).map((f) => path.basename(f)).sort(), ['gotcha_x.md', 'notes.md']);
  fs.rmSync(home, { recursive: true, force: true });
});

test('drafts are listed to confirm and never checked as rows (language, duplicates, keywords)', async () => {
  const { analyse, render } = await import('../scripts/hygiene.mjs');
  const knowledge = [
    { id: 'DRAFT-1', project_id: 'louza', module: 'drafts', phase: 'queued', summary: 'Rascunho: não foi feito para a parcela que está pendente', updated_at: '2026-10-10T00:00:00Z' },
    { id: 'DRAFT-2', project_id: 'louza', module: 'drafts', phase: 'deprioritized', summary: 'Rascunho: já confirmado', updated_at: '2026-10-10T00:00:00Z' },
  ];
  const f = analyse({ knowledge, tasks: [], now: Date.parse('2026-10-16T00:00:00Z') });
  assert.deepEqual(f.drafts.map((d) => [d.id, d.days]), [['DRAFT-1', 6]]);
  assert.equal(f.notEnglish.length, 0);
  assert.equal(f.missingKeywords.length, 0);
  assert.match(render(f), /## Rascunhos a confirmar[^\n]*\(1\)\n- louza\/DRAFT-1 · 6 d · Rascunho:/);
});
