import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { BusFront, ChevronLeft, ChevronRight, Clock, MapPin } from 'lucide-react-native';
import { api } from '../api';
import { directionText, space, useTheme } from '../theme';
import { Card, ErrorText, Header, HeroCard, SectionLabel, StatusBadge, T, TripRow } from '../components/ui';
import ProfileMenu from '../components/ProfileMenu';
import { useLang } from '../i18n';

// What the driver sees on each trip card
const statusText = {
  scheduled: 'Not started',
  in_progress: 'On the road',
  completed: 'Finished',
  cancelled: 'Cancelled',
};
const badgeLabel = {
  scheduled: 'Not started',
  in_progress: 'On time',
  completed: 'Arrived',
  cancelled: 'Cancelled',
};

/** The driver's home: the trips assigned to this driver today. */
export default function DriverHomeScreen({ session, onOpenTrip, onLogout }) {
  const { token, user } = session;
  const { t } = useTheme();
  const { tr, rtl } = useLang();
  const Next = rtl ? ChevronLeft : ChevronRight;
  const [menu, setMenu] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api('/driver/runs', { token }));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [token]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000); // an administrator may re-assign a trip at any time
    return () => clearInterval(timer);
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const runs = data?.runs ?? [];
  // A trip already on the road comes first, otherwise the next one that has not started
  const current = runs.find((r) => r.status === 'in_progress') ?? runs.find((r) => r.status === 'scheduled');

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <Header title={tr('Hi, {name}', { name: user.name })} subtitle={`${tr('Driver')}${data ? ` · ${data.date}` : ''}`} onProfile={() => setMenu(true)} />
      <ScrollView
        contentContainerStyle={{ padding: space.xl, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.gold} />}
      >
        <ErrorText message={error} />

        {current && (
          <Pressable onPress={() => onOpenTrip(current)} accessibilityRole="button">
            <HeroCard style={{ marginTop: space.s }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <T v="label" color={t.onHeroMuted} style={{ flex: 1 }}>{tr(current.status === 'in_progress' ? 'Trip on the road' : 'Your next trip')}</T>
                <StatusBadge label={badgeLabel[current.status]} />
              </View>
              <T v="display" color={t.onHero} style={{ marginTop: space.s }}>{current.scheduledTime}</T>
              <T v="title2" color={t.onHero}>{tr(current.label)}</T>
              <T v="caption" color={t.onHeroMuted} style={{ marginTop: 2 }}>
                {tr(directionText[current.direction])} · {current.bus ? `${tr('Bus {number}', { number: current.bus.number })} (${current.bus.plate})` : tr('No bus assigned yet')}
              </T>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: space.l }}>
                <T v="strong" color={t.onHero}>{tr(current.status === 'in_progress' ? 'Open trip' : 'Open and start')}</T>
                <Next size={20} color={t.onHero} />
              </View>
            </HeroCard>
          </Pressable>
        )}

        {data && runs.length === 0 && (
          <Card style={{ marginTop: space.s }}><T color={t.muted}>{tr('You have no trips assigned today. Pull down to check again.')}</T></Card>
        )}

        {runs.length > 0 && <SectionLabel>{tr('My trips today')}</SectionLabel>}
        {runs.map((run) => (
          <TripRow
            key={run.id}
            time={run.scheduledTime}
            title={tr(run.label)}
            badge={badgeLabel[run.status]}
            onPress={() => onOpenTrip(run)}
            lines={[
              { icon: MapPin, text: tr(directionText[run.direction]) },
              { icon: BusFront, text: run.bus ? tr('Bus {number}', { number: run.bus.number }) : tr('No bus assigned yet') },
              { icon: Clock, text: run.timeChange ? tr('New time (usually {time})', { time: run.timeChange.usualTime }) : tr(statusText[run.status]), color: run.timeChange ? t.goldText : undefined },
            ]}
          />
        ))}
      </ScrollView>
      <ProfileMenu visible={menu} user={user} onClose={() => setMenu(false)} onLogout={onLogout} />
    </View>
  );
}
