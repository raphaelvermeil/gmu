import { Link, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { ErrorState, Loading, Screen } from '../../components/Screen';
import { theme } from '../../components/theme';
import { formatCents, statusLabel } from './format';
import { useMyListings } from './queries';

export function MyListingsScreen() {
  const router = useRouter();
  const listings = useMyListings();
  if (listings.isPending) return <Loading />;
  if (listings.isError) {
    return (
      <ErrorState message="Could not load your listings." onRetry={() => listings.refetch()} />
    );
  }
  const items = listings.data.listings;

  return (
    <Screen title="Your gear">
      <Button title="List an item" onPress={() => router.push('/listings/new')} />
      {items.length === 0 ? (
        <Text style={styles.muted}>
          Nothing listed yet. Your listings, drafts included, show here.
        </Text>
      ) : (
        items.map((l) => (
          <Pressable
            key={l.id}
            accessibilityRole="link"
            onPress={() => router.push({ pathname: '/listings/[id]', params: { id: l.id } })}
            style={styles.row}
          >
            <View style={styles.grow}>
              <Text style={styles.title}>{l.title}</Text>
              <Text style={styles.muted}>
                {statusLabel[l.status]} ·{' '}
                {l.daily_price_cents ? `${formatCents(l.daily_price_cents)} a day` : 'No price yet'}
              </Text>
            </View>
          </Pressable>
        ))
      )}
      <Link href="/profile" style={styles.link}>
        Your profile
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface,
    flexDirection: 'row',
  },
  grow: { flex: 1, gap: theme.space.xs },
  title: { fontSize: theme.font.body, fontWeight: '600', color: theme.color.text },
  muted: { color: theme.color.muted, fontSize: theme.font.small },
  link: { color: theme.color.primary, fontSize: theme.font.body, paddingVertical: theme.space.sm },
});
