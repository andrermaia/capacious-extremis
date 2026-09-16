import psycopg2
import sys
import os

DB_CONFIG = {
    'host': '127.0.0.1',
    'port': 5432,
    'user': 'postgres',
    'password': 'corp1241',
    'dbname': 'takius'
}

DDL_SQL = """
CREATE TABLE IF NOT EXISTS system_knowledge (
    id VARCHAR(255) PRIMARY KEY,
    project_id VARCHAR(255) NOT NULL,
    module VARCHAR(255) NOT NULL,
    feature VARCHAR(255) NOT NULL,
    knowledge_type VARCHAR(255) NOT NULL,
    phase VARCHAR(255) NOT NULL,
    tasks_progress VARCHAR(255) DEFAULT NULL,
    summary VARCHAR(250) NOT NULL,
    details TEXT DEFAULT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_project_module ON system_knowledge(project_id, module);
CREATE INDEX IF NOT EXISTS idx_knowledge_project_phase ON system_knowledge(project_id, phase);

CREATE TABLE IF NOT EXISTS agent_tasks (
    id VARCHAR(255) PRIMARY KEY,
    project_id VARCHAR(255) NOT NULL,
    module VARCHAR(255) NOT NULL,
    task_description TEXT NOT NULL,
    status VARCHAR(255) NOT NULL,
    current_step TEXT DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON agent_tasks(project_id, status);
"""

MIGRATION_RECORD_SQL = """
INSERT INTO migrations (migration, batch)
SELECT '2026_09_15_000000_create_system_context_tables', COALESCE((SELECT MAX(batch) FROM migrations), 0) + 1
WHERE NOT EXISTS (
    SELECT 1 FROM migrations WHERE migration = '2026_09_15_000000_create_system_context_tables'
);
"""

def main():
    print("[1/3] Connecting to PostgreSQL database 'takius'...")
    conn = psycopg2.connect(**DB_CONFIG)
    conn.autocommit = True
    cur = conn.cursor()

    print("[2/3] Applying DDL migration for system_knowledge and agent_tasks...")
    cur.execute(DDL_SQL)
    cur.execute(MIGRATION_RECORD_SQL)
    print("  [OK] Migration applied successfully and registered in Laravel migrations table.")

    print("[3/3] Seeding all 32 system knowledge records into PostgreSQL...")
    seed_file_path = os.path.join(
        os.path.dirname(__file__),
        '../references/seed_postgresql.sql'
    )
    with open(seed_file_path, 'r', encoding='utf8') as f:
        seed_sql = f.read()

    cur.execute(seed_sql)
    
    cur.execute("SELECT COUNT(*) FROM system_knowledge;")
    count = cur.fetchone()[0]
    print(f"  [OK] Seeding complete! Total records in PostgreSQL system_knowledge: {count}")

    cur.execute("SELECT project_id, COUNT(*) FROM system_knowledge GROUP BY project_id ORDER BY project_id;")
    rows = cur.fetchall()
    print("\nProject breakdown in PostgreSQL:")
    for project_id, p_count in rows:
        print(f"  - {project_id}: {p_count} modules/records")

    conn.close()

if __name__ == '__main__':
    main()
