import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, '../scripts/context-cli.mjs');
const scannerPath = path.resolve(__dirname, '../scripts/bootstrap-scan.mjs');
const tempDir = path.resolve(__dirname, 'temp-e2e-workspace');
const dbPath = path.join(tempDir, 'context.db');

function runCli(args) {
  const result = execFileSync(
    process.execPath,
    [cliPath, '--db-path', dbPath, '--project', 'e2e-project', ...args],
    { encoding: 'utf8' }
  );
  return JSON.parse(result.trim());
}

test.beforeEach(() => {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(tempDir, 'src/auth'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'src/orders'), { recursive: true });

  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
    name: 'e2e-app',
    dependencies: { fastify: '^4.0.0', pg: '^8.0.0' }
  }));
  fs.writeFileSync(path.join(tempDir, 'src/auth/login.js'), '// login logic');
  fs.writeFileSync(path.join(tempDir, 'src/orders/checkout.js'), '// checkout logic');
});

test.afterEach(() => {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('E2E Lifecycle: init -> bootstrap -> query -> task-start -> upsert -> task-finish', () => {
  // 1. Init DB
  const initRes = runCli(['init']);
  assert.equal(initRes.status, 'ok');

  // 2. Run bootstrap scan with auto-import
  execFileSync(
    process.execPath,
    [scannerPath, '--target', tempDir, '--project', 'e2e-project', '--db-path', dbPath, '--import'],
    { encoding: 'utf8' }
  );

  // 3. List modules
  const modules = runCli(['list-modules']);
  assert.ok(modules.length >= 2);
  const modNames = modules.map(m => m.module);
  assert.ok(modNames.includes('auth'));
  assert.ok(modNames.includes('orders'));

  // 4. Query module
  const authRecords = runCli(['query', '--module', 'auth']);
  assert.ok(authRecords.length >= 1);
  assert.ok(authRecords[0].summary.length <= 250);

  // 5. Start Agent Task
  const task = runCli(['task-start', '--module', 'auth', '--desc', 'Add MFA with TOTP']);
  assert.ok(task.id);
  assert.equal(task.status, 'IN_PROGRESS');

  // 6. Update step
  const stepRes = runCli(['task-step', '--id', task.id, '--step', 'Created TOTP secret generator']);
  assert.equal(stepRes.status, 'ok');

  // 7. Upsert new decision & debt
  const decisionRes = runCli([
    'upsert',
    '--id', 'AUTH-DEC-002',
    '--module', 'auth',
    '--feature', 'totp-mfa',
    '--type', 'architecture_decision',
    '--phase', 'in_progress',
    '--progress', '03/05',
    '--summary', 'RFC 6238 TOTP algorithm using 30s window and SHA1.',
    '--details', 'Recovery codes stored hashed with Argon2id.'
  ]);
  assert.equal(decisionRes.status, 'ok');

  const debtRes = runCli([
    'upsert',
    '--id', 'AUTH-DEBT-001',
    '--module', 'auth',
    '--feature', 'rate-limit',
    '--type', 'technical_debt',
    '--phase', 'queued',
    '--summary', 'MFA verification endpoint lacks distributed rate limiting.',
    '--details', 'Need Redis token bucket filter.'
  ]);
  assert.equal(debtRes.status, 'ok');

  // 8. Finish Task
  const finishRes = runCli(['task-finish', '--id', task.id, '--status', 'DONE']);
  assert.equal(finishRes.status, 'ok');

  // 9. Verify state
  const tasks = runCli(['list-tasks']);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, 'DONE');

  const authUpdated = runCli(['query', '--module', 'auth']);
  const mfaDec = authUpdated.find(r => r.id === 'AUTH-DEC-002');
  assert.ok(mfaDec);
  assert.equal(mfaDec.tasks_progress, '03/05');
});
