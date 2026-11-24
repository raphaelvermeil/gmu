import { Link, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Button } from '../../components/Button';
import { ErrorState, Loading, Screen } from '../../components/Screen';
import { theme } from '../../components/theme';
import { useTrips } from './queries';

export function TripsScreen() {
  const router = useRouter();
  const trips = useTrips();
  if (trips.isPending) return <Loading />;
  if (trips.isError && !trips.data) {
    return (
      <ErrorState message="Could not load your trips." onRetry={() => void trips.refetch()} />
    );
  }
  const items = trips.data.pages.flatMap((p) => p.trips);

  return (
    <Screen title="Your trips">
      <Button title="New trip" onPress={() => router.push('/trips/new')} />
      {items.length === 0 ? (
        <Text style={styles.muted}>No trips yet. A trip collects gear for your dates.</Text>
      ) : null}
      {items.map((t) => (
        <Pressable
          key={t.id}
          accessibilityRole="link"
          style={styles.row}
          onPress={() => router.push({ pathname: '/trips/[id]', params: { id: t.id } })}
        >
          <Text style={styles.name}>{t.name}</Text>
          <Text style={styles.muted}>
            {t.start_date} to {t.end_date}
          </Text>
        </Pressable>
      ))}
      {trips.isFetchNextPageError ? <Text style={styles.error}>Could not load more.</Text> : null}
      {trips.hasNextPage ? (
        <Button
          title="Load more"
          variant="secondary"
          busy={trips.isFetchingNextPage}
          onPress={() => void trips.fetchNextPage()}
        />
      ) : null}
      <Link href="/" style={styles.link}>
        Find gear
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    padding: theme.space.md,
    gap: theme.space.xs,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface,
  },
  name: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text },
  muted: { color: theme.color.muted, fontSize: theme.font.small },
  error: { color: theme.color.danger },
  link: { color: theme.color.primary, fontSize: theme.font.body, paddingVertical: theme.space.sm },
});
