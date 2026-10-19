// Plays a trip into the server like a driver's phone would.
//
//   npm run simulate:driver -- --run 28
//
// Options:  --url http://localhost:3000   --user driver1   --password demo1234
//           --run 28        the trip run to drive (it must be assigned to that driver)
//           --source auto   which stored trip to copy the positions from (a run id, or "auto")
//           --speed 30      replay speed: 30 means 30 times faster than real time (one ping per second)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { readArgs, api } from './_args.js';
import { formatLocal, parseLocal } from '../src/time.js';

const args = readArgs({ url: 'http://localhost:3000', user: 'driver1', password: 'demo1234', run: '28', source: 'auto', speed: '30' });
const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

function readCsv(name) {
  const [head, ...lines] = fs.readFileSync(path.join(dataDir, name), 'utf8').trim().split('\n');
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runId = Number(args.run);
const factor = Number(args.speed);

const { token, user } = await api(args.url, '/auth/login', { method: 'POST', body: { username: args.user, password: args.password } });
console.log(`Logged in as ${user.name} (${user.role})`);

const run = await api(args.url, `/runs/${runId}/live`, { token });
console.log(`Trip run ${runId}: ${run.date} ${run.scheduledTime} ${run.direction}, status: ${run.status}`);

// Pick the stored positions to replay: a finished trip going the same direction
const runs = readCsv('trip_runs.csv');
const trips = Object.fromEntries(readCsv('trips.csv').map((t) => [t.id, t]));
let sourceId = args.source === 'auto'
  ? runs.find((r) => r.status === 'completed' && trips[r.trip_id].direction === run.direction && Number(r.id) !== runId)?.id
  : args.source;
if (!sourceId) throw new Error('No source trip found to replay');
const source = readCsv('gps_pings.csv').filter((p) => p.trip_run_id === String(sourceId));
console.log(`Replaying ${source.length} positions from stored trip ${sourceId}, ${factor}x faster than real time`);

if (run.status === 'scheduled') {
  await api(args.url, `/driver/runs/${runId}/start`, { method: 'POST', token });
  console.log('Trip started');
} else if (run.status !== 'in_progress') {
  throw new Error(`This trip is ${run.status}; it cannot be driven`);
}

const { now } = await api(args.url, '/time');
const origin = parseLocal(now);
const first = parseLocal(source[0].timestamp);

const socket = io(args.url, { auth: { token } });
await new Promise((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
socket.on('bus:position', (m) =>
  console.log(`  server -> riders: ETA ${m.etaMinutes} min, ${m.statusLabel}, ${m.remainingKm} km to go`));
await new Promise((resolve) => socket.emit('watch', { runId }, resolve));

for (let i = 0; i < source.length; i++) {
  const p = source[i];
  const timestamp = formatLocal(origin + (parseLocal(p.timestamp) - first));
  const ack = await new Promise((resolve) =>
    socket.emit('driver:ping', { runId, lat: Number(p.lat), lon: Number(p.lon), speedKmh: Number(p.speed_kmh), timestamp }, resolve));
  if (!ack.ok) throw new Error(`Ping rejected: ${ack.error}`);
  console.log(`ping ${i + 1}/${source.length}  ${p.lat}, ${p.lon}  ${p.speed_kmh} km/h`);
  await sleep(30000 / factor);
}

await api(args.url, `/driver/runs/${runId}/end`, { method: 'POST', token });
console.log('Trip ended');
socket.close();
