import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseLog } from '../scripts/ingest-commits.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(__dirname, '..');
const cliPath = path.join(skillDir, 'scripts', 'context-cli.mjs');

// A fake API that records every request and answers the routes these features use.
function fakeApi(answers = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const route = url.pathname.replace(/^\/v1\/context\//, '');
      const json = body ? JSON.parse(body) : {};
      calls.push({ route, method: req.method, query: Object.fromEntries(url.searchParams), body: json });
      const reply = answers[route] ? answers[route](json, url) : { status: 'ok' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}/v1/context`, calls, close: () => server.close(),
  })));
}

function run(cmd, args, { input, env = {}, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cmd, ...args], { cwd, env: { ...process.env, CONTEXT_API_TOKEN: 'test', NODE_NO_WARNINGS: '1', ...env } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, out, err }));
    child.stdin.end(input || '');
  });
}

test('upsert passes supersedes through and relays retired rows and look-alikes', async () => {
  const api = await fakeApi({
    upsert: (b) => (b.id === 'NEW-1'
      ? { status: 'ok', id: 'NEW-1', action: 'inserted', superseded: ['louza/OLD-1'], similar: [{ id: 'LOUZA-X', summary: 'same topic', score: 0.31 }] }
      : { status: 'ok', id: b.id, action: 'inserted' }),
  });
  try {
    const items = [
      { id: 'NEW-1', module: 'louza', feature: 'f', type: 'current_behavior', phase: 'implemented', summary: 's', keywords: 'a, b', supersedes: 'OLD-1' },
      { id: 'NEW-2', module: 'louza', feature: 'f', type: 'current_behavior', phase: 'implemented', summary: 's', keywords: 'a, b' },
    ];
    const r = await run(cliPath, ['--api-url', api.url, '--project', 'louza', 'upsert', '--file', '-'], { input: JSON.stringify(items) });
    assert.equal(r.status, 0, r.err);
    const sent = api.calls.filter((c) => c.route === 'upsert');
    assert.equal(sent[0].body.supersedes, 'OLD-1');
    assert.equal(sent[1].body.supersedes, null);
    const out = JSON.parse(r.out);
    assert.deepEqual(out.results[0].superseded, ['louza/OLD-1']);
    assert.equal(out.results[0].similar[0].id, 'LOUZA-X');
    assert.equal(out.results[1].similar, undefined);
    assert.match(out.aviso_parecidos, /supersedes/);
    assert.match(r.err, /NEW-1 ~ LOUZA-X/);
  } finally {
    api.close();
  }
});

test('search asks the API for commits too', async () => {
  const api = await fakeApi({ search: () => ({ knowledge: [], tasks: [], semantic: [], commits: [{ repo: 'louza', sha: 'abc123456', subject: 'fix(boletim): media' }] }) });
  try {
    const r = await run(cliPath, ['--api-url', api.url, '--project', 'louza', 'search', 'boletim', 'media']);
    assert.equal(r.status, 0, r.err);
    assert.equal(api.calls[0].query.commits, '5');
    assert.equal(JSON.parse(r.out).commits[0].repo, 'louza');
  } finally {
    api.close();
  }
});

test('parseLog reads subject, body without trailers, and the file list', () => {
  const text = '\x1eaaa111\x1f2026-10-01T10:00:00-03:00\x1fAndre\x1ffix(boletim): media ponderada\x1fCorpo da mensagem.\n\nCo-Authored-By: Claude <x@y>\n\x1f\nsrc/boletim.ts\nsrc/media.ts\n'
    + '\x1ebbb222\x1f2026-10-02T10:00:00-03:00\x1fAndre\x1ffeat: outra\x1f\x1f\nREADME.md\n';
  const [a, b] = parseLog(text);
  assert.equal(a.sha, 'aaa111');
  assert.equal(a.subject, 'fix(boletim): media ponderada');
  assert.equal(a.body, 'Corpo da mensagem.');
  assert.deepEqual(a.files, ['src/boletim.ts', 'src/media.ts']);
  assert.deepEqual(b.files, ['README.md']);
});

test('ingest-commits sends each clone\'s new commits, oldest first, to its product', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-ingest-'));
  const repo = path.join(base, 'louza-fe');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 'Teste');
  fs.writeFileSync(path.join(repo, 'a.ts'), '1');
  g('add', '.');
  g('commit', '-q', '-m', 'feat: primeiro');
  fs.writeFileSync(path.join(repo, 'b.ts'), '2');
  g('add', '.');
  g('commit', '-q', '-m', 'fix(boletim): segundo', '-m', 'Co-Authored-By: X <x@y>');
  // A worktree (a .git file, not a directory) is not a clone of its own.
  fs.mkdirSync(path.join(base, 'wt-copy'));
  fs.writeFileSync(path.join(base, 'wt-copy', '.git'), 'gitdir: elsewhere');
  const api = await fakeApi({ 'commits/last': () => ({ sha: null }), commits: (b) => ({ status: 'ok', inserted: b.items.length }) });
  try {
    const r = await run(path.join(skillDir, 'scripts', 'ingest-commits.mjs'), ['--root', base], { env: { CONTEXT_API_URL: api.url } });
    assert.equal(r.status, 0, r.err);
    const posts = api.calls.filter((c) => c.route === 'commits' && c.method === 'POST');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].query.project, 'louza');
    assert.equal(posts[0].body.repo, 'louza-fe');
    assert.deepEqual(posts[0].body.items.map((c) => c.subject), ['feat: primeiro', 'fix(boletim): segundo']);
    assert.deepEqual(posts[0].body.items[1].files, ['b.ts']);
    assert.equal(posts[0].body.items[1].body, '');
    assert.match(r.out, /"inserted":2/);
  } finally {
    api.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
