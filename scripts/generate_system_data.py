"""
GIU on the Move: system data generator
=======================================
Generates simulated data for ALL THREE ROLES (rider, driver, admin) and loads it
into a SQLite database.

What is REAL:        the timetable (5 trips: 08:00, 10:00, 13:45, 15:30, 17:30).
What is PLACEHOLDER: names, plates, phone numbers, the route and the stops.
What is SIMULATED:   assignments, GPS pings, delays, reports and alerts.

Usage (from the project folder):
    python3 scripts/generate_system_data.py
    python3 scripts/generate_system_data.py --start 2026-10-03     # first operating day (a Saturday)

Output:
    data/*.csv                  one file per table
    data/giu_on_the_move.db     the same data, loaded into SQLite (foreign keys enforced)

Uses only Python's standard library.
"""

import argparse
import csv
import math
import random
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "giu_on_the_move.db"
SCHEMA_PATH = ROOT / "database" / "schema.sql"

SEED = 42
OPERATING_DAYS = 6                      # Saturday to Thursday (Friday is the day off)
PING_INTERVAL_S = 30                    # a phone reporting every 30 seconds
GPS_NOISE_M = 8                         # consumer GPS imprecision
TRIP_DURATION_MIN = 40                  # placeholder one-way travel time
SNAPSHOT_TIME = "13:40"                 # "now" on the last day: the 13:45 trip has not left yet

# ---- Placeholder route (REPLACE with the real pickup point and campus gate) --
ROUTE_START = (30.0500, 31.3310)        # placeholder pickup point (Cairo side)
ROUTE_END = (30.0250, 31.7450)          # placeholder campus gate (New Administrative Capital)
N_ROUTE_POINTS = 41

# ---- The REAL timetable ------------------------------------------------------
TRIPS = [
    # id, code, label, direction, scheduled_time
    (1, "arrival_first", "Morning inbound", "inbound", "08:00"),
    (2, "arrival_second", "Mid-morning inbound", "inbound", "10:00"),
    (3, "departure_first", "Afternoon express (short round)", "outbound", "13:45"),
    (4, "departure_second", "Evening departure", "outbound", "15:30"),
    (5, "departure_third", "Late evening departure", "outbound", "17:30"),
]

# ---- Placeholder people and buses -------------------------------------------
ADMIN = (1, "Admin (placeholder)", "admin", "admin")
DRIVERS = [  # id, name, username, share_phone  (names are placeholders)
    (2, "Ahmed Hassan", "driver1", 1),     # kept so the data matches the Stitch screens
    (3, "Mahmoud Samir", "driver2", 1),
    (4, "Youssef Adel", "driver3", 0),     # does not share his number: shows the admin's visibility control
    (5, "Karim Nabil", "driver4", 1),
]
N_RIDERS = 10
BUSES = [  # id, number, plate, capacity, device
    (1, "04", "TEST-004", 48, "phone_bus_04"),
    (2, "07", "TEST-007", 48, "phone_bus_07"),
    (3, "11", "TEST-011", 48, "phone_bus_11"),
]

TABLE_COLUMNS = {
    "users": ["id", "name", "role", "username", "password_hash", "phone", "share_phone"],
    "buses": ["id", "bus_number", "plate", "capacity", "status", "device_id"],
    "routes": ["id", "name"],
    "route_points": ["route_id", "seq", "lat", "lon"],
    "stops": ["id", "route_id", "name", "lat", "lon", "seq"],
    "trips": ["id", "code", "label", "route_id", "direction", "scheduled_time"],
    "trip_runs": ["id", "trip_id", "run_date", "bus_id", "driver_id", "status", "actual_start", "actual_end"],
    "gps_pings": ["id", "trip_run_id", "bus_id", "device_id", "timestamp", "lat", "lon", "speed_kmh"],
    "problem_reports": ["id", "trip_run_id", "driver_id", "report_type", "note", "created_at"],
    "assignment_changes": ["id", "trip_run_id", "old_driver_id", "new_driver_id", "old_bus_id",
                           "new_bus_id", "changed_by", "reason", "changed_at"],
    "alerts": ["id", "user_id", "trip_run_id", "stop_id", "minutes_before", "created_at"],
    "rider_reports": ["id", "user_id", "trip_run_id", "report_type", "created_at"],
}
LOAD_ORDER = ["users", "buses", "routes", "route_points", "stops", "trips", "trip_runs",
              "gps_pings", "problem_reports", "assignment_changes", "alerts", "rider_reports"]


# ---- Geometry and speed helpers (same logic as the earlier GPS generator) ----

def interpolate(p1, p2, fraction):
    return (p1[0] + (p2[0] - p1[0]) * fraction, p1[1] + (p2[1] - p1[1]) * fraction)


def haversine_km(p1, p2):
    R = 6371.0
    lat1, lon1 = math.radians(p1[0]), math.radians(p1[1])
    lat2, lon2 = math.radians(p2[0]), math.radians(p2[1])
    a = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def add_gps_noise(rng, lat, lon, noise_m):
    lat_noise = (rng.uniform(-1, 1) * noise_m) / 111320
    lon_noise = (rng.uniform(-1, 1) * noise_m) / (111320 * math.cos(math.radians(lat)))
    return lat + lat_noise, lon + lon_noise


def target_speed_kmh(t, rng):
    """Local roads, then highway cruise (75-100 km/h), then slow approach."""
    if t < 0.05:
        base = 10 + (t / 0.05) * 20
    elif t < 0.12:
        base = 30 + ((t - 0.05) / 0.07) * 50
    elif t < 0.77:
        base = rng.uniform(75, 100)
    elif t < 0.90:
        base = 85 - ((t - 0.77) / 0.13) * 55
    else:
        base = max(0, 30 - ((t - 0.90) / 0.10) * 30)
    return max(0, base + rng.uniform(-4, 4))


def generate_pings(rng, start_dt, direction, heavy_traffic):
    """Pings for one trip run: (timestamp, lat, lon, speed_kmh) every 30 s."""
    start, end = (ROUTE_START, ROUTE_END) if direction == "inbound" else (ROUTE_END, ROUTE_START)
    total_km = haversine_km(start, end)

    duration_s = TRIP_DURATION_MIN * 60 + rng.uniform(-120, 240) + (480 if heavy_traffic else 0)
    n = int(duration_s / PING_INTERVAL_S)

    if heavy_traffic:
        cong_start, cong_len = rng.uniform(0.25, 0.40), 0.18
    elif rng.random() < 0.5:
        cong_start, cong_len = rng.uniform(0.30, 0.45), 0.06
    else:
        cong_start, cong_len = None, 0.0

    raw_speeds = []
    for i in range(n + 1):
        t = i / n
        if cong_start is not None and cong_start <= t <= cong_start + cong_len:
            raw_speeds.append(rng.uniform(5, 15) if heavy_traffic else rng.uniform(8, 18))
        else:
            raw_speeds.append(target_speed_kmh(t, rng))

    raw_dist = [s * (PING_INTERVAL_S / 3600) for s in raw_speeds]
    scale = total_km / (sum(raw_dist) or 1e-9)
    speeds = [s * scale for s in raw_speeds]

    pings, cum = [], 0.0
    for i in range(n + 1):
        fraction = min(1.0, cum / total_km) if i > 0 else 0.0
        lat, lon = add_gps_noise(rng, *interpolate(start, end, fraction), GPS_NOISE_M)
        speed = speeds[i - 1] if i > 0 else 0.0   # a phone reports the speed it has just travelled
        pings.append((start_dt + timedelta(seconds=i * PING_INTERVAL_S), round(lat, 6), round(lon, 6), round(speed, 1)))
        cum += raw_dist[i] * scale
    return pings


def iso(dt):
    return dt.replace(microsecond=0).isoformat()


# ---- Build every table ------------------------------------------------------

def build(start_date):
    rng = random.Random(SEED)
    T = {name: [] for name in TABLE_COLUMNS}

    # users
    T["users"].append([ADMIN[0], ADMIN[1], "admin", ADMIN[3], "", "", 0])
    for uid, name, uname, share in DRIVERS:
        T["users"].append([uid, name, "driver", uname, "", f"+20-000-000-{uid:04d}", share])
    rider_ids = []
    for k in range(1, N_RIDERS + 1):
        uid = 5 + k
        rider_ids.append(uid)
        T["users"].append([uid, f"Student {k:02d}", "rider", f"student{k:02d}", "", "", 0])

    # buses, route, stops, timetable
    for bid, number, plate, cap, dev in BUSES:
        T["buses"].append([bid, number, plate, cap, "active", dev])
    T["routes"].append([1, "Pilot route (placeholder)"])
    for s in range(N_ROUTE_POINTS):
        lat, lon = interpolate(ROUTE_START, ROUTE_END, s / (N_ROUTE_POINTS - 1))
        T["route_points"].append([1, s + 1, round(lat, 6), round(lon, 6)])
    stop_names = ["Stop 1 (pickup point)", "Stop 2", "Stop 3", "Stop 4", "Stop 5", "Campus gate"]
    for k, name in enumerate(stop_names):
        lat, lon = interpolate(ROUTE_START, ROUTE_END, k / (len(stop_names) - 1))
        T["stops"].append([k + 1, 1, name, round(lat, 6), round(lon, 6), k + 1])
    for tid, code, label, direction, hhmm in TRIPS:
        T["trips"].append([tid, code, label, 1, direction, hhmm])

    # operating days (Saturday to Thursday)
    days = [start_date + timedelta(days=d) for d in range(OPERATING_DAYS)]
    snapshot_dt = datetime.combine(days[-1], datetime.strptime(SNAPSHOT_TIME, "%H:%M").time())

    # trip runs: assignment pattern, with a few deliberate overrides
    runs = []   # dicts
    for d, day in enumerate(days):
        for t, (tid, code, label, direction, hhmm) in enumerate(TRIPS):
            sched_dt = datetime.combine(day, datetime.strptime(hhmm, "%H:%M").time())
            bus_id = BUSES[(d + t) % len(BUSES)][0]
            driver_id = DRIVERS[(2 * d + t) % len(DRIVERS)][0]
            if d == OPERATING_DAYS - 1 and tid == 3:       # Thursday 13:45: matches the Stitch screens
                bus_id, driver_id = 1, 2                    # Bus #04, Ahmed Hassan
            runs.append({"id": d * len(TRIPS) + t + 1, "trip": TRIPS[t], "day": day, "sched": sched_dt,
                         "bus": bus_id, "driver": driver_id, "status": "completed",
                         "start": None, "end": None, "delay_min": 0, "heavy": False})

    def run_at(d, tid):
        return runs[d * len(TRIPS) + (tid - 1)]

    # Situations built into the data
    swap_run = run_at(2, 2)           # 3rd operating day, 10:00: the driver was swapped
    old_driver = swap_run["driver"]
    swap_run["driver"] = 4 if old_driver != 4 else 5
    swap_driver_new = swap_run["driver"]

    bus_swap_run = run_at(OPERATING_DAYS - 1, 4)   # last day 15:30 (still upcoming): the bus was swapped
    old_bus = bus_swap_run["bus"]
    bus_swap_run["bus"] = 2 if old_bus != 2 else 3
    bus_swap_new = bus_swap_run["bus"]

    delayed_run = run_at(1, 4)        # 2nd operating day, 15:30: left 12 min late in heavy traffic
    delayed_run["delay_min"], delayed_run["heavy"] = 12, True

    cancelled_run = run_at(OPERATING_DAYS - 2, 5)  # day before the last, 17:30: cancelled (breakdown)
    cancelled_run["status"] = "cancelled"

    for r in runs:                     # the last day, after the snapshot: not run yet
        if r["sched"] > snapshot_dt:
            r["status"] = "scheduled"

    # GPS pings for completed runs
    ping_id = 1
    bus_device = {b[0]: b[4] for b in BUSES}
    for r in runs:
        T_trip = r["trip"]
        if r["status"] != "completed":
            continue
        offset_s = r["delay_min"] * 60 + rng.randint(0, 60) if r["delay_min"] else rng.randint(-60, 180)
        start_dt = r["sched"] + timedelta(seconds=offset_s)
        pings = generate_pings(rng, start_dt, T_trip[3], r["heavy"])
        r["start"], r["end"] = start_dt, pings[-1][0]
        for ts, lat, lon, spd in pings:
            T["gps_pings"].append([ping_id, r["id"], r["bus"], bus_device[r["bus"]], iso(ts), lat, lon, spd])
            ping_id += 1

    for r in runs:
        T["trip_runs"].append([r["id"], r["trip"][0], r["day"].isoformat(), r["bus"], r["driver"], r["status"],
                               iso(r["start"]) if r["start"] else "", iso(r["end"]) if r["end"] else ""])

    # problem reports (made by the driver of the run)
    def add_problem(run, rtype, note, when):
        T["problem_reports"].append([len(T["problem_reports"]) + 1, run["id"], run["driver"], rtype, note, iso(when)])

    add_problem(run_at(0, 1), "bus_full", "Bus full after the second stop (placeholder note)", run_at(0, 1)["start"] + timedelta(minutes=15))
    add_problem(delayed_run, "traffic_delay", "Heavy traffic on the highway (placeholder note)", delayed_run["start"] + timedelta(minutes=8))
    add_problem(cancelled_run, "breakdown", "Bus will not start (placeholder note)", cancelled_run["sched"] - timedelta(minutes=25))

    # assignment changes (made by the admin before the trip)
    T["assignment_changes"].append([1, swap_run["id"], old_driver, swap_driver_new, swap_run["bus"], swap_run["bus"], 1,
                                    "Original driver unavailable (placeholder)", iso(swap_run["sched"] - timedelta(days=1, hours=-6))])
    T["assignment_changes"].append([2, bus_swap_run["id"], bus_swap_run["driver"], bus_swap_run["driver"], old_bus, bus_swap_new, 1,
                                    "Original bus needed for service (placeholder)", iso(snapshot_dt - timedelta(days=1, hours=-4))])

    # rider reports: "the bus was full"
    for rid, run in ((rider_ids[1], run_at(0, 1)), (rider_ids[3], run_at(2, 3))):
        T["rider_reports"].append([len(T["rider_reports"]) + 1, rid, run["id"], "bus_full", iso(run["start"] + timedelta(minutes=4))])

    # alerts for the upcoming runs of the last day (5 min is the most popular lead time in the survey)
    upcoming = [r for r in runs if r["status"] == "scheduled"]
    lead_times = [5, 5, 5, 5, 5, 10, 10, 10, 10, 2]
    stop_choices = [6, 6, 6, 6, 6, 6, 5, 4, 3, 2]
    for k, rid in enumerate(rider_ids):
        run = upcoming[k % len(upcoming)]
        made = snapshot_dt - timedelta(minutes=rng.randint(15, 180))
        T["alerts"].append([k + 1, rid, run["id"], stop_choices[k], lead_times[k], iso(made)])

    return T, days, snapshot_dt


# ---- Output ------------------------------------------------------------------

def write_csvs(tables):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for name, rows in tables.items():
        with open(DATA_DIR / f"{name}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(TABLE_COLUMNS[name])
            w.writerows(rows)


def build_database():
    if DB_PATH.exists():
        DB_PATH.unlink()
    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    for name in LOAD_ORDER:
        types = {row[1]: row[2] for row in con.execute(f"PRAGMA table_info({name})")}
        cols = TABLE_COLUMNS[name]
        with open(DATA_DIR / f"{name}.csv", newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            batch = []
            for row in reader:
                vals = []
                for c in cols:
                    v = row[c]
                    if v == "":
                        vals.append(None)
                    elif types[c] == "INTEGER":
                        vals.append(int(v))
                    elif types[c] == "REAL":
                        vals.append(float(v))
                    else:
                        vals.append(v)
                batch.append(vals)
        con.executemany(f"INSERT INTO {name} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", batch)
    con.commit()
    bad = con.execute("PRAGMA foreign_key_check").fetchall()
    con.close()
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2026-10-03", help="first operating day (must be a Saturday)")
    args = ap.parse_args()
    start_date = date.fromisoformat(args.start)
    if start_date.weekday() != 5:
        sys.exit("The start date must be a Saturday (operating days are Saturday to Thursday).")

    tables, days, snapshot_dt = build(start_date)
    write_csvs(tables)
    bad = build_database()
    if bad:
        sys.exit(f"Foreign key problems found: {bad}")

    print(f"Operating days: {days[0]} to {days[-1]} (snapshot: {snapshot_dt.isoformat()})")
    for name in LOAD_ORDER:
        print(f"  {name:20s} {len(tables[name]):5d} rows")
    print(f"Database written to {DB_PATH.relative_to(ROOT)} (foreign keys verified)")


if __name__ == "__main__":
    main()
