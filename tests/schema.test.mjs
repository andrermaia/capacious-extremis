import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(__dirname, '../references/schema.sql');

test('schema.sql creates system_knowledge and agent_tasks tables with proper columns and constraints', () => {
  assert.ok(fs.existsSync(schemaPath), 'schema.sql must exist');

  const ddl = fs.readFileSync(schemaPath, 'utf8');
  const db = new DatabaseSync(':memory:');
  db.exec(ddl);

  // Verify system_knowledge table
  const knowledgeColumns = db.prepare("PRAGMA table_info('system_knowledge')").all();
  const knowledgeColNames = knowledgeColumns.map(c => c.name);
  
  assert.ok(knowledgeColNames.includes('id'), 'system_knowledge must contain id');
  assert.ok(knowledgeColNames.includes('project_id'), 'system_knowledge must contain project_id');
  assert.ok(knowledgeColNames.includes('module'), 'system_knowledge must contain module');
  assert.ok(knowledgeColNames.includes('feature'), 'system_knowledge must contain feature');
  assert.ok(knowledgeColNames.includes('knowledge_type'), 'system_knowledge must contain knowledge_type');
  assert.ok(knowledgeColNames.includes('phase'), 'system_knowledge must contain phase');
  assert.ok(knowledgeColNames.includes('tasks_progress'), 'system_knowledge must contain tasks_progress');
  assert.ok(knowledgeColNames.includes('summary'), 'system_knowledge must contain summary');
  assert.ok(knowledgeColNames.includes('details'), 'system_knowledge must contain details');
  assert.ok(knowledgeColNames.includes('updated_at'), 'system_knowledge must contain updated_at');

  // Verify agent_tasks table
  const taskColumns = db.prepare("PRAGMA table_info('agent_tasks')").all();
  const taskColNames = taskColumns.map(c => c.name);

  assert.ok(taskColNames.includes('id'), 'agent_tasks must contain id');
  assert.ok(taskColNames.includes('project_id'), 'agent_tasks must contain project_id');
  assert.ok(taskColNames.includes('module'), 'agent_tasks must contain module');
  assert.ok(taskColNames.includes('task_description'), 'agent_tasks must contain task_description');
  assert.ok(taskColNames.includes('status'), 'agent_tasks must contain status');
  assert.ok(taskColNames.includes('current_step'), 'agent_tasks must contain current_step');
  assert.ok(taskColNames.includes('created_at'), 'agent_tasks must contain created_at');
  assert.ok(taskColNames.includes('updated_at'), 'agent_tasks must contain updated_at');

  // Test insert and constraints
  const insertStmt = db.prepare(`
    INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run(
    'AUTH-001',
    'my-project',
    'auth',
    'jwt-auth',
    'architecture_decision',
    'in_progress',
    '01/25',
    'Short English summary of auth architecture',
    'Detailed rationale here',
    new Date().toISOString()
  );

  const row = db.prepare('SELECT * FROM system_knowledge WHERE id = ?').get('AUTH-001');
  assert.equal(row.id, 'AUTH-001');
  assert.equal(row.tasks_progress, '01/25');
});
