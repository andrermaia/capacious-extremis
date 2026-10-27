import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scrub, condense, draftFrom, buildRequest, costOf, MODEL } from '../scripts/consolidate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(__dirname, '..', 'scripts', 'consolidate.mjs');

const line = (o) => JSON.stringify(o);
const prompt = (text) => line({ type: 'user', message: { role: 'user', content: text } });
const assistant = (...content) => line({ type: 'assistant', message: { role: 'assistant', content } });
const result = (id, content, isError = false) => line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
const bash = (id, command) => ({ type: 'tool_use', id, name: 'Bash', input: { command } });

function transcript() {
  return [
    prompt('Corrija o login da Escola de Teste <system-reminder>lixo do sistema</system-reminder>'),
    assistant({ type: 'thinking', thinking: 'segredo do raciocínio' }, { type: 'text', text: 'Vou olhar o serviço.' }, bash('a', 'npm test')),
    result('a', 'saída enorme do teste '.repeat(500)),
    assistant(bash('b', 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123" https://x')),
    result('b', 'connection refused', true),
    assistant(bash('c', 'git commit -m fix'), bash('d', 'git push'), { type: 'tool_use', id: 'e', name: 'Edit', input: { file_path: 'src/login.ts' } }),
    assistant({ type: 'text', text: 'Pronto: o login voltou (commit abc1234). Contato do responsável: 123.456.789-09, fulano@exemplo.com, (11) 98765-4321.' }),
  ];
}

test('scrub removes secrets and personal data', () => {
  const out = scrub('key sk-ant-api03-ABCDEFGHIJKLMNOP cpf 123.456.789-09 tel (98) 99123-4567 mail a.b@c.com.br senha=hunter2222 ok');
  assert.doesNotMatch(out, /sk-ant|123\.456|99123|a\.b@|hunter/);
  assert.match(out, /\[segredo\].*\[cpf\].*\[telefone\].*\[email\]/);
  assert.match(out, /ok$/);
});

test('condense keeps prompts, answers, commands and errors, never tool output or thinking', () => {
  const w = condense(transcript());
  assert.equal(w.end, 7);
  assert.equal(w.toolUses, 5);
  assert.deepEqual(w.prompts, ['Corrija o login da Escola de Teste']);
  assert.match(w.text, /USUÁRIO: Corrija o login/);
  assert.match(w.text, /→ Bash: npm test/);
  assert.match(w.text, /✗ erro: connection refused/);
  assert.match(w.text, /→ Edit: src\/login\.ts/);
  assert.doesNotMatch(w.text, /saída enorme|segredo do raciocínio|lixo do sistema|abcdefghijklmnop|123\.456|fulano|98765/);
});

test('condense stops where the window fills and resumes from there', () => {
  const lines = Array.from({ length: 50 }, (_, i) => prompt(`pedido ${i} ${'x'.repeat(900)}`));
  const first = condense(lines, 0, 10_000);
  assert.ok(first.end > 5 && first.end < 50);
  assert.ok(first.text.length <= 10_000);
  const second = condense(lines, first.end, 10_000);
  assert.match(second.text, new RegExp(`pedido ${first.end} `));
});

test('the request asks the small model for the schema at low effort', () => {
  const r = buildRequest('w0', { project: 'louza', text: 'USUÁRIO: oi', neighbours: [{ project_id: 'louza', id: 'X-1', knowledge_type: 'technical_debt', summary: 'Old fact' }] });
  assert.equal(r.params.model, MODEL);
  assert.equal(r.params.output_config.effort, 'low');
  assert.equal(r.params.output_config.format.type, 'json_schema');
  assert.match(r.params.messages[0].content, /louza\/X-1 · technical_debt · Old fact/);
  assert.match(r.params.messages[0].content, /<sessao projeto="louza">/);
});

test('a reply becomes a draft with the handoff and ready-to-save notes', () => {
  const win = { session: 'abcdef12-3456', project: 'louza', from: 0, to: 7, tasks: ['TASK-AB-1'], draftId: 'DRAFT-H-ABCDEF12-0', taskDrafts: ['DRAFT-AB-1'] };
  assert.equal(draftFrom({ worth_saving: false, title: 'nada', handoff: {}, notes: [] }, win), null);
  const d = draftFrom({
    worth_saving: true,
    title: 'Login da Escola de Teste corrigido',
    handoff: { goal: 'login', state: 'commit abc1234', failed: ['curl recusado'], verified: ['npm test'], open: [], next: 'deploy' },
    notes: [{ project: 'inexistente', module: 'auth', feature: 'login', type: 'current_behavior', phase: 'implemented', summary: `Login fixed ${'y'.repeat(300)} mail z@z.com`, keywords: 'login, auth', details: '', supersedes: 'OLD-1' }],
  }, win);
  assert.equal(d.id, 'DRAFT-H-ABCDEF12-0');
  assert.equal(d.module, 'drafts');
  assert.equal(d.supersedes, 'DRAFT-AB-1');
  assert.match(d.summary, /^Rascunho \(Haiku\): Login da Escola/);
  assert.match(d.details, /Falhou:\n- curl recusado/);
  const proposal = JSON.parse(d.details.match(/--project louza (\{.*\})/)[1]);
  assert.equal(proposal.supersedes, 'OLD-1,louza/DRAFT-H-ABCDEF12-0');
  assert.ok(proposal.summary.length <= 250);
});

test('cost uses the batch price and the long rate card past 100k tokens', () => {
  assert.equal(costOf({ input_tokens: 100_000, output_tokens: 10_000 }), 0.0075);
  assert.equal(costOf({ input_tokens: 200_000, output_tokens: 0 }), 0.05);
});

// End to end: the first run submits the quiet session, the second collects and saves the draft.
test('submit then collect, against fake Anthropic and context APIs', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidate-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const hooks = path.join(tmp, 'claude-context-hooks');
  fs.mkdirSync(hooks);
  const tr = path.join(tmp, 'session.jsonl');
  fs.writeFileSync(tr, `${[...transcript(), prompt(`Agora documente o fluxo ${'detalhe '.repeat(500)}`)].join('\n')}\n`);
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
  fs.utimesSync(tr, old, old);
  fs.writeFileSync(path.join(hooks, 'abcdef12-0000.json'), JSON.stringify({ project: 'louza', root: tmp, transcript: tr, tasks: [{ id: 'TASK-AB-1' }] }));
  fs.writeFileSync(path.join(hooks, 'bench0000-0000.json'), JSON.stringify({ project: 'louza', root: tmp, transcript: tr, bench: true }));

  const sent = [];
  const upserts = [];
  let ended = false;
  let contextDown = false;
  const anthropic = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      assert.equal(req.headers['x-api-key'], 'test-key');
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/v1/messages/batches') {
        sent.push(JSON.parse(body));
        return res.end(JSON.stringify({ id: 'msgbatch_1', processing_status: 'in_progress' }));
      }
      if (req.url === '/v1/messages/batches/msgbatch_1') {
        return res.end(JSON.stringify({ id: 'msgbatch_1', processing_status: ended ? 'ended' : 'in_progress', results_url: `http://127.0.0.1:${anthropic.address().port}/v1/messages/batches/msgbatch_1/results` }));
      }
      if (req.url.endsWith('/results')) {
        const customId = sent[0].requests[0].custom_id;
        const reply = { worth_saving: true, title: 'Login corrigido', handoff: { goal: 'login', state: 'ok', failed: [], verified: [], open: [], next: '' }, notes: [] };
        return res.end(`${JSON.stringify({ custom_id: customId, result: { type: 'succeeded', message: { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 5000, output_tokens: 300 } } } })}\n`);
      }
      res.writeHead(404); res.end('{}');
    });
  });
  const context = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (contextDown) { res.writeHead(503); return res.end('{"error":"down"}'); }
      if (req.url.startsWith('/v1/context/search')) return res.end(JSON.stringify({ knowledge: [{ project_id: 'louza', id: 'AUTH-1', summary: 'Login uses OIDC' }] }));
      if (req.url.startsWith('/v1/context/upsert')) { upserts.push({ url: req.url, body: JSON.parse(body) }); return res.end('{"status":"ok"}'); }
      res.writeHead(404); res.end('{}');
    });
  });
  await Promise.all([new Promise((r) => anthropic.listen(0, '127.0.0.1', r)), new Promise((r) => context.listen(0, '127.0.0.1', r))]);
  t.after(() => { anthropic.close(); context.close(); });

  const env = {
    ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp,
    CONTEXT_CONSOLIDATE_DIR: path.join(tmp, 'state'), CONTEXT_CONSOLIDATE_API_KEY: 'test-key',
    CONTEXT_CONSOLIDATE_API_BASE: `http://127.0.0.1:${anthropic.address().port}`,
    CONTEXT_API_URL: `http://127.0.0.1:${context.address().port}/v1/context`, CONTEXT_API_TOKEN: 'x',
  };
  delete env.CONTEXT_CONSOLIDATE;
  const run = () => new Promise((resolve) => {
    const p = spawn(process.execPath, [script], { env, cwd: tmp });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });

  const first = await run();
  assert.equal(first.code, 0, first.out);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].requests.length, 1, 'the benchmark session stays out');
  const content = sent[0].requests[0].params.messages[0].content;
  assert.match(content, /louza\/AUTH-1/);
  assert.doesNotMatch(content, /123\.456\.789|abcdefghijklmnop/);

  const second = await run();
  assert.equal(second.code, 0, second.out);
  assert.equal(upserts.length, 0, 'nothing saved while the batch runs');

  ended = true;
  contextDown = true;
  const down = await run();
  assert.equal(down.code, 0, down.out);
  assert.equal(upserts.length, 0, 'the base is down: the draft waits on disk');
  contextDown = false;
  const third = await run();
  assert.equal(third.code, 0, third.out);
  assert.equal(sent.length, 1, 'the window is not sent (nor paid) again');
  assert.equal(upserts.length, 1);
  assert.match(upserts[0].url, /project=louza/);
  assert.equal(upserts[0].body.id, 'DRAFT-H-ABCDEF12-0');
  assert.equal(upserts[0].body.supersedes, 'DRAFT-AB-1');

  const state = JSON.parse(fs.readFileSync(path.join(tmp, 'state', 'state.json'), 'utf8'));
  assert.equal(state.batches.length, 0);
  assert.equal(state.sessions['abcdef12-0000'].done, 8);
  const ledger = fs.readFileSync(path.join(tmp, 'state', 'usage.jsonl'), 'utf8').trim().split('\n');
  assert.equal(ledger.length, 1);

  const fourth = await run();
  assert.equal(fourth.code, 0, fourth.out);
  assert.equal(sent.length, 1, 'a consolidated session is not sent again');
});

test('Codex, agy and Kimi transcripts condense like Claude Code ones', () => {
  const codex = [
    line({ type: 'session_meta', payload: { id: 'x', cwd: 'C:/p' } }),
    line({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>injetado</environment_context>' }] } }),
    line({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'Rode os testes' }] } } }),
    line({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', command: ['powershell.exe', '-Command', 'npm test'], status: 'failed', exit_code: 1, aggregated_output: 'saída longa' } } }),
    line({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'FileChange', changes: { 'C:/p/a.ts': { type: 'update', content: 'conteúdo' } }, status: 'completed' } } }),
    line({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'Reasoning', summary_text: ['pensando'] } } }),
    line({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', content: [{ type: 'Text', text: 'Corrigi o teste.' }], phase: 'final_answer' } } }),
  ];
  const c = condense(codex);
  assert.deepEqual(c.prompts, ['Rode os testes']);
  assert.equal(c.toolUses, 2);
  assert.match(c.text, /→ shell: npm test\n✗ erro: exit 1\n→ apply_patch: update C:\/p\/a\.ts\nAGENTE: Corrigi o teste\./);
  assert.doesNotMatch(c.text, /injetado|saída longa|conteúdo|pensando/);

  const agy = [
    line({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', content: '<USER_REQUEST>\nconserte o build\n</USER_REQUEST>' }),
    line({ step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', thinking: 'segredo', tool_calls: [{ name: 'run_command', args: { CommandLine: '"npm run build"' } }] }),
    line({ step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'DONE', content: 'muita saída. Command exited with code 2.' }),
    line({ step_index: 3, source: 'MODEL', type: 'GENERIC', status: 'ERROR', error: 'file does not exist' }),
    line({ step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Build consertado.' }),
  ];
  const a = condense(agy);
  assert.deepEqual(a.prompts, ['conserte o build']);
  assert.match(a.text, /→ run_command: npm run build\n✗ erro: .*exited with code 2\.\n✗ erro: file does not exist\nAGENTE: Build consertado\./);
  assert.doesNotMatch(a.text, /segredo/);

  const kimi = [
    line({ type: 'metadata', protocol_version: '1.5' }),
    line({ type: 'turn.prompt', agentId: 'main', input: [{ type: 'text', text: 'Revise o PR' }], origin: { kind: 'user' } }),
    line({ type: 'context.append_loop_event', agentId: 'main', event: { type: 'content.part', part: { type: 'think', think: 'raciocínio' } } }),
    line({ type: 'context.append_loop_event', agentId: 'main', event: { type: 'tool.call', name: 'Bash', args: { command: 'git diff' } } }),
    line({ type: 'context.append_loop_event', agentId: 'main', event: { type: 'tool.result', result: { output: 'diff enorme' } } }),
    line({ type: 'context.append_loop_event', agentId: 'main', event: { type: 'tool.result', result: { output: 'permission denied', isError: true } } }),
    line({ type: 'context.append_loop_event', agentId: 'main', event: { type: 'content.part', part: { type: 'text', text: 'PR revisado.' } } }),
  ];
  const k = condense(kimi);
  assert.deepEqual(k.prompts, ['Revise o PR']);
  assert.match(k.text, /USUÁRIO: Revise o PR\n→ Bash: git diff\n✗ erro: permission denied\nAGENTE: PR revisado\./);
  assert.doesNotMatch(k.text, /raciocínio|diff enorme/);
});

test('Codex rollouts are found by the session id in the last 30 days', async (t) => {
  const { codexRollouts } = await import('../scripts/consolidate.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codexhome-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const now = new Date(2026, 9, 26, 12).getTime();
  const dir = path.join(home, '.codex', 'sessions', '2026', '10', '25');
  fs.mkdirSync(dir, { recursive: true });
  const id = '01a17b0b-1234-7abc-8def-0123456789ab';
  fs.writeFileSync(path.join(dir, `rollout-2026-10-25T22-48-45-${id}.jsonl`), '');
  assert.equal(codexRollouts(home, now).get(id), path.join(dir, `rollout-2026-10-25T22-48-45-${id}.jsonl`));
});

test('a proposed note already in the base is dropped and named; with nothing new nor open, no draft', async () => {
  const { overlap } = await import('../scripts/consolidate.mjs');
  const win = { session: 'abcdef12', project: 'projetos', from: 0, to: 9, tasks: [], draftId: 'DRAFT-H-ABCDEF12-0', taskDrafts: [] };
  const note = (summary) => ({ project: 'projetos', module: 'agent-context', feature: 'hooks', type: 'current_behavior', phase: 'implemented', summary, keywords: 'k', details: '', supersedes: '' });
  const saved = { project_id: 'projetos', id: 'AGENTCTX-BEH-SELF-UPDATE', summary: 'Since 27/10/2026 self-update.mjs fast-forwards the skill clone to origin/main hourly from session start and re-runs install-hooks' };
  assert.ok(overlap(saved.summary, 'Since 27/10/2026 (eaeba1e) self-update.mjs fast-forwards the skill clone to origin/main hourly from session start') >= 0.4);
  const reply = { worth_saving: true, title: 't', handoff: { goal: 'g', state: 's', failed: [], verified: [], open: [], next: '' },
    notes: [note('Since 27/10/2026 (eaeba1e) self-update.mjs fast-forwards the skill clone to origin/main hourly from session start'), note('Kimi Code drops SessionStart output, so the adapter sends the session context with the first prompt')] };
  const d = draftFrom(reply, win, [saved]);
  assert.match(d.details, /Já na base \(não propostas de novo\): projetos\/AGENTCTX-BEH-SELF-UPDATE/);
  assert.equal((d.details.match(/^--project /gm) || []).length, 1);
  assert.equal(draftFrom({ ...reply, notes: [reply.notes[0]] }, win, [saved]), null);
  assert.ok(draftFrom({ ...reply, notes: [reply.notes[0]], handoff: { ...reply.handoff, open: ['deploy'] } }, win, [saved]), 'open work keeps the handoff');
});
