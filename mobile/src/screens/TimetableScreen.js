import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Armchair, Bell, CalendarClock, ChevronRight, Clock, MapPin, Megaphone, Route, Trash2 } from 'lucide-react-native';
import { api } from '../api';
import { directionText, radius, space, useStyles, useTheme } from '../theme';
import { Card, ErrorText, Header, HeroCard, Pill, SEATS, SectionLabel, Segmented, StatusBadge, T, TripRow, seatsColor } from '../components/ui';
import ProfileMenu from '../components/ProfileMenu';

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

/** "New time today (usually 17:30) · Midterms" */
function changeText(change) {
  return `New time (usually ${change.usualTime})${change.reason ? ` · ${change.reason}` : ''}`;
}

function tripLine(run) {
  const live = run.live ?? {};
  if (run.status === 'in_progress') return live.etaMinutes != null ? `On the road · arrives in ${live.etaMinutes} min` : 'On the road';
  if (run.status === 'completed') return `Arrived at ${timeOf(run.actualEnd)}`;
  if (run.status === 'cancelled') return 'This trip will not run';
  return `Departs at ${run.scheduledTime}`;
}

export default function TimetableScreen({ session, stops, lines = [], lineId, onChooseLine, onOpenTrip, onLogout }) {
  const { token, user } = session;
  const { t } = useTheme();
  const s = useStyles(makeStyles);
  const [menu, setMenu] = useState(false);
  const [direction, setDirection] = useState('all');
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [notices, setNotices] = useState([]);       // announcements from the transportation office
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(0);   // when the server's time was read
  const [, setTick] = useState(0);                 // re-draws the countdown every 15 seconds

  const load = useCallback(async () => {
    try {
      const [tt, al, an] = await Promise.all([
        api('/timetable', { token }), api('/alerts', { token }), api('/announcements', { token }).catch(() => ({ announcements: [] })),
      ]);
      setData(tt);
      setNotices(an.announcements);
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
  // With several lines, only the chosen line's trips are shown
  const runs = (data?.runs ?? []).filter((r) => lines.length < 2 || r.routeId === lineId);
  const next = runs.find((r) => r.status === 'scheduled' || r.status === 'in_progress');
  const shown = runs.filter((r) => direction === 'all' || r.direction === direction);
  const countdown = next ? countdownText(next, data, fetchedAt) : null;
  // When nothing is left today: the first shuttle of the next day with trips (on the chosen line)
  const upcoming = !next && data
    ? (data.nextShuttles ?? []).find((n) => lines.length < 2 || n.routeId === lineId) ?? null
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <Header
        title={`Hi, ${user.name}`}
        subtitle={data ? `${niceDate(data.date)} · ${timeOf(data.now)}` : 'Loading…'}
        onProfile={() => setMenu(true)}
      />
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.gold} />}
      >
        <ErrorText message={error} />

        {notices.map((n) => (
          <View key={n.id} style={s.notice} accessibilityRole="alert">
            <Megaphone size={20} color={t.goldText} />
            <View style={{ flex: 1, marginLeft: space.m }}>
              <T v="label" color={t.goldText}>Transportation office · {timeOf(n.createdAt)}</T>
              <T v="body" style={{ marginTop: 2 }}>{n.message}</T>
            </View>
          </View>
        ))}

        {lines.length > 1 && (
          <>
            <T v="label" color={t.muted} style={{ marginBottom: space.s }}>Line</T>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s, paddingBottom: space.m }}>
              {lines.map((l) => {
                const on = l.id === lineId;
                return (
                  <Pressable key={l.id} onPress={() => onChooseLine(l.id)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                    style={[s.chip, on && s.chipOn]}>
                    <Route size={16} color={on ? t.onPrimary : t.goldText} />
                    <T v="caption" color={on ? t.onPrimary : t.text} style={{ marginLeft: 6, fontFamily: on ? 'PlusJakartaSans_700Bold' : undefined }}>{l.name}</T>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}

        {next && (
          <Pressable onPress={() => onOpenTrip(next)} accessibilityRole="button" accessibilityLabel={`Next shuttle at ${next.scheduledTime}. Track this bus`}>
            <HeroCard style={{ marginTop: space.s }}>
              <View style={s.row}>
                <T v="label" color={t.onHeroMuted} style={{ flex: 1 }}>Next shuttle</T>
                <StatusBadge label={next.live?.statusLabel ?? 'Not started'} />
              </View>
              <T v="display" color={t.onHero} style={{ marginTop: space.s }}>{next.scheduledTime}</T>
              <T v="title2" color={t.onHero}>{next.label}</T>
              <T v="caption" color={t.onHeroMuted} style={{ marginTop: 2 }}>
                {directionText[next.direction]}{next.bus ? ` · Bus ${next.bus.number}` : ''} · {tripLine(next)}
              </T>
              {next.timeChange && (
                <T v="caption" color={t.onHero} style={{ marginTop: 2, fontFamily: 'PlusJakartaSans_700Bold' }}>
                  {changeText(next.timeChange)}
                </T>
              )}
              <View style={[s.row, { marginTop: space.l }]}>
                <View style={{ flex: 1 }}>{countdown && <Pill text={countdown} tone={t.mode === 'night' ? 'plain' : 'gold'} />}</View>
                <T v="strong" color={t.onHero}>Track this bus</T>
                <ChevronRight size={20} color={t.onHero} />
              </View>
            </HeroCard>
          </Pressable>
        )}

        {data && !next && (
          <Card style={{ marginTop: space.s }}>
            <T v="label" color={t.muted}>{runs.length === 0 ? 'No shuttles today' : 'No more shuttles today'}</T>
            {upcoming ? (
              <>
                <T v="title2" style={{ marginTop: space.s }}>Next shuttle: {niceDate(upcoming.date)} at {upcoming.time}</T>
                <T v="caption" color={t.muted}>{upcoming.label} · {directionText[upcoming.direction]}</T>
              </>
            ) : null}
            {runs.length === 0 && <T v="caption" color={t.muted} style={{ marginTop: space.s }}>The buses run Saturday to Thursday.</T>}
          </Card>
        )}

        {runs.length > 0 && (
          <>
            <SectionLabel>Today's timetable</SectionLabel>
            <Segmented
              value={direction}
              onChange={setDirection}
              options={[{ value: 'all', label: 'All' }, { value: 'inbound', label: 'To campus' }, { value: 'outbound', label: 'From campus' }]}
            />
            <View style={{ height: space.m }} />
          </>
        )}
        {shown.map((run) => (
          <TripRow
            key={run.id}
            time={run.scheduledTime}
            title={run.label}
            badge={run.live?.statusLabel ?? 'Not started'}
            onPress={() => onOpenTrip(run)}
            lines={[
              { icon: MapPin, text: `${directionText[run.direction]}${run.bus ? ` · Bus ${run.bus.number}` : ''}` },
              { icon: Clock, text: tripLine(run) },
              run.occupancy && { icon: Armchair, text: SEATS[run.occupancy.level].label, color: seatsColor(t, run.occupancy.level) },
              run.timeChange && { icon: CalendarClock, text: changeText(run.timeChange), color: t.goldText },
            ]}
          />
        ))}
        {runs.length > 0 && shown.length === 0 && (
          <Card><T color={t.muted}>No trips in this direction today.</T></Card>
        )}

        {alerts.length > 0 && <SectionLabel>My reminders</SectionLabel>}
        {alerts.map((a) => (
          <Card key={a.id} style={s.tripCard}>
            <View style={s.row}>
              <View style={s.iconBox}><Bell size={18} color={t.goldText} /></View>
              <View style={{ flex: 1, marginLeft: space.m }}>
                <T v="strong">{a.scheduledTime} trip</T>
                <T v="caption" color={t.muted}>{a.minutesBefore} min before {stopName(a.stopId)}</T>
              </View>
              <Pressable onPress={() => removeAlert(a)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Remove reminder" style={s.iconBtn}>
                <Trash2 size={20} color={t.red} />
              </Pressable>
            </View>
          </Card>
        ))}
      </ScrollView>
      <ProfileMenu visible={menu} user={user} onClose={() => setMenu(false)} onLogout={onLogout} />
    </View>
  );
}

const makeStyles = (t) => ({
  notice: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: t.goldTint, borderRadius: radius.card, padding: space.l, marginBottom: space.m, borderWidth: 1, borderColor: t.gold },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, borderRadius: radius.pill, paddingHorizontal: 14, height: 40 },
  chipOn: { backgroundColor: t.primary, borderColor: t.primary },
  content: { padding: space.xl, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center' },
  tripCard: { marginBottom: space.m },
  iconBox: { width: 40, height: 40, borderRadius: radius.input, backgroundColor: t.goldTint, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
