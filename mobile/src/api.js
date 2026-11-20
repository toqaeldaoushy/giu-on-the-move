import { io } from 'socket.io-client';
import { API_URL } from './config';

// One small helper for every call to the backend. It adds the login token and turns errors into
// messages a person can read.
export async function api(path, { token, method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Cannot reach the server at ${API_URL}. Is the backend running, and is the phone on the same Wi-Fi as the computer?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// The live connection: the server pushes bus positions and status changes to it.
export function connectLive(token) {
  return io(API_URL, { auth: { token }, transports: ['websocket'] });
}
