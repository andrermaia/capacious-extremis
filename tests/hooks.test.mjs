import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(__dirname, '..');
const hook = (name) => path.join(skillDir, 'scripts', 'hooks', name);

// A fake shared API: records every call, keeps tasks, answers like the Takius context API.
function fakeApi() {
  const calls = [];
  const tasks = [];
  let down = false;
  let hygieneReport = null;
  let n = 0;
  const task = (id) => tasks.find((t) => t.id === id) || {};
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const route = url.pathname.replace(/^\/v1\/context\//, '');
      const json = body ? JSON.parse(body) : {};
      const project = url.searchParams.get('project');
      calls.push({ route, method: req.method, project, query: Object.fromEntries(url.searchParams), body: json });
      if (down) { res.writeHead(503); res.end('{"error":"down"}'); return; }
      const now = () => new Date().toISOString();
      const reply = {
        modules: () => [{ module: 'louza', total_count: 3 }, { module: 'agent-context', total_count: 2 }],
        'tasks/start': () => {
          const t = { id: `TASK-FAKE${++n}-${n}`, project_id: project, module: json.module, task_description: json.desc, status: 'IN_PROGRESS', current_step: 'Task started', updated_at: now() };
          tasks.push(t);
          return { status: 'IN_PROGRESS', id: t.id, module: t.module };
        },
        'tasks/step': () => { Object.assign(task(json.id), { current_step: json.step, updated_at: now() }); return { status: 'ok' }; },
        'tasks/finish': () => { Object.assign(task(json.id), { status: json.status, updated_at: now() }); return { status: 'ok', id: json.id, task_status: json.status }; },
        tasks: () => tasks.filter((t) => t.project_id === project && (!url.searchParams.get('status') || t.status === url.searchParams.get('status')))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
        query: () => (url.searchParams.get('phase') === 'in_progress'
          ? [{ id: 'LOUZA-WIP-1', module: 'louza', phase: 'in_progress', tasks_progress: '02/05', summary: 'Rematricula 2027 half done' }] : []),
        upsert: () => ({ status: 'ok', id: json.id, action: 'inserted' }),
      }[route] || (route === 'knowledge/HYGIENE-REPORT' && hygieneReport ? () => hygieneReport : null);
      res.writeHead(reply ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply ? reply() : { error: 'not found' }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}/v1/context`,
    calls,
    tasks,
    routes: (r) => calls.filter((c) => c.route === r),
    setDown: (v) => { down = v; },
    setHygiene: (r) => { hygieneReport = r; },
    close: () => server.close(),
  })));
}

// A project root that holds the skill where the hooks expect it, plus a private tmpdir for state.
function workspace() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-hooks-'));
  const root = path.join(base, 'projetos');
  fs.mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true });
  fs.symlinkSync(skillDir, path.join(root, '.agents', 'skills', 'managing-system-context'), 'junction');
  const tmp = path.join(base, 'tmp');
  fs.mkdirSync(tmp);
  return { base, root, tmp, stateFile: (sid) => path.join(tmp, 'claude-context-hooks', `${sid}.json`) };
}

function runHook(ws, api, name, payload) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env, CONTEXT_API_URL: api.url, CONTEXT_API_TOKEN: 'test', CLAUDE_PROJECT_DIR: ws.root,
      TEMP: ws.tmp, TMP: ws.tmp, TMPDIR: ws.tmp, HOME: ws.base, USERPROFILE: ws.base, CONTEXT_SYNC_RULES: '0', NODE_NO_WARNINGS: '1',
    };
    const child = spawn(process.execPath, [hook(name)], { env, cwd: ws.root });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (status) => {
      if (status !== 0) return reject(new Error(`${name} exit ${status}: ${err}`));
      resolve(out.trim() ? JSON.parse(out) : null);
    });
    child.stdin.end(JSON.stringify({ cwd: ws.root, transcript_path: '', ...payload }));
  });
}

let api;
let ws;
test.beforeEach(async () => { api = await fakeApi(); ws = workspace(); });
test.afterEach(() => { api.close(); fs.rmSync(ws.base, { recursive: true, force: true }); });

const prompt = (sid, text) => runHook(ws, api, 'on-prompt.mjs', { session_id: sid, hook_event_name: 'UserPromptSubmit', prompt: text, prompt_id: 'p1' });
const edit = (sid, extra = {}) => runHook(ws, api, 'on-edit-guard.mjs', { session_id: sid, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(ws.root, 'louza', 'x.ts'), content: 'x' }, ...extra });
const stop = (sid) => runHook(ws, api, 'on-stop.mjs', { session_id: sid, hook_event_name: 'Stop', stop_hook_active: false });
const cli = (sid, command, stdout) => runHook(ws, api, 'on-cli-call.mjs', { session_id: sid, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_response: { stdout, stderr: '' } });
const state = (sid) => JSON.parse(fs.readFileSync(ws.stateFile(sid), 'utf8'));

test('on-prompt opens the task itself, with the module the prompt mentions', async () => {
  const out = await prompt('s1', 'Corrija o boletim do louza <ide_selection>código</ide_selection>');
  const [start] = api.routes('tasks/start');
  assert.equal(start.project, 'projetos');
  assert.equal(start.body.module, 'louza');
  assert.equal(start.body.desc, 'Corrija o boletim do louza');
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /já aberta pelo hook — TASK-FAKE1-1 \(módulo louza\)/);
  assert.match(ctx, /Não rode task-start nem task-finish/);
  assert.match(ctx, /--type architecture_decision\|system_model/);
  assert.match(ctx, /Subagentes ficam fora do protocolo/);
  assert.match(out.systemMessage, /🟢 TASK-FAKE1-1/);
  assert.deepEqual(state('s1').tasks.map((t) => [t.id, t.finished]), [['TASK-FAKE1-1', false]]);
});

test('a prompt that arrives with the task still open continues it instead of opening another', async () => {
  await prompt('s2', 'primeiro pedido');
  const out = await prompt('s2', 'segundo pedido');
  assert.equal(api.routes('tasks/start').length, 1);
  assert.equal(api.routes('tasks/step')[0].body.step, 'novo pedido: segundo pedido');
  assert.match(out.systemMessage, /TASK-FAKE1-1 \(continuação\)/);
});

test('a task left open by an old turn is closed as BLOCKED and a new one opens', async () => {
  fs.mkdirSync(path.dirname(ws.stateFile('s3')), { recursive: true });
  fs.writeFileSync(ws.stateFile('s3'), JSON.stringify({ project: 'projetos', tasks: [{ id: 'TASK-OLD-1', project: 'projetos', finished: false, startedAt: '2026-01-01T00:00:00Z' }] }));
  await prompt('s3', 'pedido novo');
  assert.deepEqual(api.routes('tasks/finish').map((c) => [c.body.id, c.body.status]), [['TASK-OLD-1', 'BLOCKED']]);
  assert.equal(api.routes('tasks/start').length, 1);
});

test('the first edit of a turn carries the upsert reminder, the next ones pass silently', async () => {
  await prompt('s4', 'pedido');
  const first = await edit('s4');
  assert.match(first.hookSpecificOutput.additionalContext, /grave com upsert/);
  assert.equal(first.hookSpecificOutput.permissionDecision, undefined);
  assert.equal(await edit('s4'), null);
});

test('subagents pass the edit guard without a task and without touching the API', async () => {
  assert.equal(await edit('s5', { agent_id: 'a123', agent_type: 'general-purpose' }), null);
  assert.equal(api.calls.length, 0);
});

test('on-stop closes the task by itself and never blocks the turn', async () => {
  await prompt('s6', 'pedido');
  const out = await stop('s6');
  assert.equal(out.decision, undefined);
  assert.deepEqual(api.routes('tasks/finish').map((c) => [c.body.id, c.body.status]), [['TASK-FAKE1-1', 'DONE']]);
  assert.match(out.systemMessage, /TASK-FAKE1-1 fechada\(s\) · nada gravado na base/);
  assert.equal(state('s6').tasks[0].finished, true);
});

test('upserts are counted, and a summary that mentions task-finish closes nothing', async () => {
  await prompt('s7', 'pedido');
  const cmd = 'node .agents/skills/managing-system-context/scripts/context-cli.mjs upsert --project projetos --id DEBT-X --module m --feature f --type technical_debt --phase queued --summary "move task-finish --id TASK-FAKE1-1 to on-stop"';
  const out = await cli('s7', cmd, '{"status":"ok","id":"DEBT-X","action":"inserted"}');
  assert.match(out.systemMessage, /conhecimento DEBT-X gravado/);
  assert.doesNotMatch(out.systemMessage, /encerrada/);
  assert.equal(state('s7').tasks[0].finished, false);
  assert.match((await stop('s7')).systemMessage, /1 conhecimento\(s\) gravado\(s\)/);
});

test('one shell command with several CLI calls closes every task it names', async () => {
  await cli('s8', 'node context-cli.mjs task-start --project projetos --module a --desc "x"', '{"id":"TASK-A-1"}');
  await cli('s8', 'node context-cli.mjs task-start --project projetos --module b --desc "y"', '{"id":"TASK-B-2"}');
  await cli('s8', 'node context-cli.mjs task-finish --project projetos --id TASK-A-1 && node context-cli.mjs task-finish --project projetos --id TASK-B-2', '{}');
  assert.ok(state('s8').tasks.every((t) => t.finished));
});

test('editing after the turn closed opens a new task instead of denying', async () => {
  await prompt('s9', 'pedido do louza');
  await stop('s9');
  const out = await edit('s9');
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined);
  assert.match(out.systemMessage, /TASK-FAKE2-2 aberta automaticamente \(módulo louza\)/);
  assert.equal(api.routes('tasks/start')[1].body.desc, 'continuação: pedido do louza');
});

test('with the API down the prompt says so and edits are denied', async () => {
  api.setDown(true);
  const out = await prompt('s10', 'pedido');
  assert.match(out.hookSpecificOutput.additionalContext, /a tarefa NÃO foi aberta/);
  const denied = await edit('s10');
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /fora do ar/);
  assert.equal(await stop('s10'), null);
});

const sessionStart = (sid, source = 'startup') => runHook(ws, api, 'on-session-start.mjs', { session_id: sid, hook_event_name: 'SessionStart', source });

test('session start brings modules, other sessions\' work, recent results and in-progress items', async () => {
  // Another session: one task still open, one finished with a result.
  await prompt('other', 'ajustar o boletim do louza');
  await prompt('other2', 'corrigir a rematrícula');
  await runHook(ws, api, 'on-stop.mjs', { session_id: 'other2', hook_event_name: 'Stop', last_assistant_message: '## Feito\n\nCorrigi a **rematrícula** de 2027: três contratos voltaram ao convênio.' });

  const out = await sessionStart('s11');
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(ctx, /Módulos: louza \(3\), agent-context \(2\)/);
  assert.match(ctx, /Em andamento em outras sessões[\s\S]*TASK-FAKE1-1 · louza · .* · ajustar o boletim do louza/);
  assert.match(ctx, /Resultados recentes:\n- .* · corrigir a rematrícula → Feito Corrigi a rematrícula de 2027: três contratos voltaram ao convênio\./);
  assert.match(ctx, /LOUZA-WIP-1 \(02\/05\) · Rematricula 2027 half done/);
  assert.match(ctx, /search <palavras em inglês>/);
  assert.ok(state('s11').sessionContext);
});

test('after session start the prompt hook skips the module list and the list-modules call', async () => {
  await sessionStart('s12');
  const before = api.routes('modules').length;
  const out = await prompt('s12', 'pedido do louza');
  assert.equal(api.routes('modules').length, before);
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /Módulos:/);
  assert.match(out.hookSpecificOutput.additionalContext, /veio no início da sessão/);
  assert.equal(api.routes('tasks/start').at(-1).body.module, 'louza');
});

test('on-stop saves the final answer from the transcript when the input lacks it', async () => {
  await prompt('s13', 'pedido');
  const transcript = path.join(ws.base, 't.jsonl');
  const lines = [
    { type: 'user', message: { role: 'user', content: 'pedido' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Vou olhar.' }, { type: 'tool_use', id: 'x', name: 'Bash', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Pronto: o `on-stop` grava o [resultado](x.md).' }] } },
  ];
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  await runHook(ws, api, 'on-stop.mjs', { session_id: 's13', hook_event_name: 'Stop', transcript_path: transcript });
  assert.equal(api.routes('tasks/step').at(-1).body.step, 'resultado: Pronto: o on-stop grava o resultado.');
});

test('outside every project the hooks stay silent and never call the API', async () => {
  const scratch = path.join(ws.base, 'scratch');
  fs.mkdirSync(scratch);
  const outside = (name, payload) => new Promise((resolve, reject) => {
    const env = { ...process.env, CONTEXT_API_URL: api.url, CONTEXT_API_TOKEN: 'test', CLAUDE_PROJECT_DIR: scratch, TEMP: ws.tmp, TMP: ws.tmp, TMPDIR: ws.tmp, CONTEXT_SYNC_RULES: '0', NODE_NO_WARNINGS: '1' };
    const child = spawn(process.execPath, [hook(name)], { env, cwd: scratch });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', (status) => (status === 0 ? resolve(out.trim()) : reject(new Error(`${name} exit ${status}`))));
    child.stdin.end(JSON.stringify({ session_id: 'out1', cwd: scratch, ...payload }));
  });
  assert.equal(await outside('on-session-start.mjs', { hook_event_name: 'SessionStart' }), '');
  assert.equal(await outside('on-prompt.mjs', { hook_event_name: 'UserPromptSubmit', prompt: 'oi' }), '');
  assert.equal(await outside('on-edit-guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(scratch, 'x') } }), '');
  assert.equal(await outside('on-stop.mjs', { hook_event_name: 'Stop' }), '');
  assert.equal(api.calls.length, 0);
});

test('without the token in the environment the hooks read it from <root>/.claude/settings.local.json', async () => {
  fs.mkdirSync(path.join(ws.root, '.claude'));
  fs.writeFileSync(path.join(ws.root, '.claude', 'settings.local.json'), JSON.stringify({ env: { CONTEXT_API_TOKEN: 'from-file' } }));
  const seen = [];
  const server = http.createServer((req, res) => { seen.push(req.headers.authorization); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = { ...process.env, CONTEXT_API_URL: `http://127.0.0.1:${server.address().port}/v1/context`, CLAUDE_PROJECT_DIR: ws.root, TEMP: ws.tmp, TMP: ws.tmp, TMPDIR: ws.tmp, CONTEXT_SYNC_RULES: '0', NODE_NO_WARNINGS: '1' };
  delete env.CONTEXT_API_TOKEN;
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [hook('on-session-start.mjs')], { env, cwd: ws.root });
    child.on('close', resolve);
    child.stdin.end(JSON.stringify({ session_id: 'tok', cwd: path.join(ws.root, 'louza'), hook_event_name: 'SessionStart' }));
  });
  server.close();
  assert.ok(seen.length > 0);
  assert.ok(seen.every((h) => h === 'Bearer from-file'));
});

test('session start shows the hygiene report while it has findings', async () => {
  api.setHygiene({ id: 'HYGIENE-REPORT', knowledge_type: 'technical_debt', summary: 'Hygiene 15/10/2026: 2 stale tasks (2 closed), 4 duplicate pairs.' });
  const ctx = (await sessionStart('s14')).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Faxina da base:\n- Hygiene 15\/10\/2026: 2 stale tasks \(2 closed\), 4 duplicate pairs\. \(detalhes: .* get HYGIENE-REPORT --project global\)/);
  api.setHygiene({ id: 'HYGIENE-REPORT', knowledge_type: 'current_behavior', summary: 'Hygiene: nothing to do.' });
  assert.doesNotMatch((await sessionStart('s15')).hookSpecificOutput.additionalContext, /Faxina/);
});
