#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.vscode',
  '.idea',
  'dist',
  'build',
  'coverage',
  '.superpowers',
  '.agents',
  '.claude'
]);

function parseArgs(rawArgs) {
  const options = { args: [] };
  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rawArgs[i + 1];
      if (next && !next.startsWith('--')) {
        options[key] = next;
        i += 2;
      } else {
        options[key] = true;
        i += 1;
      }
    } else {
      options.args.push(arg);
      i += 1;
    }
  }
  return options;
}

function truncateSummary(text, max = 250) {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function scanDirectory(targetDir, projectId) {
  const records = [];
  const discoveredModules = new Map(); // moduleName -> { files: [], configs: [] }

  // 1. Check root configuration files
  const pkgPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = Object.keys(pkg.dependencies || {}).slice(0, 8).join(', ');
      const summary = truncateSummary(
        `Node.js project (${pkg.name || projectId}). Dependencies: ${deps || 'none'}.`
      );
      records.push({
        id: 'SYS-CORE-001',
        project_id: projectId,
        module: 'core',
        feature: 'project_setup',
        knowledge_type: 'system_model',
        phase: 'implemented',
        tasks_progress: null,
        summary,
        details: JSON.stringify({ scripts: pkg.scripts, dependencies: pkg.dependencies }, null, 2),
        updated_at: new Date().toISOString()
      });
    } catch {
      // ignore parse error
    }
  }

  // 2. Discover modules from root and src directories
  function explore(currentDir, relativePrefix = '') {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.join(relativePrefix, entry.name).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        // If directory is inside src/ or root, consider it a module candidate
        const parts = relPath.split('/');
        let modName = null;
        if (parts.length === 1 && !['src', 'app', 'lib', 'tests', 'docs'].includes(parts[0])) {
          modName = parts[0];
        } else if ((parts[0] === 'src' || parts[0] === 'app' || parts[0] === 'lib') && parts.length === 2) {
          modName = parts[1];
        }

        if (modName) {
          if (!discoveredModules.has(modName)) {
            discoveredModules.set(modName, { files: [], path: relPath });
          }
        }
        explore(fullPath, relPath);
      } else if (entry.isFile()) {
        // Associate file with matching module
        for (const [modName, modInfo] of discoveredModules.entries()) {
          if (relPath.startsWith(modInfo.path + '/') && modInfo.files.length < 10) {
            modInfo.files.push(path.basename(relPath));
          }
        }
      }
    }
  }

  explore(targetDir);

  // 3. Create records for discovered modules
  let counter = 1;
  for (const [modName, info] of discoveredModules.entries()) {
    const fileList = info.files.length > 0 ? info.files.join(', ') : 'directories and assets';
    const summary = truncateSummary(
      `Discovered module "${modName}" at "${info.path}". Key files: ${fileList}.`
    );

    const paddedIndex = String(counter++).padStart(3, '0');
    records.push({
      id: `MOD-${modName.toUpperCase().replace(/[^A-Z0-9]/g, '')}-${paddedIndex}`,
      project_id: projectId,
      module: modName,
      feature: 'module_overview',
      knowledge_type: 'current_behavior',
      phase: 'implemented',
      tasks_progress: null,
      summary,
      details: `Module located at ${info.path}.\nFiles: ${info.files.join(', ')}`,
      updated_at: new Date().toISOString()
    });
  }

  return records;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const targetDir = path.resolve(options.target || process.cwd());
  const projectId = options.project || path.basename(targetDir);

  const records = scanDirectory(targetDir, projectId);

  // Optional: save draft to file
  if (options['save-draft']) {
    const draftPath = typeof options['save-draft'] === 'string'
      ? path.resolve(options['save-draft'])
      : path.resolve(targetDir, '.agents/bootstrap-draft.json');
    const dir = path.dirname(draftPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(draftPath, JSON.stringify(records, null, 2), 'utf8');
  }

  // Optional: import directly into DB
  if (options.import && options['db-path']) {
    const db = new DatabaseSync(path.resolve(options['db-path']));
    const stmt = db.prepare(`
      INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module = excluded.module,
        feature = excluded.feature,
        knowledge_type = excluded.knowledge_type,
        phase = excluded.phase,
        summary = excluded.summary,
        details = excluded.details,
        updated_at = excluded.updated_at
    `);
    for (const item of records) {
      stmt.run(
        item.id,
        item.project_id,
        item.module,
        item.feature,
        item.knowledge_type,
        item.phase,
        item.tasks_progress,
        item.summary,
        item.details,
        item.updated_at
      );
    }
  }

  console.log(JSON.stringify(records, null, 2));
}

try {
  main();
} catch (err) {
  console.error(JSON.stringify({ error: err.message }, null, 2));
  process.exit(1);
}
