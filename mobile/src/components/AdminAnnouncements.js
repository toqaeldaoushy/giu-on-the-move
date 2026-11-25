import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { Megaphone, Send } from 'lucide-react-native';
import { api } from '../api';
import { radius, space, useTheme } from '../theme';
import { Button, Card, ErrorText, Field, SectionLabel, T } from './ui';

const timeOf = (stamp) => (stamp ? String(stamp).slice(11, 16) : '');
const dayOf = (stamp) => (stamp ? String(stamp).slice(0, 10) : '');

/**
 * Short messages from the transportation office to riders (a road closure, a late bus...).
 * Riders get a phone notification and see the message on their timetable for 24 hours,
 * unless the office takes it down earlier.
 */
export default function AdminAnnouncements({ token }) {
  const { t } = useTheme();
  const [list, setList] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setList((await api('/admin/announcements', { token })).announcements);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function send() {
    const text = message.trim();
    if (!text) { setError('Write a message first'); return; }
    Alert.alert('Send to all riders?', text, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send',
        onPress: async () => {
          setBusy(true);
          setError('');
          try {
            await api('/admin/announcements', { token, method: 'POST', body: { message: text } });
            setMessage('');
            await load();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function end(a) {
    try {
      await api(`/admin/announcements/${a.id}/end`, { token, method: 'POST' });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <View>
      <T v="caption" color={t.muted} style={{ marginBottom: space.s }}>
        Riders get a phone notification and see the message on their timetable for 24 hours, or until you take it down.
      </T>
      <Field
        label={`Message (${message.length}/300)`}
        value={message}
        onChangeText={setMessage}
        placeholder="e.g. Bus 04 leaves 10 minutes late because of road works"
        maxLength={300}
        multiline
      />
      <ErrorText message={error} />
      <Button title="Send to all riders" icon={Send} onPress={send} busy={busy} disabled={!message.trim()} style={{ marginTop: space.m }} />

      <SectionLabel>Recent announcements</SectionLabel>
      {list && list.length === 0 && <Card><T color={t.muted}>No announcements yet.</T></Card>}
      {(list ?? []).map((a) => (
        <Card key={a.id} style={{ marginBottom: space.m }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.input, backgroundColor: a.active ? t.goldTint : t.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Megaphone size={20} color={a.active ? t.goldText : t.muted} />
            </View>
            <View style={{ flex: 1, marginLeft: space.m }}>
              <T v="body">{a.message}</T>
              <T v="caption" color={a.active ? t.green : t.muted} style={{ marginTop: 2 }}>
                {dayOf(a.createdAt)} · {timeOf(a.createdAt)} · {a.active ? 'Showing to riders' : a.endedAt ? `Taken down at ${timeOf(a.endedAt)}` : 'Ended after 24 hours'}
              </T>
            </View>
          </View>
          {a.active && <Button small title="Take down" kind="secondary" onPress={() => end(a)} style={{ marginTop: space.m, flex: 0 }} />}
        </Card>
      ))}
    </View>
  );
}
