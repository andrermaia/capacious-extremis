import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(__dirname, '../cloud/takius-git.sh');

// A fake VM: its own HOME (global git config) and a folder of clones.
function vm() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'takius-git-'));
  const home = path.join(base, 'home');
  const root = path.join(base, 'user');
  fs.mkdirSync(home);
  fs.mkdirSync(root);
  const env = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', CLAUDE_CODE_REMOTE: 'true', CLAUDE_PROJECT_DIR: path.join(root, 'louza') };
  delete env.GIT_CONFIG_GLOBAL;
  const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', env, ...opts }).trim();
  const clone = (name, origin) => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    git(['init', '-q', dir]);
    if (origin) git(['-C', dir, 'remote', 'add', 'origin', origin]);
    return dir;
  };
  const run = (extra = {}) => execFileSync('sh', [script], { env: { ...env, ...extra } });
  return { base, root, env, git, clone, run };
}

test('without TAKIUS_GIT_TOKEN nothing changes', (t) => {
  const v = vm();
  t.after(() => fs.rmSync(v.base, { recursive: true, force: true }));
  const louza = v.clone('louza', 'https://github.com/andrermaia/louza');
  v.run({ TAKIUS_GIT_TOKEN: '' });
  assert.equal(v.git(['-C', louza, 'remote']), 'origin');
});

test('adds the takius remote to clones of the GitHub owner only', (t) => {
  const v = vm();
  t.after(() => fs.rmSync(v.base, { recursive: true, force: true }));
  const louza = v.clone('louza', 'https://github.com/andrermaia/louza');
  const fe = v.clone('louza-fe', 'https://github.com/andrermaia/louza-fe.git');
  const proxied = v.clone('qlave', 'http://local_proxy@127.0.0.1:41000/git/andrermaia/qlave');
  const outro = v.clone('outro', 'https://github.com/someone-else/outro');
  const semOrigin = v.clone('sem-origin', null);
  fs.mkdirSync(path.join(v.root, 'nao-e-git'));

  v.run({ TAKIUS_GIT_TOKEN: 'tok' });

  assert.equal(v.git(['-C', louza, 'remote', 'get-url', 'takius']), 'https://git.takius.com.br/andre/louza.git');
  assert.equal(v.git(['-C', fe, 'remote', 'get-url', 'takius']), 'https://git.takius.com.br/andre/louza-fe.git');
  assert.equal(v.git(['-C', proxied, 'remote', 'get-url', 'takius']), 'https://git.takius.com.br/andre/qlave.git');
  assert.equal(v.git(['-C', outro, 'remote']), 'origin');
  assert.equal(v.git(['-C', semOrigin, 'remote']), '');
});

test('running again is idempotent and fixes a stale takius url', (t) => {
  const v = vm();
  t.after(() => fs.rmSync(v.base, { recursive: true, force: true }));
  const louza = v.clone('louza', 'https://github.com/andrermaia/louza');
  v.git(['-C', louza, 'remote', 'add', 'takius', 'https://wrong.example/x.git']);
  v.run({ TAKIUS_GIT_TOKEN: 'tok' });
  v.run({ TAKIUS_GIT_TOKEN: 'tok' });
  assert.equal(v.git(['-C', louza, 'remote', 'get-url', 'takius']), 'https://git.takius.com.br/andre/louza.git');
  // Raw output: the first helper is the empty reset line, which trim() would eat.
  const helpers = execFileSync('git', ['config', '--global', '--get-all', 'credential.https://git.takius.com.br.helper'], {
    encoding: 'utf8', env: v.env,
  }).replace(/\n$/, '').split('\n');
  assert.equal(helpers.length, 2);
  assert.equal(helpers[0], '');
  assert.match(helpers[1], /TAKIUS_GIT_TOKEN/);
});

test('git gets the token from the environment, and it is not written to disk', (t) => {
  const v = vm();
  t.after(() => fs.rmSync(v.base, { recursive: true, force: true }));
  v.run({ TAKIUS_GIT_TOKEN: 'segredo-123' });
  assert.ok(!fs.readFileSync(path.join(v.env.HOME, '.gitconfig'), 'utf8').includes('segredo-123'));
  const fill = (env) => execFileSync('git', ['credential', 'fill'], {
    encoding: 'utf8',
    env: { ...v.env, GIT_TERMINAL_PROMPT: '0', ...env },
    input: 'protocol=https\nhost=git.takius.com.br\npath=andre/louza.git\n\n',
  });
  const out = fill({ TAKIUS_GIT_TOKEN: 'segredo-123' });
  assert.match(out, /^username=andre$/m);
  assert.match(out, /^password=segredo-123$/m);
  // A rotated token in the environment is picked up without rerunning the hook.
  assert.match(fill({ TAKIUS_GIT_TOKEN: 'novo-456' }), /^password=novo-456$/m);
});

test('outside the cloud it does nothing', (t) => {
  const v = vm();
  t.after(() => fs.rmSync(v.base, { recursive: true, force: true }));
  const louza = v.clone('louza', 'https://github.com/andrermaia/louza');
  v.run({ TAKIUS_GIT_TOKEN: 'tok', CLAUDE_CODE_REMOTE: '' });
  assert.equal(v.git(['-C', louza, 'remote']), 'origin');
  assert.ok(!fs.existsSync(path.join(v.env.HOME, '.gitconfig')));
});
