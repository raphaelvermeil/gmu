import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { theme } from '../../components/theme';
import { useCreateListing } from './queries';

// Step one: a title creates a draft. The rest is filled in on the listing screen.
export function NewListingScreen() {
  const router = useRouter();
  const create = useCreateListing();
  const [title, setTitle] = useState('');

  return (
    <Screen title="List an item">
      <TextField
        label="Title"
        value={title}
        onChangeText={setTitle}
        placeholder="4-person tent, 2 kayaks, winter camping kit…"
        maxLength={100}
      />
      <Button
        title="Create draft"
        busy={create.isPending}
        disabled={!title.trim()}
        onPress={() =>
          create.mutate(
            { title: title.trim() },
            {
              onSuccess: (listing) =>
                router.replace({ pathname: '/listings/[id]', params: { id: listing.id } }),
            },
          )
        }
      />
      {create.isError ? <Text style={styles.error}>{create.error.message}</Text> : null}
      <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({ error: { color: theme.color.danger } });
