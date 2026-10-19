// ETA accuracy on the simulated trips: at every ping of every finished trip, how far off was the
// predicted arrival time from the real arrival time?   npm run eval:eta
//
// Limits: the simulated trips follow a straight line and a made-up speed pattern, so this shows
// the method works on this data, not how accurate it is on real buses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRoute } from '../src/geo.js';
import { computeLive } from '../src/eta.js';
import { parseLocal } from '../src/time.js';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
function readCsv(name) {
  const [head, ...lines] = fs.readFileSync(path.join(dataDir, name), 'utf8').trim().split('\n');
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}

const route = buildRoute(readCsv('route_points.csv').sort((a, b) => a.seq - b.seq).map((p) => ({ lat: +p.lat, lon: +p.lon })));
const trips = Object.fromEntries(readCsv('trips.csv').map((t) => [t.id, t]));
const pings = readCsv('gps_pings.csv');
const runs = readCsv('trip_runs.csv').filter((r) => r.status === 'completed');

const buckets = [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 0.95]];
const errors = buckets.map(() => []);
const all = [];

for (const r of runs) {
  const t = trips[r.trip_id];
  const rp = pings.filter((p) => p.trip_run_id === r.id).map((p) => ({ timestamp: p.timestamp, lat: +p.lat, lon: +p.lon, speed_kmh: +p.speed_kmh }));
  const arrival = parseLocal(rp[rp.length - 1].timestamp);
  const run = { status: 'in_progress', direction: t.direction, run_date: r.run_date, scheduled_time: t.scheduled_time };
  for (let i = 1; i < rp.length - 1; i++) {
    const live = computeLive({ run, route, pings: rp.slice(Math.max(0, i - 5), i + 1) });
    const predicted = parseLocal(rp[i].timestamp) + live.etaMinutes * 60000;
    const err = (predicted - arrival) / 60000;            // minutes; positive = predicted too late
    const b = buckets.findIndex(([lo, hi]) => live.progress >= lo && live.progress < hi);
    if (b >= 0) errors[b].push(err);
    if (live.progress < 0.95) all.push(err);
  }
}

const mae = (a) => a.reduce((s, x) => s + Math.abs(x), 0) / a.length;
const bias = (a) => a.reduce((s, x) => s + x, 0) / a.length;
console.log(`ETA accuracy on ${runs.length} finished simulated trips (error = predicted arrival minus actual arrival)\n`);
console.log('Progress of the trip   Mean absolute error   Bias (+ = predicted too late)   Predictions');
buckets.forEach(([lo, hi], i) =>
  console.log(`${String(lo * 100).padStart(3)}% to ${String(hi * 100).padStart(3)}%       ${mae(errors[i]).toFixed(1).padStart(8)} min        ${bias(errors[i]).toFixed(1).padStart(8)} min                  ${errors[i].length}`));
console.log(`\nWhole trip (up to 95%): mean absolute error ${mae(all).toFixed(1)} min, ${all.length} predictions`);
