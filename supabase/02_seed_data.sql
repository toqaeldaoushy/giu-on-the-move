-- GIU on the Move: seed data
-- STEP 2 of 4. Paste this whole file into the Supabase SQL Editor and click Run.
-- Run 01_schema.sql first. This loads the users, buses, route, stops, timetable, trip runs and reports.


-- users (15 rows)
insert into public.users (id, name, role, username, phone, share_phone) values
  (1, 'Admin (placeholder)', 'admin', 'admin', NULL, false),
  (2, 'Ahmed Hassan', 'driver', 'driver1', '+20-000-000-0002', true),
  (3, 'Mahmoud Samir', 'driver', 'driver2', '+20-000-000-0003', true),
  (4, 'Youssef Adel', 'driver', 'driver3', '+20-000-000-0004', false),
  (5, 'Karim Nabil', 'driver', 'driver4', '+20-000-000-0005', true),
  (6, 'Student 01', 'rider', 'student01', NULL, false),
  (7, 'Student 02', 'rider', 'student02', NULL, false),
  (8, 'Student 03', 'rider', 'student03', NULL, false),
  (9, 'Student 04', 'rider', 'student04', NULL, false),
  (10, 'Student 05', 'rider', 'student05', NULL, false),
  (11, 'Student 06', 'rider', 'student06', NULL, false),
  (12, 'Student 07', 'rider', 'student07', NULL, false),
  (13, 'Student 08', 'rider', 'student08', NULL, false),
  (14, 'Student 09', 'rider', 'student09', NULL, false),
  (15, 'Student 10', 'rider', 'student10', NULL, false);

-- buses (3 rows)
insert into public.buses (id, bus_number, plate, capacity, status, device_id) values
  (1, '04', 'TEST-004', 48, 'active', 'phone_bus_04'),
  (2, '07', 'TEST-007', 48, 'active', 'phone_bus_07'),
  (3, '11', 'TEST-011', 48, 'active', 'phone_bus_11');

-- routes (1 rows)
insert into public.routes (id, name) values
  (1, 'Pilot route (placeholder)');

-- route_points (41 rows)
insert into public.route_points (route_id, seq, lat, lon) values
  (1, 1, 30.05, 31.331),
  (1, 2, 30.049375, 31.34135),
  (1, 3, 30.04875, 31.3517),
  (1, 4, 30.048125, 31.36205),
  (1, 5, 30.0475, 31.3724),
  (1, 6, 30.046875, 31.38275),
  (1, 7, 30.04625, 31.3931),
  (1, 8, 30.045625, 31.40345),
  (1, 9, 30.045, 31.4138),
  (1, 10, 30.044375, 31.42415),
  (1, 11, 30.04375, 31.4345),
  (1, 12, 30.043125, 31.44485),
  (1, 13, 30.0425, 31.4552),
  (1, 14, 30.041875, 31.46555),
  (1, 15, 30.04125, 31.4759),
  (1, 16, 30.040625, 31.48625),
  (1, 17, 30.04, 31.4966),
  (1, 18, 30.039375, 31.50695),
  (1, 19, 30.03875, 31.5173),
  (1, 20, 30.038125, 31.52765),
  (1, 21, 30.0375, 31.538),
  (1, 22, 30.036875, 31.54835),
  (1, 23, 30.03625, 31.5587),
  (1, 24, 30.035625, 31.56905),
  (1, 25, 30.035, 31.5794),
  (1, 26, 30.034375, 31.58975),
  (1, 27, 30.03375, 31.6001),
  (1, 28, 30.033125, 31.61045),
  (1, 29, 30.0325, 31.6208),
  (1, 30, 30.031875, 31.63115),
  (1, 31, 30.03125, 31.6415),
  (1, 32, 30.030625, 31.65185),
  (1, 33, 30.03, 31.6622),
  (1, 34, 30.029375, 31.67255),
  (1, 35, 30.02875, 31.6829),
  (1, 36, 30.028125, 31.69325),
  (1, 37, 30.0275, 31.7036),
  (1, 38, 30.026875, 31.71395),
  (1, 39, 30.02625, 31.7243),
  (1, 40, 30.025625, 31.73465),
  (1, 41, 30.025, 31.745);

-- stops (6 rows)
insert into public.stops (id, route_id, name, lat, lon, seq) values
  (1, 1, 'Stop 1 (pickup point)', 30.05, 31.331, 1),
  (2, 1, 'Stop 2', 30.045, 31.4138, 2),
  (3, 1, 'Stop 3', 30.04, 31.4966, 3),
  (4, 1, 'Stop 4', 30.035, 31.5794, 4),
  (5, 1, 'Stop 5', 30.03, 31.6622, 5),
  (6, 1, 'Campus gate', 30.025, 31.745, 6);

-- trips (5 rows)
insert into public.trips (id, code, label, route_id, direction, scheduled_time) values
  (1, 'arrival_first', 'Morning inbound', 1, 'inbound', '08:00'),
  (2, 'arrival_second', 'Mid-morning inbound', 1, 'inbound', '10:00'),
  (3, 'departure_first', 'Afternoon express (short round)', 1, 'outbound', '13:45'),
  (4, 'departure_second', 'Evening departure', 1, 'outbound', '15:30'),
  (5, 'departure_third', 'Late evening departure', 1, 'outbound', '17:30');

-- trip_runs (30 rows)
insert into public.trip_runs (id, trip_id, run_date, bus_id, driver_id, status, actual_start, actual_end) values
  (1, 1, '2026-10-03', 1, 2, 'completed', '2026-10-03T08:01:43', '2026-10-03T08:40:13'),
  (2, 2, '2026-10-03', 2, 3, 'completed', '2026-10-03T09:59:13', '2026-10-03T10:37:43'),
  (3, 3, '2026-10-03', 3, 4, 'completed', '2026-10-03T13:47:01', '2026-10-03T14:25:31'),
  (4, 4, '2026-10-03', 1, 5, 'completed', '2026-10-03T15:31:55', '2026-10-03T16:15:25'),
  (5, 5, '2026-10-03', 2, 2, 'completed', '2026-10-03T17:29:44', '2026-10-03T18:08:14'),
  (6, 1, '2026-10-04', 2, 4, 'completed', '2026-10-04T08:01:47', '2026-10-04T08:41:17'),
  (7, 2, '2026-10-04', 3, 5, 'completed', '2026-10-04T10:00:20', '2026-10-04T10:43:50'),
  (8, 3, '2026-10-04', 1, 2, 'completed', '2026-10-04T13:45:21', '2026-10-04T14:28:21'),
  (9, 4, '2026-10-04', 2, 3, 'completed', '2026-10-04T15:42:11', '2026-10-04T16:30:11'),
  (10, 5, '2026-10-04', 3, 4, 'completed', '2026-10-04T17:29:13', '2026-10-04T18:08:13'),
  (11, 1, '2026-10-05', 3, 2, 'completed', '2026-10-05T07:59:23', '2026-10-05T08:39:23'),
  (12, 2, '2026-10-05', 1, 4, 'completed', '2026-10-05T09:59:14', '2026-10-05T10:37:14'),
  (13, 3, '2026-10-05', 2, 4, 'completed', '2026-10-05T13:44:34', '2026-10-05T14:23:04'),
  (14, 4, '2026-10-05', 3, 5, 'completed', '2026-10-05T15:31:47', '2026-10-05T16:14:17'),
  (15, 5, '2026-10-05', 1, 2, 'completed', '2026-10-05T17:32:42', '2026-10-05T18:12:12'),
  (16, 1, '2026-10-06', 1, 4, 'completed', '2026-10-06T08:00:04', '2026-10-06T08:43:04'),
  (17, 2, '2026-10-06', 2, 5, 'completed', '2026-10-06T10:02:52', '2026-10-06T10:46:22'),
  (18, 3, '2026-10-06', 3, 2, 'completed', '2026-10-06T13:45:19', '2026-10-06T14:26:49'),
  (19, 4, '2026-10-06', 1, 3, 'completed', '2026-10-06T15:31:13', '2026-10-06T16:11:13'),
  (20, 5, '2026-10-06', 2, 4, 'completed', '2026-10-06T17:29:01', '2026-10-06T18:09:31'),
  (21, 1, '2026-10-07', 2, 2, 'completed', '2026-10-07T08:00:20', '2026-10-07T08:42:50'),
  (22, 2, '2026-10-07', 3, 3, 'completed', '2026-10-07T09:59:16', '2026-10-07T10:40:46'),
  (23, 3, '2026-10-07', 1, 4, 'completed', '2026-10-07T13:46:39', '2026-10-07T14:30:09'),
  (24, 4, '2026-10-07', 2, 5, 'completed', '2026-10-07T15:30:25', '2026-10-07T16:10:25'),
  (25, 5, '2026-10-07', 3, 2, 'cancelled', NULL, NULL),
  (26, 1, '2026-10-08', 3, 4, 'completed', '2026-10-08T08:00:32', '2026-10-08T08:38:32'),
  (27, 2, '2026-10-08', 1, 5, 'completed', '2026-10-08T10:00:53', '2026-10-08T10:39:53'),
  (28, 3, '2026-10-08', 1, 2, 'scheduled', NULL, NULL),
  (29, 4, '2026-10-08', 2, 3, 'scheduled', NULL, NULL),
  (30, 5, '2026-10-08', 1, 4, 'scheduled', NULL, NULL);

-- problem_reports (3 rows)
insert into public.problem_reports (id, trip_run_id, driver_id, report_type, note, created_at) values
  (1, 1, 2, 'bus_full', 'Bus full after the second stop (placeholder note)', '2026-10-03T08:16:43'),
  (2, 9, 3, 'traffic_delay', 'Heavy traffic on the highway (placeholder note)', '2026-10-04T15:50:11'),
  (3, 25, 2, 'breakdown', 'Bus will not start (placeholder note)', '2026-10-07T17:05:00');

-- assignment_changes (2 rows)
insert into public.assignment_changes (id, trip_run_id, old_driver_id, new_driver_id, old_bus_id, new_bus_id, changed_by, reason, changed_at) values
  (1, 12, 3, 4, 1, 1, 1, 'Original driver unavailable (placeholder)', '2026-10-04T16:00:00'),
  (2, 29, 3, 3, 3, 2, 1, 'Original bus needed for service (placeholder)', '2026-10-07T17:40:00');

-- alerts (10 rows)
insert into public.alerts (id, user_id, trip_run_id, stop_id, minutes_before, created_at) values
  (1, 6, 28, 6, 5, '2026-10-08T11:36:00'),
  (2, 7, 29, 6, 5, '2026-10-08T12:23:00'),
  (3, 8, 30, 6, 5, '2026-10-08T10:47:00'),
  (4, 9, 28, 6, 5, '2026-10-08T13:05:00'),
  (5, 10, 29, 6, 5, '2026-10-08T13:10:00'),
  (6, 11, 30, 6, 10, '2026-10-08T12:50:00'),
  (7, 12, 28, 5, 10, '2026-10-08T11:50:00'),
  (8, 13, 29, 4, 10, '2026-10-08T11:18:00'),
  (9, 14, 30, 3, 10, '2026-10-08T12:10:00'),
  (10, 15, 28, 2, 2, '2026-10-08T12:34:00');

-- rider_reports (2 rows)
insert into public.rider_reports (id, user_id, trip_run_id, report_type, created_at) values
  (1, 7, 1, 'bus_full', '2026-10-03T08:05:43'),
  (2, 9, 13, 'bus_full', '2026-10-05T13:48:34');
