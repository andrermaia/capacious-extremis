import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scannerPath = path.resolve(__dirname, '../scripts/bootstrap-scan.mjs');
const fixtureDir = path.resolve(__dirname, 'fixture-project');

test.beforeEach(() => {
  if (fs.existsSync(fixtureDir)) {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(fixtureDir, 'src/auth'), { recursive: true });
  fs.mkdirSync(path.join(fixtureDir, 'src/billing'), { recursive: true });
  fs.mkdirSync(path.join(fixtureDir, 'node_modules/fake-lib'), { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'package.json'), JSON.stringify({
    name: 'fixture-app',
    dependencies: {
      express: '^4.18.2',
      jsonwebtoken: '^9.0.0'
    }
  }));

  fs.writeFileSync(path.join(fixtureDir, 'src/auth/jwt.js'), '// auth jwt logic');
  fs.writeFileSync(path.join(fixtureDir, 'src/billing/stripe.js'), '// billing stripe logic');
});

test.afterEach(() => {
  if (fs.existsSync(fixtureDir)) {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('bootstrap-scan.mjs detects modules and generates valid knowledge records', () => {
  const resultRaw = execFileSync(
    process.execPath,
    [scannerPath, '--target', fixtureDir, '--project', 'fixture-app'],
    { encoding: 'utf8' }
  );

  const result = JSON.parse(resultRaw.trim());
  assert.ok(Array.isArray(result));
  assert.ok(result.length >= 2, 'Should discover at least auth and billing or dependencies');

  for (const item of result) {
    assert.ok(item.id, 'Record must have id');
    assert.ok(item.module, 'Record must have module');
    assert.ok(item.feature, 'Record must have feature');
    assert.ok(item.summary, 'Record must have summary');
    assert.ok(item.summary.length <= 250, 'Summary must be <= 250 characters');
    assert.equal(item.phase, 'implemented');
  }

  const moduleNames = result.map(r => r.module);
  assert.ok(moduleNames.includes('auth'), 'Must discover auth module');
  assert.ok(moduleNames.includes('billing'), 'Must discover billing module');
});
