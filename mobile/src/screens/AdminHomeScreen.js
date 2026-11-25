import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, connectLive } from '../api';
import { colors, directionText } from '../theme';
import { Card, ErrorText, StatusBadge } from '../components/ui';

const PROBLEM_TEXT = { traffic_delay: 'Traffic delay', breakdown: 'Breakdown', bus_full: 'Bus is full', other: 'Other problem' };
const timeOf = (stamp) => (stamp ? String(stamp).slice(11, 16) : '');

function tripLine(run) {
  const live = run.live ?? {};
  if (run.status === 'in_progress') {
    const eta = live.etaMinutes != null ? `arrives in ${live.etaMinutes} min` : 'on the road';
    return live.delayMinutes > 0 ? `${eta} · ${live.delayMinutes} min late` : eta;
  }
  if (run.status === 'completed') return `Arrived at ${timeOf(run.actualEnd)}`;
  if (run.status === 'cancelled') return 'Cancelled';
  return `Departs at ${run.scheduledTime}`;
}

/** The transportation office's home: today's trips and the reports from drivers and riders. */
export default function AdminHomeScreen({ session, onOpenTrip, onLogout }) {
  const { token, user } = session;
  const [tab, setTab] = useState('trips');
  const [overview, setOverview] = useState(null);
  const [reports, setReports] = useState(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const load = useCallback(async () => {
    try {
      const [ov, rp] = await Promise.all([api('/admin/overview', { token }), api('/admin/reports', { token })]);
      setOverview(ov);
      setReports(rp);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [token]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    // Live updates: a new report or a trip that starts, ends or is cancelled
    const socket = connectLive(token);
    socket.on('report:new', () => {
      if (tabRef.current !== 'reports') setUnread((n) => n + 1);
      load();
    });
    socket.on('trip:status', load);
    socket.on('assignment:changed', load);
    return () => {
      clearInterval(timer);
      socket.close();
    };
  }, [load, token]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function openReports() {
    setTab('reports');
    setUnread(0);
  }

  const runs = overview?.runs ?? [];
  const counts = overview?.counts ?? {};
  const allReports = [
    ...(reports?.problems ?? []).map((p) => ({ ...p, key: `p${p.id}`, from: p.driverName ? `Driver ${p.driverName}` : 'Driver', title: PROBLEM_TEXT[p.type] ?? p.type })),
    ...(reports?.riderReports ?? []).map((r) => ({ ...r, key: `r${r.id}`, from: 'A rider', title: 'Bus is full' })),
  ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hello}>Hi, {user.name}</Text>
          <Text style={styles.sub}>Transportation office{overview ? ` · ${overview.date} · ${timeOf(overview.now)}` : ''}</Text>
        </View>
        <Pressable onPress={onLogout} hitSlop={10}>
          <Text style={styles.logout}>Log out</Text>
        </Pressable>
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        <Pressable onPress={() => setTab('trips')} style={[styles.tab, tab === 'trips' && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === 'trips' }}>
          <Text style={[styles.tabText, tab === 'trips' && styles.tabTextOn]}>Today's trips</Text>
        </Pressable>
        <Pressable onPress={openReports} style={[styles.tab, tab === 'reports' && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === 'reports' }}>
          <Text style={[styles.tabText, tab === 'reports' && styles.tabTextOn]}>Reports</Text>
          {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread}</Text></View>}
        </Pressable>
      </View>

      <ErrorText message={error} />

      {tab === 'trips' && (
        <>
          {overview && (
            <View style={styles.counts}>
              <Count label="Not started" value={counts.scheduled ?? 0} />
              <Count label="On the road" value={counts.in_progress ?? 0} />
              <Count label="Finished" value={counts.completed ?? 0} />
              <Count label="Cancelled" value={counts.cancelled ?? 0} />
            </View>
          )}
          {overview?.unassigned > 0 && (
            <Text style={styles.warn}>{overview.unassigned} trip{overview.unassigned > 1 ? 's have' : ' has'} no bus or driver yet.</Text>
          )}
          {overview && runs.length === 0 && (
            <Card><Text style={styles.muted}>No trips today. The buses run Saturday to Thursday.</Text></Card>
          )}
          {runs.map((run) => (
            <Pressable key={run.id} onPress={() => onOpenTrip(run)}>
              <Card style={styles.tripCard}>
                <View style={styles.row}>
                  <Text style={styles.tripTime}>{run.scheduledTime}</Text>
                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <Text style={styles.tripTitle}>{run.label}</Text>
                    <Text style={styles.muted}>
                      {directionText[run.direction]} · {run.bus ? `Bus ${run.bus.number}` : 'No bus'} · {run.driver ? run.driver.name : 'No driver'}
                    </Text>
                    <Text style={styles.muted}>{tripLine(run)}</Text>
                  </View>
                  <StatusBadge label={run.live?.statusLabel ?? 'Not started'} />
                </View>
              </Card>
            </Pressable>
          ))}
        </>
      )}

      {tab === 'reports' && (
        <>
          {reports && allReports.length === 0 && (
            <Card><Text style={styles.muted}>No reports today. New reports from drivers and riders appear here.</Text></Card>
          )}
          {allReports.map((r) => (
            <Card key={r.key} style={styles.tripCard}>
              <View style={styles.row}>
                <Text style={styles.reportTitle}>{r.title}</Text>
                <Text style={styles.muted}>{timeOf(r.createdAt)}</Text>
              </View>
              <Text style={styles.muted}>{r.from} · trip {r.tripCode}</Text>
              {r.note ? <Text style={styles.note}>"{r.note}"</Text> : null}
            </Card>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function Count({ label, value }) {
  return (
    <View style={styles.count}>
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  hello: { fontSize: 22, fontWeight: '700', color: colors.text },
  sub: { fontSize: 14, color: colors.muted, marginTop: 2 },
  logout: { color: colors.primary, fontWeight: '600' },
  tabs: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 4, marginBottom: 12 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 9 },
  tabOn: { backgroundColor: colors.primary },
  tabText: { fontWeight: '600', color: colors.primary },
  tabTextOn: { color: '#fff' },
  badge: { backgroundColor: colors.danger, borderRadius: 999, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  counts: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  count: { flex: 1, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, alignItems: 'center' },
  countValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  countLabel: { fontSize: 12, color: colors.muted, marginTop: 2, textAlign: 'center' },
  warn: { color: colors.warning, marginBottom: 10, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tripCard: { marginBottom: 10 },
  tripTime: { fontSize: 20, fontWeight: '700', color: colors.text, width: 60 },
  tripTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  reportTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  note: { fontSize: 14, color: colors.text, marginTop: 6 },
  muted: { fontSize: 14, color: colors.muted, marginTop: 2 },
});
