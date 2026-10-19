import pg from 'pg';
import { config } from './config.js';

const { Pool, types } = pg;

// Return times as plain text ('2026-10-08 13:45:00') instead of JavaScript dates, to avoid time zone shifts.
types.setTypeParser(1114, (v) => v);              // timestamp
types.setTypeParser(1082, (v) => v);              // date
types.setTypeParser(1083, (v) => v);              // time
types.setTypeParser(20, (v) => parseInt(v, 10));  // bigint (gps ping ids)
types.setTypeParser(1700, (v) => parseFloat(v));  // numeric

export function createPool(url = config.databaseUrl) {
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  const isLocal = /@(localhost|127\.0\.0\.1)|host=\//.test(url);
  const wantSsl = config.databaseSsl !== undefined ? config.databaseSsl : !isLocal;
  return new Pool({ connectionString: url, ssl: wantSsl ? { rejectUnauthorized: false } : false, max: 10 });
}
