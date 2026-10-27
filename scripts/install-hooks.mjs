#!/usr/bin/env node
// Registers the four protocol hooks in the USER settings (~/.claude/settings.json) with absolute
// paths to this skill, so every Claude Code session on the machine runs them, in any folder.
// Outside a folder that holds the skill the hooks do nothing (only the universal rules in
// ~/.claude/CLAUDE.md apply). Idempotent: entries already pointing at this skill are
// replaced, anything else is kept. --project-settings <file> removes the old project-level
// entries from that file, so the hooks do not run twice there.
// Usage: node install-hooks.mjs [--home <dir>] [--project-settings <file>] [--dry-run]
//        node install-hooks.mjs --codex [--home <dir>] [--dry-run]   (Codex: ~/.codex/hooks.json)
//        node install-hooks.mjs --agy [--home <dir>] [--dry-run]     (agy: ~/.gemini/config/hooks.json)
//        node install-hooks.mjs --kimi [--home <dir>] [--dry-run]    (Kimi Code: ~/.kimi-code/config.toml)
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
  PreToolUse: [
    { matcher: 'Edit|Write|NotebookEdit', hooks: [hook('on-edit-guard.mjs', { timeout: 10, statusMessage: 'Etapa 2/3 · conferindo a tarefa' })] },
    // Test and build output summarized (Claude Code only: the others cannot rewrite a command).
    { matcher: 'Bash', hooks: [hook('on-bash.mjs', { timeout: 5 })] },
  ],
  Stop: [{ hooks: [hook('on-stop.mjs', { timeout: 10, statusMessage: 'Etapa 3/3 · fechando a tarefa' })] }],
};

// Codex (hooks stable since 0.162) reads the same events and fields from ~/.codex/hooks.json; its
// file edits go through apply_patch. Codex runs a new or changed hook only after the user
// trusts it in /hooks.
export const WANTED_CODEX = {
  SessionStart: WANTED.SessionStart,
  UserPromptSubmit: WANTED.UserPromptSubmit,
  PreToolUse: [{ matcher: '^apply_patch$', hooks: WANTED.PreToolUse[0].hooks }],
  Stop: WANTED.Stop,
};

// Ours: any of the five protocol hooks, wherever the skill was installed (its folder name varies).
const OUR_SCRIPT = /[\\/]scripts[\\/]hooks[\\/]on-(session-start|prompt|edit-guard|cli-call|stop|bash)\.mjs"?\s*$/;
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

// The same hooks for Codex, in ~/.codex/hooks.json (anything else in that file is kept).
export function installCodex({ home = os.homedir(), dryRun = false } = {}) {
  const file = path.join(home, '.codex', 'hooks.json');
  const config = readJson(file);
  strip(config);
  config.hooks ||= {};
  for (const [event, groups] of Object.entries(WANTED_CODEX)) config.hooks[event] = [...(config.hooks[event] || []), ...groups];
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  }
  return { status: 'ok', codex: file, events: Object.keys(WANTED_CODEX), trust: 'run /hooks in Codex once to review and trust them' };
}

// The Antigravity CLI (agy) reads ~/.gemini/config/hooks.json: one named entry per hook, events
// under it. agy has no prompt event and its own payload, so its events go through
// agy-adapter.mjs; it does not parse quotes in a command, so the path must have no spaces.
export const AGY_ENTRY = 'managing-system-context';
export function installAgy({ home = os.homedir(), dryRun = false } = {}) {
  const file = path.join(home, '.gemini', 'config', 'hooks.json');
  if (/\s/.test(hooksDir)) throw new Error(`agy cannot run a hook whose path has spaces: ${hooksDir}`);
  const config = readJson(file);
  const cmd = (event) => ({ type: 'command', command: `node ${hooksDir}/agy-adapter.mjs ${event}`, timeout: 30 });
  config[AGY_ENTRY] = { SessionStart: [cmd('SessionStart')], PreInvocation: [cmd('PreInvocation')], Stop: [cmd('Stop')] };
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  }
  return { status: 'ok', agy: file, events: Object.keys(config[AGY_ENTRY]) };
}

// Kimi Code CLI reads [[hooks]] tables from ~/.kimi-code/config.toml (event, matcher, command,
// timeout); its own payload goes through kimi-adapter.mjs. Our tables sit between two marker
// comments at the end of the file, so a reinstall replaces exactly them and nothing else.
const KIMI_BEGIN = '# >>> managing-system-context hooks (install-hooks.mjs --kimi)';
const KIMI_END = '# <<< managing-system-context hooks';
export function kimiBlock() {
  const table = (event, matcher = '') => [
    '[[hooks]]',
    `event = "${event}"`,
    `matcher = ${JSON.stringify(matcher)}`,
    `command = ${JSON.stringify(`node "${hooksDir}/kimi-adapter.mjs" ${event}`)}`,
    'timeout = 60',
  ].join('\n');
  return [KIMI_BEGIN, table('SessionStart'), table('UserPromptSubmit'), table('PreToolUse', '^(Edit|Write)$'), table('Stop'), KIMI_END].join('\n\n');
}
export function installKimi({ home = os.homedir(), dryRun = false } = {}) {
  const file = path.join(home, '.kimi-code', 'config.toml');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  const start = text.indexOf(KIMI_BEGIN);
  const end = text.indexOf(KIMI_END);
  if (start >= 0 && end > start) text = text.slice(0, start) + text.slice(end + KIMI_END.length);
  text = `${text.replace(/\s+$/, '')}${text.trim() ? '\n\n' : ''}${kimiBlock()}\n`;
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return { status: 'ok', kimi: file, events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };
  try {
    const home = arg('home') || os.homedir();
    if (argv.includes('--codex')) {
      console.log(JSON.stringify(installCodex({ home, dryRun: argv.includes('--dry-run') }), null, 2));
      process.exit(0);
    }
    if (argv.includes('--kimi')) {
      console.log(JSON.stringify(installKimi({ home, dryRun: argv.includes('--dry-run') }), null, 2));
      process.exit(0);
    }
    if (argv.includes('--agy')) {
      console.log(JSON.stringify(installAgy({ home, dryRun: argv.includes('--dry-run') }), null, 2));
      process.exit(0);
    }
    console.log(JSON.stringify(install({ home, projectSettings: arg('project-settings'), dryRun: argv.includes('--dry-run') }), null, 2));
  } catch (err) {
    console.error(JSON.stringify({ status: 'error', error: err.message }));
    process.exitCode = 1;
  }
}
