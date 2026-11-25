// The shared parts every screen is built from (brand guide, section 5).
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronLeft, ChevronRight, CircleUser } from 'lucide-react-native';
import { radius, space, statusColors, type, useStyles, useTheme } from '../theme';
import { m, useLang } from '../i18n';

// Plus Jakarta Sans has no Arabic letters, so Arabic text uses Cairo in the same weight
const ARABIC_FONT = {
  PlusJakartaSans_500Medium: 'Cairo_500Medium',
  PlusJakartaSans_600SemiBold: 'Cairo_600SemiBold',
  PlusJakartaSans_700Bold: 'Cairo_700Bold',
  PlusJakartaSans_800ExtraBold: 'Cairo_800ExtraBold',
};

/** For Arabic: the Cairo font, right-to-left writing and (unless the style says otherwise) right alignment */
export function useTextDir() {
  const { rtl } = useLang();
  return (style, { align = true } = {}) => {
    if (!rtl) return style;
    const flat = StyleSheet.flatten(style) ?? {};
    return [style, {
      fontFamily: ARABIC_FONT[flat.fontFamily] ?? 'Cairo_500Medium',
      writingDirection: 'rtl',
      letterSpacing: 0,
      textTransform: 'none',
      // Cairo is taller than Plus Jakarta Sans: without more line height the tops of letters and digits are cut off
      ...(flat.lineHeight ? { lineHeight: Math.round((flat.fontSize ?? 15) * 1.5) } : {}),
      // Inside a right-to-left layout the phone swaps left and right, so 'left' puts the text on the right.
      // The web preview does not swap, so it needs 'right'.
      ...(align && !flat.textAlign ? { textAlign: Platform.OS === 'web' ? 'right' : 'left' } : {}),
    }];
  };
}

/** Text in one of the type styles: <T v="title2">Afternoon departure</T> */
export function T({ v = 'body', color, style, children, ...rest }) {
  const { t } = useTheme();
  const dir = useTextDir();
  return <Text style={dir([type[v], { color: color ?? t.text }, style])} {...rest}>{children}</Text>;
}

export function StatusBadge({ label }) {
  const { t } = useTheme();
  const { tr, rtl } = useLang();
  const dir = useTextDir();
  const c = statusColors(t, label);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: c.bg, borderRadius: radius.pill, paddingHorizontal: 10, height: 26 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.fg, ...m(rtl).end(6) }} />
      <Text style={dir([type.label, { color: c.fg, textTransform: 'none', letterSpacing: 0.2 }], { align: false })}>{tr(label)}</Text>
    </View>
  );
}

/**
 * kind: primary (main action) | accent (gold) | secondary | danger | text
 * icon: a lucide icon component shown before the title
 */
export function Button({ title, onPress, kind = 'primary', disabled, busy, small, icon: Icon, style }) {
  const { t } = useTheme();
  const { rtl } = useLang();
  const dir = useTextDir();
  const look = {
    primary: { bg: t.primary, fg: t.onPrimary, border: t.primary },
    accent: { bg: t.gold, fg: t.onGold, border: t.gold },
    secondary: { bg: t.surface2, fg: t.text, border: t.surface2 },
    outline: { bg: t.surface2, fg: t.text, border: t.surface2 },
    danger: { bg: t.surface, fg: t.red, border: t.red },
    text: { bg: 'transparent', fg: t.goldText, border: 'transparent' },
  }[kind] ?? { bg: t.primary, fg: t.onPrimary, border: t.primary };
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => [
        {
          minHeight: small ? 44 : 56, borderRadius: small ? radius.input : radius.card,
          paddingHorizontal: small ? space.m : space.l, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          backgroundColor: disabled ? t.surface2 : look.bg, borderWidth: kind === 'danger' ? 1.5 : 0,
          borderColor: disabled ? t.surface2 : look.border,
        },
        small && { flex: 1 },
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={look.fg} style={m(rtl).end(8)} /> : Icon ? <Icon size={20} color={disabled ? t.disabled : look.fg} style={m(rtl).end(8)} /> : null}
      <Text style={dir([type.button, small && { fontSize: 14 }, { color: disabled ? t.disabled : look.fg }], { align: false })}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, style }) {
  const s = useStyles((t) => ({
    card: { backgroundColor: t.surface, borderRadius: radius.card, padding: space.l, borderWidth: 1, borderColor: t.border },
  }));
  return <View style={[s.card, style]}>{children}</View>;
}

/** The dark card for the next shuttle or the current trip: ink (gold at night) with a gold line on the left */
export function HeroCard({ children, style }) {
  const { t } = useTheme();
  const { rtl } = useLang();
  const s = useStyles((t) => ({
    card: { backgroundColor: t.hero, borderRadius: radius.card, padding: space.l + 4, overflow: 'hidden' },
    line: { position: 'absolute', top: 0, bottom: 0, width: 5, backgroundColor: t.gold },
  }));
  // At night the card itself is gold, so the gold line is left out
  return <View style={[s.card, style]}>{t.mode === 'night' ? null : <View style={[s.line, rtl ? { right: 0 } : { left: 0 }]} />}{children}</View>;
}

/** A small box with an icon, a label and a value (departure time, duration, bus) */
export function Tile({ icon: Icon, label, value, style }) {
  const { t } = useTheme();
  const { rtl } = useLang();
  return (
    <View style={[{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.input, padding: space.m, flexDirection: 'row', alignItems: 'center' }, style]}>
      {Icon && <Icon size={20} color={t.goldText} style={m(rtl).end(10)} />}
      <View style={{ flex: 1 }}>
        <T v="label" color={t.muted}>{label}</T>
        <T v="strong">{value}</T>
      </View>
    </View>
  );
}

/** A pill with the countdown or another short fact; gold by default */
export function Pill({ text, tone = 'gold' }) {
  const { t } = useTheme();
  const dir = useTextDir();
  const c = tone === 'gold' ? { bg: t.gold, fg: t.onGold } : { bg: t.surface2, fg: t.text };
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: c.bg, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 }}>
      <Text style={dir([type.label, { color: c.fg, textTransform: 'none', letterSpacing: 0.2, fontSize: 13 }], { align: false })}>{text}</Text>
    </View>
  );
}

/** The top bar: bus mark + title (or a back arrow), a subtitle, and a profile button on the right */
export function Header({ title = 'GIU on the Move', subtitle, onBack, onProfile, right }) {
  const { t } = useTheme();
  const { rtl, tr } = useLang();
  const BackIcon = rtl ? ChevronRight : ChevronLeft;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.m, backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.border }}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={tr('Back')} style={m(rtl).end(space.m)}>
          <BackIcon size={28} color={t.text} />
        </Pressable>
      ) : (
        <Logo width={100} style={{ ...m(rtl).end(space.m), ...m(rtl).start(-4) }} />
      )}
      <View style={{ flex: 1 }}>
        <T v="title2" numberOfLines={1}>{title}</T>
        {subtitle ? <T v="caption" color={t.muted} numberOfLines={1}>{subtitle}</T> : null}
      </View>
      {right}
      {onProfile && (
        <Pressable onPress={onProfile} hitSlop={12} accessibilityRole="button" accessibilityLabel={tr('Profile and settings')}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', ...m(rtl).start(space.s) }}>
          <CircleUser size={22} color={t.text} />
        </Pressable>
      )}
    </View>
  );
}

/** Segmented tabs, e.g. All trips / To campus / From campus */
export function Segmented({ options, value, onChange }) {
  const { t } = useTheme();
  const dir = useTextDir();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: radius.input, padding: 4 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center', backgroundColor: on ? t.surface : 'transparent' }}>
            <Text style={dir([type.caption, { fontFamily: type.strong.fontFamily, color: on ? t.text : t.muted }], { align: false })}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SectionLabel({ children, style }) {
  const { t } = useTheme();
  return <T v="label" color={t.muted} style={[{ marginTop: space.xxl, marginBottom: space.s }, style]}>{children}</T>;
}

export function ErrorText({ message }) {
  const { t } = useTheme();
  const { tr } = useLang();
  if (!message) return null;
  return (
    <View style={{ backgroundColor: t.redTint, borderRadius: radius.input, padding: space.m, marginTop: space.m }}>
      <T v="caption" color={t.red}>{tr(message)}</T>
    </View>
  );
}

/** The full logo (light or night version) */
export function Logo({ width = 220, style }) {
  const { t } = useTheme();
  const src = t.mode === 'night' ? require('../../assets/logo-night.png') : require('../../assets/logo.png');
  return <Image source={src} style={[{ width, height: width / 2.8, resizeMode: 'contain', alignSelf: 'center' }, style]} accessibilityLabel="GIU on the Move" />;
}

/** A labelled text field */
export function Field({ label, style, ...inputProps }) {
  const { t } = useTheme();
  return (
    <View style={style}>
      <T v="label" color={t.muted} style={{ marginBottom: 6, marginTop: space.m }}>{label}</T>
      <TextInput
        placeholderTextColor={t.disabled}
        selectionColor={t.gold}
        keyboardAppearance={t.mode === 'night' ? 'dark' : 'light'}
        style={[type.body, { color: t.text, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: radius.input, paddingHorizontal: 14 }, inputProps.multiline ? { minHeight: 96, paddingTop: 12, paddingBottom: 12, textAlignVertical: 'top' } : { height: 52 }]}
        {...inputProps}
      />
    </View>
  );
}

/** One trip in a list: time box, title, up to a few info lines with icons, and a status badge */
export function TripRow({ time, title, lines = [], badge, onPress }) {
  const { t } = useTheme();
  const { rtl } = useLang();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ backgroundColor: t.surface2, borderRadius: radius.input, paddingHorizontal: 10, paddingVertical: 8, minWidth: 68, alignItems: 'center' }}>
        <T v="title2" style={{ fontVariant: ['tabular-nums'] }}>{time}</T>
      </View>
      <View style={{ flex: 1, ...m(rtl).start(space.m) }}>
        <T v="strong" numberOfLines={1}>{title}</T>
        {lines.filter((l) => l && l.text).map((l, i) => {
          const Icon = l.icon;
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              {Icon && <Icon size={14} color={l.color ?? t.muted} />}
              <T v="caption" color={l.color ?? t.muted} style={{ ...m(rtl).start(Icon ? 4 : 0), flex: 1 }} numberOfLines={1}>{l.text}</T>
            </View>
          );
        })}
        {badge ? <View style={{ marginTop: space.s }}><StatusBadge label={badge} /></View> : null}
      </View>
    </View>
  );
  const card = { backgroundColor: t.surface, borderRadius: radius.card, padding: space.l, borderWidth: 1, borderColor: t.border, marginBottom: space.m };
  if (!onPress) return <View style={card}>{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [card, pressed && { opacity: 0.8 }]}>
      {body}
    </Pressable>
  );
}

/** Seat availability as the driver reported it: text and colour */
export const SEATS = {
  seats: { label: 'Seats available', tone: 'green' },
  few: { label: 'A few seats left', tone: 'gold' },
  full: { label: 'Bus is full', tone: 'red' },
};
export function seatsColor(t, level) {
  return { green: t.green, gold: t.goldText, red: t.red }[SEATS[level]?.tone] ?? t.muted;
}
