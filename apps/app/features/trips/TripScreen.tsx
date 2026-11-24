import type { TripGroup } from '@gear/shared';
import { Link, useRouter } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { ErrorState, Loading, Screen } from '../../components/Screen';
import { theme } from '../../components/theme';
import { ApiRequestError } from '../../lib/api';
import { formatCents } from '../listings/format';
import { formatDistance } from '../search/format';
import { useRemoveTripItem, useTrip } from './queries';

type Item = TripGroup['items'][number];

function markText(item: Item): string {
  if (item.mark === 'unavailable') return 'Unavailable';
  if (item.mark === 'available') return 'Available';
  return `Price changed, was ${formatCents(item.daily_price_cents_at_add)} a day`;
}

export function TripScreen({ id }: { id: string }) {
  const router = useRouter();
  const trip = useTrip(id);
  if (trip.isPending) return <Loading />;
  if (trip.isError && !trip.data) {
    const gone = trip.error instanceof ApiRequestError && [403, 404].includes(trip.error.status);
    return gone ? (
      <ErrorState message="This trip is not available." />
    ) : (
      <ErrorState message="Could not load this trip." onRetry={() => void trip.refetch()} />
    );
  }
  const t = trip.data;

  return (
    <Screen title={t.name}>
      <Text style={styles.muted}>
        {t.start_date} to {t.end_date}
      </Text>
      {trip.isError ? (
        <ErrorState message="Could not refresh this trip." onRetry={() => void trip.refetch()} />
      ) : null}
      <Button
        title="Find gear"
        onPress={() => router.push({ pathname: '/', params: { trip: t.id } })}
      />
      {t.groups.length === 0 ? <Text style={styles.muted}>No gear in this trip yet.</Text> : null}
      {t.groups.map((g) => (
        <Group key={g.items[0]!.id} tripId={t.id} group={g} />
      ))}
      <Text style={styles.name}>
        Trip total: {formatCents(t.price_cents)} · deposit {formatCents(t.deposit_cents)}
      </Text>
      <Text style={styles.muted}>Estimated price. Nothing is charged.</Text>
      <Link href="/trips" style={styles.link}>
        Your trips
      </Link>
    </Screen>
  );
}

function Group({ tripId, group: g }: { tripId: string; group: TripGroup }) {
  const remove = useRemoveTripItem(tripId);
  return (
    <View style={styles.card}>
      <Text style={styles.name} accessibilityRole="header">
        {g.owner.display_name ?? 'Owner'}
        {g.owner.rating_avg === null
          ? ''
          : ` · ${g.owner.rating_avg.toFixed(1)} (${g.owner.rating_count})`}
      </Text>
      <Text style={styles.muted}>
        {g.start_date} to {g.end_date} · {g.days} {g.days === 1 ? 'day' : 'days'}
        {g.distance_m === null ? '' : ` · ${formatDistance(g.distance_m)}`}
      </Text>
      {g.items.map((item) => (
        <View key={item.id} style={styles.item}>
          {item.photo_url ? <Image source={{ uri: item.photo_url }} style={styles.thumb} /> : null}
          <View style={styles.grow}>
            <Link
              href={{
                pathname: '/listings/[id]',
                params: { id: item.listing_id, trip: tripId },
              }}
              style={styles.link}
            >
              {item.title}
            </Link>
            <Text style={item.mark === 'available' ? styles.muted : styles.error}>
              {markText(item)}
            </Text>
            {item.mark !== 'unavailable' && item.line_total_cents !== null ? (
              <Text style={styles.muted}>
                {formatCents(item.line_total_cents)} · deposit {formatCents(item.deposit_cents)}
              </Text>
            ) : null}
          </View>
          <Button
            title="Remove"
            variant="secondary"
            busy={remove.isPending && remove.variables === item.id}
            onPress={() => remove.mutate(item.id)}
          />
        </View>
      ))}
      {remove.isError ? <Text style={styles.error}>Could not remove it. Try again.</Text> : null}
      <Text style={styles.text}>
        Price {formatCents(g.price_cents)} · deposit {formatCents(g.deposit_cents)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: theme.space.md,
    gap: theme.space.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  thumb: { width: 56, height: 56, borderRadius: theme.radius.sm },
  grow: { flex: 1, gap: theme.space.xs },
  name: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text },
  text: { fontSize: theme.font.body, color: theme.color.text },
  muted: { color: theme.color.muted, fontSize: theme.font.small },
  error: { color: theme.color.danger, fontSize: theme.font.small },
  link: { color: theme.color.primary, fontSize: theme.font.body },
});
