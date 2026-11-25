import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, View } from 'react-native';
import { Armchair, Bell, BusFront, Phone, Star, User, Users } from 'lucide-react-native';
import { api, connectLive } from '../api';
import { directionText, radius, space, useStyles, useTheme } from '../theme';
import { Button, ErrorText, Header, HeroCard, SEATS, SectionLabel, StatusBadge, T, Tile, seatsColor } from '../components/ui';
import BusMap from '../components/BusMap';
import { getFavoriteStop, setFavoriteStop } from '../favorites';

const timeOf = (stamp) => (stamp ? String(stamp).slice(11, 16) : '');

// What the big line at the top says, from the trip status and the ETA to the chosen stop
function headline(run, live, stopName) {
  if (run.status === 'cancelled') return 'This trip has been cancelled.';
  if (run.status === 'completed') return `The bus arrived at ${timeOf(run.actualEnd)}.`;
  if (run.status === 'scheduled') return `Not started yet. Departure at ${run.scheduledTime}.`;
  if (!live?.position) return 'The trip has started. Waiting for the bus position…';
  if (live.stop?.passed) return `The bus has passed ${stopName}.`;
  if (live.stop) return live.stop.etaMinutes <= 0 ? `The bus is at ${stopName} now.` : `Arrives at ${stopName} in ${live.stop.etaMinutes} min`;
  return `Arrives in ${live.etaMinutes} min`;
}

export default function TripScreen({ session, route, run: initialRun, onBack }) {
  const { token } = session;
  const { t } = useTheme();
  const st = useStyles(makeStyles);
  const [run, setRun] = useState(initialRun);
  const [live, setLive] = useState(initialRun.live);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [alert, setAlert] = useState(null);
  const [busy, setBusy] = useState('');

  // Stops in the order this trip visits them: to campus = 1 → 6, from campus = 6 → 1
  const stops = useMemo(
    () => (run.direction === 'inbound' ? route.stops : [...route.stops].reverse()),
    [route.stops, run.direction],
  );
  const [stopId, setStopId] = useState(stops[stops.length - 1].id);
  const stopName = stops.find((s) => s.id === stopId)?.name ?? '';

  // Favorite stop: the trip opens on the rider's usual stop of this line, if they saved one
  const userId = session.user.id;
  const [favorite, setFavorite] = useState(null);
  useEffect(() => {
    getFavoriteStop(userId, route.id).then((id) => {
      if (id && stops.some((s) => s.id === id)) {
        setFavorite(id);
        setStopId(id);
      }
    });
  }, [userId, route.id, stops]);
  function toggleFavorite() {
    const next = favorite === stopId ? null : stopId;
    setFavorite(next);
    setFavoriteStop(userId, route.id, next);
  }

  // The latest state of the trip, with the ETA to the chosen stop
  const refresh = useCallback(async () => {
    try {
      const fresh = await api(`/runs/${run.id}/live?stopId=${stopId}`, { token });
      setRun(fresh);
      setLive(fresh.live);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [run.id, stopId, token]);

  useEffect(() => { refresh(); }, [refresh]);

  // My reminder for this trip and stop, if I set one
  const loadAlert = useCallback(async () => {
    try {
      const { alerts } = await api('/alerts', { token });
      setAlert(alerts.find((a) => a.runId === run.id && a.stopId === stopId) ?? null);
    } catch {
      /* the reminder is optional; the rest of the screen still works */
    }
  }, [run.id, stopId, token]);

  useEffect(() => { loadAlert(); }, [loadAlert]);

  // The live connection: the server pushes every new bus position to this screen
  const lastRefresh = useRef(0);
  useEffect(() => {
    const socket = connectLive(token);
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('watch', { runId: run.id, stopId });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('bus:position', (m) => {
      if (m.runId !== run.id) return;
      setLive((prev) => ({ ...prev, ...m }));
      // The pushed message has the ETA to the end of the route; ask for the ETA to my stop now and then
      if (Date.now() - lastRefresh.current > 3000) {
        lastRefresh.current = Date.now();
        refresh();
      }
    });
    socket.on('trip:status', (m) => { if (m.runId === run.id) refresh(); });
    socket.on('trip:occupancy', (m) => { if (m.runId === run.id) setRun((prev) => ({ ...prev, occupancy: { level: m.level, at: m.at } })); });
    socket.on('assignment:changed', (m) => { if (m.runId === run.id) refresh(); });
    return () => socket.disconnect();
  }, [run.id, stopId, token, refresh]);

  async function setReminder(minutes) {
    setBusy(`alert${minutes}`);
    try {
      await api('/alerts', { token, method: 'POST', body: { runId: run.id, stopId, minutesBefore: minutes } });
      await loadAlert();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function removeReminder() {
    setBusy('remove');
    try {
      await api(`/alerts/${alert.id}`, { token, method: 'DELETE' });
      setAlert(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  function reportFull() {
    Alert.alert('Report a full bus?', 'The transportation office will see that this bus was full.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        onPress: async () => {
          setBusy('full');
          try {
            const res = await api(`/runs/${run.id}/full-report`, { token, method: 'POST' });
            Alert.alert('Thank you', res.duplicate ? 'You already reported this trip.' : 'Your report was sent.');
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy('');
          }
        },
      },
    ]);
  }

  const canRemind = run.status === 'scheduled' || run.status === 'in_progress';
  const phone = run.driver?.phone;

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <Header
        title={run.label}
        subtitle={`${run.scheduledTime}${run.timeChange ? ` (usually ${run.timeChange.usualTime})` : ''} · ${directionText[run.direction]}`}
        onBack={onBack}
        right={<StatusBadge label={live?.statusLabel ?? 'Not started'} />}
      />
      <ScrollView contentContainerStyle={st.content}>
        <HeroCard>
          <T v="label" color={t.onHeroMuted}>{stopName ? `Your stop · ${stopName}` : 'This trip'}</T>
          <T v="title1" color={t.onHero} style={{ marginTop: space.s }}>{headline(run, live, stopName)}</T>
          {run.status === 'in_progress' && live?.remainingKm != null && (
            <T v="caption" color={t.onHeroMuted} style={{ marginTop: space.xs }}>
              {live.remainingKm} km to the end of the route
              {live.delayMinutes != null && live.delayMinutes > 0 ? ` · about ${live.delayMinutes} min late` : ''}
            </T>
          )}
          <View style={[st.row, { marginTop: space.m }]}>
            <View style={[st.dot, { backgroundColor: connected ? (t.mode === 'night' ? t.onHero : t.gold) : t.onHeroMuted }]} />
            <T v="caption" color={t.onHeroMuted}>
              {connected ? 'Live' : 'Connecting…'}
              {live?.lastPingAt ? `  ·  last update ${timeOf(live.lastPingAt)}` : ''}
            </T>
          </View>
        </HeroCard>

        <ErrorText message={error} />

        <View style={{ height: space.m }} />
        <BusMap route={route} position={live?.position} stopId={stopId} />

        <SectionLabel>My stop</SectionLabel>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
          {stops.map((s) => {
            const on = s.id === stopId;
            return (
              <Pressable key={s.id} onPress={() => setStopId(s.id)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={[st.chip, on && st.chipOn]}>
                <View style={st.row}>
                  {s.id === favorite && <Star size={14} color={on ? t.onPrimary : t.goldText} fill={on ? t.onPrimary : t.goldText} style={{ marginRight: 4 }} />}
                  <T v="caption" color={on ? t.onPrimary : t.text} style={on && { fontFamily: 'PlusJakartaSans_700Bold' }}>{s.name}</T>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable onPress={toggleFavorite} accessibilityRole="button" hitSlop={8} style={[st.row, { marginTop: space.m, alignSelf: 'flex-start' }]}>
          <Star size={18} color={t.goldText} fill={favorite === stopId ? t.goldText : 'transparent'} />
          <T v="strong" color={t.goldText} style={{ marginLeft: 6 }}>
            {favorite === stopId ? `${stopName} is my usual stop` : `Save ${stopName} as my usual stop`}
          </T>
        </Pressable>

        {canRemind && (
          <>
            <SectionLabel>Remind me before the bus reaches my stop</SectionLabel>
            <View style={st.buttonRow}>
              {[2, 5, 10].map((m) => (
                <Button
                  key={m}
                  small
                  icon={alert?.minutesBefore === m ? Bell : undefined}
                  title={`${m} min`}
                  kind={alert?.minutesBefore === m ? 'accent' : 'secondary'}
                  busy={busy === `alert${m}`}
                  onPress={() => setReminder(m)}
                />
              ))}
            </View>
            {alert && (
              <T v="caption" color={t.muted} style={{ marginTop: space.s }}>
                You will get a notification about {alert.minutesBefore} min before the bus reaches {stopName}. Keep the app open or in the background.{' '}
                <T v="caption" color={t.red} onPress={removeReminder} style={{ fontFamily: 'PlusJakartaSans_700Bold' }}>Remove</T>
              </T>
            )}
          </>
        )}

        {run.status === 'in_progress' && (
          <>
            <SectionLabel>Seats</SectionLabel>
            <View style={[st.row, st.seats]}>
              <Armchair size={22} color={run.occupancy ? seatsColor(t, run.occupancy.level) : t.muted} />
              <View style={{ flex: 1, marginLeft: space.m }}>
                <T v="strong" color={run.occupancy ? seatsColor(t, run.occupancy.level) : t.text}>
                  {run.occupancy ? SEATS[run.occupancy.level].label : 'Not reported yet'}
                </T>
                <T v="caption" color={t.muted}>
                  {run.occupancy ? `Reported by the driver at ${timeOf(run.occupancy.at)}` : 'The driver can report how full the bus is during the trip.'}
                </T>
              </View>
            </View>
          </>
        )}

        <SectionLabel>Bus and driver</SectionLabel>
        <View style={st.tiles}>
          <Tile icon={BusFront} label="Bus" value={run.bus ? `${run.bus.number} · ${run.bus.plate}` : 'Not assigned yet'} />
          <Tile icon={User} label="Driver" value={run.driver?.name ?? 'Not assigned yet'} />
        </View>
        {phone ? (
          <Button title={`Call driver (${phone})`} kind="secondary" icon={Phone} onPress={() => Linking.openURL(`tel:${phone}`)} style={{ marginTop: space.m }} />
        ) : (
          <T v="caption" color={t.muted} style={{ marginTop: space.s }}>The driver's number is not shared.</T>
        )}

        {run.status === 'in_progress' && (
          <Button title="Report: the bus is full" kind="danger" icon={Users} busy={busy === 'full'} onPress={reportFull} style={{ marginTop: space.xxl }} />
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t) => ({
  content: { padding: space.xl, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  chip: { borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, borderRadius: radius.pill, paddingHorizontal: 14, height: 40, justifyContent: 'center' },
  chipOn: { backgroundColor: t.primary, borderColor: t.primary },
  buttonRow: { flexDirection: 'row', gap: space.s },
  tiles: { flexDirection: 'row', gap: space.s },
  seats: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: radius.card, padding: space.l },
});
