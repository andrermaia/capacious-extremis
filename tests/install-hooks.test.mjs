import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, WANTED } from '../scripts/install-hooks.mjs';

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
