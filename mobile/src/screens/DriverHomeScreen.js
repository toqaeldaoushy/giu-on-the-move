import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { colors, directionText } from '../theme';
import { Card, ErrorText, StatusBadge } from '../components/ui';

// What the driver sees on each trip card
const statusText = {
  scheduled: 'Not started',
  in_progress: 'On the road',
  completed: 'Finished',
  cancelled: 'Cancelled',
};
const badgeLabel = {
  scheduled: 'Not started',
  in_progress: 'On time',
  completed: 'Arrived',
  cancelled: 'Cancelled',
};

/** The driver's home: the trips assigned to this driver today. */
export default function DriverHomeScreen({ session, onOpenTrip, onLogout }) {
  const { token, user } = session;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api('/driver/runs', { token }));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [token]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000); // an administrator may re-assign a trip at any time
    return () => clearInterval(timer);
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const runs = data?.runs ?? [];
  // A trip already on the road comes first, otherwise the next one that has not started
  const current = runs.find((r) => r.status === 'in_progress') ?? runs.find((r) => r.status === 'scheduled');

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hello}>Hi, {user.name}</Text>
          <Text style={styles.sub}>Driver{data ? ` · ${data.date}` : ''}</Text>
        </View>
        <Pressable onPress={onLogout} hitSlop={10}>
          <Text style={styles.logout}>Log out</Text>
        </Pressable>
      </View>

      <ErrorText message={error} />

      {current && (
        <Pressable onPress={() => onOpenTrip(current)}>
          <Card style={styles.nextCard}>
            <Text style={styles.nextLabel}>{current.status === 'in_progress' ? 'TRIP ON THE ROAD' : 'YOUR NEXT TRIP'}</Text>
            <View style={styles.row}>
              <Text style={styles.nextTime}>{current.scheduledTime}</Text>
              <StatusBadge label={badgeLabel[current.status]} />
            </View>
            <Text style={styles.nextTitle}>{current.label}</Text>
            <Text style={styles.muted}>
              {directionText[current.direction]}{current.bus ? ` · Bus ${current.bus.number} (${current.bus.plate})` : ' · No bus assigned yet'}
            </Text>
            <Text style={styles.link}>{current.status === 'in_progress' ? 'Open trip ›' : 'Open and start ›'}</Text>
          </Card>
        </Pressable>
      )}

      {data && runs.length === 0 && (
        <Card><Text style={styles.muted}>You have no trips assigned today. Pull down to check again.</Text></Card>
      )}

      {runs.length > 0 && <Text style={styles.section}>My trips today</Text>}
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
                <Text style={styles.muted}>{statusText[run.status]}</Text>
              </View>
              <StatusBadge label={badgeLabel[run.status]} />
            </View>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  hello: { fontSize: 22, fontWeight: '700', color: colors.text },
  sub: { fontSize: 14, color: colors.muted, marginTop: 2 },
  logout: { color: colors.primary, fontWeight: '600' },
  nextCard: { backgroundColor: colors.primaryLight, borderColor: colors.primary, marginBottom: 8 },
  nextLabel: { fontSize: 12, fontWeight: '700', color: colors.primary, letterSpacing: 1 },
  nextTime: { fontSize: 34, fontWeight: '700', color: colors.text, marginRight: 12 },
  nextTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: 4 },
  link: { color: colors.primary, fontWeight: '600', marginTop: 10 },
  section: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 20, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  tripCard: { marginBottom: 10 },
  tripTime: { fontSize: 20, fontWeight: '700', color: colors.text, width: 60 },
  tripTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  muted: { fontSize: 14, color: colors.muted, marginTop: 2 },
});
