import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './src/api';
import { useFonts } from 'expo-font';
// Only the four weights the brand guide uses, so the other font files are not bundled
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold';
import { ThemeProvider, useTheme } from './src/theme';
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

export default function App() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
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
  const [route, setRoute] = useState(null);     // the route line and stops, loaded once after login
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
    // Loaded in the background: the timetable shows at once, the map needs the route a moment later
    api('/route', { token: session.token })
      .then(setRoute)
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
    setRoute(null);
    setOpenRun(null);
    setError('');
  }

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
    screen = <TimetableScreen session={session} stops={route?.stops ?? []} onOpenTrip={setOpenRun} onLogout={logout} />;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
      <StatusBar style={t.statusBar} />
      {screen}
    </SafeAreaView>
  );
}

function Centered({ children }) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>{children}</View>;
}
