import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sync, renderRules, BEGIN, END } from '../scripts/sync-rules.mjs';

const RULES = [
  { id: 'RULE-NO-DOCKER', feature: 'environment', phase: 'implemented', summary: 'No Docker on the workstation.' },
  { id: 'RULE-LANGUAGE', feature: 'communication', phase: 'implemented', summary: 'Write in Portuguese with accents.' },
  { id: 'RULE-CANDOR', feature: 'communication', phase: 'implemented', summary: 'Be blunt.' },
  { id: 'RULE-ODD', feature: 'zeta-things', phase: 'implemented', summary: 'Unknown category goes last.' },
];

function machine({ codex = true, gemini = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-rules-'));
  const home = path.join(base, 'home');
  const root = path.join(base, 'projetos');
  fs.mkdirSync(home);
  fs.mkdirSync(root);
  if (codex) fs.mkdirSync(path.join(home, '.codex'));
  if (gemini) fs.mkdirSync(path.join(home, '.gemini'));
  const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
  return { base, home, root, read, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('rules render by category in a fixed order, alphabetical inside each', () => {
  const text = renderRules(RULES);
  const order = ['### Communication', '- Be blunt.', '- Write in Portuguese', '### Environment', '### Zeta things'];
  const at = order.map((s) => text.indexOf(s));
  assert.ok(at.every((i) => i >= 0), text);
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test('every agent file gets its block; the second run changes nothing', () => {
  const m = machine();
  const first = sync({ home: m.home, root: m.root, rules: RULES });
  assert.equal(first.written.length, 4); // ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, <root>/CLAUDE.md, <root>/AGENTS.md
  assert.match(m.read(m.home, '.claude', 'CLAUDE.md'), /## Universal agent rules[\s\S]*No Docker/);
  assert.doesNotMatch(m.read(m.home, '.claude', 'CLAUDE.md'), /System Context/);
  const codex = m.read(m.home, '.codex', 'AGENTS.md');
  assert.match(codex, /Be blunt[\s\S]*only under `.*projetos`[\s\S]*ctx task-start/);
  assert.match(codex, /context-cli\.mjs/);
  assert.match(m.read(m.root, 'CLAUDE.md'), /^# Global Agent Rules\n\n<!-- capacious-extremis:begin[\s\S]*run by hooks[\s\S]*do not narrate the stages/);
  // The root AGENTS.md comes on top of each agent's own file: no second copy of the rules or the manual protocol.
  const rootAgents = m.read(m.root, 'AGENTS.md');
  assert.match(rootAgents, /run by hooks[\s\S]*An agent without these hooks: read the universal rules[\s\S]*protocol-manual\.md/);
  assert.doesNotMatch(rootAgents, /Be blunt|ctx task-start/);
  const second = sync({ home: m.home, root: m.root, rules: RULES });
  assert.equal(second.written.length, 0);
  assert.equal(second.unchanged.length, 4);
  m.done();
});

test('an agent whose hooks are installed gets the short protocol; Kimi gets its own file', () => {
  const m = machine();
  fs.writeFileSync(path.join(m.home, '.codex', 'hooks.json'), '{"hooks":{"Stop":[{"hooks":[{"command":"node x/managing-system-context/scripts/hooks/on-stop.mjs"}]}]}}');
  fs.mkdirSync(path.join(m.home, '.kimi-code'));
  sync({ home: m.home, root: m.root, rules: RULES });
  const codex = m.read(m.home, '.codex', 'AGENTS.md');
  assert.match(codex, /Be blunt[\s\S]*run by hooks/);
  assert.doesNotMatch(codex, /ctx task-start/);
  const kimi = m.read(m.home, '.kimi-code', 'AGENTS.md');
  assert.match(kimi, /Be blunt[\s\S]*ctx task-start/, 'Kimi without its hooks keeps the manual protocol');
  m.done();
});

test('text outside the block survives; only the block is replaced', () => {
  const m = machine({ codex: false });
  fs.mkdirSync(path.join(m.home, '.claude'));
  const file = path.join(m.home, '.claude', 'CLAUDE.md');
  fs.writeFileSync(file, `# Mine\n\nKeep this.\n\n${BEGIN}\nold rules\n${END}\n\nAnd this.\n`);
  sync({ home: m.home, root: null, rules: RULES });
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^# Mine\n\nKeep this\.\n\n<!-- capacious-extremis:begin/);
  assert.match(text, /And this\.\n$/);
  assert.doesNotMatch(text, /old rules/);
  m.done();
});

test('a hand-written protocol copy is replaced whole, after a backup; ~/.claude/CLAUDE.md never is', () => {
  const m = machine();
  const legacy = '# Global agent rules (installed by Maestro)\n\n## System Context & Knowledge Management\nold protocol\n';
  fs.writeFileSync(path.join(m.home, '.codex', 'AGENTS.md'), legacy);
  fs.mkdirSync(path.join(m.home, '.claude'));
  const cloudProtocol = '# System Context & Knowledge Management\n\nCloud protocol written by install.mjs.\n';
  fs.writeFileSync(path.join(m.home, '.claude', 'CLAUDE.md'), cloudProtocol);
  const report = sync({ home: m.home, root: m.root, rules: RULES });
  assert.doesNotMatch(m.read(m.home, '.codex', 'AGENTS.md'), /old protocol|installed by Maestro/);
  assert.equal(report.backups.length, 1);
  assert.equal(fs.readFileSync(report.backups[0], 'utf8'), legacy);
  const claude = m.read(m.home, '.claude', 'CLAUDE.md');
  assert.match(claude, /^# System Context & Knowledge Management\n\nCloud protocol written by install\.mjs\.\n\n<!-- capacious-extremis:begin/);
  m.done();
});

test('without a project root only the user-level files are written, rules only', () => {
  const m = machine({ gemini: true });
  const report = sync({ home: m.home, root: null, rules: RULES });
  assert.equal(report.written.length, 3);
  assert.doesNotMatch(m.read(m.home, '.gemini', 'GEMINI.md'), /System Context/);
  assert.ok(!fs.existsSync(path.join(m.root, 'CLAUDE.md')));
  m.done();
});

test('no active rule means nothing is written', () => {
  const m = machine();
  assert.throws(() => sync({ home: m.home, root: m.root, rules: [] }), /nothing written/);
  assert.ok(!fs.existsSync(path.join(m.home, '.claude', 'CLAUDE.md')));
  m.done();
});
