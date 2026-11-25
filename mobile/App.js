import { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './src/api';
import { useFonts } from 'expo-font';
// Only the four weights the brand guide uses, so the other font files are not bundled
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold';
// Arabic text (driver screens in Arabic) uses Cairo in the same weights
import { Cairo_500Medium } from '@expo-google-fonts/cairo/500Medium';
import { Cairo_600SemiBold } from '@expo-google-fonts/cairo/600SemiBold';
import { Cairo_700Bold } from '@expo-google-fonts/cairo/700Bold';
import { Cairo_800ExtraBold } from '@expo-google-fonts/cairo/800ExtraBold';
import { ThemeProvider, useTheme } from './src/theme';
import { LangProvider, useLang } from './src/i18n';
import { Button, ErrorText, T } from './src/components/ui';
import LoginScreen from './src/screens/LoginScreen';
import TimetableScreen from './src/screens/TimetableScreen';
import TripScreen from './src/screens/TripScreen';
import DriverHomeScreen from './src/screens/DriverHomeScreen';
import DriverTripScreen from './src/screens/DriverTripScreen';
import AdminHomeScreen from './src/screens/AdminHomeScreen';
import AdminTripScreen from './src/screens/AdminTripScreen';
import { useRiderAlerts } from './src/useRiderAlerts';

const SESSION_KEY = 'giu-session';
const lineKey = (userId) => `giu-line:${userId}`;

export default function App() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
    Cairo_500Medium, Cairo_600SemiBold, Cairo_700Bold, Cairo_800ExtraBold,
  });
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        {fontsLoaded ? <Main /> : <View style={{ flex: 1, backgroundColor: '#121212' }} />}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Main() {
  const { t } = useTheme();
  const [session, setSession] = useState(null); // { token, user }
  const [routes, setRoutes] = useState(null);   // every line with its path and stops, by id, loaded once after login
  const [lineId, setLineId] = useState(null);   // the line the rider is looking at
  const [openRun, setOpenRun] = useState(null); // the trip the rider or driver is looking at
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState('');

  // Riders get a phone notification when the bus is the chosen minutes from their stop (FR4)
  useRiderAlerts(session);

  // Stay logged in between app starts (the token is valid for 12 hours)
  useEffect(() => {
    AsyncStorage.getItem(SESSION_KEY)
      .then((saved) => saved && setSession(JSON.parse(saved)))
      .finally(() => setStarting(false));
  }, []);

  useEffect(() => {
    if (!session) return;
    // Loaded in the background: the timetable shows at once, the map needs the lines a moment later
    (async () => {
      const { routes: list } = await api('/routes', { token: session.token });
      const full = await Promise.all(list.map((l) => api(`/route?id=${l.id}`, { token: session.token })));
      const byId = Object.fromEntries(full.map((r) => [r.id, r]));
      const saved = Number(await AsyncStorage.getItem(lineKey(session.user.id)).catch(() => null));
      setLineId(byId[saved] ? saved : full[0]?.id ?? null);
      setRoutes(byId);
    })()
      .catch((e) => {
        if (e.status === 401) logout(); // the saved login has expired
        else setError(e.message);
      });
  }, [session]);

  function login(newSession) {
    AsyncStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    setSession(newSession);
  }

  function logout() {
    AsyncStorage.removeItem(SESSION_KEY);
    setSession(null);
    setRoutes(null);
    setLineId(null);
    setOpenRun(null);
    setError('');
  }

  function chooseLine(id) {
    setLineId(id);
    AsyncStorage.setItem(lineKey(session.user.id), String(id)).catch(() => {});
  }

  // The line of the open trip (each trip belongs to one line)
  const route = routes ? (routes[openRun?.routeId] ?? routes[lineId] ?? Object.values(routes)[0] ?? null) : null;
  const lines = routes ? Object.values(routes).map((r) => ({ id: r.id, name: r.name })) : [];
  const allStops = routes ? Object.values(routes).flatMap((r) => r.stops) : [];

  let screen;
  if (starting) {
    screen = <Centered><ActivityIndicator color={t.gold} /></Centered>;
  } else if (!session) {
    screen = <LoginScreen onLoggedIn={login} />;
  } else if (session.user.role === 'driver') {
    screen = openRun
      ? <DriverTripScreen session={session} route={route} run={openRun} onBack={() => setOpenRun(null)} />
      : <DriverHomeScreen session={session} onOpenTrip={setOpenRun} onLogout={logout} />;
  } else if (session.user.role === 'admin') {
    screen = openRun
      ? <AdminTripScreen session={session} run={openRun} onBack={() => setOpenRun(null)} />
      : <AdminHomeScreen session={session} onOpenTrip={setOpenRun} onLogout={logout} />;
  } else if (session.user.role !== 'rider') {
    screen = (
      <Centered>
        <T v="title1" style={{ marginBottom: 8 }}>Hi, {session.user.name}</T>
        <T color={t.muted} style={{ textAlign: 'center', marginBottom: 20 }}>The {session.user.role} screens are not built yet. Log in with a student account to try the rider app.</T>
        <Button title="Log out" onPress={logout} />
      </Centered>
    );
  } else if (error && !route) {
    screen = (
      <Centered>
        <ErrorText message={error} />
        <View style={{ marginTop: 16 }}><Button title="Log out" kind="secondary" onPress={logout} /></View>
      </Centered>
    );
  } else if (openRun && !route) {
    screen = <Centered><ActivityIndicator color={t.gold} /></Centered>;
  } else if (openRun) {
    screen = <TripScreen session={session} route={route} run={openRun} onBack={() => setOpenRun(null)} />;
  } else {
    screen = (
      <TimetableScreen
        session={session}
        stops={allStops}
        lines={lines}
        lineId={lineId}
        onChooseLine={chooseLine}
        onOpenTrip={setOpenRun}
        onLogout={logout}
      />
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
      <StatusBar barStyle={t.mode === 'night' ? 'light-content' : 'dark-content'} backgroundColor={t.surface} />
      <LangProvider role={session?.user.role}>
        <Directed>{screen}</Directed>
      </LangProvider>
    </SafeAreaView>
  );
}

/** Lays the screen out right to left when it is shown in Arabic */
function Directed({ children }) {
  const { rtl } = useLang();
  return <View style={{ flex: 1, direction: rtl ? 'rtl' : 'ltr' }}>{children}</View>;
}

function Centered({ children }) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>{children}</View>;
}
