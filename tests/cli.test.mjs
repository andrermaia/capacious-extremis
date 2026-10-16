import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, '../scripts/context-cli.mjs');
const tempDbPath = path.resolve(__dirname, 'temp-test-context.db');

function runCli(args, env = {}) {
  // The CLI now targets the shared API by default; these tests exercise the local
  // SQLite adapter, so force it off unless the case is explicitly about a remote URL.
  const offline = args.includes('--api-url') ? [] : ['--no-api'];
  const result = execFileSync(
    process.execPath,
    [cliPath, '--db-path', tempDbPath, '--project', 'test-proj', ...offline, ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    }
  );
  return JSON.parse(result.trim());
}

test.beforeEach(() => {
  if (fs.existsSync(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }
});

test.afterEach(() => {
  if (fs.existsSync(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }
});

test('CLI: init creates database and tables', () => {
  const res = runCli(['init']);
  assert.equal(res.status, 'ok');
  assert.ok(fs.existsSync(tempDbPath));
});

test('CLI: upsert validates summary <= 250 chars and saves knowledge', () => {
  runCli(['init']);

  // Valid upsert
  const res = runCli([
    'upsert',
    '--id', 'AUTH-001',
    '--module', 'auth',
    '--feature', 'jwt',
    '--type', 'architecture_decision',
    '--phase', 'in_progress',
    '--progress', '01/10',
    '--summary', 'Stateless JWT authentication using RS256 algorithm.',
    '--details', 'Detailed reasoning about RS256 vs HS256.'
  ]);

  assert.equal(res.status, 'ok');
  assert.equal(res.id, 'AUTH-001');

  // Verify rejection when summary > 250 characters
  const longSummary = 'A'.repeat(251);
  assert.throws(() => {
    runCli([
      'upsert',
      '--id', 'AUTH-002',
      '--module', 'auth',
      '--feature', 'jwt',
      '--type', 'architecture_decision',
      '--phase', 'in_progress',
      '--summary', longSummary
    ]);
  }, /Summary exceeds maximum limit of 250 characters/);
});

test('CLI: list-modules, query, and get return expected token-efficient data', () => {
  runCli(['init']);

  runCli([
    'upsert',
    '--id', 'AUTH-001',
    '--module', 'auth',
    '--feature', 'jwt',
    '--type', 'architecture_decision',
    '--phase', 'implemented',
    '--summary', 'Stateless JWT authentication using RS256 algorithm.',
    '--details', 'Detailed private key rotation notes.'
  ]);

  runCli([
    'upsert',
    '--id', 'BILL-001',
    '--module', 'billing',
    '--feature', 'stripe',
    '--type', 'system_model',
    '--phase', 'in_progress',
    '--progress', '02/15',
    '--summary', 'Stripe checkout session integration with idempotency keys.'
  ]);

  // Test list-modules
  const modules = runCli(['list-modules']);
  assert.equal(modules.length, 2);
  const authMod = modules.find(m => m.module === 'auth');
  assert.ok(authMod);
  assert.equal(authMod.total_count, 1);

  // Test query
  const queryAuth = runCli(['query', '--module', 'auth']);
  assert.equal(queryAuth.length, 1);
  assert.equal(queryAuth[0].id, 'AUTH-001');
  // Details should NOT be in query to save tokens
  assert.equal(queryAuth[0].details, undefined);

  // Test get
  const single = runCli(['get', 'AUTH-001']);
  assert.equal(single.id, 'AUTH-001');
  assert.equal(single.details, 'Detailed private key rotation notes.');
});

test('CLI: agent task lifecycle (start, step, finish)', () => {
  runCli(['init']);

  // Start task
  const started = runCli(['task-start', '--module', 'auth', '--desc', 'Implement refresh token endpoint']);
  assert.ok(started.id);
  assert.equal(started.status, 'IN_PROGRESS');

  // Step update
  const stepped = runCli(['task-step', '--id', started.id, '--step', 'Created controller and route']);
  assert.equal(stepped.status, 'ok');

  // Finish task
  const finished = runCli(['task-finish', '--id', started.id, '--status', 'DONE']);
  assert.equal(finished.status, 'ok');

  // List tasks
  const tasks = runCli(['list-tasks']);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, started.id);
  assert.equal(tasks[0].status, 'DONE');
});

test('CLI: remote HTTP init reports connection to remote API', () => {
  const initRemote = runCli(['init', '--api-url', 'https://example.com/api/v1/context']);
  assert.equal(initRemote.status, 'ok');
  assert.equal(initRemote.apiUrl, 'https://example.com/api/v1/context');
});



test('CLI: search ranks by words found, ignores accents, spans this project + global', () => {
  runCli(['init']);
  const add = (id, project, summary, details) => runCli(['upsert', '--project', project, '--id', id, '--module', 'm', '--feature', 'f',
    '--type', 'current_behavior', '--phase', 'implemented', '--summary', summary, ...(details ? ['--details', details] : [])]);
  add('A-1', 'test-proj', 'Migration runs before the image in production');
  add('A-2', 'test-proj', 'Unrelated note', 'A migração entra antes da imagem em produção');
  add('A-3', 'test-proj', 'Production image only');
  add('G-1', 'global', 'Never stash; commit first');
  add('O-1', 'other-proj', 'Migration order on another project');
  runCli(['task-start', '--module', 'm', '--desc', 'Aplicar migração em produção']);

  const english = runCli(['search', 'migration', 'production']);
  assert.deepEqual(english.knowledge.map((r) => [r.id, r.hits]), [['A-1', 2], ['A-3', 1]]);
  assert.equal(english.knowledge[0].details, undefined);
  const accentless = runCli(['search', 'producao', 'imagem']);
  assert.deepEqual(accentless.knowledge.map((r) => r.id), ['A-2']);
  assert.equal(accentless.tasks.length, 1);
  assert.deepEqual(runCli(['search', 'stash']).knowledge.map((r) => r.id), ['G-1']);
  assert.deepEqual(runCli(['search', 'migration', '--all']).knowledge.map((r) => r.id).sort(), ['A-1', 'O-1']);
  assert.throws(() => runCli(['search', 'x']));
});

test('CLI: upsert --file - saves a whole batch from stdin in one call', () => {
  runCli(['init']);
  const items = [
    { id: 'B-1', module: 'm', feature: 'f', type: 'current_behavior', phase: 'implemented', summary: 'First of the batch' },
    { id: 'B-2', module: 'm', feature: 'f', type: 'technical_debt', phase: 'in_progress', progress: '01/03', summary: 'Second of the batch' },
  ];
  const out = execFileSync(process.execPath, [cliPath, '--db-path', tempDbPath, '--project', 'test-proj', '--no-api', 'upsert', '--file', '-'],
    { input: JSON.stringify(items), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  assert.deepEqual(JSON.parse(out).results.map((r) => r.id), ['B-1', 'B-2']);
  const rows = runCli(['query', '--module', 'm']);
  assert.deepEqual(rows.map((r) => [r.id, r.tasks_progress]).sort(), [['B-1', null], ['B-2', '01/03']]);
  const bad = [{ ...items[0], id: 'B-3', summary: 'x'.repeat(251) }];
  assert.throws(() => execFileSync(process.execPath, [cliPath, '--db-path', tempDbPath, '--project', 'test-proj', '--no-api', 'upsert', '--file', '-'],
    { input: JSON.stringify(bad), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
});

test('CLI: Portuguese keywords make an English summary findable; keywords --file keeps updated_at', () => {
  runCli(['init']);
  const run = (args, input) => JSON.parse(execFileSync(process.execPath, [cliPath, '--db-path', tempDbPath, '--project', 'test-proj', '--no-api', ...args],
    { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
  run(['upsert', '--file', '-'], JSON.stringify([
    { id: 'K-1', module: 'm', feature: 'f', type: 'current_behavior', phase: 'implemented', summary: 'Vacation days cut by phantom absences', keywords: ['Férias', 'faltas', 'férias'] },
    { id: 'K-2', module: 'm', feature: 'f', type: 'current_behavior', phase: 'implemented', summary: 'Quota mode distributes invites' },
  ]));
  assert.deepEqual(runCli(['search', 'ferias']).knowledge.map((r) => r.id), ['K-1']);
  const before = runCli(['get', 'K-2']).updated_at;
  const out = run(['keywords', '--file', '-'], JSON.stringify([{ id: 'K-2', keywords: 'cota, convites, recital' }, { id: 'NOPE', keywords: 'x' }]));
  assert.deepEqual([out.updated, out.missing], [1, ['NOPE']]);
  const after = runCli(['get', 'K-2']);
  assert.equal(after.keywords, 'cota, convites, recital');
  assert.equal(after.updated_at, before);
  assert.equal(runCli(['search', 'recital']).knowledge[0].id, 'K-2');
  assert.equal(runCli(['get', 'K-1']).keywords, 'férias, faltas');
});

test('CLI: an upsert without keywords says so (answer and stderr)', () => {
  runCli(['init']);
  const r = spawnSync(process.execPath, [cliPath, '--db-path', tempDbPath, '--project', 'test-proj', '--no-api', 'upsert', '--file', '-'], {
    input: JSON.stringify([
      { id: 'W-1', module: 'm', feature: 'f', type: 'current_behavior', phase: 'implemented', summary: 'No keywords here' },
      { id: 'W-2', module: 'm', feature: 'f', type: 'current_behavior', phase: 'implemented', summary: 'Has them', keywords: 'cota, recital' },
    ]), encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(r.stdout).sem_keywords, ['W-1']);
  assert.match(r.stderr, /1 item\(s\) sem keywords em português: W-1/);
  const single = runCli(['upsert', '--id', 'W-3', '--module', 'm', '--feature', 'f', '--type', 'current_behavior', '--phase', 'implemented', '--summary', 's', '--keywords', 'a, b']);
  assert.equal(single.sem_keywords, undefined);
});
