// All times in the database are local Cairo wall-clock times without a time zone ("naive" times).
// These helpers convert them to numbers (milliseconds) without any time zone surprises.

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 'YYYY-MM-DD', 'YYYY-MM-DD HH:MM[:SS]' or 'YYYY-MM-DDTHH:MM[:SS]' -> milliseconds (as if UTC). */
export function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

/** milliseconds -> 'YYYY-MM-DDTHH:MM:SS' */
export function formatLocal(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
         `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export const dateOf = (ms) => formatLocal(ms).slice(0, 10);

function cairoWallClockMs() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

/**
 * The server's clock. With a simulated start time it keeps ticking from that moment,
 * so the seeded data (which says "now" is Thursday 13:40) can be demonstrated on any day.
 */
export function makeClock(simulatedNow) {
  if (!simulatedNow) return () => cairoWallClockMs();
  const base = parseLocal(simulatedNow);
  if (Number.isNaN(base)) throw new Error(`SIMULATED_NOW is not a valid date-time: ${simulatedNow}`);
  const startedAt = Date.now();
  return () => base + (Date.now() - startedAt);
}
