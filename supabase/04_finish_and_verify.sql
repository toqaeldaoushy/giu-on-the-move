-- GIU on the Move: finish and verify
-- STEP 4 of 4. Paste this whole file into the Supabase SQL Editor and click Run.
-- This fixes the id counters (so new rows get fresh ids) and then shows a check table.
-- Every row of the result must show ok = true.

select setval(pg_get_serial_sequence('public.users', 'id'), max(id)) from public.users;
select setval(pg_get_serial_sequence('public.buses', 'id'), max(id)) from public.buses;
select setval(pg_get_serial_sequence('public.routes', 'id'), max(id)) from public.routes;
select setval(pg_get_serial_sequence('public.stops', 'id'), max(id)) from public.stops;
select setval(pg_get_serial_sequence('public.trips', 'id'), max(id)) from public.trips;
select setval(pg_get_serial_sequence('public.trip_runs', 'id'), max(id)) from public.trip_runs;
select setval(pg_get_serial_sequence('public.gps_pings', 'id'), max(id)) from public.gps_pings;
select setval(pg_get_serial_sequence('public.problem_reports', 'id'), max(id)) from public.problem_reports;
select setval(pg_get_serial_sequence('public.assignment_changes', 'id'), max(id)) from public.assignment_changes;
select setval(pg_get_serial_sequence('public.alerts', 'id'), max(id)) from public.alerts;
select setval(pg_get_serial_sequence('public.rider_reports', 'id'), max(id)) from public.rider_reports;

select v.item, v.expected, a.actual, (v.expected = a.actual) as ok
from (values
  (1, 'users', 15::numeric),
  (2, 'buses', 3::numeric),
  (3, 'routes', 1::numeric),
  (4, 'route_points', 41::numeric),
  (5, 'stops', 6::numeric),
  (6, 'trips', 5::numeric),
  (7, 'trip_runs', 30::numeric),
  (8, 'gps_pings', 2150::numeric),
  (9, 'problem_reports', 3::numeric),
  (10, 'assignment_changes', 2::numeric),
  (11, 'alerts', 10::numeric),
  (12, 'rider_reports', 2::numeric),
  (13, 'trip_runs: completed', 26::numeric),
  (14, 'trip_runs: scheduled', 3::numeric),
  (15, 'trip_runs: cancelled', 1::numeric),
  (16, 'gps_pings: total of all speeds', 124619.5::numeric)
) as v(n, item, expected)
join (
  select 'users' as item, (select count(*) from public.users)::numeric as actual
  union all
  select 'buses' as item, (select count(*) from public.buses)::numeric as actual
  union all
  select 'routes' as item, (select count(*) from public.routes)::numeric as actual
  union all
  select 'route_points' as item, (select count(*) from public.route_points)::numeric as actual
  union all
  select 'stops' as item, (select count(*) from public.stops)::numeric as actual
  union all
  select 'trips' as item, (select count(*) from public.trips)::numeric as actual
  union all
  select 'trip_runs' as item, (select count(*) from public.trip_runs)::numeric as actual
  union all
  select 'gps_pings' as item, (select count(*) from public.gps_pings)::numeric as actual
  union all
  select 'problem_reports' as item, (select count(*) from public.problem_reports)::numeric as actual
  union all
  select 'assignment_changes' as item, (select count(*) from public.assignment_changes)::numeric as actual
  union all
  select 'alerts' as item, (select count(*) from public.alerts)::numeric as actual
  union all
  select 'rider_reports' as item, (select count(*) from public.rider_reports)::numeric as actual
  union all
  select 'trip_runs: completed' as item, (select count(*) from public.trip_runs where status = 'completed')::numeric as actual
  union all
  select 'trip_runs: scheduled' as item, (select count(*) from public.trip_runs where status = 'scheduled')::numeric as actual
  union all
  select 'trip_runs: cancelled' as item, (select count(*) from public.trip_runs where status = 'cancelled')::numeric as actual
  union all
  select 'gps_pings: total of all speeds' as item, (select coalesce(sum(speed_kmh::numeric), 0) from public.gps_pings)::numeric as actual
) a on a.item = v.item
order by v.n;
