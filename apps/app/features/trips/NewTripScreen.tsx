import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { theme } from '../../components/theme';
import { useOrigin } from '../search/queries';
import { useCreateTrip } from './queries';
import { TripDates, validDates, type Dates } from './TripDates';

export function NewTripScreen() {
  const router = useRouter();
  const create = useCreateTrip();
  const origin = useOrigin(); // G4.2: optional, so nothing here waits for it
  const [name, setName] = useState('');
  const [dates, setDates] = useState<Dates>({ from: null, to: null });
  const valid = validDates(dates);

  return (
    <Screen title="New trip">
      <TextField label="Name" value={name} onChangeText={setName} maxLength={60} />
      <TripDates value={dates} onChange={setDates} />
      <Text style={styles.muted}>
        {origin.data
          ? 'The trip starts near where you are now, rounded to about 1 km.'
          : 'Without your location, the trip shows no distances.'}
      </Text>
      <Button
        title="Create trip"
        busy={create.isPending}
        disabled={!name.trim() || !valid}
        onPress={() => {
          if (!valid) return;
          create.mutate(
            { name: name.trim(), ...valid, ...(origin.data ? { origin: origin.data } : {}) },
            {
              onSuccess: (trip) =>
                router.replace({ pathname: '/trips/[id]', params: { id: trip.id } }),
            },
          );
        }}
      />
      {create.isError ? <Text style={styles.error}>{create.error.message}</Text> : null}
      <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { color: theme.color.muted, fontSize: theme.font.small },
  error: { color: theme.color.danger },
});
