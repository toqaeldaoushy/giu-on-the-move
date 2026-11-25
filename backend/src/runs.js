import { HttpError } from './errors.js';
import { buildRoute } from './geo.js';
import { computeLive } from './eta.js';
import { config } from './config.js';
import { formatLocal, parseLocal } from './time.js';

/** One trip run with its trip, bus and driver. Add a WHERE clause after it. */
export const RUN_SELECT = `
  select r.id, r.run_date, r.status, r.actual_start, r.actual_end, r.bus_id, r.driver_id,
         t.id as trip_id, t.code, t.label, t.direction, t.scheduled_time, t.route_id,
         b.bus_number, b.plate, b.device_id, b.status as bus_status,
         u.name as driver_name, u.phone as driver_phone, u.share_phone
    from trip_runs r
    join trips t on t.id = r.trip_id
    left join buses b on b.id = r.bus_id
    left join users u on u.id = r.driver_id`;

export async function getRun(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(`${RUN_SELECT} where r.id = $1${forUpdate ? ' for update of r' : ''}`, [id]);
  return rows[0] ?? null;
}

export async function getRunOr404(db, id, opts) {
  const run = await getRun(db, id, opts);
  if (!run) throw new HttpError(404, 'Trip run not found');
  return run;
}

export async function getRoute(ctx, routeId) {
  if (ctx.routeCache.has(routeId)) return ctx.routeCache.get(routeId);
  const points = (await ctx.pool.query('select lat, lon from route_points where route_id = $1 order by seq', [routeId])).rows;
  const stops = (await ctx.pool.query('select id, name, lat, lon, seq from stops where route_id = $1 order by seq', [routeId])).rows;
  const entry = { geo: buildRoute(points), points, stops };
  ctx.routeCache.set(routeId, entry);
  return entry;
}

export async function loadLive(ctx, run, { stopId } = {}) {
  const route = await getRoute(ctx, run.route_id);
  const stop = stopId ? route.stops.find((s) => s.id === Number(stopId)) ?? null : null;
  // A trip that has not started (or was cancelled) has no positions: no need to ask the database.
  if (run.status === 'scheduled' || run.status === 'cancelled') {
    return computeLive({ run, route: route.geo, pings: [], stop, avgSpeedKmh: null });
  }
  // One round trip: the last 6 positions, and (window function, computed before the limit)
  // the average speed of all positions since departure.
  const { rows } = await ctx.pool.query(
    `select "timestamp", lat, lon, speed_kmh, avg(speed_kmh) over ()::float as avg_all from gps_pings
      where trip_run_id = $1 order by "timestamp" desc limit 6`, [run.id]);
  return computeLive({ run, route: route.geo, pings: rows.reverse(), stop, avgSpeedKmh: rows[0]?.avg_all ?? null });
}

/** The live state of several trips at once (their database questions run side by side). */
export function loadLiveMany(ctx, runs) {
  return Promise.all(runs.map((run) => loadLive(ctx, run)));
}

/** The trip run as the apps see it. Riders only see a driver's phone number if the admin allows it. */
export function runDto(row, role, live = null) {
  const phone = role === 'admin' ? row.driver_phone : (row.share_phone ? row.driver_phone : null);
  return {
    id: row.id,
    date: row.run_date,
    status: row.status,
    tripCode: row.code,
    label: row.label,
    direction: row.direction,
    scheduledTime: String(row.scheduled_time).slice(0, 5),
    bus: row.bus_id ? { id: row.bus_id, number: row.bus_number, plate: row.plate } : null,
    driver: row.driver_id
      ? { id: row.driver_id, name: row.driver_name, phone, ...(role === 'admin' ? { sharesPhone: row.share_phone } : {}) }
      : null,
    actualStart: row.actual_start,
    actualEnd: row.actual_end,
    live,
  };
}

// ---- Events sent to the apps ------------------------------------------------------------

function emitStatus(ctx, run, status, statusLabel) {
  ctx.io?.to(`run:${run.id}`).to('admin').emit('trip:status', { runId: run.id, status, statusLabel });
}

async function inTransaction(ctx, fn) {
  const client = await ctx.pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

// ---- Driver actions -----------------------------------------------------------------------

export async function startRun(ctx, user, runId) {
  const run = await inTransaction(ctx, async (db) => {
    const r = await getRunOr404(db, runId, { forUpdate: true });
    if (r.driver_id !== user.id) throw new HttpError(403, 'This trip is not assigned to you');
    if (r.status !== 'scheduled') throw new HttpError(409, `This trip is already ${r.status.replace('_', ' ')}`);
    if (!r.bus_id) throw new HttpError(409, 'No bus is assigned to this trip yet');
    if (r.bus_status !== 'active') throw new HttpError(409, 'The assigned bus is not active');
    const busy = await db.query(
      `select id from trip_runs where status = 'in_progress' and id <> $1 and (driver_id = $2 or bus_id = $3)`,
      [runId, r.driver_id, r.bus_id]);
    if (busy.rowCount) throw new HttpError(409, 'You or the bus already have a trip in progress');
    await db.query(`update trip_runs set status = 'in_progress', actual_start = $2 where id = $1`,
      [runId, formatLocal(ctx.clock())]);
    return r;
  });
  emitStatus(ctx, run, 'in_progress', 'On time');
  return { ok: true, status: 'in_progress' };
}

export async function endRun(ctx, user, runId) {
  const run = await inTransaction(ctx, async (db) => {
    const r = await getRunOr404(db, runId, { forUpdate: true });
    if (r.driver_id !== user.id) throw new HttpError(403, 'This trip is not assigned to you');
    if (r.status !== 'in_progress') throw new HttpError(409, 'Only a trip in progress can be ended');
    await db.query(
      `update trip_runs set status = 'completed',
              actual_end = coalesce((select max("timestamp") from gps_pings where trip_run_id = $1), $2::timestamp)
        where id = $1`, [runId, formatLocal(ctx.clock())]);
    return r;
  });
  emitStatus(ctx, run, 'completed', 'Arrived');
  return { ok: true, status: 'completed' };
}

function validatePing(p) {
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  const speed = p.speedKmh === undefined || p.speedKmh === null ? 0 : Number(p.speedKmh);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new HttpError(400, 'lat must be a number between -90 and 90');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new HttpError(400, 'lon must be a number between -180 and 180');
  if (!Number.isFinite(speed) || speed < 0 || speed > 300) throw new HttpError(400, 'speedKmh must be a number between 0 and 300');
  return { lat, lon, speed };
}

export async function recordPing(ctx, user, runId, payload) {
  const run = await getRunOr404(ctx.pool, runId);
  if (run.driver_id !== user.id) throw new HttpError(403, 'This trip is not assigned to you');
  if (run.status !== 'in_progress') throw new HttpError(409, 'The trip is not in progress. Start the trip first');
  if (!run.bus_id) throw new HttpError(409, 'No bus is assigned to this trip');
  const { lat, lon, speed } = validatePing(payload ?? {});

  let timestamp;
  if (payload.timestamp) {
    const ms = parseLocal(payload.timestamp);
    if (Number.isNaN(ms)) throw new HttpError(400, 'timestamp must look like 2026-10-08T13:45:30');
    timestamp = formatLocal(ms);
  } else {
    timestamp = formatLocal(ctx.clock());
  }

  const ins = await ctx.pool.query(
    `insert into gps_pings (trip_run_id, bus_id, device_id, "timestamp", lat, lon, speed_kmh)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (trip_run_id, "timestamp") do nothing returning id`,
    [runId, run.bus_id, run.device_id, timestamp, lat, lon, speed]);
  if (!ins.rowCount) return { ok: true, duplicate: true };

  const live = await loadLive(ctx, run);
  ctx.io?.to(`run:${runId}`).emit('bus:position', {
    runId, timestamp, position: live.position, speedKmh: live.speedKmh,
    etaMinutes: live.etaMinutes, statusLabel: live.statusLabel, delayMinutes: live.delayMinutes,
    progress: live.progress, remainingKm: live.remainingKm,
  });
  return { ok: true, id: ins.rows[0].id, live };
}

export const PROBLEM_TYPES = ['traffic_delay', 'breakdown', 'bus_full', 'other'];

export async function reportProblem(ctx, user, runId, { type, note }) {
  if (!PROBLEM_TYPES.includes(type)) throw new HttpError(400, `type must be one of: ${PROBLEM_TYPES.join(', ')}`);
  const text = note == null ? null : String(note).trim().slice(0, 500) || null;
  const run = await getRunOr404(ctx.pool, runId);
  if (run.driver_id !== user.id) throw new HttpError(403, 'This trip is not assigned to you');
  if (!['scheduled', 'in_progress'].includes(run.status)) throw new HttpError(409, 'Problems can only be reported for a trip that is not finished');
  const { rows } = await ctx.pool.query(
    `insert into problem_reports (trip_run_id, driver_id, report_type, note, created_at)
     values ($1, $2, $3, $4, $5) returning id, created_at`,
    [runId, user.id, type, text, formatLocal(ctx.clock())]);
  ctx.io?.to('admin').emit('report:new', { kind: 'problem', runId, type, note: text, driver: user.name });
  return { ok: true, id: rows[0].id };
}

// ---- Admin: assignment -------------------------------------------------------------------

const PLANNED_WINDOW_MIN = () => config.plannedTripMin + 20;

export async function changeAssignment(ctx, admin, runId, { busId, driverId, reason }) {
  const result = await inTransaction(ctx, async (db) => {
    const run = await getRunOr404(db, runId, { forUpdate: true });
    if (run.status !== 'scheduled') throw new HttpError(409, 'Only a trip that has not started can be re-assigned');

    const newBus = busId === undefined ? run.bus_id : busId;
    const newDriver = driverId === undefined ? run.driver_id : driverId;
    if (newBus === run.bus_id && newDriver === run.driver_id) throw new HttpError(400, 'Nothing to change');

    if (newBus != null) {
      const b = (await db.query('select id, status from buses where id = $1', [newBus])).rows[0];
      if (!b) throw new HttpError(400, 'That bus does not exist');
      if (b.status !== 'active') throw new HttpError(409, 'That bus is not active');
    }
    if (newDriver != null) {
      const d = (await db.query('select id, role from users where id = $1', [newDriver])).rows[0];
      if (!d || d.role !== 'driver') throw new HttpError(400, 'That user is not a driver');
    }

    // The same driver or bus cannot be on two trips that overlap on the same day
    const others = await db.query(
      `select r.id, r.bus_id, r.driver_id, t.scheduled_time
         from trip_runs r join trips t on t.id = r.trip_id
        where r.run_date = $1 and r.id <> $2 and r.status <> 'cancelled' and (r.bus_id = $3 or r.driver_id = $4)`,
      [run.run_date, runId, newBus, newDriver]);
    const mine = parseLocal(`${run.run_date}T${run.scheduled_time}`);
    for (const o of others.rows) {
      const theirs = parseLocal(`${run.run_date}T${o.scheduled_time}`);
      if (Math.abs(mine - theirs) < PLANNED_WINDOW_MIN() * 60000) {
        const what = o.driver_id === newDriver && newDriver != null ? 'driver' : 'bus';
        throw new HttpError(409, `That ${what} already has an overlapping trip at ${String(o.scheduled_time).slice(0, 5)}`);
      }
    }

    await db.query('update trip_runs set bus_id = $2, driver_id = $3 where id = $1', [runId, newBus, newDriver]);
    await db.query(
      `insert into assignment_changes (trip_run_id, old_driver_id, new_driver_id, old_bus_id, new_bus_id, changed_by, reason, changed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [runId, run.driver_id, newDriver, run.bus_id, newBus, admin.id,
        reason ? String(reason).slice(0, 300) : null, formatLocal(ctx.clock())]);
    return { run, newBus, newDriver };
  });

  const { run, newBus, newDriver } = result;
  const event = { runId, oldDriverId: run.driver_id, newDriverId: newDriver, oldBusId: run.bus_id, newBusId: newBus };
  let room = ctx.io?.to(`run:${runId}`).to('admin');
  for (const id of new Set([run.driver_id, newDriver])) if (id != null) room = room?.to(`user:${id}`);
  room?.emit('assignment:changed', event);
  return { ok: true, ...event };
}
