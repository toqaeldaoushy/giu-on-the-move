import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { HttpError } from './errors.js';

let secret = config.jwtSecret;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('JWT_SECRET is not set: using a temporary secret. Logins will stop working when the server restarts.');
}

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role, name: user.name }, secret, { expiresIn: config.jwtExpires });

export function verifyToken(token) {
  const p = jwt.verify(token, secret);
  return { id: Number(p.sub), role: p.role, name: p.name };
}

export async function login(ctx, username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') throw new HttpError(400, 'username and password are required');
  const { rows } = await ctx.pool.query(
    `select u.id, u.name, u.role, u.username, c.password_hash
       from users u join credentials c on c.user_id = u.id where u.username = $1`, [username]);
  const u = rows[0];
  const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, 'Wrong username or password');
  const user = { id: u.id, name: u.name, role: u.role, username: u.username };
  return { token: signToken(user), user };
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Please log in'));
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    next(new HttpError(401, 'Your session has expired. Please log in again'));
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'This is not allowed for your role'));
