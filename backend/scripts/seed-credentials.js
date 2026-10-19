// Creates the "credentials" table (logins are kept apart from the users table on purpose) and gives every
// user without a login the development password (DEV_PASSWORD in .env, default demo1234).
// Run once after loading the data:   npm run seed:credentials
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { createPool } from '../src/db.js';
import { config } from '../src/config.js';

export async function seedCredentials(pool, password = config.devPassword) {
  await pool.query(`
    create table if not exists public.credentials (
      user_id       integer primary key references public.users (id) on delete cascade,
      password_hash text not null
    )`);
  await pool.query('alter table public.credentials enable row level security');
  const { rows } = await pool.query(
    'select id from public.users where id not in (select user_id from public.credentials) order by id');
  for (const u of rows) {
    const hash = await bcrypt.hash(password, 10);
    await pool.query('insert into public.credentials (user_id, password_hash) values ($1, $2)', [u.id, hash]);
  }
  return rows.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool();
  try {
    const n = await seedCredentials(pool);
    console.log(`Done: ${n} users got a login. Development password: ${config.devPassword}`);
    console.log('Usernames: admin, driver1 to driver4, student01 to student10');
  } finally {
    await pool.end();
  }
}
