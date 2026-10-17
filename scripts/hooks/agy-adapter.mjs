#!/usr/bin/env node
// Antigravity CLI (agy) adapter for the protocol hooks. agy sends its own payload (camelCase,
// workspacePaths, transcriptPath), has no prompt event, and of its injectSteps only an
// ephemeralMessage reaches the model, for that turn only (measured 17/10/2026 on agy 1.4.0:
// userMessage and systemMessage were dropped and took the rest of the array with them).
// So each agy event runs the Claude Code hook it stands for and passes its context on:
//   SessionStart                  -> on-session-start.mjs
//   PreInvocation, a new prompt   -> on-prompt.mjs (the prompt read from the transcript)
//   PreInvocation, same turn      -> the open task's line again (the ephemeral one is gone)
//   Stop                          -> on-stop.mjs (the last answer read from the transcript)
// It never blocks agy: any failure answers with nothing to change.
// In ~/.gemini/config/hooks.json: node <skill>/scripts/hooks/agy-adapter.mjs <Event>
// (agy does not parse quotes in a hook command: the path must have no spaces).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStdinJson, emit, projectRoot, loadState, saveState, openTasks } from './hook-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const event = process.argv[2];
const raw = readStdinJson();
const nothing = () => { emit({}); process.exit(0); };

const cwd = (raw.workspacePaths || [])[0];
const input = { session_id: `agy-${raw.conversationId || 'unknown'}`, cwd };
if (!cwd || !raw.conversationId || !projectRoot(input)) nothing();

// The conversation's steps, from agy's JSONL transcript (one step per line).
function steps() {
  try {
    return fs.readFileSync(raw.transcriptPath, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l)]; } catch { return []; }
    });
  } catch {
    return [];
  }
}
const lastPrompt = (all) => all.filter((s) => s.type === 'USER_INPUT' && s.source === 'USER_EXPLICIT').at(-1);
const promptText = (step) => {
  const text = String(step?.content || '');
  return (/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/.exec(text)?.[1] ?? text).trim();
};
const lastAnswer = (all) => String(all.filter((s) => s.source === 'MODEL' && s.type === 'PLANNER_RESPONSE' && s.content).at(-1)?.content || '');

// Runs one of the protocol hooks with a Claude Code-shaped payload; returns its JSON answer.
function run(script, payload) {
  const res = spawnSync(process.execPath, [path.join(here, script)], {
    input: JSON.stringify({ ...input, ...payload }), encoding: 'utf8', timeout: 25000, windowsHide: true,
  });
  try { return JSON.parse(res.stdout || '{}'); } catch { return {}; }
}
const inject = (text) => (text ? emit({ injectSteps: [{ ephemeralMessage: text }] }) : emit({}));
const taskLine = (state) => {
  const task = openTasks(state).at(-1);
  return task ? `[managing-system-context] Tarefa ${task.id} (módulo ${task.module}) aberta pelo hook; ele a fecha ao fim do turno.` : '';
};

try {
  if (event === 'SessionStart') {
    inject(run('on-session-start.mjs', { hook_event_name: 'SessionStart', source: 'startup' }).hookSpecificOutput?.additionalContext);
  } else if (event === 'PreInvocation') {
    const step = lastPrompt(steps());
    const seen = loadState(input.session_id).agyPromptStep;
    if (step && step.step_index !== seen) {
      const out = run('on-prompt.mjs', { hook_event_name: 'UserPromptSubmit', prompt: promptText(step) });
      const state = loadState(input.session_id);
      state.agyPromptStep = step.step_index;
      saveState(input.session_id, state);
      inject(out.hookSpecificOutput?.additionalContext);
    } else {
      inject(taskLine(loadState(input.session_id)));
    }
  } else if (event === 'Stop') {
    run('on-stop.mjs', { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: lastAnswer(steps()), transcript_path: null });
    emit({});
  } else {
    emit({});
  }
} catch {
  emit({});
}
