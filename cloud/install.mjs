// Registers the protocol hooks in ~/.claude/settings.json, the protocol text in
// ~/.claude/CLAUDE.md of a Claude Code on the web VM, and the universal agent rules
// from the knowledge base (sync-rules). Idempotent: entries already pointing at this
// skill are replaced, anything else in the files is kept.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const claudeDir = path.join(os.homedir(), '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');
const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
const MARK = 'managing-system-context';

const hook = (script, extra = {}) => ({
  type: 'command',
  command: `node "${path.join(skill, 'scripts', 'hooks', script)}"`,
  ...extra,
});

const wanted = {
  SessionStart: [{
    hooks: [
      { type: 'command', command: `sh "${path.join(skill, 'cloud', 'link-repo.sh')}"`, timeout: 10 },
      { type: 'command', command: `node "${path.join(skill, 'scripts', 'hooks', 'on-session-start.mjs')}"`, timeout: 30, statusMessage: 'Contexto da sessão · carregando da base' },
    ],
  }],
  UserPromptSubmit: [{ hooks: [hook('on-prompt.mjs', { timeout: 30, statusMessage: 'Etapa 1/3 · carregando contexto da base' })] }],
  PreToolUse: [{ matcher: 'Edit|Write|NotebookEdit', hooks: [hook('on-edit-guard.mjs', { timeout: 10, statusMessage: 'Etapa 2/3 · conferindo a tarefa' })] }],
  Stop: [{ hooks: [hook('on-stop.mjs', { timeout: 10, statusMessage: 'Etapa 3/3 · fechando a tarefa' })] }],
};

let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* new file */ }
settings.hooks ||= {};
// on-cli-call.mjs is gone (its counting moved to on-stop): drop a leftover PostToolUse entry.
if (settings.hooks.PostToolUse) {
  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter((g) => !(g.hooks || []).some((h) => String(h.command || '').includes(MARK)));
  if (!settings.hooks.PostToolUse.length) delete settings.hooks.PostToolUse;
}
for (const [event, groups] of Object.entries(wanted)) {
  const kept = (settings.hooks[event] || []).filter(
    (g) => !(g.hooks || []).some((h) => String(h.command || '').includes(MARK)),
  );
  settings.hooks[event] = [...kept, ...groups];
}
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

const begin = `<!-- ${MARK}:begin -->`;
const end = `<!-- ${MARK}:end -->`;
const block = `${begin}
${fs.readFileSync(path.join(skill, 'cloud', 'CLAUDE.protocol.md'), 'utf8').trim()}
${end}`;
let md = '';
try { md = fs.readFileSync(claudeMdPath, 'utf8'); } catch { /* new file */ }
const re = new RegExp(`${begin}[\\s\\S]*?${end}`);
md = re.test(md) ? md.replace(re, block) : `${md.trim()}\n\n${block}\n`.trimStart();
fs.writeFileSync(claudeMdPath, md);

// The universal rules come from the knowledge base; a failure here must not break the setup.
const rules = spawnSync(process.execPath, [path.join(skill, 'scripts', 'sync-rules.mjs'), '--no-root', '--quiet'], { encoding: 'utf8', windowsHide: true });
const rulesNote = rules.status === 0 ? 'universal rules -> ' + claudeMdPath : `universal rules NOT synced: ${(rules.stderr || '').trim().slice(0, 200)}`;

console.log(`hooks -> ${settingsPath}\nprotocol -> ${claudeMdPath}\n${rulesNote}`);
