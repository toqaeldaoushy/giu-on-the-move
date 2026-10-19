-- GIU on the Move: database schema (SQLite)
-- One schema for all three roles: rider, driver, admin.
-- Foreign keys must be switched on for every connection:  PRAGMA foreign_keys = ON;

CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    name          TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('rider', 'driver', 'admin')),
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT,                              -- set by the backend at seed time, never in the CSV
    phone         TEXT,                              -- placeholder numbers only
    share_phone   INTEGER NOT NULL DEFAULT 0 CHECK (share_phone IN (0, 1))
);

CREATE TABLE buses (
    id         INTEGER PRIMARY KEY,
    bus_number TEXT    NOT NULL UNIQUE,
    plate      TEXT    NOT NULL UNIQUE,
    capacity   INTEGER NOT NULL CHECK (capacity > 0),
    status     TEXT    NOT NULL CHECK (status IN ('active', 'maintenance')),
    device_id  TEXT    NOT NULL UNIQUE               -- the phone installed on this bus
);

CREATE TABLE routes (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE route_points (                          -- the path, listed in the inbound direction
    route_id INTEGER NOT NULL REFERENCES routes(id),
    seq      INTEGER NOT NULL,
    lat      REAL    NOT NULL,
    lon      REAL    NOT NULL,
    PRIMARY KEY (route_id, seq)
);

CREATE TABLE stops (
    id       INTEGER PRIMARY KEY,
    route_id INTEGER NOT NULL REFERENCES routes(id),
    name     TEXT    NOT NULL,
    lat      REAL    NOT NULL,
    lon      REAL    NOT NULL,
    seq      INTEGER NOT NULL,
    UNIQUE (route_id, seq)
);

CREATE TABLE trips (                                 -- the timetable (the real one)
    id             INTEGER PRIMARY KEY,
    code           TEXT    NOT NULL UNIQUE,
    label          TEXT    NOT NULL,
    route_id       INTEGER NOT NULL REFERENCES routes(id),
    direction      TEXT    NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    scheduled_time TEXT    NOT NULL                  -- HH:MM
);

CREATE TABLE trip_runs (                             -- one trip on one day; the admin assigns bus and driver here
    id           INTEGER PRIMARY KEY,
    trip_id      INTEGER NOT NULL REFERENCES trips(id),
    run_date     TEXT    NOT NULL,                   -- YYYY-MM-DD
    bus_id       INTEGER REFERENCES buses(id),
    driver_id    INTEGER REFERENCES users(id),       -- must be a user with role 'driver'
    status       TEXT    NOT NULL CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    actual_start TEXT,                               -- ISO 8601 local time
    actual_end   TEXT,
    UNIQUE (trip_id, run_date)
);

CREATE TABLE gps_pings (
    id          INTEGER PRIMARY KEY,
    trip_run_id INTEGER NOT NULL REFERENCES trip_runs(id),
    bus_id      INTEGER NOT NULL REFERENCES buses(id),
    device_id   TEXT    NOT NULL,
    timestamp   TEXT    NOT NULL,                    -- ISO 8601 local time
    lat         REAL    NOT NULL,
    lon         REAL    NOT NULL,
    speed_kmh   REAL    NOT NULL CHECK (speed_kmh >= 0),
    UNIQUE (trip_run_id, timestamp)
);
CREATE INDEX idx_pings_run_time ON gps_pings (trip_run_id, timestamp);

CREATE TABLE problem_reports (                       -- reported by the driver
    id          INTEGER PRIMARY KEY,
    trip_run_id INTEGER NOT NULL REFERENCES trip_runs(id),
    driver_id   INTEGER NOT NULL REFERENCES users(id),
    report_type TEXT    NOT NULL CHECK (report_type IN ('traffic_delay', 'breakdown', 'bus_full', 'other')),
    note        TEXT,
    created_at  TEXT    NOT NULL
);

CREATE TABLE assignment_changes (                    -- audit trail of admin re-assignments
    id            INTEGER PRIMARY KEY,
    trip_run_id   INTEGER NOT NULL REFERENCES trip_runs(id),
    old_driver_id INTEGER REFERENCES users(id),
    new_driver_id INTEGER REFERENCES users(id),
    old_bus_id    INTEGER REFERENCES buses(id),
    new_bus_id    INTEGER REFERENCES buses(id),
    changed_by    INTEGER NOT NULL REFERENCES users(id),   -- must be the admin
    reason        TEXT,
    changed_at    TEXT    NOT NULL
);

CREATE TABLE alerts (                                -- a rider asks to be notified before a trip
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    trip_run_id    INTEGER NOT NULL REFERENCES trip_runs(id),
    stop_id        INTEGER NOT NULL REFERENCES stops(id),
    minutes_before INTEGER NOT NULL CHECK (minutes_before IN (2, 5, 10)),
    created_at     TEXT    NOT NULL
);

CREATE TABLE rider_reports (                         -- "the bus was full" reports from riders
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    trip_run_id INTEGER NOT NULL REFERENCES trip_runs(id),
    report_type TEXT    NOT NULL CHECK (report_type IN ('bus_full')),
    created_at  TEXT    NOT NULL
);
