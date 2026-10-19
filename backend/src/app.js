import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { HttpError, toInt, checkDate } from './errors.js';
import { login, requireAuth, requireRole } from './auth.js';
import { formatLocal, dateOf, parseLocal } from './time.js';
import {
  RUN_SELECT, getRun, getRunOr404, getRoute, loadLive, runDto,
  startRun, endRun, recordPing, reportProblem, changeAssignment,
} from './runs.js';

const DAY_OFF = 5; // Friday (JavaScript: Sunday = 0 ... Friday = 5)

export function createApp(ctx) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();
  const today = () => dateOf(ctx.clock());
  const dateParam = (req) => checkDate(req.query.date ?? today());

  // ---- Open endpoints ---------------------------------------------------------------------
  api.get('/health', (req, res) => res.json({ ok: true }));
  api.get('/time', (req, res) => res.json({ now: formatLocal(ctx.clock()), simulated: Boolean(config.simulatedNow) }));
  api.post('/auth/login', async (req, res) => {
    res.json(await login(ctx, req.body?.username, req.body?.password));
  });

  // ---- Everything below needs a login --------------------------------------------------------
  api.use(requireAuth);
  api.get('/me', (req, res) => res.json({ user: req.user }));

  api.get('/route', async (req, res) => {
    const { rows } = await ctx.pool.query('select id, name from routes order by id limit 1');
    if (!rows[0]) throw new HttpError(404, 'No route found');
    const route = await getRoute(ctx, rows[0].id);
    res.json({ id: rows[0].id, name: rows[0].name, points: route.points, stops: route.stops });
  });

  // The timetable of one day, with the live state of each trip
  api.get('/timetable', async (req, res) => {
    const date = dateParam(req);
    const { rows } = await ctx.pool.query(`${RUN_SELECT} where r.run_date = $1 order by t.scheduled_time`, [date]);
    const runs = [];
    for (const row of rows) runs.push(runDto(row, req.user.role, await loadLive(ctx, row)));
    res.json({ date, now: formatLocal(ctx.clock()), runs });
  });

  api.get('/runs/:id/live', async (req, res) => {
    const run = await getRunOr404(ctx.pool, toInt(req.params.id, 'id'));
    const stopId = req.query.stopId ? toInt(req.query.stopId, 'stopId') : undefined;
    res.json(runDto(run, req.user.role, await loadLive(ctx, run, { stopId })));
  });

  api.get('/runs/:id/pings', async (req, res) => {
    const id = toInt(req.params.id, 'id');
    await getRunOr404(ctx.pool, id);
    const { rows } = await ctx.pool.query(
      `select "timestamp", lat, lon, speed_kmh as "speedKmh" from gps_pings where trip_run_id = $1 order by "timestamp" limit 5000`, [id]);
    res.json({ runId: id, pings: rows });
  });

  // ---- Rider ---------------------------------------------------------------------------------------
  const rider = requireRole('rider');

  api.post('/alerts', rider, async (req, res) => {
    const runId = toInt(req.body?.runId, 'runId');
    const stopId = toInt(req.body?.stopId, 'stopId');
    const minutes = toInt(req.body?.minutesBefore, 'minutesBefore');
    if (![2, 5, 10].includes(minutes)) throw new HttpError(400, 'minutesBefore must be 2, 5 or 10');
    const run = await getRunOr404(ctx.pool, runId);
    if (!['scheduled', 'in_progress'].includes(run.status)) throw new HttpError(409, 'You can only set an alert for a trip that is not finished');
    const route = await getRoute(ctx, run.route_id);
    if (!route.stops.some((s) => s.id === stopId)) throw new HttpError(400, 'That stop is not on this trip\'s route');

    const existing = await ctx.pool.query(
      'select id from alerts where user_id = $1 and trip_run_id = $2 and stop_id = $3', [req.user.id, runId, stopId]);
    if (existing.rowCount) {
      await ctx.pool.query('update alerts set minutes_before = $2 where id = $1', [existing.rows[0].id, minutes]);
      return res.json({ id: existing.rows[0].id, runId, stopId, minutesBefore: minutes, updated: true });
    }
    const ins = await ctx.pool.query(
      `insert into alerts (user_id, trip_run_id, stop_id, minutes_before, created_at) values ($1, $2, $3, $4, $5) returning id`,
      [req.user.id, runId, stopId, minutes, formatLocal(ctx.clock())]);
    res.status(201).json({ id: ins.rows[0].id, runId, stopId, minutesBefore: minutes });
  });

  api.get('/alerts', rider, async (req, res) => {
    const { rows } = await ctx.pool.query(
      `select a.id, a.trip_run_id as "runId", a.stop_id as "stopId", a.minutes_before as "minutesBefore",
              r.run_date as date, t.code as "tripCode", t.scheduled_time as "scheduledTime"
         from alerts a join trip_runs r on r.id = a.trip_run_id join trips t on t.id = r.trip_id
        where a.user_id = $1 order by r.run_date desc, t.scheduled_time`, [req.user.id]);
    res.json({ alerts: rows.map((a) => ({ ...a, scheduledTime: String(a.scheduledTime).slice(0, 5) })) });
  });

  api.delete('/alerts/:id', rider, async (req, res) => {
    const r = await ctx.pool.query('delete from alerts where id = $1 and user_id = $2', [toInt(req.params.id, 'id'), req.user.id]);
    if (!r.rowCount) throw new HttpError(404, 'Alert not found');
    res.json({ ok: true });
  });

  api.post('/runs/:id/full-report', rider, async (req, res) => {
    const runId = toInt(req.params.id, 'id');
    const run = await getRunOr404(ctx.pool, runId);
    if (run.status !== 'in_progress') throw new HttpError(409, 'You can only report a full bus while the trip is in progress');
    const existing = await ctx.pool.query(
      `select id from rider_reports where user_id = $1 and trip_run_id = $2 and report_type = 'bus_full'`, [req.user.id, runId]);
    if (existing.rowCount) return res.json({ ok: true, duplicate: true });
    await ctx.pool.query(
      `insert into rider_reports (user_id, trip_run_id, report_type, created_at) values ($1, $2, 'bus_full', $3)`,
      [req.user.id, runId, formatLocal(ctx.clock())]);
    ctx.io?.to('admin').emit('report:new', { kind: 'rider_full', runId });
    res.status(201).json({ ok: true });
  });

  // ---- Driver ------------------------------------------------------------------------------------------
  const driver = requireRole('driver');

  api.get('/driver/runs', driver, async (req, res) => {
    const date = dateParam(req);
    const { rows } = await ctx.pool.query(`${RUN_SELECT} where r.run_date = $1 and r.driver_id = $2 order by t.scheduled_time`, [date, req.user.id]);
    res.json({ date, runs: rows.map((r) => runDto(r, 'driver')) });
  });
  api.post('/driver/runs/:id/start', driver, async (req, res) => res.json(await startRun(ctx, req.user, toInt(req.params.id, 'id'))));
  api.post('/driver/runs/:id/end', driver, async (req, res) => res.json(await endRun(ctx, req.user, toInt(req.params.id, 'id'))));
  api.post('/driver/runs/:id/pings', driver, async (req, res) => res.json(await recordPing(ctx, req.user, toInt(req.params.id, 'id'), req.body)));
  api.post('/driver/runs/:id/problems', driver, async (req, res) =>
    res.status(201).json(await reportProblem(ctx, req.user, toInt(req.params.id, 'id'), req.body ?? {})));

  // ---- Admin ---------------------------------------------------------------------------------------------
  const admin = express.Router();
  admin.use(requireRole('admin'));

  admin.get('/overview', async (req, res) => {
    const date = dateParam(req);
    const { rows } = await ctx.pool.query(`${RUN_SELECT} where r.run_date = $1 order by t.scheduled_time`, [date]);
    const runs = [];
    for (const row of rows) runs.push(runDto(row, 'admin', await loadLive(ctx, row)));
    const counts = {};
    for (const r of runs) counts[r.status] = (counts[r.status] ?? 0) + 1;
    res.json({ date, now: formatLocal(ctx.clock()), counts, unassigned: runs.filter((r) => !r.bus || !r.driver).length, runs });
  });

  admin.get('/buses', async (req, res) => {
    const { rows } = await ctx.pool.query(
      `select id, bus_number as "busNumber", plate, capacity, status, device_id as "deviceId" from buses order by bus_number`);
    res.json({ buses: rows });
  });
  admin.post('/buses', async (req, res) => {
    const b = req.body ?? {};
    const capacity = toInt(b.capacity, 'capacity');
    if (!b.busNumber || !b.plate || !b.deviceId) throw new HttpError(400, 'busNumber, plate, capacity and deviceId are required');
    const { rows } = await ctx.pool.query(
      `insert into buses (bus_number, plate, capacity, status, device_id) values ($1, $2, $3, 'active', $4)
       returning id, bus_number as "busNumber", plate, capacity, status, device_id as "deviceId"`,
      [String(b.busNumber), String(b.plate), capacity, String(b.deviceId)]);
    res.status(201).json(rows[0]);
  });
  admin.patch('/buses/:id', async (req, res) => {
    const id = toInt(req.params.id, 'id');
    const b = req.body ?? {};
    const sets = []; const vals = [];
    if (b.status !== undefined) {
      if (!['active', 'maintenance'].includes(b.status)) throw new HttpError(400, 'status must be active or maintenance');
      sets.push(`status = $${vals.push(b.status)}`);
    }
    if (b.capacity !== undefined) sets.push(`capacity = $${vals.push(toInt(b.capacity, 'capacity'))}`);
    if (b.plate !== undefined) sets.push(`plate = $${vals.push(String(b.plate))}`);
    if (b.deviceId !== undefined) sets.push(`device_id = $${vals.push(String(b.deviceId))}`);
    if (!sets.length) throw new HttpError(400, 'Nothing to change');
    const { rows } = await ctx.pool.query(
      `update buses set ${sets.join(', ')} where id = $${vals.push(id)}
       returning id, bus_number as "busNumber", plate, capacity, status, device_id as "deviceId"`, vals);
    if (!rows[0]) throw new HttpError(404, 'Bus not found');
    res.json(rows[0]);
  });

  admin.get('/drivers', async (req, res) => {
    const { rows } = await ctx.pool.query(
      `select id, name, username, phone, share_phone as "sharesPhone" from users where role = 'driver' order by name`);
    res.json({ drivers: rows });
  });
  admin.post('/drivers', async (req, res) => {
    const b = req.body ?? {};
    if (!b.name || !b.username) throw new HttpError(400, 'name and username are required');
    const password = String(b.password ?? '');
    if (password.length < 8) throw new HttpError(400, 'password must have at least 8 characters');
    const hash = await bcrypt.hash(password, 10);
    const client = await ctx.pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query(
        `insert into users (name, role, username, phone, share_phone) values ($1, 'driver', $2, $3, $4)
         returning id, name, username, phone, share_phone as "sharesPhone"`,
        [String(b.name).trim(), String(b.username).trim(), b.phone ? String(b.phone) : null, Boolean(b.sharesPhone)]);
      await client.query('insert into credentials (user_id, password_hash) values ($1, $2)', [rows[0].id, hash]);
      await client.query('commit');
      res.status(201).json(rows[0]);
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  });
  admin.patch('/drivers/:id', async (req, res) => {
    const id = toInt(req.params.id, 'id');
    const b = req.body ?? {};
    const sets = []; const vals = [];
    if (b.name !== undefined) sets.push(`name = $${vals.push(String(b.name).trim())}`);
    if (b.phone !== undefined) sets.push(`phone = $${vals.push(b.phone ? String(b.phone) : null)}`);
    if (b.sharesPhone !== undefined) sets.push(`share_phone = $${vals.push(Boolean(b.sharesPhone))}`);
    if (!sets.length) throw new HttpError(400, 'Nothing to change');
    const { rows } = await ctx.pool.query(
      `update users set ${sets.join(', ')} where id = $${vals.push(id)} and role = 'driver'
       returning id, name, username, phone, share_phone as "sharesPhone"`, vals);
    if (!rows[0]) throw new HttpError(404, 'Driver not found');
    res.json(rows[0]);
  });

  admin.patch('/runs/:id/assignment', async (req, res) => {
    const b = req.body ?? {};
    const input = {
      busId: b.busId === undefined ? undefined : (b.busId === null ? null : toInt(b.busId, 'busId')),
      driverId: b.driverId === undefined ? undefined : (b.driverId === null ? null : toInt(b.driverId, 'driverId')),
      reason: b.reason,
    };
    res.json(await changeAssignment(ctx, req.user, toInt(req.params.id, 'id'), input));
  });

  admin.post('/runs/:id/cancel', async (req, res) => {
    const id = toInt(req.params.id, 'id');
    const r = await ctx.pool.query(`update trip_runs set status = 'cancelled' where id = $1 and status = 'scheduled'`, [id]);
    if (!r.rowCount) {
      await getRunOr404(ctx.pool, id);
      throw new HttpError(409, 'Only a trip that has not started can be cancelled');
    }
    ctx.io?.to(`run:${id}`).to('admin').emit('trip:status', { runId: id, status: 'cancelled', statusLabel: 'Cancelled' });
    res.json({ ok: true, status: 'cancelled' });
  });

  // Create the day's trip runs from the timetable (no bus or driver yet)
  admin.post('/runs/generate', async (req, res) => {
    const date = checkDate(req.body?.date);
    if (new Date(parseLocal(date)).getUTCDay() === DAY_OFF) throw new HttpError(400, 'Friday is the day off: no trips run');
    const { rows } = await ctx.pool.query(
      `insert into trip_runs (trip_id, run_date, status)
       select id, $1::date, 'scheduled' from trips
       on conflict (trip_id, run_date) do nothing returning id`, [date]);
    res.status(201).json({ date, created: rows.length });
  });

  admin.get('/reports', async (req, res) => {
    const date = dateParam(req);
    const problems = await ctx.pool.query(
      `select p.id, p.trip_run_id as "runId", t.code as "tripCode", p.report_type as type, p.note,
              u.name as "driverName", p.created_at as "createdAt"
         from problem_reports p join trip_runs r on r.id = p.trip_run_id join trips t on t.id = r.trip_id
         join users u on u.id = p.driver_id where r.run_date = $1 order by p.created_at`, [date]);
    const riders = await ctx.pool.query(
      `select x.id, x.trip_run_id as "runId", t.code as "tripCode", x.report_type as type, x.created_at as "createdAt"
         from rider_reports x join trip_runs r on r.id = x.trip_run_id join trips t on t.id = r.trip_id
        where r.run_date = $1 order by x.created_at`, [date]);
    res.json({ date, problems: problems.rows, riderReports: riders.rows });
  });

  admin.get('/assignment-changes', async (req, res) => {
    const { rows } = await ctx.pool.query(
      `select c.id, c.trip_run_id as "runId", c.old_driver_id as "oldDriverId", c.new_driver_id as "newDriverId",
              c.old_bus_id as "oldBusId", c.new_bus_id as "newBusId", c.reason, c.changed_at as "changedAt"
         from assignment_changes c order by c.changed_at desc limit 100`);
    res.json({ changes: rows });
  });

  api.use('/admin', admin);
  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || 500;
    let message = err.message;
    if (err.code === '23505') { status = 409; message = 'That value already exists'; }
    else if (err.code === '23503') { status = 409; message = 'That item is used by other data'; }
    else if (err.code === '23514' || err.code === '22P02' || err.code === '22007') { status = 400; message = 'One of the values is not valid'; }
    else if (err.type === 'entity.parse.failed') { status = 400; message = 'The request body is not valid JSON'; }
    if (status >= 500) { console.error(err); message = 'Server error'; }
    res.status(status).json({ error: message });
  });

  return app;
}
