#!/usr/bin/env node
// Kimi Code CLI adapter for the protocol hooks. Kimi (2.3.1) runs [[hooks]] from
// ~/.kimi-code/config.toml with a Claude-like payload (snake_case, session_id "session_<uuid>",
// cwd, the prompt as an array of parts) but no transcript path, and only the UserPromptSubmit
// output reaches the model (plain stdout, wrapped in <hook_result>); SessionStart output is
// dropped. So each Kimi event runs the Claude Code hook it stands for:
//   SessionStart              -> on-session-start.mjs, its context kept for the first prompt
//   UserPromptSubmit          -> that kept context (once) + on-prompt.mjs, printed as text
//   PreToolUse (Edit, Write)  -> on-edit-guard.mjs; only a deny is passed on
//   Stop                      -> on-stop.mjs (the last answer read from the session's wire.jsonl)
// The transcript is <sessionDir>/agents/main/wire.jsonl, sessionDir from session_index.jsonl.
// It never blocks Kimi except through the guard's deny; any failure prints nothing.
// In ~/.kimi-code/config.toml (install-hooks.mjs --kimi): node "<skill>/scripts/hooks/kimi-adapter.mjs" <Event>
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStdinJson, projectRoot, loadState, saveState } from './hook-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const event = process.argv[2];
const raw = readStdinJson();
const done = (text = '') => { if (text) process.stdout.write(text); process.exit(0); };

const uuid = String(raw.session_id || '').replace(/^session_/, '');
const input = { session_id: `kimi-${uuid || 'unknown'}`, cwd: raw.cwd };
if (!uuid || !raw.cwd || !projectRoot(input)) done();

// The session's main conversation file, from Kimi's index of sessions.
function wirePath(sessionId, home = os.homedir()) {
  try {
    for (const line of fs.readFileSync(path.join(home, '.kimi-code', 'session_index.jsonl'), 'utf8').split('\n').reverse()) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.sessionId === sessionId && r.sessionDir) return path.join(r.sessionDir, 'agents', 'main', 'wire.jsonl');
      } catch {}
    }
  } catch {}
  return null;
}
const transcript = wirePath(raw.session_id);

// The text of the last answer: the main agent's text parts after the last user prompt.
function lastAnswer() {
  let lines = [];
  try { lines = fs.readFileSync(transcript, 'utf8').split('\n'); } catch { return ''; }
  const parts = [];
  for (const l of lines) {
    let r;
    try { r = JSON.parse(l); } catch { continue; }
    if (r.type === 'turn.prompt') parts.length = 0;
    else if (r.type === 'context.append_loop_event' && r.event?.type === 'content.part' && r.event.part?.type === 'text') parts.push(r.event.part.text);
  }
  return parts.join('\n').trim();
}

// Runs one of the protocol hooks with a Claude Code-shaped payload; returns its JSON answer.
function run(script, payload) {
  const res = spawnSync(process.execPath, [path.join(here, script)], {
    input: JSON.stringify({ ...input, transcript_path: transcript, ...payload }), encoding: 'utf8', timeout: 25000, windowsHide: true,
  });
  try { return JSON.parse(res.stdout || '{}'); } catch { return {}; }
}
const contextOf = (out) => out.hookSpecificOutput?.additionalContext || '';

try {
  if (event === 'SessionStart') {
    const state = loadState(input.session_id);
    const ctx = contextOf(run('on-session-start.mjs', { hook_event_name: 'SessionStart', source: raw.source || 'startup' }));
    const after = loadState(input.session_id);
    after.kimiStartContext = ctx || state.kimiStartContext || '';
    saveState(input.session_id, after);
    done();
  } else if (event === 'UserPromptSubmit') {
    const prompt = Array.isArray(raw.prompt) ? raw.prompt.map((p) => p?.text || '').join('\n') : String(raw.prompt || '');
    let start = loadState(input.session_id).kimiStartContext || '';
    // No SessionStart seen (hooks installed mid-session): the session context comes now.
    if (!start && !loadState(input.session_id).sessionContext) start = contextOf(run('on-session-start.mjs', { hook_event_name: 'SessionStart', source: 'startup' }));
    const ctx = contextOf(run('on-prompt.mjs', { hook_event_name: 'UserPromptSubmit', prompt }));
    const state = loadState(input.session_id);
    state.kimiStartContext = '';
    saveState(input.session_id, state);
    done([start, ctx].filter(Boolean).join('\n\n'));
  } else if (event === 'PreToolUse') {
    const args = raw.tool_input || {};
    const out = run('on-edit-guard.mjs', { hook_event_name: 'PreToolUse', tool_name: raw.tool_name, tool_input: { file_path: args.path || args.file_path } });
    const h = out.hookSpecificOutput;
    done(h?.permissionDecision === 'deny' ? JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: h.permissionDecisionReason } }) : '');
  } else if (event === 'Stop') {
    run('on-stop.mjs', { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: lastAnswer() });
    done();
  }
  done();
} catch {
  done();
}
