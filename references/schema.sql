-- Schema definition for Managing System Context
-- Compatible with SQLite, PostgreSQL and Supabase

CREATE TABLE IF NOT EXISTS system_knowledge (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    module TEXT NOT NULL,
    feature TEXT NOT NULL,
    knowledge_type TEXT NOT NULL CHECK (knowledge_type IN ('architecture_decision', 'system_model', 'current_behavior', 'future_revision', 'technical_debt')),
    phase TEXT NOT NULL CHECK (phase IN ('implemented', 'in_progress', 'queued', 'deprioritized')),
    tasks_progress TEXT DEFAULT NULL, -- Format: XX/YY (e.g. 01/25)
    summary TEXT NOT NULL, -- Concise English summary, max 250 characters
    details TEXT DEFAULT NULL, -- In-depth details, code snippets, or reference links (on-demand)
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_project_module ON system_knowledge(project_id, module);
CREATE INDEX IF NOT EXISTS idx_knowledge_phase ON system_knowledge(project_id, phase);

CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    module TEXT NOT NULL,
    task_description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'DONE', 'BLOCKED')),
    current_step TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON agent_tasks(project_id, status);
