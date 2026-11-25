import 'dotenv/config';

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  databaseUrl: env.DATABASE_URL || null,
  // true / false forces SSL on or off; undefined = automatic (on, except for a local database)
  databaseSsl: env.DATABASE_SSL === undefined ? undefined : env.DATABASE_SSL === 'true',
  jwtSecret: env.JWT_SECRET || null,
  jwtExpires: env.JWT_EXPIRES || '12h',
  simulatedNow: env.SIMULATED_NOW || null,   // e.g. 2026-10-08T13:40:00 (local Cairo time)
  plannedTripMin: Number(env.PLANNED_TRIP_MIN || 71),      // planned travel time of one trip: the recorded real trip (06:33 to 07:45)
  lateThresholdMin: Number(env.LATE_THRESHOLD_MIN || 5),   // more than this late = "Delayed"
  devPassword: env.DEV_PASSWORD || 'demo1234',
};
