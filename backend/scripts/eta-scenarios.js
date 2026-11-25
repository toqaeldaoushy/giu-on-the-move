// ETA experiment under five simulated traffic scenarios, with a tuning set kept separate from a held-out evaluation set.
// Run from the backend folder:  node scripts/eta-scenarios.js [--route ../data/route_points.csv] [--stops ../data/stops.csv] [--out ../data/scenarios]
// SIMULATED DATA ONLY. Results show how the methods behave under the stated assumptions, not real-world accuracy.
//
// Sources for the assumptions (see the thesis, Chapter 3):
//   Speed limits in Egypt: 60 km/h inside cities, 90 km/h on highways (Egypt Today, traffic law guide).
//   Cairo major corridors: 60-80 km/h expected, 15-40 km/h in congestion (World Bank, Cairo Traffic Congestion Study).
//   Cairo rush hour 2025: 23.2 km/h average, 26.2 morning, 21.1 evening (TomTom Traffic Index).
//   Bus dwell time at stops: about 21-29 s on average (Washington DC study, 2015; not Egyptian data).
//   Bus acceleration about 1.1 m/s2 and braking about 1.3 m/s2 (Keller and Krasna, 2023).
// Dwell at stops is 20-30 s in every scenario: the bus stops briefly, only when someone gets on or off.
// Everything else (incident length, jam zones, signal stops) is an assumption of this study.

import fs from 'node:fs';
import path from 'node:path';
import { buildRoute, haversineKm } from '../src/geo.js';

// ---------- arguments ----------
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const ROUTE_CSV = arg('--route', '../data/route_points.csv');
const STOPS_CSV = arg('--stops', '../data/real/stops_recorded.csv');   // only stops where the bus is known to stop (the placed stops are for the app)
const OUT_DIR = arg('--out', '../data/scenarios');
const SEED = Number(arg('--seed', 20261120));
const TRIPS_PER_SCENARIO = Number(arg('--trips', 30));
const TUNING_PER_SCENARIO = Number(arg('--tuning', 10));

// ---------- fixed settings (same as the system) ----------
const PLANNED_TRIP_MIN = 71;   // config.plannedTripMin: the recorded real trip
const PING_EVERY_S = 30;       // one position every 30 s (NFR5)
const GPS_ERROR_M = 8;         // random offset of up to 8 m per position, as in the existing dataset
const ACCEL = 1.1;             // m/s2
const DECEL = 1.3;             // m/s2
const LOCAL_RADIUS_KM = 1.5;   // road within this distance of a stop counts as local streets

// ---------- small helpers ----------
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const U = (lo, hi) => lo + (hi - lo) * rnd();
const readCsv = (f) => { const [h, ...ls] = fs.readFileSync(f, 'utf8').trim().split('\n'); const c = h.split(','); return ls.map((l) => Object.fromEntries(l.split(',').map((v, i) => [c[i], v]))); };
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const mae = (a) => mean(a.map(Math.abs));

// ---------- route and stops ----------
const pts = readCsv(ROUTE_CSV).sort((a, b) => a.seq - b.seq).map((p) => ({ lat: +p.lat, lon: +p.lon }));
const route = buildRoute(pts);
const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineKm(pts[i - 1], pts[i]));
const L = route.totalKm;
const stops = readCsv(STOPS_CSV).sort((a, b) => a.seq - b.seq).map((s) => ({ name: s.name, lat: +s.lat, lon: +s.lon, sKm: route.project(+s.lat, +s.lon).sKm }));
function pointAt(sKm) { // lat/lon at a distance along the inbound path
  let i = 1; while (i < cum.length - 1 && cum[i] < sKm) i++;
  const t = (sKm - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1e-9);
  return { lat: pts[i - 1].lat + t * (pts[i].lat - pts[i - 1].lat), lon: pts[i - 1].lon + t * (pts[i].lon - pts[i - 1].lon) };
}

// ---------- the five scenarios ----------
// local / main: target speed range in km/h; dwell: seconds at each stop; signalsPerKm: extra short stops on local streets
const SCENARIOS = {
  light:    { label: 'Light traffic', local: [40, 50], main: [80, 90], dwell: [20, 30], signalsPerKm: 0.3, signalStop: [10, 30] },
  normal:   { label: 'Normal day',    local: [30, 40], main: [60, 80], dwell: [20, 30], signalsPerKm: 0.5, signalStop: [20, 60] },
  rush:     { label: 'Rush hour',     local: [10, 25], main: [20, 40], dwell: [20, 30], signalsPerKm: 0.8, signalStop: [30, 90] },
  incident: { label: 'Incident',      local: [30, 40], main: [60, 80], dwell: [20, 30], signalsPerKm: 0.5, signalStop: [20, 60], incident: [10, 15] },
  mixed:    { label: 'Mixed',         local: [25, 45], main: [50, 85], dwell: [20, 30], signalsPerKm: 0.5, signalStop: [20, 60], jams: [1, 3], jamKm: [1, 3], jamSpeed: [5, 20] },
};

// ---------- simulate one trip, 1-second steps ----------
function simulateTrip(sc, direction, depMs) {
  const P = SCENARIOS[sc];
  // distance travelled d runs 0..L in the direction of travel; inbound s = d, outbound s = L - d
  const sOf = (d) => (direction === 'inbound' ? d : L - d);
  const stopD = stops.map((s) => (direction === 'inbound' ? s.sKm : L - s.sKm)).sort((a, b) => a - b);
  const isLocal = (d) => stopD.some((x) => Math.abs(x - d) <= LOCAL_RADIUS_KM);

  // target speed per 500 m segment, drawn once per trip
  const segKm = 0.5; const segs = Math.ceil(L / segKm) + 1;
  const segSpeed = []; for (let k = 0; k < segs; k++) { const d = k * segKm; segSpeed.push(isLocal(d) ? U(...P.local) : U(...P.main)); }
  const jams = [];
  if (P.jams) { const n = Math.round(U(P.jams[0], P.jams[1] + 0.999) - 0.5); for (let j = 0; j < n; j++) { const a = U(0.1 * L, 0.85 * L); jams.push([a, a + U(...P.jamKm), U(...P.jamSpeed)]); } }
  const target = (d) => { let v = segSpeed[Math.min(segs - 1, Math.floor(d / segKm))]; for (const [a, b, s] of jams) if (d >= a && d <= b) v = Math.min(v, s); return v; };

  // planned halts: bus stops (with dwell), signal stops on local streets, one incident
  const halts = [];
  for (let i = 1; i < stopD.length; i++) halts.push({ d: stopD[i], dwell: i === stopD.length - 1 ? 0 : U(...P.dwell), kind: i === stopD.length - 1 ? 'end' : 'stop', idx: i });
  for (let k = 0; k < segs; k++) { const d = k * segKm + U(0, segKm); if (d > 0.3 && d < L - 0.3 && isLocal(d) && !stopD.some((x) => Math.abs(x - d) < 0.2) && rnd() < P.signalsPerKm * segKm) halts.push({ d, dwell: U(...P.signalStop), kind: 'signal' }); }
  if (P.incident) halts.push({ d: U(0.15 * L, 0.85 * L), dwell: U(...P.incident) * 60, kind: 'incident' });
  halts.sort((a, b) => a.d - b.d);

  const departDelayS = sc === 'rush' ? U(0, 300) : U(0, 120); // the bus leaves 0-2 min late (0-5 in rush hour)
  let t = depMs + departDelayS * 1000; let d = 0; let v = 0; // v in m/s
  const stopArrivals = { [0]: t }; let h = 0; let dwellLeft = 0;
  const pings = []; let nextPing = t;
  const ping = () => { const p = pointAt(sOf(d)); const off = U(0, GPS_ERROR_M) / 1000; const ang = U(0, 2 * Math.PI);
    pings.push({ t, lat: p.lat + (off * Math.cos(ang)) / 110.574, lon: p.lon + (off * Math.sin(ang)) / (111.32 * Math.cos((p.lat * Math.PI) / 180)), speed_kmh: Math.max(0, v * 3.6 + U(-1, 1)), d }); };
  let guard = 0;
  while (h < halts.length) {
    if (guard++ > 30000) throw new Error('trip did not finish within 30000 s: check the simulation');
    if (t >= nextPing) { ping(); nextPing += PING_EVERY_S * 1000; }
    if (dwellLeft > 0) { dwellLeft -= 1; t += 1000; continue; }
    const halt = halts[h];
    const distToHalt = (halt.d - d) * 1000; // m
    const vt = target(d) / 3.6;
    const brakeDist = (v * v) / (2 * DECEL);
    if (distToHalt <= Math.max(1, brakeDist)) v = Math.max(0, v - DECEL);
    else if (v < vt) v = Math.min(vt, v + ACCEL);
    else v = Math.max(vt, v - DECEL);
    if (v < 0.5 && distToHalt > 2) v = Math.min(0.5 + ACCEL, vt); // creep to the stop line
    d = Math.min(halt.d, d + v / 1000);
    t += 1000;
    if (halt.d - d < 0.002) { // reached the halt (within 2 m)
      d = halt.d; v = 0;
      if (halt.kind === 'stop' || halt.kind === 'end') stopArrivals[halt.idx] = t;
      dwellLeft = Math.round(halt.dwell); h += 1;
      if (halt.kind === 'end') break;
    }
  }
  ping(); // final position at the end of the route
  return { pings, arrivalMs: t, stopArrivals, stopD, departDelayS };
}

// ---------- the ETA methods ----------
const PLANNED_SPEED = L / (PLANNED_TRIP_MIN / 60);
function predict(method, ctx, params = {}) {
  const { now, remKm, progressKm, recentSpeeds, schedDepMs } = ctx;
  if (method === 'timetable') return schedDepMs + PLANNED_TRIP_MIN * 60000 * ((progressKm + remKm) / L);
  if (method === 'schedule') return now + (remKm / PLANNED_SPEED) * 3600000;
  const w = params.window ?? 6;
  const rs = recentSpeeds.slice(-w); const recent = Math.max(5, mean(rs));
  if (method === 'recent') return now + (remKm / recent) * 3600000;
  // blended: same formula as backend/src/eta.js, with an optional cap on the trust in the recent speed
  const trust = Math.min(params.cap ?? 1, progressKm / (L * (params.trustAfter ?? 0.25)));
  const v = (1 - trust) * PLANNED_SPEED + trust * recent;
  return now + (remKm / v) * 3600000;
}

// evaluation points for one trip: every ping from the 2nd to the 2nd-to-last while < 95% of the route is covered
function evalTrip(trip, method, params) {
  const out = []; const ps = trip.pings;
  for (let i = 1; i < ps.length - 1; i++) {
    const proj = route.project(ps[i].lat, ps[i].lon).sKm;
    const progressKm = trip.direction === 'inbound' ? proj : L - proj;
    const progress = progressKm / L; if (progress >= 0.95) continue;
    const remKm = Math.max(0, L - progressKm);
    const ctx = { now: ps[i].t, remKm, progressKm, recentSpeeds: ps.slice(0, i + 1).map((p) => p.speed_kmh), schedDepMs: trip.schedDepMs };
    const err = (predict(method, ctx, params) - trip.arrivalMs) / 60000;
    // error to every stop still ahead (not the end of the route)
    const stopErr = [];
    for (let k = 1; k < trip.stopD.length - 1; k++) {
      const ahead = trip.stopD[k] - progressKm; if (ahead <= 0.2) continue;
      const sctx = { ...ctx, remKm: ahead };
      let pred = predict(method, sctx, params);
      if (method === 'timetable') pred = trip.schedDepMs + PLANNED_TRIP_MIN * 60000 * (trip.stopD[k] / L);
      stopErr.push((pred - trip.stopArrivals[k]) / 60000);
    }
    out.push({ progress, err, stopErr });
  }
  return out;
}

// ---------- build the dataset ----------
const SCHEDULE = [['inbound', '08:00'], ['inbound', '10:00'], ['outbound', '13:45'], ['outbound', '15:30'], ['outbound', '17:30']];
const trips = [];
for (const sc of Object.keys(SCENARIOS)) {
  for (let k = 0; k < TRIPS_PER_SCENARIO; k++) {
    const [direction, hhmm] = SCHEDULE[k % SCHEDULE.length];
    const day = 1 + Math.floor(k / SCHEDULE.length);
    const schedDepMs = Date.UTC(2026, 10, day, +hhmm.slice(0, 2), +hhmm.slice(3));
    const sim = simulateTrip(sc, direction, schedDepMs);
    trips.push({ id: `${sc}-${String(k + 1).padStart(2, '0')}`, scenario: sc, direction, schedDepMs, ...sim });
  }
}
// fixed split per scenario: shuffle with the seed, first TUNING_PER_SCENARIO trips tune, the rest are held out
for (const sc of Object.keys(SCENARIOS)) {
  const ids = trips.filter((t) => t.scenario === sc);
  const order = ids.map((t) => [rnd(), t]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  order.forEach((t, i) => { t.set = i < TUNING_PER_SCENARIO ? 'tuning' : 'evaluation'; });
}

// ---------- tune the blended method on the tuning trips only ----------
const grid = [];
for (const cap of [0.25, 0.5, 0.75, 1]) for (const window of [6, 10, 20, 40, 80, 1000]) for (const trustAfter of [0.1, 0.25, 0.5, 0.75]) grid.push({ cap, window, trustAfter });
const tuning = trips.filter((t) => t.set === 'tuning');
const tuned = grid.map((p) => ({ p, mae: mae(tuning.flatMap((t) => evalTrip(t, 'blended', p).map((e) => e.err))) })).sort((a, b) => a.mae - b.mae);
const best = tuned[0].p;

// ---------- final evaluation on the held-out trips ----------
const METHODS = [['Timetable', 'timetable', {}], ['Schedule', 'schedule', {}], ['Recent speed', 'recent', {}], ['Blended (first version)', 'blended', { cap: 1, window: 6, trustAfter: 0.25 }], ['Blended (tuned, now in the app)', 'blended', best]];
const evalTrips = trips.filter((t) => t.set === 'evaluation');
const bands = [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 0.95]];
const results = [];
for (const [name, m, p] of METHODS) {
  const row = { method: name, byScenario: {} };
  const all = []; const allStop = []; const byBand = bands.map(() => []);
  for (const sc of Object.keys(SCENARIOS)) {
    const pts2 = evalTrips.filter((t) => t.scenario === sc).flatMap((t) => evalTrip(t, m, p));
    row.byScenario[sc] = { mae: mae(pts2.map((e) => e.err)), bias: mean(pts2.map((e) => e.err)), n: pts2.length };
    all.push(...pts2.map((e) => e.err)); allStop.push(...pts2.flatMap((e) => e.stopErr));
    pts2.forEach((e) => { const b = bands.findIndex(([lo, hi]) => e.progress >= lo && e.progress < hi); if (b >= 0) byBand[b].push(e.err); });
  }
  row.overall = { mae: mae(all), bias: mean(all), n: all.length };
  row.stops = { mae: mae(allStop), bias: mean(allStop), n: allStop.length };
  row.bands = byBand.map((a) => mae(a));
  results.push(row);
}

// ---------- describe the generated trips ----------
const tripStats = {};
for (const sc of Object.keys(SCENARIOS)) {
  const ts = trips.filter((t) => t.scenario === sc);
  const durs = ts.map((t) => (t.arrivalMs - t.schedDepMs) / 60000);
  const moving = ts.flatMap((t) => t.pings.filter((p) => p.speed_kmh > 3).map((p) => p.speed_kmh));
  tripStats[sc] = { trips: ts.length, minDur: Math.min(...durs), maxDur: Math.max(...durs), meanDur: mean(durs), meanMovingSpeed: mean(moving), pings: ts.reduce((s, t) => s + t.pings.length, 0) };
}

// ---------- write files ----------
fs.mkdirSync(OUT_DIR, { recursive: true });
const pingRows = ['trip_id,scenario,set,direction,timestamp,lat,lon,speed_kmh'];
for (const t of trips) for (const p of t.pings) pingRows.push([t.id, t.scenario, t.set, t.direction, fmtTime(p.t), p.lat.toFixed(6), p.lon.toFixed(6), p.speed_kmh.toFixed(1)].join(','));
fs.writeFileSync(path.join(OUT_DIR, 'scenario_pings.csv'), pingRows.join('\n') + '\n');
const tripRows = ['trip_id,scenario,set,direction,scheduled_departure,actual_departure_delay_s,actual_arrival,duration_min,' + stops.map((_, i) => `stop${i + 1}_arrival`).join(',')];
for (const t of trips) tripRows.push([t.id, t.scenario, t.set, t.direction, fmtTime(t.schedDepMs), Math.round(t.departDelayS), fmtTime(t.arrivalMs), ((t.arrivalMs - t.schedDepMs) / 60000).toFixed(1), ...stops.map((_, i) => (t.stopArrivals[i] ? fmtTime(t.stopArrivals[i]) : ''))].join(','));
fs.writeFileSync(path.join(OUT_DIR, 'scenario_trips.csv'), tripRows.join('\n') + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'scenario_results.json'), JSON.stringify({ seed: SEED, routeKm: L, plannedTripMin: PLANNED_TRIP_MIN, scenarios: SCENARIOS, tripStats, tuning: { grid: tuned.map((x) => ({ ...x.p, mae: +x.mae.toFixed(3) })), chosen: best }, results }, null, 2));

// ---------- print a summary ----------
const f = (x) => x.toFixed(1);
console.log(`SIMULATED DATA ONLY · seed ${SEED} · route ${f(L)} km · ${trips.length} trips (${tuning.length} tuning, ${evalTrips.length} held-out)`);
console.log('\nGenerated trips (scheduled departure to arrival, minutes):');
for (const [sc, s] of Object.entries(tripStats)) console.log(`  ${SCENARIOS[sc].label.padEnd(14)} mean ${f(s.meanDur)} (min ${f(s.minDur)}, max ${f(s.maxDur)}) · mean moving speed ${f(s.meanMovingSpeed)} km/h · ${s.pings} pings`);
console.log(`\nTuning (tuning trips only): best blended settings = cap ${best.cap}, window ${best.window} pings, full trust after ${best.trustAfter * 100}% of route (MAE ${f(tuned[0].mae)} min)`);
console.log('\nHeld-out evaluation, MAE in minutes (bias in brackets; + = predicted too late):');
console.log('  ' + 'Method'.padEnd(34) + Object.values(SCENARIOS).map((s) => s.label.padEnd(15)).join('') + 'Overall'.padEnd(15) + 'Stops ahead');
for (const r of results) console.log('  ' + r.method.padEnd(34) + Object.keys(SCENARIOS).map((sc) => `${f(r.byScenario[sc].mae)} (${f(r.byScenario[sc].bias)})`.padEnd(15)).join('') + `${f(r.overall.mae)} (${f(r.overall.bias)})`.padEnd(15) + f(r.stops.mae));
console.log('\nHeld-out MAE by trip progress (0-25 / 25-50 / 50-75 / 75-95%):');
for (const r of results) console.log('  ' + r.method.padEnd(34) + r.bands.map(f).join(' / '));
console.log(`\nEvaluation points per method: ${results[0].overall.n}; stop predictions per method: ${results[0].stops.n}`);
