"""
GIU on the Move: build the real route from a recorded GPS trip
==============================================================
Reads one GPX file recorded on a real GIU shuttle trip and writes the route the app uses.

What is REAL:      the path the bus drove (every second, from the GPX file), the stops where the
                   recorded bus stopped to pick up students, and the trip's start and end times.
What is PLACED:    further stops put on the recorded route to demonstrate the stop features
                   (PLACED_STOPS_KM), marked source=placed.
What is ESTIMATED: the first part of the route, where the phone did not record (the GPX file has
                   no points between two times). It is filled with a straight line between the last
                   point before and the first point after the gap, marked source=estimated.

Usage (from the project folder):
    python3 scripts/build_real_route.py data/real/trip1_2026-11-22.gpx

Output (data/real/):
    route_points.csv   route_id, seq, lat, lon, source (recorded | estimated), inbound direction
    stops.csv          id, route_id, name, lat, lon, seq, source (recorded | placed): all stops, used by the app
    stops_recorded.csv the stops where the recorded bus is known to stop, used by the ETA experiments
    route_meta.json    length, the gap, the observed times, how the stops were found

Uses only Python's standard library.
"""

import csv
import json
import math
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "real"

ROUTE_NAME = "First Settlement line (Gate 2, El Nakhl to GIU)"
SIMPLIFY_M = 5            # keep every bend that moves the path by more than 5 m
GAP_S = 300               # a pause of more than 5 minutes between two points = not recorded
ESTIMATE_STEP_M = 100     # the estimated part gets a point every 100 m
STOP_SPEED_KMH = 3        # slower than this over 10 s = standing still
STOP_MIN_S = 60           # a pickup stop: standing still for at least one minute
# Further stops PLACED along the recorded route (km from the start), to demonstrate the stop features,
# because the official stop list was not available. They are spaced every 2 to 3 km over the recorded
# residential part (km 7.2 to 29.2), including the two places where the recorded bus slowed down
# (06:59 at km 7.2 and 07:29 at km 29.2). None is placed on the not-recorded first 4.75 km (its road is
# unknown) or on the highway after km 29. Marked source=placed in stops.csv.
PLACED_STOPS_KM = [7.2, 9.1, 10.9, 16.1, 18.0, 19.9, 25.3, 27.3, 29.2]   # every stop at least 1 km from any other
CAIRO = timedelta(hours=2)
NS = {"g": "http://www.topografix.com/GPX/1/1"}


def read_gpx(path):
    pts = []
    for p in ET.parse(path).getroot().iterfind(".//g:trkpt", NS):
        t = datetime.fromisoformat(p.find("g:time", NS).text.replace("Z", "+00:00"))
        pts.append((float(p.get("lat")), float(p.get("lon")), t))
    if len(pts) < 2:
        sys.exit("The GPX file has fewer than two points.")
    return pts


def dist_m(a, b):
    r = 6371000
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def simplify(points, tol_m):
    """Douglas-Peucker on a local flat projection (fine at city scale)."""
    if len(points) < 3:
        return points
    lat0 = points[0][0]
    kx = 111320 * math.cos(math.radians(lat0))
    xy = [((p[1] - points[0][1]) * kx, (p[0] - lat0) * 110574) for p in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        (ax, ay), (bx, by) = xy[i], xy[j]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy or 1e-9
        best, idx = -1, None
        for k in range(i + 1, j):
            px, py = xy[k]
            t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
            d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best:
                best, idx = d, k
        if idx is not None and best > tol_m:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [p for p, k in zip(points, keep) if k]


def speeds_10s(pts):
    out = []
    for i in range(len(pts)):
        j = i
        while j < len(pts) - 1 and (pts[j][2] - pts[i][2]).total_seconds() < 10:
            j += 1
        dt = (pts[j][2] - pts[i][2]).total_seconds()
        out.append(dist_m(pts[i], pts[j]) / dt * 3.6 if dt > 0 else 0.0)
    return out


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    pts = read_gpx(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)

    # 1. Find the part that was not recorded
    gaps = [i for i in range(len(pts) - 1) if (pts[i + 1][2] - pts[i][2]).total_seconds() > GAP_S]
    if len(gaps) > 1:
        sys.exit("More than one long gap: this script fills only one.")
    resume = gaps[0] + 1 if gaps else 1

    # 2. The path: start point, straight estimate across the gap, then the recorded track (simplified)
    start = pts[0]
    recorded = simplify(pts[resume:], SIMPLIFY_M)
    path = [(start[0], start[1], "recorded")]
    first = recorded[0]
    n = max(1, int(dist_m(start, first) // ESTIMATE_STEP_M))
    for k in range(1, n):
        f = k / n
        path.append((start[0] + (first[0] - start[0]) * f, start[1] + (first[1] - start[1]) * f, "estimated"))
    path += [(p[0], p[1], "recorded") for p in recorded]

    cum = [0.0]
    for a, b in zip(path, path[1:]):
        cum.append(cum[-1] + dist_m(a, b))

    # 3. Stops: where the recorded bus stood still for at least a minute (pickups), plus start and end
    sp = speeds_10s(pts)
    halts, i = [], resume
    while i < len(pts):
        if sp[i] < STOP_SPEED_KMH:
            j = i
            while j < len(pts) and sp[j] < STOP_SPEED_KMH:
                j += 1
            last = pts[min(j, len(pts) - 1)]
            if (last[2] - pts[i][2]).total_seconds() >= STOP_MIN_S and j < len(pts) - 1:
                mid = pts[(i + j) // 2]
                halts.append({"lat": mid[0], "lon": mid[1], "from": pts[i][2], "seconds": (last[2] - pts[i][2]).total_seconds()})
            i = j
        else:
            i += 1

    def near_km(p):
        best = min(range(len(path)), key=lambda k: dist_m(p, path[k]))
        return cum[best] / 1000

    # (km along the route, lat, lon, source); the middle stops are numbered in route order afterwards
    middle = [(near_km((h["lat"], h["lon"])), h["lat"], h["lon"], "recorded") for h in halts]
    for km in PLACED_STOPS_KM:
        k = min(range(len(path)), key=lambda i: abs(cum[i] / 1000 - km))
        middle.append((cum[k] / 1000, path[k][0], path[k][1], "placed"))
    middle.sort()
    stops = [("Gate 2 (El Nakhl)", start[0], start[1], "recorded")]
    for n, (_, lat, lon, src) in enumerate(middle, start=2):
        stops.append((f"Stop {n}", lat, lon, src))
    stops.append(("GIU campus", pts[-1][0], pts[-1][1], "recorded"))

    # 4. Write the files
    with open(OUT / "route_points.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["route_id", "seq", "lat", "lon", "source"])
        for k, (lat, lon, src) in enumerate(path, start=1):
            w.writerow([1, k, round(lat, 6), round(lon, 6), src])
    with open(OUT / "stops.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "route_id", "name", "lat", "lon", "seq", "source"])
        for k, (name, lat, lon, src) in enumerate(stops, start=1):
            w.writerow([k, 1, name, round(lat, 6), round(lon, 6), k, src])

    # The stops where the recorded bus is known to stop (start, pickups, campus): the ETA experiment uses
    # only these, because whether a bus stops at a placed stop is unknown.
    with open(OUT / "stops_recorded.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "route_id", "name", "lat", "lon", "seq", "source"])
        for k, (name, lat, lon, src) in enumerate(stops, start=1):
            if src == "recorded":
                w.writerow([k, 1, name, round(lat, 6), round(lon, 6), k, src])

    est_m = sum(dist_m(a, b) for a, b in zip(path, path[1:]) if b[2] == "estimated" or a[2] == "estimated")
    meta = {
        "route_name": ROUTE_NAME,
        "source_file": Path(sys.argv[1]).name,
        "recorded_points": len(pts),
        "route_points": len(path),
        "length_km": round(cum[-1] / 1000, 2),
        "estimated_km": round(est_m / 1000, 2),
        "trip_start_local": (pts[0][2] + CAIRO).strftime("%Y-%m-%d %H:%M:%S"),
        "trip_end_local": (pts[-1][2] + CAIRO).strftime("%Y-%m-%d %H:%M:%S"),
        "trip_minutes": round((pts[-1][2] - pts[0][2]).total_seconds() / 60, 1),
        "not_recorded": None if not gaps else {
            "from_local": (pts[gaps[0]][2] + CAIRO).strftime("%H:%M:%S"),
            "to_local": (pts[resume][2] + CAIRO).strftime("%H:%M:%S"),
            "minutes": round((pts[resume][2] - pts[gaps[0]][2]).total_seconds() / 60, 1),
        },
        "stops": [{"seq": k, "name": s[0], "lat": round(s[1], 6), "lon": round(s[2], 6), "km": round(near_km(s[1:3]), 2), "source": s[3]}
                  for k, s in enumerate(stops, start=1)],
        "pickup_halts": [{"at_local": (h["from"] + CAIRO).strftime("%H:%M:%S"), "seconds": round(h["seconds"])} for h in halts],
        "method": f"Recorded stops = the start, the end and places where the recorded bus stood still for at least {STOP_MIN_S} s; "
                  f"placed stops = points on the recorded route at km {PLACED_STOPS_KM}; "
                  f"path simplified with a {SIMPLIFY_M} m tolerance; the not-recorded part is a straight line.",
    }
    (OUT / "route_meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
