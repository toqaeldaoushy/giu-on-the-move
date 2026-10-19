"""
Runs the backend tests on a throw-away local Postgres loaded with the project data.
Needs:  pip install pgserver psycopg2-binary     and     npm install   (in the backend folder)

    python3 tests/run_with_local_postgres.py
"""
import os
import pathlib
import subprocess
import sys
import tempfile

import pgserver
import psycopg2

backend = pathlib.Path(__file__).resolve().parents[1]
sql_dir = backend.parent / "supabase"

server = pgserver.get_server(tempfile.mkdtemp())
uri = server.get_uri()
con = psycopg2.connect(uri)
con.autocommit = True
cur = con.cursor()
for name in ["01_schema.sql", "02_seed_data.sql", "03_gps_pings_part1.sql", "03_gps_pings_part2.sql",
             "03_gps_pings_part3.sql", "04_finish_and_verify.sql"]:
    cur.execute((sql_dir / name).read_text(encoding="utf-8"))
con.close()

env = {**os.environ, "DATABASE_URL": uri, "JWT_SECRET": "test-secret", "SIMULATED_NOW": "2026-10-08T13:40:00"}
sys.exit(subprocess.run(["npm", "test"], cwd=backend, env=env).returncode)
