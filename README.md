# GIU on the Move: Project Folder

Step 1: the database design and the simulated data for all three roles (rider, driver, admin).
Step 2: the backend (server) that sits between the apps and the database.

## What is here

| Path | Content |
| --- | --- |
| `database/schema.sql` | The database design: 12 tables (SQLite) |
| `scripts/generate_system_data.py` | Generates all the simulated data and builds the database |
| `scripts/check_system_data.py` | 24 data quality checks |
| `scripts/export_supabase_sql.py` | Exports the data as SQL files for Supabase |
| `supabase/` | The SQL files and the step-by-step guide (`SETUP_GUIDE.md`) for the Supabase database |
| `backend/` | The server: REST API and live positions (see `backend/README.md`) |
| `data/*.csv` | One CSV file per table |
| `data/giu_on_the_move.db` | The same data, loaded into SQLite with foreign keys enforced |
| `docs/data_quality_output.txt` | Output of the last check run |

## How to run

Only Python 3 is needed (no installs).

```
python3 scripts/generate_system_data.py     # regenerates data/ and the database
python3 scripts/check_system_data.py        # runs the checks, exit code 0 = all passed
```

On Windows (Git Bash) use `python` instead of `python3` if `python3` is not found.
Option: `--start 2026-10-03` sets the first operating day (it must be a Saturday; the buses run Saturday to Thursday, Friday is the day off). The data is reproducible: the same start date gives the same data.

To look inside the database, open `data/giu_on_the_move.db` with DB Browser for SQLite, or read the CSV files in Excel.

## What the data contains

| Data | Amount |
| --- | --- |
| Users | 1 admin, 4 drivers, 10 riders |
| Buses | 3 (Bus #04, #07, #11), each with its own phone ID |
| Route and stops | 1 route, 41 path points, 6 stops |
| Timetable | 5 trips |
| Trip runs | 30 (5 trips on each of 6 days, Saturday 3 Oct to Thursday 8 Oct 2026) |
| GPS pings | 2,150 (one every 30 seconds) |
| Problem reports | 3 |
| Assignment changes | 2 |
| Alerts | 10 |
| Rider reports | 2 |

"Now" in the data is **Thursday 8 Oct 2026, 13:40**: the morning trips are completed and the 13:45, 15:30 and 17:30 trips are still scheduled, so the admin has upcoming assignments to manage. The 13:45 trip is Bus #04 with Ahmed Hassan, matching the Stitch screens.

Situations built in: one delayed trip (left 12 minutes late in heavy traffic), one cancelled trip (breakdown), one driver swap, one bus swap, a "bus full" driver report and two "bus full" rider reports.

## Real and placeholder

| Real | Placeholder or simulated |
| --- | --- |
| The timetable (08:00, 10:00, 13:45, 15:30, 17:30) | Names, bus numbers, plates, phone numbers |
| | The route and the stops (two approximate points, straight line) |
| | Assignments, delays, GPS pings, reports and alerts |

The phone numbers use the format `+20-000-000-xxxx` so no real number is ever stored. Passwords are not in the data: the backend sets them when it loads the data.

## Limits

Passing the checks shows the data is consistent and follows the rules of the system. It does not show how real buses behave. ETA accuracy measured on this data shows the system works, not how accurate it is in reality.

## Next step

The backend (Node.js, Express, Socket.io) that reads this database, receives live pings from a driver simulator and sends them to the rider's map.
