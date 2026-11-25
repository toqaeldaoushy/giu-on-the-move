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
 * (2, 5 or 10) from the rider's stop, and "trip:delayed" once if that trip becomes delayed. This hook keeps a live connection for the logged-in rider
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

    const notify = (title, body, runId) => {
      if (allowed) {
        Notifications.scheduleNotificationAsync({
          content: { title, body, data: { runId } },
          trigger: Platform.OS === 'android' ? { channelId: 'alerts' } : null,
        }).catch(() => Alert.alert(title, body));
      } else {
        Alert.alert(title, body); // notifications are off for this app: show it inside the app instead
      }
    };

    const socket = connectLive(token);
    socket.on('alert:due', (m) => {
      const body = m.etaMinutes <= 1
        ? `The bus is about to reach ${m.stopName}.`
        : `The bus will reach ${m.stopName} in about ${m.etaMinutes} minutes.`;
      notify('Your bus is coming', body, m.runId);
    });
    // Delay alert: sent once when a trip the rider set a reminder for becomes "Delayed"
    socket.on('trip:delayed', (m) => {
      notify('Your bus is delayed', `The ${m.scheduledTime} ${m.label} is running about ${m.delayMinutes} minutes late.`, m.runId);
    });
    // Announcement from the transportation office (e.g. a road closure): every rider is told
    socket.on('announcement:new', (m) => notify('Transportation office', m.message));
    return () => socket.disconnect();
  }, [token]);
}
