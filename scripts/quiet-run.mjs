#!/usr/bin/env node
// Summarizes the output of a test or build command that the PreToolUse hook (on-bash.mjs) sent
// to a log file: the model gets the failures and the last lines, plus the log's path to read
// the rest with Read/grep when it needs it. The command itself ran in the agent's own shell;
// its exit code is passed through by the rewritten command, not by this script.
//   node quiet-run.mjs <log file> <exit code>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The commands the hook rewrites, and how (see on-bash.mjs).
export const RUNNER = /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck|check)(?::[\w-]+)?|npx\s+(?:vitest|jest|tsc|eslint|playwright\s+test)|node\s+--test|cargo\s+(?:test|build|check|clippy)|go\s+(?:test|build|vet)|dotnet\s+(?:test|build)|mvn|gradle|\.\/gradlew|pytest|python3?\s+-m\s+pytest)\b[^|;&<>`$\n]*$/;

export function quietCommand(command, log, summarizer) {
  const q = (p) => `"${p.split(path.sep).join('/')}"`;
  return `( ${command.trim()} ) > ${q(log)} 2>&1; __code=$?; node ${q(summarizer)} ${q(log)} $__code; exit $__code`;
}

// Up to this many lines the output is shown whole: nothing to gain by cutting it.
export const WHOLE = 60;
const FAILURE = /\b(FAIL(ED|URE)?|ERROR|Error|error(\[|:| TS)|failed|AssertionError|panicked|Traceback|not ok|Expected|expected)\b|✖|✗|×/;

export function summarize(text, code) {
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\x1b\[[0-9;]*m/g, '').split('\n');
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  if (lines.length <= WHOLE) return { lines, cut: false };
  if (Number(code) === 0) return { lines: lines.slice(-15), cut: true };
  // Each failure line with the two after it (the message under a FAIL header), no repeats, at most 150.
  const keep = new Set();
  lines.forEach((l, i) => { if (FAILURE.test(l)) for (let j = i; j <= Math.min(i + 2, lines.length - 1); j++) keep.add(j); });
  const picked = [...keep].sort((a, b) => a - b).slice(0, 150);
  for (let i = Math.max(0, lines.length - 25); i < lines.length; i++) picked.push(i);
  const out = [];
  let last = -1;
  for (const i of [...new Set(picked)].sort((a, b) => a - b)) {
    if (i > last + 1) out.push('…');
    out.push(lines[i]);
    last = i;
  }
  return { lines: out, cut: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, code] = process.argv.slice(2);
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch {}
  const total = text ? text.replace(/\n+$/, '').split('\n').length : 0;
  const { lines, cut } = summarize(text, code);
  if (lines.length) console.log(lines.join('\n'));
  if (cut) console.log(`[saída resumida pelo hook (${Number(code) === 0 ? 'passou' : `código ${code}`}): ${total} linhas no total em ${file.split(path.sep).join('/')}; leia com Read ou grep se precisar de mais]`);
}
