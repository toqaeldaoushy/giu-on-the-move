# Supabase Setup Guide: GIU on the Move

About 15 minutes. You need the six SQL files in this folder and your Supabase login (toqaeldaoushy@gmail.com).
The button names in Supabase can look slightly different from what is written here; look for the closest match.

## Part 1: Create the project

1. Go to **supabase.com**, open the **Dashboard** and sign in with toqaeldaoushy@gmail.com.
2. Click **New project**. The free plan allows two projects, and this will be your second.
3. Fill in:
   - **Name:** `giu-on-the-move`
   - **Database password:** click **Generate a password** and **save it somewhere safe** (a notes app or a password manager). You will need it later for the backend.
   - **Region:** a European region (Frankfurt is a common choice).
   - **Plan:** Free.
4. Click **Create new project** and wait 1 to 2 minutes until it says the project is ready.

If Supabase refuses to create the project, tell me what the message says.

## Part 2: Run the SQL files, in this order

Open each file in any text editor (Notepad, VS Code), select all, copy.
In Supabase, open **SQL Editor** in the left menu, click **New query**, paste, and click **Run** (or press Ctrl+Enter).
Use a new query tab for each file, and wait for each one to finish before the next.

| Order | File | What you should see after Run |
| --- | --- | --- |
| 1 | `01_schema.sql` | "Success. No rows returned." (creates the 12 tables and turns on security) |
| 2 | `02_seed_data.sql` | "Success. No rows returned." (users, buses, route, stops, timetable, trip runs, reports) |
| 3 | `03_gps_pings_part1.sql` | "Success. No rows returned." |
| 4 | `03_gps_pings_part2.sql` | "Success. No rows returned." |
| 5 | `03_gps_pings_part3.sql` | "Success. No rows returned." |
| 6 | `04_finish_and_verify.sql` | **A table with 16 rows. Every row must show `ok = true`.** |

The pings files are about 58 KB each, so pasting can take a few seconds.
If a confirmation box appears, read it. These files only create tables and add rows; nothing is deleted.

### What the final table must show

| item | expected |
| --- | --- |
| users | 15 |
| buses | 3 |
| routes | 1 |
| route_points | 41 |
| stops | 6 |
| trips | 5 |
| trip_runs | 30 |
| gps_pings | 2150 |
| problem_reports | 3 |
| assignment_changes | 2 |
| alerts | 10 |
| rider_reports | 2 |
| trip_runs: completed | 26 |
| trip_runs: scheduled | 3 |
| trip_runs: cancelled | 1 |
| gps_pings: total of all speeds | 124619.5 |

## Part 3: Look at your data

Open **Table Editor** in the left menu and click a table such as `users` or `trip_runs`.
The tables show a note that security (RLS) is enabled with no policies. That is on purpose: the public API stays closed until we add rules for the rider, driver and admin roles.

## If something goes wrong

| Problem | What to do |
| --- | --- |
| "already exists" or "duplicate key" | You ran a file twice. Run `00_reset_ONLY_IF_NEEDED.sql` (it deletes the 12 tables), then start again from file 1. |
| An error in one file | Do not continue. Send me a screenshot of the error message and the file name. |
| The last table has a row with `ok = false` | Send me a screenshot of the table. |

## What to send me, and what never to send

- **Send:** a screenshot of the final table (file 4), or of any error message.
- **Never send:** the database password, the `service_role` key, the project's API keys, or screenshots of the Settings or API pages. They give full access to your data.

## Free plan reminder

Free projects pause after one week without activity. Open the project the day before a demo or the interim report. If it is paused, restore it from the dashboard.
