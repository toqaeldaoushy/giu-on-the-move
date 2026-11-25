"""
GIU on the Move: data quality checks for the full system data
==============================================================
Runs the checks on data/giu_on_the_move.db and the CSV files in data/.
The checks are written independently of the generator: they compare the data
with the REAL timetable and with the rules of the system.

Includes the 14 checks from the earlier single-bus dataset (completeness, types,
timetable, 30 s interval, time order, route area, endpoints, speed range,
duplicates, device, speed vs distance) and adds the rules for assignments,
statuses, reports, alerts and roles.

Usage (from the project folder):
    python3 scripts/check_system_data.py

Exit code 0 means every check passed.
"""

import csv
import math
import re
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DB = DATA / "giu_on_the_move.db"

# ---- Expectations -------------------------------------------------------------
REAL_TIMETABLE = [  # code, direction, time  (the real timetable)
    ("arrival_first", "inbound", "08:00"),
    ("arrival_second", "inbound", "10:00"),
    ("departure_first", "outbound", "13:45"),
    ("departure_second", "outbound", "15:30"),
    ("departure_third", "outbound", "17:30"),
]
EXPECTED_TABLES = ["users", "buses", "routes", "route_points", "stops", "trips", "trip_runs", "gps_pings",
                   "problem_reports", "assignment_changes", "alerts", "rider_reports"]
EMPTY_ALLOWED = {("users", "password_hash"), ("users", "phone"), ("trip_runs", "actual_start"),
                 ("trip_runs", "actual_end"), ("problem_reports", "note"), ("assignment_changes", "reason")}
OPERATING_WEEKDAYS = {5, 6, 0, 1, 2, 3}   # Saturday to Thursday, Friday off (Python: Monday=0 ... Sunday=6)
SNAPSHOT_TIME = "13:40"                    # "now" on the last operating day
PING_INTERVAL_S = 30
ROUTE_MARGIN_DEG = 0.01
ENDPOINT_TOLERANCE_KM = 1.5
MAX_SPEED_KMH = 120
SPEED_TOLERANCE_KMH = 2.0
START_EARLY_MIN, START_LATE_MIN = 5, 20    # allowed start offset from the schedule
PLANNED_RUN_MIN = 71                       # planned window of a trip (the recorded real trip), for overlap checks
PHONE_FORMAT = re.compile(r"^\+20-000-000-\d{4}$")

results = []


def record(name, passed, detail):
    results.append((name, passed, detail))
    print(f"[{'PASS' if passed else 'FAIL'}] {name}\n       {detail}")


def haversine_km(p1, p2):
    R = 6371.0
    lat1, lon1 = math.radians(p1[0]), math.radians(p1[1])
    lat2, lon2 = math.radians(p2[0]), math.radians(p2[1])
    a = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def ts(s):
    return datetime.fromisoformat(s)


if not DB.exists():
    sys.exit("Database not found. Run scripts/generate_system_data.py first.")

con = sqlite3.connect(DB)
con.execute("PRAGMA foreign_keys = ON")


def q(sql, params=()):
    return con.execute(sql, params).fetchall()


print(f"Database: {DB.relative_to(ROOT)}\n")

# ---- 1. Integrity ---------------------------------------------------------------
fk = q("PRAGMA foreign_key_check")
integrity = q("PRAGMA integrity_check")[0][0]
record("Database integrity and foreign keys", not fk and integrity == "ok",
       f"integrity_check = {integrity}; {len(fk)} foreign key violations")

# ---- 2. Tables and CSV files match -----------------------------------------------
names = {r[0] for r in q("SELECT name FROM sqlite_master WHERE type='table'")}
missing_tables = [t for t in EXPECTED_TABLES if t not in names]
count_report, count_bad = [], []
csv_rows = {}
for t in EXPECTED_TABLES:
    path = DATA / f"{t}.csv"
    if not path.exists():
        count_bad.append(f"{t}.csv missing")
        continue
    with open(path, newline="", encoding="utf-8") as f:
        csv_rows[t] = list(csv.DictReader(f))
    n_db = q(f"SELECT COUNT(*) FROM {t}")[0][0] if t in names else -1
    count_report.append(f"{t} {n_db}")
    if n_db != len(csv_rows[t]):
        count_bad.append(f"{t}: db {n_db} vs csv {len(csv_rows[t])}")
record("All 12 tables exist and the CSV files match the database", not missing_tables and not count_bad,
       f"missing tables: {missing_tables or 'none'}; mismatches: {count_bad or 'none'}")

# ---- 3. Completeness ---------------------------------------------------------------
empty_cells, total_cells = [], 0
for t, rows in csv_rows.items():
    for r in rows:
        for c, v in r.items():
            total_cells += 1
            if (v or "").strip() == "" and (t, c) not in EMPTY_ALLOWED:
                empty_cells.append(f"{t}.{c}")
record("Completeness (no empty cells except the optional fields)", not empty_cells,
       f"{len(empty_cells)} unexpected empty cells out of {total_cells}")

# ---- 4. Duplicate rows -----------------------------------------------------------
dup = 0
for t, rows in csv_rows.items():
    seen = set()
    for r in rows:
        key = tuple(r.values())
        dup += key in seen
        seen.add(key)
record("No duplicate rows in any table", dup == 0, f"{dup} duplicate rows")

# ---- 5. Roles ---------------------------------------------------------------------
roles = dict(q("SELECT role, COUNT(*) FROM users GROUP BY role"))
role_of = dict(q("SELECT id, role FROM users"))
wrong = []
for sql, expected, label in [
    ("SELECT driver_id FROM trip_runs WHERE driver_id IS NOT NULL", "driver", "trip_runs.driver_id"),
    ("SELECT driver_id FROM problem_reports", "driver", "problem_reports.driver_id"),
    ("SELECT changed_by FROM assignment_changes", "admin", "assignment_changes.changed_by"),
    ("SELECT user_id FROM alerts", "rider", "alerts.user_id"),
    ("SELECT user_id FROM rider_reports", "rider", "rider_reports.user_id"),
]:
    for (uid,) in q(sql):
        if role_of.get(uid) != expected:
            wrong.append(f"{label}={uid}")
record("Roles are used correctly (drivers drive, the admin assigns, riders set alerts)",
       roles.get("admin") == 1 and roles.get("driver") == 4 and roles.get("rider", 0) >= 1 and not wrong,
       f"users by role: {roles}; wrong role references: {wrong or 'none'}")

# ---- 6. Timetable is the real one ----------------------------------------------
tt = q("SELECT code, direction, scheduled_time FROM trips ORDER BY scheduled_time")
record("Timetable matches the real schedule", tt == REAL_TIMETABLE, f"found {tt}")

# ---- 7. Trip runs cover 5 operating days ---------------------------------------
runs = q("""SELECT r.id, t.code, t.direction, t.scheduled_time, r.run_date, r.bus_id, r.driver_id,
                   r.status, r.actual_start, r.actual_end
            FROM trip_runs r JOIN trips t ON t.id = r.trip_id ORDER BY r.run_date, t.scheduled_time""")
dates = sorted({r[4] for r in runs})
dts = [date.fromisoformat(d) for d in dates]
consecutive = all((b - a).days == 1 or (a.weekday() == 3 and (b - a).days == 2) for a, b in zip(dts, dts[1:]))
weekdays_ok = all(d.weekday() in OPERATING_WEEKDAYS for d in dts)
per_day_ok = all(sum(1 for r in runs if r[4] == d) == 5 for d in dates)
record("30 trip runs: 5 trips on each of 6 consecutive operating days (Saturday to Thursday, Friday off)",
       len(runs) == 30 and len(dates) == 6 and consecutive and weekdays_ok and per_day_ok,
       f"{len(runs)} runs on {dates}")

# ---- 8. Assignments complete -----------------------------------------------------
unassigned = [r[0] for r in runs if r[5] is None or r[6] is None]
record("Every trip run has a bus and a driver assigned", not unassigned,
       f"unassigned runs: {unassigned or 'none'}")

# ---- 9. Status matches the data -------------------------------------------------
pings_by_run = {}
for (rid, t_, lat, lon, spd, bus, dev) in q(
        "SELECT trip_run_id, timestamp, lat, lon, speed_kmh, bus_id, device_id FROM gps_pings ORDER BY trip_run_id, timestamp"):
    pings_by_run.setdefault(rid, []).append((ts(t_), lat, lon, spd, bus, dev))
status_bad = []
for r in runs:
    rid, status, a_start, a_end = r[0], r[7], r[8], r[9]
    n = len(pings_by_run.get(rid, []))
    if status == "completed" and not (a_start and a_end and n >= 2):
        status_bad.append(f"run {rid} completed without start/end/pings")
    if status in ("scheduled", "cancelled") and (a_start or a_end or n):
        status_bad.append(f"run {rid} {status} but has times or pings")
    if status == "in_progress" and not a_start:
        status_bad.append(f"run {rid} in progress without a start")
counts = {s: sum(1 for r in runs if r[7] == s) for s in ("completed", "scheduled", "cancelled", "in_progress")}
record("Run status matches its data (completed has pings; scheduled and cancelled have none)", not status_bad,
       f"statuses: {counts}; problems: {status_bad or 'none'}")

# ---- 10. Snapshot consistency ---------------------------------------------------
snapshot = datetime.combine(dts[-1], datetime.strptime(SNAPSHOT_TIME, "%H:%M").time())
snap_bad = []
for r in runs:
    sched = datetime.combine(date.fromisoformat(r[4]), datetime.strptime(r[3], "%H:%M").time())
    if r[7] == "scheduled" and sched <= snapshot:
        snap_bad.append(f"run {r[0]} scheduled but in the past")
    if r[7] == "completed" and ts(r[9]) > snapshot:
        snap_bad.append(f"run {r[0]} completed in the future")
record(f"Data is consistent with 'now' ({snapshot.isoformat()}): upcoming runs scheduled, past runs finished",
       not snap_bad, f"problems: {snap_bad or 'none'}")

# ---- 11. No double-booking -------------------------------------------------------
busy = {}
for r in runs:
    if r[7] == "cancelled":
        continue
    sched = datetime.combine(date.fromisoformat(r[4]), datetime.strptime(r[3], "%H:%M").time())
    start = ts(r[8]) if r[8] else sched
    end = ts(r[9]) if r[9] else sched + timedelta(minutes=PLANNED_RUN_MIN)
    busy.setdefault(("driver", r[6], r[4]), []).append((start, end, r[0]))
    busy.setdefault(("bus", r[5], r[4]), []).append((start, end, r[0]))
clashes = []
for key, items in busy.items():
    items.sort()
    for (s1, e1, id1), (s2, e2, id2) in zip(items, items[1:]):
        if s2 < e1:
            clashes.append(f"{key[0]} {key[1]}: runs {id1} and {id2} overlap on {key[2]}")
record("No driver or bus is assigned to two overlapping trips", not clashes, f"clashes: {clashes or 'none'}")

# ---- 12. Pings belong to the right bus and device -------------------------------
bus_info = {b[0]: b[1] for b in q("SELECT id, device_id FROM buses")}
run_bus = {r[0]: r[5] for r in runs}
completed_ids = {r[0] for r in runs if r[7] == "completed"}
ping_bad = 0
for rid, pings in pings_by_run.items():
    for p in pings:
        if rid not in completed_ids or p[4] != run_bus[rid] or p[5] != bus_info.get(p[4]):
            ping_bad += 1
record("Every ping belongs to a completed run, its assigned bus and that bus's phone", ping_bad == 0,
       f"{ping_bad} pings with a wrong run, bus or device (of {sum(len(v) for v in pings_by_run.values())})")

# ---- 13. Pings fit the run window -----------------------------------------------
window_bad = 0
for r in runs:
    if r[7] == "completed":
        p = pings_by_run[r[0]]
        if p[0][0] != ts(r[8]) or p[-1][0] != ts(r[9]):
            window_bad += 1
record("First and last ping equal the run's actual start and end", window_bad == 0,
       f"{window_bad} runs where they differ")

# ---- 14. Ping interval and order ------------------------------------------------
bad_int = back = total_int = 0
for p in pings_by_run.values():
    for a, b in zip(p, p[1:]):
        total_int += 1
        bad_int += (b[0] - a[0]) != timedelta(seconds=PING_INTERVAL_S)
        back += b[0] <= a[0]
record(f"Ping interval = {PING_INTERVAL_S} s and time never goes backwards", bad_int == 0 and back == 0,
       f"{bad_int} of {total_int} intervals differ; {back} backward timestamps")

# ---- 15. Start times against the schedule ---------------------------------------
offsets, off_bad = [], []
for r in runs:
    if r[7] == "completed":
        sched = datetime.combine(date.fromisoformat(r[4]), datetime.strptime(r[3], "%H:%M").time())
        off = (ts(r[8]) - sched).total_seconds() / 60
        offsets.append(off)
        if not (-START_EARLY_MIN <= off <= START_LATE_MIN):
            off_bad.append(f"run {r[0]}: {off:.1f} min")
record(f"Actual start is within -{START_EARLY_MIN} / +{START_LATE_MIN} minutes of the scheduled time", not off_bad,
       f"offsets from {min(offsets):.1f} to {max(offsets):.1f} min; outside the range: {off_bad or 'none'}")

# ---- 16. Route area and endpoints -----------------------------------------------
route = q("SELECT lat, lon FROM route_points WHERE route_id = 1 ORDER BY seq")
first, last = route[0], route[-1]
lat_lo, lat_hi = min(p[0] for p in route) - ROUTE_MARGIN_DEG, max(p[0] for p in route) + ROUTE_MARGIN_DEG
lon_lo, lon_hi = min(p[1] for p in route) - ROUTE_MARGIN_DEG, max(p[1] for p in route) + ROUTE_MARGIN_DEG
outside = sum(1 for ps in pings_by_run.values() for p in ps
              if not (lat_lo <= p[1] <= lat_hi and lon_lo <= p[2] <= lon_hi))
record("All pings are inside the route area", outside == 0, f"{outside} points outside the route bounding box")

end_bad, end_report = [], []
direction_of = {r[0]: r[2] for r in runs}
for rid in completed_ids:
    ps = pings_by_run[rid]
    exp_start, exp_end = (first, last) if direction_of[rid] == "inbound" else (last, first)
    ds = haversine_km(exp_start, (ps[0][1], ps[0][2]))
    de = haversine_km(exp_end, (ps[-1][1], ps[-1][2]))
    end_report.append(max(ds, de))
    if ds > ENDPOINT_TOLERANCE_KM or de > ENDPOINT_TOLERANCE_KM:
        end_bad.append(rid)
record(f"Inbound trips go pickup to campus, outbound trips go campus to pickup (within {ENDPOINT_TOLERANCE_KM} km)",
       not end_bad, f"largest endpoint error {max(end_report):.3f} km; wrong runs: {end_bad or 'none'}")

# ---- 17. Speed range ------------------------------------------------------------
speeds = [p[3] for ps in pings_by_run.values() for p in ps]
first_nonzero = sum(1 for ps in pings_by_run.values() if ps[0][3] != 0)
record(f"Speeds are realistic (0 to {MAX_SPEED_KMH} km/h; each trip starts at 0)",
       min(speeds) >= 0 and max(speeds) <= MAX_SPEED_KMH and first_nonzero == 0,
       f"min {min(speeds):.1f}, max {max(speeds):.1f}, mean {sum(speeds) / len(speeds):.1f} km/h; "
       f"{first_nonzero} trips with a non-zero first speed")

# ---- 18. Speed matches distance moved ------------------------------------------
# The bus follows the road, so the distance moved is measured ALONG the route: each ping is
# projected onto the route path, and the implied speed is the change in that position.
_lat0 = route[0][0]
_kx, _ky = 111.32 * math.cos(math.radians(_lat0)), 110.574
_xy = [((p[1] - route[0][1]) * _kx, (p[0] - _lat0) * _ky) for p in route]
_cum = [0.0]
for (ax, ay), (bx, by) in zip(_xy, _xy[1:]):
    _cum.append(_cum[-1] + math.hypot(bx - ax, by - ay))


def along_km(lat, lon):
    px, py = (lon - route[0][1]) * _kx, (lat - _lat0) * _ky
    best, s = float("inf"), 0.0
    for i in range(len(_xy) - 1):
        (ax, ay), (bx, by) = _xy[i], _xy[i + 1]
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1e-12)))
        d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        if d < best:
            best, s = d, _cum[i] + t * (_cum[i + 1] - _cum[i])
    return s


errs = []
for ps in pings_by_run.values():
    pos = [along_km(p[1], p[2]) for p in ps]
    for k in range(1, len(ps)):
        implied = abs(pos[k] - pos[k - 1]) / (PING_INTERVAL_S / 3600)
        errs.append(abs(implied - ps[k][3]))
mae = sum(errs) / len(errs)
record(f"Reported speed matches the distance moved along the route since the previous ping (mean error < {SPEED_TOLERANCE_KMH} km/h)",
       mae < SPEED_TOLERANCE_KMH, f"mean error {mae:.2f} km/h, max {max(errs):.1f} km/h over {len(errs)} intervals")

# ---- 19. Problem reports ---------------------------------------------------------
run_info = {r[0]: r for r in runs}
pr_bad = []
reports = q("SELECT id, trip_run_id, driver_id, report_type, created_at FROM problem_reports")
for (pid, rid, did, rtype, created) in reports:
    r = run_info[rid]
    sched = datetime.combine(date.fromisoformat(r[4]), datetime.strptime(r[3], "%H:%M").time())
    c = ts(created)
    if r[6] != did:
        pr_bad.append(f"report {pid}: not the driver of run {rid}")
    if r[7] == "completed" and not (ts(r[8]) <= c <= ts(r[9])):
        pr_bad.append(f"report {pid}: outside the run window")
    if r[7] == "cancelled" and c >= sched:
        pr_bad.append(f"report {pid}: made after the cancelled trip's time")
cancelled_without = [r[0] for r in runs if r[7] == "cancelled" and not any(x[1] == r[0] for x in reports)]
record("Problem reports are made by the run's driver at a sensible time; every cancelled run has one",
       not pr_bad and not cancelled_without,
       f"{len(reports)} reports; problems: {pr_bad or 'none'}; cancelled runs without a report: {cancelled_without or 'none'}")

# ---- 20. Assignment changes -----------------------------------------------------
ac_bad = []
changes = q("SELECT id, trip_run_id, old_driver_id, new_driver_id, old_bus_id, new_bus_id, changed_at FROM assignment_changes")
for (cid, rid, od, nd, ob, nb, when) in changes:
    r = run_info[rid]
    sched = datetime.combine(date.fromisoformat(r[4]), datetime.strptime(r[3], "%H:%M").time())
    if (nd, nb) != (r[6], r[5]):
        ac_bad.append(f"change {cid}: does not match the run's current assignment")
    if (od, ob) == (nd, nb):
        ac_bad.append(f"change {cid}: nothing changed")
    if ts(when) >= sched:
        ac_bad.append(f"change {cid}: made after the trip's scheduled time")
record("Assignment changes match the current assignment and were made before the trip", not ac_bad,
       f"{len(changes)} changes; problems: {ac_bad or 'none'}")

# ---- 21. Alerts and rider reports ---------------------------------------------
stop_route = dict(q("SELECT id, route_id FROM stops"))
trip_route = {r[0]: 1 for r in runs}
al_bad = []
alerts = q("SELECT id, user_id, trip_run_id, stop_id, minutes_before, created_at FROM alerts")
for (aid, uid, rid, sid, mins, created) in alerts:
    r = run_info[rid]
    sched = datetime.combine(date.fromisoformat(r[4]), datetime.strptime(r[3], "%H:%M").time())
    if r[7] != "scheduled":
        al_bad.append(f"alert {aid}: run {rid} is not upcoming")
    if mins not in (2, 5, 10):
        al_bad.append(f"alert {aid}: odd lead time {mins}")
    if stop_route.get(sid) != trip_route[rid]:
        al_bad.append(f"alert {aid}: stop not on the trip's route")
    if not (ts(created) <= snapshot and ts(created) < sched):
        al_bad.append(f"alert {aid}: created at a wrong time")
rr_bad = []
rreports = q("SELECT id, trip_run_id, created_at FROM rider_reports")
for (rid_, rid, created) in rreports:
    r = run_info[rid]
    if r[7] != "completed" or not (ts(r[8]) <= ts(created) <= ts(r[9])):
        rr_bad.append(f"rider report {rid_}")
record("Alerts are for upcoming runs on the right route; rider reports are inside completed runs",
       not al_bad and not rr_bad,
       f"{len(alerts)} alerts, {len(rreports)} rider reports; problems: {(al_bad + rr_bad) or 'none'}")

# ---- 22. Placeholder phone numbers only --------------------------------------
phone_bad = []
for (uid, role, phone) in q("SELECT id, role, phone FROM users"):
    if phone and (role != "driver" or not PHONE_FORMAT.match(phone)):
        phone_bad.append(f"user {uid}")
record("Phone numbers are placeholders (+20-000-000-xxxx) and only drivers have one", not phone_bad,
       f"problems: {phone_bad or 'none'}")

# ---- 23. Demo situations are present ---------------------------------------------
delayed = [r[0] for r in runs if r[7] == "completed" and
           (ts(r[8]) - datetime.combine(date.fromisoformat(r[4]), datetime.strptime(r[3], "%H:%M").time())).total_seconds() >= 600]
delayed_with_report = [rid for rid in delayed if any(x[1] == rid and x[3] == "traffic_delay" for x in reports)]
driver_swaps = [c for c in changes if c[2] != c[3]]
bus_swaps = [c for c in changes if c[4] != c[5]]
has_full = any(x[3] == "bus_full" for x in reports) and len(rreports) >= 1
cancelled = [r[0] for r in runs if r[7] == "cancelled"]
record("The data contains the situations each interface needs to show",
       bool(delayed_with_report) and bool(cancelled) and bool(driver_swaps) and bool(bus_swaps) and has_full,
       f"delayed with a report: {delayed_with_report}; cancelled: {cancelled}; driver swaps: {len(driver_swaps)}; "
       f"bus swaps: {len(bus_swaps)}; 'bus full' reports present: {has_full}")

con.close()
passed = sum(1 for _, p, _ in results if p)
print(f"\nSUMMARY: {passed}/{len(results)} checks passed")
sys.exit(0 if passed == len(results) else 1)
