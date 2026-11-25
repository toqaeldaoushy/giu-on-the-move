// ETA methods on the REAL recorded trip (First Settlement line, Sunday 22 Nov 2026).
// Run from the backend folder:  node scripts/eta-real-trip.js [--gpx ../data/real/trip1_2026-11-22.gpx] [--out ../data/real]
//
// REAL DATA, ONE TRIP. The GPX file has a point every second. The script turns it into what the driver app
// would have sent: one position every 30 s, with the speed driven over those 30 s. Between 06:34 and 06:56
// the phone did not record, so there are no positions in that part. Predictions are made at every position
// from 06:56 on, while less than 95% of the route is covered, and compared with the real arrival times.
//
// Planned trip time: 71 min (this same trip's duration) and departure 06:30 (as the volunteer reported).
// Because the plan comes from the trip being evaluated, the plan-based methods (timetable, schedule)
// are favoured here; the result is a check on real roads, not a fair contest between methods.

import fs from 'node:fs';
import path from 'node:path';
import { buildRoute, haversineKm } from '../src/geo.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const GPX = arg('--gpx', '../data/real/trip1_2026-11-22.gpx');
const ROUTE_CSV = arg('--route', '../data/real/route_points.csv');
const STOPS_CSV = arg('--stops', '../data/real/stops_recorded.csv');   // only stops where the bus is known to stop
const OUT_DIR = arg('--out', '../data/real');
const PLANNED_TRIP_MIN = 71;
const SCHEDULED_DEPARTURE = '06:30';
const PING_EVERY_S = 30;
const CAIRO_MS = 2 * 3600000;

const readCsv = (f) => { const [h, ...ls] = fs.readFileSync(f, 'utf8').trim().split('\n'); const c = h.split(','); return ls.map((l) => Object.fromEntries(l.split(',').map((v, i) => [c[i], v]))); };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const mae = (a) => mean(a.map(Math.abs));
const hhmmss = (ms) => new Date(ms + CAIRO_MS).toISOString().slice(11, 19);

// ---------- the recorded trip ----------
const raw = [...fs.readFileSync(GPX, 'utf8').matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)">[\s\S]*?<time>([^<]+)<\/time>/g)]
  .map((m) => ({ lat: +m[1], lon: +m[2], t: Date.parse(m[3]) }));
if (raw.length < 2) throw new Error('No track points found in the GPX file');
const day = new Date(raw[0].t + CAIRO_MS).toISOString().slice(0, 10);
const schedDepMs = Date.parse(`${day}T${SCHEDULED_DEPARTURE}:00Z`) - CAIRO_MS;
const arrivalMs = raw[raw.length - 1].t;

// one position every 30 s (the first recorded point after each 30-s mark), with the speed over the last 30 s
const pings = [];
let next = raw[0].t;
let dist = 0;
for (let i = 0; i < raw.length; i++) {
  if (i > 0) dist += haversineKm(raw[i - 1], raw[i]);
  if (raw[i].t >= next) {
    const prev = pings[pings.length - 1];
    const dt = prev ? (raw[i].t - prev.t) / 3600000 : 0;
    // after the gap the "speed" over 22 minutes means nothing: a phone reports its current speed, so use the last 30 s
    let speed = 0;
    if (prev) {
      let j = i; let d = 0;
      while (j > 0 && raw[i].t - raw[j - 1].t <= PING_EVERY_S * 1000) { d += haversineKm(raw[j - 1], raw[j]); j--; }
      const span = (raw[i].t - raw[j].t) / 3600000;
      speed = span > 0 ? d / span : (dt > 0 ? (dist - prev.dist) / dt : 0);
    }
    pings.push({ lat: raw[i].lat, lon: raw[i].lon, t: raw[i].t, speed, dist });
    next = raw[i].t + PING_EVERY_S * 1000;
  }
}

// ---------- route and stops (built from the same trip) ----------
const pts = readCsv(ROUTE_CSV).sort((a, b) => a.seq - b.seq).map((p) => ({ lat: +p.lat, lon: +p.lon }));
const route = buildRoute(pts);
const L = route.totalKm;
const stops = readCsv(STOPS_CSV).sort((a, b) => a.seq - b.seq)
  .map((s) => ({ name: s.name, sKm: route.project(+s.lat, +s.lon).sKm }));
// real arrival at each stop: the first moment the recorded bus came within 50 m of it
for (const s of stops) {
  const pos = stops.indexOf(s);
  const target = readCsv(STOPS_CSV).sort((a, b) => a.seq - b.seq)[pos];
  const hit = raw.find((p) => haversineKm(p, { lat: +target.lat, lon: +target.lon }) < 0.05);
  s.arrivalMs = pos === stops.length - 1 ? arrivalMs : hit?.t ?? null;
}

// ---------- the methods (same formulas as scripts/eta-scenarios.js and src/eta.js) ----------
const PLANNED_SPEED = L / (PLANNED_TRIP_MIN / 60);
function predict(method, ctx, params = {}) {
  const { now, remKm, progressKm, speeds } = ctx;
  if (method === 'timetable') return schedDepMs + PLANNED_TRIP_MIN * 60000 * ((progressKm + remKm) / L);
  if (method === 'schedule') return now + (remKm / PLANNED_SPEED) * 3600000;
  const w = params.window ?? 6;
  const recent = Math.max(5, mean(speeds.slice(-w)));
  if (method === 'recent') return now + (remKm / recent) * 3600000;
  const trust = Math.min(params.cap ?? 1, progressKm / (L * (params.trustAfter ?? 0.25)));
  const v = (1 - trust) * PLANNED_SPEED + trust * recent;
  return now + (remKm / v) * 3600000;
}
const METHODS = [
  ['Timetable', 'timetable', {}],
  ['Schedule', 'schedule', {}],
  ['Recent speed', 'recent', {}],
  ['Blended (first version)', 'blended', { cap: 1, window: 6, trustAfter: 0.25 }],
  ['Blended (tuned, now in the app)', 'blended', { cap: 0.75, window: 1000, trustAfter: 0.1 }],
];

// ---------- evaluate ----------
const firstAfterGap = pings.findIndex((p, i) => i > 0 && p.t - pings[i - 1].t > 300000);
const evalFrom = firstAfterGap > 0 ? firstAfterGap : 1;
const bands = [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 0.95]];
const results = [];
for (const [name, m, p] of METHODS) {
  const errs = []; const stopErrs = []; const byBand = bands.map(() => []); const series = [];
  for (let i = evalFrom; i < pings.length - 1; i++) {
    const progressKm = route.project(pings[i].lat, pings[i].lon).sKm;
    const progress = progressKm / L;
    if (progress >= 0.95) continue;
    const ctx = { now: pings[i].t, remKm: Math.max(0, L - progressKm), progressKm, speeds: pings.slice(0, i + 1).map((x) => x.speed) };
    const err = (predict(m, ctx, p) - arrivalMs) / 60000;
    errs.push(err);
    const b = bands.findIndex(([lo, hi]) => progress >= lo && progress < hi); if (b >= 0) byBand[b].push(err);
    series.push({ time: hhmmss(pings[i].t), progress: +progress.toFixed(3), errMin: +err.toFixed(2) });
    for (let k = 1; k < stops.length - 1; k++) {
      const ahead = stops[k].sKm - progressKm;
      if (ahead <= 0.2 || !stops[k].arrivalMs) continue;
      let pred = predict(m, { ...ctx, remKm: ahead }, p);
      if (m === 'timetable') pred = schedDepMs + PLANNED_TRIP_MIN * 60000 * (stops[k].sKm / L);
      stopErrs.push((pred - stops[k].arrivalMs) / 60000);
    }
  }
  results.push({ method: name, mae: mae(errs), bias: mean(errs), n: errs.length,
    stops: stopErrs.length ? { mae: mae(stopErrs), n: stopErrs.length } : null,
    byBand: byBand.map((a) => (a.length ? mae(a) : null)), series });
}

// ---------- write ----------
const f1 = (x) => (x == null ? '  -' : x.toFixed(1));
const lines = [];
lines.push(`REAL DATA, ONE TRIP · ${day} · ${path.basename(GPX)} · route ${L.toFixed(1)} km`);
lines.push(`Recorded ${hhmmss(raw[0].t)} to ${hhmmss(arrivalMs)} (${((arrivalMs - raw[0].t) / 60000).toFixed(1)} min); plan ${SCHEDULED_DEPARTURE} + ${PLANNED_TRIP_MIN} min = ${hhmmss(schedDepMs + PLANNED_TRIP_MIN * 60000)}`);
lines.push(`Positions every ${PING_EVERY_S} s: ${pings.length}; not recorded ${hhmmss(pings[evalFrom - 1].t)} to ${hhmmss(pings[evalFrom].t)}; predictions from ${hhmmss(pings[evalFrom].t)}, while under 95% of the route: ${results[0].n}`);
lines.push(`Stops: ${stops.map((s) => `${s.name} km ${s.sKm.toFixed(1)}${s.arrivalMs ? ` at ${hhmmss(s.arrivalMs)}` : ''}`).join(' · ')}`);
lines.push('');
lines.push(`Error of the predicted arrival at GIU, minutes (bias: + = predicted too late)`);
lines.push(`  ${'Method'.padEnd(34)}${'MAE'.padEnd(8)}${'Bias'.padEnd(8)}${'Stops ahead'.padEnd(13)}By progress 0-25 / 25-50 / 50-75 / 75-95%`);
for (const r of results) {
  lines.push(`  ${r.method.padEnd(34)}${f1(r.mae).padEnd(8)}${f1(r.bias).padEnd(8)}${(r.stops ? f1(r.stops.mae) : '-').padEnd(13)}${r.byBand.map(f1).join(' / ')}`);
}
lines.push('');
lines.push('Note: the plan (71 min) is this trip\'s own duration, which favours the timetable and schedule methods.');
const txt = lines.join('\n');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'real_trip_eta.txt'), `${txt}\n`);
fs.writeFileSync(path.join(OUT_DIR, 'real_trip_eta.json'), JSON.stringify({ day, plannedTripMin: PLANNED_TRIP_MIN, scheduledDeparture: SCHEDULED_DEPARTURE, routeKm: L, stops: stops.map((s) => ({ ...s, arrival: s.arrivalMs ? hhmmss(s.arrivalMs) : null })), results }, null, 2));
console.log(txt);
