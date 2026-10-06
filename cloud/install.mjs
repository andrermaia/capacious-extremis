// Registers the protocol hooks in ~/.claude/settings.json and the protocol text in
// ~/.claude/CLAUDE.md of a Claude Code on the web VM. Idempotent: entries already
// pointing at this skill are replaced, anything else in the files is kept.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const claudeDir = path.join(os.homedir(), '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');
const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
const MARK = 'managing-system-context';

const hook = (script, extra = {}) => ({
  type: 'command',
  command: `node "$CLAUDE_PROJECT_DIR/.agents/skills/managing-system-context/scripts/hooks/${script}"`,
  ...extra,
});

const wanted = {
  SessionStart: [{ hooks: [{ type: 'command', command: `sh "${path.join(skill, 'cloud', 'link-repo.sh')}"`, timeout: 10 }] }],
  UserPromptSubmit: [{ hooks: [hook('on-prompt.mjs', { timeout: 30, statusMessage: 'Etapa 1/3 · carregando contexto do Takius' })] }],
  PreToolUse: [{ matcher: 'Edit|Write|NotebookEdit', hooks: [hook('on-edit-guard.mjs', { timeout: 10, statusMessage: 'Verificando tarefa aberta' })] }],
  PostToolUse: [{ matcher: 'Bash', hooks: [hook('on-cli-call.mjs', { timeout: 10 })] }],
  Stop: [{ hooks: [hook('on-stop.mjs', { timeout: 10, statusMessage: 'Etapa 3/3 · conferindo encerramento da tarefa' })] }],
};

let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* new file */ }
settings.hooks ||= {};
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

console.log(`hooks -> ${settingsPath}\nprotocol -> ${claudeMdPath}`);
