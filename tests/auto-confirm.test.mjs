import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CONTEXT_CONSOLIDATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-confirm-'));
const { vetNote, applyDraft, plan, recentApplied, auditFile } = await import('../scripts/auto-confirm.mjs');

const row = (extra = {}) => ({
  id: '<ID>', module: 'auth', feature: 'login', type: 'current_behavior', phase: 'implemented',
  summary: 'Login uses OIDC through qlave-auth with PKCE and a refresh token kept in an httpOnly cookie', keywords: 'login, oidc', ...extra,
});
const draftOf = (id, rows, project = 'louza') => ({
  id, module: 'drafts', feature: 'consolidate', knowledge_type: 'current_behavior', phase: 'queued', summary: 'Rascunho (Haiku): x',
  details: `Handoff\n\n${rows.map((r) => `--project ${project} ${JSON.stringify(r)}`).join('\n')}`,
});

// A fake API: GET knowledge/<id> finds the ids in `taken`; every POST is recorded.
function fakeApi(taken = []) {
  const calls = [];
  const request = async (root, method, endpoint, body) => {
    calls.push({ method, endpoint, body });
    if (method === 'GET') {
      const id = decodeURIComponent(endpoint.split('/')[1].split('?')[0]);
      return taken.includes(id) ? { ok: true, data: { id } } : { ok: false, error: 'API error (404): not found' };
    }
    return { ok: true, data: {} };
  };
  return { request, calls, posts: () => calls.filter((c) => c.method === 'POST') };
}

test('vetNote passes a clean English note and names what blocks the others', () => {
  assert.equal(vetNote({ project: 'louza', row: row() }), null);
  assert.match(vetNote({ project: 'nope', row: row() }), /projeto desconhecido/);
  assert.match(vetNote({ project: 'louza', row: row({ type: 'opinion' }) }), /type/);
  assert.match(vetNote({ project: 'louza', row: row({ phase: 'done' }) }), /phase/);
  assert.match(vetNote({ project: 'louza', row: row({ summary: 'x'.repeat(251) }) }), /251/);
  assert.match(vetNote({ project: 'louza', row: row({ summary: 'O login não usa senha para quem está na escola, que tem SSO' }) }), /inglês/);
  assert.match(vetNote({ project: 'louza', row: row({ details: 'contact maria@example.com for access' }) }), /sensível em details/);
  assert.match(vetNote({ project: 'louza', row: row({ module: 'drafts' }) }), /drafts/);
});

test('applyDraft saves each passing note with a fresh id and supersedes naming the draft', async () => {
  const api = fakeApi();
  const draft = draftOf('DRAFT-H-ABC', [row(), row({ supersedes: 'louza/DRAFT-H-ABC' })]);
  const out = await applyDraft('/root', 'louza', draft, { request: api.request, today: new Date('2026-10-28T12:00:00Z') });
  assert.equal(out.applied.length, 2);
  assert.equal(out.discarded, false);
  const [a, b] = api.posts();
  assert.equal(a.body.id, 'AUTH-LOGIN-2610281');
  assert.equal(a.body.knowledge_type, 'current_behavior');
  assert.equal(a.body.supersedes, 'louza/DRAFT-H-ABC');
  assert.equal(b.body.supersedes, 'louza/DRAFT-H-ABC', 'the draft is not named twice');
  assert.ok(recentApplied().some((e) => e.id === 'AUTH-LOGIN-2610281'));
});

test('applyDraft steps past an id already taken', async () => {
  const api = fakeApi(['AUTH-LOGIN-2610281', 'AUTH-LOGIN-2610281-2']);
  await applyDraft('/root', 'louza', draftOf('DRAFT-H-T', [row()]), { request: api.request, today: new Date('2026-10-28T12:00:00Z') });
  assert.equal(api.posts()[0].body.id, 'AUTH-LOGIN-2610281-3');
});

test('a merge keeps the existing note id on purpose', async () => {
  const api = fakeApi(['AUTH-1']);
  const draft = draftOf('MERGE-AUTH-1', [row({ id: 'AUTH-1', supersedes: 'AUTH-2,louza/MERGE-AUTH-1' })]);
  const out = await applyDraft('/root', 'louza', draft, { request: api.request });
  assert.deepEqual(out.applied, [{ project: 'louza', id: 'AUTH-1' }]);
  assert.equal(api.calls.filter((c) => c.method === 'GET').length, 0);
  assert.equal(api.posts()[0].body.supersedes, 'AUTH-2,louza/MERGE-AUTH-1');
});

test('a draft where nothing passes is retired, the rejected row kept in the audit', async () => {
  const api = fakeApi();
  const out = await applyDraft('/root', 'louza', draftOf('DRAFT-H-BAD', [row({ summary: 'O login não usa senha para quem está na escola' })]), { request: api.request });
  assert.equal(out.applied.length, 0);
  assert.equal(out.discarded, true);
  const [retire] = api.posts();
  assert.equal(retire.body.id, 'DRAFT-H-BAD');
  assert.equal(retire.body.phase, 'deprioritized');
  assert.equal(retire.body.module, 'drafts');
  const audit = fs.readFileSync(auditFile(), 'utf8');
  assert.match(audit, /"action":"rejected"/);
  assert.match(audit, /"action":"discarded"/);
});

test('a handoff with no proposals is left alone', async () => {
  const api = fakeApi();
  const out = await applyDraft('/root', 'louza', { ...draftOf('DRAFT-H-HO', []), details: 'Pendente:\n- terminar o deploy' }, { request: api.request });
  assert.equal(out.discarded, false);
  assert.equal(api.calls.length, 0);
});

test('plan applies drafts with proposals, retires old thin Stop drafts, leaves the rest', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const at = (days) => new Date(now - days * 86_400_000).toISOString();
  const rows = [
    { ...draftOf('DRAFT-H-1', [row()]), project_id: 'louza', updated_at: at(0) },
    { id: 'DRAFT-MVR1', module: 'drafts', phase: 'queued', details: 'Pedido: x', project_id: 'projetos', updated_at: at(4) },
    { id: 'DRAFT-MVR2', module: 'drafts', phase: 'queued', details: 'Pedido: y', project_id: 'projetos', updated_at: at(1) },
    { id: 'DRAFT-H-2', module: 'drafts', phase: 'queued', details: 'Pendente:\n- z', project_id: 'projetos', updated_at: at(10) },
    { id: 'PLAYBOOK-X', module: 'drafts', phase: 'queued', details: 'DRAFT for André', project_id: 'projetos', updated_at: at(10) },
    { id: 'DRAFT-OLD', module: 'drafts', phase: 'deprioritized', details: '', project_id: 'projetos', updated_at: at(30) },
    { id: 'AUTH-1', module: 'auth', phase: 'implemented', project_id: 'louza', updated_at: at(30) },
  ];
  assert.deepEqual(plan(rows, now).map((p) => `${p.row.id}:${p.action}`),
    ['DRAFT-H-1:apply', 'DRAFT-MVR1:retire', 'DRAFT-MVR2:wait', 'DRAFT-H-2:wait', 'PLAYBOOK-X:wait']);
});
