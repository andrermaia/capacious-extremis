import psycopg2
import sys

try:
    conn = psycopg2.connect(host='127.0.0.1', port=5432, user='postgres', password='corp1241', dbname='takius')
    cur = conn.cursor()
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;")
    tables = [r[0] for r in cur.fetchall()]
    print(f"Connected to database 'takius'. Found {len(tables)} tables:")
    print(tables[:20])
    conn.close()
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
