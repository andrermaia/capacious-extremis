import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, installCodex, installAgy, AGY_ENTRY, WANTED, WANTED_CODEX } from '../scripts/install-hooks.mjs';

test('agy gets one named entry in ~/.gemini/config/hooks.json, through the adapter, unquoted; others stay', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-agy-'));
  fs.mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'config', 'hooks.json'), JSON.stringify({ other: { Stop: [{ command: 'echo other' }] } }));
  installAgy({ home });
  const config = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'config', 'hooks.json'), 'utf8'));
  assert.deepEqual(config.other, { Stop: [{ command: 'echo other' }] });
  assert.deepEqual(Object.keys(config[AGY_ENTRY]), ['SessionStart', 'PreInvocation', 'Stop']);
  assert.match(config[AGY_ENTRY].PreInvocation[0].command, /^node \S+\/scripts\/hooks\/agy-adapter\.mjs PreInvocation$/);
  installAgy({ home });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'config', 'hooks.json'), 'utf8')), config);
  fs.rmSync(home, { recursive: true, force: true });
});

test('Codex gets the same hooks in ~/.codex/hooks.json, edits through apply_patch; others stay', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-codex-'));
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo other' }] }] } }));
  installCodex({ home });
  const config = JSON.parse(fs.readFileSync(path.join(home, '.codex', 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(WANTED_CODEX).every((e) => config.hooks[e]), true);
  assert.equal(config.hooks.PreToolUse[0].matcher, '^apply_patch$');
  assert.match(config.hooks.PreToolUse[0].hooks[0].command, /^node ".*\/scripts\/hooks\/on-edit-guard\.mjs"$/);
  assert.equal(config.hooks.Stop[0].hooks[0].command, 'echo other');
  assert.equal(config.hooks.Stop.length, 2);
  installCodex({ home });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, '.codex', 'hooks.json'), 'utf8')), config);
  fs.rmSync(home, { recursive: true, force: true });
});

test('hooks go to the user settings with absolute paths; old project entries leave, others stay', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'install-hooks-'));
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    permissions: { allow: ['Bash(ls:*)'] },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo other' }] }, { hooks: [{ type: 'command', command: 'node "old/managing-system-context/scripts/hooks/on-stop.mjs"' }] }] },
  }));
  const projectFile = path.join(base, 'project-settings.json');
  fs.writeFileSync(projectFile, JSON.stringify({ hooks: {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.agents/skills/managing-system-context/scripts/hooks/on-prompt.mjs"' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/on-commit-louza.mjs"' }] }],
  } }));

  const report = install({ home, projectSettings: projectFile });
  const user = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(user.permissions, { allow: ['Bash(ls:*)'] });
  assert.deepEqual(Object.keys(WANTED).every((e) => user.hooks[e]), true);
  assert.equal(user.hooks.PostToolUse, undefined);
  assert.equal(user.hooks.Stop.length, 2);
  assert.equal(user.hooks.Stop[0].hooks[0].command, 'echo other');
  assert.match(user.hooks.Stop[1].hooks[0].command, /^node ".*\/scripts\/hooks\/on-stop\.mjs"$/);
  assert.doesNotMatch(user.hooks.UserPromptSubmit[0].hooks[0].command, /CLAUDE_PROJECT_DIR/);
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  assert.equal(report.removedFromProject, 1);
  assert.deepEqual(Object.keys(project.hooks), ['PreToolUse']);

  install({ home, projectSettings: projectFile });
  const again = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(again, user);
  fs.rmSync(base, { recursive: true, force: true });
});
