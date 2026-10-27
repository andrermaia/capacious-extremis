#!/usr/bin/env node
// PreToolUse hook (Bash, Claude Code): a test or build command whose output the agent did not
// filter runs with its output sent to a log, and the model gets only the failures and the last
// lines (scripts/quiet-run.mjs) plus the log's path. In long sessions tool output is most of the
// context (the billion-context study); a passing test suite of 300 lines becomes 16.
//
// Narrow on purpose: the whole command must be one known test/build runner, with no pipe,
// redirect, chain or substitution (an agent that filters its output is left alone); only inside
// a project; only in bypassPermissions mode, because a rewritten input has to be approved by the
// hook itself, and in the other modes that would skip the user's own permission rules.
// The command runs in the agent's shell as it would have, and its exit code is kept.
// CONTEXT_QUIET_RUN=0 turns it off.
import fs from 'node:fs';
import path from 'node:path';
import { readStdinJson, emit, projectRoot, stateFile, scriptPath } from './hook-lib.mjs';
import { RUNNER, quietCommand } from '../quiet-run.mjs';

const input = readStdinJson();
const command = String(input.tool_input?.command || '');
if (process.env.CONTEXT_QUIET_RUN === '0' || input.tool_name !== 'Bash' || input.permission_mode !== 'bypassPermissions'
  || !RUNNER.test(command.trim()) || !projectRoot(input)) process.exit(0);

const dir = path.join(path.dirname(stateFile('quiet')), 'output');
fs.mkdirSync(dir, { recursive: true });
// Logs older than two days go.
try { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (Date.now() - fs.statSync(p).mtimeMs > 2 * 86400000) fs.rmSync(p, { force: true }); } } catch {}
const log = path.join(dir, `${Date.now()}-${process.pid}.log`);
emit({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    updatedInput: { ...input.tool_input, command: quietCommand(command, log, scriptPath('quiet-run.mjs')) },
  },
});
