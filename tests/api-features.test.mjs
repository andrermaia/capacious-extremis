import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseLog } from '../scripts/ingest-commits.mjs';
import { configuredApiUrl } from '../scripts/api-config.mjs';
import { hitsBlock } from '../scripts/hooks/hook-lib.mjs';

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
      { id: 'NEW-1', module: 'louza', feature: 'f', type: 'current_behavior', phase: 'implemented', summary: 's', keywords: 'a, b', supersedes: 'OLD-1', links: 'depends_on:LOUZA-X' },
      { id: 'NEW-2', module: 'louza', feature: 'f', type: 'current_behavior', phase: 'implemented', summary: 's', keywords: 'a, b' },
    ];
    const r = await run(cliPath, ['--api-url', api.url, '--project', 'louza', 'upsert', '--file', '-'], { input: JSON.stringify(items) });
    assert.equal(r.status, 0, r.err);
    const sent = api.calls.filter((c) => c.route === 'upsert');
    assert.equal(sent[0].body.supersedes, 'OLD-1');
    assert.equal(sent[0].body.links, 'depends_on:LOUZA-X');
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

test('a row of the entity map takes only a slot the notes left free', () => {
  const row = (id, module, rank) => ({ project_id: 'louza', id, module, summary: id, score: 9, strong: 2, similarity: 0.85, rank });
  const words = ['pagamentos', 'louza', 'sponte'];
  const full = hitsBlock({ knowledge: [row('ENT-EXT-SPONTE', 'mapa', 9), ...[1, 2, 3, 4, 5].map((n) => row(`NOTE-${n}`, 'louza', 9 - n))] }, words);
  assert.equal(full.filter((l) => /NOTE-/.test(l)).length, 5);
  assert.ok(!full.some((l) => /ENT-EXT-SPONTE/.test(l)));
  const roomy = hitsBlock({ knowledge: [row('ENT-EXT-SPONTE', 'mapa', 9), row('ENT-LOUZA-API', 'mapa', 8), row('NOTE-1', 'louza', 7)] }, words);
  assert.match(roomy[1], /NOTE-1/);
  assert.match(roomy[2], /ENT-EXT-SPONTE/);
  assert.ok(!roomy.some((l) => /ENT-LOUZA-API/.test(l)));
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

// A machine with no API address configured: an empty HOME and working folder, no CONTEXT_API_URL.
// Run from a clone installed under a projects root whose settings hold the address, the skill
// finds it there by design, so these tests can only run from a plain clone.
const installedRoot = path.basename(path.dirname(path.dirname(skillDir))) === '.agents' ? path.resolve(skillDir, '..', '..', '..') : null;
const NO_API_SKIP = installedRoot && ['settings.local.json', 'settings.json'].some((n) => {
  try { return Boolean(JSON.parse(fs.readFileSync(path.join(installedRoot, '.claude', n), 'utf8')).env?.CONTEXT_API_URL); } catch { return false; }
}) ? 'installed under a projects root that configures CONTEXT_API_URL' : false;

function bareMachine() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-noapi-'));
  const env = { CONTEXT_API_URL: '', CONTEXT_API_TOKEN: '', HOME: base, USERPROFILE: base };
  return { base, env };
}

test('the API address comes from the environment, else from the settings env of the folders above', { skip: NO_API_SKIP }, () => {
  const { base } = bareMachine();
  const saved = process.env.CONTEXT_API_URL;
  try {
    delete process.env.CONTEXT_API_URL;
    const work = path.join(base, 'projetos', 'louza');
    fs.mkdirSync(work, { recursive: true });
    assert.equal(configuredApiUrl({ cwd: work, home: base }), null);
    fs.mkdirSync(path.join(base, 'projetos', '.claude'));
    fs.writeFileSync(path.join(base, 'projetos', '.claude', 'settings.local.json'), JSON.stringify({ env: { CONTEXT_API_URL: 'https://kb.example.test/v1/context/' } }));
    assert.equal(configuredApiUrl({ cwd: work, home: base }), 'https://kb.example.test/v1/context');
    process.env.CONTEXT_API_URL = 'https://env.example.test/v1';
    assert.equal(configuredApiUrl({ cwd: work, home: base }), 'https://env.example.test/v1');
  } finally {
    if (saved === undefined) delete process.env.CONTEXT_API_URL; else process.env.CONTEXT_API_URL = saved;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('with no API address the CLI refuses writes and never falls back to the local cache', { skip: NO_API_SKIP }, async () => {
  const { base, env } = bareMachine();
  try {
    const item = [{ id: 'X-1', module: 'm', feature: 'f', type: 'current_behavior', phase: 'implemented', summary: 's', keywords: 'a' }];
    const r = await run(cliPath, ['--project', 'p', '--db-path', path.join(base, 'c.db'), 'upsert', '--file', '-'], { input: JSON.stringify(item), env, cwd: base });
    assert.notEqual(r.status, 0);
    assert.match(r.err, /CONTEXT_API_URL not configured[\s\S]*Writes never go to the local cache/);
    assert.equal(fs.existsSync(path.join(base, 'c.db')), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('with no API address the session start says so once and the other hooks stay silent', { skip: NO_API_SKIP }, async () => {
  const { base, env } = bareMachine();
  try {
    const root = path.join(base, 'projetos');
    fs.mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true });
    fs.symlinkSync(skillDir, path.join(root, '.agents', 'skills', 'managing-system-context'), 'junction');
    const hook = (name, payload) => run(path.join(skillDir, 'scripts', 'hooks', name), [], {
      input: JSON.stringify({ cwd: root, session_id: 'n1', ...payload }), env: { ...env, TEMP: base, TMP: base, TMPDIR: base, CONTEXT_SYNC_RULES: '0' }, cwd: root,
    });
    const start = await hook('on-session-start.mjs', { hook_event_name: 'SessionStart', source: 'startup' });
    assert.match(JSON.parse(start.out).systemMessage, /CONTEXT_API_URL não configurada/);
    const prompt = await hook('on-prompt.mjs', { hook_event_name: 'UserPromptSubmit', prompt: 'corrija o boletim' });
    assert.equal(prompt.status, 0);
    assert.equal(prompt.out.trim(), '');
    const edit = await hook('on-edit-guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(root, 'louza', 'a.ts') } });
    assert.equal(edit.out.trim(), ''); // no deny: a machine without the base is not an outage
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('neighbours asks the API for the rows linked to a row, up to the depth given', async () => {
  const api = await fakeApi({ neighbours: () => ({ engine: 'age', depth: 3, neighbours: [{ id: 'B', hops: 1 }] }) });
  try {
    const r = await run(cliPath, ['--api-url', api.url, '--project', 'louza', 'neighbours', 'LOUZA-A', '--depth', '3']);
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(api.calls[0].query, { project: 'louza', id: 'LOUZA-A', depth: '3' });
    assert.equal(JSON.parse(r.out).neighbours[0].id, 'B');
  } finally {
    api.close();
  }
});

test('impact asks the API who depends on an entity', async () => {
  const api = await fakeApi({ impact: () => ({ engine: 'age', affected: [{ id: 'ENT-LOUZA-API', hops: 1, kind: 'calls' }] }) });
  try {
    const r = await run(cliPath, ['--api-url', api.url, '--project', 'qoinmsg', 'impact', 'ENT-QOINMSG-API']);
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(api.calls[0].query, { project: 'qoinmsg', id: 'ENT-QOINMSG-API', depth: '3' });
    assert.equal(JSON.parse(r.out).affected[0].id, 'ENT-LOUZA-API');
  } finally {
    api.close();
  }
});
