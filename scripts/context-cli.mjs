#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultSchemaPath = path.resolve(__dirname, '../references/schema.sql');

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
    // Fallback embedded schema if file is moved
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

function main() {
  const rawArgs = process.argv.slice(2);
  const options = parseArgs(rawArgs);

  const command = options.args[0] || 'help';
  const dbPath = options['db-path'] || process.env.CONTEXT_DB_PATH || path.resolve(process.cwd(), '.agents/context.db');
  const projectId = options.project || process.env.PROJECT_ID || path.basename(process.cwd());

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
        throw new Error('Missing record ID for "get" command.');
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
        throw new Error(`Summary exceeds maximum limit of 250 characters (got ${summary.length}). Please keep summaries concise in English to minimize token consumption.`);
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
          'task-start --module <m> --desc "<description>"',
          'task-step --id <id> --step "<step>"',
          'task-finish --id <id> [--status DONE|BLOCKED]',
          'list-tasks [--status <s>]'
        ]
      }, null, 2));
      break;
    }
  }
}

try {
  main();
} catch (err) {
  console.error(JSON.stringify({ error: err.message }, null, 2));
  process.exit(1);
}
