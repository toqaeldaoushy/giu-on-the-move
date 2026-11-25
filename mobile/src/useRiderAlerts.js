import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { connectLive } from './api';

// Show alerts as a banner with sound even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
  }),
});

/**
 * Rider alerts (FR4). The server sends "alert:due" once the bus is the chosen number of minutes
 * (2, 5 or 10) from the rider's stop. This hook keeps a live connection for the logged-in rider
 * and shows each alert as a phone notification. Notifications are local, so they work in Expo Go;
 * they arrive while the app is open or still running in the background, not after it was closed.
 */
export function useRiderAlerts(session) {
  const token = session?.user?.role === 'rider' ? session.token : null;

  useEffect(() => {
    if (!token) return undefined;
    let allowed = false;
    (async () => {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('alerts', {
          name: 'Bus alerts', importance: Notifications.AndroidImportance.HIGH,
        });
      }
      const current = await Notifications.getPermissionsAsync();
      allowed = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    })().catch(() => { allowed = false; });

    const socket = connectLive(token);
    socket.on('alert:due', (m) => {
      const title = 'Your bus is coming';
      const body = m.etaMinutes <= 1
        ? `The bus is about to reach ${m.stopName}.`
        : `The bus will reach ${m.stopName} in about ${m.etaMinutes} minutes.`;
      if (allowed) {
        Notifications.scheduleNotificationAsync({
          content: { title, body, data: { runId: m.runId } },
          trigger: Platform.OS === 'android' ? { channelId: 'alerts' } : null,
        }).catch(() => Alert.alert(title, body));
      } else {
        Alert.alert(title, body); // notifications are off for this app: show it inside the app instead
      }
    });
    return () => socket.disconnect();
  }, [token]);
}
