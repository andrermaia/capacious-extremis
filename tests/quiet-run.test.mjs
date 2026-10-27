import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RUNNER, quietCommand, summarize, WHOLE } from '../scripts/quiet-run.mjs';

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('only a whole test or build command, unfiltered, is rewritten', () => {
  for (const c of ['npm test', 'npm run build', 'npm run test:unit', 'node --test tests/*.test.mjs', 'cargo test -p api', 'go test ./...', 'pytest -q', 'npx vitest run', 'dotnet test']) assert.ok(RUNNER.test(c), c);
  for (const c of ['npm test | tail -20', 'npm test 2>&1', 'cd api && npm test', 'npm install', 'git status', 'node script.mjs', 'npm test > out.txt', 'echo $(npm test)']) assert.ok(!RUNNER.test(c), c);
});

test('short output is shown whole; a passing run keeps its tail; a failing one its failures and tail', () => {
  assert.deepEqual(summarize('a\nb\n', 0), { lines: ['a', 'b'], cut: false });
  const pass = Array.from({ length: 300 }, (_, i) => `ok ${i}`).join('\n');
  const p = summarize(pass, 0);
  assert.equal(p.cut, true);
  assert.equal(p.lines.length, 15);
  assert.equal(p.lines.at(-1), 'ok 299');
  const fail = [...Array.from({ length: 200 }, (_, i) => `ok ${i}`), 'FAIL src/a.test.ts', '  expected 2 got 3', '  at a.test.ts:10', ...Array.from({ length: 100 }, (_, i) => `ok ${200 + i}`), 'Tests: 1 failed'];
  const f = summarize(fail.join('\n'), 1);
  assert.deepEqual(f.lines.slice(0, 2), ['…', 'FAIL src/a.test.ts']);
  assert.ok(f.lines.includes('  expected 2 got 3'));
  assert.equal(f.lines.at(-1), 'Tests: 1 failed');
  assert.ok(f.lines.length < WHOLE);
});

test('the rewritten command runs in bash, summarizes and keeps the exit code', (t) => {
  const bash = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8', windowsHide: true });
  if (bash.status !== 0) return t.skip('no bash');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'out.log');
  const cmd = quietCommand('for i in $(seq 1 200); do echo line $i; done; echo "Error: boom"; exit 3', log, path.join(skillDir, 'scripts', 'quiet-run.mjs'));
  const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 3);
  assert.match(r.stdout, /Error: boom/);
  assert.match(r.stdout, /saída resumida pelo hook \(código 3\): 201 linhas/);
  assert.doesNotMatch(r.stdout, /line 50\n/);
  assert.equal(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length, 201);
});

test('the hook rewrites only in bypassPermissions mode, inside a project', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quietroot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.agents', 'skills', 'managing-system-context'), { recursive: true });
  const run = (mode, command = 'npm test') => {
    const r = spawnSync(process.execPath, [path.join(skillDir, 'scripts', 'hooks', 'on-bash.mjs')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command, description: 'd' }, permission_mode: mode, cwd: root }),
      encoding: 'utf8', windowsHide: true, env: { ...process.env, TEMP: root, TMP: root },
    });
    return r.stdout ? JSON.parse(r.stdout) : null;
  };
  const out = run('bypassPermissions');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'allow');
  assert.match(out.hookSpecificOutput.updatedInput.command, /^\( npm test \) > ".*\.log" 2>&1; __code=\$\?; node ".*quiet-run\.mjs"/);
  assert.equal(out.hookSpecificOutput.updatedInput.description, 'd');
  assert.equal(run('default'), null);
  assert.equal(run('acceptEdits'), null);
  assert.equal(run('bypassPermissions', 'npm test | tail'), null);
});
