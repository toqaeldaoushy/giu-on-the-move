// Shows what a rider's phone would receive for a trip.
//
//   npm run watch:rider -- --run 28 --stop 9
//
// Options:  --url http://localhost:3000   --user student01   --password demo1234   --run 28   --stop 9 (optional)
import { io } from 'socket.io-client';
import { readArgs, api } from './_args.js';

const args = readArgs({ url: 'http://localhost:3000', user: 'student01', password: 'demo1234', run: '28' });
const runId = Number(args.run);
const stopId = args.stop ? Number(args.stop) : undefined;

const { token, user } = await api(args.url, '/auth/login', { method: 'POST', body: { username: args.user, password: args.password } });
console.log(`Logged in as ${user.name} (${user.role}). Watching trip run ${runId}. Press Ctrl+C to stop.`);

const socket = io(args.url, { auth: { token } });
socket.on('connect_error', (e) => { console.error('Could not connect:', e.message); process.exit(1); });
socket.on('bus:position', (m) =>
  console.log(`[${m.timestamp}] bus at ${m.position.lat}, ${m.position.lon}  ${m.speedKmh} km/h  ETA ${m.etaMinutes} min  ${m.statusLabel}`));
socket.on('trip:status', (m) => console.log(`Trip status: ${m.status} (${m.statusLabel})`));
socket.on('assignment:changed', (m) => console.log('Assignment changed:', JSON.stringify(m)));

socket.on('connect', () =>
  socket.emit('watch', { runId, stopId }, (ack) => {
    if (!ack.ok) { console.error('Cannot watch this trip:', ack.error); process.exit(1); }
    console.log('Current state:', JSON.stringify(ack.live));
  }));
