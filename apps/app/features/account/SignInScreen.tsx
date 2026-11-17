import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { theme } from '../../components/theme';
import { sendEmailCode, verifyEmailCode } from './sign-in';

type Step = { kind: 'email' } | { kind: 'code'; email: string };

export function SignInScreen() {
  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Sign in">
      {step.kind === 'email' ? (
        <>
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
          />
          <Button
            title="Email me a code"
            busy={busy}
            disabled={!email.trim()}
            onPress={() =>
              run(async () => {
                await sendEmailCode(email.trim());
                setStep({ kind: 'code', email: email.trim() });
              })
            }
          />
        </>
      ) : (
        <>
          <Text style={styles.hint}>We sent a 6-digit code to {step.email}.</Text>
          <TextField
            label="Code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
          />
          <Button
            title="Sign in"
            busy={busy}
            disabled={code.length !== 6}
            onPress={() => run(() => verifyEmailCode(step.email, code))}
          />
          <Button
            title="Use another email"
            variant="secondary"
            disabled={busy}
            onPress={() => {
              setCode('');
              setStep({ kind: 'email' });
            }}
          />
        </>
      )}
      {error ? (
        <View accessibilityLiveRegion="polite">
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: theme.color.muted, fontSize: theme.font.body },
  error: { color: theme.color.danger },
});
