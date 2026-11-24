import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Chip, ChipRow } from '../../components/Chip';
import { ErrorState, Loading } from '../../components/Screen';
import { theme } from '../../components/theme';
import { useSession } from '../../lib/session';
import { useAddTripItem, useTrip, useTrips } from './queries';
import { TripDates, validDates, type Dates } from './TripDates';

// On a listing page (G4.13). `trip` in the URL preselects that trip.
export function AddToTrip({ listingId }: { listingId: string }) {
  const { session, loading } = useSession();
  if (loading) return null;
  if (!session) {
    return (
      <Link href="/sign-in" style={styles.link}>
        Sign in to add this to a trip
      </Link>
    );
  }
  return <Form listingId={listingId} />;
}

function Form({ listingId }: { listingId: string }) {
  const router = useRouter();
  const { trip: fromUrl } = useLocalSearchParams<{ trip?: string }>();
  const trips = useTrips();
  const linked = useTrip(fromUrl);
  const add = useAddTripItem();
  const [chosen, setChosen] = useState<string | null>(null);
  const [changed, setChanged] = useState<Dates | null>(null); // null: the trip's dates (R4.3)

  if (trips.isPending || (fromUrl && linked.isPending)) return <Loading />;
  if (trips.isError && !trips.data) {
    return (
      <ErrorState message="Could not load your trips." onRetry={() => void trips.refetch()} />
    );
  }
  const loaded = trips.data.pages.flatMap((p) => p.trips);
  // The trip in the URL may be on a page that is not loaded yet.
  const options =
    linked.data && !loaded.some((t) => t.id === linked.data.id)
      ? [linked.data, ...loaded]
      : loaded;
  const trip = options.find((t) => t.id === (chosen ?? fromUrl));
  const dates = changed ?? { from: trip?.start_date ?? null, to: trip?.end_date ?? null };
  const valid = validDates(dates);

  return (
    <View style={styles.section}>
      <Text style={styles.heading} accessibilityRole="header">
        Add to a trip
      </Text>
      {options.length === 0 ? (
        <Button title="New trip" variant="secondary" onPress={() => router.push('/trips/new')} />
      ) : (
        <ChipRow>
          {options.map((t) => (
            <Chip
              key={t.id}
              label={t.name}
              selected={t.id === trip?.id}
              onPress={() => {
                setChosen(t.id);
                setChanged(null);
                add.reset();
              }}
            />
          ))}
        </ChipRow>
      )}
      {trips.hasNextPage ? (
        <Button
          title="More trips"
          variant="secondary"
          busy={trips.isFetchingNextPage}
          onPress={() => void trips.fetchNextPage()}
        />
      ) : null}
      {trip ? (
        <>
          {dates.from && dates.to ? (
            <Text style={styles.text}>
              {dates.from} to {dates.to}
            </Text>
          ) : null}
          {changed ? (
            <TripDates value={changed} onChange={setChanged} />
          ) : (
            <Button title="Change dates" variant="secondary" onPress={() => setChanged(dates)} />
          )}
          {!changed && !valid ? (
            <Text style={styles.error}>This trip has started. Choose other dates.</Text>
          ) : null}
          <Button
            title="Add to trip"
            busy={add.isPending}
            disabled={!valid}
            onPress={() => {
              if (!valid) return;
              add.mutate(
                { tripId: trip.id, listing_id: listingId, ...valid },
                {
                  onSuccess: (item) => {
                    if (differs(item, valid)) return;
                    router.push({ pathname: '/trips/[id]', params: { id: trip.id } });
                  },
                },
              );
            }}
          />
          {add.isSuccess && differs(add.data, add.variables) ? (
            <Text style={styles.error}>
              Already in this trip for {add.data.start_date} to {add.data.end_date}. To change the
              dates, remove it from the trip first.
            </Text>
          ) : null}
          {add.isError ? <Text style={styles.error}>{add.error.message}</Text> : null}
        </>
      ) : null}
    </View>
  );
}

// G4.8: adding again returns the existing item, with its own dates.
type ItemDates = { start_date?: string; end_date?: string };
const differs = (a: ItemDates, b: ItemDates) =>
  a.start_date !== b.start_date || a.end_date !== b.end_date;

const styles = StyleSheet.create({
  section: { gap: theme.space.md },
  heading: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text },
  text: { fontSize: theme.font.body, color: theme.color.text },
  error: { color: theme.color.danger },
  link: { color: theme.color.primary, fontSize: theme.font.body },
});
