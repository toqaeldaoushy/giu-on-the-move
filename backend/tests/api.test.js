// End-to-end tests. They need DATABASE_URL to point at a database loaded with the project data
// (supabase/01 to 04). See tests/run_with_local_postgres.py, which sets that up on a throw-away Postgres.
import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioc } from 'socket.io-client';
import { createPool } from '../src/db.js';
import { createServer } from '../src/server.js';
import { seedCredentials } from '../scripts/seed-credentials.js';
import { formatLocal, parseLocal } from '../src/time.js';

const RUN = 28;          // Thursday 13:45, Bus #04, Ahmed Hassan (driver1), still scheduled in the data
const pool = createPool();
let server; let base;
const sockets = [];

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const login = async (u) => (await call('POST', '/auth/login', { body: { username: u, password: 'demo1234' } })).body.token;
function connect(token) {
  return new Promise((resolve, reject) => {
    const s = ioc(base, { auth: { token }, transports: ['websocket'] });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}
const once = (s, ev, ms = 4000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timed out waiting for ${ev}`)), ms);
  s.once(ev, (m) => { clearTimeout(t); res(m); });
});
const emitAck = (s, ev, msg) => new Promise((res) => s.emit(ev, msg, res));

before(async () => {
  await seedCredentials(pool, 'demo1234');
  server = createServer({ pool });
  base = `http://127.0.0.1:${await server.listen(0)}`;
});
after(async () => {
  sockets.forEach((s) => s.close());
  await server.close();
});

describe('login and roles', () => {
  it('refuses a wrong password and an unknown user the same way', async () => {
    const a = await call('POST', '/auth/login', { body: { username: 'driver1', password: 'wrong' } });
    const b = await call('POST', '/auth/login', { body: { username: 'nobody', password: 'demo1234' } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error, b.body.error);
  });
  it('logs in the demo users', async () => {
    const r = await call('POST', '/auth/login', { body: { username: 'student01', password: 'demo1234' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.role, 'rider');
    assert.ok(r.body.token);
  });
  it('needs a login for everything else, and rejects a fake token', async () => {
    assert.equal((await call('GET', '/timetable')).status, 401);
    assert.equal((await call('GET', '/timetable', { token: 'fake' })).status, 401);
  });
  it('keeps each role to its own actions', async () => {
    const rider = await login('student01');
    const drv = await login('driver1');
    assert.equal((await call('GET', '/admin/overview', { token: rider })).status, 403);
    assert.equal((await call('GET', '/admin/overview', { token: drv })).status, 403);
    assert.equal((await call('POST', `/driver/runs/${RUN}/start`, { token: rider })).status, 403);
    assert.equal((await call('POST', '/alerts', { token: drv, body: {} })).status, 403);
  });
  it('reports the (simulated) clock', async () => {
    const r = await call('GET', '/time');
    assert.equal(r.body.simulated, true);
    assert.ok(Math.abs(parseLocal(r.body.now) - parseLocal('2026-10-08T13:40:00')) < 120000);
  });
});

describe('timetable and privacy', () => {
  it('shows the five trips of the day with the driver and bus', async () => {
    const rider = await login('student01');
    const r = await call('GET', '/timetable?date=2026-10-08', { token: rider });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.runs.map((x) => x.scheduledTime), ['08:00', '10:00', '13:45', '15:30', '17:30']);
    const run = r.body.runs.find((x) => x.id === RUN);
    assert.equal(run.driver.name, 'Ahmed Hassan');
    assert.equal(run.bus.number, '04');
    assert.equal(run.live.statusLabel, 'Not started');
  });
  it('lists only the driver\'s own trips for the driver app, and lets the driver read a trip\'s live state', async () => {
    const drv = await login('driver1');
    const mine = await call('GET', '/driver/runs?date=2026-10-08', { token: drv });
    assert.equal(mine.status, 200);
    assert.ok(mine.body.runs.length >= 1);
    assert.ok(mine.body.runs.every((x) => x.driver.name === 'Ahmed Hassan'));
    assert.ok(mine.body.runs.some((x) => x.id === RUN));
    const other = await call('GET', '/driver/runs?date=2026-10-08', { token: await login('driver2') });
    assert.ok(!other.body.runs.some((x) => x.id === RUN));
    const live = await call('GET', `/runs/${RUN}/live`, { token: drv });
    assert.equal(live.status, 200);
    assert.equal(live.body.status, 'scheduled');
    assert.equal((await call('GET', '/driver/runs', { token: await login('student01') })).status, 403);
  });
  it('marks finished and cancelled trips', async () => {
    const rider = await login('student01');
    const done = await call('GET', '/runs/26/live', { token: rider });
    assert.equal(done.body.live.statusLabel, 'Arrived');
    const cancelled = await call('GET', '/runs/25/live', { token: rider });
    assert.equal(cancelled.body.live.statusLabel, 'Cancelled');
  });
  it('hides a driver\'s phone from riders unless the admin allows it, but never from the admin', async () => {
    const hidden = (await pool.query(
      `select r.id from trip_runs r join users u on u.id = r.driver_id where u.share_phone = false limit 1`)).rows[0].id;
    const shared = (await pool.query(
      `select r.id from trip_runs r join users u on u.id = r.driver_id where u.share_phone = true limit 1`)).rows[0].id;
    const rider = await login('student01');
    const admin = await login('admin');
    assert.equal((await call('GET', `/runs/${hidden}/live`, { token: rider })).body.driver.phone, null);
    assert.match((await call('GET', `/runs/${shared}/live`, { token: rider })).body.driver.phone, /^\+20-000-000-/);
    assert.match((await call('GET', `/runs/${hidden}/live`, { token: admin })).body.driver.phone, /^\+20-000-000-/);
  });
});

describe('a live trip, from the driver\'s phone to the rider\'s screen', () => {
  let driverToken; let riderToken; let adminToken; let route;
  let driverSock; let riderSock; let adminSock;
  const start = parseLocal('2026-10-08T13:46:00');

  // a point on the route, "fraction" of the way from the campus towards the pickup point (the 13:45 trip is outbound)
  const pointAt = (fraction) => {
    const campus = route.points[route.points.length - 1];
    const pickup = route.points[0];
    return { lat: campus.lat + (pickup.lat - campus.lat) * fraction, lon: campus.lon + (pickup.lon - campus.lon) * fraction };
  };
  const ping = (fraction, speed, secondsAfterStart) =>
    ({ runId: RUN, ...pointAt(fraction), speedKmh: speed, timestamp: formatLocal(start + secondsAfterStart * 1000) });

  before(async () => {
    driverToken = await login('driver1');
    riderToken = await login('student01');
    adminToken = await login('admin');
    route = (await call('GET', '/route', { token: riderToken })).body;
    driverSock = await connect(driverToken);
    riderSock = await connect(riderToken);
    adminSock = await connect(adminToken);
  });

  it('does not accept positions before the trip has started', async () => {
    const ack = await emitAck(driverSock, 'driver:ping', ping(0, 60, 0));
    assert.equal(ack.ok, false);
    assert.equal(ack.status, 409);
  });

  it('lets the assigned driver start the trip once, and not another driver', async () => {
    const other = await login('driver2');
    assert.equal((await call('POST', `/driver/runs/${RUN}/start`, { token: other })).status, 403);
    const statusEvent = once(riderSock, 'trip:status');
    await emitAck(riderSock, 'watch', { runId: RUN });
    assert.equal((await call('POST', `/driver/runs/${RUN}/start`, { token: driverToken })).status, 200);
    assert.equal((await statusEvent).status, 'in_progress');
    assert.equal((await call('POST', `/driver/runs/${RUN}/start`, { token: driverToken })).status, 409);
  });

  it('sends each position to the rider with a falling ETA', async () => {
    const etas = [];
    for (const [i, f] of [0.05, 0.25, 0.5, 0.75, 0.97].entries()) {
      const event = once(riderSock, 'bus:position');
      const ack = await emitAck(driverSock, 'driver:ping', ping(f, 80, i * 30));
      assert.equal(ack.ok, true);
      const m = await event;
      assert.equal(m.runId, RUN);
      assert.ok(Math.abs(m.position.lat - pointAt(f).lat) < 1e-6);
      etas.push(m.etaMinutes);
    }
    assert.deepEqual(etas, [...etas].sort((a, b) => b - a), `ETA should fall: ${etas}`);
    assert.ok(etas[0] >= 30 && etas[0] <= 36, `first ETA about 33 min (planned and measured speed mixed), got ${etas[0]}`);
    assert.ok(etas[2] >= 14 && etas[2] <= 16, `half way: about 15 min, got ${etas[2]}`);
    assert.ok(etas[4] <= 1, `almost there: ${etas[4]}`);
  });

  it('ignores a repeated position and refuses invalid ones', async () => {
    const again = await emitAck(driverSock, 'driver:ping', ping(0.97, 80, 4 * 30));
    assert.deepEqual({ ok: again.ok, duplicate: again.duplicate }, { ok: true, duplicate: true });
    const bad = await emitAck(driverSock, 'driver:ping', { ...ping(0.5, 80, 200), lat: 200 });
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 400);
    const other = await connect(await login('driver2'));
    const stolen = await emitAck(other, 'driver:ping', ping(0.5, 80, 210));
    assert.equal(stolen.status, 403);
  });

  it('also accepts positions over plain HTTP', async () => {
    const r = await call('POST', `/driver/runs/${RUN}/pings`, { token: driverToken, body: ping(0.6, 70, 230) });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });

  it('says "Delayed" when the bus crawls for five minutes', async () => {
    // The ETA uses the average speed since departure, so a short stop does not flip the label;
    // five minutes at 8 km/h pulls the average down far enough to make the bus late.
    let last;
    for (let i = 0; i < 10; i++) {
      const event = once(riderSock, 'bus:position');
      await emitAck(driverSock, 'driver:ping', ping(0.4, 8, 300 + i * 30));
      last = await event;
    }
    assert.equal(last.statusLabel, 'Delayed');
    assert.ok(last.delayMinutes > 5);
  });

  it('gives the ETA to a rider\'s stop and knows when the bus has passed it', async () => {
    const stops = route.stops;
    const ahead = await call('GET', `/runs/${RUN}/live?stopId=${stops[1].id}`, { token: riderToken });
    assert.equal(ahead.body.live.stop.passed, false);
    const passed = await call('GET', `/runs/${RUN}/live?stopId=${stops[stops.length - 1].id}`, { token: riderToken });
    assert.equal(passed.body.live.stop.passed, true);
  });

  it('tells the admin about problems reported by the driver, and about "bus full" reports from riders', async () => {
    const problem = once(adminSock, 'report:new');
    const r = await call('POST', `/driver/runs/${RUN}/problems`, { token: driverToken, body: { type: 'traffic_delay', note: 'Accident on the ring road' } });
    assert.equal(r.status, 201);
    const m = await problem;
    assert.equal(m.type, 'traffic_delay');
    assert.equal((await call('POST', `/driver/runs/${RUN}/problems`, { token: driverToken, body: { type: 'volcano' } })).status, 400);

    const full = once(adminSock, 'report:new');
    assert.equal((await call('POST', `/runs/${RUN}/full-report`, { token: riderToken })).status, 201);
    assert.equal((await full).kind, 'rider_full');
    assert.equal((await call('POST', `/runs/${RUN}/full-report`, { token: riderToken })).body.duplicate, true);
    const reports = await call('GET', '/admin/reports?date=2026-10-08', { token: adminToken });
    assert.equal(reports.body.problems.length, 1);
    assert.equal(reports.body.riderReports.length, 1);
  });

  it('ends the trip, which then shows as arrived and takes no more positions', async () => {
    assert.equal((await call('POST', `/driver/runs/${RUN}/end`, { token: driverToken })).status, 200);
    const live = await call('GET', `/runs/${RUN}/live`, { token: riderToken });
    assert.equal(live.body.status, 'completed');
    assert.equal(live.body.live.statusLabel, 'Arrived');
    const late = await emitAck(driverSock, 'driver:ping', ping(0.3, 50, 600));
    assert.equal(late.status, 409);
    const history = await call('GET', `/runs/${RUN}/pings`, { token: riderToken });
    assert.ok(history.body.pings.length >= 12);
  });
});

describe('admin: assignments, buses, drivers and days', () => {
  let admin;
  before(async () => { admin = await login('admin'); });

  it('re-assigns a driver, records the change and tells the new driver', async () => {
    const runs = (await call('GET', '/admin/overview?date=2026-10-08', { token: admin })).body.runs;
    const run = runs.find((r) => r.id === 30);
    const drivers = (await call('GET', '/admin/drivers', { token: admin })).body.drivers;
    const newDriver = drivers.find((d) => d.id !== run.driver.id);
    const before = (await pool.query('select count(*)::int as n from assignment_changes')).rows[0].n;

    const sock = await connect(await login(newDriver.username));
    const event = once(sock, 'assignment:changed');
    const r = await call('PATCH', '/admin/runs/30/assignment', { token: admin, body: { driverId: newDriver.id, reason: 'Test swap' } });
    assert.equal(r.status, 200);
    assert.equal((await event).newDriverId, newDriver.id);
    const after = (await pool.query('select count(*)::int as n from assignment_changes')).rows[0].n;
    assert.equal(after, before + 1);
    assert.equal((await call('PATCH', '/admin/runs/30/assignment', { token: admin, body: { driverId: newDriver.id } })).status, 400);
  });

  it('refuses to re-assign a trip that has started, or to use a user who is not a driver, or a bus in maintenance', async () => {
    assert.equal((await call('PATCH', `/admin/runs/${RUN}/assignment`, { token: admin, body: { driverId: 3 } })).status, 409);
    assert.equal((await call('PATCH', '/admin/runs/30/assignment', { token: admin, body: { driverId: 6 } })).status, 400);
    const bus = (await call('PATCH', '/admin/buses/3', { token: admin, body: { status: 'maintenance' } }));
    assert.equal(bus.status, 200);
    assert.equal((await call('PATCH', '/admin/runs/30/assignment', { token: admin, body: { busId: 3 } })).status, 409);
    await call('PATCH', '/admin/buses/3', { token: admin, body: { status: 'active' } });
  });

  it('refuses to give a driver two overlapping trips', async () => {
    await pool.query(`insert into trips (code, label, route_id, direction, scheduled_time) values ('extra_test', 'Extra', 1, 'outbound', '13:50')`);
    await pool.query(`insert into trip_runs (trip_id, run_date, status) select id, '2026-10-08', 'scheduled' from trips where code = 'extra_test'`);
    const extra = (await pool.query(`select r.id from trip_runs r join trips t on t.id = r.trip_id where t.code = 'extra_test'`)).rows[0].id;
    const r = await call('PATCH', `/admin/runs/${extra}/assignment`, { token: admin, body: { driverId: 2 } });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /overlapping/);
    await pool.query('delete from trip_runs where id = $1', [extra]);
    await pool.query(`delete from trips where code = 'extra_test'`);
  });

  it('blocks a driver from starting a trip whose bus is in maintenance', async () => {
    const run = (await call('GET', '/runs/29/live', { token: admin })).body;
    await call('PATCH', `/admin/buses/${run.bus.id}`, { token: admin, body: { status: 'maintenance' } });
    const drv = await login((await pool.query('select username from users where id = $1', [run.driver.id])).rows[0].username);
    assert.equal((await call('POST', '/driver/runs/29/start', { token: drv })).status, 409);
    await call('PATCH', `/admin/buses/${run.bus.id}`, { token: admin, body: { status: 'active' } });
  });

  it('cancels a trip once, and creates the runs of a new day (not on Friday)', async () => {
    assert.equal((await call('POST', '/admin/runs/30/cancel', { token: admin })).status, 200);
    assert.equal((await call('POST', '/admin/runs/30/cancel', { token: admin })).status, 409);
    assert.equal((await call('POST', '/admin/runs/generate', { token: admin, body: { date: '2026-10-09' } })).status, 400);
    assert.equal((await call('POST', '/admin/runs/generate', { token: admin, body: { date: '2026-10-10' } })).body.created, 5);
    assert.equal((await call('POST', '/admin/runs/generate', { token: admin, body: { date: '2026-10-10' } })).body.created, 0);
    const day = await call('GET', '/admin/overview?date=2026-10-10', { token: admin });
    assert.equal(day.body.unassigned, 5);
  });

  it('adds a driver with a login, adds a bus, and changes what riders can see', async () => {
    const d = await call('POST', '/admin/drivers', { token: admin, body: { name: 'New Driver', username: 'driver9', password: 'longenough1', phone: '+20-000-000-0099' } });
    assert.equal(d.status, 201);
    assert.equal((await call('POST', '/auth/login', { body: { username: 'driver9', password: 'longenough1' } })).status, 200);
    assert.equal((await call('POST', '/admin/drivers', { token: admin, body: { name: 'Dup', username: 'driver9', password: 'longenough1' } })).status, 409);
    assert.equal((await call('POST', '/admin/drivers', { token: admin, body: { name: 'Short', username: 'x1', password: '123' } })).status, 400);
    const shared = await call('PATCH', `/admin/drivers/${d.body.id}`, { token: admin, body: { sharesPhone: true } });
    assert.equal(shared.body.sharesPhone, true);
    const bus = await call('POST', '/admin/buses', { token: admin, body: { busNumber: '99', plate: 'TEST-099', capacity: 40, deviceId: 'phone_bus_99' } });
    assert.equal(bus.status, 201);
  });
});

describe('rider alerts', () => {
  it('creates, updates, lists and deletes an alert, and validates the input', async () => {
    const rider = await login('student01');   // already has an alert on trip 28 in the data, none on trip 29
    const a = await call('POST', '/alerts', { token: rider, body: { runId: 29, stopId: 6, minutesBefore: 5 } });
    assert.equal(a.status, 201);
    const again = await call('POST', '/alerts', { token: rider, body: { runId: 29, stopId: 6, minutesBefore: 10 } });
    assert.equal(again.body.updated, true);
    assert.equal((await call('POST', '/alerts', { token: rider, body: { runId: 29, stopId: 6, minutesBefore: 3 } })).status, 400);
    assert.equal((await call('POST', '/alerts', { token: rider, body: { runId: 29, stopId: 999, minutesBefore: 5 } })).status, 400);
    assert.equal((await call('POST', '/alerts', { token: rider, body: { runId: 26, stopId: 6, minutesBefore: 5 } })).status, 409);
    const list = (await call('GET', '/alerts', { token: rider })).body.alerts;
    assert.equal(list.length, 2);                                   // the one from the data and the new one
    assert.equal(list.find((x) => x.id === a.body.id).minutesBefore, 10);
    assert.equal((await call('DELETE', `/alerts/${a.body.id}`, { token: rider })).status, 200);
    assert.equal((await call('DELETE', `/alerts/${a.body.id}`, { token: rider })).status, 404);
  });
});
