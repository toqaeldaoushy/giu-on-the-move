import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, connectLive } from '../api';
import { directionText, font, radius, space, useStyles, useTheme } from '../theme';
import { Armchair, BusFront, CalendarClock, Clock, MapPin } from 'lucide-react-native';
import { Card, ErrorText, Header, SEATS, TripRow, seatsColor } from '../components/ui';
import ProfileMenu from '../components/ProfileMenu';
import AdminTimetable from '../components/AdminTimetable';
import AdminAnnouncements from '../components/AdminAnnouncements';

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
  const { t } = useTheme();
  const styles = useStyles(makeStyles);
  const { token, user } = session;
  const [tab, setTab] = useState('trips');
  const [menu, setMenu] = useState(false);
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
    socket.on('trip:occupancy', load);
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
    <View style={styles.screen}>
    <Header
      title={`Hi, ${user.name}`}
      subtitle={`Transportation office${overview ? ` · ${overview.date} · ${timeOf(overview.now)}` : ''}`}
      onProfile={() => setMenu(true)}
    />
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.gold} />}
    >

      <View style={styles.tabs} accessibilityRole="tablist">
        <Pressable onPress={() => setTab('trips')} style={[styles.tab, tab === 'trips' && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === 'trips' }}>
          <Text style={[styles.tabText, tab === 'trips' && styles.tabTextOn]}>Trips</Text>
        </Pressable>
        <Pressable onPress={openReports} style={[styles.tab, tab === 'reports' && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === 'reports' }}>
          <Text style={[styles.tabText, tab === 'reports' && styles.tabTextOn]}>Reports</Text>
          {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread}</Text></View>}
        </Pressable>
        <Pressable onPress={() => setTab('timetable')} style={[styles.tab, tab === 'timetable' && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === 'timetable' }}>
          <Text style={[styles.tabText, tab === 'timetable' && styles.tabTextOn]}>Timetable</Text>
        </Pressable>
        <Pressable onPress={() => setTab('notices')} style={[styles.tab, tab === 'notices' && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === 'notices' }}>
          <Text style={[styles.tabText, tab === 'notices' && styles.tabTextOn]}>Notices</Text>
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
            <TripRow
              key={run.id}
              time={run.scheduledTime}
              title={run.label}
              badge={run.live?.statusLabel ?? 'Not started'}
              onPress={() => onOpenTrip(run)}
              lines={[
                { icon: MapPin, text: directionText[run.direction] },
                { icon: BusFront, text: `${run.bus ? `Bus ${run.bus.number}` : 'No bus'} · ${run.driver ? run.driver.name : 'No driver'}` },
                { icon: Clock, text: tripLine(run) },
                run.occupancy && { icon: Armchair, text: SEATS[run.occupancy.level].label, color: seatsColor(t, run.occupancy.level) },
                run.timeChange && { icon: CalendarClock, text: `New time (usually ${run.timeChange.usualTime})${run.timeChange.reason ? ` · ${run.timeChange.reason}` : ''}`, color: t.goldText },
              ]}
            />
          ))}
        </>
      )}

      {tab === 'timetable' && <AdminTimetable token={token} />}
      {tab === 'notices' && <AdminAnnouncements token={token} />}

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
    <ProfileMenu visible={menu} user={user} onClose={() => setMenu(false)} onLogout={onLogout} />
    </View>
  );
}

function Count({ label, value }) {
  const { t } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.count}>
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (t) => ({
  screen: { flex: 1, backgroundColor: t.background },
  content: { padding: space.xl, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  hello: { fontSize: 22, fontFamily: font.bold, color: t.text },
  sub: { fontFamily: font.medium, fontSize: 14, color: t.muted, marginTop: 2 },
  logout: { color: t.primary, fontFamily: font.semibold },
  tabs: { flexDirection: 'row', backgroundColor: t.surface2, borderRadius: radius.input, padding: 4, marginBottom: space.m },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 9 },
  tabOn: { backgroundColor: t.surface },
  tabText: { fontFamily: font.semibold, fontSize: 13, color: t.muted },
  tabTextOn: { color: t.text },
  badge: { backgroundColor: t.red, borderRadius: 999, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontFamily: font.bold },
  counts: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  count: { flex: 1, backgroundColor: t.surface, borderRadius: radius.input, borderWidth: 1, borderColor: t.border, paddingVertical: 10, alignItems: 'center' },
  countValue: { fontSize: 20, fontFamily: font.bold, color: t.text },
  countLabel: { fontFamily: font.medium, fontSize: 12, color: t.muted, marginTop: 2, textAlign: 'center' },
  warn: { color: t.goldText, marginBottom: 10, fontFamily: font.medium, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tripCard: { marginBottom: 10 },
  tripTime: { fontSize: 20, fontFamily: font.bold, color: t.text, width: 60 },
  tripTitle: { fontSize: 15, fontFamily: font.semibold, color: t.text },
  reportTitle: { fontSize: 16, fontFamily: font.bold, color: t.text },
  note: { fontFamily: font.medium, fontSize: 14, color: t.text, marginTop: 6 },
  muted: { fontFamily: font.medium, fontSize: 14, color: t.muted, marginTop: 2 },
});
