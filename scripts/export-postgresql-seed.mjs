import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = path.resolve('.agents/context.db');
const db = new DatabaseSync(dbPath);
const rows = db.prepare('SELECT * FROM system_knowledge ORDER BY project_id, id').all();

let sql = `-- Seed data for PostgreSQL (Takius)
-- Contains all 32 initial system knowledge records

`;

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

for (const r of rows) {
  sql += `INSERT INTO system_knowledge (id, project_id, module, feature, knowledge_type, phase, tasks_progress, summary, details, updated_at)\n`;
  sql += `VALUES (${esc(r.id)}, ${esc(r.project_id)}, ${esc(r.module)}, ${esc(r.feature)}, ${esc(r.knowledge_type)}, ${esc(r.phase)}, ${esc(r.tasks_progress)}, ${esc(r.summary)}, ${esc(r.details)}, '${r.updated_at}')\n`;
  sql += `ON CONFLICT (id) DO UPDATE SET\n`;
  sql += `  project_id = EXCLUDED.project_id,\n`;
  sql += `  module = EXCLUDED.module,\n`;
  sql += `  feature = EXCLUDED.feature,\n`;
  sql += `  knowledge_type = EXCLUDED.knowledge_type,\n`;
  sql += `  phase = EXCLUDED.phase,\n`;
  sql += `  tasks_progress = EXCLUDED.tasks_progress,\n`;
  sql += `  summary = EXCLUDED.summary,\n`;
  sql += `  details = EXCLUDED.details,\n`;
  sql += `  updated_at = EXCLUDED.updated_at;\n\n`;
}

const outputPath = path.resolve('.agents/skills/managing-system-context/references/seed_postgresql.sql');
fs.writeFileSync(outputPath, sql, 'utf8');
console.log(`Generated ${outputPath} with ${rows.length} records`);
