import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { turnCliCalls, finalAnswer } from '../scripts/hooks/hook-lib.mjs';

const UPSERT = 'node .agents/skills/managing-system-context/scripts/context-cli.mjs upsert --project louza --file - <<EOF\n[{"id":"LOUZA-X-1","summary":"s"}]\nEOF';
const OK = '{"status":"ok","results":[{"id":"LOUZA-X-1","action":"inserted"}]}';

function file(t, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stopfmt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = path.join(dir, 't.jsonl');
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return f;
}

test('Codex: the turn\'s upsert, edited files and last answer are read from the rollout', (t) => {
  const item = (it) => ({ type: 'event_msg', payload: { type: 'item_completed', item: it } });
  const f = file(t, [
    item({ type: 'UserMessage', content: [{ type: 'text', text: 'antes' }] }),
    item({ id: 'c0', type: 'CommandExecution', command: ['powershell.exe', '-Command', UPSERT.replace('LOUZA-X-1', 'OLD-1')], aggregated_output: OK, exit_code: 0 }),
    item({ type: 'UserMessage', content: [{ type: 'text', text: 'ajuste o boletim' }] }),
    item({ id: 'f1', type: 'FileChange', changes: { 'C:/p/louza/src/boletim.ts': { type: 'update' } }, status: 'completed' }),
    item({ id: 'c1', type: 'CommandExecution', command: ['powershell.exe', '-Command', UPSERT], aggregated_output: OK, exit_code: 0 }),
    item({ type: 'AgentMessage', content: [{ type: 'Text', text: 'Boletim ajustado.' }], phase: 'final_answer' }),
  ]);
  const r = turnCliCalls({ transcript_path: f });
  assert.equal(r.upserts, 1);
  assert.deepEqual(r.edited, ['C:/p/louza/src/boletim.ts']);
  assert.deepEqual(r.upserted, [{ project: 'louza', ids: ['LOUZA-X-1'] }]);
  assert.equal(finalAnswer({ transcript_path: f }), 'Boletim ajustado.');
});

test('agy: calls pair with the GENERIC steps that answer them; a failed upsert counts zero', (t) => {
  const f = file(t, [
    { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: '<USER_REQUEST>ajuste</USER_REQUEST>' },
    { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'edit_file', args: { AbsolutePath: '"C:/p/louza/a.ts"' } }, { name: 'run_command', args: { CommandLine: JSON.stringify(UPSERT) } }] },
    { step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'DONE', content: 'edited' },
    { step_index: 3, source: 'MODEL', type: 'GENERIC', status: 'DONE', content: 'Exit code 1\n{"error":"Summary exceeds 250"}' },
    { step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Feito em parte.' },
  ]);
  const r = turnCliCalls({ transcript_path: f });
  assert.equal(r.upserts, 0);
  assert.equal(r.toolUses, 2);
  assert.deepEqual(r.edited, ['C:/p/louza/a.ts']);
  assert.equal(finalAnswer({ transcript_path: f }), 'Feito em parte.');
});

test('Kimi: tool.call and tool.result pair by toolCallId; the answer parts of the turn join', (t) => {
  const ev = (event) => ({ type: 'context.append_loop_event', agentId: 'main', event });
  const f = file(t, [
    { type: 'turn.prompt', agentId: 'main', input: [{ type: 'text', text: 'revise' }], origin: { kind: 'user' } },
    ev({ type: 'tool.call', toolCallId: 'k1', name: 'Edit', args: { path: 'C:/p/louza/b.ts' } }),
    ev({ type: 'tool.result', toolCallId: 'k1', result: { output: 'ok' } }),
    ev({ type: 'tool.call', toolCallId: 'k2', name: 'Bash', args: { command: UPSERT } }),
    ev({ type: 'tool.result', toolCallId: 'k2', result: { output: OK } }),
    ev({ type: 'content.part', part: { type: 'text', text: 'Revisado.' } }),
    ev({ type: 'content.part', part: { type: 'text', text: 'Nota gravada.' } }),
  ]);
  const r = turnCliCalls({ transcript_path: f });
  assert.equal(r.upserts, 1);
  assert.deepEqual(r.edited, ['C:/p/louza/b.ts']);
  assert.equal(finalAnswer({ transcript_path: f }), 'Revisado.\nNota gravada.');
});
