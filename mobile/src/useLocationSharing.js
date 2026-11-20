import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { api } from './api';

export const SEND_EVERY_MS = 30000; // one position every 30 seconds, as in the simulated data

/** Asks for the phone's location permission. Returns true when the driver allowed it. */
export async function askLocationPermission() {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  return granted;
}

/**
 * While `active` is true, follows the phone's GPS and sends the latest position of the bus to the
 * backend every 30 seconds. The counters are kept so that the driver (and the evaluation) can see
 * how many positions were sent, stored by the server, or failed.
 *
 * Works while the app is open on the screen. The screen is kept awake during the trip, because
 * Expo Go does not send positions in the background.
 */
export function useLocationSharing({ token, runId, active }) {
  const latest = useRef(null);  // the newest GPS fix from the phone
  const sending = useRef(false);
  const [stats, setStats] = useState({ sent: 0, stored: 0, failed: 0, lastSentAt: null, lastError: '' });
  const [gpsError, setGpsError] = useState('');

  useEffect(() => {
    if (!active) return undefined;
    let subscription = null;
    let timer = null;
    let firstSent = false;
    let stopped = false;

    async function send() {
      const fix = latest.current;
      if (!fix || sending.current) return;
      sending.current = true;
      const speed = fix.coords.speed;
      const body = {
        lat: fix.coords.latitude,
        lon: fix.coords.longitude,
        // the phone gives metres per second; the backend wants km/h (a negative or missing speed means unknown)
        speedKmh: speed != null && speed >= 0 ? Math.round(speed * 3.6 * 10) / 10 : 0,
      };
      try {
        const res = await api(`/driver/runs/${runId}/pings`, { token, method: 'POST', body });
        if (!stopped) {
          setStats((s) => ({
            ...s,
            sent: s.sent + 1,
            stored: s.stored + (res.duplicate ? 0 : 1),
            lastSentAt: new Date(),
            lastError: '',
          }));
        }
      } catch (e) {
        if (!stopped) setStats((s) => ({ ...s, sent: s.sent + 1, failed: s.failed + 1, lastError: e.message }));
      } finally {
        sending.current = false;
      }
    }

    (async () => {
      try {
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 0 },
          (fix) => {
            latest.current = fix;
            setGpsError('');
            if (!firstSent) { // send the first position at once, then every 30 seconds
              firstSent = true;
              send();
            }
          },
          (err) => setGpsError(String(err)),
        );
        if (stopped) subscription.remove();
      } catch (e) {
        setGpsError(e.message);
      }
    })();
    timer = setInterval(send, SEND_EVERY_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
      subscription?.remove();
    };
  }, [active, runId, token]);

  return { stats, gpsError };
}
