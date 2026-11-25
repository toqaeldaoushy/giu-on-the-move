# GIU on the Move: Backend

The server between the apps and the database: apps → **this server** → Supabase. The apps never talk to the database directly, so the database's public API stays closed.

- **REST API** for login, the timetable, trips, reports and alerts, with different rights for the rider, the driver and the admin.
- **Live connection (Socket.io)**: the driver's phone sends its position, and every rider watching that trip receives it with an ETA and a status label.
- Node.js 20 or newer (you have v22), Express, Socket.io, `pg`.

## Set it up (about 10 minutes)

1. Open a terminal in this `backend` folder and install the packages:
   ```
   npm install
   ```
2. Copy `.env.example` to a new file called `.env` and fill it in:
   - **DATABASE_URL:** in the Supabase dashboard click **Connect** (top bar), choose **Session pooler**, copy the URI, and replace `[YOUR-PASSWORD]` with your database password. If the password contains characters like `@`, `#` or `/`, reset it to a simple one (letters and numbers) in Supabase first.
   - **JWT_SECRET:** any long random text.
   - Keep `SIMULATED_NOW=2026-10-08T13:40:00` for now. It sets the server's clock to the moment the simulated data describes (Thursday 13:40, the 13:45 trip has not left yet).
   - **Never share the `.env` file, and never put it on Git.** It is already in `.gitignore`.
3. Create the logins (once):
   ```
   npm run seed:credentials
   ```
   Every demo user gets the password `demo1234` (development only). Usernames: `admin`, `driver1` to `driver4`, `student01` to `student10`.
4. Start the server:
   ```
   npm start
   ```
   You should see `GIU on the Move backend listening on http://localhost:3000`.

## See it work (two more terminals, both in the `backend` folder)

**Terminal 2: a rider's phone.** It prints everything a rider's app would receive for trip 28 (Thursday 13:45):
```
npm run watch:rider -- --run 28 --stop 9
```
**Terminal 3: the driver's phone.** It logs in as Ahmed Hassan, starts the trip and plays a whole trip of positions (30 times faster than real time, so it takes about 2.5 minutes):
```
npm run simulate:driver -- --run 28
```
Terminal 2 then shows the bus moving, the ETA falling and the status label. Add `--speed 300` to the simulator to run it faster.

## The API

All calls except `health`, `time` and `auth/login` need the header `Authorization: Bearer <token>` from the login.

| Who | Call | What it does |
| --- | --- | --- |
| everyone | `POST /api/auth/login` | Log in with `{username, password}`, get a token |
| everyone | `GET /api/timetable?date=` | The day's trips with driver, bus, status and live ETA |
| everyone | `GET /api/runs/:id/live?stopId=` | One trip's live state, with the ETA to a stop if asked |
| everyone | `GET /api/runs/:id/pings` | The positions of a trip so far |
| everyone | `GET /api/route` | The route path and the stops, to draw the map |
| rider | `POST /api/alerts`, `GET /api/alerts`, `DELETE /api/alerts/:id` | "Tell me 2, 5 or 10 minutes before" |
| rider | `POST /api/runs/:id/full-report` | "The bus was full" |
| driver | `GET /api/driver/runs` | My trips today |
| driver | `POST /api/driver/runs/:id/start`, `/end` | Start and end a trip |
| driver | `POST /api/driver/runs/:id/pings`, `/problems` | Send a position (HTTP version), report a problem |
| admin | `GET /api/admin/overview?date=` | All trips of the day with their live state |
| admin | `PATCH /api/admin/runs/:id/assignment` | Change the driver and/or bus of a trip that has not started |
| admin | `POST /api/admin/runs/:id/cancel`, `/runs/generate` | Cancel a trip, create a new day's trips (not on Friday) |
| admin | `GET/POST/PATCH /api/admin/buses`, `/drivers` | Manage buses and drivers, and whether a driver's phone number is shown to riders |
| admin | `GET /api/admin/reports?date=`, `/assignment-changes` | Problem reports, rider reports and the history of changes |

**Live events (Socket.io).** Connect with `{ auth: { token } }`. Send `watch {runId, stopId?}` to follow a trip. Drivers send `driver:ping {runId, lat, lon, speedKmh, timestamp?}`. The server sends `bus:position`, `trip:status`, `assignment:changed` and `report:new`.

## How the ETA works, and how good it is

The ETA is the distance still to travel along the route divided by an expected speed. The expected speed mixes the planned speed (route length divided by the planned trip time, 71 minutes, the duration of the recorded real trip) with the bus's measured speed, which is the average speed of all positions since the trip started. The measured speed takes over gradually: after 10% of the route it counts for 75%, and the plan keeps 25%. The status label says **Delayed** when the expected arrival is more than 5 minutes later than the scheduled arrival.

These settings were chosen on simulated trips only (`node scripts/eta-scenarios.js`). The script generates 150 trips on the real route in five traffic scenarios (light, normal, rush hour, incident, mixed), tunes the method on 50 of them and evaluates it on the other 100. Mean absolute error on the 100 held-out trips (simulated data only):

| Scenario | Light | Normal | Rush hour | Incident | Mixed | Overall |
| --- | --- | --- | --- | --- | --- | --- |
| ETA in the app | 6.4 min | 6.0 min | 8.8 min | 9.1 min | 9.9 min | 8.4 min |
| First version | 8.7 min | 11.1 min | 22.5 min | 56.5 min | 34.9 min | 28.1 min |

The full results, including the timetable and schedule baselines, are in `data/scenarios/scenario_summary.txt`.

On the one real recorded trip (`node scripts/eta-real-trip.js`, results in `data/real/real_trip_eta.txt`) the ETA in the app was off by 10.3 min on average: about 24 min too late in the first quarter of the route, where the few slow positions recorded so far pull the average speed down, and 1.8 min in the last part. One trip is a check on real roads, not a measure of accuracy.

## Tests

`tests/api.test.js` has 25 end-to-end tests: logins and role rules, the timetable and phone-number privacy, the driver's own trip list, a whole live trip from the driver's phone to the rider's screen (with a falling ETA and a "Delayed" label), reports, assignments and their rules, buses, drivers, days and alerts. They need a database loaded with the project data, so `tests/run_with_local_postgres.py` sets up a throw-away local Postgres (`pip install pgserver psycopg2-binary`, then `python3 tests/run_with_local_postgres.py`). Do not point the tests at your Supabase project: they change data.

## Not built yet

Push notifications (alerts are saved but nothing sends them yet), editing the timetable itself and the route, and Supabase Auth (logins are handled by this server for now, kept in their own `credentials` table).
