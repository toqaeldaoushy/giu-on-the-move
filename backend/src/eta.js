import { config } from './config.js';
import { parseLocal } from './time.js';

const STATUS_LABELS = {
  scheduled: 'Not started',
  in_progress: 'On time',
  completed: 'Arrived',
  cancelled: 'Cancelled',
};

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const MIN_SPEED_KMH = 5;          // a stopped bus still gets a finite ETA
const TRUST_FULLY_AFTER = 0.25;   // share of the route after which the measured speed is fully trusted

/**
 * First version of the ETA: the distance still to travel along the route, divided by an expected speed.
 * The expected speed mixes the PLANNED speed (route length / planned trip time) with the bus's RECENT
 * speed (average of its last 6 pings). Early in the trip the bus is still on slow local roads, so the
 * planned speed counts most; the measured speed takes over as the trip progresses (fully after 25% of
 * the route). This avoids absurd ETAs right after departure.
 * The status label compares the expected arrival with the scheduled arrival
 * (scheduled departure + the planned trip time).
 *
 * run:    { status, direction, run_date, scheduled_time }
 * route:  from buildRoute()
 * pings:  the latest pings of the run, oldest first: { timestamp, lat, lon, speed_kmh }
 * stop:   optional { lat, lon } to get the ETA to a stop instead of the final destination
 */
export function computeLive({ run, route, pings, stop = null }) {
  const live = {
    statusLabel: STATUS_LABELS[run.status] ?? run.status,
    position: null, speedKmh: null, lastPingAt: null,
    progress: null, remainingKm: null, etaMinutes: null, delayMinutes: null, stop: null,
  };

  if (run.status === 'completed') { live.etaMinutes = 0; live.progress = 1; live.remainingKm = 0; }
  if (!pings.length) return live;

  const last = pings[pings.length - 1];
  live.position = { lat: last.lat, lon: last.lon };
  live.speedKmh = last.speed_kmh;
  live.lastPingAt = last.timestamp;
  if (run.status === 'completed') return live;

  const inbound = run.direction === 'inbound';
  const { sKm } = route.project(last.lat, last.lon);
  const progressKm = inbound ? sKm : route.totalKm - sKm;
  live.progress = round(Math.min(1, Math.max(0, progressKm / route.totalKm)), 3);
  live.remainingKm = round(Math.max(0, route.totalKm - progressKm), 2);
  if (run.status !== 'in_progress') return live;

  const recent = pings.slice(-6).map((p) => p.speed_kmh);
  const recentSpeed = Math.max(MIN_SPEED_KMH, recent.reduce((a, b) => a + b, 0) / recent.length);
  const plannedSpeed = route.totalKm / (config.plannedTripMin / 60);
  const trust = Math.min(1, progressKm / (route.totalKm * TRUST_FULLY_AFTER));
  const avgSpeed = (1 - trust) * plannedSpeed + trust * recentSpeed;
  const etaMin = (live.remainingKm / avgSpeed) * 60;
  live.etaMinutes = Math.round(etaMin);

  const expectedArrival = parseLocal(last.timestamp) + etaMin * 60000;
  const scheduledArrival = parseLocal(`${run.run_date}T${run.scheduled_time}`) + config.plannedTripMin * 60000;
  live.delayMinutes = Math.round((expectedArrival - scheduledArrival) / 60000);
  live.statusLabel = live.delayMinutes > config.lateThresholdMin ? 'Delayed' : 'On time';

  if (stop) {
    const stopKm = route.project(stop.lat, stop.lon).sKm;
    const stopProgress = inbound ? stopKm : route.totalKm - stopKm;
    const ahead = stopProgress - progressKm;
    live.stop = ahead < -0.2
      ? { passed: true, etaMinutes: null }
      : { passed: false, etaMinutes: Math.round((Math.max(0, ahead) / avgSpeed) * 60) };
  }
  return live;
}
