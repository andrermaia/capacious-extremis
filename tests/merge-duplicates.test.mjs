import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildMergeRequest, mergeDraftFrom, newPairs, pairKey, MERGE_SCHEMA } from '../scripts/merge-duplicates.mjs';
import { MODEL } from '../scripts/consolidate.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'merge-duplicates.mjs');

const note = (id, summary, extra = {}) => ({
  project_id: 'louza', id, module: 'auth', feature: 'login', knowledge_type: 'current_behavior', phase: 'implemented',
  summary, keywords: 'login, oidc', details: '', updated_at: '2026-10-20T10:00:00Z', ...extra,
});
const twins = () => [
  note('AUTH-1', 'Login uses OIDC through qlave-auth with PKCE and a refresh token kept in an httpOnly cookie'),
  note('AUTH-2', 'Login uses OIDC through qlave-auth with PKCE; the refresh token is kept in an httpOnly cookie', { updated_at: '2026-10-25T10:00:00Z' }),
  note('PAY-1', 'Pix charges go through QoinPay v2 with a webhook confirming each payment to the school'),
];

test('the request carries both notes, the schema and the small model at low effort', () => {
  const [a, b] = twins();
  const req = buildMergeRequest('m0-AUTH-1', a, { ...b, details: 'senha: hunter2secret' });
  assert.equal(req.custom_id, 'm0-AUTH-1');
  assert.equal(req.params.model, MODEL);
  assert.equal(req.params.output_config.effort, 'low');
  assert.deepEqual(req.params.output_config.format.schema, MERGE_SCHEMA);
  const content = req.params.messages[0].content;
  assert.match(content, /<nota_a id="AUTH-1"/);
  assert.match(content, /<nota_b id="AUTH-2"/);
  assert.doesNotMatch(content, /hunter2secret/);
});

test('same fact becomes a draft with the upsert that keeps one ID and supersedes the other', () => {
  const pair = { project: 'louza', a: 'AUTH-1', b: 'AUTH-2', similarity: 0.82, module: 'auth', feature: 'login' };
  const reply = { same_fact: true, keep: 'b', summary: 'Login uses OIDC (qlave-auth, PKCE), refresh token in httpOnly cookie', keywords: 'login, oidc, pkce', details: '', type: 'current_behavior', phase: 'implemented', reason: 'Mesma regra de login.' };
  const draft = mergeDraftFrom(reply, pair);
  assert.equal(draft.id, 'MERGE-AUTH-2');
  assert.equal(draft.module, 'drafts');
  assert.equal(draft.no_similar, true);
  assert.match(draft.summary, /fundir AUTH-1 e AUTH-2/);
  const row = JSON.parse(draft.details.slice(draft.details.indexOf('{')));
  assert.equal(row.id, 'AUTH-2');
  assert.equal(row.module, 'auth');
  assert.equal(row.supersedes, 'AUTH-1,louza/MERGE-AUTH-2');
  assert.equal(mergeDraftFrom({ ...reply, same_fact: false }, pair), null);
});

test('pairs leave out drafts, retired notes, other projects and pairs already proposed', () => {
  const rows = [...twins(), note('AUTH-3', twins()[0].summary, { module: 'drafts' }), note('AUTH-4', twins()[0].summary, { phase: 'deprioritized' })];
  const pairs = newPairs(rows, { batches: [], proposed: {} });
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].a, pairs[0].b].sort(), ['AUTH-1', 'AUTH-2']);
  assert.equal(pairs[0].notes.length, 2);
  assert.equal(newPairs(rows, { batches: [], proposed: { [pairKey(pairs[0])]: 'x' } }).length, 0);
  assert.equal(newPairs(rows, { batches: [{ pairs: [{ project: 'louza', a: 'AUTH-2', b: 'AUTH-1' }] }], proposed: {} }).length, 0);
});

test('submit then collect, against fake Anthropic and context APIs', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const sent = [];
  const upserts = [];
  let ended = false;
  const anthropic = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      assert.equal(req.headers['x-api-key'], 'test-key');
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/v1/messages/batches') {
        sent.push(JSON.parse(body));
        return res.end(JSON.stringify({ id: 'msgbatch_m', processing_status: 'in_progress' }));
      }
      if (req.url === '/v1/messages/batches/msgbatch_m') {
        return res.end(JSON.stringify({ id: 'msgbatch_m', processing_status: ended ? 'ended' : 'in_progress', results_url: `http://127.0.0.1:${anthropic.address().port}/v1/messages/batches/msgbatch_m/results` }));
      }
      if (req.url.endsWith('/results')) {
        const customId = sent[0].requests[0].custom_id;
        const reply = { same_fact: true, keep: 'b', summary: 'Login uses OIDC (qlave-auth, PKCE)', keywords: 'login, oidc', details: '', type: 'current_behavior', phase: 'implemented', reason: 'Mesmo fato.' };
        return res.end(`${JSON.stringify({ custom_id: customId, result: { type: 'succeeded', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 900, output_tokens: 120 } } } })}\n`);
      }
      res.writeHead(404); res.end('{}');
    });
  });
  const context = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/v1/context/export')) return res.end(JSON.stringify({ system_knowledge: twins(), agent_tasks: [] }));
      if (req.url.startsWith('/v1/context/upsert')) { upserts.push({ url: req.url, body: JSON.parse(body) }); return res.end('{"status":"ok"}'); }
      res.writeHead(404); res.end('{}');
    });
  });
  await Promise.all([new Promise((r) => anthropic.listen(0, '127.0.0.1', r)), new Promise((r) => context.listen(0, '127.0.0.1', r))]);
  t.after(() => { anthropic.close(); context.close(); });

  const env = {
    ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp,
    CONTEXT_CONSOLIDATE_DIR: path.join(tmp, 'state'), CONTEXT_CONSOLIDATE_API_KEY: 'test-key',
    CONTEXT_CONSOLIDATE_API_BASE: `http://127.0.0.1:${anthropic.address().port}`,
    CONTEXT_API_URL: `http://127.0.0.1:${context.address().port}/v1/context`, CONTEXT_API_TOKEN: 'x',
  };
  delete env.CONTEXT_CONSOLIDATE;
  const run = () => new Promise((resolve) => {
    const p = spawn(process.execPath, [script], { env, cwd: tmp });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });

  const first = await run();
  assert.equal(first.code, 0, first.out);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].requests.length, 1, 'only the twin pair goes');

  const second = await run();
  assert.equal(second.code, 0, second.out);
  assert.equal(sent.length, 1, 'a pair in a running batch is not sent again');
  assert.equal(upserts.length, 0);

  ended = true;
  const third = await run();
  assert.equal(third.code, 0, third.out);
  assert.equal(upserts.length, 1);
  assert.match(upserts[0].url, /project=louza/);
  assert.equal(upserts[0].body.id, 'MERGE-AUTH-2');
  assert.equal(upserts[0].body.module, 'drafts');
  assert.equal(sent.length, 1, 'a proposed pair is not sent (nor paid) again');
  const ledger = fs.readFileSync(path.join(tmp, 'state', 'usage.jsonl'), 'utf8').trim().split('\n');
  assert.equal(ledger.length, 1);
});
