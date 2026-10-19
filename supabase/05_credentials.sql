-- GIU on the Move: logins (OPTIONAL file, for reference)
-- You do NOT need to paste this: "npm run seed:credentials" in the backend folder creates this table
-- and gives every demo user a login. It is here so the design is documented.
--
-- Logins live in their own table with row level security ON and no policies, so a future rule on the
-- users table can never expose a password hash.

create table if not exists public.credentials (
    user_id       integer primary key references public.users (id) on delete cascade,
    password_hash text    not null
);

alter table public.credentials enable row level security;
