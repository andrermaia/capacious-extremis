// Where the shared knowledge-base API lives. Never hard-coded: this repository is public, so
// the address comes from the machine's own configuration, like the token. Order:
//   1. the environment (CONTEXT_API_URL);
//   2. the "env" block of the Claude Code settings of the projects root, found from the skill's
//      own folder (<root>/.agents/skills/managing-system-context) or from the working directory
//      upwards: .claude/settings.local.json, then .claude/settings.json;
//   3. the "env" block of ~/.claude/settings.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function fromSettings(file, key) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).env?.[key] || null;
  } catch {
    return null;
  }
}

// The working folder and its parents, up to (not including) the home folder, read last.
function ancestors(start, home) {
  const out = [];
  let dir = path.resolve(start);
  for (;;) {
    if (path.resolve(home).toLowerCase() === dir.toLowerCase()) return out;
    out.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) return out;
    dir = parent;
  }
}

export function configuredEnv(key, { cwd = process.cwd(), home = os.homedir() } = {}) {
  if (process.env[key]) return process.env[key];
  // Installed as <root>/.agents/skills/managing-system-context/scripts: <root> holds the settings.
  const parts = here.split(path.sep);
  const installed = parts.slice(-4).join('/') === '.agents/skills/managing-system-context/scripts';
  const skillRoot = installed ? parts.slice(0, -4).join(path.sep) : null;
  for (const dir of [...new Set([skillRoot, ...ancestors(cwd, home)].filter(Boolean))]) {
    for (const name of ['settings.local.json', 'settings.json']) {
      const value = fromSettings(path.join(dir, '.claude', name), key);
      if (value) return value;
    }
  }
  return fromSettings(path.join(home, '.claude', 'settings.json'), key);
}

export const configuredApiUrl = (opts) => {
  const url = configuredEnv('CONTEXT_API_URL', opts);
  return url ? String(url).replace(/\/$/, '') : null;
};

export const MISSING_API_URL = 'CONTEXT_API_URL not configured: set it in the environment or in the "env" block of '
  + '<projects root>/.claude/settings.local.json (or ~/.claude/settings.json), next to CONTEXT_API_TOKEN.';
