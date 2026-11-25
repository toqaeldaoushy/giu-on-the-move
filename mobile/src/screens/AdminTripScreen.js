import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../api';
import { colors, directionText } from '../theme';
import { Button, Card, ErrorText, StatusBadge } from '../components/ui';

const timeOf = (stamp) => (stamp ? String(stamp).slice(11, 16) : '—');
const STATUS_TEXT = { scheduled: 'Not started', in_progress: 'On the road', completed: 'Finished', cancelled: 'Cancelled' };

/** One trip for the transportation office: its state, and (before it starts) re-assign or cancel it. */
export default function AdminTripScreen({ session, run: initialRun, onBack }) {
  const { token } = session;
  const [run, setRun] = useState(initialRun);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(false);
  const [drivers, setDrivers] = useState([]);
  const [buses, setBuses] = useState([]);
  const [driverId, setDriverId] = useState(initialRun.driver?.id ?? null);
  const [busId, setBusId] = useState(initialRun.bus?.id ?? null);
  const [reason, setReason] = useState('');

  const reload = useCallback(async () => {
    try {
      setRun(await api(`/runs/${initialRun.id}/live`, { token }));
    } catch (e) {
      setError(e.message);
    }
  }, [initialRun.id, token]);

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 30000);
    return () => clearInterval(timer);
  }, [reload]);

  async function openEditor() {
    setError('');
    setMessage('');
    try {
      const [d, b] = await Promise.all([api('/admin/drivers', { token }), api('/admin/buses', { token })]);
      setDrivers(d.drivers);
      setBuses(b.buses);
      setDriverId(run.driver?.id ?? null);
      setBusId(run.bus?.id ?? null);
      setReason('');
      setEditing(true);
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveAssignment() {
    const body = { reason: reason.trim() || undefined };
    if (driverId !== (run.driver?.id ?? null)) body.driverId = driverId;
    if (busId !== (run.bus?.id ?? null)) body.busId = busId;
    if (body.driverId === undefined && body.busId === undefined) {
      setError('Choose a different driver or bus first.');
      return;
    }
    setBusy('save');
    setError('');
    try {
      await api(`/admin/runs/${run.id}/assignment`, { token, method: 'PATCH', body });
      setEditing(false);
      await reload();
      setMessage('Trip re-assigned. The drivers were told in their app.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  function cancelTrip() {
    Alert.alert('Cancel this trip?', `${run.scheduledTime} · ${run.label}\nRiders will see that it will not run. This cannot be undone.`, [
      { text: 'Keep the trip', style: 'cancel' },
      {
        text: 'Cancel trip',
        style: 'destructive',
        onPress: async () => {
          setBusy('cancel');
          setError('');
          try {
            await api(`/admin/runs/${run.id}/cancel`, { token, method: 'POST' });
            setEditing(false);
            await reload();
            setMessage('Trip cancelled.');
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy('');
          }
        },
      },
    ]);
  }

  const live = run.live ?? {};
  const notStarted = run.status === 'scheduled';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable onPress={onBack} hitSlop={10}>
        <Text style={styles.back}>‹ Today's trips</Text>
      </Pressable>

      <Card style={{ marginTop: 12 }}>
        <View style={styles.row}>
          <Text style={styles.time}>{run.scheduledTime}</Text>
          <StatusBadge label={live.statusLabel ?? STATUS_TEXT[run.status]} />
        </View>
        <Text style={styles.title}>{run.label}</Text>
        <Text style={styles.muted}>{directionText[run.direction]} · Trip {run.tripCode} · {STATUS_TEXT[run.status]}</Text>
      </Card>

      <Card style={styles.block}>
        <Line label="Bus" value={run.bus ? `Bus ${run.bus.number} · ${run.bus.plate}` : 'Not assigned'} />
        <Line label="Driver" value={run.driver ? run.driver.name : 'Not assigned'} />
        {run.driver && <Line label="Phone" value={`${run.driver.phone ?? '—'}${run.driver.sharesPhone ? ' (riders can see it)' : ' (hidden from riders)'}`} />}
        {run.status === 'in_progress' && (
          <>
            <Line label="Arrives in" value={live.etaMinutes != null ? `${live.etaMinutes} min` : '—'} />
            <Line label="Delay" value={live.delayMinutes > 0 ? `${live.delayMinutes} min` : 'On time'} />
            <Line label="Left at" value={timeOf(run.actualStart)} />
          </>
        )}
        {run.status === 'completed' && <Line label="Arrived at" value={timeOf(run.actualEnd)} />}
      </Card>

      <ErrorText message={error} />
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {notStarted && !editing && (
        <View style={styles.block}>
          <Button title="Change driver or bus" kind="outline" onPress={openEditor} />
          <View style={{ height: 10 }} />
          <Button title="Cancel trip" kind="danger" onPress={cancelTrip} busy={busy === 'cancel'} />
        </View>
      )}

      {notStarted && editing && (
        <Card style={styles.block}>
          <Text style={styles.section}>Driver</Text>
          <View style={styles.choices}>
            {drivers.map((d) => (
              <Choice key={d.id} label={d.name} on={driverId === d.id} onPress={() => setDriverId(d.id)} />
            ))}
          </View>
          <Text style={styles.section}>Bus</Text>
          <View style={styles.choices}>
            {buses.map((b) => (
              <Choice
                key={b.id}
                label={`Bus ${b.busNumber}${b.status !== 'active' ? ' (maintenance)' : ''}`}
                on={busId === b.id}
                disabled={b.status !== 'active'}
                onPress={() => setBusId(b.id)}
              />
            ))}
          </View>
          <Text style={styles.section}>Reason (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. driver is sick"
            placeholderTextColor={colors.muted}
            value={reason}
            onChangeText={setReason}
            maxLength={300}
          />
          <View style={styles.row2}>
            <Button small title="Back" kind="outline" onPress={() => { setEditing(false); setError(''); }} />
            <View style={{ width: 10 }} />
            <Button small title="Save" onPress={saveAssignment} busy={busy === 'save'} />
          </View>
        </Card>
      )}

      {!notStarted && (
        <Text style={styles.hint}>
          {run.status === 'in_progress' ? 'A trip on the road cannot be re-assigned or cancelled.' : 'This trip is closed.'}
        </Text>
      )}
    </ScrollView>
  );
}

function Line({ label, value }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

function Choice({ label, on, disabled, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.choice, on && styles.choiceOn, disabled && { opacity: 0.4 }]}
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled }}
    >
      <Text style={[styles.choiceText, on && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40 },
  back: { color: colors.primary, fontWeight: '600', fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center' },
  row2: { flexDirection: 'row', marginTop: 14 },
  time: { fontSize: 34, fontWeight: '700', color: colors.text, marginRight: 12 },
  title: { fontSize: 17, fontWeight: '600', color: colors.text, marginTop: 4 },
  muted: { fontSize: 14, color: colors.muted, marginTop: 2 },
  block: { marginTop: 16 },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 },
  lineLabel: { fontSize: 14, color: colors.muted },
  lineValue: { fontSize: 14, color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  message: { color: colors.good, marginTop: 10, fontSize: 14 },
  hint: { fontSize: 13, color: colors.muted, marginTop: 16, textAlign: 'center' },
  section: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 6, marginBottom: 6 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  choice: { borderWidth: 1, borderColor: colors.primary, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, marginRight: 8, marginBottom: 8 },
  choiceOn: { backgroundColor: colors.primary },
  choiceText: { color: colors.primary, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, color: colors.text },
});
