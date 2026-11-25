import { HttpError } from './errors.js';
import { buildRoute } from './geo.js';
import { computeLive } from './eta.js';
import { config } from './config.js';
import { formatLocal, parseLocal } from './time.js';

/**
 * The timetable change that applies to a run on its date, if the administrator made one (the newest wins).
 * Needs "r" (trip_runs) and "t" (trips) in the query; gives "sc.new_time" and "sc.reason".
 */
export const CHANGE_JOIN = `
    left join lateral (
      select c.new_time, c.reason from schedule_changes c
       where c.trip_id = t.id and r.run_date between c.from_date and c.to_date
       order by c.id desc limit 1) sc on true`;

/** One trip run with its trip, bus and driver; scheduled_time already includes a timetable change. Add a WHERE clause after it. */
export const RUN_SELECT = `
  select r.id, r.run_date, r.status, r.actual_start, r.actual_end, r.bus_id, r.driver_id, r.occupancy, r.occupancy_at,
         t.id as trip_id, t.code, t.label, t.direction, t.route_id,
         coalesce(sc.new_time, t.scheduled_time) as scheduled_time, t.scheduled_time as usual_time, sc.reason as change_reason,
         b.bus_number, b.plate, b.device_id, b.status as bus_status,
         u.name as driver_name, u.phone as driver_phone, u.share_phone
    from trip_runs r
    join trips t on t.id = r.trip_id
    ${CHANGE_JOIN}
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
    ...(row.usual_time && String(row.usual_time) !== String(row.scheduled_time)
      ? { timeChange: { usualTime: String(row.usual_time).slice(0, 5), reason: row.change_reason ?? null } }
      : {}),
    routeId: row.route_id,
    bus: row.bus_id ? { id: row.bus_id, number: row.bus_number, plate: row.plate } : null,
    driver: row.driver_id
      ? { id: row.driver_id, name: row.driver_name, phone, ...(role === 'admin' ? { sharesPhone: row.share_phone } : {}) }
      : null,
    // Seat availability, as the driver last reported it during the trip
    occupancy: row.occupancy && row.status === 'in_progress' ? { level: row.occupancy, at: row.occupancy_at } : null,
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
  await sendDueAlerts(ctx, run);
  await sendDelayNotice(ctx, run, live);
  return { ok: true, id: ins.rows[0].id, live };
}

/**
 * Delay alerts: the first time a trip turns "Delayed", every rider who set a reminder for it is told
 * once ("trip:delayed"), so that riders waiting for this bus learn about the delay without opening it.
 */
async function sendDelayNotice(ctx, run, live) {
  if (live.statusLabel !== 'Delayed') return;
  ctx.delayNoticed ??= new Set();
  if (ctx.delayNoticed.has(run.id)) return;
  ctx.delayNoticed.add(run.id);
  const { rows } = await ctx.pool.query('select distinct user_id from alerts where trip_run_id = $1', [run.id]);
  for (const r of rows) {
    ctx.io?.to(`user:${r.user_id}`).emit('trip:delayed', {
      runId: run.id, label: run.label, scheduledTime: String(run.scheduled_time).slice(0, 5), delayMinutes: live.delayMinutes,
    });
  }
}

/**
 * Rider alerts (FR4): after each new position, every alert of this trip whose stop is now
 * "minutes before" away or less is sent once to the rider's phone over the live connection
 * ("alert:due"); the app shows it as a notification. Positions arrive every 30 s, so an alert
 * goes out within 30 s of the chosen lead time. Which alerts were sent is kept in memory: after a
 * server restart an alert can be sent once more, which is better than not at all.
 */
async function sendDueAlerts(ctx, run) {
  ctx.sentAlerts ??= new Set();
  const { rows } = await ctx.pool.query(
    `select a.id, a.user_id, a.stop_id, a.minutes_before, s.name as stop_name
       from alerts a join stops s on s.id = a.stop_id where a.trip_run_id = $1`, [run.id]);
  const due = rows.filter((a) => !ctx.sentAlerts.has(`${a.id}:${a.minutes_before}`));
  if (!due.length) return;
  const liveByStop = new Map();
  for (const a of due) {
    if (!liveByStop.has(a.stop_id)) liveByStop.set(a.stop_id, await loadLive(ctx, run, { stopId: a.stop_id }));
    const stop = liveByStop.get(a.stop_id).stop;
    if (!stop || stop.passed || stop.etaMinutes == null || stop.etaMinutes > a.minutes_before) continue;
    ctx.sentAlerts.add(`${a.id}:${a.minutes_before}`);
    ctx.io?.to(`user:${a.user_id}`).emit('alert:due', {
      alertId: a.id, runId: run.id, stopId: a.stop_id, stopName: a.stop_name,
      minutesBefore: a.minutes_before, etaMinutes: stop.etaMinutes,
    });
  }
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
      `select r.id, r.bus_id, r.driver_id, coalesce(sc.new_time, t.scheduled_time) as scheduled_time
         from trip_runs r join trips t on t.id = r.trip_id ${CHANGE_JOIN}
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

// ---- Seat availability ---------------------------------------------------------------------

export const OCCUPANCY = ['seats', 'few', 'full'];

/** The driver taps how full the bus is; riders on the trip and the office see it at once. */
export async function setOccupancy(ctx, user, runId, level) {
  if (!OCCUPANCY.includes(level)) throw new HttpError(400, 'level must be seats, few or full');
  const run = await getRunOr404(ctx.pool, runId);
  if (run.driver_id !== user.id) throw new HttpError(403, 'This trip is not assigned to you');
  if (run.status !== 'in_progress') throw new HttpError(409, 'Seat availability can only be set during the trip');
  const at = formatLocal(ctx.clock());
  await ctx.pool.query('update trip_runs set occupancy = $2, occupancy_at = $3 where id = $1', [runId, level, at]);
  ctx.io?.to(`run:${runId}`).to('admin').emit('trip:occupancy', { runId, level, at });
  // A full bus needs the office: riders further along the route cannot board, so another bus may be needed
  if (level === 'full' && run.occupancy !== 'full') {
    const live = await loadLive(ctx, run);
    ctx.io?.to('admin').emit('seats:full', {
      runId, at, label: run.label, scheduledTime: String(run.scheduled_time).slice(0, 5),
      busNumber: run.bus_number, driverName: run.driver_name, remainingKm: live?.remainingKm ?? null,
    });
  }
  return { ok: true, level, at };
}

// ---- Automatic daily trips --------------------------------------------------------------------

const FRIDAY = 5;

/**
 * Creates the day's trips from the weekly timetable (Saturday to Thursday), each with the bus and driver it had
 * the last time it ran; nothing has to be entered by hand. A bus in maintenance is left out, so the office assigns
 * another. Trips that already exist are not touched. Checked once per day and server.
 */
export async function ensureDayRuns(ctx, date) {
  ctx.ensuredDays ??= new Set();
  if (ctx.ensuredDays.has(date)) return 0;
  if (new Date(parseLocal(date)).getUTCDay() === FRIDAY) { ctx.ensuredDays.add(date); return 0; }
  const { rows } = await ctx.pool.query(
    `insert into trip_runs (trip_id, run_date, status, bus_id, driver_id)
     select t.id, $1::date, 'scheduled',
            (select r.bus_id from trip_runs r join buses b on b.id = r.bus_id
              where r.trip_id = t.id and r.run_date < $1::date and b.status = 'active'
              order by r.run_date desc limit 1),
            (select r.driver_id from trip_runs r
              where r.trip_id = t.id and r.run_date < $1::date and r.driver_id is not null
              order by r.run_date desc limit 1)
       from trips t
     on conflict (trip_id, run_date) do nothing
     returning id`, [date]);
  ctx.ensuredDays.add(date);
  return rows.length;
}

// ---- Punctuality report ---------------------------------------------------------------------------

/**
 * For each trip of the timetable over the last `days` days up to `today`: how many runs arrived on time, late or
 * were cancelled, using the same rule as the live status (late = arrived more than LATE_THRESHOLD_MIN after the
 * scheduled time plus the planned trip time), and the riders' average rating.
 */
export async function punctuality(ctx, today, days) {
  const from = formatLocal(parseLocal(today) - (days - 1) * 86400000).slice(0, 10);
  const { rows } = await ctx.pool.query(
    `select t.id as trip_id, t.label, t.code, t.direction, t.route_id, to_char(t.scheduled_time, 'HH24:MI') as usual_time,
            r.status, r.run_date, coalesce(sc.new_time, t.scheduled_time) as scheduled_time, r.actual_end,
            (select avg(f.rating)::float from trip_feedback f where f.trip_run_id = r.id) as rating,
            (select count(*)::int from trip_feedback f where f.trip_run_id = r.id) as ratings
       from trip_runs r join trips t on t.id = r.trip_id ${CHANGE_JOIN}
      where r.run_date between $1::date and $2::date and r.status in ('completed', 'cancelled')
      order by t.route_id, t.scheduled_time`, [from, today]);
  const byTrip = new Map();
  for (const row of rows) {
    const k = row.trip_id;
    if (!byTrip.has(k)) {
      byTrip.set(k, { tripId: k, label: row.label, tripCode: row.code, direction: row.direction, routeId: row.route_id,
        scheduledTime: row.usual_time, runs: 0, onTime: 0, late: 0, cancelled: 0, delays: [], ratingSum: 0, ratings: 0 });
    }
    const e = byTrip.get(k);
    e.runs += 1;
    if (row.status === 'cancelled') { e.cancelled += 1; continue; }
    if (row.actual_end) {
      const planned = parseLocal(`${row.run_date}T${row.scheduled_time}`) + config.plannedTripMin * 60000;
      const delay = Math.round((parseLocal(row.actual_end) - planned) / 60000);
      e.delays.push(delay);
      if (delay > config.lateThresholdMin) e.late += 1; else e.onTime += 1;
    }
    if (row.ratings) { e.ratingSum += row.rating * row.ratings; e.ratings += row.ratings; }
  }
  const trips = [...byTrip.values()].map(({ delays, ratingSum, ...e }) => ({
    ...e,
    averageDelayMin: delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : null,
    worstDelayMin: delays.length ? Math.max(...delays) : null,
    averageRating: e.ratings ? Math.round((ratingSum / e.ratings) * 10) / 10 : null,
  }));
  const sum = (f) => trips.reduce((a, x) => a + x[f], 0);
  const arrived = sum('onTime') + sum('late');
  return {
    from, to: today, days, lateThresholdMin: config.lateThresholdMin, plannedTripMin: config.plannedTripMin,
    totals: { runs: sum('runs'), onTime: sum('onTime'), late: sum('late'), cancelled: sum('cancelled'),
      onTimeRate: arrived ? Math.round((sum('onTime') / arrived) * 100) : null },
    trips,
  };
}
