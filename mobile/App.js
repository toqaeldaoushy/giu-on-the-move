import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './src/api';
import { colors } from './src/theme';
import { Button, ErrorText } from './src/components/ui';
import LoginScreen from './src/screens/LoginScreen';
import TimetableScreen from './src/screens/TimetableScreen';
import TripScreen from './src/screens/TripScreen';
import DriverHomeScreen from './src/screens/DriverHomeScreen';
import DriverTripScreen from './src/screens/DriverTripScreen';

const SESSION_KEY = 'giu-session';

export default function App() {
  const [session, setSession] = useState(null); // { token, user }
  const [route, setRoute] = useState(null);     // the route line and stops, loaded once after login
  const [openRun, setOpenRun] = useState(null); // the trip the rider or driver is looking at
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState('');

  // Stay logged in between app starts (the token is valid for 12 hours)
  useEffect(() => {
    AsyncStorage.getItem(SESSION_KEY)
      .then((saved) => saved && setSession(JSON.parse(saved)))
      .finally(() => setStarting(false));
  }, []);

  useEffect(() => {
    if (!session || session.user.role !== 'rider') return;
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
    screen = <Centered><ActivityIndicator color={colors.primary} /></Centered>;
  } else if (!session) {
    screen = <LoginScreen onLoggedIn={login} />;
  } else if (session.user.role === 'driver') {
    screen = openRun
      ? <DriverTripScreen session={session} run={openRun} onBack={() => setOpenRun(null)} />
      : <DriverHomeScreen session={session} onOpenTrip={setOpenRun} onLogout={logout} />;
  } else if (session.user.role !== 'rider') {
    screen = (
      <Centered>
        <Text style={styles.title}>Hi, {session.user.name}</Text>
        <Text style={styles.text}>The {session.user.role} screens are not built yet. Log in with a student account to try the rider app.</Text>
        <Button title="Log out" onPress={logout} />
      </Centered>
    );
  } else if (!route) {
    screen = (
      <Centered>
        {error ? <ErrorText message={error} /> : <ActivityIndicator color={colors.primary} />}
        {error ? <View style={{ marginTop: 16 }}><Button title="Log out" kind="outline" onPress={logout} /></View> : null}
      </Centered>
    );
  } else if (openRun) {
    screen = <TripScreen session={session} route={route} run={openRun} onBack={() => setOpenRun(null)} />;
  } else {
    screen = <TimetableScreen session={session} stops={route.stops} onOpenTrip={setOpenRun} onLogout={logout} />;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        {screen}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Centered({ children }) {
  return <View style={styles.centered}>{children}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 8 },
  text: { fontSize: 15, color: colors.muted, textAlign: 'center', marginBottom: 20 },
});
