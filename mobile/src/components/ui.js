import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, statusColor } from '../theme';

export function StatusBadge({ label }) {
  const color = statusColor[label] ?? colors.neutral;
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1A`, borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Button({ title, onPress, kind = 'primary', disabled, busy, small }) {
  const filled = kind === 'primary' || kind === 'danger';
  const tint = kind === 'danger' ? colors.danger : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        filled ? { backgroundColor: tint } : { borderColor: tint, borderWidth: 1, backgroundColor: colors.card },
        (disabled || busy) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={filled ? '#fff' : tint} />
      ) : (
        <Text style={[styles.buttonText, small && { fontSize: 14 }, { color: filled ? '#fff' : tint }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function ErrorText({ message }) {
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 13, fontWeight: '600' },
  button: { borderRadius: 10, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  buttonSmall: { paddingVertical: 9, paddingHorizontal: 12, flex: 1 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  error: { color: colors.danger, marginTop: 10, fontSize: 14 },
});
