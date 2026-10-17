// Compact text for the read commands an agent runs by hand (get, search, query, neighbours,
// impact): the same facts as the API's JSON in a fraction of the characters, since every
// character of a tool result is paid again on each later turn. --json prints the raw answer
// for scripts (the hooks and sync-rules pass it).

// Search machinery, never meant for a reader (the vector alone was 80% of a get).
const DROP = new Set(['embedding_v', 'f_top', 'f_mid', 'f_low', 'f_text', 'f_subject', 'f_body']);
const SHOWN = new Set(['id', 'project_id', 'module', 'feature', 'knowledge_type', 'phase', 'tasks_progress', 'summary',
  'details', 'updated_at', 'created_at', 'keywords', 'paths', 'links', 'stale']);

const DAY = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
export const day = (iso) => {
  const d = new Date(iso);
  return iso && !Number.isNaN(d.getTime()) ? DAY.format(d) : String(iso || '');
};
const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => {
  const t = one(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const ref = (r) => `${r.project_id}/${r.id}`;
const staleLine = (s) => (s ? `  ⚠ arquivo mudou depois desta nota: ${s.repo}@${String(s.sha || '').slice(0, 7)} (${s.date})` : null);

// One row of the base: where it is, what it is, when, and its summary in full (at most 250).
function rowLine(k, mark = '-') {
  const progress = k.tasks_progress ? ` ${k.tasks_progress}` : '';
  return `${mark} ${ref(k)} · ${k.knowledge_type} · ${k.phase}${progress} · ${day(k.updated_at)} · ${one(k.summary)}`;
}

const taskLine = (t) => {
  const step = t.current_step && t.current_step !== 'Task started' ? ` → ${cut(t.current_step, 160)}` : '';
  return `- ${t.id} · ${t.project_id}/${t.module} · ${t.status} · ${day(t.updated_at)} · ${cut(t.task_description, 100)}${step}`;
};

export function formatSearch(data) {
  const knowledge = data.knowledge || [];
  const scope = Array.isArray(data.scope) ? data.scope.join(', ') : data.scope || 'todos';
  const out = [`Busca "${data.query}" em ${scope}: ${knowledge.length} linha(s)`];
  for (const k of knowledge) {
    out.push(rowLine(k));
    if (k.excerpt) out.push(`  ↳ ${cut(k.excerpt, 420)}`);
    const stale = staleLine(k.stale);
    if (stale) out.push(stale);
  }
  if (data.semantic?.length) out.push('Perto em significado (nenhuma palavra bateu):', ...data.semantic.map((k) => rowLine(k, '≈')));
  if (data.related?.length) {
    out.push('Ligações:', ...data.related.map((r) => {
      const from = String(r.for || '').replace('|', '/');
      return `- ${from} ${r.dir === 'in' ? '←' : '→'} ${r.kind} ${ref(r)} · ${cut(r.summary, 150)}`;
    }));
  }
  if (data.tasks?.length) out.push('Tarefas:', ...data.tasks.map(taskLine));
  if (data.commits?.length) out.push('Commits:', ...data.commits.map((c) => `- ${c.repo}@${String(c.sha).slice(0, 7)} · ${c.date} · ${one(c.subject)}`));
  if (data.drafts?.length) out.push('Rascunhos (trabalho que terminou sem upsert):', ...data.drafts.map((d) => `- ${ref(d)} · ${cut(d.summary, 160)}`));
  return out.join('\n');
}

export function formatGet(row) {
  const out = [
    ref(row),
    `módulo ${row.module} · feature ${row.feature} · ${row.knowledge_type} · ${row.phase}${row.tasks_progress ? ` ${row.tasks_progress}` : ''} · atualizado ${day(row.updated_at)}`,
    `Resumo: ${one(row.summary)}`,
  ];
  if (row.keywords) out.push(`Palavras-chave: ${one(row.keywords)}`);
  const paths = Array.isArray(row.paths) ? row.paths : row.paths ? [row.paths] : [];
  if (paths.length) out.push(`Arquivos: ${paths.join(', ')}`);
  if (row.links?.length) {
    out.push('Ligações:', ...row.links.map((l) => `- ${l.dir === 'in' ? '←' : '→'} ${l.kind} ${ref(l)} (${l.phase})${l.detail ? ` · ${one(l.detail)}` : ''} · ${cut(l.summary, 150)}`));
  }
  const stale = staleLine(row.stale);
  if (stale) out.push(stale.trim());
  for (const [key, value] of Object.entries(row)) {
    if (SHOWN.has(key) || DROP.has(key) || value == null || value === '') continue;
    out.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
  }
  if (row.details) out.push('Detalhes:', String(row.details));
  return out.join('\n');
}

export function formatRows(rows) {
  return [`${rows.length} linha(s)`, ...rows.map((k) => rowLine({ ...k, phase: `${k.module}/${k.feature} · ${k.phase}` }))].join('\n');
}

export function formatNeighbours(data) {
  const list = data.neighbours || [];
  return [`Ligados a ${String(data.from || '').replace('|', '/')} (até ${data.depth} salto(s), motor ${data.engine}): ${list.length}`,
    ...list.map((n) => `- ${n.hops} · ${ref(n)} · ${n.knowledge_type} · ${n.phase} · ${cut(n.summary, 200)}`)].join('\n');
}

export function formatImpact(data) {
  const list = data.affected || [];
  return [`Afetados se ${String(data.of || '').replace('|', '/')} mudar ou cair (até ${data.depth} salto(s), motor ${data.engine}): ${list.length}`,
    ...list.map((a) => `- ${a.hops} · ${ref(a)}${a.feature ? ` (${a.feature})` : ''} · ${a.kind}${a.detail ? `: ${one(a.detail)}` : ''} · ${cut(a.summary, 160)}`)].join('\n');
}

// The raw answer, without the search machinery, for --json and for shapes the text does not know.
export const plain = (v) => (Array.isArray(v) ? v.map(plain)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !DROP.has(k)).map(([k, x]) => [k, plain(x)])) : v);

export function printRead(command, data, { json = false } = {}) {
  const clean = plain(data);
  const text = json || clean == null || clean.error ? null
    : command === 'search' && Array.isArray(clean.knowledge) ? formatSearch(clean)
      : command === 'get' && clean.id ? formatGet(clean)
        : command === 'query' && Array.isArray(clean) ? formatRows(clean)
          : command === 'neighbours' && Array.isArray(clean.neighbours) ? formatNeighbours(clean)
            : command === 'impact' && Array.isArray(clean.affected) ? formatImpact(clean)
              : null;
  console.log(text ?? JSON.stringify(clean, null, 2));
}
