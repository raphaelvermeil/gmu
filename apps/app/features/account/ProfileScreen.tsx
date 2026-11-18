import { updateMeSchema, type Me, type UpdateMe } from '@gear/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Image, StyleSheet, Text } from 'react-native';
import { Button } from '../../components/Button';
import { ErrorState, Loading, Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { theme } from '../../components/theme';
import { useConfirmPhone, useMe, useUpdateMe, useUploadAvatar } from './queries';
import { sendPhoneCode, signOut, verifyPhoneCode } from './sign-in';

export function ProfileScreen() {
  const me = useMe();
  if (me.isPending) return <Loading />;
  if (me.isError) {
    return <ErrorState message="Could not load your profile." onRetry={() => me.refetch()} />;
  }
  return (
    <Screen title="Your profile">
      <AvatarSection me={me.data} />
      <DisplayNameForm me={me.data} />
      <PhoneSection me={me.data} />
      <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}

// G2.14: the photo shows once the check passes.
function AvatarSection({ me }: { me: Me }) {
  const upload = useUploadAvatar();
  return (
    <>
      {me.avatar_url ? (
        <Image source={{ uri: me.avatar_url }} style={styles.avatar} accessibilityLabel="Your photo" />
      ) : null}
      <Button
        title={me.avatar_url ? 'Change photo' : 'Add a photo'}
        variant="secondary"
        busy={upload.isPending}
        onPress={() => upload.mutate()}
      />
      {upload.isPending ? <Text style={styles.muted}>Checking your photo…</Text> : null}
      {upload.data === false ? (
        <Text style={styles.error}>
          That photo was not accepted. Use a JPEG under 5 MB with no location data.
        </Text>
      ) : null}
      {upload.isError ? <Text style={styles.error}>{upload.error.message}</Text> : null}
    </>
  );
}

function DisplayNameForm({ me }: { me: Me }) {
  const update = useUpdateMe();
  const form = useForm<UpdateMe>({
    resolver: zodResolver(updateMeSchema),
    defaultValues: { display_name: me.display_name ?? '' },
  });

  return (
    <>
      <Controller
        control={form.control}
        name="display_name"
        render={({ field, fieldState }) => (
          <TextField
            label="Display name"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
          />
        )}
      />
      <Button
        title="Save"
        busy={update.isPending}
        onPress={form.handleSubmit((values) => update.mutate(values))}
      />
      {update.isError ? <Text style={styles.error}>{update.error.message}</Text> : null}
      {update.isSuccess ? <Text style={styles.muted}>Saved.</Text> : null}
    </>
  );
}

function PhoneSection({ me }: { me: Me }) {
  const confirm = useConfirmPhone();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (me.phone_verified_at) {
    return <Text style={styles.muted}>Phone number verified.</Text>;
  }

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
    <>
      <Text style={styles.heading}>Verify your phone number</Text>
      {!sent ? (
        <>
          <TextField
            label="Phone number, with country code"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+1 514 555 0100"
          />
          <Button
            title="Text me a code"
            busy={busy}
            disabled={!phone.trim()}
            onPress={() =>
              run(async () => {
                await sendPhoneCode(phone.trim());
                setSent(true);
              })
            }
          />
        </>
      ) : (
        <>
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
            title="Verify"
            busy={busy || confirm.isPending}
            disabled={code.length !== 6}
            onPress={() =>
              run(async () => {
                await verifyPhoneCode(phone.trim(), code);
                await confirm.mutateAsync();
              })
            }
          />
        </>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text },
  muted: { color: theme.color.muted },
  error: { color: theme.color.danger },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: theme.color.surface },
});
