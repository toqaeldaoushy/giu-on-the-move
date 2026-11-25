import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { LogIn } from 'lucide-react-native';
import { api } from '../api';
import { API_URL } from '../config';
import { space, useTheme } from '../theme';
import { Button, ErrorText, Field, Logo, T } from '../components/ui';

export default function LoginScreen({ onLoggedIn }) {
  const { t } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!username || !password) return;
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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.xxl }} keyboardShouldPersistTaps="handled">
        <Logo width={260} />
        <T v="body" color={t.muted} style={{ textAlign: 'center', marginTop: space.s, marginBottom: space.xxxl }}>
          Live shuttle tracking for GIU
        </T>

        <Field
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. student01"
          returnKeyType="next"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <ErrorText message={error} />
        <View style={{ height: space.xxl }} />
        <Button title="Log in" icon={LogIn} onPress={submit} busy={busy} disabled={!username || !password} />
        <T v="caption" color={t.disabled} style={{ marginTop: space.xxl, textAlign: 'center' }}>Server: {API_URL}</T>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
