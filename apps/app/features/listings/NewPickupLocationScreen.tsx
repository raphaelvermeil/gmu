import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Button } from '../../components/Button';
import { Chip, ChipRow } from '../../components/Chip';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { theme } from '../../components/theme';
import { useCreatePickupLocation, useUpdateListing } from './queries';

type Point = { lat: number; lng: number };

// G2.1: the point comes from the device; the address is typed by hand.
// Never log or display the coordinates: they are the owner's exact location.
// Opened from a listing, the new location is attached to that listing once saved.
export function NewPickupLocationScreen({ listingId }: { listingId?: string }) {
  const router = useRouter();
  const create = useCreatePickupLocation();
  const attach = useUpdateListing(listingId ?? '');
  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<Point | null>(null);
  const [precision, setPrecision] = useState<'1km' | '5km'>('1km');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function locate() {
    setLocating(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission is needed to set the pickup point.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setPoint({ lat: position.coords.latitude, lng: position.coords.longitude });
    } catch {
      setError('Could not read your location. Try again outside or near a window.');
    } finally {
      setLocating(false);
    }
  }

  return (
    <Screen title="Add a pickup location">
      <Text style={styles.muted}>
        Stand where renters will pick up your gear. Renters never see the address or this point:
        they see a spot within about 1 km, or 5 km if you prefer.
      </Text>
      <Button
        title={point ? 'Location set. Set it again' : 'Use my current location'}
        variant={point ? 'secondary' : 'primary'}
        busy={locating}
        onPress={() => void locate()}
      />
      <TextField
        label="Address (only you and confirmed renters see it)"
        value={address}
        onChangeText={setAddress}
        autoComplete="street-address"
        maxLength={200}
      />
      <Text style={styles.label}>How close renters see it</Text>
      <ChipRow>
        <Chip
          label="About 1 km"
          selected={precision === '1km'}
          onPress={() => setPrecision('1km')}
        />
        <Chip
          label="About 5 km"
          selected={precision === '5km'}
          onPress={() => setPrecision('5km')}
        />
      </ChipRow>
      <Button
        title="Save location"
        busy={create.isPending || attach.isPending}
        disabled={!point || !address.trim()}
        onPress={() =>
          point &&
          create.mutate(
            { address: address.trim(), lat: point.lat, lng: point.lng, precision },
            {
              onSuccess: async (location) => {
                if (listingId) await attach.mutateAsync({ pickup_location_id: location.id });
                router.back();
              },
            },
          )
        }
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {create.isError ? <Text style={styles.error}>{create.error.message}</Text> : null}
      {attach.isError ? <Text style={styles.error}>{attach.error.message}</Text> : null}
      <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { color: theme.color.muted, fontSize: theme.font.small },
  label: { fontSize: theme.font.small, color: theme.color.muted },
  error: { color: theme.color.danger },
});
