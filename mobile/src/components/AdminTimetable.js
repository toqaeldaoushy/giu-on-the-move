import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { CalendarClock, Plus, Trash2 } from 'lucide-react-native';
import { api } from '../api';
import { directionText, radius, space, useTheme } from '../theme';
import { Button, Card, ErrorText, Field, SectionLabel, T } from './ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/**
 * The transportation office changes a trip's time for a period (midterms, Ramadan...).
 * Outside the period the normal timetable applies again by itself.
 */
export default function AdminTimetable({ token }) {
  const { t } = useTheme();
  const [trips, setTrips] = useState([]);
  const [changes, setChanges] = useState(null);
  const [today, setToday] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ tripId: null, newTime: '', fromDate: '', toDate: '', reason: '' });

  const load = useCallback(async () => {
    try {
      const [tr, ch] = await Promise.all([api('/admin/trips', { token }), api('/admin/schedule-changes', { token })]);
      setTrips(tr.trips);
      setChanges(ch.changes);
      setToday(ch.today);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const multiLine = new Set(trips.map((x) => x.routeId)).size > 1;

  function openForm() {
    setForm({ tripId: null, newTime: '', fromDate: today, toDate: '', reason: '' });
    setError('');
    setOpen(true);
  }

  async function save() {
    if (!form.tripId) { setError('Choose the trip to change.'); return; }
    setBusy(true);
    setError('');
    try {
      await api('/admin/schedule-changes', {
        token, method: 'POST',
        body: { ...form, newTime: form.newTime.trim(), fromDate: form.fromDate.trim(), toDate: form.toDate.trim() },
      });
      setOpen(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function remove(c) {
    Alert.alert('Remove this change?', `${c.label} goes back to ${c.usualTime} on these days.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/admin/schedule-changes/${c.id}`, { token, method: 'DELETE' });
            load();
          } catch (e) {
            setError(e.message);
          }
        },
      },
    ]);
  }

  return (
    <View>
      <T v="caption" color={t.muted} style={{ marginBottom: space.m }}>
        Move a trip to another time for a period, for example during midterms or Ramadan. After the last day the usual time comes back by itself.
      </T>

      {!open && <Button title="Change a trip's time" icon={Plus} onPress={openForm} />}

      {open && (
        <Card>
          <T v="title2">Change a trip's time</T>
          <T v="label" color={t.muted} style={{ marginTop: space.m, marginBottom: space.s }}>Trip</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {trips.map((x) => {
              const on = form.tripId === x.id;
              return (
                <Pressable key={x.id} onPress={() => set('tripId')(x.id)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                  style={{ borderWidth: 1, borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primary : t.surface, borderRadius: radius.input, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '100%' }}>
                  <T v="strong" color={on ? t.onPrimary : t.text}>{x.scheduledTime}</T>
                  <T v="caption" color={on ? t.onPrimary : t.muted} numberOfLines={1}>{x.label}</T>
                  {multiLine && <T v="caption" color={on ? t.onPrimary : t.muted} numberOfLines={1}>{x.routeName}</T>}
                </Pressable>
              );
            })}
          </View>
          <Field label="New time (24-hour, e.g. 05:45)" value={form.newTime} onChangeText={set('newTime')} placeholder="05:45" keyboardType="numbers-and-punctuation" maxLength={5} />
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Field style={{ flex: 1 }} label="From" value={form.fromDate} onChangeText={set('fromDate')} placeholder="2026-12-01" maxLength={10} />
            <Field style={{ flex: 1 }} label="To" value={form.toDate} onChangeText={set('toDate')} placeholder="2026-12-15" maxLength={10} />
          </View>
          <Field label="Reason (riders see it)" value={form.reason} onChangeText={set('reason')} placeholder="Midterms" maxLength={200} />
          <ErrorText message={error} />
          <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.l }}>
            <Button small title="Cancel" kind="secondary" onPress={() => { setOpen(false); setError(''); }} />
            <Button small title="Save" onPress={save} busy={busy} />
          </View>
        </Card>
      )}

      {!open && <ErrorText message={error} />}

      <SectionLabel>Current and coming changes</SectionLabel>
      {changes && changes.length === 0 && (
        <Card><T color={t.muted}>No changes. Every trip runs at its usual time.</T></Card>
      )}
      {(changes ?? []).map((c) => (
        <Card key={c.id} style={{ marginBottom: space.m }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.input, backgroundColor: t.goldTint, alignItems: 'center', justifyContent: 'center' }}>
              <CalendarClock size={20} color={t.goldText} />
            </View>
            <View style={{ flex: 1, marginLeft: space.m }}>
              <T v="strong">{c.usualTime} → {c.newTime} · {c.label}</T>
              <T v="caption" color={t.muted}>
                {directionText[c.direction]} · {c.fromDate === c.toDate ? shortDate(c.fromDate) : `${shortDate(c.fromDate)} – ${shortDate(c.toDate)}`}
              </T>
              {c.reason ? <T v="caption" color={t.goldText}>{c.reason}</T> : null}
              {c.fromDate <= today && <T v="caption" color={t.green}>In effect now</T>}
            </View>
            <Pressable onPress={() => remove(c)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Remove change"
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Trash2 size={20} color={t.red} />
            </Pressable>
          </View>
        </Card>
      ))}
    </View>
  );
}
