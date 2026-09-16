#!/usr/bin/env node
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function parseArgs(rawArgs) {
  const options = {};
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rawArgs[i + 1];
      if (next && !next.startsWith('--')) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const apiUrl = options['api-url'] || process.env.CONTEXT_API_URL || 'https://qa.takius.com.br/api/v1/context';
  const apiToken = options['api-token'] || process.env.CONTEXT_API_TOKEN || null;
  const dbPath = path.resolve(options['db-path'] || process.env.CONTEXT_DB_PATH || '.agents/context.db');

  console.log(`[Sync] Reading records from local database: ${dbPath}`);
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare('SELECT * FROM system_knowledge ORDER BY project_id, id').all();

  console.log(`[Sync] Found ${rows.length} records to sync to remote API: ${apiUrl}`);

  let success = 0;
  let failed = 0;

  for (const r of rows) {
    const url = new URL('upsert', apiUrl.endsWith('/') ? apiUrl : apiUrl + '/');
    url.searchParams.set('project', r.project_id);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (apiToken) {
      headers['Authorization'] = `Bearer ${apiToken}`;
    }

    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: r.id,
          project_id: r.project_id,
          module: r.module,
          feature: r.feature,
          knowledge_type: r.knowledge_type,
          phase: r.phase,
          tasks_progress: r.tasks_progress,
          summary: r.summary,
          details: r.details
        })
      });

      if (res.ok) {
        success++;
        console.log(`  ✔ [${r.project_id}] ${r.id} synced`);
      } else {
        failed++;
        const text = await res.text();
        console.error(`  ✖ [${r.project_id}] ${r.id} failed (${res.status}): ${text}`);
      }
    } catch (err) {
      failed++;
      console.error(`  ✖ [${r.project_id}] ${r.id} error: ${err.message}`);
    }
  }

  console.log('\n[Sync Summary]');
  console.log(`  Total: ${rows.length}`);
  console.log(`  Synced: ${success}`);
  console.log(`  Failed: ${failed}`);
}

main().catch(err => {
  console.error('[Sync Fatal Error]', err.message);
  process.exit(1);
});
