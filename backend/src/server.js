import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { config } from './config.js';
import { createPool } from './db.js';
import { makeClock } from './time.js';
import { verifyToken } from './auth.js';
import { HttpError } from './errors.js';
import { getRunOr404, loadLive, recordPing } from './runs.js';

/**
 * Live connection (Socket.io). Clients send their login token when they connect.
 *   riders/admin/drivers:  "watch" { runId, stopId? }   -> join a trip and get its current state
 *   drivers:               "driver:ping" { runId, lat, lon, speedKmh, timestamp? }
 * The server sends: "bus:position", "trip:status", "assignment:changed", "report:new".
 */
export function createServer({ pool = createPool(), clock = makeClock(config.simulatedNow) } = {}) {
  const ctx = { pool, clock, io: null, routeCache: new Map() };
  const app = createApp(ctx);
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });
  ctx.io = io;

  io.use((socket, next) => {
    try {
      socket.data.user = verifyToken(socket.handshake.auth?.token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    if (user.role === 'admin') socket.join('admin');

    socket.on('watch', async (msg, ack) => {
      try {
        const run = await getRunOr404(pool, Number(msg?.runId));
        socket.join(`run:${run.id}`);
        ack?.({ ok: true, live: await loadLive(ctx, run, { stopId: msg?.stopId }) });
      } catch (e) {
        ack?.({ ok: false, error: e.message });
      }
    });

    socket.on('unwatch', (msg) => socket.leave(`run:${Number(msg?.runId)}`));

    socket.on('driver:ping', async (msg, ack) => {
      try {
        if (user.role !== 'driver') throw new HttpError(403, 'Only drivers can send positions');
        const result = await recordPing(ctx, user, Number(msg?.runId), msg);
        ack?.({ ok: true, duplicate: Boolean(result.duplicate) });
      } catch (e) {
        ack?.({ ok: false, error: e.message, status: e.status ?? 500 });
      }
    });
  });

  return {
    ctx, httpServer, io,
    listen: (port = config.port) => new Promise((resolve) => httpServer.listen(port, () => resolve(httpServer.address().port))),
    close: async () => {
      await io.close();
      if (httpServer.listening) await new Promise((resolve) => httpServer.close(resolve));
      await pool.end();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer();
  const port = await server.listen();
  console.log(`GIU on the Move backend listening on http://localhost:${port}`);
  console.log(config.simulatedNow ? `Clock: simulated, starting at ${config.simulatedNow}` : 'Clock: real time (Cairo)');
}
