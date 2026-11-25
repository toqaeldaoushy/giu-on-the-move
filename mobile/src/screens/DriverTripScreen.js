import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { api } from '../api';
import { colors, directionText } from '../theme';
import { Button, Card, ErrorText, StatusBadge } from '../components/ui';
import BusMap from '../components/BusMap';
import { askLocationPermission, useLocationSharing } from '../useLocationSharing';

const PROBLEMS = [
  { type: 'traffic_delay', label: 'Traffic delay' },
  { type: 'breakdown', label: 'Breakdown' },
  { type: 'bus_full', label: 'Bus is full' },
  { type: 'other', label: 'Other' },
];

const badgeLabel = { scheduled: 'Not started', in_progress: 'On time', completed: 'Arrived', cancelled: 'Cancelled' };
const clock = (d) => (d ? d.toTimeString().slice(0, 8) : '—');

/** Keeps the phone screen on while it is mounted (only used during a trip). */
function KeepAwake() {
  useKeepAwake();
  return null;
}

/** One trip for the driver: start it, share the bus position, report a problem, end it. */
export default function DriverTripScreen({ session, route, run: initialRun, onBack }) {
  const { token } = session;
  const [run, setRun] = useState(initialRun);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [problemOpen, setProblemOpen] = useState(false);
  const [problemType, setProblemType] = useState(null);
  const [note, setNote] = useState('');

  const onRoad = run.status === 'in_progress';
  const { stats, gpsError, position } = useLocationSharing({ token, runId: run.id, active: onRoad && !paused });
  // On the map: the phone's own GPS while sharing, otherwise the last position the server has
  const mapPosition = position ?? run.live?.position ?? null;

  const reload = useCallback(async () => {
    try {
      const fresh = await api(`/runs/${run.id}/live`, { token });
      setRun(fresh);
    } catch (e) {
      setError(e.message);
    }
  }, [run.id, token]);

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 30000); // notice a cancellation or a change by the administrator
    return () => clearInterval(timer);
  }, [reload]);

  // If the app is opened again during a trip, ask for the location again before sharing resumes
  useEffect(() => {
    if (onRoad) askLocationPermission().then((ok) => !ok && setError('Location is off for this app. Allow it in the phone settings, or riders will not see the bus.'));
  }, [onRoad]);

  async function act(name, fn) {
    setBusy(name);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  function startTrip() {
    act('start', async () => {
      if (!(await askLocationPermission())) {
        throw new Error('The app needs your location to show the bus to riders. Allow location and try again.');
      }
      await api(`/driver/runs/${run.id}/start`, { token, method: 'POST' });
      setPaused(false);
      await reload();
      setMessage('Trip started. Keep this screen open: the bus position is sent every 30 seconds.');
    });
  }

  function endTrip() {
    Alert.alert('End this trip?', 'Riders will see that the bus has arrived.', [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'End trip',
        style: 'destructive',
        onPress: () => act('end', async () => {
          await api(`/driver/runs/${run.id}/end`, { token, method: 'POST' });
          await reload();
          setMessage('Trip ended. Thank you.');
        }),
      },
    ]);
  }

  function sendProblem() {
    if (!problemType) {
      setError('Choose what the problem is.');
      return;
    }
    act('problem', async () => {
      await api(`/driver/runs/${run.id}/problems`, { token, method: 'POST', body: { type: problemType, note: note.trim() || undefined } });
      setProblemOpen(false);
      setProblemType(null);
      setNote('');
      setMessage('Problem sent to the transportation office.');
    });
  }

  const canReport = run.status === 'scheduled' || run.status === 'in_progress';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {onRoad && !paused && <KeepAwake />}

      <Pressable onPress={onBack} hitSlop={10}>
        <Text style={styles.back}>‹ My trips</Text>
      </Pressable>

      <Card style={{ marginTop: 12 }}>
        <View style={styles.row}>
          <Text style={styles.time}>{run.scheduledTime}</Text>
          <StatusBadge label={run.live?.statusLabel ?? badgeLabel[run.status]} />
        </View>
        <Text style={styles.title}>{run.label}</Text>
        <Text style={styles.muted}>{directionText[run.direction]} · Trip {run.tripCode}</Text>
        <Text style={styles.muted}>{run.bus ? `Bus ${run.bus.number} · ${run.bus.plate}` : 'No bus assigned yet. Contact the transportation office.'}</Text>
      </Card>

      {route ? (
        <View style={styles.map}>
          <BusMap route={route} position={onRoad || run.status === 'completed' ? mapPosition : null} />
        </View>
      ) : null}

      <ErrorText message={error} />
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {run.status === 'scheduled' && (
        <View style={styles.block}>
          <Button title="Start trip" onPress={startTrip} busy={busy === 'start'} disabled={!run.bus} />
          <Text style={styles.hint}>Press when the bus leaves. Riders will start to see it on the map.</Text>
        </View>
      )}

      {onRoad && (
        <Card style={[styles.block, paused ? styles.pausedCard : styles.liveCard]}>
          <Text style={[styles.shareTitle, { color: paused ? colors.warning : colors.good }]}>
            {paused ? 'Location sharing is paused' : 'Sharing the bus location'}
          </Text>
          <Text style={styles.muted}>
            {paused ? 'Riders still see the last position that was sent.' : 'A new position is sent every 30 seconds. Keep this screen open.'}
          </Text>
          <Text style={styles.stats}>
            Last sent {clock(stats.lastSentAt)} · {stats.stored} stored · {stats.failed} failed
          </Text>
          {stats.lastError ? <Text style={styles.warn}>Last send failed: {stats.lastError}</Text> : null}
          {gpsError ? <Text style={styles.warn}>GPS: {gpsError}</Text> : null}
          <View style={{ marginTop: 12 }}>
            <Button title={paused ? 'Resume sharing' : 'Pause sharing'} kind="outline" onPress={() => setPaused((p) => !p)} />
          </View>
        </Card>
      )}

      {canReport && !problemOpen && (
        <View style={styles.block}>
          <Button title="Report a problem" kind="outline" onPress={() => { setProblemOpen(true); setError(''); }} />
        </View>
      )}

      {canReport && problemOpen && (
        <Card style={styles.block}>
          <Text style={styles.shareTitle}>What is the problem?</Text>
          <View style={styles.choices}>
            {PROBLEMS.map((p) => (
              <Pressable
                key={p.type}
                onPress={() => setProblemType(p.type)}
                style={[styles.choice, problemType === p.type && styles.choiceOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: problemType === p.type }}
              >
                <Text style={[styles.choiceText, problemType === p.type && { color: '#fff' }]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Note (optional), e.g. accident near the ring road"
            placeholderTextColor={colors.muted}
            value={note}
            onChangeText={setNote}
            maxLength={500}
            multiline
          />
          <View style={styles.row2}>
            <Button small title="Cancel" kind="outline" onPress={() => { setProblemOpen(false); setProblemType(null); setNote(''); }} />
            <View style={{ width: 10 }} />
            <Button small title="Send" onPress={sendProblem} busy={busy === 'problem'} />
          </View>
        </Card>
      )}

      {onRoad && (
        <View style={styles.block}>
          <Button title="End trip" kind="danger" onPress={endTrip} busy={busy === 'end'} />
          <Text style={styles.hint}>Press when the bus reaches the last stop.</Text>
        </View>
      )}

      {run.status === 'completed' && (
        <Card style={styles.block}><Text style={styles.muted}>This trip is finished.</Text></Card>
      )}
      {run.status === 'cancelled' && (
        <Card style={styles.block}><Text style={styles.muted}>This trip was cancelled by the transportation office.</Text></Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  back: { color: colors.primary, fontWeight: '600', fontSize: 16 },
  map: { marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  row2: { flexDirection: 'row', marginTop: 12 },
  time: { fontSize: 34, fontWeight: '700', color: colors.text, marginRight: 12 },
  title: { fontSize: 17, fontWeight: '600', color: colors.text, marginTop: 4 },
  muted: { fontSize: 14, color: colors.muted, marginTop: 2 },
  block: { marginTop: 16 },
  hint: { fontSize: 13, color: colors.muted, marginTop: 6, textAlign: 'center' },
  message: { color: colors.good, marginTop: 10, fontSize: 14 },
  liveCard: { borderColor: colors.good },
  pausedCard: { borderColor: colors.warning },
  shareTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  stats: { fontSize: 13, color: colors.text, marginTop: 8 },
  warn: { fontSize: 13, color: colors.warning, marginTop: 4 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  choice: { borderWidth: 1, borderColor: colors.primary, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, marginRight: 8, marginBottom: 8 },
  choiceOn: { backgroundColor: colors.primary },
  choiceText: { color: colors.primary, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, minHeight: 60, color: colors.text, marginTop: 4, textAlignVertical: 'top' },
});
