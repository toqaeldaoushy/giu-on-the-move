// Technical evaluation (Section 3.4): latency, update reliability, displayed position, role-by-endpoint
// access matrix and a second route. Runs ONLY against a local test database (never Supabase): it starts and
// ends trips and writes positions.
//
//   DATABASE_URL=<local test db> JWT_SECRET=test-secret SIMULATED_NOW=2026-10-08T13:40:00 \
//     node scripts/eval-technical.js > ../docs/technical_evaluation_<date>.txt
//
// The positions are generated on the real route, one every 30 s of trip time over the planned 71 minutes,
// with a random GPS error of up to 8 m (as in the simulated datasets). Their noise-free position is known,
// so the position shown to riders can be compared with the truth. The replay is faster than real time
// (one position per second, or per 100 ms in the stress replay); every result states the pace.
import jwt from 'jsonwebtoken';
import { io as ioc } from 'socket.io-client';
import { createPool } from '../src/db.js';
import { createServer } from '../src/server.js';
import { seedCredentials } from './seed-credentials.js';
import { formatLocal, parseLocal } from '../src/time.js';
import { haversineKm } from '../src/geo.js';

if (!/localhost|127\.0\.0\.1|host=\/tmp/.test(process.env.DATABASE_URL ?? '')) {
  console.error('Refusing to run: DATABASE_URL must point at a LOCAL test database.');
  process.exit(1);
}

const PLANNED_MIN = 71;
const GPS_ERROR_M = 8;
const pool = createPool();
let server; let base;
const sockets = [];

// ---- small helpers ----------------------------------------------------------------------------
let seed = 20261125;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const median = (arr) => { const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const f = (x, d = 1) => Number(x).toFixed(d);

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const login = async (u) => (await call('POST', '/auth/login', { body: { username: u, password: 'demo1234' } })).body.token;
const connect = (token) => new Promise((resolve, reject) => {
  const s = ioc(base, { auth: { token }, transports: ['websocket'], reconnection: false });
  sockets.push(s);
  s.on('connect', () => resolve(s));
  s.on('connect_error', reject);
});
const emitAck = (s, ev, msg) => new Promise((res) => s.emit(ev, msg, res));

// ---- route geometry ---------------------------------------------------------------------------
function pathOf(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineKm({ lat: points[i - 1].lat, lon: points[i - 1].lon }, { lat: points[i].lat, lon: points[i].lon }));
  const L = cum[cum.length - 1];
  const at = (km) => {
    const s = Math.max(0, Math.min(L, km));
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return { lat: points[i - 1].lat + t * (points[i].lat - points[i - 1].lat), lon: points[i - 1].lon + t * (points[i].lon - points[i - 1].lon) };
  };
  return { L, at };
}
function noisy(p) {
  const r = rand() * GPS_ERROR_M / 1000; const a = rand() * 2 * Math.PI;
  return { lat: p.lat + (r * Math.cos(a)) / 111.32, lon: p.lon + (r * Math.sin(a)) / (111.32 * Math.cos((p.lat * Math.PI) / 180)) };
}

async function routePoints(routeId) {
  const { rows } = await pool.query('select lat, lon from route_points where route_id = $1 order by seq', [routeId]);
  return rows;
}

// ---- one replay -------------------------------------------------------------------------------
async function replay({ label, runId, driverUser, riders, intervalMs }) {
  const { rows: [run] } = await pool.query(
    `select r.id, r.run_date, t.scheduled_time, t.direction, t.route_id from trip_runs r join trips t on t.id = r.trip_id where r.id = $1`, [runId]);
  const path = pathOf(await routePoints(run.route_id));
  const inbound = run.direction === 'inbound';
  const n = PLANNED_MIN * 2;                        // one position every 30 s of trip time
  const start = parseLocal(`${String(run.run_date).slice(0, 10)}T${String(run.scheduled_time).slice(0, 8)}`);

  const driverToken = await login(driverUser);
  const riderTokens = [];
  for (let i = 0; i < riders; i++) riderTokens.push(await login(`student${String((i % 10) + 1).padStart(2, '0')}`));
  const watchers = [];
  for (const t of riderTokens) {
    const s = await connect(t);
    const got = new Map();                         // timestamp -> { at, msg }
    s.on('bus:position', (m) => { if (m.runId === runId) got.set(m.timestamp, { at: nowMs(), msg: m }); });
    await emitAck(s, 'watch', { runId });
    watchers.push(got);
  }
  const drv = await connect(driverToken);
  const st = await call('POST', `/driver/runs/${runId}/start`, { token: driverToken });
  if (st.status !== 200) throw new Error(`${label}: could not start run ${runId}: ${st.status} ${JSON.stringify(st.body)}`);

  const sent = []; let acked = 0; let refused = 0;
  for (let i = 0; i < n; i++) {
    const travelled = (path.L * i) / (n - 1);
    const truth = path.at(inbound ? travelled : path.L - travelled);
    const p = noisy(truth);
    const timestamp = formatLocal(start + i * 30000);
    const speedKmh = (path.L / PLANNED_MIN) * 60;
    const t0 = nowMs();
    const ack = await new Promise((res) => drv.emit('driver:ping', { runId, ...p, speedKmh, timestamp }, res));
    if (ack?.ok && !ack.duplicate) acked++; else refused++;
    sent.push({ timestamp, t0, truth, travelled });
    await sleep(Math.max(0, intervalMs - (nowMs() - t0)));
  }
  await sleep(1500);                               // let the last updates arrive
  const end = await call('POST', `/driver/runs/${runId}/end`, { token: driverToken });
  const { rows: [{ c: stored }] } = await pool.query('select count(*)::int as c from gps_pings where trip_run_id = $1', [runId]);

  const latencies = []; const posErr = []; const progErr = []; const delivered = []; let maxGapS = 0; let etaShown = 0;
  for (const got of watchers) {
    delivered.push(got.size);
    let prev = null;
    for (const s of sent) {
      const g = got.get(s.timestamp);
      if (!g) continue;
      latencies.push(g.at - s.t0);
      if (g.msg.position) posErr.push(haversineKm({ lat: s.truth.lat, lon: s.truth.lon }, { lat: g.msg.position.lat, lon: g.msg.position.lon }) * 1000);
      if (g.msg.progress != null) progErr.push(Math.abs(g.msg.progress * path.L - s.travelled) * 1000);
      if (g.msg.etaMinutes != null) etaShown++;
      if (prev) maxGapS = Math.max(maxGapS, (parseLocal(s.timestamp) - parseLocal(prev)) / 1000);
      prev = s.timestamp;
    }
  }
  for (const s of sockets.splice(0)) s.close();
  return {
    label, runId, routeId: run.route_id, direction: run.direction, routeKm: path.L, riders, intervalMs, sent: n, acked, refused,
    stored, delivered, latencies, posErr, progErr, maxGapS, etaShown, endStatus: end.status,
  };
}

function printReplay(r) {
  const allDelivered = r.delivered.every((d) => d === r.sent);
  console.log(`\n## ${r.label}`);
  console.log(`Run ${r.runId} (route ${r.routeId}, ${r.direction}, ${f(r.routeKm, 2)} km); ${r.riders} rider client(s); one position every ${r.intervalMs} ms of wall time (= 30 s of trip time)`);
  console.log(`Positions sent: ${r.sent}; accepted by the server: ${r.acked}; refused: ${r.refused}; stored in the database: ${r.stored}`);
  console.log(`Delivered to each rider client: min ${Math.min(...r.delivered)}, max ${Math.max(...r.delivered)} of ${r.sent} -> every position delivered: ${allDelivered ? 'YES' : 'NO'}`);
  console.log(`Longest gap between two consecutive delivered positions (trip time): ${r.maxGapS} s (criterion: no gap above 60 s)`);
  console.log(`Latency, driver send -> rider receive, over ${r.latencies.length} deliveries: median ${f(median(r.latencies), 2)} ms, 95th percentile ${f(pct(r.latencies, 95), 2)} ms, max ${f(Math.max(...r.latencies), 2)} ms (criterion: median under 2 s)`);
  console.log(`Displayed position vs noise-free position: median ${f(median(r.posErr))} m, 95th percentile ${f(pct(r.posErr, 95))} m, max ${f(Math.max(...r.posErr))} m (GPS error added: up to ${GPS_ERROR_M} m)`);
  console.log(`Distance travelled along the route (projection) vs truth: median ${f(median(r.progErr))} m, max ${f(Math.max(...r.progErr))} m`);
  console.log(`Updates carrying an arrival estimate: ${r.etaShown} of ${r.latencies.length}; trip ended with HTTP ${r.endStatus}`);
  return {
    pass: allDelivered && r.stored === r.sent && r.maxGapS <= 60 && median(r.latencies) < 2000 && Math.max(...r.posErr) <= GPS_ERROR_M + 0.5,
  };
}

// ---- access matrix ----------------------------------------------------------------------------
async function accessMatrix() {
  const tokens = {
    none: null,
    forged: jwt.sign({ sub: 1, role: 'admin', name: 'x' }, 'not-the-server-secret', { expiresIn: '1h' }),
    expired: jwt.sign({ sub: 1, role: 'admin', name: 'x' }, process.env.JWT_SECRET, { expiresIn: -10 }),
    rider: await login('student01'), driver: await login('driver1'), admin: await login('admin'),
  };
  const X = 999999; // a trip, alert, bus or driver that does not exist: an allowed call stops at "not found", so nothing is changed
  const E = [
    ['GET', '/me', 'any'], ['GET', '/route', 'any'], ['GET', '/timetable?date=2026-10-08', 'any'], ['GET', '/runs/28/live', 'any'], ['GET', '/runs/28/pings', 'any'],
    ['POST', '/alerts', 'rider', { runId: X, stopId: 1, minutesBefore: 5 }], ['GET', '/alerts', 'rider'], ['DELETE', `/alerts/${X}`, 'rider'],
    ['POST', `/runs/${X}/full-report`, 'rider'],
    ['GET', '/driver/runs?date=2026-10-08', 'driver'], ['POST', `/driver/runs/${X}/start`, 'driver'], ['POST', `/driver/runs/${X}/end`, 'driver'],
    ['POST', `/driver/runs/${X}/pings`, 'driver', { lat: 30, lon: 31, speedKmh: 10 }], ['POST', `/driver/runs/${X}/problems`, 'driver', { type: 'other' }],
    ['GET', '/admin/overview?date=2026-10-08', 'admin'], ['GET', '/admin/buses', 'admin'], ['POST', '/admin/buses', 'admin', {}],
    ['PATCH', `/admin/buses/${X}`, 'admin', { status: 'active' }], ['GET', '/admin/drivers', 'admin'], ['POST', '/admin/drivers', 'admin', {}],
    ['PATCH', `/admin/drivers/${X}`, 'admin', { name: 'x' }], ['PATCH', `/admin/runs/${X}/assignment`, 'admin', { driverId: 2 }],
    ['POST', `/admin/runs/${X}/cancel`, 'admin'], ['POST', '/admin/runs/generate', 'admin', { date: 'not-a-date' }],
    ['GET', '/admin/reports?date=2026-10-08', 'admin'], ['GET', '/admin/assignment-changes', 'admin'],
  ];
  const callers = Object.keys(tokens);
  let total = 0; let ok = 0; let leaks = 0; const rows = [];
  for (const [m, p, who, body] of E) {
    const cells = [];
    for (const c of callers) {
      const r = await call(m, p, { token: tokens[c], body });
      const expectDeny = ['none', 'forged', 'expired'].includes(c) ? 401 : (who === 'any' || who === c ? null : 403);
      const allowed = r.status !== 401 && r.status !== 403;
      const good = expectDeny ? r.status === expectDeny : allowed;
      if (expectDeny && allowed) leaks++;
      total++; if (good) ok++;
      cells.push(`${c}:${r.status}${good ? '' : '!'}`);
    }
    rows.push(`${m.padEnd(6)} ${p.padEnd(34)} (${who.padEnd(6)}) ${cells.join('  ')}`);
  }
  // live connection
  const sock = [];
  const refusedNoToken = await connect(null).then(() => false).catch(() => true);
  const refusedForged = await connect(tokens.forged).then(() => false).catch(() => true);
  const riderSock = await connect(tokens.rider);
  const riderPing = await emitAck(riderSock, 'driver:ping', { runId: 28, lat: 30, lon: 31, speedKmh: 10 });
  const adminSock = await connect(tokens.admin);
  const adminPing = await emitAck(adminSock, 'driver:ping', { runId: 28, lat: 30, lon: 31, speedKmh: 10 });
  const other = await login('driver2');
  const otherStart = await call('POST', '/driver/runs/28/start', { token: other });
  sock.push(
    ['Live connection without a token', refusedNoToken ? 'refused' : 'ALLOWED', refusedNoToken],
    ['Live connection with a forged token', refusedForged ? 'refused' : 'ALLOWED', refusedForged],
    ['Rider sends a position', riderPing?.ok ? 'ALLOWED' : `refused (${riderPing?.status})`, !riderPing?.ok],
    ['Administrator sends a position', adminPing?.ok ? 'ALLOWED' : `refused (${adminPing?.status})`, !adminPing?.ok],
    ['Driver starts a trip assigned to another driver', `HTTP ${otherStart.status}`, otherStart.status === 403],
  );
  for (const s of sockets.splice(0)) s.close();
  for (const [, , good] of sock) { total++; if (good) ok++; else leaks++; }

  console.log('\n## Role-by-endpoint access matrix');
  console.log('Each endpoint called with no token, a forged token (wrong secret), an expired token, and a valid rider, driver and administrator token.');
  console.log('Expected: 401 without a valid token; 403 for a role the endpoint is not meant for; anything else (200, 201, 400, 404, 409) for the intended role.');
  console.log('Calls by the intended role use an id that does not exist (999999) or an invalid body, so they pass the access check without changing data.');
  console.log('A "!" marks a response that differs from the expectation.\n');
  rows.forEach((r) => console.log(r));
  console.log('');
  sock.forEach(([what, res, good]) => console.log(`${what}: ${res}${good ? '' : '  <-- UNEXPECTED'}`));
  console.log(`\nChecks: ${total}; as expected: ${ok}; not as expected: ${total - ok}; unauthorized accesses: ${leaks}`);
  return { pass: ok === total && leaks === 0, total, ok, leaks, endpoints: E.length };
}

// ---- second route -----------------------------------------------------------------------------
async function addSecondRoute() {
  // A second, simulated route: the first route's path moved about 3 km north, with its own stops and trips.
  // Only data is added: no table and no server code is changed.
  const pts = await routePoints(1);
  await pool.query(`insert into routes (id, name) values (2, 'Simulated second route') on conflict do nothing`);
  for (let i = 0; i < pts.length; i++) {
    await pool.query('insert into route_points (route_id, seq, lat, lon) values (2, $1, $2, $3)', [i + 1, pts[i].lat + 0.027, pts[i].lon]);
  }
  const pick = [0, Math.floor(pts.length / 3), Math.floor((2 * pts.length) / 3), pts.length - 1];
  for (let k = 0; k < pick.length; k++) {
    await pool.query('insert into stops (route_id, name, lat, lon, seq) values (2, $1, $2, $3, $4)',
      [`Route 2 stop ${k + 1}`, pts[pick[k]].lat + 0.027, pts[pick[k]].lon, k + 1]);
  }
  const { rows: [trip] } = await pool.query(
    `insert into trips (code, label, route_id, direction, scheduled_time) values ('R2-1345', 'Route 2 afternoon', 2, 'outbound', '13:45') returning id`);
  const { rows: [run] } = await pool.query(
    `insert into trip_runs (trip_id, run_date, bus_id, driver_id, status) values ($1, '2026-10-08', 2, 3, 'scheduled') returning id`, [trip.id]);
  return run.id;
}

// ---- main -------------------------------------------------------------------------------------
await seedCredentials(pool, 'demo1234');
server = createServer({ pool });
base = `http://127.0.0.1:${await server.listen(0)}`;

console.log('GIU on the Move — technical evaluation');
console.log(`Run at ${new Date().toISOString()} on a local test database (PostgreSQL), server and clients on the same machine (Node ${process.version}).`);
console.log('Simulated clock:', process.env.SIMULATED_NOW, '| planned trip time:', PLANNED_MIN, 'min | GPS error added: up to', GPS_ERROR_M, 'm');

const results = [];
const { rows: users } = await pool.query(`select id, username from users where role = 'driver'`);
const uname = Object.fromEntries(users.map((u) => [u.id, u.username]));
const { rows: runs } = await pool.query(`select id, driver_id from trip_runs where id in (28, 29, 30)`);
const drv = Object.fromEntries(runs.map((r) => [r.id, uname[r.driver_id]]));

results.push(printReplay(await replay({ label: 'Replay A: normal pace, 5 riders', runId: 28, driverUser: drv[28], riders: 5, intervalMs: 1000 })));
results.push(printReplay(await replay({ label: 'Replay B: normal pace, 50 riders', runId: 29, driverUser: drv[29], riders: 50, intervalMs: 1000 })));
results.push(printReplay(await replay({ label: 'Replay C: stress, 10 positions per second, 5 riders', runId: 30, driverUser: drv[30], riders: 5, intervalMs: 100 })));

const matrix = await accessMatrix();

console.log('\n## Second route (NFR6)');
const run2 = await addSecondRoute();
const r2 = await replay({ label: 'Replay D: second route, normal pace, 5 riders', runId: run2, driverUser: uname[3], riders: 5, intervalMs: 1000 });
results.push(printReplay(r2));
const admin = await login('admin');
const tt = await call('GET', '/timetable?date=2026-10-08', { token: admin });
const routeApi = await call('GET', '/route', { token: admin });
const live2 = await call('GET', `/runs/${run2}/live?stopId=${(await pool.query('select id from stops where route_id = 2 order by seq limit 1')).rows[0].id}`, { token: admin });
console.log(`Timetable for 2026-10-08 lists ${tt.body.runs?.length} runs, including the route-2 run: ${tt.body.runs?.some((r) => r.id === run2) ? 'YES' : 'NO'}`);
console.log(`Live state of the route-2 run after the trip: status ${live2.body.status ?? live2.body.statusLabel}, progress ${live2.body.live?.progress ?? live2.body.progress}`);
console.log(`GET /api/route returns route ${routeApi.body.id} only ("${routeApi.body.name}"): the endpoint and the app assume one route`);

const { rows: [size] } = await pool.query(
  `select count(*)::int as n, pg_total_relation_size('gps_pings') as total, pg_relation_size('gps_pings') as heap from gps_pings`);
console.log('\n## Storage of positions');
console.log(`gps_pings: ${size.n} rows, ${size.total} bytes with indexes (${size.heap} bytes table only) -> ${f(size.total / size.n, 0)} bytes per position with indexes`);

console.log('\n## Summary');
results.forEach((r, i) => console.log(`Replay ${'ABCD'[i]}: ${r.pass ? 'PASS' : 'FAIL'}`));
console.log(`Access matrix: ${matrix.pass ? 'PASS' : 'FAIL'} (${matrix.ok}/${matrix.total} checks as expected over ${matrix.endpoints} endpoints and 5 live-connection checks; unauthorized accesses: ${matrix.leaks})`);

await server.close();
process.exit(0);
