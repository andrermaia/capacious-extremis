#!/usr/bin/env node
// Indexes the commits of every repository under the projects root into the shared base
// (POST /commits), so a search finds what changed, when and in which files. Incremental:
// each repository starts after the newest commit the base already holds. Only real clones
// (a .git directory) count; worktrees share their clone's history.
//
//   node scripts/ingest-commits.mjs [--root <projects root>] [--max 3000] [--quiet]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { apiRequest, detectProject } from './hooks/hook-lib.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const root = path.resolve(arg('--root', process.cwd()));
const MAX = Number(arg('--max', 3000));
const quiet = process.argv.includes('--quiet');
const log = (...a) => { if (!quiet) console.log(...a); };

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

function mainRef(dir) {
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    try {
      git(dir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
      return ref;
    } catch {}
  }
  return null;
}

// One record per commit: \x1e starts it, \x1f separates the fields, the file list follows.
export function parseLog(text) {
  return text.split('\x1e').slice(1).map((chunk) => {
    const [sha, date, author, subject, body, rest = ''] = chunk.split('\x1f');
    return {
      sha, date, author, subject,
      body: String(body || '').split('\n').filter((l) => !/^(co-authored-by|signed-off-by):/i.test(l.trim())).join('\n').trim().slice(0, 2000),
      files: rest.split('\n').map((f) => f.trim()).filter(Boolean).slice(0, 60),
    };
  }).filter((c) => c.sha && c.subject);
}

async function ingest(dir) {
  const repo = path.basename(dir);
  const ref = mainRef(dir);
  if (!ref) return { repo, skipped: 'no main branch' };
  const { project } = detectProject({ cwd: dir }, root);
  const last = await apiRequest(root, 'GET', `commits/last?repo=${encodeURIComponent(repo)}`, null, { timeoutMs: 10000 });
  if (!last.ok) return { repo, error: last.error };
  let range = [ref];
  if (last.data?.sha) {
    try {
      git(dir, 'cat-file', '-e', `${last.data.sha}^{commit}`);
      range = [`${last.data.sha}..${ref}`];
    } catch {}
  }
  const out = git(dir, 'log', '--no-merges', `--max-count=${MAX}`, '--format=%x1e%H%x1f%cI%x1f%an%x1f%s%x1f%b%x1f', '--name-only', ...range, '--');
  const commits = parseLog(out).reverse(); // oldest first: an interrupted run leaves no gap behind "last"
  let inserted = 0;
  for (let i = 0; i < commits.length; i += 500) {
    const r = await apiRequest(root, 'POST', `commits?project=${encodeURIComponent(project)}`, { repo, items: commits.slice(i, i + 500) }, { timeoutMs: 60000 });
    if (!r.ok) return { repo, project, inserted, error: r.error };
    inserted += r.data.inserted;
  }
  return { repo, project, inserted, seen: commits.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const repos = fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && fs.statSync(path.join(root, d.name, '.git'), { throwIfNoEntry: false })?.isDirectory())
    .map((d) => path.join(root, d.name));
  let total = 0;
  for (const dir of repos) {
    try {
      const r = await ingest(dir);
      total += r.inserted || 0;
      if (r.error || r.inserted) log(JSON.stringify(r));
    } catch (err) {
      log(JSON.stringify({ repo: path.basename(dir), error: err.message.split('\n')[0] }));
    }
  }
  log(JSON.stringify({ status: 'ok', repos: repos.length, inserted: total }));
}
