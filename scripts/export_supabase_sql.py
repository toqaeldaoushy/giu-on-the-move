"""
GIU on the Move: export the simulated data as SQL files for Supabase
=====================================================================
Reads the CSV files in data/ and writes the SQL files in supabase/ that you paste,
one by one, into the Supabase SQL Editor:

    supabase/01_schema.sql              (written by hand, not by this script)
    supabase/02_seed_data.sql           all the small tables
    supabase/03_gps_pings_part1.sql     the GPS pings, in parts so each paste stays small
    supabase/03_gps_pings_part2.sql
    supabase/03_gps_pings_part3.sql
    supabase/04_finish_and_verify.sql   fixes the id counters and shows a check table

Usage (from the project folder):
    python3 scripts/export_supabase_sql.py

Uses only Python's standard library. Passwords are not exported (Supabase Auth handles logins).
"""

import csv
import sqlite3
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "supabase"
DB = DATA / "giu_on_the_move.db"

SMALL_TABLES = ["users", "buses", "routes", "route_points", "stops", "trips", "trip_runs",
                "problem_reports", "assignment_changes", "alerts", "rider_reports"]
IDENTITY_TABLES = ["users", "buses", "routes", "stops", "trips", "trip_runs", "gps_pings",
                   "problem_reports", "assignment_changes", "alerts", "rider_reports"]
SKIP_COLUMNS = {("users", "password_hash")}      # Supabase Auth handles passwords
BOOLEAN_COLUMNS = {("users", "share_phone")}
ROWS_PER_STATEMENT = 250
PING_FILES = 3


def column_types():
    con = sqlite3.connect(DB)
    out = {}
    for t in SMALL_TABLES + ["gps_pings"]:
        out[t] = {r[1]: r[2] for r in con.execute(f"PRAGMA table_info({t})")}
    con.close()
    return out


TYPES = column_types()


def read_table(name):
    with open(DATA / f"{name}.csv", newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    cols = [c for c in rows[0].keys() if (name, c) not in SKIP_COLUMNS]
    return cols, rows


def literal(table, col, value):
    if value == "":
        return "NULL"
    if (table, col) in BOOLEAN_COLUMNS:
        return "true" if value == "1" else "false"
    if TYPES[table][col] in ("INTEGER", "REAL"):
        return value
    return "'" + value.replace("'", "''") + "'"


def insert_statements(table, cols, rows):
    out = []
    for i in range(0, len(rows), ROWS_PER_STATEMENT):
        chunk = rows[i:i + ROWS_PER_STATEMENT]
        values = ",\n".join("  (" + ", ".join(literal(table, c, r[c]) for c in cols) + ")" for r in chunk)
        out.append(f"insert into public.{table} ({', '.join(cols)}) values\n{values};\n")
    return "".join(out)


def header(title, step, note=""):
    return (f"-- GIU on the Move: {title}\n"
            f"-- STEP {step} of 4. Paste this whole file into the Supabase SQL Editor and click Run.\n"
            f"{note}\n")


def main():
    OUT.mkdir(exist_ok=True)
    counts = {}

    # 02: all the small tables
    parts = [header("seed data", 2, "-- Run 01_schema.sql first. This loads the users, buses, route, stops, timetable, trip runs and reports.\n")]
    for t in SMALL_TABLES:
        cols, rows = read_table(t)
        counts[t] = len(rows)
        parts.append(f"-- {t} ({len(rows)} rows)\n" + insert_statements(t, cols, rows))
    (OUT / "02_seed_data.sql").write_text("\n".join(parts), encoding="utf-8")

    # 03: the GPS pings, in parts
    cols, rows = read_table("gps_pings")
    counts["gps_pings"] = len(rows)
    size = -(-len(rows) // PING_FILES)
    for k in range(PING_FILES):
        chunk = rows[k * size:(k + 1) * size]
        text = header(f"GPS pings, part {k + 1} of {PING_FILES}", 3,
                      "-- Run the parts in order (part 1, then 2, then 3). Each one loads about "
                      f"{len(chunk)} pings.\n")
        text += f"-- gps_pings ({len(chunk)} rows)\n" + insert_statements("gps_pings", cols, chunk)
        (OUT / f"03_gps_pings_part{k + 1}.sql").write_text(text, encoding="utf-8")

    # 04: id counters and the verification table
    with open(DATA / "trip_runs.csv", newline="", encoding="utf-8") as f:
        runs = list(csv.DictReader(f))
    status_counts = {s: sum(1 for r in runs if r["status"] == s) for s in ("completed", "scheduled", "cancelled")}
    speed_total = sum(Decimal(r["speed_kmh"]) for r in rows)

    expected = [(t, counts[t], f"select count(*) from public.{t}") for t in
                ["users", "buses", "routes", "route_points", "stops", "trips", "trip_runs", "gps_pings",
                 "problem_reports", "assignment_changes", "alerts", "rider_reports"]]
    for s, n in status_counts.items():
        expected.append((f"trip_runs: {s}", n, f"select count(*) from public.trip_runs where status = '{s}'"))
    expected.append(("gps_pings: total of all speeds", speed_total,
                     "select coalesce(sum(speed_kmh::numeric), 0) from public.gps_pings"))

    text = header("finish and verify", 4,
                  "-- This fixes the id counters (so new rows get fresh ids) and then shows a check table.\n"
                  "-- Every row of the result must show ok = true.\n")
    for t in IDENTITY_TABLES:
        text += f"select setval(pg_get_serial_sequence('public.{t}', 'id'), max(id)) from public.{t};\n"
    text += "\nselect v.item, v.expected, a.actual, (v.expected = a.actual) as ok\nfrom (values\n"
    text += ",\n".join(f"  ({i + 1}, '{item}', {exp}::numeric)" for i, (item, exp, _) in enumerate(expected))
    text += "\n) as v(n, item, expected)\njoin (\n"
    text += "\n  union all\n".join(f"  select '{item}' as item, ({sql})::numeric as actual" for item, _, sql in expected)
    text += "\n) a on a.item = v.item\norder by v.n;\n"
    (OUT / "04_finish_and_verify.sql").write_text(text, encoding="utf-8")

    print("Written to supabase/:")
    for p in sorted(OUT.glob("*.sql")):
        print(f"  {p.name:32s} {p.stat().st_size / 1024:7.1f} KB")


if __name__ == "__main__":
    main()
