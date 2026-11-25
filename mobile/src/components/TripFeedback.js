import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Star } from 'lucide-react-native';
import { api } from '../api';
import { radius, space, type, useTheme } from '../theme';
import { Button, Card, ErrorText, T } from './ui';

const WORDS = ['', 'Very bad', 'Bad', 'Okay', 'Good', 'Very good'];

/** After the bus has arrived, the rider rates the trip (1 to 5 stars and an optional comment). */
export default function TripFeedback({ token, runId }) {
  const { t } = useTheme();
  const [saved, setSaved] = useState(null);     // the rating already sent
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/runs/${runId}/feedback`, { token })
      .then(({ feedback }) => {
        if (feedback) {
          setSaved(feedback);
          setRating(feedback.rating);
          setComment(feedback.comment ?? '');
          setEditing(false);
        }
      })
      .catch(() => {});
  }, [runId, token]);

  async function send() {
    setBusy(true);
    setError('');
    try {
      const { feedback } = await api(`/runs/${runId}/feedback`, { token, method: 'POST', body: { rating, comment } });
      setSaved(feedback);
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const stars = (value, onPick) => (
    <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.s }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={onPick ? () => onPick(n) : undefined} disabled={!onPick} hitSlop={6}
          accessibilityRole={onPick ? 'button' : undefined} accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}>
          <Star size={32} color={t.gold} fill={n <= value ? t.gold : 'transparent'} />
        </Pressable>
      ))}
    </View>
  );

  if (!editing && saved) {
    return (
      <Card>
        <T v="strong">Thank you for your rating</T>
        {stars(saved.rating)}
        {saved.comment ? <T v="caption" color={t.muted} style={{ marginTop: space.s }}>"{saved.comment}"</T> : null}
        <Button small title="Change my rating" kind="text" onPress={() => setEditing(true)} style={{ marginTop: space.s, flex: 0, alignSelf: 'flex-start', paddingHorizontal: 0 }} />
      </Card>
    );
  }

  return (
    <Card>
      <T v="strong">How was this trip?</T>
      <T v="caption" color={t.muted}>Your rating helps the transportation office see what works.</T>
      {stars(rating, setRating)}
      {rating > 0 && <T v="caption" color={t.goldText} style={{ marginTop: 4 }}>{WORDS[rating]}</T>}
      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder="Comment (optional), e.g. the bus was clean"
        placeholderTextColor={t.disabled}
        maxLength={300}
        multiline
        style={[type.body, { color: t.text, backgroundColor: t.surface2, borderRadius: radius.input, padding: space.m, minHeight: 72, marginTop: space.m, textAlignVertical: 'top' }]}
      />
      <ErrorText message={error} />
      <Button title="Send rating" onPress={send} busy={busy} disabled={!rating} style={{ marginTop: space.m }} />
    </Card>
  );
}
