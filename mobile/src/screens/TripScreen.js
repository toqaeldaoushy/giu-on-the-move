import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, connectLive } from '../api';
import { colors, directionText } from '../theme';
import { Button, Card, ErrorText, StatusBadge } from '../components/ui';
import BusMap from '../components/BusMap';

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
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} hitSlop={10}>
        <Text style={styles.back}>‹ Timetable</Text>
      </Pressable>

      <View style={styles.titleRow}>
        <Text style={styles.time}>{run.scheduledTime}</Text>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>{run.label}</Text>
          <Text style={styles.muted}>{directionText[run.direction]}</Text>
        </View>
        <StatusBadge label={live?.statusLabel ?? 'Not started'} />
      </View>

      <Card style={styles.etaCard}>
        <Text style={styles.headline}>{headline(run, live, stopName)}</Text>
        {run.status === 'in_progress' && live?.remainingKm != null && (
          <Text style={styles.muted}>
            {live.remainingKm} km to the end of the route
            {live.delayMinutes != null && live.delayMinutes > 0 ? ` · about ${live.delayMinutes} min late` : ''}
          </Text>
        )}
        <Text style={[styles.live, { color: connected ? colors.good : colors.muted }]}>
          {connected ? '● Live' : '○ Connecting…'}
          {live?.lastPingAt ? `  ·  last update ${timeOf(live.lastPingAt)}` : ''}
        </Text>
      </Card>

      <ErrorText message={error} />

      <View style={{ height: 12 }} />
      <BusMap route={route} position={live?.position} stopId={stopId} />

      <Text style={styles.section}>My stop</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {stops.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => setStopId(s.id)}
            style={[styles.chip, s.id === stopId && styles.chipOn]}
          >
            <Text style={[styles.chipText, s.id === stopId && styles.chipTextOn]}>{s.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {canRemind && (
        <>
          <Text style={styles.section}>Remind me before the bus reaches {stopName}</Text>
          <View style={styles.buttonRow}>
            {[2, 5, 10].map((m) => (
              <Button
                key={m}
                small
                title={`${m} min`}
                kind={alert?.minutesBefore === m ? 'primary' : 'outline'}
                busy={busy === `alert${m}`}
                onPress={() => setReminder(m)}
              />
            ))}
          </View>
          {alert && (
            <Text style={styles.muted}>
              Reminder saved: {alert.minutesBefore} min before {stopName}.{' '}
              <Text style={{ color: colors.danger }} onPress={removeReminder}>Remove</Text>
            </Text>
          )}
        </>
      )}

      <Text style={styles.section}>Bus and driver</Text>
      <Card>
        <Text style={styles.infoLine}>
          Bus {run.bus ? `${run.bus.number} (${run.bus.plate})` : 'not assigned yet'}
        </Text>
        <Text style={styles.infoLine}>Driver: {run.driver?.name ?? 'not assigned yet'}</Text>
        {phone ? (
          <View style={{ marginTop: 10 }}>
            <Button title={`Call driver (${phone})`} kind="outline" onPress={() => Linking.openURL(`tel:${phone}`)} />
          </View>
        ) : (
          <Text style={styles.muted}>The driver's number is not shared.</Text>
        )}
      </Card>

      {run.status === 'in_progress' && (
        <View style={{ marginTop: 16 }}>
          <Button title="Report: the bus is full" kind="danger" busy={busy === 'full'} onPress={reportFull} />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  back: { color: colors.primary, fontSize: 16, fontWeight: '600', marginBottom: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  time: { fontSize: 30, fontWeight: '700', color: colors.text },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { fontSize: 14, color: colors.muted, marginTop: 4 },
  etaCard: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  headline: { fontSize: 20, fontWeight: '700', color: colors.text },
  live: { fontSize: 13, marginTop: 8 },
  section: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 20, marginBottom: 8 },
  chip: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  buttonRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  infoLine: { fontSize: 15, color: colors.text, marginBottom: 4 },
});
