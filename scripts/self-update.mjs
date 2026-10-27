#!/usr/bin/env node
// Keeps this clone of the skill on origin/main by itself, so every agent whose hooks point here
// (Claude Code, Codex, agy, Kimi and Maestro's chats all run the same files) gets a new version
// without anyone pulling. The session-start hook runs it in the background at most once an hour.
//
// Fast-forward only and never destructive: it does nothing when the clone is not on main, has
// uncommitted changes, has local commits origin lacks, or is in the middle of a merge. When the
// update touches install-hooks.mjs, it re-registers the hooks in each agent that already has them
// (it never installs into an agent the user did not opt in). CONTEXT_SELF_UPDATE=0 turns it off.
//
//   node self-update.mjs [--quiet]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = process.argv.includes('--quiet');
const log = (...a) => { if (!quiet) console.log(...a); };

export const gitIn = (dir) => (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, windowsHide: true }).trim();
const git = gitIn(skillDir);

// Why the clone must not be touched, or null when a fast-forward is safe to try.
export function blocker(g = git) {
  try { g('rev-parse', '--git-dir'); } catch { return 'não é um clone git'; }
  const branch = g('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') return `no ramo ${branch}, não main`;
  if (g('status', '--porcelain', '--untracked-files=no')) return 'há mudanças não commitadas';
  const gitDir = path.resolve(g('rev-parse', '--show-toplevel'), g('rev-parse', '--git-dir'));
  if (['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD'].some((f) => fs.existsSync(path.join(gitDir, f)))) return 'merge ou rebase em andamento';
  return null;
}

// Agents that already run our hooks: the installer is re-run only for them.
export function optedIn(home = os.homedir()) {
  const has = (file, test) => { try { return test(fs.readFileSync(file, 'utf8')); } catch { return false; } };
  const ours = (s) => s.includes('managing-system-context');
  return {
    claude: has(path.join(home, '.claude', 'settings.json'), ours),
    codex: has(path.join(home, '.codex', 'hooks.json'), ours),
    agy: has(path.join(home, '.gemini', 'config', 'hooks.json'), ours),
    kimi: has(path.join(home, '.kimi-code', 'config.toml'), ours),
  };
}

export function update({ g = git, home = os.homedir() } = {}) {
  const why = blocker(g);
  if (why) return { status: 'skipped', reason: why };
  g('fetch', '--quiet', 'origin', 'main');
  const head = g('rev-parse', 'HEAD');
  const remote = g('rev-parse', 'origin/main');
  if (head === remote) return { status: 'current', head };
  // Local commits origin lacks: someone works in this clone; leave it alone.
  try { g('merge-base', '--is-ancestor', head, remote); } catch { return { status: 'skipped', reason: 'commits locais que a origem não tem' }; }
  const changed = g('diff', '--name-only', head, remote).split('\n').filter(Boolean);
  g('merge', '--ff-only', '--quiet', remote);
  const reinstalled = [];
  if (changed.includes('scripts/install-hooks.mjs')) {
    const agents = optedIn(home);
    const flags = { claude: [], codex: ['--codex'], agy: ['--agy'], kimi: ['--kimi'] };
    for (const [agent, on] of Object.entries(agents)) {
      if (!on) continue;
      try {
        execFileSync(process.execPath, [path.join(skillDir, 'scripts', 'install-hooks.mjs'), ...flags[agent], '--home', home], { stdio: 'ignore', timeout: 30_000, windowsHide: true });
        reinstalled.push(agent);
      } catch {}
    }
  }
  return { status: 'updated', from: head.slice(0, 7), to: remote.slice(0, 7), files: changed.length, reinstalled };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.CONTEXT_SELF_UPDATE === '0') process.exit(0);
  try {
    const r = update();
    log(JSON.stringify(r));
    // The last outcome, for whoever wonders why the clone did not move.
    try { fs.writeFileSync(path.join(os.tmpdir(), 'claude-context-hooks', 'self-update.json'), JSON.stringify({ at: new Date().toISOString(), ...r }, null, 2)); } catch {}
  } catch (err) {
    log(JSON.stringify({ status: 'error', error: String(err.message).slice(0, 200) }));
  }
}
