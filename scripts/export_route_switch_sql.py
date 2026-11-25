"""
GIU on the Move: switch an EXISTING Supabase database to the current route
==========================================================================
For a Supabase project that is already set up (users, logins, buses and timetable loaded).
Writes supabase/06_switch_route.sql, which replaces only what depends on the route:
the route, its points and stops, the trip runs and everything recorded on them
(GPS pings, reports, assignment changes, alerts). Users, logins, buses and the timetable stay (only the trip labels are refreshed).

Run after scripts/export_supabase_sql.py (it reuses that script's 02_seed_data.sql).
Then, in the Supabase SQL Editor: 06_switch_route.sql, the three 03_gps_pings parts, 04_finish_and_verify.sql.

Usage (from the project folder):
    python3 scripts/export_route_switch_sql.py
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "supabase" / "02_seed_data.sql"
OUT = ROOT / "supabase" / "06_switch_route.sql"

# Tables the route switch reloads, in insert order (children are deleted first, in reverse order).
RELOAD = ["route_points", "stops", "trip_runs", "problem_reports", "assignment_changes", "alerts", "rider_reports"]
DELETE_ORDER = ["rider_reports", "alerts", "assignment_changes", "problem_reports", "gps_pings", "trip_runs",
                "stops", "route_points"]


def sections(sql):
    """Split 02_seed_data.sql into {table: text} using its '-- <table> (n rows)' headers."""
    parts, current = {}, None
    for line in sql.splitlines(keepends=True):
        m = re.match(r"^-- (\w+) \(\d+ rows\)", line)
        if m:
            current = m.group(1)
            parts[current] = ""
        if current:
            parts[current] += line
    return parts


def main():
    seed = SEED.read_text()
    parts = sections(seed)
    route_name = re.search(r"insert into public\.routes \(id, name\) values\s*\(1, '((?:[^']|'')*)'\)", seed).group(1)

    out = [
        "-- GIU on the Move: switch the database to the current route\n",
        "-- For a project that is ALREADY set up. Keeps users, logins, buses and the timetable.\n",
        "-- Order: paste this file and Run; then 03_gps_pings_part1, part2, part3; then 04_finish_and_verify.sql.\n",
        "-- The route, its stops, the trip runs and everything recorded on them are replaced.\n\n",
        "begin;\n\n",
    ]
    out += [f"delete from public.{t};\n" for t in DELETE_ORDER]
    out.append(f"\nupdate public.routes set name = '{route_name}' where id = 1;\n")
    # the timetable rows stay (other rows point to them), but their labels follow the current data
    import csv
    with open(ROOT / "data" / "trips.csv", newline="") as f:
        for t in csv.DictReader(f):
            label = t["label"].replace("'", "''")
            out.append(f"update public.trips set label = '{label}' where id = {int(t['id'])};\n")
    out.append("\n")
    for t in RELOAD:
        out.append(parts[t].rstrip() + "\n\n")
    out.append("commit;\n")
    OUT.write_text("".join(out))
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
