import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { colors, directionText } from '../theme';
import { Card, ErrorText, StatusBadge } from '../components/ui';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function niceDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[day]} ${d} ${MONTHS[m - 1]}`;
}

const timeOf = (stamp) => (stamp ? String(stamp).slice(11, 16) : '');

// Server times are Cairo wall-clock times without a zone; reading both sides the same way keeps the difference right.
const wallMs = (stamp) => Date.parse(`${stamp}Z`);

/** "Leaves in 12 min" for a trip that has not started, counted from the server's clock. */
function countdownText(run, data, fetchedAt) {
  if (run.status !== 'scheduled' || !data?.now) return null;
  const now = wallMs(data.now) + (Date.now() - fetchedAt);
  const minutes = Math.ceil((wallMs(`${data.date}T${run.scheduledTime}:00`) - now) / 60000);
  if (minutes <= 0) return 'Due to leave now';
  if (minutes < 60) return `Leaves in ${minutes} min`;
  return `Leaves in ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

function tripLine(run) {
  const live = run.live ?? {};
  if (run.status === 'in_progress') return live.etaMinutes != null ? `On the road · arrives in ${live.etaMinutes} min` : 'On the road';
  if (run.status === 'completed') return `Arrived at ${timeOf(run.actualEnd)}`;
  if (run.status === 'cancelled') return 'This trip will not run';
  return `Departs at ${run.scheduledTime}`;
}

export default function TimetableScreen({ session, stops, onOpenTrip, onLogout }) {
  const { token, user } = session;
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(0);   // when the server's time was read
  const [, setTick] = useState(0);                 // re-draws the countdown every 15 seconds

  const load = useCallback(async () => {
    try {
      const [tt, al] = await Promise.all([api('/timetable', { token }), api('/alerts', { token })]);
      setData(tt);
      setFetchedAt(Date.now());
      setAlerts(al.alerts.filter((a) => a.date === tt.date));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [token]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000); // keep the list fresh while the screen is open
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(timer);
  }, []);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function removeAlert(alert) {
    Alert.alert('Remove reminder?', `${alert.scheduledTime} trip, ${stopName(alert.stopId)}`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/alerts/${alert.id}`, { token, method: 'DELETE' });
            load();
          } catch (e) {
            setError(e.message);
          }
        },
      },
    ]);
  }

  const stopName = (id) => stops.find((s) => s.id === id)?.name ?? `Stop ${id}`;
  const runs = data?.runs ?? [];
  const next = runs.find((r) => r.status === 'scheduled' || r.status === 'in_progress');

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hello}>Hi, {user.name}</Text>
          <Text style={styles.date}>{data ? `${niceDate(data.date)} · ${timeOf(data.now)}` : 'Loading…'}</Text>
        </View>
        <Pressable onPress={onLogout} hitSlop={10}>
          <Text style={styles.logout}>Log out</Text>
        </Pressable>
      </View>

      <ErrorText message={error} />

      {next && (
        <Pressable onPress={() => onOpenTrip(next)}>
          <Card style={styles.nextCard}>
            <Text style={styles.nextLabel}>NEXT SHUTTLE</Text>
            <View style={styles.row}>
              <Text style={styles.nextTime}>{next.scheduledTime}</Text>
              <StatusBadge label={next.live?.statusLabel ?? 'Not started'} />
            </View>
            {countdownText(next, data, fetchedAt) && <Text style={styles.countdown}>{countdownText(next, data, fetchedAt)}</Text>}
            <Text style={styles.nextTitle}>{next.label}</Text>
            <Text style={styles.muted}>{tripLine(next)}</Text>
            <Text style={styles.link}>Track this bus ›</Text>
          </Card>
        </Pressable>
      )}

      {data && runs.length === 0 && (
        <Card><Text style={styles.muted}>No shuttles today. The buses run Saturday to Thursday.</Text></Card>
      )}

      {runs.length > 0 && <Text style={styles.section}>Today's timetable</Text>}
      {runs.map((run) => (
        <Pressable key={run.id} onPress={() => onOpenTrip(run)}>
          <Card style={styles.tripCard}>
            <View style={styles.row}>
              <Text style={styles.tripTime}>{run.scheduledTime}</Text>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={styles.tripTitle}>{run.label}</Text>
                <Text style={styles.muted}>
                  {directionText[run.direction]}{run.bus ? ` · Bus ${run.bus.number}` : ''}
                </Text>
                <Text style={styles.muted}>{tripLine(run)}</Text>
              </View>
              <StatusBadge label={run.live?.statusLabel ?? 'Not started'} />
            </View>
          </Card>
        </Pressable>
      ))}

      {alerts.length > 0 && <Text style={styles.section}>My reminders</Text>}
      {alerts.map((a) => (
        <Card key={a.id} style={styles.tripCard}>
          <View style={styles.row}>
            <Text style={{ flex: 1, color: colors.text }}>
              {a.scheduledTime} trip · {a.minutesBefore} min before {stopName(a.stopId)}
            </Text>
            <Pressable onPress={() => removeAlert(a)} hitSlop={10}>
              <Text style={{ color: colors.danger }}>Remove</Text>
            </Pressable>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  hello: { fontSize: 22, fontWeight: '700', color: colors.text },
  date: { fontSize: 14, color: colors.muted, marginTop: 2 },
  logout: { color: colors.primary, fontWeight: '600' },
  nextCard: { backgroundColor: colors.primaryLight, borderColor: colors.primary, marginBottom: 8 },
  nextLabel: { fontSize: 12, fontWeight: '700', color: colors.primary, letterSpacing: 1 },
  nextTime: { fontSize: 34, fontWeight: '700', color: colors.text, marginRight: 12 },
  nextTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: 4 },
  countdown: { fontSize: 15, fontWeight: '700', color: colors.primary, marginTop: 2 },
  link: { color: colors.primary, fontWeight: '600', marginTop: 10 },
  section: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 20, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  tripCard: { marginBottom: 10 },
  tripTime: { fontSize: 20, fontWeight: '700', color: colors.text, width: 60 },
  tripTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  muted: { fontSize: 14, color: colors.muted, marginTop: 2 },
});
