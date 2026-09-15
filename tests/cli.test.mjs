import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, '../scripts/context-cli.mjs');
const tempDbPath = path.resolve(__dirname, 'temp-test-context.db');

function runCli(args, env = {}) {
  const result = execFileSync(
    process.execPath,
    [cliPath, '--db-path', tempDbPath, '--project', 'test-proj', ...args],
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


