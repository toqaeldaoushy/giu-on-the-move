import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../api';
import { API_URL } from '../config';
import { colors } from '../theme';
import { Button, ErrorText } from '../components/ui';

export default function LoginScreen({ onLoggedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const { token, user } = await api('/auth/login', { method: 'POST', body: { username: username.trim(), password } });
      onLoggedIn({ token, user });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.inner}>
        <Text style={styles.logo}>🚌</Text>
        <Text style={styles.title}>GIU on the Move</Text>
        <Text style={styles.subtitle}>Live shuttle tracking</Text>

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. student01"
          returnKeyType="next"
        />
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <ErrorText message={error} />
        <View style={{ height: 16 }} />
        <Button title="Log in" onPress={submit} busy={busy} disabled={!username || !password} />
        <Text style={styles.server}>Server: {API_URL}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  logo: { fontSize: 48, textAlign: 'center' },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center', color: colors.primary },
  subtitle: { fontSize: 16, textAlign: 'center', color: colors.muted, marginBottom: 32 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  server: { marginTop: 24, textAlign: 'center', color: colors.muted, fontSize: 12 },
});
