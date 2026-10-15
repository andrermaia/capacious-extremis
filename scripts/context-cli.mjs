#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultSchemaPath = path.resolve(__dirname, '../references/schema.sql');

// The shared knowledge base lives on the Takius server; the local SQLite file is
// only a read-only cache, refreshed by `pull`. Use --no-api to work fully offline.
const DEFAULT_API_URL = 'https://api.takius.com.br/v1/context';
const READ_COMMANDS = ['list-modules', 'query', 'get', 'list-tasks', 'search'];
// Knowledge every project shares (universal agent rules live in its "rules" module).
const GLOBAL_PROJECT = 'global';
const WRITE_COMMANDS = ['upsert', 'task-start', 'task-step', 'task-finish'];

// Raised by the CLI itself (bad flags, oversized summary) — never a connectivity problem.
class CliError extends Error {}

// Distinguishes "the server is unreachable/broken" from "the input is wrong":
// only the former may fall back to the local cache.
function isApiUnavailable(err) {
  if (err instanceof CliError) return false;
  const match = /^API error \((\d{3})\)/.exec(err.message || '');
  if (!match) return true; // fetch itself failed: DNS, TLS, timeout, refused
  const status = Number(match[1]);
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

// Flags that take no value. Without this list `--no-api query` would consume
// "query" as the flag's value and leave the CLI with no command at all.
const BOOLEAN_FLAGS = new Set(['no-api', 'import', 'help', 'all']);

// Same matching as the API's /search: lower case, no accents, one point per word found,
// ranked by where it was found (summary or id > module or feature > details).
const ACCENTED = 'áàâãäåéèêëíìîïóòôõöúùûüçñ';
const PLAIN = 'aaaaaaeeeeiiiiooooouuuucn';
function normText(text) {
  return String(text || '').toLowerCase().replace(/[^\x00-\x7f]/g, (c) => {
    const i = ACCENTED.indexOf(c);
    return i >= 0 ? PLAIN[i] : c;
  });
}

function searchTerms(q) {
  const terms = normText(q).replace(/[%_\\]/g, ' ').split(/\s+/).filter((t) => t.length >= 2);
  return [...new Set(terms)].slice(0, 8);
}

// `upsert --file <path|->`: a JSON array (or one object) of records, saved in one call
// instead of one CLI call per record. "-" reads stdin, so a heredoc needs no temp file.
function upsertItems(options) {
  if (!options.file) return null;
  const raw = options.file === '-' || options.file === true ? fs.readFileSync(0, 'utf8') : fs.readFileSync(options.file, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CliError(`upsert --file: invalid JSON (${err.message})`);
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (!list.length) throw new CliError('upsert --file: empty list');
  return list.map((r) => ({
    id: r.id,
    module: r.module,
    feature: r.feature,
    type: r.type || r.knowledge_type,
    phase: r.phase,
    progress: r.progress || r.tasks_progress || null,
    summary: r.summary,
    details: r.details || null,
  }));
}

const VALID_TYPES = ['architecture_decision', 'system_model', 'current_behavior', 'future_revision', 'technical_debt'];
const VALID_PHASES = ['implemented', 'in_progress', 'queued', 'deprioritized'];

function checkUpsert(item) {
  if (!item.id || !item.module || !item.feature || !item.type || !item.phase || !item.summary) {
    throw new CliError(`Missing required fields for upsert${item.id ? ` (${item.id})` : ''}: id, module, feature, type, phase, summary`);
  }
  if (item.summary.length > 250) {
    throw new CliError(`Summary exceeds maximum limit of 250 characters (got ${item.summary.length}${item.id ? `, ${item.id}` : ''}). Please keep summaries concise in English to minimize token consumption.`);
  }
  if (!VALID_TYPES.includes(item.type)) throw new CliError(`Invalid knowledge_type "${item.type}". Must be one of: ${VALID_TYPES.join(', ')}`);
  if (!VALID_PHASES.includes(item.phase)) throw new CliError(`Invalid phase "${item.phase}". Must be one of: ${VALID_PHASES.join(', ')}`);
  if (item.phase !== 'in_progress') item.progress = null;
}

function searchScope(options, projectId) {
  if (options.all) return [];
  return [...new Set([projectId, GLOBAL_PROJECT])];
}

function searchLocal(db, terms, scope, limit) {
  const inScope = (r) => !scope.length || scope.includes(r.project_id);
  const has = (text, t) => normText(text).includes(t);
  const knowledge = db.prepare('SELECT * FROM system_knowledge').all().filter(inScope).map((r) => {
    let hits = 0;
    let score = 0;
    for (const t of terms) {
      const top = has(r.summary, t) || has(r.id, t);
      const mid = has(r.module, t) || has(r.feature, t);
      const low = has(r.details, t);
      if (top || mid || low) hits += 1;
      score += top ? 3 : mid ? 2 : low ? 1 : 0;
    }
    const { details, ...row } = r;
    return { ...row, hits, score };
  }).filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.score - a.score || String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, limit);
  const tasks = db.prepare('SELECT * FROM agent_tasks').all().filter(inScope).map((r) => ({
    ...r, hits: terms.filter((t) => has(r.task_description, t) || has(r.current_step, t)).length,
  })).filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits || String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 5);
  return { query: terms.join(' '), scope: scope.length ? scope : 'all', knowledge, tasks };
}

function parseArgs(rawArgs) {
  const options = {
    args: []
  };
  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rawArgs[i + 1];
      if (next && !next.startsWith('--') && !BOOLEAN_FLAGS.has(key)) {
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

function getDatabase(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return new DatabaseSync(dbPath);
}

function initializeDatabase(db, schemaPath = defaultSchemaPath) {
  if (fs.existsSync(schemaPath)) {
    const ddl = fs.readFileSync(schemaPath, 'utf8');
    db.exec(ddl);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS system_knowledge (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        module TEXT NOT NULL,
        feature TEXT NOT NULL,
        knowledge_type TEXT NOT NULL CHECK (knowledge_type IN ('architecture_decision', 'system_model', 'current_behavior', 'future_revision', 'technical_debt')),
        phase TEXT NOT NULL CHECK (phase IN ('implemented', 'in_progress', 'queued', 'deprioritized')),
        tasks_progress TEXT DEFAULT NULL,
        summary TEXT NOT NULL,
        details TEXT DEFAULT NULL,
        updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_project_module ON system_knowledge(project_id, module);
      CREATE INDEX IF NOT EXISTS idx_knowledge_phase ON system_knowledge(project_id, phase);

      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        module TEXT NOT NULL,
        task_description TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'DONE', 'BLOCKED')),
        current_step TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON agent_tasks(project_id, status);
    `);
  }
}

async function requestApi(baseUrl, endpoint, options = {}, token = null) {
  const url = new URL(endpoint.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(options.headers || {})
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url.toString(), {
    ...options,
    headers
  });

  if (!res.ok) {
    let errorText = await res.text();
    try {
      const errJson = JSON.parse(errorText);
      errorText = errJson.message || errJson.error || errorText;
    } catch {}
    throw new Error(`API error (${res.status}): ${errorText}`);
  }

  return await res.json();
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const options = parseArgs(rawArgs);

  const command = options.args[0] || 'help';
  const apiUrl = options['no-api'] ? null : (options['api-url'] || process.env.CONTEXT_API_URL || DEFAULT_API_URL);
  const apiToken = options['api-token'] || process.env.CONTEXT_API_TOKEN;
  const dbPath = options['db-path'] || process.env.CONTEXT_DB_PATH || path.resolve(process.cwd(), '.agents/context.db');
  const projectId = options.project || process.env.PROJECT_ID || path.basename(process.cwd());

  // === LOCAL CACHE REFRESH ===
  // Mirrors the whole server database into the local SQLite file, so a read still
  // works (with a warning) when the API is down.
  if (command === 'pull') {
    if (!apiUrl) throw new Error('"pull" needs the Context API; do not pass --no-api.');
    const data = await requestApi(apiUrl, 'export', {}, apiToken);
    const cache = getDatabase(dbPath);
    initializeDatabase(cache);
    cache.exec('BEGIN');
    try {
      cache.exec('DELETE FROM system_knowledge; DELETE FROM agent_tasks;');
      const insertKnowledge = cache.prepare(`
        INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of data.system_knowledge) {
        insertKnowledge.run(r.id, r.project_id, r.module, r.feature, r.knowledge_type, r.phase, r.tasks_progress, r.summary, r.details, r.updated_at);
      }
      const insertTask = cache.prepare(`
        INSERT INTO agent_tasks (id, project_id, module, task_description, status, current_step, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of data.agent_tasks) {
        insertTask.run(r.id, r.project_id, r.module, r.task_description, r.status, r.current_step, r.created_at, r.updated_at);
      }
      cache.exec('COMMIT');
    } catch (err) {
      cache.exec('ROLLBACK');
      throw err;
    }
    console.log(JSON.stringify({
      status: 'ok',
      cache: dbPath,
      system_knowledge: data.system_knowledge.length,
      agent_tasks: data.agent_tasks.length,
      exported_at: data.exported_at
    }, null, 2));
    return;
  }

  // === REMOTE HTTP API ADAPTER ===
  if (apiUrl) {
    try {
    switch (command) {
      case 'init': {
        console.log(JSON.stringify({
          status: 'ok',
          message: 'Connected to remote Context API',
          apiUrl,
          project: projectId
        }, null, 2));
        return;
      }

      case 'list-modules': {
        const data = await requestApi(apiUrl, `modules?project=${encodeURIComponent(projectId)}`, {}, apiToken);
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      case 'query': {
        let qs = `query?project=${encodeURIComponent(projectId)}`;
        if (options.module) qs += `&module=${encodeURIComponent(options.module)}`;
        if (options.phase) qs += `&phase=${encodeURIComponent(options.phase)}`;
        if (options.type) qs += `&type=${encodeURIComponent(options.type)}`;

        const data = await requestApi(apiUrl, qs, {}, apiToken);
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      case 'get': {
        const id = options.args[1] || options.id;
        if (!id) throw new CliError('Missing record ID for "get" command.');
        const data = await requestApi(apiUrl, `knowledge/${encodeURIComponent(id)}?project=${encodeURIComponent(projectId)}`, {}, apiToken);
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      case 'upsert': {
        const batch = upsertItems(options);
        if (batch) {
          batch.forEach(checkUpsert);
          const results = [];
          for (const item of batch) {
            const data = await requestApi(apiUrl, `upsert?project=${encodeURIComponent(projectId)}`, {
              method: 'POST',
              body: JSON.stringify({
                id: item.id, project_id: projectId, module: item.module, feature: item.feature, knowledge_type: item.type,
                phase: item.phase, tasks_progress: item.progress, summary: item.summary, details: item.details,
              }),
            }, apiToken);
            results.push({ id: item.id, action: data.action });
          }
          console.log(JSON.stringify({ status: 'ok', count: results.length, results }, null, 2));
          return;
        }
        const id = options.id || options.args[1];
        const summary = options.summary;
        if (summary && summary.length > 250) {
          throw new CliError(`Summary exceeds maximum limit of 250 characters (got ${summary.length}). Please keep summaries concise in English to minimize token consumption.`);
        }

        const body = {
          id,
          project_id: projectId,
          module: options.module,
          feature: options.feature,
          knowledge_type: options.type || options.knowledge_type,
          phase: options.phase,
          tasks_progress: options.progress || options.tasks_progress || null,
          summary,
          details: options.details || null
        };

        const data = await requestApi(apiUrl, `upsert?project=${encodeURIComponent(projectId)}`, {
          method: 'POST',
          body: JSON.stringify(body)
        }, apiToken);
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      case 'task-start': {
        const body = {
          id: options.id,
          project_id: projectId,
          module: options.module || 'general',
          desc: options.desc || options.description || 'Unnamed task'
        };
        const data = await requestApi(apiUrl, `tasks/start?project=${encodeURIComponent(projectId)}`, {
          method: 'POST',
          body: JSON.stringify(body)
        }, apiToken);
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      case 'task-step': {
        const body = {
          id: options.id,
          step: options.step,
          project_id: projectId
        };
        const data = await requestApi(apiUrl, `tasks/step?project=${encodeURIComponent(projectId)}`, {
          method: 'POST',
          body: JSON.stringify(body)
        }, apiToken);
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      case 'task-finish': {
        const body = {
          id: options.id,
          status: (options.status || 'DONE').toUpperCase(),
          project_id: projectId
        };
        const data = await requestApi(apiUrl, `tasks/finish?project=${encodeURIComponent(projectId)}`, {
          method: 'POST',
          body: JSON.stringify(body)
        }, apiToken);
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      case 'list-tasks': {
        let qs = `tasks?project=${encodeURIComponent(projectId)}`;
        if (options.status) qs += `&status=${encodeURIComponent(options.status.toUpperCase())}`;
        if (options.limit) qs += `&limit=${encodeURIComponent(options.limit)}`;

        const data = await requestApi(apiUrl, qs, {}, apiToken);
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      case 'search': {
        const q = options.args.slice(1).join(' ') || options.q || '';
        if (!searchTerms(q).length) throw new CliError('Usage: search <words> [--project <p>] [--all] [--limit <n>]');
        let qs = `search?q=${encodeURIComponent(q)}`;
        const scope = searchScope(options, projectId);
        if (scope.length) qs += `&project=${encodeURIComponent(scope.join(','))}`;
        if (options.limit) qs += `&limit=${encodeURIComponent(options.limit)}`;
        const data = await requestApi(apiUrl, qs, {}, apiToken);
        console.log(JSON.stringify(data, null, 2));
        return;
      }
    }
    } catch (err) {
      // A rejected payload (400/401/403/404-on-record) is the agent's fault: surface it.
      if (!isApiUnavailable(err)) throw err;
      if (WRITE_COMMANDS.includes(command)) {
        throw new Error(
          `Context API unavailable (${err.message}). Write refused: the server is the source of truth, ` +
          `and writing to the local cache would diverge in silence. Retry, or pass --no-api to work offline on purpose.`
        );
      }
      process.stderr.write(
        `[context-cli] Context API unavailable (${err.message}); reading the local cache at ${dbPath}, ` +
        `which may be stale. Run "pull" once the API is back.\n`
      );
    }
  }

  // === LOCAL SQLITE ADAPTER (Default) ===
  const db = getDatabase(dbPath);

  switch (command) {
    case 'init': {
      initializeDatabase(db);
      console.log(JSON.stringify({
        status: 'ok',
        message: 'Database initialized successfully',
        dbPath,
        project: projectId
      }, null, 2));
      break;
    }

    case 'list-modules': {
      initializeDatabase(db);
      const rows = db.prepare(`
        SELECT 
          module,
          COUNT(*) as total_count,
          SUM(CASE WHEN phase = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
          SUM(CASE WHEN phase = 'implemented' THEN 1 ELSE 0 END) as implemented_count
        FROM system_knowledge 
        WHERE project_id = ? 
        GROUP BY module 
        ORDER BY module ASC
      `).all(projectId);
      console.log(JSON.stringify(rows, null, 2));
      break;
    }

    case 'query': {
      initializeDatabase(db);
      let query = `
        SELECT id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, updated_at 
        FROM system_knowledge 
        WHERE project_id = ?
      `;
      const params = [projectId];

      if (options.module) {
        query += ' AND module = ?';
        params.push(options.module);
      }
      if (options.phase) {
        query += ' AND phase = ?';
        params.push(options.phase);
      }
      if (options.type) {
        query += ' AND knowledge_type = ?';
        params.push(options.type);
      }
      query += ' ORDER BY updated_at DESC';

      const rows = db.prepare(query).all(...params);
      console.log(JSON.stringify(rows, null, 2));
      break;
    }

    case 'get': {
      initializeDatabase(db);
      const id = options.args[1] || options.id;
      if (!id) {
        throw new CliError('Missing record ID for "get" command.');
      }
      const row = db.prepare(`SELECT * FROM system_knowledge WHERE project_id = ? AND id = ?`).get(projectId, id);
      if (!row) {
        console.log(JSON.stringify({ error: 'Not found', id }, null, 2));
        process.exitCode = 1;
      } else {
        console.log(JSON.stringify(row, null, 2));
      }
      break;
    }

    case 'upsert': {
      initializeDatabase(db);
      const batch = upsertItems(options);
      if (batch) {
        batch.forEach(checkUpsert);
        const stmt = db.prepare(`
          INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            module = excluded.module, feature = excluded.feature, knowledge_type = excluded.knowledge_type,
            phase = excluded.phase, tasks_progress = excluded.tasks_progress, summary = excluded.summary,
            details = COALESCE(excluded.details, system_knowledge.details), updated_at = excluded.updated_at
        `);
        const now = new Date().toISOString();
        for (const i of batch) stmt.run(i.id, projectId, i.module, i.feature, i.type, i.phase, i.progress, i.summary, i.details, now);
        console.log(JSON.stringify({ status: 'ok', count: batch.length, results: batch.map((i) => ({ id: i.id, action: 'upserted' })) }, null, 2));
        break;
      }
      const id = options.id || options.args[1];
      const module = options.module;
      const feature = options.feature;
      const knowledgeType = options.type || options.knowledge_type;
      const phase = options.phase;
      const progress = options.progress || options.tasks_progress || null;
      const summary = options.summary;
      const details = options.details || null;

      if (!id || !module || !feature || !knowledgeType || !phase || !summary) {
        throw new Error('Missing required fields for upsert: --id, --module, --feature, --type, --phase, --summary');
      }

      if (summary.length > 250) {
        throw new CliError(`Summary exceeds maximum limit of 250 characters (got ${summary.length}). Please keep summaries concise in English to minimize token consumption.`);
      }

      const validTypes = ['architecture_decision', 'system_model', 'current_behavior', 'future_revision', 'technical_debt'];
      if (!validTypes.includes(knowledgeType)) {
        throw new Error(`Invalid knowledge_type "${knowledgeType}". Must be one of: ${validTypes.join(', ')}`);
      }

      const validPhases = ['implemented', 'in_progress', 'queued', 'deprioritized'];
      if (!validPhases.includes(phase)) {
        throw new Error(`Invalid phase "${phase}". Must be one of: ${validPhases.join(', ')}`);
      }

      const now = new Date().toISOString();

      const stmt = db.prepare(`
        INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          module = excluded.module,
          feature = excluded.feature,
          knowledge_type = excluded.knowledge_type,
          phase = excluded.phase,
          tasks_progress = excluded.tasks_progress,
          summary = excluded.summary,
          details = COALESCE(excluded.details, system_knowledge.details),
          updated_at = excluded.updated_at
      `);

      stmt.run(id, projectId, module, feature, knowledgeType, phase, progress, summary, details, now);
      console.log(JSON.stringify({ status: 'ok', id, action: 'upserted' }, null, 2));
      break;
    }

    case 'task-start': {
      initializeDatabase(db);
      const module = options.module || 'general';
      const desc = options.desc || options.description || 'Unnamed task';
      const id = options.id || `TASK-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
      const now = new Date().toISOString();

      const stmt = db.prepare(`
        INSERT INTO agent_tasks (id, project_id, module, task_description, status, current_step, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'IN_PROGRESS', 'Task started', ?, ?)
      `);

      stmt.run(id, projectId, module, desc, now, now);
      console.log(JSON.stringify({ status: 'ok', id, module, status: 'IN_PROGRESS' }, null, 2));
      break;
    }

    case 'task-step': {
      initializeDatabase(db);
      const id = options.id;
      const step = options.step;
      if (!id || !step) {
        throw new Error('Missing --id or --step for task-step');
      }
      const now = new Date().toISOString();
      const stmt = db.prepare(`
        UPDATE agent_tasks 
        SET current_step = ?, updated_at = ? 
        WHERE id = ? AND project_id = ?
      `);
      stmt.run(step, now, id, projectId);
      console.log(JSON.stringify({ status: 'ok', id, step }, null, 2));
      break;
    }

    case 'task-finish': {
      initializeDatabase(db);
      const id = options.id;
      const status = (options.status || 'DONE').toUpperCase();
      if (!id) {
        throw new Error('Missing --id for task-finish');
      }
      if (!['DONE', 'BLOCKED'].includes(status)) {
        throw new Error('Status for task-finish must be DONE or BLOCKED');
      }
      const now = new Date().toISOString();
      const stmt = db.prepare(`
        UPDATE agent_tasks 
        SET status = ?, updated_at = ? 
        WHERE id = ? AND project_id = ?
      `);
      stmt.run(status, now, id, projectId);
      console.log(JSON.stringify({ status: 'ok', id, task_status: status }, null, 2));
      break;
    }

    case 'list-tasks': {
      initializeDatabase(db);
      let query = `SELECT * FROM agent_tasks WHERE project_id = ?`;
      const params = [projectId];
      if (options.status) {
        query += ' AND status = ?';
        params.push(options.status.toUpperCase());
      }
      query += ' ORDER BY updated_at DESC LIMIT ?';
      params.push(options.limit ? parseInt(options.limit, 10) : 20);

      const rows = db.prepare(query).all(...params);
      console.log(JSON.stringify(rows, null, 2));
      break;
    }

    case 'search': {
      initializeDatabase(db);
      const terms = searchTerms(options.args.slice(1).join(' ') || options.q || '');
      if (!terms.length) throw new CliError('Usage: search <words> [--project <p>] [--all] [--limit <n>]');
      const limit = Math.min(parseInt(options.limit, 10) || 15, 50);
      console.log(JSON.stringify(searchLocal(db, terms, searchScope(options, projectId), limit), null, 2));
      break;
    }

    case 'help':
    default: {
      console.log(JSON.stringify({
        description: 'Managing System Context CLI',
        usage: 'node context-cli.mjs <command> [options]',
        commands: [
          'init',
          'list-modules',
          'query --module <m> [--phase <p>] [--type <t>]',
          'get <id>',
          'upsert --id <id> --module <m> --feature <f> --type <t> --phase <p> [--progress <XX/YY>] --summary "<text>" [--details "<text>"]',
          'upsert --file <path|->   (JSON array of {id, module, feature, type, phase, progress?, summary, details?}; - reads stdin)',
          'task-start --module <m> --desc "<description>"',
          'task-step --id <id> --step "<step>"',
          'task-finish --id <id> [--status DONE|BLOCKED]',
          'list-tasks [--status <s>]',
          'search <words> [--all] [--limit <n>]   (this project + global; --all spans every project)',
          'pull   (refresh the local read-only cache from the API)'
        ],
        target: `${DEFAULT_API_URL} by default; --no-api forces the local SQLite cache`,
        auth: 'CONTEXT_API_TOKEN (or --api-token) is required by the API'
      }, null, 2));
      break;
    }
  }
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message }, null, 2));
  process.exit(1);
});
