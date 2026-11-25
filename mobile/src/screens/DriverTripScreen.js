import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { api } from '../api';
import { directionText, font, radius, space, useStyles, useTheme } from '../theme';
import { Armchair, BusFront, CircleStop, Pause, Play, TriangleAlert } from 'lucide-react-native';
import { Button, Card, ErrorText, Header, StatusBadge, T, useTextDir } from '../components/ui';
import { m, useLang } from '../i18n';
import BusMap from '../components/BusMap';
import { askLocationPermission, useLocationSharing } from '../useLocationSharing';

const PROBLEMS = [
  { type: 'traffic_delay', label: 'Traffic delay' },
  { type: 'breakdown', label: 'Breakdown' },
  { type: 'bus_full', label: 'Bus is full' },
  { type: 'other', label: 'Other' },
];

const SEAT_LEVELS = [
  { level: 'seats', label: 'Seats free' },
  { level: 'few', label: 'A few seats' },
  { level: 'full', label: 'Full' },
];

const badgeLabel = { scheduled: 'Not started', in_progress: 'On time', completed: 'Arrived', cancelled: 'Cancelled' };
const clock = (d) => (d ? d.toTimeString().slice(0, 8) : '—');

/** Text that follows the language (Cairo font and right alignment in Arabic) */
function Tx({ style, children }) {
  const dir = useTextDir();
  return <Text style={dir(style)}>{children}</Text>;
}

/** Keeps the phone screen on while it is mounted (only used during a trip). */
function KeepAwake() {
  useKeepAwake();
  return null;
}

/** One trip for the driver: start it, share the bus position, report a problem, end it. */
export default function DriverTripScreen({ session, route, run: initialRun, onBack }) {
  const { t } = useTheme();
  const styles = useStyles(makeStyles);
  const { tr, rtl } = useLang();
  const dir = useTextDir();
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
    if (onRoad) askLocationPermission().then((ok) => !ok && setError(tr('Location is off for this app. Allow it in the phone settings, or riders will not see the bus.')));
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
        throw new Error(tr('The app needs your location to show the bus to riders. Allow location and try again.'));
      }
      await api(`/driver/runs/${run.id}/start`, { token, method: 'POST' });
      setPaused(false);
      await reload();
      setMessage(tr('Trip started. Keep this screen open: the bus position is sent every 30 seconds.'));
    });
  }

  function endTrip() {
    Alert.alert(tr('End this trip?'), tr('Riders will see that the bus has arrived.'), [
      { text: tr('Not yet'), style: 'cancel' },
      {
        text: tr('End trip'),
        style: 'destructive',
        onPress: () => act('end', async () => {
          await api(`/driver/runs/${run.id}/end`, { token, method: 'POST' });
          await reload();
          setMessage(tr('Trip ended. Thank you.'));
        }),
      },
    ]);
  }

  function setSeats(level) {
    act(`seats-${level}`, async () => {
      const res = await api(`/driver/runs/${run.id}/occupancy`, { token, method: 'POST', body: { level } });
      setRun((prev) => ({ ...prev, occupancy: { level: res.level, at: res.at } }));
    });
  }

  function sendProblem() {
    if (!problemType) {
      setError(tr('Choose what the problem is.'));
      return;
    }
    act('problem', async () => {
      await api(`/driver/runs/${run.id}/problems`, { token, method: 'POST', body: { type: problemType, note: note.trim() || undefined } });
      setProblemOpen(false);
      setProblemType(null);
      setNote('');
      setMessage(tr('Problem sent to the transportation office.'));
    });
  }

  const canReport = run.status === 'scheduled' || run.status === 'in_progress';

  return (
    <View style={styles.screen}>
    <Header
      title={tr(run.label)}
      subtitle={`${run.scheduledTime} · ${tr(directionText[run.direction])}`}
      onBack={onBack}
      right={<StatusBadge label={run.live?.statusLabel ?? badgeLabel[run.status]} />}
    />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {onRoad && !paused && <KeepAwake />}

      <Card>
        <View style={styles.row}>
          <BusFront size={20} color={t.goldText} />
          <T v="strong" style={{ ...m(rtl).start(8), flex: 1 }}>{run.bus ? `${tr('Bus {number}', { number: run.bus.number })} · ${run.bus.plate}` : tr('No bus assigned yet. Contact the transportation office.')}</T>
        </View>
      </Card>

      {route ? (
        <View style={styles.map}>
          <BusMap route={route} position={onRoad || run.status === 'completed' ? mapPosition : null} />
        </View>
      ) : null}

      <ErrorText message={error} />
      {message ? <Tx style={styles.message}>{message}</Tx> : null}

      {run.status === 'scheduled' && (
        <View style={styles.block}>
          <Button title={tr('Start trip')} icon={Play} onPress={startTrip} busy={busy === 'start'} disabled={!run.bus} />
          <Tx style={styles.hint}>{tr('Press when the bus leaves. Riders will start to see it on the map.')}</Tx>
        </View>
      )}

      {onRoad && (
        <Card style={[styles.block, paused ? styles.pausedCard : styles.liveCard]}>
          <Tx style={[styles.shareTitle, { color: paused ? t.goldText : t.green }]}>
            {tr(paused ? 'Location sharing is paused' : 'Sharing the bus location')}
          </Tx>
          <Tx style={styles.muted}>
            {tr(paused ? 'Riders still see the last position that was sent.' : 'A new position is sent every 30 seconds. Keep this screen open.')}
          </Tx>
          <Tx style={styles.stats}>
            {tr('Last sent {time} · {stored} stored · {failed} failed', { time: clock(stats.lastSentAt), stored: stats.stored, failed: stats.failed })}
          </Tx>
          {stats.lastError ? <Tx style={styles.warn}>{tr('Last send failed: {error}', { error: tr(stats.lastError) })}</Tx> : null}
          {gpsError ? <Tx style={styles.warn}>{tr('GPS: {error}', { error: gpsError })}</Tx> : null}
          <View style={{ marginTop: 12 }}>
            <Button title={tr(paused ? 'Resume sharing' : 'Pause sharing')} icon={paused ? Play : Pause} kind="secondary" onPress={() => setPaused((p) => !p)} />
          </View>
        </Card>
      )}

      {onRoad && (
        <Card style={styles.block}>
          <View style={styles.row}>
            <Armchair size={20} color={t.goldText} />
            <Tx style={[styles.shareTitle, { marginBottom: 0, flex: 1, ...m(rtl).start(8) }]}>{tr('Seats on the bus')}</Tx>
          </View>
          <Tx style={styles.muted}>{tr('Tap when it changes. Riders see it at once.')}</Tx>
          <View style={[styles.row2, { gap: 8 }]}>
            {SEAT_LEVELS.map((lv) => (
              <Button
                key={lv.level}
                small
                title={tr(lv.label)}
                kind={run.occupancy?.level === lv.level ? (lv.level === 'full' ? 'danger' : 'primary') : 'secondary'}
                busy={busy === `seats-${lv.level}`}
                onPress={() => setSeats(lv.level)}
              />
            ))}
          </View>
        </Card>
      )}

      {canReport && !problemOpen && (
        <View style={styles.block}>
          <Button title={tr('Report a problem')} icon={TriangleAlert} kind="secondary" onPress={() => { setProblemOpen(true); setError(''); }} />
        </View>
      )}

      {canReport && problemOpen && (
        <Card style={styles.block}>
          <Tx style={styles.shareTitle}>{tr('What is the problem?')}</Tx>
          <View style={styles.choices}>
            {PROBLEMS.map((p) => (
              <Pressable
                key={p.type}
                onPress={() => setProblemType(p.type)}
                style={[styles.choice, problemType === p.type && styles.choiceOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: problemType === p.type }}
              >
                <Tx style={[styles.choiceText, problemType === p.type && { color: t.onPrimary }]}>{tr(p.label)}</Tx>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={dir(styles.input)}
            placeholder={tr('Note (optional), e.g. accident near the ring road')}
            placeholderTextColor={t.disabled}
            value={note}
            onChangeText={setNote}
            maxLength={500}
            multiline
          />
          <View style={styles.row2}>
            <Button small title={tr('Cancel')} kind="secondary" onPress={() => { setProblemOpen(false); setProblemType(null); setNote(''); }} />
            <View style={{ width: 10 }} />
            <Button small title={tr('Send')} onPress={sendProblem} busy={busy === 'problem'} />
          </View>
        </Card>
      )}

      {onRoad && (
        <View style={styles.block}>
          <Button title={tr('End trip')} icon={CircleStop} kind="danger" onPress={endTrip} busy={busy === 'end'} />
          <Tx style={styles.hint}>{tr('Press when the bus reaches the last stop.')}</Tx>
        </View>
      )}

      {run.status === 'completed' && (
        <Card style={styles.block}><Tx style={styles.muted}>{tr('This trip is finished.')}</Tx></Card>
      )}
      {run.status === 'cancelled' && (
        <Card style={styles.block}><Tx style={styles.muted}>{tr('This trip was cancelled by the transportation office.')}</Tx></Card>
      )}
    </ScrollView>
    </View>
  );
}

const makeStyles = (t) => ({
  screen: { flex: 1, backgroundColor: t.background },
  content: { padding: space.xl, paddingBottom: 48 },
  back: { color: t.primary, fontFamily: font.semibold, fontSize: 16 },
  map: { marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  row2: { flexDirection: 'row', marginTop: 12 },
  time: { fontSize: 34, fontFamily: font.bold, color: t.text, marginRight: 12 },
  title: { fontSize: 17, fontFamily: font.semibold, color: t.text, marginTop: 4 },
  muted: { fontFamily: font.medium, fontSize: 14, color: t.muted, marginTop: 2 },
  block: { marginTop: 16 },
  hint: { fontFamily: font.medium, fontSize: 13, color: t.muted, marginTop: 6, textAlign: 'center' },
  message: { color: t.green, marginTop: 10, fontFamily: font.medium, fontSize: 14 },
  liveCard: { borderColor: t.green, borderWidth: 1.5 },
  pausedCard: { borderColor: t.gold, borderWidth: 1.5 },
  shareTitle: { fontSize: 16, fontFamily: font.bold, color: t.text, marginBottom: 4 },
  stats: { fontFamily: font.medium, fontSize: 13, color: t.text, marginTop: 8 },
  warn: { fontFamily: font.medium, fontSize: 13, color: t.goldText, marginTop: 4 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 8 },
  choice: { borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 12 },
  choiceOn: { backgroundColor: t.primary },
  choiceText: { color: t.text, fontFamily: font.semibold },
  input: { fontFamily: font.medium, fontSize: 15, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.border, borderRadius: radius.input, padding: 10, minHeight: 60, color: t.text, marginTop: 4, textAlignVertical: 'top' },
});
