import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addRecord, emptyMetrics, finish, collect, render } from '../scripts/metrics.mjs';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const at = (h) => new Date(NOW - h * 3600_000).toISOString();
const bash = (command) => ({ type: 'tool_use', name: 'Bash', input: { command } });
const assistant = (id, content, usage, h = 1) => ({ type: 'assistant', timestamp: at(h), message: { id, content, usage } });

test('CLI-only turns, CLI calls, hook context, cache share and summarized outputs are counted', () => {
  const m = emptyMetrics(7);
  const seen = new Set();
  const since = NOW - 7 * 86400_000;
  const usage = { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 90, output_tokens: 50 };
  for (const r of [
    assistant('m1', [bash('node .agents/skills/managing-system-context/scripts/context-cli.mjs upsert --project x --file -')], usage),
    assistant('m1', [{ type: 'text', text: 'parte repetida do mesmo id' }], usage),
    assistant('m2', [bash('node x/context-cli.mjs search boletim'), bash('npm test')], usage),
    assistant('m3', [bash('node x/context-cli.mjs get A')], usage, 24 * 9),
    { type: 'attachment', timestamp: at(1), attachment: { type: 'hook_additional_context', content: ['[managing-system-context] Projeto x · 1234'] } },
    { type: 'attachment', timestamp: at(1), attachment: { type: 'hook_additional_context', content: ['outro plugin'] } },
    { type: 'user', timestamp: at(1), message: { content: [{ type: 'tool_result', content: 'ok\n[saída resumida pelo hook (passou): 300 linhas no total em x.log; leia com Read]' }] } },
  ]) addRecord(m, r, since, seen);
  m.sessions = 1;
  const r = finish(m);
  assert.equal(r.cliOnlyTurns, 1, 'm2 also ran npm test; m3 is older than the window');
  assert.deepEqual(r.cliCalls, { upsert: 1, search: 1 });
  assert.equal(r.tokens.cacheRead, 1800, 'a message repeated by streaming counts once');
  assert.equal(r.cacheReadShare, 90);
  assert.equal(r.hookChars, '[managing-system-context] Projeto x · 1234'.length);
  assert.equal(r.quietRuns, 1);
  assert.match(render(r), /rodadas só de context-cli: 1 \(chamadas: upsert 1, search 1\)[\s\S]*90% da entrada veio do cache/);
});

test('collect reads the transcripts of the window, subagent folders left out', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, '.claude', 'projects', 'C--p');
  fs.mkdirSync(path.join(dir, 'abc', 'subagents'), { recursive: true });
  const line = JSON.stringify(assistant('m1', [bash('node context-cli.mjs upsert --x')], { input_tokens: 1, cache_read_input_tokens: 9, cache_creation_input_tokens: 0, output_tokens: 1 }));
  fs.writeFileSync(path.join(dir, 's1.jsonl'), `${line}\n`);
  fs.writeFileSync(path.join(dir, 'abc', 'subagents', 'a.jsonl'), `${line}\n`);
  const r = await collect({ days: 7, home, now: NOW });
  assert.equal(r.sessions, 1);
  assert.equal(r.cliOnlyTurns, 1);
});
