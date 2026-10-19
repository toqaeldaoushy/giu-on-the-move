-- GIU on the Move: RESET (only if something went wrong and you want to start over)
--
-- WARNING: this deletes the 12 GIU on the Move tables and ALL the data in them.
-- Use it only in the project you made for the thesis, and only if you need to start again.
-- After running it, run 01_schema.sql, 02_seed_data.sql, 03_*.sql and 04_finish_and_verify.sql again, in order.

drop table if exists public.rider_reports      cascade;
drop table if exists public.alerts             cascade;
drop table if exists public.assignment_changes cascade;
drop table if exists public.problem_reports    cascade;
drop table if exists public.gps_pings          cascade;
drop table if exists public.trip_runs          cascade;
drop table if exists public.trips              cascade;
drop table if exists public.stops              cascade;
drop table if exists public.route_points       cascade;
drop table if exists public.routes             cascade;
drop table if exists public.buses              cascade;
drop table if exists public.users              cascade;
