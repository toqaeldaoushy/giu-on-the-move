// The look of the app, from the brand guide ("GIU on the Move — Brand & Design Guide"):
// the logo's black, red and gold on a warm off-white, a night mode, one font and one spacing scale.
import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const light = {
  mode: 'light',
  background: '#F7F5F0', surface: '#FFFFFF', surface2: '#EFEBE3', border: '#E4DFD4',
  text: '#1A1A1A', muted: '#5F5B53', disabled: '#A39E94',
  primary: '#1A1A1A', onPrimary: '#FFFFFF',          // main buttons
  hero: '#1A1A1A', onHero: '#FFFFFF', onHeroMuted: '#CFCAC0', // next-shuttle and current-trip card
  gold: '#D4961C', goldText: '#8A5A00', goldTint: '#FBF1DC', onGold: '#1A1A1A',
  red: '#C8202A', redTint: '#FBE7E8',
  blue: '#1F5FA8', blueTint: '#E4EEF9',
  green: '#1E7A46', greenTint: '#E3F3EA',
  shadow: 'rgba(0,0,0,0.08)',
  statusBar: 'dark',
};

const night = {
  mode: 'night',
  background: '#121212', surface: '#1E1E1E', surface2: '#2A2926', border: '#34322D',
  text: '#F3F0E8', muted: '#A8A296', disabled: '#6B675F',
  primary: '#E2A93B', onPrimary: '#121212',
  hero: '#E2A93B', onHero: '#121212', onHeroMuted: '#3A2F17',
  gold: '#E2A93B', goldText: '#E2A93B', goldTint: '#3A2F17', onGold: '#121212',
  red: '#F06A6A', redTint: '#3E1A1C',
  blue: '#6EA8F0', blueTint: '#16273D',
  green: '#4CC38A', greenTint: '#173B29',
  shadow: 'rgba(0,0,0,0)',
  statusBar: 'light',
};

// Colours of the status labels the backend sends (text and badge background); a word always goes with the colour
export function statusColors(t, label) {
  switch (label) {
    case 'On time': return { fg: t.green, bg: t.greenTint };
    case 'Delayed': return { fg: t.mode === 'night' ? '#F0B44C' : '#9A5B00', bg: t.mode === 'night' ? '#3D2E12' : '#FDF0D9' };
    case 'Cancelled': return { fg: t.red, bg: t.redTint };
    case 'On the road': return { fg: t.blue, bg: t.blueTint };
    default: return { fg: t.muted, bg: t.surface2 }; // Not started, Arrived, Finished
  }
}

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 24, xxxl: 32 };
export const radius = { input: 12, card: 16, sheet: 24, pill: 999 };

export const font = {
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

export const type = {
  display: { fontFamily: font.extrabold, fontSize: 40, lineHeight: 46, fontVariant: ['tabular-nums'] },
  title1: { fontFamily: font.bold, fontSize: 24, lineHeight: 30 },
  title2: { fontFamily: font.bold, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: font.medium, fontSize: 15, lineHeight: 22 },
  strong: { fontFamily: font.semibold, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: font.bold, fontSize: 12, lineHeight: 16, letterSpacing: 0.6, textTransform: 'uppercase' },
  caption: { fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  button: { fontFamily: font.bold, fontSize: 16, lineHeight: 20 },
};

export const directionText = { inbound: 'To campus', outbound: 'From campus' };

// ---- Light / night: follows the phone unless the user picked one in the profile menu ----------------
const PREF_KEY = 'giu-theme';
const ThemeContext = createContext({ t: light, pref: 'system', setPref: () => {} });

export function ThemeProvider({ children }) {
  const phone = useColorScheme();             // 'light' | 'dark' | null
  const [pref, setPrefState] = useState('system');
  useEffect(() => { AsyncStorage.getItem(PREF_KEY).then((p) => p && setPrefState(p)).catch(() => {}); }, []);
  const setPref = (p) => { setPrefState(p); AsyncStorage.setItem(PREF_KEY, p).catch(() => {}); };
  const t = (pref === 'night' || (pref === 'system' && phone === 'dark')) ? night : light;
  const value = useMemo(() => ({ t, pref, setPref }), [t, pref]);
  return createElement(ThemeContext.Provider, { value }, children);
}

export const useTheme = () => useContext(ThemeContext);

/** Styles that follow the current mode: const s = useStyles((t) => ({ box: { backgroundColor: t.surface } })) */
export function useStyles(make) {
  const { t } = useTheme();
  return useMemo(() => StyleSheet.create(make(t)), [t]); // eslint-disable-line react-hooks/exhaustive-deps
}
