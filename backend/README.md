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
npm run watch:rider -- --run 28 --stop 6
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

The ETA is the distance still to travel along the route divided by an expected speed. Early in the trip the expected speed is mostly the planned speed (route length divided by the planned trip time, 40 minutes); as the trip progresses the bus's own recent speed takes over (fully after 25% of the route). The status label says **Delayed** when the expected arrival is more than 5 minutes later than the scheduled arrival.

Measured on the 26 finished simulated trips (`npm run eval:eta`):

| Progress of the trip | Mean absolute error |
| --- | --- |
| 0 to 25% | 3.8 min |
| 25 to 50% | 11.9 min |
| 50 to 75% | 5.2 min |
| 75 to 95% | 4.7 min |
| **Whole trip** | **6.5 min** (the first version, which used only the recent speed, had 20.4 min) |

Known limits: the ETA is a bit too early near the end because buses slow down when they approach the campus; mid-trip traffic jams in the simulated data are not predictable; and this is simulated data, not real buses.

## Tests

`tests/api.test.js` has 24 end-to-end tests: logins and role rules, the timetable and phone-number privacy, a whole live trip from the driver's phone to the rider's screen (with a falling ETA and a "Delayed" label), reports, assignments and their rules, buses, drivers, days and alerts. They need a database loaded with the project data, so `tests/run_with_local_postgres.py` sets up a throw-away local Postgres (`pip install pgserver psycopg2-binary`, then `python3 tests/run_with_local_postgres.py`). Do not point the tests at your Supabase project: they change data.

## Not built yet

The apps themselves (rider, driver, admin), push notifications (alerts are saved but nothing sends them yet), editing the timetable itself and the route, and Supabase Auth (logins are handled by this server for now, kept in their own `credentials` table).
