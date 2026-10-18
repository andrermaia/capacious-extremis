import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// On Windows a console program started by a process without a console (the hooks' background jobs run
// detached, with no console at all) opens its own window: every git call of ingest-commits flashed a
// Windows Terminal window, hundreds of them after logon. Every child process the skill starts must pass
// windowsHide: true.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CALL = /\b(execFileSync|execFile|spawnSync|spawn|execSync)\(/g;

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return e.name.endsWith('.mjs') ? [full] : [];
  });
}

/** The text of a call up to its closing parenthesis (strings and nesting are rare enough here). */
function callText(src, start) {
  let depth = 0;
  for (let i = src.indexOf('(', start); i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

test('every child process of the skill hides its window (windowsHide: true)', () => {
  const missing = [];
  for (const file of [...sources(path.join(root, 'scripts')), ...sources(path.join(root, 'cloud'))]) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/node:child_process/.test(src)) continue;
    for (const m of src.matchAll(CALL)) {
      if (/import\s*\{[^}]*$/.test(src.slice(Math.max(0, m.index - 80), m.index))) continue;
      const call = callText(src, m.index);
      if (!/windowsHide:\s*true/.test(call)) {
        const line = src.slice(0, m.index).split('\n').length;
        missing.push(`${path.relative(root, file)}:${line} ${m[1]}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
