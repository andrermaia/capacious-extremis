#!/usr/bin/env node
// Registers the protocol hooks in the USER settings (~/.claude/settings.json) with absolute
// paths to this skill, so every Claude Code session on the machine runs them, in any folder.
// Outside a folder that holds the skill the hooks do nothing (only the universal rules in
// ~/.claude/CLAUDE.md apply). Idempotent: entries already pointing at this skill are
// replaced, anything else is kept. --project-settings <file> removes the old project-level
// entries from that file, so the hooks do not run twice there.
// Usage: node install-hooks.mjs [--home <dir>] [--project-settings <file>] [--dry-run]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARK = 'managing-system-context';
const hooksDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hooks').split(path.sep).join('/');

const hook = (script, extra = {}) => ({ type: 'command', command: `node "${hooksDir}/${script}"`, ...extra });

export const WANTED = {
  SessionStart: [{ hooks: [hook('on-session-start.mjs', { timeout: 30, statusMessage: 'Contexto da sessão · carregando do Takius' })] }],
  UserPromptSubmit: [{ hooks: [hook('on-prompt.mjs', { timeout: 30, statusMessage: 'Etapa 1/3 · carregando contexto do Takius' })] }],
  PreToolUse: [{ matcher: 'Edit|Write|NotebookEdit', hooks: [hook('on-edit-guard.mjs', { timeout: 10, statusMessage: 'Etapa 2/3 · conferindo a tarefa' })] }],
  PostToolUse: [{ matcher: 'Bash|PowerShell', hooks: [hook('on-cli-call.mjs', { timeout: 10 })] }],
  Stop: [{ hooks: [hook('on-stop.mjs', { timeout: 10, statusMessage: 'Etapa 3/3 · fechando a tarefa' })] }],
};

// Ours: any of the five protocol hooks, wherever the skill was installed (its folder name varies).
const OUR_SCRIPT = /[\\/]scripts[\\/]hooks[\\/]on-(session-start|prompt|edit-guard|cli-call|stop)\.mjs"?\s*$/;
const ours = (group) => (group.hooks || []).some((h) => OUR_SCRIPT.test(String(h.command || '')) || String(h.command || '').includes(`${MARK}/scripts/hooks/`));

// Drops our groups from a settings object; returns how many were removed.
function strip(settings) {
  let removed = 0;
  for (const [event, groups] of Object.entries(settings.hooks || {})) {
    const kept = groups.filter((g) => !ours(g));
    removed += groups.length - kept.length;
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
  return removed;
}

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
};

export function install({ home = os.homedir(), projectSettings = null, dryRun = false } = {}) {
  const userFile = path.join(home, '.claude', 'settings.json');
  const user = readJson(userFile);
  strip(user);
  user.hooks ||= {};
  for (const [event, groups] of Object.entries(WANTED)) user.hooks[event] = [...(user.hooks[event] || []), ...groups];
  const report = { status: 'ok', user: userFile, events: Object.keys(WANTED), project: null, removedFromProject: 0 };
  if (!dryRun) {
    fs.mkdirSync(path.dirname(userFile), { recursive: true });
    fs.writeFileSync(userFile, `${JSON.stringify(user, null, 2)}\n`);
  }
  if (projectSettings) {
    const project = readJson(projectSettings);
    report.project = projectSettings;
    report.removedFromProject = strip(project);
    if (!dryRun && report.removedFromProject) fs.writeFileSync(projectSettings, `${JSON.stringify(project, null, 2)}\n`);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };
  try {
    console.log(JSON.stringify(install({ home: arg('home') || os.homedir(), projectSettings: arg('project-settings'), dryRun: argv.includes('--dry-run') }), null, 2));
  } catch (err) {
    console.error(JSON.stringify({ status: 'error', error: err.message }));
    process.exitCode = 1;
  }
}
