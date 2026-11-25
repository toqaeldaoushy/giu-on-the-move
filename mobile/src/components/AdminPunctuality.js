import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Star } from 'lucide-react-native';
import { api } from '../api';
import { directionText, radius, space, useTheme } from '../theme';
import { Card, ErrorText, SectionLabel, Segmented, T } from './ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso) => { const [, m, d] = String(iso).slice(0, 10).split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };

/** A number with its label, in a small box */
function Stat({ value, label, color }) {
  const { t } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: radius.input, borderWidth: 1, borderColor: t.border, paddingVertical: 10, alignItems: 'center' }}>
      <T v="title1" color={color ?? t.text}>{value}</T>
      <T v="caption" color={t.muted} style={{ textAlign: 'center' }}>{label}</T>
    </View>
  );
}

/**
 * Punctuality over the last days: on time, late and cancelled for each trip of the timetable, with the same
 * rule as the live "Delayed" label, and what riders said in their ratings.
 */
export default function AdminPunctuality({ token }) {
  const { t } = useTheme();
  const [days, setDays] = useState(7);
  const [rep, setRep] = useState(null);
  const [feedback, setFeedback] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [r, f] = await Promise.all([api(`/admin/punctuality?days=${days}`, { token }), api('/admin/feedback', { token })]);
      setRep(r);
      setFeedback(f.feedback);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [days, token]);

  useEffect(() => { load(); }, [load]);

  const tot = rep?.totals;
  return (
    <View>
      <Segmented
        value={days}
        onChange={setDays}
        options={[{ value: 7, label: 'Last 7 days' }, { value: 30, label: 'Last 30 days' }]}
      />
      <ErrorText message={error} />
      {rep && (
        <>
          <T v="caption" color={t.muted} style={{ marginTop: space.m }}>
            {shortDate(rep.from)} – {shortDate(rep.to)}. Late means the bus arrived more than {rep.lateThresholdMin} min after its
            planned arrival (departure time + {rep.plannedTripMin} min).
          </T>
          <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.m }}>
            <Stat value={tot.onTimeRate != null ? `${tot.onTimeRate}%` : '–'} label="On time" color={t.green} />
            <Stat value={tot.late} label="Late" color={tot.late ? t.goldText : t.text} />
            <Stat value={tot.cancelled} label="Cancelled" color={tot.cancelled ? t.red : t.text} />
          </View>

          <SectionLabel>By trip</SectionLabel>
          {rep.trips.length === 0 && <Card><T color={t.muted}>No finished trips in this period.</T></Card>}
          {rep.trips.map((x) => {
            const arrived = x.onTime + x.late;
            const pct = arrived ? Math.round((x.onTime / arrived) * 100) : null;
            return (
              <Card key={x.tripId} style={{ marginBottom: space.m }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <T v="title2" style={{ minWidth: 64 }}>{x.scheduledTime}</T>
                  <View style={{ flex: 1 }}>
                    <T v="strong" numberOfLines={1}>{x.label}</T>
                    <T v="caption" color={t.muted}>{directionText[x.direction]} · {x.runs} trip{x.runs === 1 ? '' : 's'}</T>
                  </View>
                  {pct != null && <T v="title2" color={pct >= 80 ? t.green : t.goldText}>{pct}%</T>}
                </View>
                {/* on time / late / cancelled as one bar */}
                <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: t.surface2, marginTop: space.m }}>
                  <View style={{ flex: x.onTime, backgroundColor: t.green }} />
                  <View style={{ flex: x.late, backgroundColor: t.gold }} />
                  <View style={{ flex: x.cancelled, backgroundColor: t.red }} />
                </View>
                <T v="caption" color={t.muted} style={{ marginTop: space.s }}>
                  {x.onTime} on time · {x.late} late · {x.cancelled} cancelled
                  {x.averageDelayMin != null ? ` · average ${x.averageDelayMin > 0 ? `${x.averageDelayMin} min late` : x.averageDelayMin < 0 ? `${-x.averageDelayMin} min early` : 'on the minute'}` : ''}
                  {x.worstDelayMin != null && x.worstDelayMin > rep.lateThresholdMin ? ` · worst ${x.worstDelayMin} min late` : ''}
                </T>
                {x.averageRating != null && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <Star size={14} color={t.gold} fill={t.gold} />
                    <T v="caption" color={t.goldText} style={{ marginLeft: 4 }}>
                      {x.averageRating} from {x.ratings} rating{x.ratings === 1 ? '' : 's'}
                    </T>
                  </View>
                )}
              </Card>
            );
          })}

          <SectionLabel>What riders said</SectionLabel>
          {feedback.length === 0 && <Card><T color={t.muted}>No ratings yet. Riders can rate a trip after it arrives.</T></Card>}
          {feedback.map((f) => (
            <Card key={f.id} style={{ marginBottom: space.m }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={14} color={t.gold} fill={n <= f.rating ? t.gold : 'transparent'} />)}
                <T v="caption" color={t.muted} style={{ marginLeft: space.s }}>{shortDate(f.date)} · {f.scheduledTime} {f.label}</T>
              </View>
              {f.comment ? <T v="body" style={{ marginTop: 4 }}>{f.comment}</T> : null}
            </Card>
          ))}
        </>
      )}
    </View>
  );
}
