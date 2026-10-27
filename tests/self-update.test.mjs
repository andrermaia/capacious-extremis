import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { update, gitIn, optedIn } from '../scripts/self-update.mjs';

const sh = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();

// An origin with one commit, a clone of it, and a second working copy that pushes new commits.
function repos(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'selfupdate-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const origin = path.join(tmp, 'origin.git');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin], { windowsHide: true });
  const author = path.join(tmp, 'author');
  execFileSync('git', ['clone', '-q', origin, author], { windowsHide: true, stdio: 'ignore' });
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) sh(author, 'config', k, v);
  sh(author, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(author, 'a.txt'), '1');
  sh(author, 'add', '.'); sh(author, 'commit', '-q', '-m', 'one'); sh(author, 'push', '-q', 'origin', 'main');
  const clone = path.join(tmp, 'clone');
  execFileSync('git', ['clone', '-q', origin, clone], { windowsHide: true, stdio: 'ignore' });
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false']]) sh(clone, 'config', k, v);
  const push = (file, text) => { fs.writeFileSync(path.join(author, file), text); sh(author, 'add', '.'); sh(author, 'commit', '-q', '-m', file); sh(author, 'push', '-q', 'origin', 'main'); };
  return { tmp, clone, push, g: gitIn(clone) };
}

test('a clean clone on main fast-forwards to origin/main', (t) => {
  const { clone, push, g, tmp } = repos(t);
  assert.equal(update({ g, home: tmp }).status, 'current');
  push('b.txt', '2');
  const r = update({ g, home: tmp });
  assert.equal(r.status, 'updated');
  assert.equal(r.files, 1);
  assert.equal(fs.readFileSync(path.join(clone, 'b.txt'), 'utf8'), '2');
});

test('uncommitted changes, another branch or local commits keep the clone as it is', (t) => {
  const { clone, push, g, tmp } = repos(t);
  push('b.txt', '2');
  fs.writeFileSync(path.join(clone, 'a.txt'), 'local edit');
  assert.match(update({ g, home: tmp }).reason, /não commitadas/);
  sh(clone, 'commit', '-q', '-am', 'local');
  assert.match(update({ g, home: tmp }).reason, /commits locais/);
  assert.equal(fs.existsSync(path.join(clone, 'b.txt')), false);
  sh(clone, 'checkout', '-q', '-b', 'outro');
  assert.match(update({ g, home: tmp }).reason, /ramo outro/);
});

test('only agents that already run the hooks are opted in', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'optin-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.codex', 'hooks.json'), '{"hooks":{"Stop":[{"hooks":[{"command":"node x/managing-system-context/scripts/hooks/on-stop.mjs"}]}]}}');
  assert.deepEqual(optedIn(home), { claude: false, codex: true, agy: false, kimi: false });
});
