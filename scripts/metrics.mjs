#!/usr/bin/env node
// What the protocol costs and saves, read from the Claude Code transcripts of the last days
// (~/.claude/projects/*/*.jsonl, subagent transcripts left out). No model call, no network.
//   - turns that only called the context CLI (each one re-reads the whole context), by command
//   - characters the hooks injected (session start + prompts), per session
//   - tokens: fresh input, cache reads, cache writes, output; the share of input read from cache
//   - test/build outputs the Bash hook summarized
// The weekly hygiene report carries these numbers; run by hand to check a change.
//   node metrics.mjs [--days 7] [--json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const CLI_CALL = /context-cli\.mjs"?\s+([a-z-]+)/;

function transcripts(home, since) {
  const base = path.join(home, '.claude', 'projects');
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(base); } catch { return out; }
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(path.join(base, d)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(base, d, f);
      try { if (fs.statSync(file).mtimeMs >= since) out.push(file); } catch {}
    }
  }
  return out;
}

// Adds one transcript record to the totals (m). Exported for the tests.
export function addRecord(m, rec, since, seen) {
  if (rec.timestamp && Date.parse(rec.timestamp) < since) return;
  if (rec.attachment?.type === 'hook_additional_context') {
    const text = [].concat(rec.attachment.content || []).join('\n');
    if (text.includes('[managing-system-context]')) m.hookChars += text.length;
    return;
  }
  if (rec.type === 'user' && Array.isArray(rec.message?.content)) {
    for (const b of rec.message.content) {
      const c = typeof b?.content === 'string' ? b.content : JSON.stringify(b?.content ?? '');
      if (b?.type === 'tool_result' && c.includes('saída resumida pelo hook')) m.quietRuns++;
    }
    return;
  }
  if (rec.type !== 'assistant' || !rec.message) return;
  // A message streamed in parts repeats its id and usage: count it once.
  const id = rec.message.id;
  const first = !id || !seen.has(id);
  if (id) seen.add(id);
  const u = rec.message.usage;
  if (first && u) {
    m.tokens.input += u.input_tokens || 0;
    m.tokens.cacheRead += u.cache_read_input_tokens || 0;
    m.tokens.cacheWrite += u.cache_creation_input_tokens || 0;
    m.tokens.output += u.output_tokens || 0;
  }
  const uses = (rec.message.content || []).filter((b) => b?.type === 'tool_use');
  if (!uses.length) return;
  const cli = uses.map((b) => CLI_CALL.exec(String(b.input?.command || ''))?.[1]).filter(Boolean);
  for (const c of cli) m.cliCalls[c] = (m.cliCalls[c] || 0) + 1;
  if (cli.length && cli.length === uses.length) m.cliOnlyTurns++;
}

export function emptyMetrics(days) {
  return { days, sessions: 0, hookChars: 0, quietRuns: 0, cliOnlyTurns: 0, cliCalls: {}, tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } };
}

export function finish(m) {
  const allInput = m.tokens.input + m.tokens.cacheRead + m.tokens.cacheWrite;
  return { ...m, cacheReadShare: allInput ? Math.round((m.tokens.cacheRead / allInput) * 1000) / 10 : 0, hookCharsPerSession: m.sessions ? Math.round(m.hookChars / m.sessions) : 0 };
}

export async function collect({ days = 7, home = os.homedir(), now = Date.now() } = {}) {
  const since = now - days * 24 * 60 * 60 * 1000;
  const m = emptyMetrics(days);
  for (const file of transcripts(home, since)) {
    m.sessions++;
    const seen = new Set();
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) {
      // Most lines are neither: skip them before parsing.
      if (!line.includes('"assistant"') && !line.includes('hook_additional_context') && !line.includes('saída resumida pelo hook')) continue;
      try { addRecord(m, JSON.parse(line), since, seen); } catch {}
    }
  }
  return finish(m);
}

const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
export function render(r) {
  const calls = Object.entries(r.cliCalls).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ') || 'nenhuma';
  return [
    `## Métricas dos últimos ${r.days} dias (transcripts do Claude Code)`,
    `- ${r.sessions} sessões · rodadas só de context-cli: ${r.cliOnlyTurns} (chamadas: ${calls})`,
    `- contexto injetado pelos hooks: ${k(r.hookChars)} caracteres, ${k(r.hookCharsPerSession)} por sessão`,
    `- tokens: entrada nova ${k(r.tokens.input)}, cache lido ${k(r.tokens.cacheRead)}, cache escrito ${k(r.tokens.cacheWrite)}, saída ${k(r.tokens.output)} · ${r.cacheReadShare}% da entrada veio do cache`,
    `- saídas de teste/build resumidas pelo hook: ${r.quietRuns}`,
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--days');
  const r = await collect({ days: i >= 0 ? Number(argv[i + 1]) || 7 : 7 });
  console.log(argv.includes('--json') ? JSON.stringify(r, null, 2) : render(r));
}
